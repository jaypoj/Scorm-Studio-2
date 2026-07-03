import React, { useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Eye, FileArchive, FilePlus2, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { buildPdfScormPackage, PdfScormPackage } from './pdfCourseExport';
import { buildPdfCourseProjectZip, createPdfCourseProject, downloadBlob } from './pdfProjectZip';
import { PdfCoursePreview } from './PdfCoursePreview';
import { PdfCourseDocument, PdfCourseProject } from './types';

interface PdfCourseEditorProps {
  project: PdfCourseProject;
  onChange: (project: PdfCourseProject) => void;
  onClose: () => void;
}

const updateTimestamp = (project: PdfCourseProject): PdfCourseProject => ({
  ...project,
  updatedAt: new Date().toISOString(),
});

export const PdfCourseEditor: React.FC<PdfCourseEditorProps> = ({ project, onChange, onClose }) => {
  const addInputRef = useRef<HTMLInputElement>(null);
  const [previewDocument, setPreviewDocument] = useState<PdfCourseDocument | null>(null);
  const [preparedPackages, setPreparedPackages] = useState<PdfScormPackage[]>([]);
  const [busyMessage, setBusyMessage] = useState('');
  const [error, setError] = useState('');

  const updateDocument = (id: string, patch: Partial<PdfCourseDocument>) => {
    onChange(updateTimestamp({
      ...project,
      documents: project.documents.map(document => {
        if (document.id !== id) return document;
        const next = { ...document, ...patch };
        return 'exportStatus' in patch ? next : { ...next, exportStatus: 'not-exported' };
      }),
    }));
  };

  const addDocuments = async (files: File[]) => {
    if (!files.length) return;
    setError('');
    setBusyMessage('Reading PDF files...');
    try {
      const imported = await createPdfCourseProject(files, project.name);
      onChange(updateTimestamp({ ...project, documents: [...project.documents, ...imported.documents] }));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setBusyMessage('');
      if (addInputRef.current) addInputRef.current.value = '';
    }
  };

  const saveProject = async () => {
    setError('');
    setBusyMessage('Building PDF Course project package...');
    try {
      const blob = await buildPdfCourseProjectZip(project);
      downloadBlob(blob, `${project.name.replace(/\s+/g, '_') || 'PDF_Course'}.pdfcourse.zip`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusyMessage('');
    }
  };

  const exportDocument = async (document: PdfCourseDocument) => {
    setError('');
    setBusyMessage(`Exporting ${document.title}...`);
    try {
      const result = await buildPdfScormPackage(project, document);
      downloadBlob(result.blob, result.fileName);
      updateDocument(document.id, { exportStatus: 'exported' });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setBusyMessage('');
    }
  };

  const exportAll = async () => {
    setError('');
    setPreparedPackages([]);
    setBusyMessage('Building individual SCORM packages...');
    try {
      const packages: PdfScormPackage[] = [];
      for (const document of project.documents) {
        setBusyMessage(`Building Moodle package: ${document.title}...`);
        packages.push(await buildPdfScormPackage(project, document));
      }
      setPreparedPackages(packages);
      onChange(updateTimestamp({
        ...project,
        documents: project.documents.map(document => ({ ...document, exportStatus: 'exported' })),
      }));
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setBusyMessage('');
    }
  };

  const removeDocument = (document: PdfCourseDocument) => {
    if (!window.confirm(`Remove "${document.title}" from this PDF Course project?\n\nThis does not change the original source PDF on disk.`)) return;
    onChange(updateTimestamp({ ...project, documents: project.documents.filter(item => item.id !== document.id) }));
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_85%_5%,rgba(169,71,43,0.14),transparent_28rem),#eee9de] text-[#18221d]">
      <header className="border-b-2 border-[#18221d] bg-[#fffdf7]/95 px-5 py-4 shadow-sm backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button onClick={onClose} className="rounded-full border border-[#c9bea8] p-2 hover:bg-[#eee9de]" title="Return to course choices">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a9472b]">PDF compliance builder</p>
              <h1 className="font-serif text-2xl font-bold sm:text-3xl">{project.name}</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 font-sans text-sm">
            <button onClick={() => addInputRef.current?.click()} className="flex items-center gap-2 border border-[#18221d] bg-white px-4 py-2 font-bold hover:bg-[#f4f0e7]">
              <FilePlus2 className="h-4 w-4" /> Add PDFs or ZIP
            </button>
            <button onClick={saveProject} className="flex items-center gap-2 border border-[#18221d] bg-[#18221d] px-4 py-2 font-bold text-white hover:bg-[#2e3a33]">
              <Save className="h-4 w-4" /> Save PDF Course
            </button>
            <button onClick={exportAll} disabled={!project.documents.length || Boolean(busyMessage)} className="flex items-center gap-2 bg-[#a9472b] px-4 py-2 font-bold text-white hover:bg-[#8d3823] disabled:opacity-50">
              <Download className="h-4 w-4" /> Prepare Moodle ZIPs
            </button>
          </div>
          <input
            ref={addInputRef}
            type="file"
            accept=".pdf,.zip,application/pdf,application/zip"
            multiple
            className="hidden"
            onChange={event => addDocuments(Array.from(event.target.files || []))}
          />
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-6 p-5 sm:p-8">
        <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_360px]">
          <div className="border border-[#c9bea8] bg-[#fffdf7] p-5 shadow-sm">
            <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#7c3d2b]">Project name</label>
            <input
              value={project.name}
              onChange={event => onChange(updateTimestamp({ ...project, name: event.target.value }))}
              className="mt-2 w-full border-b-2 border-[#18221d] bg-transparent py-2 font-serif text-2xl font-bold outline-none"
            />
            <p className="mt-3 max-w-3xl font-sans text-sm leading-relaxed text-slate-600">
              Each PDF exports as an independent SCORM 1.2 activity. This gives Moodle supervisors the cleanest completion report per SOP.
            </p>
          </div>
          <div className="border-2 border-[#41644a] bg-[#e6efe6] p-5">
            <div className="flex items-center gap-2 font-serif text-lg font-bold"><ShieldCheck className="h-5 w-5" /> Completion rule</div>
            <p className="mt-2 font-sans text-sm leading-relaxed text-[#3d5543]">The learner must reach the configured document threshold and then click acknowledgement. Opening the activity never marks it complete.</p>
          </div>
        </section>

        {busyMessage && <div className="border border-[#c9bea8] bg-[#fffdf7] p-3 font-sans text-sm">{busyMessage}</div>}
        {error && <div className="border border-red-300 bg-red-50 p-3 font-sans text-sm text-red-700">{error}</div>}

        <section className="overflow-hidden border-2 border-[#18221d] bg-[#fffdf7] shadow-xl">
          <div className="flex items-center justify-between border-b border-[#c9bea8] bg-[#18221d] px-5 py-4 text-white">
            <div>
              <h2 className="font-serif text-xl font-bold">SOP document register</h2>
              <p className="font-sans text-xs text-[#cdd8d0]">{project.documents.length} PDF document{project.documents.length === 1 ? '' : 's'}</p>
            </div>
            <FileArchive className="h-6 w-6 text-[#d6a48f]" />
          </div>
          <div className="divide-y divide-[#c9bea8]">
            {project.documents.map((document, index) => (
              <article key={document.id} className="grid gap-5 p-5 xl:grid-cols-[52px_minmax(260px,1.2fr)_minmax(260px,1fr)_220px]">
                <div className="font-serif text-3xl font-bold text-[#a9472b]">{String(index + 1).padStart(2, '0')}</div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Display title</label>
                    <input value={document.title} onChange={event => updateDocument(document.id, { title: event.target.value })} className="mt-1 w-full border-b border-[#93866e] bg-transparent py-2 font-serif text-lg font-bold outline-none focus:border-[#a9472b]" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-bold text-slate-600">SOP number
                      <input value={document.sopNumber} onChange={event => updateDocument(document.id, { sopNumber: event.target.value })} className="mt-1 w-full border border-[#c9bea8] bg-white p-2 font-sans font-normal text-slate-900" />
                    </label>
                    <label className="text-xs font-bold text-slate-600">Category/group label
                      <input value={document.category} onChange={event => updateDocument(document.id, { category: event.target.value })} className="mt-1 w-full border border-[#c9bea8] bg-white p-2 font-sans font-normal text-slate-900" />
                    </label>
                  </div>
                  <p className="break-all font-mono text-[10px] text-slate-500">{document.fileName}</p>
                </div>
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-slate-600">Description/instructions
                    <textarea value={document.description} onChange={event => updateDocument(document.id, { description: event.target.value })} className="mt-1 min-h-20 w-full resize-y border border-[#c9bea8] bg-white p-2 font-sans font-normal text-slate-900" />
                  </label>
                  <label className="block text-xs font-bold text-slate-600">Acknowledgement text
                    <textarea value={document.acknowledgementText} onChange={event => updateDocument(document.id, { acknowledgementText: event.target.value })} className="mt-1 min-h-20 w-full resize-y border border-[#c9bea8] bg-white p-2 font-sans font-normal text-slate-900" />
                  </label>
                </div>
                <div className="space-y-3 font-sans">
                  <label className="block text-xs font-bold text-slate-600">Required progress
                    <div className="mt-1 flex items-center gap-2">
                      <input type="number" min={1} max={100} value={document.requiredScrollThreshold} onChange={event => updateDocument(document.id, { requiredScrollThreshold: Math.min(100, Math.max(1, Number(event.target.value) || 100)) })} className="w-20 border border-[#c9bea8] bg-white p-2 text-slate-900" />
                      <span className="text-sm">%</span>
                    </div>
                  </label>
                  <label className="block text-xs font-bold text-slate-600">Estimated minutes
                    <input type="number" min={1} value={document.estimatedTimeMinutes || ''} onChange={event => updateDocument(document.id, { estimatedTimeMinutes: event.target.value ? Math.max(1, Number(event.target.value)) : undefined })} className="mt-1 w-full border border-[#c9bea8] bg-white p-2 text-slate-900" />
                  </label>
                  <label className="block text-xs font-bold text-slate-600">Completion method
                    <select
                      value={document.completionMethod}
                      onChange={() => updateDocument(document.id, { completionMethod: 'progress-and-acknowledgement' })}
                      className="mt-1 w-full border border-[#c9bea8] bg-[#f4f0e7] p-2 text-[11px] text-slate-900"
                    >
                      <option value="progress-and-acknowledgement">End reached + acknowledgement clicked</option>
                    </select>
                  </label>
                  <div className={`text-[11px] font-bold uppercase tracking-wide ${document.exportStatus === 'exported' ? 'text-[#41644a]' : 'text-slate-500'}`}>
                    {document.exportStatus === 'exported' ? 'Exported' : 'Not exported'}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setPreviewDocument(document)} className="flex items-center justify-center gap-1 border border-[#18221d] bg-white px-2 py-2 text-xs font-bold hover:bg-[#f4f0e7]"><Eye className="h-3.5 w-3.5" /> Preview</button>
                    <button onClick={() => exportDocument(document)} className="flex items-center justify-center gap-1 bg-[#41644a] px-2 py-2 text-xs font-bold text-white hover:bg-[#34513c]"><Download className="h-3.5 w-3.5" /> Export</button>
                  </div>
                  <button onClick={() => removeDocument(document)} className="flex w-full items-center justify-center gap-1 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Remove from project</button>
                </div>
              </article>
            ))}
            {!project.documents.length && (
              <div className="p-12 text-center">
                <FilePlus2 className="mx-auto h-10 w-10 text-[#93866e]" />
                <h3 className="mt-3 font-serif text-xl font-bold">No PDFs in this project</h3>
                <button onClick={() => addInputRef.current?.click()} className="mt-4 bg-[#18221d] px-5 py-2 font-sans text-sm font-bold text-white">Add PDFs or ZIP</button>
              </div>
            )}
          </div>
        </section>

        <p className="font-sans text-xs text-slate-500">
          Combined multi-PDF SCORM export is intentionally not the primary workflow. One PDF per SCORM activity provides cleaner Moodle completion reporting and assignment control.
        </p>
      </main>

      {previewDocument && <PdfCoursePreview document={previewDocument} onClose={() => setPreviewDocument(null)} />}
      {preparedPackages.length > 0 && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-[#141b17]/85 p-4">
          <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#93866e] bg-[#fffdf7] shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b-2 border-[#18221d] p-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a9472b]">Moodle-ready exports</p>
                <h2 className="font-serif text-2xl font-bold">Download each SCORM ZIP separately</h2>
                <p className="mt-2 max-w-2xl font-sans text-sm leading-relaxed text-slate-600">
                  Upload each downloaded ZIP directly as its own Moodle SCORM activity. Do not place these ZIPs inside another ZIP before uploading.
                </p>
              </div>
              <button onClick={() => setPreparedPackages([])} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close export downloads">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              <div className="mb-4 flex items-center gap-2 border border-[#8eb097] bg-[#e6efe6] p-3 font-sans text-sm text-[#34513c]">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                Every ZIP below contains <code>imsmanifest.xml</code> at its root.
              </div>
              <div className="divide-y divide-[#c9bea8] border-y border-[#c9bea8]">
                {preparedPackages.map((packageFile, index) => (
                  <div key={packageFile.fileName} className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <p className="font-serif font-bold">{index + 1}. {packageFile.fileName}</p>
                      <p className="mt-1 font-sans text-xs text-slate-500">Independent SCORM 1.2 activity</p>
                    </div>
                    <button
                      onClick={() => downloadBlob(packageFile.blob, packageFile.fileName)}
                      className="flex shrink-0 items-center justify-center gap-2 bg-[#41644a] px-4 py-2 font-sans text-sm font-bold text-white hover:bg-[#34513c]"
                    >
                      <Download className="h-4 w-4" /> Download Moodle ZIP
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
