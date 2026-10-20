# Assist zones: the soft floor for any scene, with Nemotron on the semantic part (`pm/assist-zones`, 2026-10-20)

**What it is:** a job from the lead session. The user liked the soft floor in testing ("really clean"), so it is now
generalized to any ScenePlan. Code only, no GPU.

**Branch:** from `pm/scene-isaac` (942d988: ScenePlan, goals, plan scenes). Nothing pushed, merged or rebased.

## The pieces

| Piece | File | Tests |
|---|---|---|
| Geometry, always on | `demo_pipeline/soft_floor.py` (extended, not forked) | `test_assist_zones.py` (7), `test_soft_floor.py` (existing + 4) |
| Semantic rules: schema, validation, rules fallback, zones | `demo_pipeline/assist_rules.py` | `test_assist_rules.py` (13) |
| Nemotron planner (3 calls max, errors fed back) | `app/ai/assist_planner.py` | `test_assist_planner.py` (7, Nemotron faked) |
| The label on every demo | `schemas.Assist.zones` | `test_soft_floor.py` |
| Teleop consumes the zones | `sim_worker/teleop_session.py` | `test_soft_floor.py`, `test_sim_teleop_session.py` (unchanged, passing) |
| CLI | `scripts/assist_zones.py` | `test_assist_planner.py` |

### 1. Geometry (`soft_floor.py`)

**The model:**
- A `Zone` is a footprint (centre, yaw, half-sizes) with the lowest tool z allowed inside it, and optionally a speed
  cap.
- A point's floor is the highest floor among the zones that contain it, and the table top elsewhere.
- `AssistZones.clamp()` raises the target and says which zone held it.

**The geometric zones:**
- `bin_zone`: today's rim rule (`FLOOR_BELOW_RIM` under the rim, over the outside footprint plus
  `FOOTPRINT_MARGIN`), now at each bin's own inner size and yaw.
- `cube_top_zone`: for a cube that is a placement target, the held cube rests on its top. The tool (the held
  cube's centre) stops half the largest moved cube above the top.

**Builders:** `zones_for_scene(scene)` is today's one bin; `zones_for_plan(plan, cube_targets)` gives every bin
plus the requested cube tops.

**Today is unchanged.** `floor_z` and `clamp_to_floor` (today's single bin) now run through the same zones. Every
existing soft-floor test passes unchanged, and 600 random points over two bin poses give identical floors and
clamps.

### 2. Semantic rules (`assist_rules.py`, `assist_planner.py`)

**The strict JSON:**
```json
{"targets": [{"object": "<bin or cube id>", "release_clearance_m": 0.015}],
 "obstacles": [{"object": "<id>", "keep_out_clearance_m": 0.02, "speed_cap_mps": 0.1}], "notes": "..."}
```

**The code's checks:**
- real ids only;
- each object listed once;
- every goal's bin is a target;
- a cube a goal moves can't be a target, and can't be under a keep-out (a speed cap is fine);
- release clearance 0 to 5 cm, keep-out 0 to 10 cm, speed cap 0.02 to 0.5 m/s;
- a negative clearance is named as "lower than the soft floor";
- the held cube's centre at the release must stay under check_success's 0.18 m high-release limit, and the error
  says the largest clearance that fits.

**What the rules add on top of the geometry** (they never lower a floor; a test checks it over a grid):
- a `release:<id>` floor (surface + clearance + half the largest cube going there);
- a `keep_out:<id>` floor (the stack's top + clearance);
- a `slow:<id>` speed-cap zone (the footprint + 5 cm).

**The loop:** problems go back to Nemotron with its reply, at most 3 calls.

**The rules fallback** takes over, with the reason kept, when Nemotron is off, errors out, or never validates:
- every goal's bin is a target, on the geometric floor alone;
- a 0.1 m/s speed cap near any stack 10 cm or taller.

### 3. The label

- `Demo.assist.zones` is `AssistZones.to_dict()` (source, every zone's footprint, floor and speed cap) whenever the
  soft floor was on; `None` when it was off.
- A label without zones serializes byte for byte as before (a model serializer), so older demos hash the same.
- The one existing test that pinned the label's exact JSON now also expects the zones; that was the requested
  change.

### 4. Teleop

- `TeleopSession(zones=...)` (default: today's `zones_for_scene`) clamps the target and the smoothed command
  through the zones.
- Inside a speed-capped zone, each step moves at most cap × `TELEOP_DT`.
- Today's scene has no caps and the same single bin zone, so the existing teleop and soft-floor tests pass
  unchanged.
- The Record page still builds one cube and one bin. A plan's zones come in when teleop takes plans.

## Real Nemotron calls (super, the 3 example plans; ~$0.002 in all)

| Plan | Calls | Result |
|---|---|---|
| 1 today | 2, then 1 after the prompt fix | `bin` target, release 1.5 cm above the rim (floor 0.13 m) |
| 2 stack of three, 2 bins | 2 | `bin_left` target, release 1.5 cm; no obstacles |
| 3 three sizes, 2 bins | 2 | both bins targets, release 1.5 cm (floors 0.115 and 0.13 m) |

**What the first attempts taught:**
- The model copied a concrete id from the prompt's JSON example (`bin_blue` in a scene with only `bin`). The
  example now uses placeholders, and plan 1 became valid on the first call.
- It reached for keep-outs over stacks whose cubes are to be moved, and the validator refused them. The error now
  says a speed cap is fine.
- Even so, on plan 2 ("careful with the tall pile") its second reply dropped the caution: no speed cap, just a
  note. The rules fallback would have added the 0.1 m/s cap.

**Open choice for the lead:** keep the fallback's tall-stack speed caps always on, like the geometric floor.

## Checks

- **Python:** 2159 passed, 16 skipped, 0 failed (without `test_launch_health.py`).
- **pyflakes:** clean on the new and changed files.

## Not done

- **Teleop with a plan:** `TeleopSession` takes any zones, but the Record page and `teleop_isaac` still build
  today's scene. Passing a plan's zones in is a one-liner once teleop takes plans.
- **The web page doesn't show the zones** (the Record page is out of scope). The label is saved with each demo.
- **The optional render input** for the planner ("+ optional scene render later") isn't wired: `plan_assist`
  takes text and the plan.
