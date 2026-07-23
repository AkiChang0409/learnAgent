import { Brain, Loader2, MessageSquare, NotebookPen, Sparkles, X } from 'lucide-react';
import type { ChatMessage, Conversation, Note } from '../types';
import { modelStatusText, providerDisplayName } from '../services/settings';
import type { AiSettings } from '../types';

export function AssistantPanel({
  open,
  selectedNote,
  conversation,
  chatInput,
  isAsking,
  isDistilling,
  settings,
  onChatInputChange,
  onAsk,
  onDistillToNote,
  onClose
}: {
  open: boolean;
  selectedNote: Note | null;
  conversation: Conversation | null;
  chatInput: string;
  isAsking: boolean;
  isDistilling: boolean;
  settings: AiSettings;
  onChatInputChange: (value: string) => void;
  onAsk: () => void;
  onDistillToNote: () => void;
  onClose: () => void;
}) {
  const messages = conversation?.messages || [];
  const hasMemory = Boolean(conversation?.memorySummary?.trim());
  const statusClass = settings.provider === 'local' ? 'idle' : settings.lastTestStatus || 'idle';

  return (
    <aside className={`assistant ${open ? 'open' : ''}`} aria-hidden={!open} inert={!open}>
      <div className="assistant-head">
        <div className="assistant-title">
          <Sparkles size={17} />
          <div>
            <strong>笔记助手</strong>
            <span>{selectedNote ? selectedNote.title || '无标题笔记' : '未选择笔记'}</span>
          </div>
        </div>
        <button className="icon-button ghost" onClick={onClose} aria-label="收起助手" title="收起助手">
          <X size={18} />
        </button>
      </div>

      <div className={`model-status ${statusClass}`}>
        <strong>{providerDisplayName(settings.provider)}</strong>
        <span>{modelStatusText(settings)}</span>
      </div>

      <div className="message-list">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isAsking && (
          <article className="message assistant-msg pending">
            <Loader2 className="spin" size={16} />
            <span>思考中</span>
          </article>
        )}
        {!messages.length && !isAsking && (
          <div className="chat-empty">
            <MessageSquare size={26} />
            <span>围绕这篇笔记提问，助手会引用相关片段作答。</span>
          </div>
        )}
      </div>

      <div className="chat-tools">
        <div
          className={`memory-chip ${hasMemory ? 'active' : ''}`}
          title={hasMemory ? conversation?.memorySummary : '对话达到一定长度后会自动生成阶段性记忆'}
        >
          <Brain size={15} />
          <span>{hasMemory ? '阶段记忆已启用' : '等待对话记忆'}</span>
        </div>
        <button
          className="secondary-action chat-tool-action"
          onClick={onDistillToNote}
          disabled={!selectedNote || messages.length < 2 || isAsking || isDistilling}
          title="总结当前对话并把重要内容补充到笔记"
        >
          {isDistilling ? <Loader2 className="spin" size={16} /> : <NotebookPen size={16} />}
          补充到笔记
        </button>
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
          placeholder="问这篇笔记…"
          disabled={!selectedNote}
        />
        <button
          className="primary-action compact"
          onClick={onAsk}
          disabled={!selectedNote || !chatInput.trim() || isAsking}
        >
          <MessageSquare size={16} />
          发送
        </button>
        {selectedNote && <p className="chat-hint">Enter 发送 · Shift + Enter 换行</p>}
      </div>
    </aside>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`message ${message.role === 'user' ? 'user' : 'assistant-msg'}`}>
      <div className="message-content">{message.content}</div>
      {message.sources?.length ? (
        <details className="source-details">
          <summary>引用片段 · {message.sources.length}</summary>
          <div className="source-list">
            {message.sources.slice(0, 4).map((source, index) => (
              <p key={`${source.noteId}-${source.section}-${index}`}>
                <strong>
                  {source.title} / {source.section}
                </strong>
                <span>{source.excerpt}</span>
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}
