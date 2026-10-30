import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Eye, Loader2, RefreshCw, X } from 'lucide-react';
import { ScormProject, FileSystemDirectoryHandle } from '../types';
import { ScormPackager } from '../services/scormPackager';
import { createScormPreviewBundle, ScormPreviewBundle } from '../services/scormPreview';

interface CoursePreviewModalProps {
  project: ScormProject;
  assetsHandle: FileSystemDirectoryHandle | null;
  rootHandle: FileSystemDirectoryHandle | null;
  onClose: () => void;
}

/** A learner-facing preview from an in-memory export. Never writes project files or reports to an LMS. */
export const CoursePreviewModal: React.FC<CoursePreviewModalProps> = ({ project, assetsHandle, rootHandle, onClose }) => {
  const [bundle, setBundle] = useState<ScormPreviewBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageWarning, setImageWarning] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    setError(null);
    setImageWarning(null);
    const prepare = async () => {
      try {
        // Reuse the CURRENT production exporter, including its Next-button repair.
        const zip = await ScormPackager.createScormPackage(project, assetsHandle, rootHandle);
        if (cancelled) return;
        const preview = await createScormPreviewBundle(zip);
        if (cancelled) return;
        const missing = ScormPackager.lastImageReport?.summary.unresolved || 0;
        if (missing > 0) {
          setImageWarning(`${missing} image${missing === 1 ? '' : 's'} could not be included. Reconnect the correct media folder before exporting.`);
        }
        setBundle(preview);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Course preview could not be generated.');
      }
    };
    void prepare();
    return () => { cancelled = true; };
  }, [project, assetsHandle, rootHandle, refreshToken]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [onClose]);

  const sendPreviewAssets = () => {
    if (!bundle || !iframeRef.current?.contentWindow) return;
    // Opaque-origin iframe: '*' is required. This payload contains only
    // exported page HTML/media; it never contains API keys or browser storage.
    iframeRef.current.contentWindow.postMessage({
      type: 'scorm-studio-preview-payload',
      pages: bundle.pages,
      assets: bundle.assets,
    }, '*');
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 text-white" role="dialog" aria-modal="true" aria-label="Preview course as a learner">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border-b border-slate-700 px-4 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Eye className="w-5 h-5 text-violet-300 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">Learner Preview — {project.courseData.title || project.project.name}</h2>
            <p className="text-xs text-slate-300">Built from the actual SCORM output · No LMS scores or progress are recorded</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setRefreshToken(token => token + 1)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-2 text-xs font-semibold hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
            title="Rebuild the learner preview from the current course">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button ref={closeButtonRef} type="button" onClick={onClose}
            className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 py-2 text-sm font-semibold hover:bg-violet-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            <X className="w-4 h-4" /> Close Preview
          </button>
        </div>
      </header>
      <div className="bg-slate-800 px-4 py-2 text-xs text-slate-200 shrink-0">
        Use the course's Next/Previous controls. Play narration with the audio player and select <strong>CC On</strong> to view synchronized captions. Audio and captions must already be generated and attached to the page.
      </div>
      {imageWarning && (
        <div role="status" className="flex gap-2 items-center bg-amber-900 text-amber-100 px-4 py-2 text-xs shrink-0">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {imageWarning}
        </div>
      )}
      {error ? (
        <div role="alert" className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
          <AlertTriangle className="w-8 h-8 text-amber-400" />
          <h3 className="font-semibold text-lg">Preview unavailable</h3>
          <p className="max-w-xl text-slate-300 text-sm">{error}</p>
          <button type="button" onClick={() => setRefreshToken(token => token + 1)} className="rounded bg-violet-700 hover:bg-violet-600 px-4 py-2 font-semibold">Try Again</button>
        </div>
      ) : bundle ? (
        <iframe
          key={refreshToken}
          ref={iframeRef}
          title="SCORM learner preview — isolated from LMS and editor"
          className="w-full flex-1 border-0 bg-[#17141d]"
          // Deliberately NO allow-same-origin, popups, top-navigation or forms:
          // imported course HTML cannot see authoring settings or browser storage.
          sandbox="allow-scripts"
          srcDoc={bundle.html}
          onLoad={sendPreviewAssets}
        />
      ) : (
        <div role="status" className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-300 text-sm">
          <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
          Preparing learner preview from the SCORM package…
          <span className="text-slate-400 text-xs">Media remains in this browser. No project files are changed.</span>
        </div>
      )}
    </div>
  );
};
