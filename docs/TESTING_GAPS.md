# Testing gaps

Result of reading the backend (`src/app/`) and `src/nebius_llm/` against the
tests. Written 2026-09-18. Run everything with `uv run pytest -q`; all AI calls
are mocked and the suite blocks the real Nebius client (see `tests/conftest.py`).

Baseline was 29 tests, all for `nebius_llm` config/client/usage plus one happy
path per API area. Now 99 pass and 8 are marked `xfail` (known bugs, below).

## Covered now

| Area | File |
|---|---|
| Chat command validation: trash existing / missing / already-trashed / other-room / no-name item; ambiguous, malformed, truncated and invented-action model output all return "I didn't understand that." and change nothing; model failure is 502 with no side effects; commands are logged | `tests/test_chat_commands.py` |
| Model-output parsers: vision candidates (fences, prose, truncated JSON, bad entries, count coercion) and command parsing (action allowlist) | `tests/test_ai_parsing.py` |
| Design rule: analyzing a photo never creates an item; review is the only path; organize never moves items; only active items reach the organize prompt | `tests/test_backend_validation.py` |
| Review, items, moves, photo upload/analyze, organize error paths (400/404/502) | `tests/test_backend_validation.py` |
| `chat_vision` request shape, usage logging tier and `finish_reason`, no default retries | `tests/test_vision_client.py` |

Also fixed: the old suite wrote its mocked calls (10 in / 5 out) into the real
`usage_log.jsonl`, which pollutes spend tracking. `conftest.py` now redirects it.

## Real bugs found (each has a strict `xfail` test)

These behaviors are wrong today. The tests are `xfail(strict=True)`: when a bug
is fixed, its test fails with XPASS, and you delete the marker.

| # | Bug | Test |
|---|---|---|
| 1 | "Trash the cable" with two matching items trashes one arbitrarily (`.first()` on an ILIKE match). Should ask or refuse. | `test_ambiguous_item_name_matching_several_items_must_not_guess` |
| 2 | A model-supplied name of `%` (or `_`) is an ILIKE wildcard and matches every item. | `test_wildcard_characters_in_a_model_supplied_name_are_not_patterns` |
| 3 | Chat never checks that `room_id` exists or belongs to the caller ("is yours"). Rooms have `owner_id`, but only the rooms router checks it. | `test_cannot_trash_items_in_a_room_owned_by_someone_else`, `test_chat_on_a_nonexistent_room_is_404` |
| 4 | Reviewing a candidate as "organize" twice creates a duplicate item. | `test_reviewing_a_candidate_twice_does_not_duplicate_the_item` |
| 5 | `POST /items/{id}/moves` accepts a location from a different room. | `test_move_to_a_location_in_another_room_is_rejected` |
| 6 | `PATCH /items/{id}` accepts any `status` string (e.g. "banana"), so an item can leave both "active" and "trash". | `test_update_item_rejects_an_invalid_status` |
| 7 | `POST /organize` accepts a nonexistent `room_id` and stores a proposal for it. | `test_organize_unknown_room_is_404` |

## Still untested

Lower value or blocked on unbuilt behavior. In rough priority order.

1. **Chat `move`, `organize`, `query`.** They return a "not wired up yet"
   message. When they are wired, each needs the same validation tests as trash
   (item exists, is active, is in this room, target location exists in this
   room, ambiguous name refused).
2. **Ownership everywhere else.** `list_items`, `list_locations`, `update_item`,
   `move_item`, `review_candidate`, photo and scan upload never check the
   room's `owner_id`. Only `get_room` and `create_location` do, and only
   `get_room` is tested by anything close to it. Moot while there is a single
   fixed `DEV_OWNER_ID`, but it needs tests once auth exists.
3. **Spend guards.** Analyzing the same photo twice makes two billed calls and
   duplicates its candidates. Organize on an empty room and chat with empty
   text still call the model. No test pins the intended behavior yet.
4. **Negative or zero quantities.** `PATCH` accepts `quantity: -5`; a candidate
   `count` of -3 passes the parser unchanged (0 becomes 1).
5. **Partial vision output.** A reply cut off at `max_tokens` discards the whole
   array, including complete items (`test_candidates_truncated_array_...`
   documents this, it does not assert it is desired).
6. **Upload limits.** 20 MB photo and 200 MB scan size caps have no test.
   HEIC/HEIF is accepted but never converted; whether a vision model can read
   it is unverified.
7. **Proposal lifecycle.** `Proposal.status` is only ever "pending"; there is no
   accept/dismiss endpoint to test yet.
8. **Client edge cases.** `chat()` with `think=True` on the real API, 5xx retry
   paths, and `Retry-After` handling are only partly covered by `test_client.py`.
9. **Frontend.** `web/` has no test runner or tests at all.
10. **Real-model behavior.** Every AI test uses a mocked reply. Whether Nemotron
    actually returns "unknown" for ambiguous commands, and whether MiniCPM /
    GLM Flash return parseable candidates, can only be checked with real (billed)
    calls. That belongs in an opt-in script, not in `pytest`.
