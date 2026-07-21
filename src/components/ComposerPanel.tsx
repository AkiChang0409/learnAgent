import { FileText, Loader2, Mic, MicOff } from 'lucide-react';

export function ComposerPanel({
  composer,
  isGenerating,
  isListening,
  voiceError,
  onComposerChange,
  onGenerate,
  onToggleListening
}: {
  composer: string;
  isGenerating: boolean;
  isListening: boolean;
  voiceError: string;
  onComposerChange: (value: string) => void;
  onGenerate: () => void;
  onToggleListening: () => void;
}) {
  return (
    <section className="composer-panel">
      <textarea
        value={composer}
        onChange={(event) => onComposerChange(event.target.value)}
        placeholder="输入今天学习的主题，例如：今天学了操作系统里的虚拟内存和页面置换算法"
      />
      <div className="composer-actions">
        <button
          className={`icon-button ${isListening ? 'danger' : ''}`}
          title="语音输入"
          aria-label="语音输入"
          onClick={onToggleListening}
        >
          {isListening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {voiceError && <span className="voice-error">{voiceError}</span>}
        <button className="primary-action" onClick={onGenerate} disabled={!composer.trim() || isGenerating}>
          {isGenerating ? <Loader2 className="spin" size={18} /> : <FileText size={18} />}
          生成知识总结
        </button>
      </div>
    </section>
  );
}
