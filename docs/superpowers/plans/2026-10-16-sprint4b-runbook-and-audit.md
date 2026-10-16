# Sprint 4b (T6, T7): One-Click Run + Pre-Publication Audit

> Sprint 3's Global Constraints apply: ownership, 0 failed, no
> push/merge/rebase, and a progress entry after every task.
> Required skills: `test-driven-development` for code, `systematic-debugging`,
> `verification-before-completion`.

**Start point:** `afef201`. T1, T2, T3, T4 and T5 are running other work;
never edit their files.

**Isaac:** T6 and T7 never launch Isaac. T2 owns the sim worker on port 8770,
and T3 may run its own eval.

---

## T6 (`C:\dev\pm-t6`, branch `pm/t6-runbook`, venv `C:\venvs\pm-t6`): one-click run

**Owns (all new):**

- `scripts/launch/**`
- `docs/RUNBOOK.md`
- `tests/test_launch_*.py`

### 1. `scripts/launch/status.ps1` (read-only health check)

Prints one line per service, with OK, DOWN or BUSY:

| Service | Check |
|---|---|
| backend | `http://127.0.0.1:8000/api/health` |
| web | `http://127.0.0.1:5173` |
| sim worker | `http://127.0.0.1:8770/health`, including `busy` |
| policy server | `http://127.0.0.1:8765/health` |
| teleop relay | `/teleop/status` |

Also: GPU memory used/total, and whether Isaac python processes are running.
Exit code 0 if all the required services are OK.

### 2. `scripts/launch/start.ps1 [-Sim] [-Policy <checkpoint>] [-Web] [-Backend]`

- Starts each service in its own window or background job, with the right
  venv and env vars. Each command comes from the existing notes and README.
  Do not invent flags; read the notes.
- Waits for its health check with a timeout.
- Refuses to start a second sim worker if port 8770 is already taken.
- Writes logs to `data/logs/<service>.log`.

`scripts/launch/stop.ps1` stops ONLY the processes `start.ps1` started,
using the PID file at `data/logs/pids.json`.

### 3. Python helper `scripts/launch/health.py` (stdlib)

Shared health-check logic; the `.ps1` scripts may call it.

- Unit tests with a local fake HTTP server on port 0.
- No live start of Isaac or the sim worker in tests.
- Live checks: only `status.ps1` against what is already running.

### 4. `docs/RUNBOOK.md`: exactly how to run everything

**Fresh Windows setup.** Use the commands from
`docs/superpowers/notes/*` and README, verified by reading them, not
invented:

- driver;
- Isaac Sim 6.2 pip + Isaac Lab `release/3.0.0`;
- venvs outside OneDrive with `UV_LINK_MODE=copy`;
- the LeRobot venv;
- npm.

**Then:**

- start/stop/status;
- record a demo with your hand: Record page → sim teleop sink;
- perfect a demo;
- run the experiment;
- train and evaluate;
- build the results and charts;
- troubleshooting: every gotcha the notes recorded.

Each step lists its expected output, and every unverified step is marked.

---

## T7 (`C:\dev\pm-t7`, branch `pm/t7-audit`, venv `C:\venvs\pm-t7`): audit before going public

**Output:** `docs/superpowers/notes/2026-10-16-prepublish-audit.md`, with a
findings table (severity, file/commit, evidence, recommended fix).

**Safe fixes only, in files nobody else owns:**

- `.gitignore` additions;
- a new `THIRD_PARTY_NOTICES.md`;
- a new `.gitattributes` entry if it is needed for binary files.

Never rewrite history, never delete tracked files, never touch `.env`
contents (only check that it is ignored), and never print secret values:
report their location and length only.

### 1. Secrets across ALL history

Search every commit on all local branches (`git log -p --all`) and the
working tree for:

- API keys and tokens: Nebius key patterns, `sk-`, `ghp_`, `eyJ` JWTs, AWS
  keys;
- `.env` files ever committed;
- passwords;
- private URLs.

Also check that `usage_log.jsonl`, `data/`, `.env` and the uploads are
ignored and never committed.

### 2. Size and binaries

- the largest files in history and in the working tree;
- anything > 5 MB;
- model files, datasets, PNG frame dumps or videos tracked by accident.

### 3. Licenses and attribution

The repo is MIT. List every third-party component the code or repo uses or
vendors, with its license and whether attribution is needed:

- NVIDIA Isaac Sim/Lab and their assets (robot USDs are downloaded at
  runtime, not committed? verify);
- LeRobot (Apache-2.0);
- MediaPipe + its model file (gitignored? verify);
- obra/superpowers skills (MIT) and anthropics plugin skills (Apache-2.0) in
  `.claude/skills`;
- npm/pip dependencies (top-level);
- Nemotron model license terms for API use.

Write `THIRD_PARTY_NOTICES.md`.

### 4. Hackathon compliance checklist

Check against the official rules (quoted in the spec and notes):

- the public repo needs an OSI license visible in the About section;
- a README with setup/run;
- the Nemotron/Token Factory usage is highlighted;
- the submission-period dates;
- the "existed before the submission period" explanation. Check the date of
  the repo's first commit against Aug 26, 2026.

Flag each item as done or missing.

### 5. Push readiness report

List exactly which branch to push, what the default branch should be on
GitHub, and what must happen first. The human decides and pushes; T7 does
not push.
