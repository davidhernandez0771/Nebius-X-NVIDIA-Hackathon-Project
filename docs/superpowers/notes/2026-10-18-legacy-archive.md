# Archive the old site under /legacy (2026-10-18)

- **Branch:** `pm/remove-room-organizer`. Not pushed, merged or rebased.
- **Base:** `pm/web-landing` at `275e958` (T5's `/site` landing), by the user's choice, since `/site`
  exists only there. `pm/web-landing` is a local branch with no copy on origin, so it must be pushed (or
  merged) before this branch's PR can open. Until T5's PR merges, this PR also shows T5's 5 commits.
- **The plan changed mid-task:** first "remove the room-organizer leftovers" (cleanup audit §1, on
  `pm/cleanup-audit`), then "archive the old site so it still runs as a backup". **Nothing was deleted.**
- **Backup tag (local only, not pushed):** `archive/old-site-2026-10-18` → `e94d817`
  (`origin/perfect-then-multiply` before this branch).

## Commits

| Commit | What |
|---|---|
| `b8c4fdd` | `/`, `/welcome` and the catch-all go to `/site`. Route test added |
| `24c2927` | `ScanViewerHandle` (the two-hand zoom contract) moved into `hand/integration/activeScanViewer.ts` |
| `dcc3942` | DashboardShell reduced to the four pm links (from the delete plan) |
| `fb66cb9` | **Revert of `dcc3942`**: the legacy dashboard needs its room links |
| `8c8fe3f` | The old frontend moved into `web/src/legacy/` (`git mv` and import paths only) |
| `7a47349` | The old site served under `/legacy`; `/pm/*` redirects to `/legacy/pm/*`; legacy links prefixed |
| `f1ac39e` | Hand control, gear and hand cursor only on `/legacy` routes |

After every commit: `npm --prefix web test`, `npm --prefix web run build` and `uv run pytest -q`, all 0
failed. At `f1ac39e`: web **513 passed** (41 files), build OK, pytest **1490 passed, 18 skipped**. The base
had web 495 and the same pytest numbers; the 18 new web tests are in `web/src/App.test.tsx`.

## Routes

| URL | What |
|---|---|
| `/` | → `/site` (the new landing) |
| `/welcome`, any unknown URL | → `/site` |
| `/legacy` | The old 3D scrolling intro (the old `/` Landing) |
| `/legacy/enter` | The old Entry ("ROOM READY"), which goes on to `/legacy/home` |
| `/legacy/home`, `room`, `add/scan`, `add/photo`, `review`, `inventory`, `organize`, `chat`, `settings` | The old dashboard pages, inside DashboardShell (top bar and icon rail) |
| `/legacy/pm/record`, `pm/review`, `pm/dataset`, `pm/results` | The old Perfect-then-multiply pages, same shell |
| `/pm/*` | → `/legacy/pm/*`, keeping the query and the hash (`/pm/review?id=…` still works). The live test's `/pm/record` lands on `/legacy/pm/record` |
| `/home`, `/room`, `/enter`, … (old unprefixed room URLs) | Not redirected: they fall to the catch-all, `/site`. Only `/pm/*` was asked for |

- Every route link inside `web/src/legacy/` now starts with `/legacy`, including the rail, Landing's
  "Enter" and "Skip to app", Entry's hand-off and the pm pages' "Review …" links. Backend paths
  (`/api/...`, and pm/api's `/demos`, `/results`) are unchanged.
- **The new site's links to `/pm/record`** (Results "Try it", `/review2`, on the sprint 9 branches) go
  through the redirect to the legacy Record page.
- **Hand control:** the Hand control button, the gear (calibration) and the hand cursor overlay render
  only on `/legacy` and `/legacy/...`. On every other route they are hidden, and a camera left on is
  turned off on leaving `/legacy` (before, they were hidden only on the new site's pages).

## What moved (54 files, `git mv`)

Into `web/src/legacy/`, same names:

- **`pages/`:** AddPhoto, AddScan, Chat, Entry, Home, Inventory, Landing, Organize, Review, RoomView, Settings.
- **`components/`:** the whole folder: ChatBar, DashboardShell, DotMeter, EmptyState, GlassCard, Icon,
  IconTile, ItemCard, SpendPill, StatusPill, ThreeWaySwitch, Toggle, Zones, `index.ts`.
- **`three/`:** fonts, labels, LeaderLayer, Reveal, roomModel, RoomScene, ScanViewer, sceneMath,
  scrollStore, StaticRoom, `landing.css`, `scanviewer.css`.
- **`api/`:** `errors.ts`, `usage.ts`, plus a new `legacy/api/client.ts` holding the room fetch helpers
  (`api`, `uploadFile`, `uploadFiles`) split out of `api/client.ts`.
- **`pm/`:** `common.tsx`, `testing.tsx`, `pm.css`, `dataset/DatasetPage(.test).tsx`,
  `record/RecordPage(.test).tsx`, `record/HandControlPanel.tsx`, `results/ResultsPage(.test).tsx`,
  `review/{ReviewPage,ReviewPage.test,DemoStrip,PerfectPanel,SpeedChart}.tsx`.

## What stayed where it was (shared with the new site or the hand code)

| Path | Why |
|---|---|
| `web/src/pm/{api,jobs,types}.ts`, `pm/record/{framing,recordLink}.ts`, `pm/review/timeline.ts`, `pm/dataset/summary.ts`, `pm/results/results.ts`, `pm/mocks/`, and their tests | Data and logic, not UI. The sprint 9 pages import `pm/api`, `pm/jobs`, `pm/types` and `pm/record/framing` (`pm/web-review`, `pm/web-record-hud`) |
| `web/src/api/client.ts` | Now only `apiUrl` and the base URL; `pm/api.ts` uses it |
| `web/src/three/capability.ts` | The hand overlay and the pinch sheet use it, and so does `pm/live-8`'s new `ResetGestureRing` |
| `web/src/styles.css`, `web/src/tokens.css` | Global: `main.tsx` loads them for every page, and the hand overlay and the new site are styled on top of them. Moving them would change nothing at runtime |
| `web/src/hand/`, `web/src/teleop/`, `web/src/landing/pinchSheet/` | Shared or T4's. Only one import line changed in `hand/` (`HandToggle` now takes `Icon` from `legacy/components`), plus the `ScanViewerHandle` move |
| `web/public/models/placeholder-room.glb`, `web/scripts/make-placeholder-glb.py` | Served by URL to the legacy ScanViewer |
| **The whole backend** (see the next section) | The legacy pages call it |

## Removable later (not removed; the user decides)

**Frontend**, once the backup is no longer needed:
- `web/src/legacy/**`, plus in `App.tsx` the `/legacy` routes, `ToLegacy`, the `/pm/*` redirect and the
  hand-control mounting (or move the hand controls to wherever the new Record page needs them).
- `HandToggle`'s `Icon` import (move `Icon` back out first, or replace it).
- The room-only blocks in `web/src/styles.css`: `.item-card`, `.three-way`, `.toggle`, `.dot-meter`,
  `.chat-bar`, and the page sections from "Home rooms / RoomView locations" to "Chat" (lines ~761–995).
- The two-hand zoom path in `hand/integration/useHandPointer.ts` and `activeScanViewer.ts`, which only
  the legacy ScanViewer registers with (T4 owns `hand/`).
- `web/public/models/placeholder-room.glb` and `web/scripts/make-placeholder-glb.py`.
- **Keep `@react-three/drei`:** `pm/web-robots`' `/robots` shelf imports it (`PerformanceMonitor`).
- `web/package.json` `"name": "room-assistant-web"` (rename; not done here).

**Backend (kept on purpose: the legacy pages need it).** All room routes are in `src/app/main.py:32-39`:

| Router | Legacy pages that call it |
|---|---|
| `src/app/routers/rooms.py` | Home, RoomView, AddScan, Organize, Chat, Inventory (`/api/rooms...`) |
| `src/app/routers/scans.py` | AddScan, RoomView (`/api/scans...`) |
| `src/app/routers/phone_scans.py` | AddScan (`/api/rooms/{id}/phone-scans`, `/api/phone-scans/{id}/status`) |
| `src/app/routers/photos.py` | AddPhoto (`/api/photos...`) |
| `src/app/routers/candidates.py` | Review (`/api/photos/{id}/candidates`, `/api/candidates/{id}/review`) |
| `src/app/routers/items.py` | Inventory (`/api/items/{id}`) |
| `src/app/routers/organize.py` | Organize (`/api/organize`) |
| `src/app/routers/chat.py` | Chat (`/api/chat`) |

Removable together with those routers, in the cleanup audit's order (§1c–1e):
- `src/app/{models,schemas,db,storage,config}.py`, and `init_db()` on startup (`main.py`);
- `src/app/ai/{commands,query,organize,vision,reali3}.py`;
- the room tests `tests/test_{app_api,chat_actions,scan_retrieval,backend_validation,chat_commands,organize_validation,phone_scans,ai_parsing,command_parse,vision_parse}.py`,
  and the room helpers in `tests/conftest.py` (keep its `api` fixture and the network guard);
- `scripts/{command_eval,vision_debug,vision_eval}.py` and `docs/VISION_EVAL.md`;
- the `sqlalchemy` dependency. **Keep `python-multipart`:** `pm/byor-backend`'s `POST /robots` takes an
  `UploadFile`;
- the app title "Room assistant API" (`main.py:23`), a rename.

## Merging with the other branches

- **`web/src/App.tsx` will conflict with every sprint 9 branch and `pm/live-8`.** Each adds a route line;
  keep theirs and keep this branch's `/legacy` block.
- **`pm/live-8` (T4, the live test) edits files this branch moved.**
  - Its changes to `pm/record/RecordPage.tsx`, `RecordPage.test.tsx`, `HandControlPanel.tsx` and `pm.css`
    should follow the renames into `legacy/pm/...`. The import block of `RecordPage.tsx` will conflict,
    because both sides changed those lines.
  - Its new files land in `pm/`: `pm/record/{ResetGestureRing,ResetGestureRing.test,artCue,breakthroughCue}.*`
    and `pm/handArt/`.
  - **After that merge:** move them to `legacy/pm/record/` and `legacy/pm/handArt/`, or fix
    RecordPage's `./ResetGestureRing`, `./artCue`, `./breakthroughCue` and `../handArt` imports. Then
    re-add its `/pm/hand-art` route as `hand-art` inside the `/legacy` block, or `/pm/hand-art` will
    redirect to a `/legacy/pm/hand-art` that doesn't exist and end on `/site`.
- **The sprint 9 branches' `pm/` imports** (`api`, `jobs`, `types`, `record/framing`) still resolve,
  because those files did not move.
- `docs/RUNBOOK.md` and the README still say `/pm/record`; that keeps working through the redirect.

## Not checked

- The pages were not opened in a browser. The route tests render `App` in jsdom with the pages and the
  hand cursor stubbed, and the build type-checks every moved import; the real 3D intro and the live
  Record page were not run here (no GPU).
