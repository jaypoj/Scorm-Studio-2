const fs = require('node:fs');
const JSZip = require('jszip');
const ts = require('typescript');

const originalLoadAsync = JSZip.loadAsync.bind(JSZip);
JSZip.loadAsync = async data => originalLoadAsync(
  data instanceof Blob ? await data.arrayBuffer() : data,
);

const toDataUrl = path => (
  `data:text/javascript;base64,${fs.readFileSync(path).toString('base64')}`
);

globalThis.__PDF_LICENSE__ = fs.readFileSync('node_modules/pdfjs-dist/LICENSE', 'utf8');
globalThis.__PDF_MAIN_URL__ = toDataUrl('features/pdfCourse/vendor/pdf.min.js');
globalThis.__PDF_WORKER_URL__ = toDataUrl('features/pdfCourse/vendor/pdf.worker.min.js');

require.extensions['.ts'] = (module, filename) => {
  let source = fs.readFileSync(filename, 'utf8');
  if (filename.endsWith('pdfCourseExport.ts')) {
    source = source
      .replace(
        "import pdfJsLicense from 'pdfjs-dist/LICENSE?raw';",
        'const pdfJsLicense = globalThis.__PDF_LICENSE__;',
      )
      .replace(
        "import pdfJsUrl from './vendor/pdf.min.js?url';",
        'const pdfJsUrl = globalThis.__PDF_MAIN_URL__;',
      )
      .replace(
        "import pdfWorkerUrl from './vendor/pdf.worker.min.js?url';",
        'const pdfWorkerUrl = globalThis.__PDF_WORKER_URL__;',
      );
  }
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { buildPdfScormPackage } = require('../features/pdfCourse/pdfCourseExport.ts');
const {
  applyBatchSettingsToDocument,
  buildPdfCourseProjectZip,
  createPdfCourseProject,
  openPdfCourseProject,
} = require('../features/pdfCourse/pdfProjectZip.ts');
const { DEFAULT_PDF_BATCH_SETTINGS } = require('../features/pdfCourse/types.ts');

const minimalPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj
trailer << /Root 1 0 R >>
%%EOF`;

const validatePackage = async packageFile => {
  const zip = await originalLoadAsync(await packageFile.blob.arrayBuffer());
  const files = Object.values(zip.files).filter(entry => !entry.dir);
  const pdfEntries = files.filter(entry => entry.name.toLowerCase().endsWith('.pdf'));
  const runtime = await zip.file('runtime.js')?.async('string');

  if (!zip.file('imsmanifest.xml') || pdfEntries.length !== 1) {
    throw new Error(`${packageFile.fileName} must contain one PDF and a root manifest.`);
  }
  if (!runtime?.includes('pdfApi.getDocument({data:pdfBytes})')
    || !runtime.includes('globalThis.pdfjsWorker')) {
    throw new Error(`${packageFile.fileName} does not contain the verified Moodle runtime.`);
  }
};

const run = async () => {
  const sourceFiles = [
    new File([minimalPdf], 'Policy_A.pdf', { type: 'application/pdf' }),
    new File([minimalPdf], 'Policy_B.pdf', { type: 'application/pdf' }),
  ];
  let singleRejected = false;

  try {
    await createPdfCourseProject(sourceFiles, 'Invalid single project', 'single');
  } catch (error) {
    singleRejected = /accepts one PDF/i.test(String(error.message));
  }
  if (!singleRejected) {
    throw new Error('Single PDF mode did not reject multiple source files.');
  }

  let project = await createPdfCourseProject(sourceFiles, 'Department Batch', 'batch');
  const batchSettings = {
    ...DEFAULT_PDF_BATCH_SETTINGS,
    customize: true,
    category: 'Compliance',
    requiredScrollThreshold: 85,
    estimatedTimeMinutes: 12,
  };
  project = {
    ...project,
    batchSettings,
    documents: project.documents.map(document => (
      applyBatchSettingsToDocument(document, batchSettings)
    )),
  };

  if (project.documents.some(document => (
    document.category !== 'Compliance'
    || document.requiredScrollThreshold !== 85
    || document.estimatedTimeMinutes !== 12
  ))) {
    throw new Error('Shared batch settings did not propagate to every PDF.');
  }

  const nodeCompatibleProject = {
    ...project,
    documents: await Promise.all(project.documents.map(async document => ({
      ...document,
      file: new Uint8Array(await document.file.arrayBuffer()),
    }))),
  };
  const savedProject = await buildPdfCourseProjectZip(nodeCompatibleProject);
  const savedBytes = new Uint8Array(await savedProject.arrayBuffer());
  const reopened = await openPdfCourseProject(savedBytes);

  if (reopened.workflowMode !== 'batch'
    || reopened.documents.length !== sourceFiles.length
    || reopened.batchSettings?.category !== 'Compliance') {
    throw new Error('Batch project settings did not survive save and reopen.');
  }

  const packages = [];
  for (const document of nodeCompatibleProject.documents) {
    packages.push(await buildPdfScormPackage(nodeCompatibleProject, document));
  }
  if (packages.length !== sourceFiles.length) {
    throw new Error('Batch export did not create one package per PDF.');
  }
  for (const packageFile of packages) {
    await validatePackage(packageFile);
  }

  console.log(`Batch PDF check passed: ${sourceFiles.length} PDFs -> ${packages.length} independent SCORM ZIPs.`);
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
