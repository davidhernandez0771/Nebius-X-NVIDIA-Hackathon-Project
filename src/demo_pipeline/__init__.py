"""Perfect-then-multiply pipeline core: pure Python (numpy + pydantic only).

Imported by both the FastAPI backend (SANT venv) and the Isaac Lab sim worker
(Python 3.12 venv), so nothing here may import Isaac, torch, or the web stack.
Spec: docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md
"""

PIPELINE_VERSION = "0.1.0"
