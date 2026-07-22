export type AiProvider = 'local' | 'openai-compatible' | 'ollama';
export type AiTestStatus = 'idle' | 'success' | 'error';

export interface AiSettings {
  provider: AiProvider;
  endpoint: string;
  model: string;
  apiKey: string;
  lastTestedAt?: string;
  lastTestStatus?: AiTestStatus;
  lastTestMessage?: string;
}

export type TokenUsageOperation =
  | 'generate-note'
  | 'import-markdown'
  | 'chat-with-note'
  | 'summarize-conversation'
  | 'distill-conversation-to-note'
  | 'test-connection'
  | 'unknown';

export interface TokenUsageRecord {
  id: string;
  createdAt: string;
  operation: TokenUsageOperation;
  provider: AiProvider | string;
  endpoint: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number | null;
  currency: 'usd' | string;
  priceSource: string;
  responseId: string;
}

export interface NoteSection {
  id: string;
  heading: string;
  content: string;
}

export interface Note {
  id: string;
  parentId?: string;
  position?: number;
  title: string;
  subject: string;
  topic: string;
  tags: string[];
  summary: string;
  sections: NoteSection[];
  cases: string[];
  pitfalls: string[];
  interviewQuestions: string[];
  createdAt: string;
  updatedAt: string;
  searchExcerpt?: string;
  searchSection?: string;
  searchScore?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  sources?: RagSource[];
}

export interface Conversation {
  id: string;
  noteId: string;
  title: string;
  messages: ChatMessage[];
  memorySummary?: string;
  memoryUpdatedAt?: string;
  summarizedMessageCount?: number;
  updatedAt: string;
}

export interface AppData {
  schemaVersion?: number;
  notes: Note[];
  conversations: Conversation[];
  usageRecords: TokenUsageRecord[];
  settings: AiSettings;
}

export interface GeneratedNoteDraft {
  title: string;
  subject: string;
  topic: string;
  tags: string[];
  summary: string;
  sections: Array<{ heading: string; content: string }>;
  cases: string[];
  pitfalls: string[];
  interviewQuestions: string[];
}

export interface GeneratedNoteResult {
  draft: GeneratedNoteDraft;
  usedFallback: boolean;
  message: string;
  usageRecord?: TokenUsageRecord | null;
}

export interface MarkdownImportNoteDraft extends GeneratedNoteDraft {
  subNotes?: GeneratedNoteDraft[];
}

export interface SubjectKnowledgeTopicDraft {
  title: string;
  summary: string;
  notes: MarkdownImportNoteDraft[];
}

export interface SubjectKnowledgeMap {
  subject: string;
  title: string;
  overview: string;
  tags: string[];
  topics: SubjectKnowledgeTopicDraft[];
}

export interface MarkdownImportResult {
  canceled?: boolean;
  filePath?: string;
  fileName?: string;
  knowledgeMap?: SubjectKnowledgeMap;
  root?: MarkdownImportNoteDraft;
  usedFallback?: boolean;
  message?: string;
  usageRecord?: TokenUsageRecord | null;
}

export interface RagSource {
  noteId: string;
  title: string;
  section: string;
  excerpt: string;
  score: number;
}

export interface RagContextResult {
  context: string;
  sources: RagSource[];
}

export interface AiConnectionTestResult {
  ok: boolean;
  message: string;
  testedAt: string;
  usageRecord?: TokenUsageRecord | null;
}

export interface ChatResult {
  content: string;
  usedFallback: boolean;
  message: string;
  usageRecord?: TokenUsageRecord | null;
}

export interface ConversationMemoryResult {
  memorySummary: string;
  usedFallback: boolean;
  message: string;
  usageRecord?: TokenUsageRecord | null;
}

export interface NoteDistillationPatch {
  summaryAppend: string;
  sections: Array<{ heading: string; content: string }>;
  tags: string[];
  cases: string[];
  pitfalls: string[];
  interviewQuestions: string[];
}

export interface NoteDistillationResult {
  patch: NoteDistillationPatch;
  memorySummary: string;
  usedFallback: boolean;
  message: string;
  usageRecord?: TokenUsageRecord | null;
}

export interface SyncExportResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  summary?: {
    notes: number;
    conversations: number;
    usageRecords: number;
  };
}

export interface SyncImportResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  data?: AppData;
  summary?: {
    notesAdded: number;
    notesUpdated: number;
    conversationsAdded: number;
    conversationsUpdated: number;
    usageRecordsAdded: number;
  };
}

export interface LearnAgentBridge {
  loadData: () => Promise<AppData>;
  saveData: (data: AppData) => Promise<{ ok: boolean; filePath: string }>;
  searchNotes: (query: string) => Promise<Note[]>;
  retrieveContext: (payload: { question: string; currentNote: Note; limit?: number }) => Promise<RagContextResult>;
  exportSyncPackage: () => Promise<SyncExportResult>;
  importSyncPackage: () => Promise<SyncImportResult>;
  generateNote: (payload: { input: string; settings: AiSettings }) => Promise<GeneratedNoteResult>;
  importMarkdown: (payload: { settings: AiSettings }) => Promise<MarkdownImportResult>;
  chatWithNote: (payload: {
    question: string;
    note: Note;
    context: string;
    sources: RagSource[];
    history: ChatMessage[];
    memorySummary?: string;
    settings: AiSettings;
  }) => Promise<ChatResult>;
  summarizeConversation: (payload: {
    note: Note;
    previousSummary?: string;
    messages: ChatMessage[];
    settings: AiSettings;
  }) => Promise<ConversationMemoryResult>;
  distillConversationToNote: (payload: {
    note: Note;
    memorySummary?: string;
    messages: ChatMessage[];
    settings: AiSettings;
  }) => Promise<NoteDistillationResult>;
  testConnection: (payload: { settings: AiSettings }) => Promise<AiConnectionTestResult>;
  getDataFilePath: () => Promise<string>;
}

declare global {
  interface Window {
    learnAgent: LearnAgentBridge;
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

export interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      }) => void)
    | null;
}
