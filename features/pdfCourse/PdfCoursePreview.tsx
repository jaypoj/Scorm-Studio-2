import React, { useEffect, useRef, useState } from 'react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { CheckCircle2, X } from 'lucide-react';
import { PdfCourseDocument, PdfPreviewState } from './types';

interface PdfCoursePreviewProps {
  document: PdfCourseDocument;
  onClose: () => void;
}

const initialState = (): PdfPreviewState => ({
  maxPageReached: 0,
  totalPages: 0,
  percentViewed: 0,
  endReached: false,
  acknowledgementClicked: false,
  completed: false,
  timestamp: new Date().toISOString(),
});

export const PdfCoursePreview: React.FC<PdfCoursePreviewProps> = ({ document, onClose }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<PdfPreviewState>(initialState);
  const [logs, setLogs] = useState<string[]>(['Mock LMSInitialize("")']);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const pagesElement = pagesRef.current;
      const scrollElement = scrollRef.current;
      if (!pagesElement || !scrollElement) return;
      pagesElement.innerHTML = '';
      setError('');
      setProgress(initialState());

      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const data = new Uint8Array(await document.file.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        setProgress(current => ({ ...current, totalPages: pdf.numPages }));

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const available = Math.max(300, scrollElement.clientWidth - 64);
          const scale = Math.min(1.45, available / base.width);
          const viewport = page.getViewport({ scale });
          const wrapper = window.document.createElement('div');
          wrapper.className = 'relative bg-white shadow-2xl';
          wrapper.dataset.page = String(pageNumber);
          const canvas = window.document.createElement('canvas');
          const ratio = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas rendering is not available in this browser.');
          const badge = window.document.createElement('span');
          badge.className = 'absolute right-2 bottom-2 rounded bg-slate-900/85 px-2 py-1 text-[10px] text-white';
          badge.textContent = `Page ${pageNumber} / ${pdf.numPages}`;
          wrapper.append(canvas, badge);
          pagesElement.appendChild(wrapper);
          await page.render({
            canvas,
            canvasContext: context,
            viewport,
            transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
          }).promise;
        }
      } catch (renderError) {
        if (!cancelled) setError(renderError instanceof Error ? renderError.message : String(renderError));
      }
    };
    render();
    return () => {
      cancelled = true;
    };
  }, [document]);

  const trackProgress = () => {
    const scrollElement = scrollRef.current;
    const pagesElement = pagesRef.current;
    if (!scrollElement || !pagesElement) return;
    const pageElements = Array.from(pagesElement.querySelectorAll('[data-page]')) as HTMLElement[];
    if (!pageElements.length) return;
    const viewBottom = scrollElement.scrollTop + scrollElement.clientHeight;
    let maxPageReached = progress.maxPageReached;
    pageElements.forEach((page, index) => {
      if (page.offsetTop <= viewBottom - 20) maxPageReached = Math.max(maxPageReached, index + 1);
    });
    if (scrollElement.scrollTop + scrollElement.clientHeight >= scrollElement.scrollHeight - 24) {
      maxPageReached = pageElements.length;
    }
    const endReached = scrollElement.scrollTop + scrollElement.clientHeight >= scrollElement.scrollHeight - 24;
    const percentViewed = Math.max(progress.percentViewed, (maxPageReached / pageElements.length) * 100);
    setProgress(current => ({
      ...current,
      maxPageReached,
      totalPages: pageElements.length,
      percentViewed,
      endReached: current.endReached || endReached,
      timestamp: new Date().toISOString(),
    }));
  };

  const thresholdReached = progress.endReached && progress.percentViewed >= document.requiredScrollThreshold;

  const acknowledge = () => {
    if (!thresholdReached) return;
    const completedState = {
      ...progress,
      acknowledgementClicked: true,
      completed: true,
      timestamp: new Date().toISOString(),
    };
    setProgress(completedState);
    setLogs(current => [
      ...current,
      `LMSSetValue("cmi.suspend_data", ${JSON.stringify(completedState)})`,
      'LMSSetValue("cmi.core.lesson_status", "completed")',
      'LMSSetValue("cmi.core.score.raw", "100")',
      'LMSCommit("")',
    ]);
  };

  return (
    <div className="fixed inset-0 z-[140] bg-[#141b17]/90 p-3 sm:p-6">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-[#93866e] bg-[#f1ede3] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b-2 border-[#18221d] bg-[#fffdf7] p-4 sm:p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a9472b]">Mock SCORM preview</p>
            <h2 className="font-serif text-2xl font-bold text-[#18221d]">{document.title}</h2>
            <p className="mt-1 text-xs text-slate-600">Completion requires {document.requiredScrollThreshold}% progress and acknowledgement.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-200" aria-label="Close preview">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="flex min-h-0 flex-col p-3 sm:p-5">
            {error && <div className="mb-3 border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <div className="mb-3 flex items-center justify-between font-sans text-xs text-slate-700">
              <span>Page {progress.maxPageReached} of {progress.totalPages || '...'}</span>
              <strong>{Math.round(progress.percentViewed)}% viewed</strong>
            </div>
            <div
              ref={scrollRef}
              onScroll={trackProgress}
              className="min-h-0 flex-1 overflow-auto border-[3px] border-[#18221d] bg-[#343a36] p-4"
            >
              <div ref={pagesRef} className="flex flex-col items-center gap-5" />
            </div>
            <button
              onClick={acknowledge}
              disabled={!thresholdReached || progress.completed}
              className="mt-3 flex items-center justify-center gap-2 bg-[#41644a] px-5 py-3 font-sans text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {progress.completed && <CheckCircle2 className="h-4 w-4" />}
              {progress.completed ? 'Completed in mock SCORM' : 'Acknowledge and complete'}
            </button>
          </div>
          <aside className="min-h-0 overflow-auto border-l border-[#c9bea8] bg-[#fffdf7] p-5">
            <h3 className="font-serif text-lg font-bold">Mock SCORM event log</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">This panel confirms which LMS calls occur during preview. Opening alone does not complete the activity.</p>
            <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-[#18221d] p-4 font-mono text-[11px] leading-relaxed text-[#dce9df]">
              {logs.join('\n')}
            </pre>
            <h3 className="mt-5 font-serif text-lg font-bold">Current suspend data</h3>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-[#c9bea8] bg-[#f1ede3] p-3 font-mono text-[11px]">
              {JSON.stringify(progress, null, 2)}
            </pre>
          </aside>
        </div>
      </div>
    </div>
  );
};
