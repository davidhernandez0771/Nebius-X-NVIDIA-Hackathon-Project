"""Offline checks: credential handling, request shape, retries, error mapping.

No real network calls — the openai client is mocked throughout.
"""
import os
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch

import openai

import nebius_llm.client as client_module
from nebius_llm import AuthError, ModelNotFoundError, RateLimitError, TokenFactoryError, chat


def _response(text="hello back", finish_reason="stop", prompt_tokens=10, completion_tokens=5):
    return NS(
        model="nvidia/Nemotron-3_5-Lightning",
        choices=[NS(message=NS(content=text, reasoning_content=None), finish_reason=finish_reason)],
        usage=NS(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                  total_tokens=prompt_tokens + completion_tokens),
    )


class ChatClientTests(unittest.TestCase):
    def setUp(self):
        client_module._client = None  # force a fresh client per test

    @patch.dict(os.environ, {"NEBIUS_API_KEY": ""})
    def test_missing_key_raises_without_network(self):
        with self.assertRaises(AuthError):
            chat("hello")

    @patch.dict(os.environ, {"NEBIUS_API_KEY": "test-only"})
    @patch("nebius_llm.client.record_usage")
    @patch("nebius_llm.client.openai.OpenAI")
    def test_successful_call_logs_usage_and_cost(self, constructor, log):
        api = constructor.return_value
        api.chat.completions.create.return_value = _response()

        result = chat("hi", tier="nano", log_usage=True)

        self.assertEqual(result.text, "hello back")
        self.assertEqual(result.tier, "nano")
        self.assertGreater(result.est_cost_usd, 0)
        log.assert_called_once()
        self.assertEqual(log.call_args.args[0]["tier"], "nano")
        self.assertEqual(log.call_args.args[0]["prompt_tokens"], 10)

    @patch.dict(os.environ, {"NEBIUS_API_KEY": "test-only"})
    @patch("nebius_llm.client.openai.OpenAI")
    def test_thinking_off_by_default(self, constructor):
        api = constructor.return_value
        api.chat.completions.create.return_value = _response()

        chat("hi", tier="nano")

        body = api.chat.completions.create.call_args.kwargs["extra_body"]
        self.assertFalse(body["chat_template_kwargs"]["enable_thinking"])

    @patch.dict(os.environ, {"NEBIUS_API_KEY": "test-only"})
    @patch("nebius_llm.client.openai.OpenAI")
    def test_think_true_is_passed_through(self, constructor):
        api = constructor.return_value
        api.chat.completions.create.return_value = _response()

        chat("hi", tier="nano", think=True)

        body = api.chat.completions.create.call_args.kwargs["extra_body"]
        self.assertTrue(body["chat_template_kwargs"]["enable_thinking"])

    @patch.dict(os.environ, {"NEBIUS_API_KEY": "test-only"})
    @patch("nebius_llm.client.openai.OpenAI")
    def test_not_found_maps_to_model_not_found_error(self, constructor):
        api = constructor.return_value
        api.chat.completions.create.side_effect = openai.NotFoundError(
            "missing", response=NS(status_code=404, request=NS(), headers={}), body=None)

        with self.assertRaises(ModelNotFoundError):
            chat("hi", tier="nano")

    @patch.dict(os.environ, {"NEBIUS_API_KEY": "test-only"})
    @patch("nebius_llm.client.time.sleep")
    @patch("nebius_llm.client.openai.OpenAI")
    def test_rate_limit_retries_then_raises(self, constructor, sleep):
        api = constructor.return_value
        api.chat.completions.create.side_effect = openai.RateLimitError(
            "slow down", response=NS(status_code=429, request=NS(), headers={}), body=None)

        with self.assertRaises(RateLimitError):
            chat("hi", tier="nano", retries=2)

        self.assertEqual(api.chat.completions.create.call_count, 3)  # initial + 2 retries
        self.assertEqual(sleep.call_count, 2)

    @patch.dict(os.environ, {"NEBIUS_API_KEY": "test-only"})
    @patch("nebius_llm.client.openai.OpenAI")
    def test_unknown_tier_raises_before_any_network_call(self, constructor):
        with self.assertRaises(ValueError):
            chat("hi", tier="giant")
        constructor.return_value.chat.completions.create.assert_not_called()

    @patch.dict(os.environ, {"NEBIUS_API_KEY": "test-only"})
    @patch("nebius_llm.client.openai.OpenAI")
    def test_empty_response_does_not_raise(self, constructor):
        api = constructor.return_value
        api.chat.completions.create.return_value = _response(text="", finish_reason="length")

        result = chat("hi", tier="nano")
        self.assertEqual(result.text, "")
        self.assertEqual(result.finish_reason, "length")


if __name__ == "__main__":
    unittest.main()
