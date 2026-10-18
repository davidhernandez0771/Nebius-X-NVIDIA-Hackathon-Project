"""SubstepSim: the teleop driver's view of Isaac Lab's SimulationContext, for replay's step helpers.

SimulationContext.step() renders after every physics step whenever rendering is on (a GUI window or RTX
cameras), so a control step of `substeps` physics steps renders `substeps` times. SubstepSim steps physics
without rendering and renders only every `render_every`-th physics step (a divisor of `substeps`; it may change
between control steps): render_every=1 is exactly what the sim does on its own; render_every=substeps renders
once per control step, after its last physics step. Physics is the same either way.

With a Sections (sim_worker.teleop_trace), physics and render time are added to it; `sync` (e.g.
torch.cuda.synchronize) runs before each timer stops, so asynchronous GPU work is charged to the part that
queued it. Everything else is passed through to the real sim.

Pure (no Isaac import), so it tests with a fake sim.
"""

from __future__ import annotations

from typing import Any, Callable

from .teleop_trace import Sections


class SubstepSim:
    def __init__(self, sim: Any, *, substeps: int, render_every: int, sections: Sections | None = None,
                 sync: Callable[[], None] | None = None) -> None:
        self._sim, self._substeps = sim, substeps
        self._sections, self._sync = sections, sync
        self.render_every = render_every
        self._count = 0

    @property
    def render_every(self) -> int:
        return self._every

    @render_every.setter
    def render_every(self, n: int) -> None:
        if n < 1 or self._substeps % n:
            raise ValueError(f"render_every must divide the {self._substeps} physics steps of a control step")
        self._every = n

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
