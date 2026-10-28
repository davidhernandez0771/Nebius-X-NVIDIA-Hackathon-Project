# Real takes for the take review

Five of the user's live takes, copied read-only from `data/demos` (git-ignored) on 2026-10-20 for
`tests/test_take_review.py`. Each file holds:

- `demo`: demo.json as saved;
- `signals`: episode/signals.npz, with positions to 0.01 mm and forces to 0.01 N;
- `reached`: episode/steps.npz `ee_pos`, the tool point the arm reached.

They are JSON because the repo ignores `*.npz`. `test_the_fixtures_match_the_live_takes_when_they_are_here` checks
that the rounding changes no fact; it skips when the originals aren't on the machine.

| take | input | what happened |
|---|---|---|
| human_20261020183738_00ab | mouse | clean; the soft floor held 39 steps; grab 6 mm off-centre |
| human_20261020184117_dc3e | mouse | clean; the floor was on but never needed |
| human_20261019185902_c045 | webcam | pressed 927 N into the bin (collision) |
| human_20261019185341_0576 | webcam | dropped outside the bin; 3 grabs didn't hold |
| human_20261019185745_a67b | webcam | 531 N press, dropped, 5 regrasps |
