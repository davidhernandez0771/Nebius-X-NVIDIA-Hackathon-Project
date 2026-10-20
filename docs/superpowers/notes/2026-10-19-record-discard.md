# Record: throw away a bad demo (2026-10-19, pm/record-aids)

Two quiet buttons beside Record on /record (existing `rg-btn rg-btn--small`, no new colours). Record itself
(start / stop = save) is unchanged.

- **Stop & discard** shows only while recording. It sends the new teleop control `record_discard`
  (relay `ControlMsg`, `sim_worker/teleop_session.py`): the session ends the recording and drops it. `save_fn`
  never runs, so no demo folder is written. The status says `discarded: N step(s) not saved`, and `demo_id` goes
  to null, so "Delete last demo" can't reach back to an older demo.
- **Delete last demo** shows after a save, while idle. One click arms it ("Confirm delete", backs off after 4 s),
  the second calls `DELETE /demos/{id}`. The backend **moves** the folder to `DATA_DIR/demos/_discarded/<id>`
  (`DemoStore.discard`; `<id>_2`, ... if that name is taken). It never deletes anything. It returns 409 if other
  demos derive from it, and 404 if the demo is missing.
  - The page then stops counting the demo in "recorded", drops its Review link, and says
    "moved to demos/_discarded" in the episode cell. An error goes in the same place.
- `_discarded` is reserved: it is never a demo id. `list_demos` (so `GET /demos`, the Review list and the
  experiment's `select` stage via `select_ids`) and every lookup skip it.
- To restore a demo, move its folder from `demos/_discarded/` back to `demos/`.

Header at 1281-1360 px wide: the steps sit in the middle space left over, with shorter joins, and the cartridge
shows only its code, so the extra button fits.

**Verified.**
- pytest: 1823 passed, 20 skipped.
- `npm --prefix web test`: 1129 passed. tsc is clean and the build is OK.
- Headless Chrome (fake camera, SwiftShader) at 1440x900 and 1280x720, against the real backend and relay, with
  a stand-in sim (the real `TeleopSession` + `make_store_saver` on a stub driver). It went through record ->
  Stop & discard (no folder) -> record -> Record (saved) -> Delete -> Confirm (folder in `_discarded`, `GET /demos`
  skips it), and the confirm backed off after 4 s.
- Not yet tried with Isaac.

Local check gotcha: the backend's CORS allows only the dev server on port 5173, so a DELETE from Vite on any
other port fails its preflight with 400.
