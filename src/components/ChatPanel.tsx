import { Bot, Loader2, MessageSquare } from 'lucide-react';
import type { ChatMessage, Conversation, Note } from '../types';
import { modelStatusText, providerDisplayName } from '../services/settings';
import type { AiSettings } from '../types';

export function ChatPanel({
  selectedNote,
  conversation,
  chatInput,
  isAsking,
  settings,
  onChatInputChange,
  onAsk
}: {
  selectedNote: Note | null;
  conversation: Conversation | null;
  chatInput: string;
  isAsking: boolean;
  settings: AiSettings;
  onChatInputChange: (value: string) => void;
  onAsk: () => void;
}) {
  const messages = conversation?.messages || [];

  return (
    <aside className="chat-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">RAG Bot</span>
          <h2>当前笔记对话</h2>
        </div>
        <Bot size={22} />
      </div>

      <div className={`model-status ${settings.lastTestStatus || 'idle'}`}>
        <strong>{providerDisplayName(settings.provider)}</strong>
        <span>{modelStatusText(settings)}</span>
      </div>

      <div className="message-list">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isAsking && (
          <article className="message assistant pending">
            <Loader2 className="spin" size={16} />
            <span>思考中</span>
          </article>
        )}
        {!messages.length && (
          <div className="chat-empty">
            <MessageSquare size={28} />
            <span>围绕当前笔记提问，Bot 会引用相关片段回答。</span>
          </div>
        )}
      </div>

      <div className="chat-input">
        <textarea
          value={chatInput}
          onChange={(event) => onChatInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onAsk();
            }
          }}
          placeholder="问当前笔记"
          disabled={!selectedNote}
        />
        <button className="primary-action compact" onClick={onAsk} disabled={!selectedNote || !chatInput.trim() || isAsking}>
          <MessageSquare size={17} />
          发送
        </button>
      </div>
    </aside>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="message-content">{message.content}</div>
      {message.sources?.length ? (
        <details className="source-details">
          <summary>引用片段 · {message.sources.length}</summary>
          <div className="source-list">
            {message.sources.slice(0, 4).map((source, index) => (
              <p key={`${source.noteId}-${source.section}-${index}`}>
                <strong>{source.title} / {source.section}</strong>
                <span>{source.excerpt}</span>
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}
