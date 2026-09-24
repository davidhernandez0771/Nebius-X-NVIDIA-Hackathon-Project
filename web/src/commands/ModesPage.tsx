// /modes -- create/edit/duplicate/delete/activate Mode entries: an ordered
// list of links (external tabs or internal navigation) launched together.
// Activation always shows the ordered link list before anything opens (the
// structural confirmation from SANT_VOICE_MODES_PLAN.md §3), then reports a
// per-link result -- a voice-recognition callback can't reliably authorize
// window.open(), so this never claims every tab opened when some were blocked.

import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { GlassCard, Icon, StatusPill, Zones } from "../components";
import { findPhraseConflicts, type PhraseOwner } from "./matcher";
import { launchLink, launchMode, validateModeLink, type LinkLaunchResult, type ModeLaunchResult } from "./modes";
import { generateId, getCommandsRepository, removeMode, upsertMode } from "./store";
import { WAKE_WORD, type Mode, type ModeLink, type ModeLinkKind } from "./types";

const controlStyle: CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "0 var(--space-4)",
  background: "var(--surface)",
  border: "var(--border)",
  borderRadius: "var(--radius-control)",
  color: "var(--text)",
};

type FormState = {
  id: string | null;
  name: string;
  phrase: string;
  links: ModeLink[];
};

type NewLinkState = { kind: ModeLinkKind; label: string; url: string; error: string };

function emptyForm(): FormState {
  return { id: null, name: "", phrase: "", links: [] };
}

function emptyLinkDraft(): NewLinkState {
  return { kind: "external", label: "", url: "", error: "" };
}

function describeConflicts(owners: PhraseOwner[]): string {
  return Array.from(new Set(owners.map((o) => o.label))).join(", ");
}

const statusTone: Record<LinkLaunchResult["status"], "accent" | "warm" | "danger"> = {
  opened: "accent",
  blocked: "warm",
  error: "danger",
};

const statusLabel: Record<LinkLaunchResult["status"], string> = {
  opened: "Opened",
  blocked: "Blocked",
  error: "Error",
};

export default function ModesPage() {
  const navigate = useNavigate();
  const [modes, setModes] = useState<Mode[]>(() => getCommandsRepository().loadModes());
  const [commands] = useState(() => getCommandsRepository().loadCommands());
  const [form, setForm] = useState<FormState>(emptyForm);
  const [linkDraft, setLinkDraft] = useState<NewLinkState>(emptyLinkDraft);
  const [formError, setFormError] = useState("");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [launchResults, setLaunchResults] = useState<Record<string, ModeLaunchResult>>({});

  const editExclude = form.id ? ({ kind: "mode", id: form.id } as const) : undefined;
  const otherModes = form.id ? modes.filter((m) => m.id !== form.id) : modes;
  const livePhraseConflicts = form.phrase.trim() ? findPhraseConflicts(form.phrase, commands, otherModes, editExclude) : [];

  function persist(next: Mode[]) {
    setModes(next);
    getCommandsRepository().saveModes(next);
  }

  function startCreate() {
    setForm(emptyForm());
    setLinkDraft(emptyLinkDraft());
    setFormError("");
  }

  function startEdit(mode: Mode) {
    setForm({ id: mode.id, name: mode.name, phrase: mode.phrase ?? "", links: mode.links });
    setLinkDraft(emptyLinkDraft());
    setFormError("");
  }

  function addLink() {
    const label = linkDraft.label.trim();
    const url = linkDraft.url.trim();
    if (!label) return setLinkDraft((d) => ({ ...d, error: "Give the link a label." }));
    if (!url) return setLinkDraft((d) => ({ ...d, error: "Give the link a URL or path." }));
    const invalidReason = validateModeLink({ kind: linkDraft.kind, url });
    if (invalidReason) return setLinkDraft((d) => ({ ...d, error: invalidReason }));

    const link: ModeLink = { id: generateId("link"), kind: linkDraft.kind, label, url };
    setForm((f) => ({ ...f, links: [...f.links, link] }));
    setLinkDraft(emptyLinkDraft());
  }

  function removeLink(id: string) {
    setForm((f) => ({ ...f, links: f.links.filter((l) => l.id !== id) }));
  }

  function moveLink(id: string, direction: -1 | 1) {
    setForm((f) => {
      const index = f.links.findIndex((l) => l.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= f.links.length) return f;
      const links = f.links.slice();
      [links[index], links[target]] = [links[target], links[index]];
      return { ...f, links };
    });
  }

  function save() {
    const name = form.name.trim();
    if (!name) return setFormError("Give the mode a name.");
    const phrase = form.phrase.trim();

    if (phrase) {
      const conflicts = findPhraseConflicts(phrase, commands, otherModes, editExclude);
      if (conflicts.length > 0) {
        return setFormError(`That phrase conflicts with: ${describeConflicts(conflicts)}. Choose a different phrase.`);
      }
    }

    const now = new Date().toISOString();
    const existing = form.id ? modes.find((m) => m.id === form.id) : undefined;
    const mode: Mode = {
      id: form.id ?? generateId("mode"),
      name,
      links: form.links,
      phrase: phrase || undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    persist(upsertMode(modes, mode));
    startCreate();
  }

  function remove(id: string) {
    persist(removeMode(modes, id));
    setLaunchResults((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
    if (reviewingId === id) setReviewingId(null);
  }

  function duplicate(mode: Mode) {
    const now = new Date().toISOString();
    const copy: Mode = {
      id: generateId("mode"),
      name: `${mode.name} (copy)`,
      links: mode.links.map((l) => ({ ...l, id: generateId("link") })),
      phrase: undefined, // cleared -- an exact duplicate phrase would conflict immediately
      createdAt: now,
      updatedAt: now,
    };
    persist(upsertMode(modes, copy));
  }

  function confirmActivate(mode: Mode) {
    const result = launchMode(mode, navigate);
    setLaunchResults((r) => ({ ...r, [mode.id]: result }));
    setReviewingId(null);
  }

  function retryLink(mode: Mode, link: ModeLink) {
    const updated = launchLink(link, navigate);
    setLaunchResults((r) => {
      const current = r[mode.id];
      if (!current) return r;
      const results = current.results.map((res) => (res.linkId === link.id ? updated : res));
      return { ...r, [mode.id]: { ...current, results, allOpened: results.every((res) => res.status === "opened") } };
    });
  }

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Modes</h1>
            <p className="muted">
              Bundle links into one activation. Say “{WAKE_WORD}, {form.phrase.trim() || "your phrase"}” or press
              Activate -- either way you'll see exactly what opens first.
            </p>
          </div>

          <GlassCard as="section" className="stack">
            <h2>{form.id ? "Edit mode" : "New mode"}</h2>

            <label className="stack" style={{ gap: "var(--space-2)" }}>
              <span className="muted small">Name</span>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Deep focus" />
            </label>

            <label className="stack" style={{ gap: "var(--space-2)" }}>
              <span className="muted small">Voice phrase (optional, said after “{WAKE_WORD}”)</span>
              <input
                value={form.phrase}
                onChange={(e) => setForm((f) => ({ ...f, phrase: e.target.value }))}
                placeholder="start focus mode"
              />
            </label>

            {livePhraseConflicts.length > 0 && (
              <StatusPill tone="warm">Conflicts with: {describeConflicts(livePhraseConflicts)}</StatusPill>
            )}

            <GlassCard variant="provisional" className="stack">
              <p className="muted small">Links, in the order they'll open</p>
              {form.links.length === 0 && <p className="muted small">No links yet -- add one below.</p>}
              <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {form.links.map((link, i) => (
                  <li key={link.id} className="row spread">
                    <span className="muted small">
                      {i + 1}. {link.label} <em className="muted">({link.kind})</em>
                    </span>
                    <span className="row">
                      <button
                        type="button"
                        className="ghost-button"
                        aria-label={`Move ${link.label} up`}
                        disabled={i === 0}
                        onClick={() => moveLink(link.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        aria-label={`Move ${link.label} down`}
                        disabled={i === form.links.length - 1}
                        onClick={() => moveLink(link.id, 1)}
                      >
                        ↓
                      </button>
                      <button type="button" className="ghost-button" aria-label={`Remove ${link.label}`} onClick={() => removeLink(link.id)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </span>
                  </li>
                ))}
              </ol>

              <div className="row wrap">
                <select
                  style={{ ...controlStyle, width: "auto" }}
                  value={linkDraft.kind}
                  onChange={(e) => setLinkDraft((d) => ({ ...d, kind: e.target.value as ModeLinkKind, error: "" }))}
                  aria-label="Link type"
                >
                  <option value="external">External</option>
                  <option value="internal">Internal</option>
                </select>
                <input
                  value={linkDraft.label}
                  onChange={(e) => setLinkDraft((d) => ({ ...d, label: e.target.value, error: "" }))}
                  placeholder="Label"
                  aria-label="Link label"
                />
                <input
                  value={linkDraft.url}
                  onChange={(e) => setLinkDraft((d) => ({ ...d, url: e.target.value, error: "" }))}
                  placeholder={linkDraft.kind === "internal" ? "/inventory" : "https://example.com"}
                  aria-label="Link URL"
                />
                <button type="button" className="ghost-button" onClick={addLink}>
                  <Icon name="plus" size={16} /> Add link
                </button>
              </div>
              {linkDraft.error && <StatusPill tone="danger">{linkDraft.error}</StatusPill>}
            </GlassCard>

            {formError && <StatusPill tone="danger">{formError}</StatusPill>}

            <div className="row wrap">
              <button className="primary-button" onClick={save}>
                {form.id ? "Save changes" : "Add mode"}
              </button>
              {form.id && (
                <button className="ghost-button" onClick={startCreate}>
                  Cancel edit
                </button>
              )}
            </div>
          </GlassCard>
        </>
      }
    >
      {modes.length === 0 && (
        <GlassCard variant="provisional">
          <p className="muted">No modes yet. Build one on the left.</p>
        </GlassCard>
      )}
      <ul className="stack">
        {modes.map((mode) => {
          const result = launchResults[mode.id];
          const reviewing = reviewingId === mode.id;
          return (
            <GlassCard key={mode.id} as="li" variant="solid" className="stack">
              <div className="row spread">
                <div>
                  <h3>{mode.name}</h3>
                  {mode.phrase && (
                    <p className="muted small">
                      “{WAKE_WORD}, {mode.phrase}”
                    </p>
                  )}
                </div>
                <StatusPill>{mode.links.length} link{mode.links.length === 1 ? "" : "s"}</StatusPill>
              </div>

              <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {mode.links.map((link) => (
                  <li key={link.id} className="row spread">
                    <span className="muted small">
                      {link.label} <em className="muted">({link.kind}: {link.url})</em>
                    </span>
                  </li>
                ))}
              </ol>

              {reviewing && (
                <GlassCard variant="provisional" className="stack">
                  <p className="muted small">
                    Activating will open these {mode.links.length} link{mode.links.length === 1 ? "" : "s"}, in order. Confirm?
                  </p>
                  <div className="row wrap">
                    <button className="primary-button" onClick={() => confirmActivate(mode)}>
                      Confirm & activate
                    </button>
                    <button className="ghost-button" onClick={() => setReviewingId(null)}>
                      Cancel
                    </button>
                  </div>
                </GlassCard>
              )}

              {result && (
                <ul className="stack">
                  {result.results.map((r) => (
                    <li key={r.linkId} className="row spread">
                      <span className="muted small">{r.label}</span>
                      <span className="row">
                        <StatusPill tone={statusTone[r.status]} title={r.message}>
                          {statusLabel[r.status]}
                        </StatusPill>
                        {r.status !== "opened" && (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => retryLink(mode, mode.links.find((l) => l.id === r.linkId) ?? mode.links[0])}
                          >
                            Retry
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="row wrap">
                <button className="ghost-button" onClick={() => startEdit(mode)}>
                  <Icon name="wand" size={16} /> Edit
                </button>
                <button className="ghost-button" onClick={() => duplicate(mode)}>
                  Duplicate
                </button>
                <button className="ghost-button" onClick={() => remove(mode.id)}>
                  <Icon name="trash" size={16} /> Delete
                </button>
                <button
                  className="primary-button"
                  onClick={() => setReviewingId(mode.id)}
                  disabled={mode.links.length === 0 || reviewing}
                >
                  Activate
                </button>
              </div>
            </GlassCard>
          );
        })}
      </ul>
    </Zones>
  );
}
