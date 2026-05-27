import React from 'react';
import { ViewState, ScormProject } from '../types';
import { LayoutDashboard, BookOpen, Layers, CheckSquare, Settings, FileJson, Save, FolderOutput, FilePlus2, Mic, FileText, Loader2 } from 'lucide-react';

interface SidebarProps {
  project: ScormProject;
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  onSave: () => void;
  onOpenSettings: () => void;
  onCloseProject: () => void;
  onCreateNewCourse: () => void;
  onLockSite: () => void;
  onBatchGenerateTts: () => Promise<void>;
  onBatchGenerateCaptions: () => Promise<void>;
  batchJob?: 'tts' | 'captions' | null;
  batchDisabled?: boolean;
  resumeTtsAvailable?: boolean;
  hideTemplatePages?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ project, currentView, onNavigate, onSave, onOpenSettings, onCloseProject, onCreateNewCourse, onLockSite, onBatchGenerateTts, onBatchGenerateCaptions, batchJob = null, batchDisabled = false, resumeTtsAvailable = false, hideTemplatePages = false }) => {
  const isTopicActive = (id: string) => {
    return typeof currentView === 'object' && currentView.type === 'topic-edit' && currentView.id === id;
  };

  return (
    <div className="w-72 bg-slate-900 text-slate-300 flex flex-col h-full border-r border-slate-800">
      <div className="p-4 border-b border-slate-800">
        <h1 className="text-white font-bold text-lg flex items-center gap-2">
          <FileJson className="w-5 h-5 text-blue-400" />
          SCORM Architect
        </h1>
        <p className="text-xs text-slate-500 mt-1 truncate" title={project.project.name}>
          {project.project.name}
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        <button
          onClick={() => onNavigate('metadata')}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
            currentView === 'metadata' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'
          }`}
        >
          <Settings className="w-4 h-4" />
          Metadata & Settings
        </button>

        <div className="pt-4 pb-1 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Course Structure
        </div>

        {!hideTemplatePages && (
          <button
            onClick={() => onNavigate('welcome')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              currentView === 'welcome' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Welcome Page
          </button>
        )}

        {!hideTemplatePages && (
          <button
            onClick={() => onNavigate('objectives')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              currentView === 'objectives' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            Learning Objectives
          </button>
        )}

        <div className="pt-4 pb-1 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider flex justify-between items-center">
          <span>Topics</span>
          <span className="bg-slate-800 text-xs px-1.5 rounded">{project.courseContent.topics.length}</span>
        </div>

        <div className="space-y-0.5">
          <button
             onClick={() => onNavigate('topic-list')}
             className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                currentView === 'topic-list' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'
             }`}
           >
            <Layers className="w-4 h-4" />
            <span className="flex-1 text-left">All Topics</span>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-violet-500/20 text-violet-200 border border-violet-400/30">
              Edit
            </span>
           </button>
           
           <div className="pl-4 space-y-0.5 mt-1 border-l-2 border-slate-800 ml-3">
            {project.courseContent.topics.map((topic, idx) => (
              <button
                key={topic.id}
                onClick={() => onNavigate({ type: 'topic-edit', id: topic.id })}
                className={`w-full text-left px-3 py-1.5 rounded-r-md text-xs truncate transition-colors ${
                  isTopicActive(topic.id) ? 'bg-slate-800 text-blue-400 border-l-2 border-blue-400 -ml-0.5' : 'hover:text-white text-slate-400'
                }`}
              >
                {idx + 1}. {topic.title}
              </button>
            ))}
           </div>
        </div>

        <div className="pt-4 pb-1 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Evaluation
        </div>

        <button
          onClick={() => onNavigate('assessment')}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
            currentView === 'assessment' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'
          }`}
        >
          <CheckSquare className="w-4 h-4" />
          Assessment Engine
        </button>
      </nav>

      <div className="p-4 border-t border-slate-800 space-y-2">
        <div className="pb-2 mb-2 border-b border-slate-800 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 px-1">
            Course Batch Tools
          </div>
          <button
            onClick={onBatchGenerateTts}
            disabled={batchDisabled || batchJob !== null}
            className="w-full flex justify-center items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-100 px-4 py-2 rounded text-xs transition-colors disabled:opacity-50"
          >
            {batchJob === 'tts' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
            {resumeTtsAvailable ? 'Resume Batch TTS' : 'Batch Generate TTS'}
          </button>
          <button
            onClick={onBatchGenerateCaptions}
            disabled={batchDisabled || batchJob !== null}
            className="w-full flex justify-center items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-100 px-4 py-2 rounded text-xs transition-colors disabled:opacity-50"
          >
            {batchJob === 'captions' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
            Batch Generate VTT
          </button>
          <p className="text-[10px] text-slate-500 px-1">
            Azure TTS preserves existing audio by default. VTT is built locally from narration when possible.
          </p>
        </div>
        <button
          onClick={onCreateNewCourse}
          className="w-full flex justify-center items-center gap-2 bg-violet-700 hover:bg-violet-600 text-white px-4 py-2.5 rounded shadow-lg transition-all active:scale-95"
        >
          <FilePlus2 className="w-4 h-4" />
          Create New Course
        </button>
        <button
          onClick={onCloseProject}
          className="w-full flex justify-center items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded text-xs transition-colors mb-4"
        >
          <FolderOutput className="w-3 h-3" />
          Close Project
        </button>
        <button
          onClick={onOpenSettings}
          className="w-full flex justify-center items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded text-xs transition-colors"
        >
          <Settings className="w-3 h-3" />
          AI Settings
        </button>
        <button
          onClick={onSave}
          className="w-full flex justify-center items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded shadow-lg transition-all active:scale-95"
        >
          <Save className="w-4 h-4" />
          Save Project
        </button>
        <button
          onClick={onLockSite}
          className="w-full flex justify-center items-center gap-2 bg-slate-950 hover:bg-black text-slate-300 px-4 py-2 rounded text-xs transition-colors"
        >
          Lock Site
        </button>
      </div>
    </div>
  );
};
