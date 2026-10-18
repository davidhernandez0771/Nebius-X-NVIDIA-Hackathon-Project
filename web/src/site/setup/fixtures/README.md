# Robot setup fixtures

What `/robots/setup` shows when T2's backend (`/robots`, contract `C:\dev\pm-t2\docs\design\byor-api.md`) is not
answering, or with `?fixture=1`. Built 2026-10-18 by `web/scripts/byor_fixtures/` (run in `C:\dev\pm-t2`, read-only).

| File | What it is |
|---|---|
| `*.upload.json`, `*.parts.json`, `*.roles.json`, `*.roles422.json` | Real responses from T2's `/robots` routes for T2's test uploads (`data/byor_inputs/`): the Franka's `franka_description.zip` and the OpenArm exported from Isaac's `openarm_unimanual.usd`. The OpenArm roles use the built-in mount `[0.20, 0, 0.25]`. `roles422` is the answer to a 4-joint arm. |
| `franka.report.json` | **30/30.** Rows from `data/yield/clean_franka_s4.json` (the clean-expert Franka multiply, seeds 100–129; `docs/superpowers/notes/2026-10-15-t2-status.md:639`). |
| `openarm.report.json` | **0/30**, reasons unreachable 30, collision 13, not_in_bin 10, dropped 8. Rows from `data/multiply_openarm/yield.json` (`t2-status.md:311`). |

**How the cards are made.** T2's own card code (`sim_worker.byor_report`): `reach_map` on the uploaded URDF and
`joint_limit_hits` on the recorded `steps.npz` joint positions (columns 0–6 are joints 1–7: their ranges match the
URDF limits), assembled by `build_report`. The pick-and-place rows are the **built-in** robots' runs, not a BYOR run
of the uploaded URDF; each card's `provenance.fixture` says so. When T2's first full BYOR runs land, replace these.
