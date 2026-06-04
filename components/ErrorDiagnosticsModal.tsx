import React, { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

interface ErrorDiagnosticsModalProps {
  title: string;
  report: string;
  onClose: () => void;
}

export const ErrorDiagnosticsModal: React.FC<ErrorDiagnosticsModalProps> = ({ title, report, onClose }) => {
  const [copied, setCopied] = useState(false);

  const copyReport = async () => {
    await navigator.clipboard.writeText(report);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[120] flex items-center justify-center p-4 sm:p-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[86vh] flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center gap-4 bg-slate-50">
          <div>
            <h2 className="font-bold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500">Copy this report and forward it to IT. API keys are not included.</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-800"
            aria-label="Close diagnostics"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 flex-1 min-h-0 flex flex-col gap-3">
          <textarea
            readOnly
            value={report}
            className="flex-1 min-h-[320px] w-full rounded-lg border border-slate-300 bg-slate-950 p-4 font-mono text-xs text-green-300 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            spellCheck={false}
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={copyReport}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-2"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy Diagnostic Report'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
