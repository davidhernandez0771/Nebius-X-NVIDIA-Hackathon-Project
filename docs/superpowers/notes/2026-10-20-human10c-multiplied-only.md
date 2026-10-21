# human10c, multiplied only: pre-registration (2026-10-20)

Committed **before** training. The result is added at the end of this note after the eval, and nothing above
"Result" changes after this commit.

## Why one arm

human10c turned the 10 webcam demos from live test #10 into 27 verified training episodes
([2026-10-19 note](2026-10-19-live-test-10.md), `51f8792`):

- **Raw arm:** none of the 10 recorded demos pass the physics check on replay. Training on them would mean
  training on 10 failed replays, which is no fair comparison.
- **This test instead:** how often does a policy trained only on what SANT made from those demos succeed? There is
  no comparison arm, and no claim that it beats anything.

## What is frozen

- **Experiment.** `C:\dev\pm-t6\data\human_exp\human10c`, run from `pm/achieved-path` with
  `scripts/run_human_demo_experiment.py --multiplied-only --no-nemotron --force-config`.
  - `config.json` (sha256 `ce9d13b1b98dd989ff7a36c686acf8d07f5c3606bbd79d782904ab0e45b0cfff`) was refrozen at
    2026-10-20T14:35:29Z. Against the 2026-10-19 config (kept as `config.2026-10-19.json`), only `multiplied_only`
    (new, true), `nemotron` (true → false; the cards decide nothing here) and `frozen_at` changed.
  - Every demo and `steps.npz` hash is unchanged.
  - The experiment's own `preregistration.md` says the same; the old one is kept as `preregistration.2026-10-19.md`.
- **Demos.** The 10 webcam demos `human_20261019*` (sha256 per demo in `config.json`). The achieved path is
  replayed with lookahead 0.
- **Training data: the cell `perfected_multiply_10`, 27 episodes from 3 human roots.**
  - 9f47: the repaired demo + 6 variants.
  - a029: the repaired demo + 9 variants.
  - c045: the repaired demo + 9 variants.
  - It is identical to the multiplied cell of the 2026-10-19 grid (`grid.2026-10-19.json`).
  - `grid.json` sha256 `ad4662996149b75ef89b56501daf61ff2f8ec67debd6d561368831343c035a45`.
  - Cell sha256 `97c409b714df3e5fb105647ddb03457ffb82dcc69c16d33473f2e07a240b5dc1`: the sha256 over the episode
    digests below, in order. Each episode digest covers every file in the episode dir, by sorted relative path
    and content.
- **Policy.** ACT, 30,000 steps, batch 8, checkpoint every 2,500 steps; the 30k checkpoint is evaluated. This is
  the recipe of the sprint 7/8 and grasp-fix runs (`lerobot_tools.experiments`).
- **Eval.**
  - Serial (`eval_cells.py --cells perfected_multiply_10`).
  - Unseen scenes, seeds **5020–5059** (n = 40).
  - Starts from this cell's own dataset start state (`--start-pose dataset`); every training episode starts at home.
  - 30 s limit, front and wrist cameras.
- **Metric.** Successes out of 40, as the eval's physics check decides, with a Wilson 95% CI.
  - No hypothesis test, no interim looks and no other endpoints; n is fixed.
  - `sim_error` / `policy_error` episodes are re-run, never counted as failures.
  - The result is reported whatever it is.

### Episode hashes

| Episode | Files | sha256 |
|---|---|---|
| `human_20261019185258_9f47_rules_home` | 742 | `2b106e8eb52d9032c540de99aa2b6eebb1c6da5e2f65be66aab04dacbddb340c` |
| `human_20261019185258_9f47_rules_home_m3301` | 690 | `b6fbb25239cfd98511a55119cd00daa1d8e8de7a77d165b7d36ffaee165c6df8` |
| `human_20261019185258_9f47_rules_home_m3303` | 736 | `11fca9f7d5882f9d89bbdc07f276a01ee7240956cd50cfcbb2814760110a79e9` |
| `human_20261019185258_9f47_rules_home_m3304` | 738 | `995f521a5a7c7fe5dfd992c0a00265fd34ff0928e51d48059a3ee4cebc419a62` |
| `human_20261019185258_9f47_rules_home_m3306` | 750 | `fae03ea7b0bc82c4debb90ae3b3c947a82d78e2f88de6baf6db78d897291f535` |
| `human_20261019185258_9f47_rules_home_m3308` | 780 | `4c263fcd5ae51edd81a46e089f49eda1fd0ee325278b4fcf3cd36fa5e9aed2e9` |
| `human_20261019185258_9f47_rules_home_m3309` | 812 | `eb57e15afb7a1657531df89f4b1e8d93ab29bb7cefd59c1800f76560ef60d11d` |
| `human_20261019185503_a029_rules_home` | 838 | `27e27058b4c44c4ae7a231a63f8c9f1dc9c5a5864da4cefc3055f465039b8f04` |
| `human_20261019185503_a029_rules_home_m3500` | 952 | `a64d472a7c5fb6ac974e3ed7cea66672cda6140d39aefc717b3064c8da21585b` |
| `human_20261019185503_a029_rules_home_m3501` | 940 | `1012eecf288859543e812ee381a2f0ab6ca36d93270aa962da500757f7af17a2` |
| `human_20261019185503_a029_rules_home_m3502` | 802 | `d4d60b221744e49be3f4adeb5364a1707dbde20366aa0c1e19164809b310278d` |
| `human_20261019185503_a029_rules_home_m3503` | 908 | `ea3e64356f8948d59d8c1dd6983867933184802e338506c0d00338a6f5679cf4` |
| `human_20261019185503_a029_rules_home_m3504` | 870 | `dc76504476afadd80742ab86dedb87c63605e5f481b4fe7d1991144d0c2dfc01` |
| `human_20261019185503_a029_rules_home_m3505` | 802 | `4fd374c5cf681f554ebe0964f033818abef19e647dda4dad7dd648d452af698a` |
| `human_20261019185503_a029_rules_home_m3506` | 918 | `2a29036ac861d65604e869e991fd972b6a3dbbc62b18e27dd80a957b6d096553` |
| `human_20261019185503_a029_rules_home_m3507` | 828 | `4dc78bffb7f47cbe33fb64a10e0395bd44f45064e6511b390515f7394690b91d` |
| `human_20261019185503_a029_rules_home_m3509` | 884 | `9aee6097f5f0647aae1d44f9c5a18c4380c05b7cd6f5270c5b9ce2eabb68ebdb` |
| `human_20261019185902_c045_rules_home` | 876 | `7e6f49c6e052b70e82854d8cbececc61e7cde592ffcdc932784d9472e37397f8` |
| `human_20261019185902_c045_rules_home_m3900` | 850 | `e1e40a914a2f227ac0cb73c05a183b0016d6efbf6a72de9c25f630b7cbe8110a` |
| `human_20261019185902_c045_rules_home_m3901` | 838 | `cdcc71e46fd3bb5169a509d4b1b30a6d093eb60e89e1630b046e89ef5dd9d495` |
| `human_20261019185902_c045_rules_home_m3902` | 876 | `cf282525de2137ce5d925ef4054a32d5cb8a82b8cfd1d7795ed5c655cf34c29d` |
| `human_20261019185902_c045_rules_home_m3903` | 934 | `13f4849d7834f15e15e80592cf34f3d5a6d76b07583e9781f69b1ae37bc51971` |
| `human_20261019185902_c045_rules_home_m3904` | 826 | `e8879745d5e7f7dffbb0f1c25a823a609229c9e8142c5d7e01691a38c9c22967` |
| `human_20261019185902_c045_rules_home_m3906` | 876 | `8c827b7e19e72e4198900d844675290e4293778d6560d3fa08404ec9a141cbe1` |
| `human_20261019185902_c045_rules_home_m3907` | 848 | `d0db0eb111ed1acd94da205b0223ae064e39fa8e9c77d33918d3b45f25cd82b6` |
| `human_20261019185902_c045_rules_home_m3908` | 888 | `adf478ccdb2c67504356054b91e770ca030a2a8faaacf9be2bab6780dab77f29` |
| `human_20261019185902_c045_rules_home_m3909` | 986 | `33517b8d11419707cc132460abba38261adcf8587d44637861a6093e9a67d162` |

## Command

```
uv run python scripts/run_human_demo_experiment.py --name human10c --data-dir C:\dev\pm-t6\data ^
    --multiplied-only --no-nemotron
```

It resumes from the frozen config: sim done, grid done, nemotron skipped, then train, eval and results. The
script takes `C:\dev\gpu.lock` itself for train and eval and holds KeepAwake.

**Time estimate, from earlier 30k runs in pm-t3:**
- Training: 1827 s and 2307 s, plus dataset assembly (about 12 min for 110 episodes; less for 27).
- Serial eval, 40 seeds: 35 and 40 min.
- About 1.5 h in all, started after T3's A/B frees the GPU.

## Result

**3/40 successes (7.5%), Wilson 95% CI [2.6%, 19.9%].** Successful seeds: 5050, 5056, 5057.

- **Run.** `hx_human10c_20261020_112039`, ran 11:20–12:37 local, one command, exit 0.
  - Training: 27 episodes, 11,313 frames. 1619 s for 30k steps; final loss 0.065. The 30k checkpoint was evaluated.
  - Eval: serial, 11:50–12:37, 68 s wall per episode.
  - Start pose `dataset_mean` over the 27 training starts.
  - All 40 registered seeds are valid: no `sim_error` / `policy_error`, none missing.
- **Failures** (37 episodes, every one ended by the 30 s limit; the eval's reasons, one episode can have several):

  | Reasons | Episodes |
  |---|---|
  | not_in_bin, dropped | 19 |
  | not_in_bin only | 9 |
  | not_in_bin, collision, dropped | 3 |
  | not_in_bin, gripper_closed, collision, dropped | 3 |
  | not_in_bin, gripper_closed | 2 |
  | not_in_bin, gripper_closed, dropped | 1 |

  - Totals: not_in_bin 37, dropped 26, gripper_closed 6, collision 6.
  - Drops dominate, as in the sprint 7/8 and grasp-fix runs ([grasp fix](2026-10-18-t3-grasp-fix.md)).
- **Files.**
  - `C:\dev\pm-t6\data\human_exp\human10c\results.json`.
  - `C:\dev\pm-t6\data\evals\hx_human10c_20261020_112039\perfected_multiply_10.json`, with per-seed episodes and
    the eval log.
  - The registry row in `C:\dev\pm-t6\data\results\registry.jsonl`.
- **Reading it.** This is a single arm, so it shows how well the policy does, not that it beats anything.
  - The data is small and narrow: 27 episodes from 3 human roots (7 / 10 / 10).
  - For reference only, not a comparison: the scripted-expert runs got 17/40 from 110 episodes over 10 roots
    (sprint 7, 10×10), with a different source, size and spread.
  - The interval's upper end (about 20%) caps what this data gives today. More verified roots, from re-recorded or
    keyboard demos, is the obvious lever; the drops are the failure to fix.
- **Not done.** Nothing was published (`--publish-results` refuses a one-arm run), and nothing was pushed.
