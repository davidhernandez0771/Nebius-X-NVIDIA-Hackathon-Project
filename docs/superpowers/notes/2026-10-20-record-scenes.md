# Record: scenes from plans, the scene picker, scene lists, wrist yaw (2026-10-20, pm/record-scenes)

The branch comes from pm/live-12 (d28e591). It's code only and Isaac was never started. Everything Isaac-side is
written to mirror `sim_worker/replay.py`'s proven plan path, but is untested until the live session; the checklist
is at the end. Pure parts are tested; the page was checked in CPU-only headless Chrome (SwiftShader) against a
stand-in sink.

## What was built

### 1. The sim starts in a ScenePlan

**The library.** `demo_pipeline/scene_library.py`.
- Scenes live in `DATA_DIR/scenes/<id>.json`: id, name, description, source, plan, hash, `needs_settle`, settle
  result.
- The built-in **Standard** is the live sink's scene (`STANDARD_SCENE`: the cube at (0.50, 0.00), the bin at
  (0.50, 0.30), where every recorded demo had them). **Note:** that is *not* `ScenePlan.default()`, which is the
  middle of the sampling ranges. The sink's `base_scene()` now reads `STANDARD_SCENE`, so there is one source.
- `plan_hash` is sha256 of the canonical plan JSON, 16 hex digits.
- `needs_settle` is true for anything but today's bodies (one table cube of 5 cm and one 20×20×8 cm bin). Poses
  alone never need it.

**The session.** `TeleopSession(…, plan=, scene_ref=)`.
- It places the plan's bodies (`driver.reset(scene, layout=…)`) and reads every cube each step
  (`StepState.objects`).
- It saves like `replay.py`: `objects.npz/json`, `goals.json` and `plan.json` beside the episode.
- The verdict comes from `demo_pipeline.goals.check_goals`. `signals.npz` stays the first goal's cube.
- **Standard through the plan path gives exactly today's verdict and `signals.npz`.** This is tested for a placed
  take and a missed one, and no plan at all is byte-for-byte today's path.
- Assist zones come from the plan: `zones_from_rules(plan, rules_fallback(plan))`, so the rules floor is always on.
- Each demo gets `scene_plan: {id, hash, name}`, left out when absent, so older demos are unchanged.

**The twin.**
- `sim_twin_scene` gains `objects` (every cube and bin: kind, colour, size or inner sizes, pose7). `sim_twin`
  gains `cubes` (each cube's pose).
- The relay validates both and forwards them only when present.
- The 3D twin draws every object: plan colours for cubes, each bin at its own size. The front, side and top aid
  views show them too, and the align grid still uses the goal's cube and bin.

**The Isaac driver.** `IsaacTeleopDriver(plan=)`.
- It builds the plan scene through `replay._session(…, plan=)`. Every entity it reads (goal cube, finger sensor,
  arm sensors, all cubes) comes from the layout; without a plan they are today's names.
- `body_key` says what it was built with.
- `settle_check(plan)` runs `sim_worker.settle` in the same sim.

### 2. Switching scenes from the page

Isaac builds one scene per process.

- **Same bodies** (`plan_layout.body_key`: S1, S2, S3, S6, any pose changes) switch in the running sim: the session
  places them again, which is a scene reset.
- **New bodies** (S4, S5, S7, S8) need a new sim:
  - the sink writes `DATA_DIR/scenes/_next_scene.txt` and exits with code 75;
  - `sim_worker/scripts/teleop_sink_loop.py` starts it again with `--scene <id>`;
  - on load it runs the settle check in Isaac before anyone records, records the result with the entry, and shows
    it in the status.
- **Run the sink through the loop from now on.** With no scene arguments it is today's sink. `start-live.ps1` and
  the page's "start the sink" notice now say so.
- **Relay.** It accepts `{"type":"control","action":"set_scene","scene":"<id>"}` (a safe id). `sim_status` gains
  `scene: {id, name, hash, settle, switching, playlist}`.
- **Routes.** `GET /scenes` (it seeds S1–S8 if missing and never overwrites), `GET /scenes/{id}`,
  `POST /scenes/create` (Nemotron's existing scene creator with the validator loop; saves nothing), and
  `POST /scenes` (saves a plan the validator passes).
- **/record.**
  - A "Scene · <name>" button in the top bar opens a drawer listing Standard, S1–S8 and saved scenes, with a
    "new bodies" tag.
  - Picking a scene shows a 2D top-down preview (seen from behind the robot, with goal arrows), its description and
    what switching will do. "Use this scene" is disabled while recording, without a sim, or for the live scene.
  - "Describe a scene" calls Nemotron, previews the plan or its validator errors, and "Save & use" saves it and
    switches.
  - The drawer shows the live scene, "switching to …", a failed settle check, and scene-list progress.

### 3. The 8 protocol plans

All 8 pass `validate_plan`. "Settle check" means new bodies: a sim restart plus the Isaac settle check on load.

| id | what | settle check |
|---|---|---|
| s1 | Standard (= `STANDARD_SCENE`) | no |
| s2 | cube at (0.63, −0.26), 2 cm inside reach | no |
| s3 | bin turned 90° at (0.55, −0.20), the other side | no |
| s4 | 4 cm cube | **yes** |
| s5 | 6 cm cube | **yes** |
| s6 | cube yawed 35° | no |
| s7 | yellow distractor at (0.50, −0.085), goal stays red → bin | **yes** |
| s8 | bin walls 11 cm (rim 0.12; the soft floor stops at 0.11) | **yes** |

### Additions from the lead

**Wrist yaw for keyboard and mouse.**
- `drive.ts`: Q/E turn the wrist, ramped like the other axes, Shift for fine, clamped to ±90°. With the mouse
  locked, Shift+wheel turns it 10° per notch, followed smoothly. A plain wheel still moves up and down.
- The yaw goes out as `yaw_rad`, which the sim already maps (`to_ee_target`, clamped ±90°).
- **The sim now smooths yaw for keyboard and mouse**, with the same critically damped filter as position. Camera
  yaw is unchanged, and the robot's own start orientation passes through untouched.
- The yaw is saved in each demo's commanded and reached orientations.
- A "wrist ±N°" dial in the twin pane's header shows the yaw being sent in every mode, and the legends list Q/E and
  Shift+wheel.

**Scene list for a recording session.**
- Use `--scene-list s1,s2,… --takes-per-scene N`. After each **saved** take (discards don't count) it moves on, in
  rounds.
- The position is kept in `DATA_DIR/scenes/_playlist.json`, so a restart into a new-bodies scene resumes the list
  (`--resume-playlist`, passed by the loop).
- The status shows "scene list i of n · take j of N".
- 12 scenes × 2 takes is `--scene-list <12 ids> --takes-per-scene 2`. Put same-body scenes next to each other to
  save restarts.

## Tests

- **Python:** new `test_scene_library.py` (18), `test_teleop_plan_session.py` (26), `test_teleop_wrist_yaw.py` (7)
  and `test_scenes_api.py` (10), plus relay and twin additions.
- **Full suite** (`uv run --no-sync pytest -q`): 2431 passed, 27 skipped, 1 failure. The failure was the new loop
  script missing `check_own_code()`, now fixed; the own-code tests then pass (32).
- **Web:** 1567 passed, `tsc -b` clean. That includes drive yaw (6), DriveSession yaw (2), twin objects (2), the
  wrist dial and legend, and the picker (5: list and preview, Use this scene and its guards, the
  switching/settle/playlist status, describe → preview → Save & use, an invalid description).
- **Page check:** headless Chrome, CPU only (SwiftShader). A scratch `DATA_DIR`, and a stand-in sink running the real
  `TeleopSession` in S7 with a fake driver.
  - The top bar showed "Scene · S7 Yellow distractor".
  - The twin drew the red cube, the yellow cube and the bin, in all aid views.
  - The picker listed all 9, tagged the 4 new-bodies scenes and previewed S7.
  - The wrist dial and the Q/E legend were present.

## Live checklist (the user's next session, with Isaac)

Start the backend as usual, then the sink **through the loop**:
`C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\teleop_sink_loop.py --viz kit` (plus `--data-dir` as
`start-live.ps1` prints).

1. **No scene arguments = today.** The arm, cube and bin should be where they always were. Record one take: it
   should verify as before. `demo.json` should have no `scene_plan`.
2. **Picker.** "Scene · Standard" in the top bar, and the drawer should list Standard + S1–S8.
   `DATA_DIR/scenes/s1..s8.json` should now exist.
3. **Same-body switch (S3).** Use this scene. Within a second the bin should turn 90° and move to the robot's right,
   in Kit and in the twin, with the arm reset. Record a take into the bin. Check:
   - the status/review says verified;
   - `demo.json` has `scene_plan.id = "s3"`;
   - the episode has `plan.json`, `goals.json`, `objects.npz`.
4. **New-body switch (S7).** Use this scene. Check:
   - the drawer says "switching to s7";
   - the sink logs "restarting the sim for scene s7" and exits, and the loop logs "restarting the sink in scene
     s7";
   - the new sink logs "settle check: ok";
   - the page reconnects, with the yellow cube in Kit and the twin.

   Then record red → bin (expect verified) and yellow → bin (expect `not_in_bin`). **Watch:** does the GPU memory
   drop between the two sinks (a clean Kit exit)?
5. **S4 / S5 / S8.** Restart + settle each. Can the fingers grip the 4 cm and 6 cm cubes? In S8, does the soft
   floor stop at the higher rim (ee_target_z ≈ 0.11)?
6. **Wrist.** Keyboard: hold Q, then E. The gripper should turn smoothly in Kit and the dial should follow, stopping
   at ±90°. Mouse: Shift+wheel turns 10° a notch; a plain wheel still goes up and down. Record S6 (cube at 35°)
   with the wrist turned to match; the demo's `ee_quat` should vary.
7. **Scene list.** Restart with `--scene-list s1,s2,s3,s6,s4 --takes-per-scene 2`. Check:
   - after each 2 saved takes the scene moves on;
   - Stop & discard doesn't count;
   - at S4 the sim restarts and the list carries on (the drawer shows "scene list 5 of 5").
8. **Describe a scene** (needs the Nemotron key: the backend started with the `.env`). Type "a green cube to the
   left of the red one, the red one goes in the bin". Expect a preview, then Save & use, then a restart + settle.
9. **Things only Isaac can confirm** (code written, never run):
   - teleop with `replay._session(…, plan=)`, including the cameras;
   - a non-legacy plan's cube and contact-sensor names in `read_state` and `read_contact`;
   - the in-sim `settle_check`;
   - placing a same-body layout in a sink started without a plan;
   - the 0.5 s grace before the restart exit, so the page sees "switching".
