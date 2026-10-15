# Sprint 1b (Track T4, continued): Teleop Link Implementation Plan

> **For agentic workers:** Execute in the T4 worktree (`C:\dev\pm-t4`, branch
> `pm/t4-diagnoser`), task by task. The skills and rules are the same as
> sprint 1.

**Goal:** connect the webcam hand to a robot end-effector target. The parts
are a pure mapping (hand measurements → gripper pose + open/closed), the
browser message builder, and the backend WebSocket relay that forwards
messages to the sim worker. The sim worker side belongs to T2 and comes later.

**Architecture:**

- **Browser:** existing MediaPipe tracking (`web/src/hand/tracking`) →
  `toHandPoseMsg()` → WebSocket `/ws/teleop?role=browser`.
- **Backend:** validates each message with the pydantic `HandPoseMsg` and
  forwards it to `/ws/teleop?role=sim`.
- **Sim worker (later, T2):** calls `demo_pipeline.teleop.to_ee_target()`
  and `GripperLatch`.

**Tech Stack:** Python (pydantic, numpy, FastAPI WebSockets, pytest); TypeScript (vitest).

**Spec:** `docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md`,
section 8.1. Sprint 1 Global Constraints still apply, including the 54
known failures and `UV_LINK_MODE=copy`.

## Decisions (the implementer cannot infer these)

### `HandPoseMsg`

The JSON field names are identical in Python and TypeScript.

- `t_ms: float` — `performance.now()`.
- `tracking_ok: bool` — false when no hand is detected. All other fields are
  then the last known values, or 0.
- `wrist_uv: [float, float]` — landmark 0, raw unmirrored normalized image
  coordinates in [0, 1].
- `palm_width: float` — the distance between landmarks 5 and 17 in pixels,
  divided by `frame_w`. It must be greater than 0 when `tracking_ok`.
- `pinch_ratio: float` — the distance between landmarks 4 and 8 in pixels,
  divided by the palm width in pixels.
- `yaw_rad: float` — the image-plane angle of the vector from landmark 0 to
  landmark 9, in pixels: `atan2(dx, -dy)`. Hand pointing up = 0; pointing
  toward raw-image right = +π/2.
- `frame_w: int`, `frame_h: int`.

Pixel distances use `x * frame_w` and `y * frame_h` (aspect-correct).

### `Calibration`

Pydantic. Defaults:

- **Image region:**
  - `u_min=0.2`, `u_max=0.8`
  - `v_min=0.15`, `v_max=0.85`
- **Palm-width depth range:**
  - `palm_far=0.06` — hand far from the camera, maps to robot x = 0.30.
  - `palm_near=0.14` — hand near the camera, maps to robot x = 0.70.
- **Robot workspace:**
  - `x_range=(0.30, 0.70)`
  - `y_range=(-0.35, 0.35)`
  - `z_range=(0.02, 0.40)`
- **Orientation and axis flips:**
  - `yaw0=0.0`, `yaw_limit=π/2`
  - `invert_y=False`, `invert_z=False`

### `to_ee_target(msg, calib) -> Pose`

- **Mirror first:** `u' = 1 − u` (the user sees a mirror view).
- **Axes:**
  - robot y = lerp(`y_range.max` → `y_range.min`) over `u'` from `u_min` to
    `u_max`;
  - robot z = lerp over `(1 − v)`, so image up is robot up;
  - robot x = lerp over `palm_width` from `palm_far` to `palm_near`.
- **Clamp** every axis to the workspace.
- `invert_*` flips an axis. These get tuned in the first live session.
- **Orientation:** the gripper points down, wxyz `(0, 1, 0, 0)`,
  pre-multiplied by a world-z rotation of `clamp(yaw_rad − yaw0, ±yaw_limit)`.
  The result is a unit quaternion.

### `GripperLatch`

- Starts open (0).
- Closes when `pinch_ratio < 0.35`; opens when `pinch_ratio > 0.45`
  (hysteresis).
- Holds its state when `tracking_ok` is false.
- Method: `update(msg) -> int`.

### Relay `/ws/teleop?role=browser|sim`

- At most one connection per role. A second connection for the same role is
  closed with code 4409.
- Each browser message is validated as `HandPoseMsg`:
  - **Valid:** forwarded verbatim (JSON text) to the sim connection if there
    is one; otherwise dropped.
  - **Invalid:** the server replies to the browser with
    `{"type": "error", "detail": "<validation message>"}` and does not
    forward it.
- Whenever the sim connects or disconnects, the server sends the browser
  `{"type": "status", "sim_connected": bool}`. It also sends this once when
  the browser connects.
- `GET /teleop/status` returns
  `{"browser_connected": bool, "sim_connected": bool, "messages_forwarded": int}`.
- Relay state is module-level for this single-user local app.

### Browser throttle

- Send at most 30 messages per second, using the frame `timestamp`.
- When no hand is present, send `tracking_ok: false` at most 5 times per second.

### Cross-language contract fixture

`web/src/teleop/__fixtures__/hand_pose_msg.json` is a message produced by the
TS test from fixed landmarks. A Python test validates that same file with
`HandPoseMsg`.

## File Ownership

**Create:**

- `src/demo_pipeline/teleop.py`
- `tests/test_dp_teleop.py`
- `src/app/routers/teleop.py`
- `tests/test_teleop_relay.py`
- `web/src/teleop/handPoseMessage.ts`
- `web/src/teleop/handPoseMessage.test.ts`
- `web/src/teleop/teleopClient.ts`
- `web/src/teleop/__fixtures__/hand_pose_msg.json`

**Modify:** `src/app/main.py`, only to include the teleop router.

Touch nothing else. In particular, leave `web/src/hand/*`, the conftest file,
and the known-failing tests alone.

## Review Focus

1. **No hand in the frame.** `tracking_ok` is false; the latch holds; the
   relay forwards it.
2. **A hand at the image edge or too close to the camera.** The target is
   clamped inside the workspace and never NaN.
3. **Pinch hovering near the threshold.** Hysteresis gives no chatter: a
   0.38 → 0.42 → 0.38 sequence keeps the state.
4. **The sim worker isn't running.** The browser gets
   `sim_connected: false` and nothing errors.
5. **Non-square frames (1280×720).** `palm_width` and `yaw` are
   aspect-correct.

---

### Task 1: Pure mapping (`demo_pipeline.teleop`)

**Interfaces — Produces:**

- `HandPoseMsg`
- `Calibration`
- `to_ee_target(msg: HandPoseMsg, calib: Calibration = Calibration()) -> Pose`
- `class GripperLatch` with `update(msg: HandPoseMsg) -> int`

`Pose` comes from `demo_pipeline.schemas`. numpy and pydantic only.

- [ ] **Step 1:** Write the tests:
  - `test_center_of_region_maps_to_workspace_center`
  - `test_moving_hand_up_in_image_raises_z`
  - `test_bigger_palm_moves_forward_in_x`
  - `test_mirror_hand_moving_to_raw_image_right_moves_robot_toward_positive_y`.
    Raw `u` up → `u'` down → y up. Write this assertion explicitly.
  - `test_targets_are_clamped_and_finite_at_extremes` (Review Focus 2)
  - `test_yaw_rotates_about_world_z_and_is_clamped`
  - `test_quaternion_is_unit`
  - `test_latch_hysteresis_no_chatter` (Review Focus 3)
  - `test_latch_holds_when_tracking_lost` (Review Focus 1)
  - `test_msg_rejects_out_of_range_uv_and_nonpositive_palm_when_tracking`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. The full suite still shows 54 failed.
- [ ] **Step 5:** Commit `feat(demo_pipeline): teleop hand-to-EE mapping`.

### Task 2: Backend relay

**Interfaces:**

- Consumes: `HandPoseMsg`.
- Produces: the WebSocket `/ws/teleop` and `GET /teleop/status`, exactly as
  described above.

- [ ] **Step 1:** Write the tests, using `fastapi.testclient.TestClient` and
  `websocket_connect`. Follow the app fixture pattern in `tests/conftest.py`.
  - `test_browser_message_is_forwarded_to_sim`
  - `test_invalid_message_returns_error_and_is_not_forwarded`
  - `test_browser_gets_sim_status_on_connect_and_change` (Review Focus 4)
  - `test_second_connection_for_same_role_is_rejected_4409`
  - `test_status_endpoint_counts_forwarded_messages`
  - Reset the module-level relay state between tests.
- [ ] **Steps 2–4:** TDD cycle.
- [ ] **Step 5:** Commit `feat(app): teleop websocket relay`.

### Task 3: Browser message builder + client

**Interfaces:**

- Consumes: `TrackedHand` and `HandFrame` from `web/src/hand/contracts.ts`.
- Produces:
  - `toHandPoseMsg(hand: TrackedHand | null, frame: { timestamp: number; frameWidth: number; frameHeight: number }, last?: HandPoseMsg): HandPoseMsg`
  - `class TeleopClient`
    - `constructor(url: string)`
    - `push(frame: HandFrame): void` — picks the hand with
      `handedness === "Right"`, else the first hand, and applies the throttle.
    - `onStatus(cb)`
    - `close()`

- [ ] **Step 1:** Write the vitest tests, with fixed synthetic landmarks:
  - `palm_width aspect-correct on 1280x720` (Review Focus 5)
  - `pinch_ratio`
  - `yaw 0 for upright hand and +pi/2 for hand pointing raw-right`
  - `tracking_ok false with null hand keeps last values`
  - `throttle drops frames under 33 ms apart`
  - The test also writes `__fixtures__/hand_pose_msg.json`, or asserts that
    it equals a committed copy; choose one and note it.
- [ ] **Step 2:** Run `npm --prefix web test` → FAIL.
- [ ] **Step 3:** Implement. `TeleopClient` takes an injectable WebSocket
  constructor for tests.
- [ ] **Step 4:** Run → PASS. The existing frontend tests stay green.
- [ ] **Step 5:** Add `test_ts_fixture_validates_as_HandPoseMsg` to
  `tests/test_dp_teleop.py`. Run it, then commit
  `feat(web): teleop hand pose message + client`.

## Finish

Append a "Sprint 1b" section to `docs/superpowers/notes/2026-10-15-t4-status.md`:

- done (with test counts);
- decisions;
- anything the sim worker (T2) needs to know.

Commit it, then stop.
