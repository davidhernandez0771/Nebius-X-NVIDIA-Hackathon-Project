# Franka Panda for the robot twin

The URDF and the collision meshes of `franka_description` 0.7.1 from franka_ros (https://github.com/frankaemika/franka_ros),
by Franka Emika GmbH, under the Apache License 2.0 (`LICENSE.txt`; `package.xml` names the license).

- **Copied from** T2's BYOR test input `C:\dev\pm-t2\data\byor_inputs\franka\franka_description.zip`
  (sha256 `3292d47ab633d276d63f9c1a96115f9b2437962e46fef0c00f474a44055dac1a`). The files are unchanged.
- **Left out:** the visual meshes (`meshes/visual/*.dae`, 10.5 MB). The twin draws the collision meshes
  (`meshes/collision/*.stl`, 140 KB in all) instead. It loads only those, so the URDF's references to the visual
  meshes are never fetched.
- **Used by** `web/src/twin/` (the Record page's 3D robot twin). The sim's Franka is Isaac Lab's
  `FRANKA_PANDA_HIGH_PD_CFG`, the same arm. Its joint names match this URDF.
