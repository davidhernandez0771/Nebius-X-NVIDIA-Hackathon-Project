# Live start: the two setup bugs from live test #10, fixed (`pm/live-start`)

Branch `pm/live-start`, made from `pm/live-10`, in worktree `C:\dev\pm-t2`. The changes are not pushed.

## What broke in live test #10

1. **The backend crashed with `ModuleNotFoundError: sim_worker`.**
   - `src/app/routers/robots.py` imports the repo's top-level `sim_worker` package.
   - `uvicorn app.main:app --app-dir src` puts only `src/` on the path.
   - The tests didn't catch it, because pytest's `pythonpath = ["."]` adds the repo root.
2. **The camera failed with "[object Event]" in a new worktree.**
   - The hand-tracking files (`web/public/models/hand_landmarker.task`, `web/public/mediapipe/wasm/*`) are git-ignored, so a new worktree doesn't have them.
   - Vite answers a missing public file with its index page (200, `text/html`).
   - MediaPipe's loader `<script>` then fails and rejects with the bare DOM Event.

## The fixes

- **Backend:**
  - `src/app/__init__.py` appends this checkout's root to `sys.path` when it isn't there. The documented command works with no `PYTHONPATH`.
  - This uses the same `sim_worker` that `robots.py` already runs `robot_report.py` from (`REPO`).
  - I chose a path setup over packaging `sim_worker`: an editable install in a shared venv can point at another checkout.
  - Test: `tests/test_app_import.py` imports `app.main` the way uvicorn does, in `python -I` from a temp directory with only `src` on the path. It failed before the fix.
- **Hand files:**
  - `web/scripts/hand-assets.mjs` runs as `predev`. It copies the wasm from `node_modules/@mediapipe/tasks-vision/wasm`.
  - If the model is missing, it copies it from another worktree (`git worktree list`), or else downloads the pinned `float16/1` file.
  - It checks the model's size and SHA-256 (`fbc2a300…cde1`, 7,819,105 bytes). The three copies on this PC and Google's file all match.
  - Tests: `web/scripts/hand-assets.test.mjs`. To include them, vitest now also runs `scripts/**/*.test.mjs`.
- **Camera error:**
  - `web/src/hand/tracking/assets.ts` sends a HEAD request for the loader, the wasm and the model before MediaPipe loads them. A missing file, or an HTML answer, throws "Hand tracking couldn't load <path> (<why>). Run …".
  - A bare Event from MediaPipe becomes the file it was loading.
  - `cameraMessage` uses the same text.
- **`scripts/start-live.ps1`:**
  - It refuses if port 8000 or 5173 is held by something this checkout's `start.ps1` didn't start, such as another worktree's server.
  - It runs `scripts\launch\start.ps1 -Backend -Web`, then waits for `/teleop/status`.
  - It checks that the hand files are present, warns if an Isaac python is already running, and prints the sink command and the URL.
  - Stop with `scripts\launch\stop.ps1`.

## Checked, without Isaac or a GPU

- `uv run pytest -q`: 1811 passed, 20 skipped, 0 failed.
- `npm --prefix web test`: 127 files, 1123 passed.
- `npm --prefix web run build`: OK.

- `scripts\start-live.ps1` started from this worktree with the hand files deleted. In 13 s it reported:
  - the backend up (`/api/health`);
  - the relay up ("no sim connected, no browser, 0 poses forwarded");
  - predev had copied the 4 wasm files and the model from the main checkout.

  `stop.ps1` then stopped both, and no processes were left over.
- I opened `/record` in headless Chrome with a fake camera and software WebGL (SwiftShader), then clicked Start camera:
  - **All files present:** the camera ran, MediaPipe loaded the model, and the page said "no hand" (the fake camera shows no hand).
  - **Model removed:** "The camera didn't start: Hand tracking couldn't load /models/hand_landmarker.task (not found: the server sent a web page instead). Run `node web/scripts/hand-assets.mjs` …"
  - **Wasm removed:** the same message, naming `/mediapipe/wasm/vision_wasm_internal.js`.
- I tried the real download from Google into a scratch folder. It matched the pin.
- The sink and a real hand were not run. That is the next live test.
