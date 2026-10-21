"""The Record page's keyboard and mouse driving (web/src/record/drive/drive.ts) sends the camera path's HandPoseMsg;
the sim's own to_ee_target must put the arm exactly on the target the page drove to. The fixture is written by the
TypeScript (drive.test.ts checks it against driveMessage)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from demo_pipeline.teleop import GripperLatch, HandPoseMsg, to_ee_target

FIXTURE = Path(__file__).resolve().parents[1] / "web" / "src" / "record" / "drive" / "__fixtures__" / "drive_msgs.json"
ROWS = json.loads(FIXTURE.read_text(encoding="utf-8"))["rows"]


@pytest.mark.parametrize("row", ROWS, ids=[str(r["target"]) for r in ROWS])
def test_to_ee_target_puts_the_arm_on_the_page_target(row):
    msg = HandPoseMsg.model_validate(row["msg"])
    pose = to_ee_target(msg)
    assert pose.pos == pytest.approx(tuple(row["target"]), abs=1e-9)
    assert pose.quat_wxyz == pytest.approx((0.0, 1.0, 0.0, 0.0))  # gripper straight down, no yaw


@pytest.mark.parametrize("row", ROWS, ids=[str(r["target"]) for r in ROWS])
def test_the_gripper_follows_grip(row):
    assert GripperLatch().update(HandPoseMsg.model_validate(row["msg"])) == row["grip"]


def test_the_fixture_covers_every_workspace_corner_it_claims():
    targets = {tuple(r["target"]) for r in ROWS}
    assert (0.3, -0.35, 0.02) in targets and (0.7, 0.35, 0.4) in targets
