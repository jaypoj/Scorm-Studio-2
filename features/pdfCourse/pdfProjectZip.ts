import JSZip from 'jszip';
import {
  DEFAULT_ACKNOWLEDGEMENT_TEXT,
  PDF_COURSE_PROJECT_TYPE,
  PDF_COURSE_SCHEMA_VERSION,
  PdfCourseDocument,
  PdfCourseDocumentRecord,
  PdfCourseProject,
  PdfCourseProjectRecord,
} from './types';

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/^\/+/, '');
const fileStem = (value: string) => value.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

export const sanitizePdfFileName = (value: string) => {
  const cleaned = value.replace(/[<>:"/\\|?*#%\x00-\x1F]/g, '_').replace(/_+/g, '_').trim();
  return cleaned || 'document.pdf';
};

const createDocument = (file: File, index: number): PdfCourseDocument => ({
  id: `pdf-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
  title: fileStem(file.name) || `SOP ${index + 1}`,
  fileName: sanitizePdfFileName(file.name.toLowerCase().endsWith('.pdf') ? file.name : `${file.name}.pdf`),
  sopNumber: '',
  description: 'Review the complete document, then acknowledge your understanding.',
  category: '',
  acknowledgementText: DEFAULT_ACKNOWLEDGEMENT_TEXT,
  requiredScrollThreshold: 100,
  completionMethod: 'progress-and-acknowledgement',
  estimatedTimeMinutes: undefined,
  exportStatus: 'not-exported',
  file,
});

const extractPdfFiles = async (files: File[]) => {
  const pdfs: File[] = [];

  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
      pdfs.push(file);
      continue;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) continue;

    const zip = await JSZip.loadAsync(file);
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !entry.name.toLowerCase().endsWith('.pdf')) continue;
      const blob = await entry.async('blob');
      pdfs.push(new File([blob], sanitizePdfFileName(entry.name.split('/').pop() || 'document.pdf'), {
        type: 'application/pdf',
      }));
    }
  }

  return pdfs;
};

export const createPdfCourseProject = async (files: File[], projectName = 'PDF Compliance Course') => {
  const pdfFiles = await extractPdfFiles(files);
  if (!pdfFiles.length) throw new Error('Select at least one PDF, or a ZIP that contains PDF files.');
  const now = new Date().toISOString();
  return {
    projectType: PDF_COURSE_PROJECT_TYPE,
    schemaVersion: PDF_COURSE_SCHEMA_VERSION,
    id: `pdf-course-${Date.now()}`,
    name: projectName,
    createdAt: now,
    updatedAt: now,
    scormVersion: '1.2',
    documents: pdfFiles.map(createDocument),
  } satisfies PdfCourseProject;
};

const toProjectRecord = (project: PdfCourseProject): PdfCourseProjectRecord => ({
  ...project,
  updatedAt: new Date().toISOString(),
  documents: project.documents.map((document, index) => {
    const { file: _file, ...metadata } = document;
    return {
      ...metadata,
      pdfPath: `pdfs/${String(index + 1).padStart(3, '0')}-${sanitizePdfFileName(document.fileName)}`,
    };
  }),
});

export const buildPdfCourseProjectZip = async (project: PdfCourseProject) => {
  const zip = new JSZip();
  const record = toProjectRecord(project);
  zip.file('pdf-course.json', JSON.stringify(record, null, 2));
  record.documents.forEach((document, index) => {
    zip.file(document.pdfPath, project.documents[index].file);
  });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
};

export const openPdfCourseProject = async (file: File): Promise<PdfCourseProject> => {
  const zip = await JSZip.loadAsync(file);
  const recordEntry = zip.file('pdf-course.json')
    || Object.values(zip.files).find(entry => normalizePath(entry.name).toLowerCase().endsWith('/pdf-course.json'));
  if (!recordEntry) throw new Error('This file is not a PDF Course project package. Missing pdf-course.json.');

  const record = JSON.parse(await recordEntry.async('string')) as PdfCourseProjectRecord;
  if (record.projectType !== PDF_COURSE_PROJECT_TYPE || record.schemaVersion !== PDF_COURSE_SCHEMA_VERSION) {
    throw new Error('Unsupported PDF Course project type or schema version.');
  }

  const documents: PdfCourseDocument[] = [];
  for (const document of record.documents || []) {
    const pdfEntry = zip.file(normalizePath(document.pdfPath));
    if (!pdfEntry) throw new Error(`Missing PDF file in project package: ${document.pdfPath}`);
    const blob = await pdfEntry.async('blob');
    const { pdfPath: _pdfPath, ...metadata } = document;
    documents.push({
      ...metadata,
      requiredScrollThreshold: Math.min(100, Math.max(1, Number(metadata.requiredScrollThreshold) || 100)),
      acknowledgementText: metadata.acknowledgementText || DEFAULT_ACKNOWLEDGEMENT_TEXT,
      completionMethod: 'progress-and-acknowledgement',
      exportStatus: metadata.exportStatus || 'not-exported',
      file: new File([blob], sanitizePdfFileName(metadata.fileName), { type: 'application/pdf' }),
    });
  }

  return {
    ...record,
    documents,
    updatedAt: new Date().toISOString(),
  };
};

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
