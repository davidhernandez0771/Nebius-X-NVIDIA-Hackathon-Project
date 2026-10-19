# The robot twin: a 3D Franka for /record, live or replayed

Branch `pm/robot-twin`, from `pm/web-record`. Nothing pushed, merged or rebased. T6's page layout is not
touched: the twin is a component plus the hooks that feed it, and this note says how to mount it.

| Commit | What |
|---|---|
| `08ba73d` | Live data. The sink sends `sim_twin_scene` (robot, joint names, base, bin) once per connection and `sim_twin` (q, gripper sent, cube pose) at most 30 a second (25 at 50 Hz steps). It skips frames when nothing moved and reads nothing while no page watches. The relay serves `/ws/teleop?role=twin`, which accepts many read-only watchers, keeps the last of each message for late joiners, and leaves the browser socket and `/teleop/status` as they were. |
| `9b8bf63` | Replay data. `GET /twin/episodes` lists demos with a recorded episode, newest first, with `verified=true` for sim-verified copies. `GET /twin/episodes/{id}` returns named joints, the gripper, the cube's path, the bin and the base, rounded to 4 decimals. |
| `7d9e540` | The 3D view: `web/src/twin/` plus the vendored Franka (`web/public/robots/franka_description/`, Apache-2.0, collision meshes only, 140 KB) and `urdf-loader` 0.13.1. |
| `c506d1a` | Camera raised and moved to the robot's right, after looking at a replay. Straight behind the base, the arm hid the grasp and the bin. |

## How T6 mounts it

The twin replaces the SVG `<Twin live={live} />` in the "workspace" pane (`web/src/site/record/RecordConsole.tsx`,
about line 304). It fills whatever box it is given (`.twin3d` is `width/height: 100%`), so the pane needs a
height. The `/record` grid already gives it one.

```tsx
import { RobotTwin, useLiveTwin, useReplayTwin, useVerifiedCopies } from "../../twin";

// Live when a sim is connected; otherwise a replay of the newest verified copy.
const sim = useLiveTwin();                       // its own read-only socket: no clash with the page's
const copies = useVerifiedCopies("franka");
const replay = useReplayTwin(sim.status === "live" ? null : copies.copies[0]?.id ?? null);
const shown = sim.status === "live" ? sim : { ...replay.twin, base: replay.base };

<RobotTwin {...shown} caption={sim.status === "live" ? "live from the sim" : "replay · verified copy"} />
```

- **Props:** `joints` (name → rad/m), `gripper` (0/1/null), `cube` and `bin` (`{pos, quat: [w,x,y,z]}`, sim
  frame), `base`, `interactive` (drag/zoom, default on), `caption`, `className`. Null parts are left out; with
  no joints the robot stands in Isaac's start pose.
- **Lazy:** three.js and urdf-loader load when the twin mounts, not with the page.
- **Light on the GPU:** `frameloop="demand"` renders only when a prop changes or the view is turned. The pixel
  ratio is capped at 1.5 and the canvas asks for `powerPreference: "low-power"`.
- **Reduced motion** (the OS setting or SANT's "Effects off"): a replay shows its first step and waits for
  `replay.play()`.
- **Name clash:** `RecordConsole` already has a `live` (the HUD's state). Call the twin's `sim` or `liveTwin`.
- **If the meshes fail to load:** it draws a stick figure and says so in the caption.

To look at it on its own: `web/twin-preview.html` with `web/src/twinPreview.tsx`. Both are untracked and
temporary. Run the backend with `DATA_DIR=C:\dev\pm-t4\data` (49 verified copies), then open
`http://localhost:5173/twin-preview.html?mode=replay&w=720&h=460`. Other modes: `still`, `live`, `all`. Delete
both files when they are no longer needed.

## Status (2026-10-18, after the PC crash)

The crash came mid-task, while the dev servers were starting for the first look. The uncommitted work was
intact. It was checked, committed (`7d9e540`), looked at, and the camera fixed (`c506d1a`).

**Verified:**
- `npm --prefix web test`: 66 files, 781 passed, 0 failed. `npm --prefix web run build`: OK. The only warning is
  the three.js chunk being over 500 kB, which was there before this branch.
- `uv run pytest`: 1552 passed, 18 skipped, 0 failed. The 18 twin backend tests are included.
- The URDF puts the tool where Isaac measured it, within 0.1 mm, on four rows of a real recorded episode
  (`model.test.ts`).
- **Seen in Chrome:** a replay of `s1_0004_nemotron_m104003` (605 steps). The arm carries the cube into the amber
  bin, and the hand turns needle orange while closed. The start pose in a narrow pane (340×460) steps back so
  the table fits. No console errors.

**Not verified:**
- **Live mode with real Isaac.** No GPU runs in this session. It is covered by unit tests and by `relay_loop`
  through the real relay (at most 30 frames a second), but nobody has watched it move with the sink running.
  Check it at the next live test: open the twin while recording and the pose should follow the robot.
- **On `/record` itself.** Mounting it there is T6's job.

**Open items:**
- The collision meshes are coarse: a matte, smooth-edged robot. The visual meshes (10.5 MB of `.dae`) were left
  out on purpose.
- Git stores the URDF and `package.xml` with LF line endings (the zip had CRLF). The content is otherwise
  unchanged, as the README says.
- Replay knows only the Franka's joint order (`JOINT_NAMES` in `src/app/routers/twin.py`). Recordings don't
  store the cube's rotation, so a replayed cube keeps its start orientation.
