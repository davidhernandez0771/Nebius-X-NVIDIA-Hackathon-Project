"""Per-episode eval results and their aggregate (success out of N, reasons histogram)."""

from __future__ import annotations

from collections import Counter
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# How an episode stopped. "success": check_success passed (checked every 0.5 s); "time_limit": the 30 s ran out;
# "policy_error": the policy server failed or was unreachable; "sim_error": the simulator raised mid-episode.
EndedBy = Literal["success", "time_limit", "policy_error", "sim_error"]


class EpisodeResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seed: int
    success: bool
    reasons: list[str]  # check_success codes, or "policy_error" / "sim_error"
    ended_by: EndedBy
    steps: int = Field(ge=0)
    sim_s: float = Field(ge=0)
    wall_s: float = Field(ge=0)
    error: str | None = None
    final_cube_pos: list[float] | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "EpisodeResult":
        if self.success == bool(self.reasons):
            raise ValueError("a success has no reasons; a failure needs at least one")
        if self.success != (self.ended_by == "success"):
            raise ValueError("success and ended_by='success' must agree")
        return self


class EvalSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    n: int
    successes: int
    success_rate: float
    reasons: dict[str, int]  # episodes per reason code (one episode can have several)
    ended_by: dict[str, int]
    mean_wall_s: float
    mean_steps: float
    seeds: list[int]


def aggregate(episodes: list[EpisodeResult]) -> EvalSummary:
    if not episodes:
        raise ValueError("no episodes to aggregate")
    n = len(episodes)
    successes = sum(e.success for e in episodes)
    return EvalSummary(
        n=n,
        successes=successes,
        success_rate=successes / n,
        reasons=dict(Counter(r for e in episodes for r in e.reasons)),
        ended_by=dict(Counter(e.ended_by for e in episodes)),
        mean_wall_s=sum(e.wall_s for e in episodes) / n,
        mean_steps=sum(e.steps for e in episodes) / n,
        seeds=[e.seed for e in episodes],
    )
