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

Tests: `npm --prefix web test` **47 files, 523 passed, 0 failed** (68 of them in `web/src/site/setup/`).
`uv run pytest -q`: 1490 passed, 18 skipped, 0 failed. `tsc` clean; `npm --prefix web run build` passes. The main bundle is unchanged (457.7 kB). The page is a lazy
chunk (77 kB), and the 3D view another (77 kB: urdf-loader plus three's STL/DAE/OBJ loaders).

## How it works

- **Backend or fixtures.** On load the page tries `GET /robots` (1.5 s). If that answers, it is "Backend connected".
  If not, it runs on recorded data and says so in a banner. `?fixture=1` forces the fixtures. The OpenArm and
  Franka buttons always open the recorded robots.
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
