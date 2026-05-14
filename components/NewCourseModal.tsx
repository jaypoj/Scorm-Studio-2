import React, { useEffect, useState } from 'react';
import { Bot, BookOpen, FileText, Loader2, Presentation, Upload, X } from 'lucide-react';
import { AISettings, AiRateLimitLevel } from '../types';
import { DEFAULT_GEMINI_MODEL, GEMINI_MODEL_OPTIONS } from '../constants';

export interface NewCourseRequest {
  courseName: string;
  difficulty: number;
  topics: string[];
  mode: 'ai' | 'manual' | 'powerpoint';
  model: string;
  rateLimit: AiRateLimitLevel;
  referenceFiles: File[];
  powerPointFile: File | null;
}

interface NewCourseModalProps {
  isOpen: boolean;
  isCreating: boolean;
  error: string | null;
  status: string | null;
  progress?: number | null;
  aiSettings: AISettings;
  allowPowerPointImport?: boolean;
  onClose: () => void;
  onCreate: (request: NewCourseRequest) => Promise<void>;
}

const RATE_LIMIT_OPTIONS: { value: AiRateLimitLevel; label: string; helper: string }[] = [
  { value: '0', label: '0', helper: 'Most limited: smallest document context and longest pause.' },
  { value: 'some', label: 'Some', helper: 'Conservative: trims references heavily for free-tier safety.' },
  { value: 'medium', label: 'Medium', helper: 'Balanced: good for normal topic lists and small references.' },
  { value: 'most', label: 'Most', helper: 'Higher usage: sends more source material.' },
  { value: 'full', label: 'Full', helper: 'No limits: sends the most context the app can reasonably fit.' },
];

const ACCEPTED_REFERENCE_TYPES = '.xls,.xlsx,.csv,.pdf,.txt,.doc,.docx,.rtf,.json,.md,.html,.htm,.ppt,.pptx';
const ACCEPTED_POWERPOINT_TYPES = '.ppt,.pptx';

export const NewCourseModal: React.FC<NewCourseModalProps> = ({ isOpen, isCreating, error, status, progress = null, aiSettings, allowPowerPointImport = false, onClose, onCreate }) => {
  const [courseName, setCourseName] = useState('');
  const [difficulty, setDifficulty] = useState(3);
  const [topicText, setTopicText] = useState('');
  const [mode, setMode] = useState<'ai' | 'manual' | 'powerpoint'>('ai');
  const [model, setModel] = useState(aiSettings.model || DEFAULT_GEMINI_MODEL);
  const [rateLimit, setRateLimit] = useState<AiRateLimitLevel>('medium');
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [powerPointFile, setPowerPointFile] = useState<File | null>(null);

  useEffect(() => {
    if (isOpen) setModel(aiSettings.model || DEFAULT_GEMINI_MODEL);
  }, [aiSettings.model, isOpen]);

  useEffect(() => {
    if (isOpen && !allowPowerPointImport && mode === 'powerpoint') {
      setMode('ai');
      setPowerPointFile(null);
    }
  }, [allowPowerPointImport, isOpen, mode]);

  if (!isOpen) return null;

  const topics = topicText.split('\n').map(topic => topic.trim().replace(/^[-*]\s*/, '')).filter(Boolean);
  const canCreate = courseName.trim().length > 0
    && (mode === 'manual' || mode === 'powerpoint' || topics.length > 0)
    && (mode !== 'powerpoint' || Boolean(powerPointFile));
  const selectedRateLimit = RATE_LIMIT_OPTIONS.find(option => option.value === rateLimit) || RATE_LIMIT_OPTIONS[2];
  const addReferenceFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    setReferenceFiles(prev => {
      const seen = new Set(prev.map(file => `${file.name}-${file.size}-${file.lastModified}`));
      return [...prev, ...incoming.filter(file => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })];
    });
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-200 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Create New Course</h2>
            <p className="text-sm text-slate-500 mt-1">Choose a working folder, then build with AI or start manually.</p>
          </div>
          <button onClick={onClose} disabled={isCreating} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Course Name</label>
            <input
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="e.g. Gas Distribution - 100 - Bluebeam for Project Mark Ups"
            />
          </div>

          <div className={`grid grid-cols-1 ${allowPowerPointImport ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-3`}>
            <button
              onClick={() => setMode('ai')}
              className={`p-4 border rounded-lg text-left transition-colors ${mode === 'ai' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
            >
              <div className="font-semibold text-slate-900 flex items-center gap-2"><Bot className="w-4 h-4" /> Build with AI</div>
              <p className="text-xs text-slate-600 mt-1">Generate welcome, objectives, topic pages, knowledge checks, image prompts, video terms, and final quiz.</p>
            </button>
            {allowPowerPointImport && (
              <button
                onClick={() => setMode('powerpoint')}
                className={`p-4 border rounded-lg text-left transition-colors ${mode === 'powerpoint' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <div className="font-semibold text-slate-900 flex items-center gap-2"><Presentation className="w-4 h-4" /> Import PowerPoint</div>
                <p className="text-xs text-slate-600 mt-1">Convert each slide into an editable course page and copy slide media into the project.</p>
              </button>
            )}
            <button
              onClick={() => setMode('manual')}
              className={`p-4 border rounded-lg text-left transition-colors ${mode === 'manual' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
            >
              <div className="font-semibold text-slate-900 flex items-center gap-2"><BookOpen className="w-4 h-4" /> Build Manually</div>
              <p className="text-xs text-slate-600 mt-1">Create the project file, media folder, restore folder, and starter pages for the topics you list.</p>
            </button>
          </div>

          {mode === 'powerpoint' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">PowerPoint File</label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = Array.from(e.dataTransfer.files as FileList).find((item: File) => /\.(pptx?|PPTX?)$/.test(item.name));
                  if (file) setPowerPointFile(file);
                }}
                className="border-2 border-dashed border-orange-300 rounded-lg bg-orange-50 p-4 text-center"
              >
                <Presentation className="w-6 h-6 mx-auto text-orange-500 mb-2" />
                <p className="text-sm font-medium text-slate-700">Drop a .pptx file here, or browse</p>
                <p className="text-xs text-slate-500 mt-1">Best support is for .pptx. Legacy .ppt files must be saved/exported as .pptx before import.</p>
                <label className="inline-flex mt-3 px-3 py-2 bg-white border border-orange-200 rounded text-sm font-semibold text-slate-700 hover:bg-orange-100 cursor-pointer">
                  Browse PowerPoint
                  <input
                    type="file"
                    accept={ACCEPTED_POWERPOINT_TYPES}
                    className="hidden"
                    onChange={(e) => {
                      setPowerPointFile(e.target.files?.[0] || null);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {powerPointFile && (
                <div className="mt-3 flex items-center justify-between gap-3 p-2 bg-white border border-orange-200 rounded text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <Presentation className="w-4 h-4 text-orange-500 shrink-0" />
                    <span className="truncate text-slate-800">{powerPointFile.name}</span>
                    <span className="text-xs text-slate-400 shrink-0">{Math.max(1, Math.round(powerPointFile.size / 1024))} KB</span>
                  </span>
                  <button onClick={() => setPowerPointFile(null)} className="text-xs font-semibold text-red-600 hover:text-red-700">Remove</button>
                </div>
              )}
            </div>
          )}

          {mode === 'ai' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border border-blue-100 rounded-lg bg-blue-50/60">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Model for Course Generation</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {GEMINI_MODEL_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">Defaults to your AI Settings model, but can be changed per new course.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Limit RPM / Token Pressure</label>
                <input
                  type="range"
                  min={0}
                  max={4}
                  value={RATE_LIMIT_OPTIONS.findIndex(option => option.value === rateLimit)}
                  onChange={(e) => setRateLimit(RATE_LIMIT_OPTIONS[Number(e.target.value)].value)}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] font-semibold text-slate-500">
                  {RATE_LIMIT_OPTIONS.map(option => <span key={option.value}>{option.label}</span>)}
                </div>
                <p className="text-xs text-slate-500 mt-1">{selectedRateLimit.helper}</p>
              </div>
            </div>
          )}

          {mode !== 'powerpoint' && <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Topics</label>
            <textarea
              value={topicText}
              onChange={(e) => setTopicText(e.target.value)}
              rows={10}
              className="w-full p-3 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
              placeholder={'One topic per line\nSetting up standardized Bluebeam tool chests\nProfessional annotation and markup techniques\nCalibration and linear measurement tools'}
            />
          </div>}

          {mode === 'ai' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reference Documents for AI</label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  addReferenceFiles(e.dataTransfer.files);
                }}
                className="border-2 border-dashed border-slate-300 rounded-lg bg-slate-50 p-4 text-center"
              >
                <Upload className="w-6 h-6 mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-medium text-slate-700">Drop source docs here, or browse</p>
                <p className="text-xs text-slate-500 mt-1">Supports PDF, Word, Excel, CSV, TXT, RTF, JSON, Markdown, and HTML. Large files are trimmed or skipped based on the limit setting.</p>
                <label className="inline-flex mt-3 px-3 py-2 bg-white border border-slate-300 rounded text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer">
                  Browse Files
                  <input
                    type="file"
                    multiple
                    accept={ACCEPTED_REFERENCE_TYPES}
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) addReferenceFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {referenceFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  {referenceFiles.map(file => (
                    <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center justify-between gap-3 p-2 bg-white border border-slate-200 rounded text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                        <span className="truncate text-slate-800">{file.name}</span>
                        <span className="text-xs text-slate-400 shrink-0">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                      </span>
                      <button
                        onClick={() => setReferenceFiles(prev => prev.filter(item => item !== file))}
                        className="text-xs font-semibold text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Difficulty: {difficulty}/5</label>
            <input
              type="range"
              min={1}
              max={5}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {(status || error) && (
            <div className={`p-3 text-sm rounded border ${error ? 'border-red-400 bg-red-950 text-red-100' : 'border-violet-500 bg-slate-950 text-violet-100'}`}>
              <div className="flex items-center justify-between gap-3">
                <span>{error || status}</span>
                {typeof progress === 'number' && !error && <span className="font-bold text-white">{Math.max(0, Math.min(100, progress))}%</span>}
              </div>
              {typeof progress === 'number' && !error && (
                <div className="mt-2 h-2 rounded-full bg-white/15 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={() => onCreate({ courseName: courseName.trim(), difficulty, topics, mode, model, rateLimit, referenceFiles, powerPointFile })}
            disabled={!canCreate || isCreating}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-semibold flex items-center justify-center gap-2"
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'ai' ? <Bot className="w-4 h-4" /> : mode === 'powerpoint' ? <Presentation className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
            {isCreating ? (status || 'Creating Course...') : mode === 'powerpoint' ? 'Import PowerPoint & Create Course' : 'Choose Folder & Create Course'}
          </button>
        </div>
      </div>
    </div>
  );
};
