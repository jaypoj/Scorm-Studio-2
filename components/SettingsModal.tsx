import React, { useState, useEffect } from 'react';
import { AISettings } from '../types';
import { Settings, Save, X, Cpu } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AISettings;
  onSave: (s: AISettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  const [localSettings, setLocalSettings] = useState<AISettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-slate-600" />
            AI Settings
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                <Cpu className="w-4 h-4" />
                Default Model
            </label>
            <select
              value={localSettings.model}
              onChange={(e) => setLocalSettings({ ...localSettings, model: e.target.value as any })}
              className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
                <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast & Efficient)</option>
                <option value="gemini-3-pro-preview">Gemini 3 Pro (Complex Tasks)</option>
            </select>
          </div>

          <div className="pt-2 border-t border-slate-200">
             <h3 className="text-sm font-semibold text-slate-800 mb-3">External API Integrations</h3>
             <div className="bg-amber-50 text-amber-900 border border-amber-200 text-xs p-3 rounded mb-4">
                 <p className="font-bold mb-1">To use Image and Video search:</p>
                 <ol className="list-decimal pl-4 space-y-1">
                     <li><strong>Do NOT use the default `gen-lang-client` project.</strong> Google blocks Custom Search on this auto-generated project. You must create a <a href="https://console.cloud.google.com/projectcreate" target="_blank" className="underline font-semibold">new project in Google Cloud Console</a>.</li>
                     <li>In your new project, search for and enable <strong>Custom Search API</strong> and <strong>YouTube Data API v3</strong>.</li>
                     <li>Create a restricted API key and add it to `.env.local` as `VITE_GOOGLE_SEARCH_API_KEY`.</li>
                     <li>Create a Search Engine at <a href="https://programmablesearchengine.google.com" target="_blank" className="underline font-semibold">programmablesearchengine.google.com</a>, enable Image Search, and add the ID to `.env.local` as `VITE_GOOGLE_SEARCH_ENGINE_ID`.</li>
                 </ol>
             </div>
             <div className="space-y-3">
                 <div>
                     <label className="block text-xs font-medium text-slate-700 mb-1">Google Cloud API Key (Search & YouTube)</label>
                     <input 
                         type="password"
                         value={localSettings.googleSearchApiKey || ''}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, googleSearchApiKey: e.target.value }))}
                         className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         placeholder="AIzaSy..."
                     />
                 </div>
                 <div>
                     <label className="block text-xs font-medium text-slate-700 mb-1">Search Engine ID (CX)</label>
                     <input 
                         type="text"
                         value={localSettings.googleSearchEngineId || ''}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, googleSearchEngineId: e.target.value }))}
                         className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         placeholder="e.g. 1234567890abcdef"
                     />
                 </div>
             </div>
          </div>
          
          <button
            onClick={() => {
                onSave(localSettings);
                onClose();
            }}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Save className="w-4 h-4" />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
