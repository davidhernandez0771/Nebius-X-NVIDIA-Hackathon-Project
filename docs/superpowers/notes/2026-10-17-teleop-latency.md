# Teleop latency (branch `pm/teleop-latency`, from `pm/hand-v3`)

## 2026-10-17 23:30 — Measured per stage; the sim step was the delay. Idle (lining up): 67 → 47 ms from message to finished step, sim 0.41 → 0.65× real time. Recording: unchanged unless the lead picks `--render fastest`.

**Bottom line**
- The delay is the sim being slower than real time; the network, the relay and the sink queue add about 1 ms.
- **Before:** a control step took 49–96 ms, against 20 ms for real time.
  - 96 ms when Windows throttled the background Kit window, as in a live session.
  - 49 ms when it didn't.
- So the arm moved at 0.2–0.4× real time, and it trails its target by about one control step on top of that.
- Fixed, with behaviour otherwise unchanged:
  1. Render only what is needed while not recording.
  2. Opt the sink out of Windows power throttling.
  3. Skip the robot state and camera read on steps that aren't recorded.
  4. The browser no longer drops half its hand updates on a 30 fps tracking loop.
- **Recording is not faster yet** (51 ms per step, 0.39× real time). Making it faster changes the recorded camera
  frames slightly. That is the lead's call: `--render fastest` gives 38 ms per step (0.53×). See below.

### Before / after per stage

**Live, through the real relay.** Measured with `sim_worker/teleop_probe.py` (a fake browser streaming 30 Hz
traced hands in a slow circle), `teleop_sink.py --viz kit --latency` and the backend on :8000. 70 s per run,
25 s of it recording. Values are ms, p50 (p95), over 2 s windows.
- **Before:** `--render legacy --no-high-qos` (this run happened not to be throttled; a throttled run is
  slower, see the smoke table).
- **After:** the defaults (`--render fast --high-qos`).

| Stage | Before, idle | After, idle | Before, recording | After, recording |
|---|---|---|---|---|
| browser: frame into MediaPipe → send | not measured (needs the webcam, see "Live test") | | | |
| to_relay: browser → relay | 0.54 (0.9) | 0.54 (1.1) | 0.55 (0.8) | 0.54 (1.0) |
| relay: in → out (validation + forward) | 0.08 (0.15) | 0.08 (0.2) | 0.08 (0.13) | 0.08 (0.2) |
| to_sink: relay → sink reader thread | ~0.1 (2–4) | ~0.2 (3.6) | ~0.1 (3.7) | ~0 (2.5) |
| wait: sink → the control step that applies it | 16.5 (30–32) | 13.5–16.5 (29) | 17–18 (32) | 16 (32) |
| step: IK + physics + render | **49 (51)** | **29.5 (31.5)** | 51 (53.5) | 51.5 (54) |
| **total**: send → step done | **66–67 (78–81)** | **46–47 (60)** | 70 (85) | 70 (86) |
| steps / s (real-time factor) | 20.4 (0.41) | **32 (0.65)** | 19.4 (0.39) | 19.2 (0.39) |
| stale hands dropped per 2 s | 19 | 0 | 21 | 22 |

**Where a step's time goes** (trace sections, ms p50, idle):

| Part | Before | After |
|---|---|---|
| render | 29.7 | 11.0 |
| physics (2 substeps) | 8.3 | 8.2 |
| per-substep IK bookkeeping ("other") | 8.6 | 8.2 |
| IK target + feedforward | 2.2 | 2.2 |
| state and camera read | 2.6–4 on every step in the old code (it was then discarded) | 0 |

**In-process fake-hand smoke** (`teleop_sink.py --fake-hand --viz kit --lead-in-s 10`, no relay, no trace;
ms per control step). The Kit window is in the background, as in a live session.

| Code / mode | Idle step | Recording step |
|---|---|---|
| old code (`pm/hand-v3`, worktree pm-t4) | 96 | 83.7 |
| `--render legacy`, high QoS | 51.1 | 55.2 |
| **`--render fast`, high QoS (defaults)** | **31.0 / 30.8** (2 runs) | **54.6 / 53.2** |
| `--render fast --no-high-qos` | 55.8 / 33.6 | 81.2 / 56.3 |
| `--render fastest`, high QoS | 30.8 | **37.6** |

**Throttling:** 4 of the 6 runs without high QoS fell into a slow state. In that state:
- idle steps took 55–77 ms;
- CPU-side IK bookkeeping doubled, from 8 to 16 ms;
- the old code's run took 96 ms.

None of the 3 runs with high QoS did. The likely cause is Windows 11 power throttling (EcoQoS) of the background
process on this hybrid i9-14900KF. `sim_worker/teleop_qos.py` opts out, as turning Task Manager's "Efficiency mode"
off does.

**Arm tracking:** from the recordings, the arm trails its target by about one control step of sim time:
- 2.9 mm at lag 0 on the smoke;
- about 10 mm at lags 0–1 live, where the hand moves 2.5× faster in sim time at 0.39× real time.

That one step adds a step's wall time to what the person sees: about 50 ms before and about 30 ms after, when idle.

### What changed (4 commits on `pm/teleop-latency`; nothing pushed)

| Where | Change |
|---|---|
| `sim_worker/teleop_trace.py` (new) + sink `--latency [--latency-log PATH]` | **The trace**, off by default. Per stage, steps/s, real-time factor, step sections; one line every 2 s, JSONL optional. |
| `web/src/teleop/teleopClient.ts`, Record page `?latency=1` | The browser adds `trace: {cap, send}` (epoch ms) when asked. Without it, the messages are byte-for-byte as before. |
| `src/app/routers/teleop.py` | A traced hand is validated without its trace and forwarded with `relay_in`/`relay_out` added. Untraced messages are forwarded verbatim. Validation costs ~7 µs, so it was kept. |
| `sim_worker/teleop_session.py` | **Idle and paused steps no longer read the state** (the robot data, 7 contact sensors and 2 camera copies were discarded). `apply_inbox`: controls in order, only the newest hand of each run validated and applied (it already was the only one used); stale hands counted. The driver hears `set_recording(on)`. |
| `sim_worker/teleop_isaac.py`, `teleop_render.py` (new) | `--render legacy / fast / fastest` (details below). Physics is identical in every mode (checked: joint positions, tool pose and actions bit-identical on the smoke). |
| `sim_worker/teleop_qos.py` (new), sink `--high-qos` (default on) | No Windows power throttling for the sink. |
| `web/src/teleop/teleopClient.ts` | **Throttle tolerates frame jitter.** A frame due 33 ms after the last send was dropped when it came at 32.x ms. On a 30 fps tracking loop with ±1.5 ms jitter it sent 30 of 60 frames, with 66 ms gaps. Now it sends all 60, with gaps under 37 ms (still about 30 per second on a 60 fps loop). |
| `sim_worker/teleop_probe.py` (new) | The fake browser used above. |

**Render modes**
- **`legacy`:** as before. Each control step renders the window and both recording cameras after each of its 2
  physics steps.
- **`fast` (default):**
  - While not recording, the cameras' render products are paused and the window renders once per control step.
  - While recording, rendering is exactly as in legacy.
  - On Record the cameras resume with 20 warm-up renders (about 0.25 s, once).
  - Kit's 120 Hz main-loop limit is off. That alone keeps recorded frames bit-identical (checked).
- **Recorded frames in `fast`:** pausing the cameras shifts the path tracer's per-frame sampling, so the frames are
  not bit-identical to legacy's. They differ only as much as legacy's own frames do when the person waits one
  second longer before pressing Record:

  | Comparison | Front: mean / % px > 20 | Wrist: mean / % px > 20 |
  |---|---|---|
  | fast vs legacy | 0.60 / 0.09% | 0.73 / 0.17% |
  | legacy, 11 s vs 10 s lead-in | 0.63 / 0.20% | 0.75 / 0.25% |

- **`fastest`:** fast, and also one render per control step while recording.
  - Frames differ a bit more: front 0.74 / 0.29%, wrist 0.94 / 0.39%.
  - The difference is possibly systematic, because the cameras render half as many frames. Sprint 8 showed camera
    policies are sensitive to render differences.
  - So it is not the default. **Lead decision:** it would take recording from 51–55 to about 38 ms per step.
- **Tried and dropped:** drawing the window only once while still rendering the cameras twice. Turning the
  viewport's updates off and on every physics step cost 130 ms per step.

### Checks
- **Tests:**
  - `uv run pytest -q`: 1533 passed, 18 skipped, 0 failed;
  - `npm --prefix web test`: 323 passed;
  - `npm --prefix web run build`: OK.
  - New tests were written first and watched failing. SubstepSim's tests also caught two deliberate mutations.
- **`web/node_modules`:** in this worktree it is a junction to `C:\dev\pm-t4\web\node_modules`, because the
  `package.json` and lockfile are identical. Nothing was installed or downloaded; the junction is git-ignored.
- **GPU:**
  - Isaac runs started after T3's "GPU released (sprint 8)" at 22:29.
  - Each run was gated on no other Isaac python and no `teleop_sink.py`, and each took under 4 min.
  - No T-latency process is running now (checked 23:24).

### What is left (not done)
- **Recording at 0.39× real time:** `--render fastest` (lead decision, above).
- **Further, not tried:**
  - a smaller Kit window: the renderer is RealTimePathTracing at 1440×900, and the viewport alone costs about
    8 ms per render;
  - CPU PhysX for the single env: GPU physics is about 4 ms per substep, but CPU numerics differ, so physics would
    not be identical.
- **Desktop GPU apps:** Wallpaper Engine, Chrome and others share the GPU; occasional ~95 ms render spikes
  appeared in some runs.
- **Browser depth smoothing:** a 120 ms EMA on depth (`controlRegion.ts DEPTH_SMOOTHING_MS`) delays depth (x)
  moves by about 120 ms. It is a deliberate jitter/lag trade-off, so it is unchanged. A One Euro filter would cut
  the lag on fast moves; that's a feel change for a live test.
- **Not measured:** webcam capture and MediaPipe time. That needs the live test.

### Live test: how to see the numbers
1. Start the backend as usual.
2. Run `C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\teleop_sink.py --viz kit --latency --latency-log data\latency.jsonl`.
   The defaults are now `--render fast --high-qos`; add `--render legacy` or `--no-high-qos` to compare.
3. Open the Record page with `?latency=1`.
4. The sink prints a `[latency]` line every 2 s. `browser` is webcam frame → send, and `total` is frame → finished
   step (add about one step for the arm to catch up).

**Artifacts** (scratch, not in git):
`C:\Users\<user>\AppData\Local\Temp\claude\C--dev-pm-t2\b36cdfba-819d-4afc-8171-bcd95ba87923\scratchpad\lat\`
holds the logs, JSONL and stores of every run above, plus the probes (`kit_probe.py`, `substep_probe.py`,
`fast_probe.py`, `cmp_frames.py`, `e2e.sh`).
