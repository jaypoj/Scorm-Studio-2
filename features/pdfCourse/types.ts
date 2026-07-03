export const PDF_COURSE_PROJECT_TYPE = 'pdf-course' as const;
export const PDF_COURSE_SCHEMA_VERSION = 1;
export const DEFAULT_ACKNOWLEDGEMENT_TEXT = 'I have reviewed this SOP and acknowledge that I understand it.';

export type PdfCompletionMethod = 'progress-and-acknowledgement';
export type PdfExportStatus = 'not-exported' | 'exported';

export interface PdfCourseDocument {
  id: string;
  title: string;
  fileName: string;
  sopNumber: string;
  description: string;
  category: string;
  acknowledgementText: string;
  requiredScrollThreshold: number;
  completionMethod: PdfCompletionMethod;
  estimatedTimeMinutes?: number;
  exportStatus: PdfExportStatus;
  file: File;
}

export interface PdfCourseProject {
  projectType: typeof PDF_COURSE_PROJECT_TYPE;
  schemaVersion: typeof PDF_COURSE_SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  scormVersion: '1.2';
  documents: PdfCourseDocument[];
}

export type PdfCourseDocumentRecord = Omit<PdfCourseDocument, 'file'> & {
  pdfPath: string;
};

export type PdfCourseProjectRecord = Omit<PdfCourseProject, 'documents'> & {
  documents: PdfCourseDocumentRecord[];
};

export interface PdfPreviewState {
  maxPageReached: number;
  totalPages: number;
  percentViewed: number;
  endReached: boolean;
  acknowledgementClicked: boolean;
  completed: boolean;
  timestamp: string;
}
