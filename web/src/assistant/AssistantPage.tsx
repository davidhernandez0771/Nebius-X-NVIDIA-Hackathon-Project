import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { GlassCard, StatusPill, Zones } from "../components";
import Icon from "../components/Icon";
import { prefersReducedMotion } from "../three/capability";
import ConversationList from "./ConversationList";
import MessageComposer from "./MessageComposer";
import { useAssistantChat } from "./useAssistantChat";
import type { AssistantMessage } from "./types";
import "./assistant.css";

function statusPillFor(message: AssistantMessage) {
  if (message.status === "error") return <StatusPill tone="danger">Not connected</StatusPill>;
  if (message.status === "cancelled") return <StatusPill tone="warm">Cancelled</StatusPill>;
  if (message.status === "streaming") return <StatusPill tone="accent">Replying…</StatusPill>;
  return null;
}

function cardVariant(message: AssistantMessage): "glass" | "solid" | "provisional" {
  if (message.role === "user") return "solid";
  if (message.status === "complete") return "glass";
  return "provisional";
}

// This is a distinct, new, general-purpose assistant chat -- not the
// existing inventory-command chat at ../pages/Chat.tsx (untouched by this
// task; see SANT_VOICE_MODES_PLAN.md §2/§4). Nebius is genuinely not
// connected for this surface this round: the UI says so plainly, and
// nothing here fabricates a reply.
export default function AssistantPage() {
  const chat = useAssistantChat();
  const logRef = useRef<HTMLUListElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    if (chat.messages.length > prevCountRef.current && !prefersReducedMotion()) {
      const last = el.lastElementChild;
      if (last) {
        animate(last, { opacity: [0, 1], translateY: [8, 0], duration: 260, ease: "outQuad" });
      }
    }
    prevCountRef.current = chat.messages.length;
  }, [chat.messages.length]);

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Assistant</h1>
            <p className="muted">
              A general-purpose chat, separate from the inventory-command chat. Nebius isn't wired up for this surface yet, so
              replies aren't available -- your messages are still saved locally.
            </p>
          </div>
          <div className="row wrap">
            <StatusPill tone={chat.providerConnected ? "accent" : "warm"} icon={<Icon name="sparkle" size={16} />}>
              {chat.providerConnected ? "Connected" : "Nebius not connected"}
            </StatusPill>
          </div>
        </>
      }
    >
      <ConversationList
        conversations={chat.conversations}
        activeConversationId={chat.activeConversationId}
        onSelect={chat.selectConversation}
        onNew={chat.newConversation}
        onDelete={chat.removeConversation}
      />

      <ul className="stack assistant-log" ref={logRef}>
        {chat.messages.length === 0 && (
          <GlassCard as="li" variant="provisional">
            <p className="muted">No messages yet. Type below -- it's saved even though there's no live reply yet.</p>
          </GlassCard>
        )}
        {chat.messages.map((message) => (
          <li key={message.id} className={`assistant-message assistant-message--${message.role}`}>
            <GlassCard variant={cardVariant(message)} className="stack">
              <div className="row spread">
                <span className="muted small">{message.role === "user" ? "You" : "SANT"}</span>
                {statusPillFor(message)}
              </div>
              <p>{message.text || (message.status === "streaming" ? "…" : "")}</p>
              {message.status === "error" && message.errorMessage && (
                <p className="assistant-message-error" role="alert">
                  {message.errorMessage}
                </p>
              )}
            </GlassCard>
          </li>
        ))}
      </ul>

      <MessageComposer
        value={chat.draft}
        onChange={chat.setDraft}
        onSend={chat.send}
        onCancel={chat.cancel}
        sending={chat.sending}
        placeholder="Type a message… (Nebius not connected yet)"
      />
    </Zones>
  );
}
