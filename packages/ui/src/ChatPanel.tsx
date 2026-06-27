import { useState } from "react";
import type { ChatAnswer } from "@package-workbench/chat-engine";

/**
 * The AI Codebase Chat tab: a chat interface over Package Workbench intelligence.
 * Suggested prompts, clickable package references, cited evidence, and copyable
 * answers. Pure + presentational — the host runs the chat engine and feeds
 * messages in; this renders them.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  answer?: ChatAnswer;
}

export interface ChatPanelProps {
  messages: ChatMessage[];
  prompts: string[];
  onAsk: (question: string) => void;
  onPackageClick?: (packageId: string) => void;
  onCopy?: (text: string) => void;
  busy?: boolean;
}

const CONFIDENCE_COLOR: Record<string, string> = {
  low: "#9ca3af",
  medium: "#d97706",
  high: "#1f9d55",
};

export function ChatPanel({
  messages,
  prompts,
  onAsk,
  onPackageClick,
  onCopy,
  busy,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  const submit = (): void => {
    const q = draft.trim();
    if (!q || busy) return;
    onAsk(q);
    setDraft("");
  };

  return (
    <div className="pw-chat">
      <div className="pw-chat__scroll">
        {messages.length === 0 ? (
          <div className="pw-chat__intro">
            <h2>Ask Package Workbench</h2>
            <p className="pw-muted">
              Ask anything about this repository — health, dependencies,
              regressions, what to refactor.
            </p>
            <div className="pw-chat__prompts">
              {prompts.map((p) => (
                <button
                  key={p}
                  className="pw-chat__chip"
                  disabled={busy}
                  onClick={() => onAsk(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <Message
              key={i}
              message={m}
              onPackageClick={onPackageClick}
              onCopy={onCopy}
            />
          ))
        )}
        {busy && <div className="pw-chat__thinking pw-muted">Thinking…</div>}
      </div>

      <div className="pw-chat__composer">
        <input
          className="pw-chat__input"
          value={draft}
          placeholder="Ask about this repo…"
          onChange={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          disabled={busy}
        />
        <button
          className="pw-btn"
          onClick={submit}
          disabled={busy || !draft.trim()}
        >
          Ask
        </button>
      </div>
    </div>
  );
}

function Message({
  message,
  onPackageClick,
  onCopy,
}: {
  message: ChatMessage;
  onPackageClick?: (id: string) => void;
  onCopy?: (t: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="pw-chat__msg pw-chat__msg--user">
        <div className="pw-chat__bubble">{message.text}</div>
      </div>
    );
  }
  const a = message.answer;
  return (
    <div className="pw-chat__msg pw-chat__msg--assistant">
      <div className="pw-chat__bubble">
        <p className="pw-chat__answer">{message.text}</p>

        {a && a.evidence.length > 0 && (
          <div className="pw-chat__evidence">
            <strong>Evidence</strong>
            <ul>
              {a.evidence.map((e, i) => (
                <li key={i}>
                  <code>{e.source}</code> {e.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {a && a.suggestedActions.length > 0 && (
          <div className="pw-chat__actions">
            <strong>Suggested actions</strong>
            <ol>
              {a.suggestedActions.map((act, i) => (
                <li key={i}>
                  {act.title}
                  {act.command && (
                    <code className="pw-chat__cmd">{act.command}</code>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {a && (
          <div className="pw-chat__meta">
            {a.references.length > 0 && (
              <span className="pw-chat__refs">
                {a.references.map((id) => (
                  <button
                    key={id}
                    className="pw-chat__ref"
                    onClick={() => onPackageClick?.(id)}
                  >
                    {id}
                  </button>
                ))}
              </span>
            )}
            <span
              className="pw-chat__conf"
              style={{ color: CONFIDENCE_COLOR[a.confidence] }}
            >
              {a.confidence} confidence
            </span>
            <button
              className="pw-chat__copy"
              onClick={() =>
                onCopy
                  ? onCopy(message.text)
                  : void navigator.clipboard?.writeText(message.text)
              }
            >
              Copy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
