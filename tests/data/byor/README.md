# "Bring your robot" test data

| File | What | Source |
|---|---|---|
| `franka_description/package.xml`, `robots/panda_arm_hand.urdf`, `meshes/collision/*.stl` | The real Franka Panda URDF and its collision meshes, verbatim. The visual meshes (11 MB of DAE) are not included; `tests/test_byor_e2e.py` drops the URDF's `<visual>` blocks before uploading. | `franka_description` 0.7.1 (Apache-2.0) as bundled with Isaac Sim's URDF importer: `C:\isaac\env_isaaclab\Lib\site-packages\isaacsim\exts\isaacsim.asset.importer.urdf\data\urdf\robots\franka_description` |
| `franka.report.json` | `report.json` of a real report-card run (30 scenes, seeds 100–129, Isaac Lab 3.0) of the same URDF, uploaded with its visual meshes as `byor_3292d47ab6`. The run is described in `docs/superpowers/notes/2026-10-18-byor-backend.md`. | `data/robots/byor_3292d47ab6/report.json` |
