// The cartridge editor, bottom left over the bench (a sheet across the bottom on a phone): a cartridge
// made in five stages, one at a time, while the bench in 3D follows (draft.ts, Scene.tsx). 01 Material:
// pick one of six blank shells (here, or off the bench itself), and it flies onto the turntable. 02
// Colour: a swatch or any colour. 03 Robot: its hologram stands on the cartridge. 04 Name: the label
// prints onto it. Finish saves it in the next empty place on the spiral (saved.ts, localStorage): it
// clicks in, a light crosses it, sparks pop, and it flies off to its place. 05 Done: make another, or
// go back to the room. Back steps back a stage (from the first, to the room); Escape (WorldRoot) leaves.
// The first and last stages list what is on the spiral already, each with a remove.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useWorld } from "../../core/WorldContext";
import { draftArt } from "../../scene/labels";
import { plug, resetPlug } from "../../scene/plug";
import { ROBOTS, robotFor } from "../../scene/robots";
import { COLOURS, FINISHES, MAX_SAVED, NAME_MAX, finishOf, removeSaved, saveCartridge, savedCartridges, subscribeSaved } from "../../scene/saved";
import { HELIX } from "../../scene/layout";
import { setSelected } from "../../scene/spiral";
import { closeShelf } from "../workshop/stepper";
import { STAGES, bench, canAdvance, clearPrinter, endFlight, nextStage, pickFinish, prevStage, printLabel, setDraft, setHover, setStage, startAnother, startFlight, subscribeBench, type Stage } from "./draft";
import "./bench.css";

const benchNow = () => bench.stage;
const hoverNow = () => bench.hover;
const draftNow = () => bench.draft;

type Status = { tone: "ok" | "warn"; text: string } | null;

const TITLE: Record<Stage, string> = { material: "Material", colour: "Colour", robot: "Robot", name: "Name", done: "Done" };
const HINT: Record<Stage, string> = {
  material: "Pick a blank shell off the bench.",
  colour: "Any colour you like.",
  robot: "The robot this cartridge runs.",
  name: "It prints onto the label.",
  done: "",
};
/** What each finish is like, under the shells. */
const FEEL: Record<string, string> = {
  matte: "Soft, no shine.",
  brushed: "Bare metal, brushed along its length.",
  gloss: "Deep lacquer, a mirror shine.",
  clear: "See-through: the reels show.",
  carbon: "Woven carbon fibre, satin.",
  ceramic: "Glazed, with a fine speckle.",
};

/** Typing lands straight in the name on a desktop; on a phone the keyboard would cover the bench. */
const finePointer = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;

function Choices({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="world-bench__choices world-u" role="radiogroup" aria-label={label}>
      {children}
    </div>
  );
}

export function Editor({ current }: { current: boolean }) {
  const { back, store, selectCartridge } = useWorld();
  const stage = useSyncExternalStore(subscribeBench, benchNow);
  const draft = useSyncExternalStore(subscribeBench, draftNow);
  const hover = useSyncExternalStore(subscribeBench, hoverNow);
  const saved = useSyncExternalStore(subscribeSaved, savedCartridges);
  const [status, setStatus] = useState<Status>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const full = saved.length >= MAX_SAVED;
  const index = STAGES.indexOf(stage);

  // Opening: the room view is what Back returns to, so let go of the shelf (and a detail view) now.
  // Leaving: the printed label goes, a cartridge still flying lands, the last message goes, and a
  // finished cartridge leaves a fresh bench for next time.
  useEffect(() => {
    if (!current) return;
    setSelected(-1);
    closeShelf(store);
    store.setOverride(null);
    return () => {
      clearPrinter();
      endFlight();
      setHover(-1);
      setStatus(null);
      if (bench.stage === "done") startAnother();
    };
  }, [current, store]);

  // A new stage: its heading takes the focus (the name's field on a desktop), so a screen reader says
  // where it is and Tab starts from it.
  const shown = useRef(stage);
  useEffect(() => {
    if (shown.current === stage) return;
    shown.current = stage;
    if (!current) return;
    const t = window.setTimeout(() => {
      if (stage === "name" && finePointer()) name.current?.focus({ preventScroll: true });
      else heading.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(t);
  }, [stage, current]);

  const next = () => {
    if (nextStage()) setStatus(null);
    else if (stage === "material") setStatus({ tone: "warn", text: "Pick a shell first." });
  };
  const goBack = () => {
    setStatus(null);
    if (!prevStage()) back();
  };

  const finish = () => {
    const r = saveCartridge(bench.draft);
    if (!r.ok) {
      if (r.reason === "name") {
        setStatus({ tone: "warn", text: "Name it first." });
        name.current?.focus();
      } else setStatus({ tone: "warn", text: `The spiral is full (${MAX_SAVED} of ${MAX_SAVED}). Go back to the first step to remove one.` });
      return;
    }
    printLabel(draftArt(r.cartridge, r.place));
    startFlight(r.place);
    setStage("done");
    setStatus({ tone: "ok", text: `${r.cartridge.name.toUpperCase()} is on the spiral, place ${r.place + 1} of ${MAX_SAVED}.` });
  };

  const another = () => {
    startAnother();
    setStatus(null);
  };

  const remove = (id: string, label: string) => {
    // The places shift down: one still flying lands now.
    endFlight();
    removeSaved(id);
    // The machine may hold a saved one; the places shift down, so give it back its default.
    if (plug.slot >= HELIX.length) {
      resetPlug();
      selectCartridge(null);
    }
    setStatus({ tone: "ok", text: `${label.toUpperCase()} is off the spiral.` });
  };

  const robot = robotFor(draft.robot);
  const finishNow = draft.finish ? finishOf(draft.finish) : null;
  const hovered = hover >= 0 ? FINISHES[hover] : null;
  const feel = hovered ?? finishNow;
  const answered = canAdvance(stage, draft);

  return (
    // Closed, it is hidden (CSS visibility, so nothing in it takes focus) and out of the accessibility tree.
    <div className="world-bench" data-on={current} data-stage={stage} aria-hidden={!current}>
      <h2 className="world-bench__h world-u">Workbench · new cartridge</h2>
      <ol className="world-bench__steps world-u" aria-label="Steps">
        {STAGES.map((s, i) => (
          <li key={s} aria-current={s === stage ? "step" : undefined} data-past={i < index}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            {TITLE[s]}
          </li>
        ))}
      </ol>

      <section className="world-bench__stage" key={stage} aria-labelledby="world-bench-stage">
        <h3 className="world-bench__title world-u" id="world-bench-stage" tabIndex={-1} ref={heading}>
          <span>{String(index + 1).padStart(2, "0")}</span> {TITLE[stage]}
          {HINT[stage] ? <small>{HINT[stage]}</small> : null}
        </h3>

        {stage === "material" ? (
          <>
            <Choices label="Shell">
              {FINISHES.map((f, i) => (
                <label key={f.id} className="world-bench__choice" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(-1)}>
                  <input type="radio" name="world-bench-shell" value={f.id} checked={draft.finish === f.id} onChange={() => pickFinish(f.id)} onFocus={() => setHover(i)} onBlur={() => setHover(-1)} />
                  <i className="world-bench__chip" data-finish={f.id} style={{ backgroundColor: f.color }} aria-hidden="true" />
                  {f.name}
                </label>
              ))}
            </Choices>
            <p className="world-bench__spec world-u">{feel ? FEEL[feel.id] : "Six blanks, six finishes."}</p>
          </>
        ) : null}

        {stage === "colour" ? (
          <>
            <Choices label="Colour">
              {COLOURS.map((c) => (
                <label key={c.id} className="world-bench__choice world-bench__choice--swatch">
                  <input type="radio" name="world-bench-colour" value={c.hex} checked={draft.color === c.hex} onChange={() => setDraft({ color: c.hex })} />
                  <i className="world-bench__chip" style={{ backgroundColor: c.hex }} aria-hidden="true" />
                  {c.name}
                </label>
              ))}
            </Choices>
            <label className="world-bench__any world-u">
              <input type="color" aria-label="Any colour" value={draft.color} onChange={(e) => setDraft({ color: e.target.value })} />
              Any colour
              <span className="world-bench__hex" aria-hidden="true">
                {draft.color}
              </span>
            </label>
          </>
        ) : null}

        {stage === "robot" ? (
          <>
            <Choices label="Robot">
              {ROBOTS.map((r) => (
                <label key={r.code} className="world-bench__choice world-bench__choice--robot">
                  <input type="radio" name="world-bench-robot" value={r.code} checked={draft.robot === r.code} onChange={() => setDraft({ robot: r.code })} />
                  {r.name}
                </label>
              ))}
            </Choices>
            <p className="world-bench__spec world-u">{robot.spec}</p>
          </>
        ) : null}

        {stage === "name" ? (
          <>
            <label className="world-bench__label world-u" htmlFor="world-bench-name">
              Name
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
                    finish();
                  }
                }}
              />
              <span className="world-bench__count world-u" data-near={draft.name.length >= NAME_MAX - 2} aria-hidden="true">
                {draft.name.length}/{NAME_MAX}
              </span>
            </div>
            <p className="world-bench__spec world-u">
              {finishNow?.name ?? "Matte"} · {draft.color} · {robot.name}
            </p>
          </>
        ) : null}
      </section>

      <p className="world-bench__status world-u" role="status" data-tone={status?.tone}>
        {status?.text}
      </p>

      <div className="world-bench__row world-u">
        {stage === "done" ? (
          <>
            <button type="button" className="world-bench__next" data-ready="true" onClick={another}>
              Make another
            </button>
            <button type="button" className="world-bench__back" onClick={back}>
              Back to the room
            </button>
          </>
        ) : (
          <>
            <button type="button" className="world-bench__back" onClick={goBack}>
              {index === 0 ? "← Room" : "← Back"}
            </button>
            {stage === "name" ? (
              <button type="button" className="world-bench__next" data-ready={answered && !full} data-full={full} onClick={finish}>
                Finish ✓
              </button>
            ) : (
              <button type="button" className="world-bench__next" data-ready={answered} aria-disabled={!answered} onClick={next}>
                Next →
              </button>
            )}
          </>
        )}
      </div>

      {stage === "material" || stage === "done" ? (
        <div className="world-bench__saved">
          <h3 className="world-bench__step world-u">
            On the spiral <span>{saved.length}/{MAX_SAVED}</span>
          </h3>
          {full && stage === "material" ? <p className="world-bench__empty world-bench__warn world-u">The spiral is full. Remove one to save another.</p> : null}
          {saved.length ? (
            <ul className="world-u">
              {saved.map((c) => (
                <li key={c.id}>
                  <i style={{ backgroundColor: c.color }} data-finish={c.finish} aria-hidden="true" />
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
      ) : null}
    </div>
  );
}

