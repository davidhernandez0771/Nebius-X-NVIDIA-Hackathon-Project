# Demo script (3 minutes)

Flow: **scan, photo, review, organize, chat.** Written against what the app
does today (2026-09-18). Lines marked **[not built]** or **[risk]** are things
to fix or work around before the real demo.

## Before you go on

Do this once, off-camera, with a fresh database.

1. Backend and frontend running (see the README). Open http://localhost:5173.
2. `uv run python scripts/smoke_test.py` prints `SMOKE TEST PASSED`.
3. Have ready: a `.glb` room scan file, and a photo of a shelf with 4 to 6
   clearly separate objects (one of them a lamp, or change the chat line below).
4. **Rehearse the photo with the real model first.** The vision step has never
   been verified on a real photo, and the usage log already shows MiniCPM
   replies cut off at the 1024-token limit. Use a photo that gives clean
   results, and keep a backup photo.
5. Delete `app.db` before the take so the room list starts empty.

## Script

| Time | Screen | Say | Do |
|---|---|---|---|
| 0:00 | Home | "Everyone owns a shelf they've lost track of. This app builds an inventory of it from a photo, and the AI never changes anything without you." | On **Home**, type a room name ("Bedroom"), click **Add room**, open it. |
| 0:20 | Room view | "A room has locations: the top shelf, the desk drawer." | Type "Top shelf", click **Add location**. |
| 0:35 | Add scan | "First, spatial context. I scanned the room with a phone app and export a `.glb`. We store it as read-only context." | **Add scan**, choose the `.glb`, upload. **[not built]** There is no 3D viewer or entry scene yet, so say "stored" and don't promise a rendering. |
| 0:55 | Add photo | "Now the shelf." | **Add photo**, pick the location, choose the shelf photo, click **Analyze**. Say: "One vision call on Nebius, MiniCPM-V, about a tenth of a cent." Cost is shown by the API as `est_cost_usd`. **[risk]** This is a live billed call; expect 5 to 9 seconds. |
| 1:15 | Review | "The model *proposes* items. Nothing is inventory yet. Each one I sort myself: organize, unknown, or trash." | **Review**: click **Organize** on 3 or 4 items, **Unknown** on one it was unsure of, **Trash** on one. Point at an item's uncertainty note if it has one. |
| 1:50 | Inventory | "Only the ones I confirmed are here." | **Inventory**: show the confirmed items. Trash and unknown are absent. |
| 2:05 | Organize | "Now Nemotron on Nebius Token Factory looks only at my confirmed items and suggests a layout." | **Organize**, click the button, read one or two bullets. Say: "It's a suggestion. It moved nothing." |
| 2:30 | Chat | "And I can drive it in plain language, but the backend validates every command." | **Chat**: type `send the lamp to trash`. Show the reply `Trashed "lamp"`, then **Inventory** with the lamp gone. |
| 2:50 | Chat | "If it isn't clear, it refuses instead of guessing." | Type something vague: `do the thing with that`. Show `I didn't understand that.` |
| 3:00 | Close | "The AI proposes. You and the backend decide." | End. |

## What not to demo

- **Move and organize by chat.** Typing "move the lamp to the desk" returns a
  "not wired up yet" message. Use the Organize screen instead.
- **Questions by chat** ("where is the lamp?") return a "not wired up yet"
  message.
- **A name that matches several items** ("trash the cable" with two cables):
  the backend trashes one arbitrarily (`docs/TESTING_GAPS.md`, bug 1). Use names
  that match exactly one item.
- **The animated 3D entry scene and login.** Neither exists yet.

## If something goes wrong

| Symptom | Fix on the spot |
|---|---|
| Review shows "No candidates" after Analyze | The model reply didn't parse. Say "it fails safe to manual entry", click **Analyze** again once, or use the backup photo. `uv run python scripts/vision_debug.py photo.jpg` shows the raw reply. |
| Analyze returns an error banner (502) | Token Factory was unreachable or rate limited. Retry once; otherwise narrate from a pre-recorded run. |
| Chat says it couldn't find the item | The item's name differs from what the model saw. Read the exact name off **Inventory** and retry. |
| Any call feels slow | Nemotron nano answers in about 0.3 s; the vision call is the slow one. Fill the wait with the "proposes, you decide" line. |
