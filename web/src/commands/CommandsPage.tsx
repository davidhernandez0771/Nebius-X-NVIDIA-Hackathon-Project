// /commands -- create/edit/enable/disable/delete SavedCommand entries. Every
// "test" run goes through the real executeAction() (../actions/registry),
// with normal isAvailable()/arg-validation behavior -- there is no
// special-cased test path that skips those checks (see SANT_VOICE_MODES_PLAN.md §4).

import { useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { executeAction, listActions, validateArgs } from "../actions/registry";
import type { ActionArgSpec, ActionArgs, ActionArgValue, ActionResult } from "../actions/types";
import { GlassCard, Icon, StatusPill, Toggle, Zones } from "../components";
import { findPhraseConflicts, normalizePhrase, type PhraseOwner } from "./matcher";
import { generateId, getCommandsRepository, removeCommand, upsertCommand } from "./store";
import { WAKE_WORD, type SavedCommand } from "./types";

// select/textarea aren't covered by styles.css's global input styling (only
// input[type=text] is) -- styled inline via design tokens instead of editing
// the shared stylesheet, which other workers' pages are touching concurrently.
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
  id: string | null; // null while creating a new command
  displayName: string;
  phrase: string;
  aliasesText: string;
  actionId: string;
  args: ActionArgs;
  enabled: boolean;
};

function emptyForm(defaultActionId: string): FormState {
  return { id: null, displayName: "", phrase: "", aliasesText: "", actionId: defaultActionId, args: {}, enabled: true };
}

function parseAliases(text: string): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const raw of text.split(",")) {
    const alias = raw.trim();
    if (!alias) continue;
    const key = normalizePhrase(alias);
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases;
}

function describeConflicts(owners: PhraseOwner[]): string {
  const names = Array.from(new Set(owners.map((o) => o.label)));
  return names.join(", ");
}

export default function CommandsPage() {
  const navigate = useNavigate();
  const actions = useMemo(() => listActions(), []);
  const [commands, setCommands] = useState<SavedCommand[]>(() => getCommandsRepository().loadCommands());
  const [modes] = useState(() => getCommandsRepository().loadModes());
  const [form, setForm] = useState<FormState>(() => emptyForm(actions[0]?.id ?? ""));
  const [formError, setFormError] = useState("");
  const [testResults, setTestResults] = useState<Record<string, ActionResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const selectedAction = actions.find((a) => a.id === form.actionId);
  const editExclude = form.id ? ({ kind: "command", id: form.id } as const) : undefined;
  const otherCommands = form.id ? commands.filter((c) => c.id !== form.id) : commands;
  const liveConflicts = form.phrase.trim() ? findPhraseConflicts(form.phrase, otherCommands, modes, editExclude) : [];

  function persist(next: SavedCommand[]) {
    setCommands(next);
    getCommandsRepository().saveCommands(next);
  }

  function startCreate() {
    setForm(emptyForm(actions[0]?.id ?? ""));
    setFormError("");
  }

  function startEdit(command: SavedCommand) {
    setForm({
      id: command.id,
      displayName: command.displayName,
      phrase: command.phrase,
      aliasesText: command.aliases.join(", "),
      actionId: command.actionId,
      args: command.args,
      enabled: command.enabled,
    });
    setFormError("");
  }

  function updateArg(key: string, value: ActionArgValue | undefined) {
    setForm((f) => ({ ...f, args: { ...f.args, [key]: value } }));
  }

  function changeAction(actionId: string) {
    setForm((f) => ({ ...f, actionId, args: {} }));
  }

  function save() {
    const displayName = form.displayName.trim();
    const phrase = form.phrase.trim();
    if (!displayName) return setFormError("Give the command a name.");
    if (!normalizePhrase(phrase)) return setFormError("Give the command a trigger phrase.");
    if (!selectedAction) return setFormError("Choose an action.");

    const aliases = parseAliases(form.aliasesText);
    const normalizedPhrase = normalizePhrase(phrase);
    if (aliases.some((a) => normalizePhrase(a) === normalizedPhrase)) {
      return setFormError("An alias can't be identical to the phrase.");
    }

    const conflicts = [
      ...findPhraseConflicts(phrase, otherCommands, modes, editExclude),
      ...aliases.flatMap((a) => findPhraseConflicts(a, otherCommands, modes, editExclude)),
    ];
    if (conflicts.length > 0) {
      return setFormError(`That phrase conflicts with: ${describeConflicts(conflicts)}. Choose a different phrase.`);
    }

    const argErrors = validateArgs(selectedAction.args, form.args);
    if (argErrors.length > 0) return setFormError(argErrors.join("; "));

    const now = new Date().toISOString();
    const existing = form.id ? commands.find((c) => c.id === form.id) : undefined;
    const command: SavedCommand = {
      id: form.id ?? generateId("cmd"),
      displayName,
      phrase,
      aliases,
      actionId: selectedAction.id,
      args: form.args,
      enabled: form.enabled,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    persist(upsertCommand(commands, command));
    startCreate();
  }

  function remove(id: string) {
    persist(removeCommand(commands, id));
    setTestResults((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
  }

  function toggleEnabled(command: SavedCommand) {
    persist(upsertCommand(commands, { ...command, enabled: !command.enabled, updatedAt: new Date().toISOString() }));
  }

  async function test(command: SavedCommand) {
    setTestingId(command.id);
    const result = await executeAction(command.actionId, command.args, { source: "test", navigate });
    setTestResults((r) => ({ ...r, [command.id]: result }));
    setTestingId(null);
  }

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Commands</h1>
            <p className="muted">
              Teach Sant a phrase. Say “{WAKE_WORD}, {form.phrase.trim() || "your phrase"}” and it runs a real action --
              never a guess.
            </p>
          </div>

          <GlassCard as="section" className="stack">
            <h2>{form.id ? "Edit command" : "New command"}</h2>

            {actions.length === 0 && (
              <StatusPill tone="warm">No actions are registered yet -- nothing to trigger.</StatusPill>
            )}

            <label className="stack" style={{ gap: "var(--space-2)" }}>
              <span className="muted small">Name</span>
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="Camera control on"
              />
            </label>

            <label className="stack" style={{ gap: "var(--space-2)" }}>
              <span className="muted small">Trigger phrase (said after “{WAKE_WORD}”)</span>
              <input
                value={form.phrase}
                onChange={(e) => setForm((f) => ({ ...f, phrase: e.target.value }))}
                placeholder="activate camera control"
              />
            </label>

            {liveConflicts.length > 0 && (
              <StatusPill tone="warm">Conflicts with: {describeConflicts(liveConflicts)}</StatusPill>
            )}

            <label className="stack" style={{ gap: "var(--space-2)" }}>
              <span className="muted small">Aliases (comma-separated, optional)</span>
              <input
                value={form.aliasesText}
                onChange={(e) => setForm((f) => ({ ...f, aliasesText: e.target.value }))}
                placeholder="hand control on, turn on hand tracking"
              />
            </label>

            <label className="stack" style={{ gap: "var(--space-2)" }}>
              <span className="muted small">Action</span>
              <select style={controlStyle} value={form.actionId} onChange={(e) => changeAction(e.target.value)}>
                {actions.length === 0 && <option value="">No actions available</option>}
                {actions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id}
                  </option>
                ))}
              </select>
            </label>

            {selectedAction?.args &&
              Object.entries(selectedAction.args).map(([key, spec]) => (
                <ArgField key={key} name={key} spec={spec} value={form.args[key]} onChange={(v) => updateArg(key, v)} />
              ))}

            <label className="row">
              <Toggle checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} label="Enabled" />
              <span className="toggle-label">Enabled</span>
            </label>

            <GlassCard variant="provisional">
              <p className="muted small">
                When I say “{WAKE_WORD}, {form.phrase.trim() || "…"}”, Sant will{" "}
                {selectedAction?.description ?? "(choose an action)"}.
              </p>
            </GlassCard>

            {formError && <StatusPill tone="danger">{formError}</StatusPill>}

            <div className="row wrap">
              <button className="primary-button" onClick={save} disabled={actions.length === 0}>
                {form.id ? "Save changes" : "Add command"}
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
      {commands.length === 0 && (
        <GlassCard variant="provisional">
          <p className="muted">No commands yet. Add one on the left.</p>
        </GlassCard>
      )}
      <ul className="stack">
        {commands.map((command) => {
          const action = actions.find((a) => a.id === command.actionId);
          const result = testResults[command.id];
          const savedConflicts = command.enabled
            ? findPhraseConflicts(command.phrase, commands.filter((c) => c.id !== command.id), modes, {
                kind: "command",
                id: command.id,
              })
            : [];
          return (
            <GlassCard key={command.id} as="li" variant={command.enabled ? "solid" : "muted"} className="stack">
              <div className="row spread">
                <div>
                  <h3>{command.displayName}</h3>
                  <p className="muted small">
                    “{WAKE_WORD}, {command.phrase}”
                    {command.aliases.length > 0 && ` · also: ${command.aliases.join(", ")}`}
                  </p>
                </div>
                <Toggle checked={command.enabled} onChange={() => toggleEnabled(command)} label={`Enable ${command.displayName}`} />
              </div>
              <p className="muted small">
                {action ? action.description : `Unknown action "${command.actionId}" -- this saved command can't run`}
              </p>
              {savedConflicts.length > 0 && (
                <StatusPill tone="warm">Conflicts with: {describeConflicts(savedConflicts)}</StatusPill>
              )}
              <div className="row wrap">
                <button className="ghost-button" onClick={() => startEdit(command)}>
                  <Icon name="wand" size={16} /> Edit
                </button>
                <button className="ghost-button" onClick={() => remove(command.id)}>
                  <Icon name="trash" size={16} /> Delete
                </button>
                <button className="ghost-button" onClick={() => test(command)} disabled={testingId === command.id}>
                  {testingId === command.id ? "Testing…" : "Test"}
                </button>
              </div>
              {result && (
                <StatusPill tone={result.ok ? "accent" : "danger"}>{result.ok ? result.message : result.error}</StatusPill>
              )}
            </GlassCard>
          );
        })}
      </ul>
    </Zones>
  );
}

function ArgField({
  name,
  spec,
  value,
  onChange,
}: {
  name: string;
  spec: ActionArgSpec;
  value: ActionArgValue | undefined;
  onChange: (value: ActionArgValue | undefined) => void;
}) {
  if (spec.type === "boolean") {
    return (
      <label className="row">
        <Toggle checked={value === true} onChange={onChange} label={name} />
        <span className="toggle-label">{name}</span>
      </label>
    );
  }

  if (spec.type === "string" && spec.enum) {
    return (
      <label className="stack" style={{ gap: "var(--space-2)" }}>
        <span className="muted small">
          {name}
          {spec.required && " *"}
        </span>
        <select style={controlStyle} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">Choose…</option>
          {spec.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (spec.type === "number") {
    return (
      <label className="stack" style={{ gap: "var(--space-2)" }}>
        <span className="muted small">
          {name}
          {spec.required && " *"}
        </span>
        <input
          type="number"
          min={spec.min}
          max={spec.max}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      </label>
    );
  }

  return (
    <label className="stack" style={{ gap: "var(--space-2)" }}>
      <span className="muted small">
        {name}
        {spec.required && " *"}
      </span>
      <input
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
    </label>
  );
}
