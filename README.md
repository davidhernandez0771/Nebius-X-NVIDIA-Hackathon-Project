# SANT

Submission for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/) (deadline Oct 30, 2026).

A room organizer: photograph a shelf or drawer, a vision model proposes what's
in it, you confirm each item, Nemotron suggests how to arrange your inventory,
and a chat bar lets you drive it in plain language.

**Design rule: the AI only proposes; you or the backend decide.** A vision
result never becomes inventory until you sort it, and chat text is parsed into
an action that the backend validates before anything happens.

**Status:** working end to end. The backend API, database and every dashboard
screen are wired together. The vision, organize and chat-command prompts have
been run against the real Token Factory API (results in
[`docs/VISION_EVAL.md`](docs/VISION_EVAL.md)), all chat actions are validated by
the backend, and uploaded GLB room scans render in a 3D viewer. There is a
scroll-driven 3D landing page (the front door, `/`) and an animated entry scene
(`/enter`). See [Known limitations](#known-limitations) for what is not built,
and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design.

## Prerequisites

- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- [Node.js](https://nodejs.org/) 20+ and npm
- A Nebius Token Factory API key from [tokenfactory.nebius.com](https://tokenfactory.nebius.com)

## Setup

```bash
git clone https://github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project.git
cd Nebius-X-NVIDIA-Hackathon-Project

# Backend dependencies, including pytest (dev group)
uv sync --all-extras

# API key
cp .env.example .env        # then paste your key into NEBIUS_API_KEY

# Frontend dependencies
cd web && npm install && cd ..
```

`.env` is git-ignored; never commit it. If `uv sync` fails with
`invalid peer certificate: UnknownIssuer` (common behind corporate or antivirus
TLS proxies), use `uv sync --all-extras --system-certs`.

## Run it

Check the API key first. This makes one tiny Nemotron call (about $0.000003):

```bash
uv run python scripts/smoke_test.py
```

It should end with `SMOKE TEST PASSED`.

Then start the two servers in separate terminals, both from the repo root.

**Backend** (http://localhost:8000):

```bash
uv run uvicorn app.main:app --reload --app-dir src
```

- `GET /api/health` returns `{"status":"ok"}`.
- Interactive API docs are at http://localhost:8000/docs.
- The SQLite database `app.db` and the `uploads/` folder are created on first
  run and are git-ignored.

**Frontend** (http://localhost:5173):

```bash
cd web
npm run dev
```

The frontend calls the backend at `http://localhost:8000`; set
`VITE_API_BASE_URL` (for example in `web/.env`) to point it elsewhere. The
backend only allows CORS from `http://localhost:5173`.

`npm run build` type-checks and produces a production bundle in `web/dist/`.

### What to open

| URL | What it is |
|---|---|
| http://localhost:5173/ | Scroll-driven 3D landing page (the front door) |
| http://localhost:5173/enter | Short animated entry scene (skip with Esc) |
| http://localhost:5173/home | The dashboard: create a room, add locations, upload a `.glb` scan and photos, review, organize, chat |

Use a current Chrome, Safari or Edge with hardware acceleration on; the 3D
pages need WebGL and fall back to a static version without it (or with reduced
motion). Add `?static` to the landing URL (`/?static`) to preview the fallback.

To try the scan viewer, export a room as `.glb` from a LiDAR app such as
Polycam or Scaniverse and upload it from a room's "Upload a room scan" link.

### Cost

Uploading a photo and pressing Analyze, or using Organize or Chat, makes a
real, billed Token Factory call (well under a cent each). Every call
appends its token counts and estimated cost to the file named by
`USAGE_LOG_PATH` (default `usage_log.jsonl`). If you work in several git
worktrees, point them all at one shared file (see `.env.example`) so the $25
budget is tracked in one place. The log is git-ignored; check the Token Factory
console for actual billing.

## Run the tests

```bash
uv run pytest -q
```

All AI calls are mocked; the tests never touch the network or spend money.

## Other scripts

```bash
uv run python scripts/ask.py "Explain mixture-of-experts in one paragraph"
uv run python scripts/ask.py --tier super "..."    # nano (default), super, ultra
uv run python scripts/vision_debug.py photo.jpg    # raw vision output for one image
```

`ask.py` with no question starts an interactive prompt. `--think` lets
Nemotron reason first, which costs more output tokens. `vision_debug.py` also
takes `--tier glm-flash`; it sends the image to a vision model, so it is billed.

## Models

Text inference is NVIDIA **Nemotron 3** on Nebius Token Factory
(`https://api.tokenfactory.nebius.com/v1/`, OpenAI-compatible), routed through
three tiers in [`src/nebius_llm/config.py`](src/nebius_llm/config.py):

| Tier | Model | Used for |
|---|---|---|
| `nano` (default) | `nvidia/Nemotron-3_5-Lightning` | everything unless there's a reason not to |
| `super` | `nvidia/nemotron-3-super-120b-a12b` | harder tasks that nano gets wrong |
| `ultra` | `nvidia/Nemotron-3-Ultra-550b-a55b` | heavy reasoning, used sparingly |

Photo itemization uses a separate vision tier list in the same file. `minicpm`
(MiniCPM-V-4.5) is the default; `glm-flash` was compared against it and was too
slow and unreliable (see [`docs/VISION_EVAL.md`](docs/VISION_EVAL.md)). Vision
models miscount and occasionally invent items, which is why every proposed item
goes through your review. Any model ID can be overridden with an
environment variable listed in `.env.example`. More on endpoints, auth and rate
limits: [`docs/token-factory-notes.md`](docs/token-factory-notes.md).

## Project layout

```
src/nebius_llm/   Token Factory client: config.py, client.py (chat), vision.py, usage.py
src/app/          FastAPI backend: main.py, models.py, schemas.py, db.py, storage.py
  routers/        rooms, scans, photos, candidates, items, organize, chat
  ai/             prompts and parsing for vision, organize and chat commands
web/              React + Vite frontend
  src/pages/      one page per screen, plus Landing and Entry
  src/components/ shared glass UI components; design tokens in src/tokens.css
  src/three/      3D: landing scene, entry scene, GLB ScanViewer
scripts/          smoke_test.py, ask.py, hello.py, vision_debug.py,
                  vision_eval.py, command_eval.py
tests/            client/config/usage unit tests and backend API tests
docs/             ARCHITECTURE.md, DESIGN_BRIEF.md, VISION_EVAL.md,
                  TESTING_GAPS.md, DEMO_SCRIPT.md, HANDOFF.md,
                  token-factory-notes.md
```

## Known limitations

- **No real authentication.** Every record belongs to one fixed development
  owner, so run it locally only; do not expose it to the internet.
- **Photos are stored and sent as uploaded.** EXIF metadata (such as GPS
  location) is not stripped. HEIC/HEIF (iPhone) uploads are accepted but are not
  converted, so the vision model may fail to read them; export as JPG or PNG
  first. Photos are sent to the vision model on Nebius when you press Analyze.
- **Local storage only.** Uploads live in a git-ignored `uploads/` folder and the
  database is a local SQLite file, with no migrations.
- The Nebius spend shown in the top bar is a session total from the calls made in
  the browser, not your all-time spend.
- Voice input is not built.

## License

MIT, see [LICENSE](LICENSE).
