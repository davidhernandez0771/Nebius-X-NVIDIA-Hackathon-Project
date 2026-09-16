"""Offline checks: credential routing, bounded requests, logging, safe errors."""
import os
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch

import openai

from nebius_llm import AuthError, TokenFactoryError, chat


class CosmosTests(unittest.TestCase):
    @patch.dict(os.environ, {"NVIDIA_API_KEY": ""})
    @patch("nebius_llm.cosmos.openai.OpenAI")
    def test_missing_key_never_calls_network(self, constructor):
        with self.assertRaises(AuthError):
            chat("hello", provider="nvidia")
        constructor.assert_not_called()

    @patch.dict(os.environ, {"NVIDIA_API_KEY": "test-only", "NEBIUS_API_KEY": "other-key"})
    @patch("nebius_llm.cosmos.record_usage")
    @patch("nebius_llm.cosmos.openai.OpenAI")
    def test_request_and_usage(self, constructor, log):
        api = constructor.return_value.__enter__.return_value
        api.chat.completions.create.return_value = NS(
            model="cosmos", choices=[NS(message=NS(content="Books in a bin."), finish_reason="stop")],
            usage=NS(prompt_tokens=10, completion_tokens=5, total_tokens=15))
        result = chat("private prompt", provider="nvidia", max_tokens=256)
        self.assertEqual(result.text, "Books in a bin.")
        self.assertEqual(constructor.call_args.kwargs["api_key"], "test-only")
        self.assertEqual(constructor.call_args.kwargs["max_retries"], 0)
        self.assertEqual(api.chat.completions.create.call_count, 1)
        self.assertNotIn("extra_body", api.chat.completions.create.call_args.kwargs)
        self.assertEqual(log.call_args.args[0]["provider"], "nvidia")
        self.assertEqual(log.call_args.args[0]["total_tokens"], 15)
        self.assertNotIn("private prompt", str(log.call_args))
        self.assertNotIn("test-only", str(log.call_args))

    @patch.dict(os.environ, {"NVIDIA_API_KEY": "test-only"})
    @patch("nebius_llm.cosmos.record_usage")
    @patch("nebius_llm.cosmos.openai.OpenAI")
    def test_error_redacts_body_and_does_not_retry(self, constructor, log):
        api = constructor.return_value.__enter__.return_value
        api.chat.completions.create.side_effect = openai.RateLimitError(
            "sensitive-server-body", response=NS(status_code=429, request=NS(), headers={}), body=None)
        with self.assertRaises(TokenFactoryError) as caught:
            chat("hello", provider="nvidia")
        self.assertNotIn("sensitive-server-body", str(caught.exception))
        self.assertEqual(api.chat.completions.create.call_count, 1)
        self.assertEqual(log.call_args.args[0]["http_status"], 429)


if __name__ == "__main__":
    unittest.main()
