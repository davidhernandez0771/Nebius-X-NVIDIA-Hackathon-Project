"""T1 fixture builder, step 1: upload T2's test robots to the real /robots routes (in-process, a throwaway store)
and save the upload, parts, roles and a rejected-roles (422) response for web/src/site/setup/fixtures/.

Run from C:\dev\pm-t2 (the BYOR backend branch), read-only on its data:
    $env:PYTHONPATH="src;."; .venv\Scripts\python.exe <this file> <out dir>
Inputs: data/byor_inputs/{franka/franka_description.zip, openarm/openarm_unimanual.zip} (see T2's note
2026-10-18-byor-backend.md, "Test inputs"). The OpenArm gets the built-in mount [0.20, 0, 0.25]."""
import json, sys
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app
from app.routers import robots
from sim_worker.byor_store import RobotStore
out = Path(sys.argv[1])
root = out / "store"
app.dependency_overrides[robots.get_store] = lambda: RobotStore(root)
c = TestClient(app)
for name, z in [("franka", "data/byor_inputs/franka/franka_description.zip"), ("openarm", "data/byor_inputs/openarm/openarm_unimanual.zip")]:
    with open(z, "rb") as f:
        up = c.post("/robots", files={"file": (Path(z).name, f, "application/zip")})
    print(name, up.status_code)
    rid = up.json()["id"]
    parts = c.get(f"/robots/{rid}/parts").json()
    (out / f"{name}.upload.json").write_text(json.dumps(up.json(), indent=1))
    (out / f"{name}.parts.json").write_text(json.dumps(parts, indent=1))
    roles = dict(parts["suggested_roles"])
    if name == "openarm":
        roles["mount"] = {"pos": [0.20, 0.0, 0.25]}
    r = c.put(f"/robots/{rid}/roles", json=roles)
    print(name, "roles", r.status_code)
    (out / f"{name}.roles.json").write_text(json.dumps(r.json(), indent=1))
    bad = dict(parts["suggested_roles"]); bad["arm_joints"] = bad["arm_joints"][:4]
    r = c.put(f"/robots/{rid}/roles", json=bad)
    (out / f"{name}.roles422.json").write_text(json.dumps({"status": r.status_code, "body": r.json()}, indent=1))
