"""Parsers for model output. Models return messy text; a bad reply must
degrade to "nothing proposed", never raise and never invent data.
"""
from __future__ import annotations

import pytest

from app.ai.commands import _parse
from app.ai.vision import _parse_candidates


# --- vision candidates ------------------------------------------------------

def test_candidates_parse_clean_json():
    out = _parse_candidates('[{"label": "lamp", "category": "electronics", "count": 2, "uncertainty_note": "half hidden"}]')
    assert [(c.label, c.category, c.count, c.uncertainty_note) for c in out] == [("lamp", "electronics", 2, "half hidden")]


def test_candidates_survive_prose_and_code_fences():
    out = _parse_candidates('Here you go:\n```json\n[{"label": "mug"}]\n```\nHope that helps!')
    assert [c.label for c in out] == ["mug"]


@pytest.mark.parametrize(
    "raw",
    ["", "   ", "I can't see anything", "{}", '{"label": "lamp"}', '[{"label": "lamp", "categ', "[[[", "null"],
    ids=["empty", "blank", "prose", "empty-object", "object-not-list", "truncated", "garbage", "null"],
)
def test_candidates_fail_safe_to_empty_list(raw):
    assert _parse_candidates(raw) == []


def test_candidates_truncated_array_keeps_only_the_complete_items():
    # A reply cut off by max_tokens (finish_reason "length"). Complete elements
    # are kept, the cut-off one is dropped. Still only proposals: the user
    # reviews every candidate before it becomes inventory.
    out = _parse_candidates('[{"label": "lamp", "count": 1}, {"label": "mu')
    assert [c.label for c in out] == ["lamp"]


def test_candidates_skip_bad_entries_and_keep_good_ones():
    out = _parse_candidates('[{"label": "lamp"}, "junk", 5, null, {"category": "no label"}, {"label": "  "}, {"label": "mug"}]')
    assert [c.label for c in out] == ["lamp", "mug"]


@pytest.mark.parametrize("count, expected", [(3, 3), ("4", 4), ("two", 1), (None, 1), (0, 1), (2.9, 2), ([], 1)])
def test_candidate_count_is_coerced_to_an_int_with_default_one(count, expected):
    import json

    out = _parse_candidates(json.dumps([{"label": "lamp", "count": count}]))
    assert out[0].count == expected


def test_candidate_missing_optional_fields_default_to_empty_strings():
    (c,) = _parse_candidates('[{"label": "lamp"}]')
    assert (c.category, c.uncertainty_note) == ("", "")


# --- chat commands ----------------------------------------------------------

def test_command_parses_a_full_object():
    cmd = _parse('{"action": "move", "item_name": "lamp", "location_name": "shelf", "question": null}')
    assert (cmd.action, cmd.item_name, cmd.location_name, cmd.question) == ("move", "lamp", "shelf", None)


def test_command_empty_strings_become_none():
    cmd = _parse('{"action": "trash", "item_name": "", "location_name": "", "question": ""}')
    assert (cmd.item_name, cmd.location_name, cmd.question) == (None, None, None)


@pytest.mark.parametrize(
    "raw",
    ["", "no idea what you mean", "[]", '{"action": "sudo rm -rf"}', '{"action": null}', '{"action": "trash", "item', "42"],
)
def test_command_anything_unclear_is_unknown(raw):
    assert _parse(raw).action == "unknown"


def test_command_action_names_are_an_allowlist():
    # trash/move/query also need their target fields, else they degrade to unknown.
    full = '"item_name": "lamp", "location_name": "desk", "question": "where?"'
    for action in ("trash", "organize", "move", "query", "unknown"):
        assert _parse('{"action": "%s", %s}' % (action, full)).action == action
    assert _parse('{"action": "Trash", %s}' % full).action == "unknown"  # exact match only
