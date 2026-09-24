import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlassCard, Icon, StatusPill, Zones } from "../components";
// Worker 2's real store (../commands/store.ts) landed during this session,
// so this page wires the real saved commands/modes rather than the empty-
// array defaults useVoiceControl falls back to on its own -- see that
// file's header for why the hook itself stays store-agnostic. Read-only
// import, same as matchPhrase; see HANDOFF_WORKER1.md.
import { getCommandsRepository } from "../commands/store";
import { useDictation } from "./dictation";
import { useVoiceControl } from "./useVoiceControl";
import type { VoiceListeningState, VoiceMode } from "./types";
import "./voicePage.css";

type StatusPillTone = "neutral" | "accent" | "warm" | "danger";

const STATE_LABEL: Record<VoiceListeningState, string> = {
  idle: "Off",
  listening: 'Listening for "Sant"',
  "wake-detected": "Wake word heard",
  transcribing: "Capturing command…",
  executing: "Running command…",
  success: "Done",
  unavailable: "Unavailable",
  error: "Error",
};

const STATE_TONE: Record<VoiceListeningState, StatusPillTone> = {
  idle: "neutral",
  listening: "accent",
  "wake-detected": "warm",
  transcribing: "warm",
  executing: "warm",
  success: "accent",
  unavailable: "danger",
  error: "danger",
};

const DICTATION_TONE: Record<"idle" | "listening" | "unavailable" | "error", StatusPillTone> = {
  idle: "neutral",
  listening: "accent",
  unavailable: "danger",
  error: "danger",
};

const MODES: { value: VoiceMode; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "Microphone stays off." },
  { value: "command", label: "Command", hint: 'Wake word "Sant" arms a short command window.' },
  { value: "dictation", label: "Dictation", hint: "Everything you say is transcribed as text, nothing executes." },
];

export default function VoicePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<VoiceMode>("off");
  const [dictated, setDictated] = useState("");
  const [interim, setInterim] = useState("");
  const [switching, setSwitching] = useState(false);

  const voice = useVoiceControl({
    navigate,
    getCommands: () => getCommandsRepository().loadCommands(),
    getModes: () => getCommandsRepository().loadModes(),
  });

  const onDictationText = useCallback((text: string, isFinal: boolean) => {
    if (isFinal) {
      setDictated((prev) => (prev ? `${prev} ${text}`.trim() : text.trim()));
      setInterim("");
    } else {
      setInterim(text);
    }
  }, []);

  const dictation = useDictation({ onText: onDictationText, active: mode === "dictation" });

  const handleModeChange = useCallback(
    async (next: VoiceMode) => {
      if (next === mode || switching) return;
      setSwitching(true);
      try {
        if (mode === "command") voice.disable();
        // Dictation start/stop is driven automatically by `active` below,
        // via the effect inside useDictation -- no explicit call needed here.
        setMode(next);
        if (next === "command") await voice.enable();
      } finally {
        setSwitching(false);
      }
    },
    [mode, switching, voice],
  );

  const noSpeechSupport = mode === "command" ? voice.state === "unavailable" : dictation.status === "unavailable";
  const modeStatusLabel = mode === "command" ? STATE_LABEL[voice.state] : mode === "dictation" ? dictation.status : "Off";
  const modeStatusTone = mode === "command" ? STATE_TONE[voice.state] : mode === "dictation" ? DICTATION_TONE[dictation.status] : "neutral";

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Voice</h1>
            <p className="muted">Say “Sant” to arm a command, or switch to dictation to transcribe free text.</p>
          </div>

          <GlassCard as="section" className="stack voice-disclosure">
            <div className="row spread">
              <h3>How this actually works</h3>
              <Icon name="mic" size={20} />
            </div>
            <p className="muted small">
              This is a <strong>prototype</strong>, not a local/private wake-word model: it uses your browser’s built-in speech
              service, which streams your microphone audio to a remote server (Google’s, in Chrome) continuously while voice is
              on, transcribes it, and then this page looks for the word “Sant” inside that text. It is not on-device
              processing, and audio isn’t limited to only after the wake word. See{" "}
              <code>HANDOFF_WORKER1.md</code> for what a real local wake-word engine would change.
            </p>
            {voice.provider && (
              <StatusPill tone={voice.provider.privacy === "local" ? "accent" : "warm"}>
                Active engine: {voice.provider.name} · {voice.provider.privacy === "local" ? "on-device" : "remote (not private)"}
              </StatusPill>
            )}
          </GlassCard>

          <GlassCard as="section" className="stack">
            <div className="row spread">
              <h3>Mode</h3>
              <StatusPill tone={modeStatusTone}>{modeStatusLabel}</StatusPill>
            </div>
            <div role="radiogroup" aria-label="Voice mode" className="voice-mode-group">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  disabled={switching}
                  className={`voice-mode-option${mode === m.value ? " is-selected" : ""}`}
                  onClick={() => void handleModeChange(m.value)}
                >
                  <span>{m.label}</span>
                  <span className="muted small">{m.hint}</span>
                </button>
              ))}
            </div>

            {noSpeechSupport && (
              <StatusPill tone="danger">Voice isn’t supported in this browser. Try Chrome or Edge on desktop.</StatusPill>
            )}
            {voice.micError && mode === "command" && <StatusPill tone="danger">{voice.micError}</StatusPill>}

            {mode === "command" && (
              <div className="row spread voice-ptt-row">
                <p className="muted small">
                  Push-to-talk: hold to speak a command directly, no wake word needed.
                </p>
                <button
                  type="button"
                  className={`voice-ptt-button${voice.state === "transcribing" || voice.state === "wake-detected" ? " is-armed" : ""}`}
                  disabled={!voice.enabled}
                  aria-pressed={voice.state === "transcribing" || voice.state === "wake-detected"}
                  onMouseDown={voice.startPushToTalk}
                  onMouseUp={voice.endPushToTalk}
                  onMouseLeave={voice.endPushToTalk}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    voice.startPushToTalk();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    voice.endPushToTalk();
                  }}
                >
                  <Icon name="mic" size={20} />
                  <span>Hold to talk</span>
                </button>
              </div>
            )}
          </GlassCard>
        </>
      }
    >
      {mode === "command" && (
        <GlassCard variant={voice.lastRecognized ? "solid" : "provisional"} className="stack">
          <h3>Recognized command</h3>
          {voice.lastRecognized ? (
            <>
              <p className="muted small">Heard: “{voice.lastRecognized.transcript}”</p>
              <p>
                {voice.lastRecognized.matchedLabel ? (
                  <>
                    Matched: <strong>{voice.lastRecognized.matchedLabel}</strong>
                  </>
                ) : (
                  "No matching command or mode"
                )}
              </p>
              {voice.lastResult && (
                <StatusPill tone={voice.lastResult.ok ? "accent" : "danger"}>
                  {voice.lastResult.ok ? voice.lastResult.message : voice.lastResult.error}
                </StatusPill>
              )}
            </>
          ) : (
            <p className="muted small">Nothing recognized yet. Say “Sant” followed by a command.</p>
          )}
        </GlassCard>
      )}

      {mode === "dictation" && (
        <GlassCard variant="glass" className="stack">
          <h3>Dictated text</h3>
          <p className="voice-dictation-output">
            {dictated}
            {interim && <span className="muted"> {interim}</span>}
            {!dictated && !interim && <span className="muted small">Start speaking — finalized text will collect here.</span>}
          </p>
        </GlassCard>
      )}

      <GlassCard variant="muted" className="stack">
        <h3>Physical-microphone check (can’t be verified here)</h3>
        <p className="muted small">
          No microphone is available in this development environment, so the states above were only exercised with recorded/
          synthetic transcript events. Before relying on this in the field, check on real hardware:
        </p>
        <ul className="muted small voice-checklist">
          <li>Mic permission prompt appears, and denial lands on “unavailable”/an error, not a silent hang.</li>
          <li>Saying “Sant” actually arms the window (watch the state pill), and an unrelated sentence never fires a command.</li>
          <li>Disabling voice (or switching modes) fully releases the mic — check the tab’s mic indicator turns off.</li>
          <li>Push-to-talk works without saying “Sant”, and releasing early still finalizes whatever was captured.</li>
          <li>Dictation and command mode never run at once; switching modes mid-listen doesn’t leave two sessions open.</li>
        </ul>
      </GlassCard>
    </Zones>
  );
}
