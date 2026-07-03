const fs = require('node:fs');
const vm = require('node:vm');

const exporterPath = 'features/pdfCourse/pdfCourseExport.ts';
const libraryPath = 'features/pdfCourse/vendor/pdf.min.js';
const exporter = fs.readFileSync(exporterPath, 'utf8');
const library = fs.readFileSync(libraryPath, 'utf8');
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

new vm.Script(`${library}\n${runtime}`, {
  filename: 'generated-pdf-course-runtime.js',
});

console.log('Generated PDF course runtime syntax is valid.');
