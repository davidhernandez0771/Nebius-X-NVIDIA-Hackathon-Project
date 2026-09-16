"""One text-only Cosmos connection test. No image upload or automatic retries."""

from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

from nebius_llm import TokenFactoryError, chat  # noqa: E402


def main():
    print("Cosmos test: NVIDIA hosted API; one request, at most 256 output tokens.")
    try:
        result = chat(
            "A shelf contains books, socks and charging cables. "
            "Suggest three simple storage groups in three short bullets. "
            "Use only the supplied description; no image was provided.",
            provider="nvidia", max_tokens=256, temperature=0.2)
    except TokenFactoryError as error:
        print(f"NOT PASSED: {error}")
        print("Nebius cost: $0 (no Nebius request). NVIDIA billed cost: not reported.")
        return 1
    print(f"Model: {result.model}")
    print(f"Response:\n{result.text.strip() or '<empty>'}")
    print(f"Tokens: {result.prompt_tokens} in / {result.completion_tokens} out")
    print(f"Latency: {result.latency_s:.2f}s; finish={result.finish_reason}")
    print("Estimated API cost: $0 (NVIDIA free development tier; not a billing receipt).")
    print("Usage saved to usage_log.jsonl (or USAGE_LOG_PATH override).")
    if not result.text.strip() or result.finish_reason == "length":
        print("NOT PASSED: empty or truncated answer. Do not treat this as a successful test.")
        return 1
    print("COSMOS TEXT TEST PASSED (vision has not been tested).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
