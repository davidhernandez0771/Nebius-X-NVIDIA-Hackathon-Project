// The scene picker on /record (demo_pipeline.scene_library, /scenes): "Standard", the recording protocol's S1-S8 and
// saved scenes, each previewed top-down; "Use this scene" asks the live sim for it (set_scene: the same bodies are
// placed again at once, new bodies restart the sim, which checks them in Isaac before anyone records). "Describe a
// scene" asks Nemotron's scene creator (validated, retried with the validator's problems) and previews the plan;
// "Save & use" keeps it as a scene and switches to it. The sim's status says which scene is live, a restart in
// progress, a failed settle check and a recording session's scene list.

import { useEffect, useState } from "react";
import { describeError, pmApi } from "../../pm/api";
import type { SceneDraft, SceneEntry, ScenePlanJson } from "../../pm/types";
import type { RecordSession } from "../../record/useRecordSession";

const BIN_WALL = 0.01; // demo_pipeline.scene_geometry
// demo_pipeline.scene_plan COLORS, for the preview
const FILL: Record<string, string> = {
  red: "#D9352B", blue: "#2F5BC8", green: "#2E9E44", yellow: "#E5C840", orange: "#E07A1F", purple: "#7E3FA8", white: "#E8E8E4", black: "#2A2A2A",
};

/** "2 cubes, 1 bin". */
export function planSummary(plan: ScenePlanJson): string {
  const n = (kind: string) => plan.objects.filter((o) => o.kind === kind).length;
  const word = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return `${word(n("cube"), "cube")}, ${word(n("bin"), "bin")}`;
}

/** Top-down, seen from behind the robot (its left on the left, forward up), in millimetres. Cubes stacked "on" another
 *  are drawn over it. The goal arrows go from each goal's cube to its bin. */
export function PlanPreview({ plan }: { plan: ScenePlanJson }) {
  const pos = new Map<string, { x: number; y: number }>();
  for (const o of plan.objects) if (o.pose) pos.set(o.id, { x: o.pose.x, y: o.pose.y });
  for (const o of plan.objects) if (o.kind === "cube" && !o.pose && o.on) pos.set(o.id, pos.get(o.on) ?? { x: 0.5, y: 0 });
  const sx = (y: number) => -y * 1000;
  const sy = (x: number) => -x * 1000;
  const reach = plan.reach ?? { x: [0.4, 0.65] as [number, number], y: [-0.3, 0.3] as [number, number] };
  return (
    <svg className="rg-plan" viewBox="-420 -780 840 560" role="img" aria-label={`Scene preview: ${planSummary(plan)}`}>
      <rect x={sx(reach.y[1])} y={sy(reach.x[1])} width={(reach.y[1] - reach.y[0]) * 1000} height={(reach.x[1] - reach.x[0]) * 1000}
        className="rg-plan__reach" />
      <text x={0} y={-235} className="rg-plan__label" textAnchor="middle">robot ↓</text>
      {plan.objects.map((o) => {
        const p = pos.get(o.id);
        if (!p) return null;
        const yaw = o.pose?.yaw_deg ?? 0;
        if (o.kind === "bin") {
          const w = (o.inner[1] + 2 * BIN_WALL) * 1000;
          const h = (o.inner[0] + 2 * BIN_WALL) * 1000;
          return (
            <g key={o.id} data-object={o.id} transform={`translate(${sx(p.y)} ${sy(p.x)}) rotate(${-yaw})`}>
              <rect x={-w / 2} y={-h / 2} width={w} height={h} className="rg-plan__bin" />
              <rect x={-w / 2 + 10} y={-h / 2 + 10} width={w - 20} height={h - 20} className="rg-plan__bin-in" />
              <text y={4} textAnchor="middle" className="rg-plan__label">{o.id}</text>
            </g>
          );
        }
        const s = o.size * 1000;
        return (
          <g key={o.id} data-object={o.id} transform={`translate(${sx(p.y)} ${sy(p.x)}) rotate(${-yaw})`}>
            <rect x={-s / 2} y={-s / 2} width={s} height={s} fill={FILL[o.color] ?? "#ccc"} className="rg-plan__cube" />
          </g>
        );
      })}
      {plan.goals.map((g) => {
        const a = pos.get(g.object);
        const b = pos.get(g.bin);
        return a && b ? (
          <line key={`${g.object}-${g.bin}`} x1={sx(a.y)} y1={sy(a.x)} x2={sx(b.y)} y2={sy(b.x)} className="rg-plan__goal" markerEnd="url(#rg-plan-arrow)" />
        ) : null;
      })}
      <defs>
        <marker id="rg-plan-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="rg-plan__arrow" />
        </marker>
      </defs>
    </svg>
  );
}

function settleText(e: SceneEntry): string {
  if (!e.needs_settle) return "today's bodies: switches in the running sim";
  if (e.settle?.hash === e.hash) return e.settle.ok ? "settle check passed in Isaac" : `settle check failed: ${e.settle.errors.join("; ")}`;
  return "new bodies: the sim restarts and checks it in Isaac before you record (about a minute)";
}

export function ScenePicker({ id, open, onClose, session }: { id: string; open: boolean; onClose: () => void; session: RecordSession }) {
  const [scenes, setScenes] = useState<SceneEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<SceneDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const live = session.sim?.scene ?? null;

  const load = () =>
    pmApi.listScenes().then(
      (list) => setScenes(list),
      (e: unknown) => setNote(describeError(e)),
    );
  useEffect(() => {
    if (open) void load();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = scenes?.find((s) => s.id === selected) ?? null;
  const canSwitch = session.simReady && !session.recording && !live?.switching;
  const use = (sceneId: string) => {
    if (session.setScene(sceneId)) setNote(`asked the sim for ${sceneId}`);
  };

  const create = async () => {
    setBusy(true);
    setNote(null);
    try {
      setDraft(await pmApi.createScene(text.trim()));
    } catch (e) {
      setNote(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  const saveAndUse = async () => {
    if (!draft?.plan) return;
    setBusy(true);
    try {
      const entry = await pmApi.saveScene(text.trim().slice(0, 80) || "Scene", draft.plan, text.trim());
      await load();
      setSelected(entry.id);
      setDraft(null);
      use(entry.id);
    } catch (e) {
      setNote(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rc-drawer" hidden={!open}>
      <div className="rc-drawer__scrim" onClick={onClose} aria-hidden="true" />
      <div id={id} className="rc-drawer__panel rg-scenes" role="dialog" aria-modal="true" aria-label="Scenes"
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
        <header className="rc-drawer__head">
          <h2 className="rc-drawer__title">Scenes</h2>
          <button type="button" className="rc-btn rc-btn--icon" aria-label="Close scenes" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="rc-hint">
          Live: <b>{live?.name ?? "Standard (today's)"}</b>
          {live?.playlist && (
            <span className="rg-scenes__list">{`scene list ${live.playlist.index + 1} of ${live.playlist.of} · take ${live.playlist.take + 1} of ${live.playlist.takesPerScene}`}</span>
          )}
        </p>
        {live?.switching && (
          <p className="rc-hint" role="status">{`switching to ${live.switching}: the sim restarts (about a minute)`}</p>
        )}
        {live?.settle && !live.settle.ok && (
          <p className="rc-hint rc-hint--issue" role="alert">{`settle check failed: ${live.settle.errors.join("; ")}`}</p>
        )}
        <ul className="rg-scenes__items" aria-label="Scenes">
          {(scenes ?? []).map((s) => (
            <li key={s.id}>
              <button type="button" className="rg-scenes__item" title={s.name} aria-pressed={selected === s.id} data-live={live?.id === s.id || undefined}
                onClick={() => (setSelected(s.id), setDraft(null))}>
                <b>{s.name}</b>
                {s.needs_settle && <span className="rg-scenes__tag">new bodies</span>}
              </button>
            </li>
          ))}
        </ul>
        {chosen && !draft && (
          <section className="rg-scenes__chosen">
            <PlanPreview plan={chosen.plan} />
            <p className="rc-hint">{chosen.description}</p>
            <p className="rc-hint">{settleText(chosen)}</p>
            <button type="button" className="rc-btn" disabled={!canSwitch || live?.id === chosen.id} onClick={() => use(chosen.id)}>
              Use this scene
            </button>
          </section>
        )}
        <section className="rg-scenes__describe">
          <label className="rc-field">
            <span className="rc-field__row">
              <span>Describe a scene</span>
            </span>
            <textarea aria-label="Describe a scene" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="e.g. a green cube left of the red one; the red one goes in the bin" />
          </label>
          <button type="button" className="rc-btn" disabled={busy || !text.trim()} onClick={create}>
            Create with Nemotron
          </button>
          {draft && !draft.ok && <p className="rc-hint rc-hint--issue">{`Nemotron couldn't make a valid scene: ${draft.errors.join("; ")}`}</p>}
          {draft?.ok && draft.plan && (
            <>
              <PlanPreview plan={draft.plan} />
              <p className="rc-hint">{draft.needs_settle ? "new bodies: the sim restarts and checks it in Isaac (about a minute)" : "today's bodies"}</p>
              <button type="button" className="rc-btn" disabled={busy || !canSwitch} onClick={saveAndUse}>
                Save &amp; use
              </button>
            </>
          )}
        </section>
        {note && <p className="rc-hint" title={note}>{note}</p>}
      </div>
    </div>
  );
}
