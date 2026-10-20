// The cartridge editor, bottom left over the bench: name it, pick its shell and its robot, and watch
// the cartridge on the turntable follow (draft.ts, Scene.tsx). Save stands it in the next empty place
// on the spiral (saved.ts, kept in localStorage) and the printer slides its label out. Back (or
// Escape, WorldRoot) returns to the room view. Under the controls: what is on the spiral already,
// each with a remove.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useWorld } from "../../core/WorldContext";
import { draftArt } from "../../scene/labels";
import { plug, resetPlug } from "../../scene/plug";
import { ROBOTS, robotFor } from "../../scene/robots";
import { MAX_SAVED, NAME_MAX, SHELLS, removeSaved, saveCartridge, savedCartridges, shellOf, subscribeSaved } from "../../scene/saved";
import { HELIX } from "../../scene/layout";
import { setSelected } from "../../scene/spiral";
import { closeShelf } from "../workshop/stepper";
import { bench, clearPrinter, printLabel, setDraft, subscribeBench } from "./draft";
import "./bench.css";

const draftNow = () => bench.draft;

type Status = { tone: "ok" | "warn"; text: string } | null;

/** Typing lands straight in the name on a desktop; on a phone the keyboard would cover the bench. */
const finePointer = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;

export function Editor({ current }: { current: boolean }) {
  const { back, store, selectCartridge } = useWorld();
  const draft = useSyncExternalStore(subscribeBench, draftNow);
  const saved = useSyncExternalStore(subscribeSaved, savedCartridges);
  const [status, setStatus] = useState<Status>(null);
  const name = useRef<HTMLInputElement>(null);
  const full = saved.length >= MAX_SAVED;

  // Opening: the room view is what Back returns to, so let go of the shelf (and a detail view) now.
  // Leaving: the printed label goes, and so does the last message.
  useEffect(() => {
    if (!current) return;
    setSelected(-1);
    closeShelf(store);
    store.setOverride(null);
    const focus = finePointer() ? window.setTimeout(() => name.current?.focus({ preventScroll: true }), 60) : 0;
    return () => {
      window.clearTimeout(focus);
      clearPrinter();
      setStatus(null);
    };
  }, [current, store]);

  const save = () => {
    const r = saveCartridge(bench.draft);
    if (!r.ok) {
      if (r.reason === "name") {
        setStatus({ tone: "warn", text: "Name it first." });
        name.current?.focus();
      } else setStatus({ tone: "warn", text: `The spiral is full (${MAX_SAVED} of ${MAX_SAVED}). Remove one below to save another.` });
      return;
    }
    printLabel(draftArt(r.cartridge, r.place));
    setDraft({ name: "" });
    setStatus({ tone: "ok", text: `Saved. ${r.cartridge.name.toUpperCase()} is on the spiral, place ${r.place + 1} of ${MAX_SAVED}.` });
  };

  const remove = (id: string, label: string) => {
    removeSaved(id);
    // The machine may hold a saved one; the places shift down, so give it back its default.
    if (plug.slot >= HELIX.length) {
      resetPlug();
      selectCartridge(null);
    }
    setStatus({ tone: "ok", text: `${label.toUpperCase()} is off the spiral.` });
  };

  const robot = robotFor(draft.robot);
  return (
    // Closed, it is hidden (CSS visibility, so nothing in it takes focus) and out of the accessibility tree.
    <div className="world-bench" data-on={current} aria-hidden={!current}>
      <h2 className="world-bench__h world-u">Workbench · new cartridge</h2>

      <label className="world-bench__step world-u" htmlFor="world-bench-name">
        <span>01</span> Name
      </label>
      <div className="world-bench__name">
        <input
          ref={name}
          id="world-bench-name"
          className="world-bench__input"
          type="text"
          value={draft.name}
          maxLength={NAME_MAX}
          placeholder="Name your robot"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDraft({ name: e.target.value.replace(/[\u0000-\u001f\u007f]/g, "") })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
        />
        <span className="world-bench__count world-u" data-near={draft.name.length >= NAME_MAX - 2} aria-hidden="true">
          {draft.name.length}/{NAME_MAX}
        </span>
      </div>

      <h3 className="world-bench__step world-u" id="world-bench-look">
        <span>02</span> Look
      </h3>
      <div className="world-bench__swatches world-u" role="group" aria-labelledby="world-bench-look">
        {SHELLS.map((s) => (
          <button key={s.id} type="button" className="world-bench__swatch" aria-pressed={draft.shell === s.id} onClick={() => setDraft({ shell: s.id })}>
            <i style={{ backgroundColor: s.hex }} data-see-through={s.id === "smoke"} aria-hidden="true" />
            {s.name}
          </button>
        ))}
      </div>

      <h3 className="world-bench__step world-u" id="world-bench-robot">
        <span>03</span> Robot
      </h3>
      <div className="world-bench__robots world-u" role="group" aria-labelledby="world-bench-robot">
        {ROBOTS.map((r) => (
          <button key={r.code} type="button" aria-pressed={draft.robot === r.code} onClick={() => setDraft({ robot: r.code })}>
            {r.name}
          </button>
        ))}
      </div>
      <p className="world-bench__spec world-u">{robot.spec}</p>

      <div className="world-bench__row world-u">
        <button type="button" className="world-bench__save" data-full={full} onClick={save}>
          {full ? "Spiral full" : "Save to the spiral →"}
        </button>
        <button type="button" className="world-bench__back" onClick={back}>
          ← Back
        </button>
      </div>
      <p className="world-bench__status world-u" role="status" data-tone={status?.tone}>
        {status?.text}
      </p>

      <div className="world-bench__saved">
        <h3 className="world-bench__step world-u">
          On the spiral <span>{saved.length}/{MAX_SAVED}</span>
        </h3>
        {saved.length ? (
          <ul className="world-u">
            {saved.map((c) => (
              <li key={c.id}>
                <i style={{ backgroundColor: shellOf(c.shell).hex }} aria-hidden="true" />
                <span className="world-bench__savedname">{c.name}</span>
                <span className="world-bench__savedrobot">{robotFor(c.robot).name}</span>
                <button type="button" aria-label={`Remove ${c.name} from the spiral`} onClick={() => remove(c.id, c.name)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="world-bench__empty world-u">None yet. {MAX_SAVED} empty places wait on the shelf.</p>
        )}
      </div>
    </div>
  );
}
