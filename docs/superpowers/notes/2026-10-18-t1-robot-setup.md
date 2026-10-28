# T1 status: Robot setup page, `/robots/setup` (2026-10-18)

Branch `pm/web-setup`, worktree `C:\dev\pm-t1`, from `origin/perfect-then-multiply` at `e94d817`. Not pushed, merged
or rebased. Built against T2's contract `C:\dev\pm-t2\docs\design\byor-api.md`.

## What is built

| Commit | What |
|---|---|
| `3c8c5f6` | Contract types, client (T2's `/robots`, or recorded fixtures with the same flow), fixtures, zip reader, mesh-path rules, role model, report logic; urdf-loader installed |
| `4c2cb3c` | The page: upload, part tree (Data Tree style), role wiring (Node Connection style), issues, facts, mount; the route |
| `5ea1c93` | 3D preview: urdf-loader with real meshes from the zip, stick-figure fallback, teal highlight |
| `33458af` | Run → progress → report card (x/30, reach-map heatmap, failure reasons, joint limits, "design flaw found") |
| `d63403a` | Fixes from looking at the page in Chrome |

| `08272a3` | Fits the window: no page scroll and no scrolling panels at 1280x720, 1440x900, 1920x1080 (below) |

Tests: `npm --prefix web test` **50 files, 541 passed, 0 failed** (86 of them in `web/src/site/setup/`).
`uv run pytest -q`: 1490 passed, 18 skipped, 0 failed (run before the fit change, which touched no Python).
`tsc` clean; `npm --prefix web run build` passes. The main bundle is unchanged (457.7 kB). The page is a lazy
chunk, and the 3D view another (urdf-loader plus three's STL/DAE/OBJ loaders).

## Fits the window (the user's rule for every app page)

At 1280x720, 1440x900 and 1920x1080 the page has no page scrollbar and no scrolling panel:
`document.scrollingElement.scrollHeight <= innerHeight` (and the same for width), and no element's content is taller
than its box. Nothing hides overflow, so a misfit would show as a scrollbar rather than be clipped.

- **One screen, two views.** The header has "Parts and roles" | "Report card", Settings, "Set up another robot" and
  Run. Run switches to the report view: progress, then the card.
- **The tree has one row per link, with the joint that moves it** ("openarm_joint4 0° to 140° → openarm_link4"):
  12 rows for the OpenArm and the Franka instead of 23. Base and Hand land on the row's link, Arm and Gripper on
  its joint. Rows size themselves to the panel (`fitRows`: 22–32 px); a robot too big for that flows into columns.
- **The report card is three columns:** pick and place | reach map | the flaw and the joints at their limits. The
  limits table shows 5 joints (the flaw's first); the rest are in Settings.
- **Settings drawer** (a native modal `<dialog>`, slides over from the right): where the base sits, the robot facts
  with their sources and what data the page is on ("Robot"), and every source on the card plus every joint limit
  ("Report card sources"). Each tab fits a 720 px window too; the sources tab widens to 60 rem rather than scroll.
- **Below 1000 px wide or 600 px tall** the page stacks and scrolls as before (phones).

**How it was checked:** in Chrome, a same-origin iframe at each exact size (the window can't be resized), driven
through every state: upload, the roles for the OpenArm and the Franka, both drawer tabs, the run, and the card.
At all three sizes every state reported "fits", with rows at 31–32 px. Screenshots of the roles and report views at
each size were taken; the 1920x1080 one is drawn at 0.85 so it fits the screen, and its layout is still 1920x1080.

**For the lead (not mine to change):** the app-wide hand-control buttons (`HandToggle` and the calibration button,
fixed at the bottom right, from `App.tsx`) sit over the bottom-right corner of every app page. On this page they
cover the end of the joint-limits table at 1280x720. Moving them into the nav would free that corner on every page.

## On T2's real backend (the default; fixtures only as a fallback)

- **The page runs on T2's backend** (`http://localhost:8000`, `VITE_API_BASE_URL`). On load it tries `GET /robots`
  (1.5 s). The upload screen lists the robots the backend already has (newest first, up to 5, the rest counted), so
  one can be opened without re-uploading. A stored robot opens with the roles and mount of its last card; the
  contract has no `GET` for roles, so a robot that was never evaluated opens with the suggested roles.
- **Sample data only when the backend isn't running.** Then the list holds the two recorded samples, and a violet
  "Sample data" tag shows in the nav, the banner, the list, the robot line and the report card. The page looks for
  the backend every 10 s and switches to it while no robot is open. `?fixture=1` forces the samples.
- **A quick-check card** (n < 30, like T2's 2/2 Franka smoke card) says "the headline is only comparable at 30".
- **Run blocked:** a 409 from `POST /evaluate` leads with plain words (`sim_busy`: "The simulator is busy with
  another run…"), with T2's message under it.
- **Checked against T2's unmodified app** (uvicorn on :8000; `DATA_DIR` = a throwaway copy of their stored Franka
  robot; `ISAAC_PYTHON` pointed at a path that doesn't exist, so nothing could start Isaac; my dev server on 5173,
  the origin their CORS allows):
  - the list showed their robot (panda, 2/2, card ready); opening it showed their real 2/2 card with the
    quick-check note;
  - uploading T2's OpenArm zip went through for real: `POST /robots` 201 → parts → `PUT /roles` 200 →
    `POST /evaluate` **409 `sim_busy`**, because T4's sim worker was running and holds `C:\dev\gpu.lock`. That's
    the backend's own guard working; no Isaac run was started;
  - with the backend stopped, the page fell back to Sample data; started again, it switched to "Backend
    connected" by itself about 8 s later;
  - fit-the-window at 1280x720, 1440x900 and 1920x1080 in every live state (list, roles, the blocked run, the
    card, both drawer tabs) and in the sample states: all fit, no Sample tag in any live state.
- **Still not run:** a full 30-scene BYOR evaluate on the page. It needs the GPU (T4, then T3 held the lock all day)
  and T2's first full runs. `RESULTS_PLACEHOLDER` in T2's note is still empty.
- **Requests for T2:** a `GET /robots/{id}/roles` (or roles in `GET /robots/{id}`) would let a robot that was never
  evaluated reopen with its saved roles. Meshes served for the browser (e.g. `GET /robots/{id}/files/...`) would let
  a stored robot show solid in 3D; today it is a stick figure unless the zip is dropped again.

## How it works

- **Backend or sample data:** see above.
- **Upload:** drop or pick a `.urdf` or `.zip`. The zip is also read in the browser (`zip.ts`, the platform's
  `DecompressionStream`, no dependency) so the 3D view can load its meshes. `package://` and relative paths use the
  backend's rules (`urdfFiles.ts`).
- **Roles:** the suggested roles are pre-filled; outlined chips are the suggestion (with T2's `why` as a tooltip),
  solid chips are yours.
  - **Drag** a socket (Base / Arm / Hand / Gripper) onto a part. A cable follows and snaps to parts that can take
    the role; the others dim.
  - **Or click a socket, then click parts**: the keyboard and touch path. Escape finishes.
  - Local checks use the backend's codes (`arm_too_short`, `arm_not_chain`, `no_gripper`, ...); a 422 from
    `PUT /roles` has the last word.
- **3D view:** the part you hover, pick or drag onto glows teal, and stays lit after a drop. Every joint is shown at
  the middle of its range (where the backend's start-pose IK starts). The task's cube area is outlined on the
  floor. With no meshes, or none that load, it draws a capsule per link and a dot per joint and says why.
  `frameloop="demand"`, DPR ≤ 1.5.
- **Run:** `PUT /roles` → `POST /evaluate {seed0: 100, n: 30}` → polls `GET /report` every 2 s (one retry on
  connection resets, memory "localhost-http-resets"). A re-uploaded robot shows its last card or picks up its run.
- **"Design flaw found"** (`report.ts`, the one rule this page adds): on a robot that isn't ready, the arm joint
  with the narrowest range among those at a limit in ≥ 20% of the scenes. On the recorded OpenArm it names
  `openarm_joint6`, −45° to +45°, at a limit in 17 of 30 scenes. That matches T2's root cause found by hand
  (`docs/superpowers/notes/2026-10-15-t2-status.md`, "Root cause of the low yield").

## The fixtures (every number has a source)

`web/src/site/setup/fixtures/README.md` has the details. In short:

- **Parts, roles, upload and 422 responses:** real responses from T2's `/robots` routes (run in-process, a
  throwaway store) for T2's test uploads in `C:\dev\pm-t2\data\byor_inputs\`.
- **Report cards:** built with T2's own `sim_worker.byor_report` code: `reach_map` on the URDF and
  `joint_limit_hits` on the recorded joint positions. The rows come from the **built-in** robots' recorded runs,
  not a BYOR run:
  - **Franka 30/30:** `data/yield/clean_franka_s4.json` (t2-status.md:639);
  - **OpenArm 0/30:** unreachable 30, collision 13, not_in_bin 10, dropped 8 (`data/multiply_openarm/yield.json`,
    t2-status.md:311). Reach 51% in all five poses.
- Each card's `provenance.fixture` says this, and the page lists it under "Where every number comes from".
- Rebuild: `web/scripts/byor_fixtures/gen_parts.py`, then `gen_reports.py`, both run from `C:\dev\pm-t2`.

## Verified

- **In Chrome (dev server):**
  - both recorded robots;
  - T2's real `franka_description.zip` (22/22 meshes) and `openarm_unimanual.zip` (10/10 collision meshes);
  - drag-to-role with the 3D highlight;
  - the run and both cards;
  - "Effects off" stops the two animations.
- **Phone width:** no horizontal scroll at 375 px through the whole flow, checked in a 390 px iframe through the
  DOM (the window couldn't be resized).
- **Against T2's real backend** (their app, unmodified, on :8001 with a throwaway store and a report runner that
  refuses):
  - upload → parts → 11 suggested-role chips → `PUT /roles` 200 (`roles.json` written) → `POST /evaluate` →
    polling;
  - the job's failure message shown on the page.

## Not verified

- **A real evaluate run** (Isaac): T3 held `C:\dev\gpu.lock` all session (Isaac dataset regen, then training), so I
  didn't start one. The polling and card code paths are covered by the fixture run and the tests.
- **A real 422 from the backend on the page:** the local checks catch the same cases first. The 422 handling is
  unit-tested with a mocked response.
- **Touch dragging on a real phone.**

## Notes for others

- **Lead (App.tsx):** two lines, both inside the existing patterns: a `lazy(...)` import next to the other SANT
  pages, and one `<Route path="/robots/setup" …>` inside the SantRoot block.
- **T6 (My robots):** the "Add your robot" cartridge can link to `/robots/setup`. The page's nav links to `/robots`.
- **T5 (`web/src/sant/`):** I forked nothing. Two requests:
  1. `.sant-app__head` and `.sant-app__actions` don't wrap on phones. I wrap them on this page only with a scoped
     `:has()` rule in `setup.css`; a global fix in `sant.css` would let me delete it.
  2. An optional `className` on `AppShell` would make page-scoped rules like that one simpler.
- **T2 (backend):**
  - CORS allows only `http://localhost:5173`. That's fine for the normal dev server; other ports need adding.
  - The page sends `mount.pos` with the roles (default `[0, 0, 0]`, the recorded OpenArm's `[0.20, 0, 0.25]`).
  - When the first full BYOR runs land, swap them into the fixtures (or just run the backend).
- **New dependency:** `urdf-loader` 0.13.1 (Apache-2.0), approved by the user, added to `THIRD_PARTY_NOTICES.md`.
