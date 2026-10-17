"""Render the results file as standalone SVG charts for the README (pure Python, no plotting library).

    uv run python scripts/render_charts.py                       # DATA_DIR/results/results.json -> .../charts/
    uv run python scripts/render_charts.py --results web/src/pm/mocks/results.sample.json --out docs/media

Writes success.svg (policy success vs human demos), ablation.svg (rules-only vs rules + Nemotron repair) and
yield.svg (our multiplication yield against MimicGen's published 38-74%); and comparison.svg (each named pair of
cells with its Wilson CIs and Fisher's p) when results.json has comparisons (build_results_json.py --compare).

- **Null values.** A null value (not measured yet) is drawn as a "pending" mark, never as 0. A line only
  joins consecutive measured points.
- **Uncertainty.** A point whose sources entry has a Wilson CI (`sources["series.<key>.success[<j>]"]["ci"]`,
  from demo_pipeline.results) gets an error bar and a "successes/n" label. Series are dodged sideways so
  bars at the same demo count don't overlap.
- **Sample data.** Like web/src/pm/results/results.ts, a file counts as real only when it says
  "sample": false. Anything else gets a SAMPLE watermark.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import NamedTuple
from xml.sax.saxutils import escape, quoteattr

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demo_pipeline.paths import data_dir  # noqa: E402

FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"
COLORS = {"raw": "#6b7280", "raw_multiply": "#2563eb", "ours": "#16a34a", "rules": "#d97706"}
PALETTE = ("#7c3aed", "#db2777", "#0891b2", "#65a30d")
PENDING = "#9ca3af"
DODGE = 10.0  # px between neighbouring series at the same demo count


class Geometry(NamedTuple):
    width: int
    height: int
    left: float
    right: float
    top: float
    bottom: float


GEOMETRY = Geometry(width=680, height=420, left=64, right=470, top=48, bottom=300)  # the success chart
BAR_X, BAR_WIDTH = 220.0, 380.0  # the ablation and yield bars: x of 0%, length of 100%


def _rate(v, what: str) -> float | None:
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or math.isnan(v) or not 0.0 <= v <= 1.0:
        raise ValueError(f"{what} must be a rate in [0, 1] or null, got {v!r}")
    return float(v)


def _pct(v: float) -> str:
    return f"{round(v * 100)}%"


def _color(key: str, i: int) -> str:
    return COLORS.get(key, PALETTE[i % len(PALETTE)])


def _text(x, y, s, *, size=12, anchor="start", fill="#111827", cls=None, weight=None, extra="") -> str:
    attrs = f'x="{x:.1f}" y="{y:.1f}" font-size="{size}" text-anchor="{anchor}" fill="{fill}"'
    if cls:
        attrs += f' class="{cls}"'
    if weight:
        attrs += f' font-weight="{weight}"'
    return f"<text {attrs}{extra}>{escape(str(s))}</text>"


def _svg(width: int, height: int, title: str, body: list[str], sample: bool) -> str:
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" '
           f'height="{height}" role="img" aria-labelledby="t" font-family={quoteattr(FONT)}>',
           f"<title id=\"t\">{escape(title + (' (SAMPLE DATA)' if sample else ''))}</title>",
           f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>', *body]
    if sample:
        out.append(_text(width / 2, height / 2 + 24, "SAMPLE", size=min(96, height // 2), anchor="middle",
                         fill="#dc2626", cls="watermark", weight="700",
                         extra=f' opacity="0.22" transform="rotate(-18 {width / 2:.1f} {height / 2:.1f})"'))
    out.append("</svg>")
    return "\n".join(out) + "\n"


def _is_sample(results: dict) -> bool:
    return results.get("sample") is not False


def _pending(x: float, y: float, color: str) -> str:
    """A hollow dashed dot in the series' colour and the word "pending", on one line centred on x."""
    return (f'<g class="pending"><circle cx="{x - 22:.1f}" cy="{y - 4:.1f}" r="3.5" fill="none" stroke="{color}" '
            f'stroke-width="1.5" stroke-dasharray="2 1.5"/>{_text(x - 14, y, "pending", size=10, fill=PENDING)}</g>')


def _checked_ci(ci: dict | None, v: float, what: str) -> dict | None:
    """A CI as demo_pipeline.results writes it, checked: low <= value <= high, all rates."""
    if ci is None:
        return None
    low, high = _rate(ci.get("low"), f"{what} ci low"), _rate(ci.get("high"), f"{what} ci high")
    if low is None or high is None or not low - 1e-9 <= v <= high + 1e-9:
        raise ValueError(f"{what} ci must be rates with low <= {v} <= high, got {ci!r}")
    return {**ci, "low": low, "high": high}


def _ci(results: dict, key: str, j: int, v: float) -> dict | None:
    """The point's CI from its sources entry."""
    return _checked_ci(((results.get("sources") or {}).get(f"series.{key}.success[{j}]") or {}).get("ci"), v,
                       f"{key}[{j}]")


def _error_bar(x: float, y_low: float, y_high: float, color: str) -> list[str]:
    cap = [f'<line class="ci-cap" x1="{x - 4:.1f}" x2="{x + 4:.1f}" y1="{y:.1f}" y2="{y:.1f}" stroke="{color}" '
           f'stroke-width="1.5"/>' for y in (y_high, y_low)]
    return [f'<line class="ci" x1="{x:.1f}" x2="{x:.1f}" y1="{y_high:.1f}" y2="{y_low:.1f}" stroke="{color}" '
            f'stroke-width="1.5"/>', *cap]


def success_chart(results: dict) -> str:
    """Policy success (0-100%) against the number of human demos; one line per series."""
    g = GEOMETRY
    demos = list(results["demos"])
    n = len(demos)
    step = (g.right - g.left) / (n - 1) if n > 1 else 0.0
    xs = [g.left + i * step if n > 1 else (g.left + g.right) / 2 for i in range(n)]

    def y_of(v: float) -> float:
        return g.top + (1 - v) * (g.bottom - g.top)

    body = [_text(g.left, 28, "Policy success vs number of human demos", size=15, weight="600")]
    for v in (0.0, 0.25, 0.5, 0.75, 1.0):
        body.append(f'<line class="grid" x1="{g.left}" x2="{g.right}" y1="{y_of(v):.1f}" y2="{y_of(v):.1f}" '
                    f'stroke="#e5e7eb"/>')
        body.append(_text(g.left - 16, y_of(v) + 4, _pct(v), size=11, anchor="end", fill="#6b7280"))
    for x, d in zip(xs, demos):
        body.append(_text(x, g.bottom + 20, d, size=11, anchor="middle", fill="#374151"))
    body.append(_text((g.left + g.right) / 2, g.bottom + 40, "human demos", size=11, anchor="middle", fill="#6b7280"))

    k = len(results["series"])
    any_ci = False
    for i, s in enumerate(results["series"]):
        dx = (i - (k - 1) / 2) * DODGE
        values = list(s["success"])
        if len(values) != n:
            raise ValueError(f"series {s['key']} has {len(values)} values for {n} demo counts")
        values = [_rate(v, f"{s['key']}[{j}]") for j, v in enumerate(values)]
        color = _color(s["key"], i)
        run: list[tuple[float, float]] = []
        for j, v in enumerate(values + [None]):  # the trailing None closes the last run
            if v is not None:
                run.append((xs[j] + dx, y_of(v)))
                continue
            if len(run) >= 2:
                pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in run)
                body.append(f'<polyline class="series" points="{pts}" fill="none" stroke="{color}" stroke-width="2.5"/>')
            run = []
        for j, v in enumerate(values):
            if v is not None:
                x = xs[j] + dx
                ci = _ci(results, s["key"], j, v)
                if ci is not None:
                    any_ci = True
                    body += _error_bar(x, y_of(ci["low"]), y_of(ci["high"]), color)
                    side = -7 if dx < 0 else 7
                    body.append(_text(x + side, y_of(v) + 4, f"{ci['successes']}/{ci['n']}", size=10,
                                      anchor="end" if dx < 0 else "start", fill=color, cls="count"))
                body.append(f'<circle class="point" cx="{x:.1f}" cy="{y_of(v):.1f}" r="4" fill="{color}"/>')
            else:  # under the axis, in the series' row: never on the plot, where it would read as a value
                body.append(_pending(xs[j], g.bottom + 66 + 18 * i, color))
        ly = g.top + 8 + 22 * i
        body.append(f'<line x1="{g.right + 24}" x2="{g.right + 44}" y1="{ly:.1f}" y2="{ly:.1f}" stroke="{color}" '
                    f'stroke-width="2.5"/>')
        body.append(_text(g.right + 50, ly + 4, s["label"], size=12))
    if any_ci:
        cy = g.top + 8 + 22 * k + 14
        body.append(_text(g.right + 24, cy, "Bars: Wilson 95% CI", size=11, fill="#6b7280"))
        body.append(_text(g.right + 24, cy + 16, "k/n: successes / eval episodes", size=11, fill="#6b7280"))
    return _svg(g.width, g.height, "Policy success vs number of human demos", body, _is_sample(results))


def _bar_row(y: float, label: str, value: float | None, color: str) -> list[str]:
    out = [_text(BAR_X - 10, y + 15, label, size=12, anchor="end"),
           f'<rect class="track" x="{BAR_X}" y="{y}" width="{BAR_WIDTH}" height="22" fill="#f3f4f6"/>']
    if value is None:
        out.append(f'<g class="pending"><rect x="{BAR_X}" y="{y}" width="{BAR_WIDTH}" height="22" fill="none" '
                   f'stroke="{PENDING}" stroke-dasharray="4 3"/>'
                   f'{_text(BAR_X + 8, y + 15, "pending", size=11, fill=PENDING)}</g>')
    else:
        out.append(f'<rect class="bar" x="{BAR_X}" y="{y}" width="{value * BAR_WIDTH:.2f}" height="22" fill="{color}"/>')
        out.append(_text(BAR_X + value * BAR_WIDTH + 6, y + 15, _pct(value), size=12, weight="600"))
    return out


def ablation_chart(results: dict) -> str:
    ab = results["ablation"]
    bars = ab["bars"]
    height = 70 + 34 * len(bars)
    body = [_text(16, 26, f"Policy success at {ab['demos']} human demos, by how the demos were repaired",
                  size=14, weight="600")]
    for i, b in enumerate(bars):
        body += _bar_row(44 + 34 * i, b["label"], _rate(b["success"], b["key"]), _color(b["key"], i))
    return _svg(680, height, "Ablation: rules-only vs rules + Nemotron repair", body, _is_sample(results))


def yield_chart(results: dict) -> str:
    y = results["multiply_yield"]
    ours = _rate(y["ours"], "multiply_yield.ours")
    lo, hi = (_rate(v, "mimicgen") for v in y["mimicgen"])
    body = [_text(16, 26, "Multiplication yield: variants that verify in sim", size=14, weight="600"),
            _text(BAR_X - 10, 64, "MimicGen (published)", size=12, anchor="end"),
            f'<rect class="track" x="{BAR_X}" y="49" width="{BAR_WIDTH}" height="22" fill="#f3f4f6"/>',
            f'<rect class="mimicgen" x="{BAR_X + lo * BAR_WIDTH:.2f}" y="49" width="{(hi - lo) * BAR_WIDTH:.2f}" '
            f'height="22" fill="#9ca3af" opacity="0.6"/>',
            _text(BAR_X + hi * BAR_WIDTH + 6, 64, f"{round(lo * 100)}–{_pct(hi)}", size=12)]
    body += _bar_row(83, "Ours", ours, COLORS["ours"])
    for v in (0.0, 0.5, 1.0):
        body.append(_text(BAR_X + v * BAR_WIDTH, 128, _pct(v), size=10, anchor="middle", fill="#6b7280"))
    return _svg(680, 140, "Multiplication yield vs MimicGen", body, _is_sample(results))


def comparison_chart(results: dict) -> str:
    """Each named comparison: one row per arm (rate dot on its Wilson CI band, k/n), then Fisher's p."""
    body = [_text(16, 26, "Head-to-head: success rate with Wilson 95% CI", size=14, weight="600")]
    y = 44.0
    for c in results["comparisons"]:
        for i, arm in enumerate(c["arms"]):
            what = f"comparison {arm['cell']}"
            v = _rate(arm["value"], what)
            color = _color("raw_multiply" if i else "raw", i)
            body.append(_text(BAR_X - 10, y + 15, arm["cell"], size=12, anchor="end"))
            body.append(f'<rect class="track" x="{BAR_X}" y="{y + 4:.1f}" width="{BAR_WIDTH}" height="14" '
                        f'fill="#f3f4f6"/>')
            if v is None:
                body.append(_pending(BAR_X + 30, y + 15, color))
            else:
                ci = _checked_ci(arm.get("ci"), v, what)
                label = _pct(v)
                if ci is not None:
                    lo, hi = ci["low"], ci["high"]
                    body.append(f'<rect class="ci" x="{BAR_X + lo * BAR_WIDTH:.2f}" y="{y + 7:.1f}" '
                                f'width="{(hi - lo) * BAR_WIDTH:.2f}" height="8" fill="{color}" opacity="0.3"/>')
                    label = f"{ci['successes']}/{ci['n']} · {_pct(v)} ({round(lo * 100)}–{_pct(hi)})"
                body.append(f'<circle class="point" cx="{BAR_X + v * BAR_WIDTH:.2f}" cy="{y + 11:.1f}" r="4.5" '
                            f'fill="{color}"/>')
                body.append(_text(BAR_X + BAR_WIDTH + 8, y + 15, label, size=11, fill="#374151"))
            y += 26
        p = c.get("fisher_p")
        p_text = "Fisher exact p: pending" if p is None else f"Fisher exact p = {p:.2g} (two-sided)"
        body.append(_text(BAR_X, y + 12, p_text, size=11, fill="#374151", cls="p-value"))
        y += 30
    for v in (0.0, 0.5, 1.0):
        body.append(_text(BAR_X + v * BAR_WIDTH, y + 6, _pct(v), size=10, anchor="middle", fill="#6b7280"))
    return _svg(800, int(y + 20), "Head-to-head success with Wilson 95% CI", body, _is_sample(results))


CHARTS = {"success.svg": success_chart, "ablation.svg": ablation_chart, "yield.svg": yield_chart}


def render_all(results: dict, out_dir: Path) -> list[Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    charts = {**CHARTS, **({"comparison.svg": comparison_chart} if results.get("comparisons") else {})}
    for name, draw in charts.items():
        (out_dir / name).write_text(draw(results), encoding="utf-8", newline="\n")  # LF, as git stores it
        paths.append(out_dir / name)
    return paths


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--results", type=Path, default=None, help="default DATA_DIR/results/results.json")
    p.add_argument("--out", type=Path, default=None, help="default <results folder>/charts")
    args = p.parse_args(argv)
    path = args.results if args.results is not None else data_dir() / "results" / "results.json"
    if not path.is_file():
        print(f"no results file at {path}; build it with scripts/build_results_json.py, or pass "
              f"--results web/src/pm/mocks/results.sample.json to render the sample")
        return 1
    results = json.loads(path.read_text(encoding="utf-8"))
    for out in render_all(results, args.out if args.out is not None else path.parent / "charts"):
        print(f"wrote {out}")
    if _is_sample(results):
        print("note: this is sample data; every chart carries a SAMPLE watermark")
    return 0


if __name__ == "__main__":
    sys.exit(main())
