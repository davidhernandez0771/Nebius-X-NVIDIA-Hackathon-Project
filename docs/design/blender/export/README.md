# SANT workshop: web assets exported from Blender

**Source:** `../sant-cartridge.blend` (scene `W_World`). All files are glTF binary, Y-up, in metres, with the same units as the Blender scene.

| File | What | Notes |
|---|---|---|
| `cartridge.glb` | The hero cartridge, about 3.1k tris, 123 KB | Its parts are separate meshes: `shell`, `label`, `window`, `inner`, `reels`, `tape`, `pins`, `screw`. Instance it per part with `InstancedMesh`. |
| `cartridge_lod.glb` | A far LOD: a beveled box plus the label, 5 KB | For the 442 library-shelf cartridges. |
| `machine.glb` | The GPU-shaped console on its desk | Fins, fans, heat pipes, cable, the port, the projector lens, the beam cone, the hologram screen plane and the wireframe holo arm. Its origin is the machine pivot. |
| `workbench.glb` | The steel bench and its parts | Drawers, turntable plus teal ring, label printer, cutting mat. Its origin is the bench pivot. |
| `layout.json` | Where everything goes | The helix slots (29, with each slot's label and shell color), the library slots (442), the station positions and rotations, and the camera stations (eye and target per journey stop). |

**Labels:** the `label` mesh is UV-mapped 0–1. Draw each robot's label into a canvas atlas on the web; don't bake the text.

**Shell color:** the shell material is glossy dark plastic. On the web, tint it per instance: Graphite (default), Smoke (0.25 grey, about 40% opacity), Bone (0.86), Ash (0.38), Signal (teal, about 40% opacity).

**Not exported:**
- the room, pedestal, chips and wall props: simple shapes, cheaper to build in code from `layout.json`;
- the story text: it belongs in the DOM;
- the plugged-in cartridge: reuse `cartridge.glb`.
