"""SubstepSim: the teleop driver's view of Isaac Lab's SimulationContext, for replay's step helpers.

SimulationContext.step() renders after every physics step whenever rendering is on (a GUI window or RTX
cameras), so a control step of DECIMATION physics substeps renders DECIMATION times. SubstepSim steps physics
without rendering and renders only every `render_every`-th step: render_every=1 is exactly what the sim does on
its own; render_every=DECIMATION renders once per control step, after its last substep, so what is shown and
what the cameras read is the state the control step ends in. Physics is the same either way.

With a Sections (sim_worker.teleop_trace), physics and render time are added to it; `sync` (e.g.
torch.cuda.synchronize) runs before each timer stops, so asynchronous GPU work is charged to the part that
queued it. Everything else is passed through to the real sim.

Pure (no Isaac import), so it tests with a fake sim.
"""

from __future__ import annotations

from typing import Any, Callable

from .teleop_trace import Sections


class SubstepSim:
    def __init__(self, sim: Any, *, render_every: int, sections: Sections | None = None,
                 sync: Callable[[], None] | None = None) -> None:
        if render_every < 1:
            raise ValueError("render_every must be >= 1")
        self._sim, self._every, self._sections, self._sync = sim, render_every, sections, sync
        self._count = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._sim, name)

    def _timed(self, name: str, fn: Callable[[], None]) -> None:
        if self._sections is None:
            fn()
            return
        with self._sections.time(name):
            fn()
            if self._sync is not None:
                self._sync()

    def step(self, render: bool = True) -> None:
        self._count += 1
        self._timed("physics", lambda: self._sim.step(render=False))
        if render and self._count % self._every == 0 and self._sim.is_rendering:
            self._timed("render", self._sim.render)
