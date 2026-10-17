"""sim_worker.http_client.post_json: retries a dropped connection (multiply is idempotent by seed)."""

from __future__ import annotations

import json
import socket
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from sim_worker.http_client import WorkerError, post_json


def _server(behaviour):
    """behaviour(n) for the n-th request (1-based): 'reset' aborts the connection, else (status, body dict)."""
    count = {"n": 0}

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_POST(self):  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            count["n"] += 1
            what = behaviour(count["n"])
            if what == "reset":
                self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
                self.connection.close()  # RST, like WinError 10054 on the client
                self.close_connection = True
                return
            status, body = what
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, count


@pytest.fixture
def make():
    servers = []

    def _make(behaviour):
        srv, count = _server(behaviour)
        servers.append(srv)
        return f"http://127.0.0.1:{srv.server_address[1]}/multiply", count

    yield _make
    for s in servers:
        s.shutdown()


def test_ok_on_the_first_try(make):
    url, count = make(lambda n: (200, {"ok": n}))
    assert post_json(url, b"{}", retries=2, wait_s=0) == {"ok": 1}
    assert count["n"] == 1


def test_a_reset_connection_is_retried(make):
    url, count = make(lambda n: "reset" if n == 1 else (200, {"ok": n}))
    assert post_json(url, b"{}", retries=2, wait_s=0) == {"ok": 2}
    assert count["n"] == 2


def test_busy_is_retried_after_waiting(make):
    url, count = make(lambda n: (409, {"error": "busy", "detail": "x"}) if n < 3 else (200, {"ok": n}))
    assert post_json(url, b"{}", retries=3, wait_s=0) == {"ok": 3}


def test_gives_up_after_the_retries(make):
    url, count = make(lambda n: "reset")
    with pytest.raises(ConnectionError):
        post_json(url, b"{}", retries=2, wait_s=0)
    assert count["n"] == 3


def test_client_errors_are_not_retried(make):
    url, count = make(lambda n: (422, {"error": "invalid", "detail": "bad body"}))
    with pytest.raises(WorkerError) as e:
        post_json(url, b"{}", retries=3, wait_s=0)
    assert e.value.status == 422 and "bad body" in str(e.value)
    assert count["n"] == 1
