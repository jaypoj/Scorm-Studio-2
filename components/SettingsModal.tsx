import React, { useState, useEffect } from 'react';
import { AISettings } from '../types';
import { Settings, Save, X, Cpu } from 'lucide-react';
import { GEMINI_MODEL_OPTIONS } from '../constants';

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start justify-center z-50 overflow-y-auto p-4 sm:p-6">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center gap-4 p-6 pb-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-slate-600" />
            AI Settings
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 rounded-full p-1 -m-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Close AI settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto p-6 pt-4">
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
                {GEMINI_MODEL_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
          </div>

          <div className="pt-2 border-t border-slate-200">
             <h3 className="text-sm font-semibold text-slate-800 mb-3">Azure OpenAI TTS</h3>
             <div className="space-y-3">
                 <div>
                     <label className="block text-xs font-medium text-slate-700 mb-1">Azure OpenAI Endpoint</label>
                     <input
                         type="url"
                         value={localSettings.azureOpenAiEndpoint || ''}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, azureOpenAiEndpoint: e.target.value }))}
                         className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         placeholder="https://your-resource.services.ai.azure.com"
                     />
                 </div>
                 <div>
                     <label className="block text-xs font-medium text-slate-700 mb-1">Azure OpenAI API Key</label>
                     <input
                         type="password"
                         value={localSettings.azureOpenAiApiKey || ''}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, azureOpenAiApiKey: e.target.value }))}
                         className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         placeholder="Paste team-provided Azure key"
                     />
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                     <div>
                         <label className="block text-xs font-medium text-slate-700 mb-1">TTS Model</label>
                         <input
                             value={localSettings.azureOpenAiTtsModel || 'gpt-4o-mini-tts'}
                             onChange={(e) => setLocalSettings(prev => ({ ...prev, azureOpenAiTtsModel: e.target.value }))}
                             className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         />
                     </div>
                     <div>
                         <label className="block text-xs font-medium text-slate-700 mb-1">API Version</label>
                         <input
                             value={localSettings.azureOpenAiApiVersion || 'preview'}
                             onChange={(e) => setLocalSettings(prev => ({ ...prev, azureOpenAiApiVersion: e.target.value }))}
                             className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         />
                     </div>
                 </div>
                 <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">This stores the Azure key in this browser only, similar to the runtime Gemini key. Do not add the Azure key to GitHub Pages secrets or source files.</p>
                 <label className="flex items-start gap-3 p-3 rounded border border-slate-200 bg-slate-50">
                     <input
                         type="checkbox"
                         checked={Boolean(localSettings.regenerateExistingAudio)}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, regenerateExistingAudio: e.target.checked }))}
                         className="mt-0.5"
                     />
                     <span className="text-xs text-slate-700">
                         <span className="block font-semibold text-slate-800">Regenerate existing narration audio during batch TTS</span>
                         Leave this off to avoid spending quota on pages that already have usable audio.
                     </span>
                 </label>
             </div>
          </div>

          <div className="pt-2 border-t border-slate-200">
             <h3 className="text-sm font-semibold text-slate-800 mb-3">Gemini Key Control</h3>
             <div className="bg-blue-50 text-blue-900 border border-blue-200 text-xs p-3 rounded mb-4">
                 <p className="font-bold mb-1">Runtime Gemini keys are now the default source for AI calls.</p>
                 <p>
                   Enter a primary and optional fallback Gemini key here. Bundled GitHub Pages Gemini keys are off by default unless you explicitly re-enable them below.
                 </p>
             </div>
             <div className="space-y-3">
                 <div>
                     <label className="block text-xs font-medium text-slate-700 mb-1">Gemini API Key (Primary Runtime Override)</label>
                     <input 
                         type="password"
                         value={localSettings.geminiApiKey || ''}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, geminiApiKey: e.target.value }))}
                         className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         placeholder="AIzaSy..."
                     />
                 </div>
                 <div>
                     <label className="block text-xs font-medium text-slate-700 mb-1">Gemini Fallback Key (Optional)</label>
                     <input 
                         type="password"
                         value={localSettings.geminiFallbackApiKey || ''}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, geminiFallbackApiKey: e.target.value }))}
                         className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         placeholder="Second key for automatic failover"
                     />
                 </div>
                 <label className="flex items-start gap-3 p-3 rounded border border-slate-200 bg-slate-50">
                     <input
                         type="checkbox"
                         checked={Boolean(localSettings.allowBundledGeminiFallback)}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, allowBundledGeminiFallback: e.target.checked }))}
                         className="mt-0.5"
                     />
                     <span className="text-xs text-slate-700">
                         <span className="block font-semibold text-slate-800">Allow bundled GitHub Pages Gemini fallback</span>
                         Keep this off for deterministic runtime-only behavior. Turn it on only if you intentionally want the deployed `VITE_*` Gemini key to be used after your runtime keys fail.
                     </span>
                 </label>
             </div>
          </div>

          <div className="pt-2 border-t border-slate-200">
             <h3 className="text-sm font-semibold text-slate-800 mb-3">External API Integrations</h3>
             <div className="bg-amber-50 text-amber-900 border border-amber-200 text-xs p-3 rounded mb-4">
                 <p className="font-bold mb-1">To use image and video search:</p>
                 <ol className="list-decimal pl-4 space-y-1">
                     <li>Create a Pixabay API key for image search at <a href="https://pixabay.com/api/docs/" target="_blank" className="underline font-semibold">pixabay.com/api/docs</a>.</li>
                     <li>Create a Google Cloud project and enable <strong>YouTube Data API v3</strong> if you want YouTube search.</li>
                     <li>Use restricted test keys in this browser app, because any `VITE_*` key is embedded into the client bundle.</li>
                 </ol>
             </div>
             <div className="space-y-3">
                 <div>
                     <label className="block text-xs font-medium text-slate-700 mb-1">Pixabay API Key (Images)</label>
                     <input 
                         type="password"
                         value={localSettings.pixabayApiKey || ''}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, pixabayApiKey: e.target.value }))}
                         className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         placeholder="5480..."
                     />
                 </div>
                 <div>
                     <label className="block text-xs font-medium text-slate-700 mb-1">Google API Key (Images + YouTube)</label>
                     <input 
                         type="password"
                         value={localSettings.googleSearchApiKey || ''}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, googleSearchApiKey: e.target.value }))}
                         className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         placeholder="AIzaSy..."
                     />
                 </div>
                 <div>
                     <label className="block text-xs font-medium text-slate-700 mb-1">Google Search Engine ID (CX)</label>
                     <input 
                         type="text"
                         value={localSettings.googleSearchEngineId || ''}
                         onChange={(e) => setLocalSettings(prev => ({ ...prev, googleSearchEngineId: e.target.value }))}
                         className="w-full p-2 text-sm bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                         placeholder="e.g. c22b6899c08714fb0"
                     />
                 </div>
             </div>
          </div>
          
          <button
            onClick={() => {
                onSave(localSettings);
                onClose();
            }}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium flex items-center justify-center gap-2 transition-colors sticky bottom-0"
          >
            <Save className="w-4 h-4" />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
