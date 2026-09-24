import Icon from "../components/Icon";
import type { AssistantConversation } from "./types";

type Props = {
  conversations: AssistantConversation[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ConversationList({ conversations, activeConversationId, onSelect, onNew, onDelete }: Props) {
  return (
    <div className="assistant-conversations">
      <div className="row spread">
        <span className="muted small">Conversations</span>
        <button type="button" className="ghost-button assistant-new-btn" onClick={onNew} aria-label="New conversation">
          <Icon name="plus" size={16} />
          New
        </button>
      </div>
      {conversations.length === 0 ? (
        <p className="muted small">No conversations yet. Start typing below to create one.</p>
      ) : (
        <ul className="assistant-conversation-list">
          {conversations.map((conv) => (
            <li key={conv.id}>
              <button
                type="button"
                className={`assistant-conversation-item${conv.id === activeConversationId ? " is-active" : ""}`}
                onClick={() => onSelect(conv.id)}
                aria-current={conv.id === activeConversationId ? "true" : undefined}
              >
                <span className="assistant-conversation-title">{conv.title}</span>
                <span className="muted small">{formatTime(conv.updatedAt)}</span>
              </button>
              <button
                type="button"
                className="assistant-conversation-delete"
                aria-label={`Delete conversation "${conv.title}"`}
                onClick={() => onDelete(conv.id)}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
