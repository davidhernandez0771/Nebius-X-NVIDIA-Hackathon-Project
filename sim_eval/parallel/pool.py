"""A pool of policy sessions: N copies of one checkpoint behind N consecutive ports, in one process.

ACT keeps an action queue per episode, so each env needs its own session. One process holding N runners shares one
CUDA context (N separate servers would each pay for their own), and each port is lerobot_tools.policy_server's own
server, unchanged: its per-server lock serializes one session, while different sessions run in parallel threads.

Run it with the lerobot venv, from this worktree:
    set PYTHONPATH=C:\\dev\\pm-t2\\src;C:\\dev\\pm-t2
    C:\\venvs\\lerobot\\Scripts\\python.exe -m sim_eval.parallel.pool --checkpoint <run dir> --n 4 --base-port 8770
"""

from __future__ import annotations

import argparse
import logging
import threading
from collections.abc import Callable, Sequence
from http.server import ThreadingHTTPServer
from pathlib import Path

log = logging.getLogger("policy_pool")
SAME_FIELDS = ("checkpoint", "policy_type", "state_dim", "cameras")


def pool_urls(n: int, base_port: int, host: str = "127.0.0.1") -> list[str]:
    if n <= 0:
        raise ValueError(f"n must be positive, got {n}")
    return [f"http://{host}:{base_port + i}" for i in range(n)]


def check_pool(healths: Sequence[dict]) -> list[str]:
    """Problems that make a pool unusable: no sessions, or sessions that would not act like one policy."""
    if not healths:
        return ["the pool has no sessions"]
    ref = healths[0]
    return [f"session {i} {f} {h.get(f)!r} != session 0 {ref.get(f)!r}"
            for i, h in enumerate(healths[1:], start=1) for f in SAME_FIELDS if h.get(f) != ref.get(f)]


def serve_pool(runners: Sequence, host: str = "127.0.0.1", base_port: int = 8770) -> list[ThreadingHTTPServer]:
    """Start one policy server per runner on base_port + i (base_port 0: OS-chosen ports), each on a daemon
    thread. Callers stop them with shutdown() + server_close()."""
    from lerobot_tools.policy_server import make_server

    servers = []
    for i, runner in enumerate(runners):
        server = make_server(runner, host, base_port + i if base_port else 0)
        threading.Thread(target=server.serve_forever, name=f"policy-{i}", daemon=True).start()
        servers.append(server)
    return servers


def main(argv: list[str] | None = None, runner_factory: Callable[[Path, str], object] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--n", type=int, required=True, help="number of sessions (= eval envs)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--base-port", type=int, default=8770)
    p.add_argument("--device", default="cuda")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if runner_factory is None:
        from lerobot_tools.policy_server import PolicyRunner

        runner_factory = lambda ckpt, device: PolicyRunner(ckpt, device=device)  # noqa: E731
    runners = [runner_factory(args.checkpoint, args.device) for _ in range(args.n)]
    servers = serve_pool(runners, args.host, args.base_port)
    for s in servers:
        log.info("session on http://%s:%d", args.host, s.server_address[1])
    log.info("serving %d sessions of %s", len(servers), args.checkpoint)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        for s in servers:
            s.shutdown()
            s.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
