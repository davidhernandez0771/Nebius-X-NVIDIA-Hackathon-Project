# Sprint 9, T1: content spec and the Review page (`pm/web-review`)

Branched from `origin/perfect-then-multiply` at `3e817f1` (after PRs #36 and #38).

## Task 1: content spec (`deb5dfb`)

- `docs/design/content-spec.md` is rewritten for the new pitch (webcam demo → physics-checked, fixed,
  multiplied, labeled robot data). It was not on the base: the sprint 8 spec lived on `pm/t1-core`, which
  was never merged. `docs/design/logo-brief.md` came along from that branch because the spec cites it.
- **For T5 / T6 / T3 / T7:** each page's job, sections, copy and numbers are in §3 (Landing beats 0–6),
  §4 (Results), §5 (My robots + setup), §6 (Record), §7 (Review). Every number has an ID in §1 with
  `note:line`.
- **New facts:** R16–R18 (300 copies: 16/40, p = 0.0012 vs raw, p = 1.0 vs 100 copies), B1–B5 (robots:
  OpenArm 0/30 wrist range, Rizon 9/30 gripper slip), L1–L3 (Nemotron's label role: **not built, not
  measured**), V5–V6 (the Review example's own values).
- **Rules worth reading first:** §0 rules 2, 5, 7 and 8 (scripted, not human, sources; the 300-copy plateau;
  Nemotron's two tenses; "Bring your robot" is a preview).
- Open decisions for the user are in §10.

## Task 2: Review at `/review2` (`7652b8c`)

- **Files:** `web/src/site/review/**`, one lazy import and one route line in `web/src/App.tsx`, and
  `scripts/export_review_example.py`.
- **How to view it:** `npm --prefix web run dev`, then open `http://localhost:5173/review2`. With no backend
  running, it shows the recorded example (`s1_0002` → `s1_0002_rules`, synthetic, labelled on the page).
  With the backend running, the demo list appears on the left; `?id=<demo>` opens one, and
  `?id=example` opens the example.
- **What is real:** every value on the page comes from the demo's diagnosis, its verification and its
  frames. The detection boxes find the cube from its pixels in each frame. "Matches your request" always
  says "not checked yet" (L3).
- **Live demos:** the backend serves no frames or passport yet, so a live demo's scan draws the
  end-effector path, and Physics reads "not served by this backend yet". A human demo gets a
  **Perfect this demo** box that reuses `pm/jobs.ts`.

## Checks

- `npm --prefix web test`: 40 files, 479 passed, 0 failed.
- `npm --prefix web run build`: OK. The only warning is the existing r3f chunk-size one.
- `uv run pytest -q`: 1490 passed, 18 skipped, 0 failed.
- Browser (Chrome, desktop and a 390 px iframe): the scan, the detection boxes, the perfected
  "IN BIN · VERIFIED" end state, the timeline, the list and the verdict all render. No horizontal scroll
  from the page.
  - Chrome throttled the automation window to about 1–3 fps, so the morph was not watched at full
    speed. A draw takes about 0.3 ms.

## For T5 (`web/src/sant/**`)

- **The app pill nav overflows at 390 px** with four links (Robots, Record, Review, Dataset): `nav.sant-pill`
  ends at 405 px in a 375 px viewport. Please let it scroll or wrap on small screens.
