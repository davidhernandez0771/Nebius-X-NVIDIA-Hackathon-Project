"""sim_worker.teleop_render.SubstepSim: the teleop driver's view of the SimulationContext (pure; a fake sim)."""

from __future__ import annotations

from sim_worker.teleop_render import SubstepSim
from sim_worker.teleop_trace import Sections


class FakeSim:
    def __init__(self, rendering: bool = True) -> None:
        self.calls: list[str] = []
        self.is_rendering = rendering
        self.device = "cuda:0"

    def step(self, render: bool = True) -> None:
        # SimulationContext.step: physics, then render() if asked and rendering is on
        self.calls.append("physics")
        if render and self.is_rendering:
            self.render()

    def render(self) -> None:
        self.calls.append("render")


def test_render_every_substep_is_what_the_sim_does_on_its_own():
    real, plain = FakeSim(), FakeSim()
    sim = SubstepSim(real, render_every=1)
    for _ in range(4):
        sim.step()
        plain.step()
    assert real.calls == plain.calls == ["physics", "render"] * 4


def test_render_every_second_substep_renders_once_per_control_step():
    real = FakeSim()
    sim = SubstepSim(real, render_every=2)
    for _ in range(4):  # two control steps of two physics substeps
        sim.step()
    assert real.calls == ["physics", "physics", "render", "physics", "physics", "render"]


def test_no_render_when_the_sim_is_not_rendering():
    real = FakeSim(rendering=False)
    sim = SubstepSim(real, render_every=1)
    sim.step()
    assert real.calls == ["physics"]


def test_step_render_false_is_respected():
    real = FakeSim()
    SubstepSim(real, render_every=1).step(render=False)
    assert real.calls == ["physics"]


def test_other_attributes_pass_through():
    assert SubstepSim(FakeSim(), render_every=1).device == "cuda:0"


def test_physics_and_render_are_timed_into_sections_with_a_sync_first():
    t = [0.0]
    synced = []
    sections = Sections(clock=lambda: t[0])

    class SlowSim(FakeSim):
        def step(self, render=True):
            t[0] += 0.003
            super().step(render)

        def render(self):
            t[0] += 0.010
            super().render()

    sim = SubstepSim(SlowSim(), render_every=2, sections=sections, sync=lambda: synced.append(1))
    sim.step()
    sim.step()
    out = sections.take()
    assert out["physics"] == 6.0 and out["render"] == 10.0
    assert len(synced) == 3  # after each physics substep and after the render
