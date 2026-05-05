import React, { useState } from 'react';
import { generateTopicContent } from '../services/geminiService';
import { Topic, AISettings } from '../types';
import { Sparkles, Loader2, X } from 'lucide-react';
import { DEFAULT_GEMINI_MODEL } from '../constants';

interface AIGeneratorModalProps {
  onClose: () => void;
  onTopicGenerated: (topic: Partial<Topic>) => void;
}

export const AIGeneratorModal: React.FC<AIGeneratorModalProps> = ({ onClose, onTopicGenerated }) => {
  const [title, setTitle] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!title || !sourceText) return;

    setLoading(true);
    setError(null);

    try {
      // Use default model if none specified in global settings (not passed here currently)
      const tempSettings: AISettings = { model: DEFAULT_GEMINI_MODEL as any };
      const result = await generateTopicContent(tempSettings, title, sourceText);
      onTopicGenerated(result);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to generate content');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            AI Topic Generator
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Topic Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none"
              placeholder="e.g. Hazardous Area Classification"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Raw Source Text</label>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              rows={6}
              className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none text-sm"
              placeholder="Paste the raw text content here..."
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded border border-red-100">
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading || !title || !sourceText}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white rounded font-medium flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating Structure...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Topic
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
