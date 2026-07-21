export type AiProvider = 'local' | 'openai-compatible' | 'ollama';

export interface AiSettings {
  provider: AiProvider;
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface NoteSection {
  id: string;
  heading: string;
  content: string;
}

export interface Note {
  id: string;
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
  updatedAt: string;
}

export interface AppData {
  notes: Note[];
  conversations: Conversation[];
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

export interface RagSource {
  noteId: string;
  title: string;
  section: string;
  excerpt: string;
  score: number;
}

export interface LearnAgentBridge {
  loadData: () => Promise<AppData>;
  saveData: (data: AppData) => Promise<{ ok: boolean; filePath: string }>;
  generateNote: (payload: { input: string; settings: AiSettings }) => Promise<GeneratedNoteDraft>;
  chatWithNote: (payload: {
    question: string;
    note: Note;
    context: string;
    sources: RagSource[];
    history: ChatMessage[];
    settings: AiSettings;
  }) => Promise<string>;
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
