"""parse_train_log tests (pure text parsing; train_smoke itself needs the lerobot venv for PIL)."""

from __future__ import annotations

import pytest

pytest.importorskip("PIL")
from lerobot_tools.train_smoke import parse_train_log  # noqa: E402


def _line(step: str, loss: float = 2.0) -> str:
    return (f"INFO step:{step} smpl:8K ep:80 epch:8.00 loss:{loss:.3f} grdn:64.8 lr:1.0e-05 updt_s:0.080 "
            f"data_s:0.002 smp/s:99 mem_gb:0.98 l1_loss:0.1 kld_loss:0.9")


def test_k_suffixed_steps_follow_the_log_interval():
    # lerobot prints steps with format_big_number(precision=0): 1000 and 1050 both show as "1K".
    text = "\n".join(_line(s) for s in ["900", "950", "1K", "1K", "1K"])
    assert parse_train_log(text)["logged_steps"] == [900, 950, 1000, 1050, 1100]


def test_k_suffix_without_a_known_interval_falls_back_to_thousands():
    assert parse_train_log(_line("2K"))["logged_steps"] == [2000]


def test_loss_is_the_total_not_kld():
    out = parse_train_log("\n".join([_line("50", 14.974), _line("100", 1.773)]))
    assert out["loss_first_last"] == [14.974, 1.773]
