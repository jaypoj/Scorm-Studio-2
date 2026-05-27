export interface MediaItem {
  id: string;
  storageId: string;
  type: 'image' | 'audio' | 'video' | 'caption';
  title?: string;
  url?: string; // Blob URL for preview
  content?: string; // For captions
  candidate?: boolean; // Imported but not yet placed on the visible page
  source?: 'powerpoint' | 'upload' | 'generated' | 'search' | string;
}

export interface Question {
  id: string;
  type: 'multiple-choice' | 'true-false';
  question: string;
  options?: string[]; // Only for multiple-choice
  correctAnswer: string;
  feedback: {
    correct: string;
    incorrect: string;
  };
}

export interface Assessment {
  narration: string | null;
  passMark: number;
  questions: Question[];
}

export interface Topic {
  id: string;
  title: string;
  content: string; // HTML
  narration: string;
  duration: number;
  imageKeywords: string[];
  imagePrompts: string[];
  notes?: string; // Imported PowerPoint speaker notes or page-level working notes
  caption?: string; // WebVTT
  videoSearchTerms?: string[];
  media?: MediaItem[];
  knowledgeCheck?: {
    questions: Question[];
  };
}

export interface LearningObjectivesPage {
  id: string;
  title: string;
  content: string;
  narration: string;
  duration: number;
  imageKeywords: string[];
  imagePrompts: string[];
  caption?: string;
  media?: MediaItem[];
}

export interface WelcomePage {
  id: string;
  title: string;
  content: string;
  narration: string;
  duration: number;
  imageKeywords: string[];
  imagePrompts: string[];
  caption?: string;
  media?: MediaItem[];
}

export interface CourseContent {
  welcomePage: WelcomePage;
  learningObjectivesPage: LearningObjectivesPage;
  topics: Topic[];
  assessment: Assessment;
  lastModified?: string;
}

export interface CourseData {
  title: string;
  difficulty: number;
  template: string;
  topics: string[]; // High level outline strings
  customTopics: string[] | null;
}

export interface JsonImportData {
  isLocked: boolean;
  isTreeVisible: boolean;
  rawJson: string; // The Triple-Entry backup string
  validationResult: {
    data: CourseContent; // The Triple-Entry validation clone
    isValid: boolean;
    summary: string;
  };
}

export interface ProjectMetadata {
  id: string;
  name: string;
  created: string;
  lastModified: string;
  path: string;
}

export interface ScormProject {
  project: ProjectMetadata;
  courseData: CourseData;
  courseContent: CourseContent;
  jsonImportData: JsonImportData;
  aiPrompt: string | null;
  media: {
    images: any[];
    videos: any[];
    audio: any[];
  };
  scormConfig: {
    version: string;
    passingScore: number;
    completionCriteria: string;
    requireKnowledgeCheckBeforeContinue: boolean;
    requireAudioCompletionBeforeContinue: boolean;
    outputTheme: 'dark-violet' | 'legacy-green';
    contentMode?: 'standard' | 'ppt-import';
  };
}

// Browser File System Access API Types (Partial & Mockable)
export interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
  isSameEntry?: (other: FileSystemHandle) => Promise<boolean>;
}

export interface FileSystemFileHandle extends FileSystemHandle {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

export interface FileSystemDirectoryHandle extends FileSystemHandle {
  kind: 'directory';
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  values(): AsyncIterableIterator<FileSystemHandle>;
  removeEntry?(name: string): Promise<void>;
}

// We define this explicitly to allow mocking without implementing the full WritableStream interface
export interface FileSystemWritableFileStream {
  write(data: any): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
  close(): Promise<void>;
}

export interface ProjectContext {
  projectData: ScormProject;
  projectHandle: FileSystemFileHandle | null;
  assetsHandle: FileSystemDirectoryHandle | null;
  rootHandle: FileSystemDirectoryHandle | null;
  isSandbox: boolean; // Flag to indicate if we are in virtual mode
}

export interface DiscoveredProject {
  projectHandle: FileSystemFileHandle;
  projectData: ScormProject;
  assetsHandle: FileSystemDirectoryHandle | null;
  projectRootHandle?: FileSystemDirectoryHandle | null;
}

export type ViewState = 
  | 'welcome' 
  | 'objectives' 
  | 'topic-list' 
  | 'assessment' 
  | 'metadata'
  | 'project-select'
  | { type: 'topic-edit', id: string };

export interface AISettings {
  model: string;
  geminiApiKey?: string;
  geminiFallbackApiKey?: string;
  allowBundledGeminiFallback?: boolean;
  quotaMode?: 'free-first' | 'paid-gemini';
  ttsDailyBudget?: number;
  regenerateExistingAudio?: boolean;
  googleSearchApiKey?: string;
  googleSearchEngineId?: string;
  pixabayApiKey?: string;
}

export interface ImportedProjectMediaFile {
  file: File;
  storageId: string;
  pageId: string;
  type: 'image' | 'audio' | 'video';
  title: string;
  source?: string;
  originalName?: string;
}

export type AiRateLimitLevel = '0' | 'some' | 'medium' | 'most' | 'full';

export interface PronunciationEntry {
  id: string;
  term: string;
  replacement: string;
}

export interface TtsSettings {
  voiceName: string;
  pace: 'very-slow' | 'slow' | 'normal' | 'fast' | 'very-fast';
}

export interface PronunciationConfig {
  tts: TtsSettings;
  pronunciations: PronunciationEntry[];
}

export type BatchJobType = 'tts' | 'captions' | null;
export type BatchPageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface BatchProgressItem {
  pageId: string;
  title: string;
  audioStatus: BatchPageStatus;
  captionStatus: BatchPageStatus;
  message?: string;
  quotaPaused?: boolean;
  retryAfterSeconds?: number;
  providerMessage?: string;
}
