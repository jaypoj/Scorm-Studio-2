const fs = require('node:fs');
const vm = require('node:vm');

const exporterPath = 'features/pdfCourse/pdfCourseExport.ts';
const libraryPath = 'features/pdfCourse/vendor/pdf.min.js';
const workerPath = 'features/pdfCourse/vendor/pdf.worker.min.js';
const exporter = fs.readFileSync(exporterPath, 'utf8');
const library = fs.readFileSync(libraryPath, 'utf8');
const worker = fs.readFileSync(workerPath, 'utf8');
const runtimeMatch = exporter.match(
  /const runtime = `([\s\S]*?)`;\r?\n\r?\nexport interface PdfScormPackage/,
);

if (!runtimeMatch) {
  throw new Error(`Could not extract the generated runtime from ${exporterPath}.`);
}

const runtime = runtimeMatch[1];
if (!runtime.startsWith(';(function(){') || !runtime.endsWith('})();')) {
  throw new Error('The generated course runtime must remain isolated in an IIFE.');
}

new vm.Script(`${worker}\n${library}\n${runtime}`, {
  filename: 'generated-pdf-course-runtime.js',
});

const originalGlobals = {
  process: globalThis.process,
  window: globalThis.window,
  location: globalThis.location,
  DOMMatrix: globalThis.DOMMatrix,
  Path2D: globalThis.Path2D,
  ImageData: globalThis.ImageData,
  Worker: globalThis.Worker,
};

const restoreGlobals = () => {
  Object.assign(globalThis, originalGlobals);
};

const checkEmbeddedWorker = async () => {
  let externalWorkerAttempts = 0;
  globalThis.process = undefined;
  globalThis.window = globalThis;
  globalThis.location = new URL('https://example.test/course/index.html');
  globalThis.DOMMatrix = class DOMMatrix {};
  globalThis.Path2D = class Path2D {};
  globalThis.ImageData = class ImageData {};
  globalThis.Worker = class ExternalWorkerMustNotBeUsed {
    constructor() {
      externalWorkerAttempts += 1;
      throw new Error('PDF.js attempted to create an external worker.');
    }
  };

  vm.runInThisContext(worker, { filename: workerPath });
  vm.runInThisContext(library, { filename: libraryPath });
  globalThis.process = originalGlobals.process;

  if (!globalThis.pdfjsWorker?.WorkerMessageHandler) {
    throw new Error('The embedded PDF.js worker handler did not initialize.');
  }
  if (typeof globalThis.pdfjsLib?.getDocument !== 'function') {
    throw new Error('The embedded PDF.js library did not initialize.');
  }

  const minimalPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >> endobj
4 0 obj << /Length 0 >> stream

endstream endobj
trailer << /Root 1 0 R >>
%%EOF`;
  const loadingTask = globalThis.pdfjsLib.getDocument({
    data: new TextEncoder().encode(minimalPdf),
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;

  if (pdf.numPages !== 1) {
    throw new Error(`Expected the embedded worker to parse one page, received ${pdf.numPages}.`);
  }
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  if (viewport.width !== 612 || viewport.height !== 792) {
    throw new Error(`Unexpected parsed page size: ${viewport.width}x${viewport.height}.`);
  }
  if (externalWorkerAttempts !== 0) {
    throw new Error(`PDF.js attempted ${externalWorkerAttempts} external worker request(s).`);
  }
  await loadingTask.destroy();
};

checkEmbeddedWorker()
  .then(() => {
    restoreGlobals();
    console.log('Generated PDF course runtime syntax and embedded-worker parsing are valid.');
  })
  .catch(error => {
    restoreGlobals();
    console.error(error);
    process.exitCode = 1;
  });
