"""Chat command execution: the model proposes, the backend validates.
Every Nemotron call is mocked -- no network, no spend."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import models
from app.db import _get_session_factory, init_db
from app.main import app


def parsed(action, item=None, location=None, question=None):
    return NS(
        text=json.dumps({"action": action, "item_name": item, "location_name": location, "question": question}),
        est_cost_usd=0.00003,
    )


class ChatActionTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env = patch.dict(
            os.environ,
            {"APP_DB_PATH": str(Path(self._tmpdir.name) / "t.db"), "APP_UPLOAD_DIR": str(Path(self._tmpdir.name) / "u")},
        )
        self._env.start()
        init_db()
        self.client = TestClient(app)
        self.db = _get_session_factory()()
        room = models.Room(owner_id="local-owner", name="Bedroom")
        self.db.add(room)
        self.db.flush()
        self.room_id = room.id
        self.desk = self._location("Desk")
        self.shelf = self._location("Top Shelf")

    def tearDown(self):
        self.db.close()
        self._env.stop()
        self._tmpdir.cleanup()

    # -- helpers ----------------------------------------------------------
    def _location(self, name, room_id=None):
        loc = models.Location(room_id=room_id or self.room_id, name=name)
        self.db.add(loc)
        self.db.commit()
        return loc

    def _item(self, name, location=None, status="active", quantity=1):
        item = models.Item(
            room_id=self.room_id, location_id=(location or self.desk).id, name=name, status=status, quantity=quantity
        )
        self.db.add(item)
        self.db.commit()
        return item

    def _say(self, text, model_reply, room_id=None):
        """Send one chat message with Nemotron's command parse mocked."""
        with patch("app.ai.commands.chat", return_value=model_reply) as m:
            r = self.client.post("/api/chat", json={"text": text, "room_id": room_id or self.room_id})
        self.assertEqual(m.call_count, 1)
        return r

    def _refresh(self, obj):
        self.db.expire_all()
        return self.db.get(type(obj), obj.id)

    def _moves(self):
        self.db.expire_all()
        return self.db.query(models.Move).all()

    # -- room ownership ---------------------------------------------------
    def test_unknown_room_is_404_and_calls_no_model(self):
        with patch("app.ai.commands.chat") as m:
            r = self.client.post("/api/chat", json={"text": "trash the lamp", "room_id": 999})
        self.assertEqual(r.status_code, 404)
        m.assert_not_called()

    def test_other_owners_room_is_404(self):
        other = models.Room(owner_id="someone-else", name="Theirs")
        self.db.add(other)
        self.db.commit()
        with patch("app.ai.commands.chat") as m:
            r = self.client.post("/api/chat", json={"text": "trash the lamp", "room_id": other.id})
        self.assertEqual(r.status_code, 404)
        m.assert_not_called()

    # -- "I didn't understand" -------------------------------------------
    def test_unparseable_and_unknown_and_incomplete_are_not_understood(self):
        lamp = self._item("lamp")
        for reply in [
            NS(text="lol no idea", est_cost_usd=0.0),
            parsed("unknown"),
            parsed("trash"),  # "trash it": no target
            parsed("move", item="lamp"),  # no destination
        ]:
            body = self._say("do something", reply).json()
            self.assertEqual((body["action"], body["result"]), ("unknown", "I didn't understand that."))
        self.assertEqual(self._refresh(lamp).status, "active")
        self.assertEqual(self._moves(), [])

    # -- trash ------------------------------------------------------------
    def test_trash_success_logs_command(self):
        lamp = self._item("Desk Lamp")
        body = self._say("trash the lamp", parsed("trash", item="lamp")).json()
        self.assertEqual(body["action"], "trash")
        self.assertEqual(self._refresh(lamp).status, "trash")
        cmd = self.db.query(models.Command).one()
        self.assertEqual((cmd.parsed_action, cmd.target_item_id), ("trash", lamp.id))

    def test_trash_item_that_does_not_exist_changes_nothing(self):
        lamp = self._item("lamp")
        body = self._say("trash the toaster", parsed("trash", item="toaster")).json()
        self.assertEqual(body["action"], "unknown")
        self.assertIn("couldn't find", body["result"])
        self.assertEqual(self._refresh(lamp).status, "active")

    def test_trash_already_trashed_item_says_so(self):
        self._item("lamp", status="trash")
        body = self._say("trash the lamp", parsed("trash", item="lamp")).json()
        self.assertEqual(body["action"], "unknown")
        self.assertIn("already in the trash", body["result"])

    def test_trash_ambiguous_match_asks_instead_of_guessing(self):
        a, b = self._item("blue book"), self._item("red book")
        body = self._say("trash the book", parsed("trash", item="book")).json()
        self.assertEqual(body["action"], "unknown")
        self.assertIn("more than one", body["result"])
        self.assertEqual((self._refresh(a).status, self._refresh(b).status), ("active", "active"))

    def test_exact_name_wins_over_partial_matches(self):
        book, notebook = self._item("book"), self._item("notebook")
        self._say("trash the book", parsed("trash", item="book"))
        self.assertEqual((self._refresh(book).status, self._refresh(notebook).status), ("trash", "active"))

    def test_sql_wildcards_in_model_output_are_literal(self):
        lamp = self._item("lamp")
        for name in ["%", "_", "%%", "l_mp"]:
            body = self._say("trash it", parsed("trash", item=name)).json()
            self.assertEqual(body["action"], "unknown", name)
        self.assertEqual(self._refresh(lamp).status, "active")

    def test_cannot_trash_item_in_another_room(self):
        other = models.Room(owner_id="local-owner", name="Kitchen")
        self.db.add(other)
        self.db.flush()
        loc = models.Location(room_id=other.id, name="Counter")
        self.db.add(loc)
        self.db.flush()
        kettle = models.Item(room_id=other.id, location_id=loc.id, name="kettle")
        self.db.add(kettle)
        self.db.commit()
        body = self._say("trash the kettle", parsed("trash", item="kettle")).json()
        self.assertEqual(body["action"], "unknown")
        self.assertEqual(self._refresh(kettle).status, "active")

    # -- move -------------------------------------------------------------
    def test_move_success_records_move(self):
        lamp = self._item("lamp", self.desk)
        body = self._say("move the lamp to the shelf", parsed("move", item="lamp", location="shelf")).json()
        self.assertEqual(body["action"], "move")
        self.assertEqual(self._refresh(lamp).location_id, self.shelf.id)
        (move,) = self._moves()
        self.assertEqual((move.previous_location_id, move.new_location_id), (self.desk.id, self.shelf.id))

    def test_move_to_unknown_location_changes_nothing(self):
        lamp = self._item("lamp")
        body = self._say("move lamp to garage", parsed("move", item="lamp", location="garage")).json()
        self.assertEqual(body["action"], "unknown")
        self.assertIn("couldn't find a location", body["result"])
        self.assertEqual(self._refresh(lamp).location_id, self.desk.id)
        self.assertEqual(self._moves(), [])

    def test_move_to_location_in_another_room_is_not_found(self):
        other = models.Room(owner_id="local-owner", name="Kitchen")
        self.db.add(other)
        self.db.flush()
        self._location("Garage", room_id=other.id)
        lamp = self._item("lamp")
        body = self._say("move lamp to garage", parsed("move", item="lamp", location="garage")).json()
        self.assertEqual(body["action"], "unknown")
        self.assertEqual(self._refresh(lamp).location_id, self.desk.id)

    def test_move_unknown_or_trashed_or_ambiguous_item(self):
        self._item("scarf", status="trash")
        self._item("blue book")
        self._item("red book")
        for item, expect in [("toaster", "couldn't find"), ("scarf", "already in the trash"), ("book", "more than one")]:
            body = self._say("move it", parsed("move", item=item, location="shelf")).json()
            self.assertEqual(body["action"], "unknown", item)
            self.assertIn(expect, body["result"], item)
        self.assertEqual(self._moves(), [])

    def test_move_to_where_it_already_is_is_a_noop(self):
        self._item("lamp", self.desk)
        body = self._say("move lamp to desk", parsed("move", item="lamp", location="desk")).json()
        self.assertEqual(body["action"], "unknown")
        self.assertIn("already in", body["result"])
        self.assertEqual(self._moves(), [])

    def test_move_ambiguous_location_asks(self):
        self._location("Shelf Left")
        self._item("lamp")
        body = self._say("move lamp to shelf", parsed("move", item="lamp", location="shelf")).json()
        self.assertEqual(body["action"], "unknown")
        self.assertIn("more than one location", body["result"])
        self.assertEqual(self._moves(), [])

    # -- organize (proposal only) -----------------------------------------
    def test_organize_stores_proposal_and_moves_nothing(self):
        lamp = self._item("lamp", self.desk)
        with patch("app.ai.organize.chat", return_value=NS(text="- Put the lamp on the shelf.", est_cost_usd=0.00002)) as m:
            body = self._say("organize my room", parsed("organize")).json()
        self.assertEqual(body["action"], "organize")
        self.assertIn("Put the lamp on the shelf", body["result"])
        self.assertAlmostEqual(body["est_cost_usd"], 0.00005)
        self.assertIn("lamp", m.call_args.args[0])
        proposal = self.db.query(models.Proposal).one()
        self.assertEqual(proposal.status, "pending")
        self.assertEqual(self._refresh(lamp).location_id, self.desk.id)
        self.assertEqual(self._moves(), [])

    def test_organize_scoped_to_location_sends_only_that_location(self):
        self._item("lamp", self.desk)
        self._item("towel", self.shelf)
        with patch("app.ai.organize.chat", return_value=NS(text="ok", est_cost_usd=0.0)) as m:
            self._say("organize my desk", parsed("organize", location="desk"))
        sent = m.call_args.args[0]
        self.assertIn("lamp", sent)
        self.assertNotIn("towel", sent)

    def test_organize_with_nothing_makes_no_second_model_call(self):
        self._item("old thing", status="trash")
        with patch("app.ai.organize.chat") as m:
            body = self._say("organize", parsed("organize")).json()
        m.assert_not_called()
        self.assertIn("nothing to organize", body["result"])
        self.assertEqual(self.db.query(models.Proposal).count(), 0)

    def test_organize_unknown_location(self):
        self._item("lamp")
        with patch("app.ai.organize.chat") as m:
            body = self._say("organize the garage", parsed("organize", location="garage")).json()
        m.assert_not_called()
        self.assertIn("couldn't find a location", body["result"])

    # -- query (read only) ------------------------------------------------
    def test_query_item_location_is_answered_without_a_model(self):
        self._item("keys", self.shelf, quantity=2)
        with patch("app.ai.query.chat") as m:
            body = self._say("where are my keys?", parsed("query", item="keys", question="where are my keys")).json()
        m.assert_not_called()
        self.assertEqual(body["action"], "query")
        self.assertIn("Top Shelf", body["result"])

    def test_query_missing_and_trashed_items(self):
        self._item("scarf", status="trash")
        missing = self._say("where is my hat", parsed("query", item="hat", question="where is my hat")).json()
        self.assertIn("couldn't find", missing["result"])
        trashed = self._say("where is my scarf", parsed("query", item="scarf", question="where is my scarf")).json()
        self.assertIn("in the trash", trashed["result"])

    def test_query_location_lists_items(self):
        self._item("lamp", self.desk)
        self._item("towel", self.shelf)
        body = self._say("what's on my desk", parsed("query", location="desk", question="what's on my desk")).json()
        self.assertIn("lamp", body["result"])
        self.assertNotIn("towel", body["result"])

    def test_general_query_is_grounded_on_active_items_and_read_only(self):
        lamp = self._item("lamp")
        self._item("ghost", status="trash")
        with patch("app.ai.query.chat", return_value=NS(text="You have 1 item.", est_cost_usd=0.00001)) as m:
            body = self._say("how many things do I own", parsed("query", question="how many things do I own")).json()
        self.assertEqual(body["result"], "You have 1 item.")
        sent = m.call_args.args[0]
        self.assertIn("lamp", sent)
        self.assertNotIn("ghost", sent)
        self.assertEqual(self._refresh(lamp).status, "active")

    def test_query_on_empty_inventory_needs_no_model(self):
        with patch("app.ai.query.chat") as m:
            body = self._say("how many things", parsed("query", question="how many things")).json()
        m.assert_not_called()
        self.assertIn("empty", body["result"])

    # -- item move endpoint validation ------------------------------------
    def test_move_endpoint_rejects_trashed_item_and_foreign_location(self):
        trashed = self._item("scarf", status="trash")
        r = self.client.post(f"/api/items/{trashed.id}/moves", json={"new_location_id": self.shelf.id})
        self.assertEqual(r.status_code, 409)
        other = models.Room(owner_id="local-owner", name="Kitchen")
        self.db.add(other)
        self.db.flush()
        foreign = self._location("Counter", room_id=other.id)
        lamp = self._item("lamp")
        r = self.client.post(f"/api/items/{lamp.id}/moves", json={"new_location_id": foreign.id})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self._moves(), [])


if __name__ == "__main__":
    unittest.main()
