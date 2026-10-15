"""chat_vision(): request shape and usage logging, with the OpenAI client mocked."""
from __future__ import annotations

import base64
import json
from types import SimpleNamespace as NS
from unittest.mock import patch

import pytest

from nebius_llm import chat_vision, chat_vision_images


def _response(text="[]", finish_reason="stop", prompt_tokens=700, completion_tokens=100):
    return NS(
        model="openbmb/MiniCPM-V-4_5",
        choices=[NS(message=NS(content=text), finish_reason=finish_reason)],
        usage=NS(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, total_tokens=prompt_tokens + completion_tokens),
    )


@pytest.fixture
def api_mock(monkeypatch):
    monkeypatch.setenv("NEBIUS_API_KEY", "test-only")
    with patch("nebius_llm.client.openai.OpenAI") as constructor:
        yield constructor.return_value.chat.completions.create


def test_image_is_sent_as_a_base64_data_url_with_the_prompt(api_mock):
    api_mock.return_value = _response()
    chat_vision("what is here?", b"\xff\xd8raw", mime_type="image/png", max_tokens=321)

    kwargs = api_mock.call_args.kwargs
    text_part, image_part = kwargs["messages"][0]["content"]
    assert text_part == {"type": "text", "text": "what is here?"}
    assert image_part["image_url"]["url"] == "data:image/png;base64," + base64.b64encode(b"\xff\xd8raw").decode()
    assert kwargs["max_tokens"] == 321
    assert kwargs["model"] == "openbmb/MiniCPM-V-4_5"


def test_usage_is_logged_with_vision_tier_and_truncation_is_visible(api_mock, tmp_path):
    api_mock.return_value = _response(finish_reason="length", completion_tokens=1024)
    result = chat_vision("p", b"img")

    entry = json.loads((tmp_path / "usage_log.jsonl").read_text())
    assert entry["tier"] == "vision:minicpm"
    assert entry["finish_reason"] == "length" == result.finish_reason
    assert entry["completion_tokens"] == 1024
    assert result.est_cost_usd == pytest.approx((700 * 0.658 + 1024 * 1.11) / 1_000_000)


def test_vision_does_not_retry_by_default(api_mock):
    import openai

    api_mock.side_effect = openai.APIConnectionError(request=NS())
    with patch("nebius_llm.client.time.sleep") as sleep, pytest.raises(Exception):
        chat_vision("p", b"img")

    assert api_mock.call_count == 1
    sleep.assert_not_called()


def test_unknown_vision_tier_fails_before_any_request(api_mock):
    with pytest.raises(ValueError):
        chat_vision("p", b"img", tier="nope")
    api_mock.assert_not_called()


def test_multi_image_request_has_text_then_images_in_order(api_mock):
    api_mock.return_value = _response()
    images = [b"first", b"second", b"third"]
    chat_vision_images("compare these", images, max_tokens=99)

    kwargs = api_mock.call_args.kwargs
    text_part, *image_parts = kwargs["messages"][0]["content"]
    assert text_part == {"type": "text", "text": "compare these"}
    assert [p["image_url"]["url"] for p in image_parts] == [
        "data:image/png;base64," + base64.b64encode(img).decode() for img in images
    ]
    assert kwargs["max_tokens"] == 99


def test_nemotron_vl_tier_routes_to_its_model_id(api_mock, tmp_path):
    api_mock.return_value = _response(prompt_tokens=1000, completion_tokens=200)
    result = chat_vision_images("p", [b"img"], tier="nemotron-vl")

    assert api_mock.call_args.kwargs["model"] == "nvidia/Nemotron-3.5-Super-VL"
    entry = json.loads((tmp_path / "usage_log.jsonl").read_text())
    assert entry["tier"] == "vision:nemotron-vl"
    assert result.est_cost_usd == pytest.approx((1000 * 0.30 + 200 * 0.90) / 1_000_000)
