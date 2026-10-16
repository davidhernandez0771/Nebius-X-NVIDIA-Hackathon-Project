# Sprint 3c (T1, T5): Live Teleop Link + Media for the Submission

> Sprint 3's Global Constraints apply: ownership, 0 failed, no
> push/merge/rebase, at most one Isaac process (check before launching), and
> a progress entry after every task.
> Required skills: `test-driven-development`, `systematic-debugging`,
> `verification-before-completion`.

**Start point:** `d136c8e` — 838 Python + 387 Isaac-pure + 163 web tests
pass; the build is OK. T2 (rendering degraded demos), T3 (training/eval) and
T4 (experiment runner + live run) are still running; never edit their files.

---

## T5 (`C:\dev\pm-fix`): the live teleop link, so a human can record a demo

**Goal:** the person presses Start on the Record page, moves their hand, and
the Franka in Isaac follows live. Stop saves a human `Demo`, plus its
episode, into the `DemoStore`.

The browser → relay → `HandPoseMsg` path and `demo_pipeline.teleop`
(`to_ee_target`, `GripperLatch`) already exist. This task adds control
messages, the sim-side session, and the UI.

**Owns:**

- `src/app/routers/teleop.py` and `tests/test_teleop_relay.py` (no other
  track is editing them now);
- new `sim_worker/teleop_session.py`, `sim_worker/teleop_isaac.py`,
  `sim_worker/scripts/teleop_sink.py`, `tests/test_sim_teleop_session.py`;
- `web/src/pm/record/**`.

Do NOT edit other `sim_worker` files (T2 owns them). Import from them only.

### 1. Relay control and status messages

Browser → sim:

```json
{"type": "control", "action": "record_start" | "record_stop" | "reset_scene"}
```

Sim → browser:

```json
{"type": "sim_status", "recording": true, "steps": 123, "demo_id": "...", "last_result": "..."}
```

- `HandPoseMsg` handling stays exactly as it is.
- Validate the new types with small pydantic models in the router.
- Tests.

### 2. `TeleopSession`: pure state machine

States: `idle` → `recording` → `saving` → `idle`.

**Recording:**

- Each control step takes the latest `HandPoseMsg` and computes
  `to_ee_target` + `GripperLatch` → the command.
- It appends to a `Trajectory` (50 Hz sim time).
- If tracking is lost for more than 0.3 s, the session pauses (spec 8.1).

**On stop:**

- Build `Demo(source="human", human_seconds=wall-clock)`.
- Hand it to an injected `save_fn`, which writes the episode with
  `episode_io` plus `save_signals`, and stores the demo.

Inject a robot `driver` interface (`apply(target_pose, gripper)`,
`read_state()`) so the session is testable with a fake driver.

**Tests:**

- start/stop;
- pause on lost tracking;
- 50 Hz timing;
- hysteresis passes through;
- the saved `Demo` validates.

### 3. Isaac driver and sink

- `teleop_isaac.py`: a driver using `sim_worker.placement.place_scene` and
  the same diff-IK + feedforward control that `replay` uses (import it; don't
  copy it).
- `sim_worker/scripts/teleop_sink.py`:
  - connects to `ws://127.0.0.1:8000/ws/teleop?role=sim`;
  - runs the session on Isaac's main thread;
  - the CLI takes `--viz kit` (the human must see the window).

**No unattended live run with a person.** If no other Isaac process is
running, do one automated smoke test: a scripted fake hand sends a
`HandPoseMsg` stream for the scripted pick-and-place, and the saved demo
must verify successfully. Record the result.

### 4. Record page

- Enable Start/Stop (they send the control messages).
- Show `sim_status` (recording, steps, saved demo id with a link to Review),
  a "sim not connected" state, and a reset-scene button.
- Vitest tests.

Done = `uv run pytest -q`, `npm --prefix web test` and
`npm --prefix web run build` pass, and the Isaac-pure tests pass in Isaac's
python.

---

## T1 (`C:\dev\pm-t1`): second-arm ranges + submission media

**Owns:**

- `src/demo_pipeline/multiply.py` + its tests;
- new `scripts/render_charts.py`, `scripts/make_media.py`, `src/demo_pipeline/media.py`;
- their tests.

**Pre-approved:** install `pillow` into `C:\venvs\pm-t1` only.

### 1. Tune `SCENE_RANGES` for flexiv and openarm from measured data

Read T2's per-variant rows (read-only):

- `C:\dev\pm-t2\data\multiply_flexiv\rows\*.json`
- `...\multiply_openarm*`
- `...\batch_openarm_lift018`
- the corner runs

Fit ranges where success was observed (with a margin), and keep Franka's
ranges unchanged. Document the evidence in your note.

**Tests:** the ranges contain the observed successes and exclude the
observed `unreachable` failures, where those separate cleanly.

### 2. `scripts/render_charts.py`

`DATA_DIR/results/results.json` → standalone SVG files for the README:

- the success-vs-human-demos chart;
- the ablation bars;
- the yield vs MimicGen's 38–74%.

Pure Python, writing SVG text. `null` values render as a "pending" mark,
never 0. When the file has `"sample": true`, add a visible SAMPLE watermark.

**Tests:** SVG structure, null handling, the watermark.

### 3. `scripts/make_media.py` + `src/demo_pipeline/media.py`

From an episode dir (front PNGs + `steps.npz`) and an optional stored
diagnosis, make:

- an animated GIF with a timeline bar at the bottom, showing segments and
  issue markers;
- a side-by-side GIF for a raw vs a perfected episode;
- one still contact sheet (6 frames).

Keep the frame-selection and timeline math pure in `media.py` (testable
without images); `make_media.py` does the Pillow drawing.

**Tests:**

- frame selection;
- timeline geometry;
- one tiny synthetic episode rendered end to end.

Try it on `C:\dev\pm-t2\data\smoke_cam` (read-only) and record the output
paths in your note.
