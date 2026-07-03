# PDF Course Feature

This folder contains the additive PDF compliance/SOP course builder. It does not change the standard `.scormproj` schema or standard SCORM exporter.

## Project Format

Saved PDF projects use a zip package, normally named `*.pdfcourse.zip`, containing:

- `pdf-course.json`
- `pdfs/*.pdf`

PDF files are stored as binary files, not base64 inside JSON.

## Export Format

Each PDF exports as a separate SCORM 1.2 zip with:

- `imsmanifest.xml`
- `index.html`
- `styles.css`
- `runtime.js`
- `pdf-course-metadata.json`
- `pdfs/<original-name>.pdf`
- `vendor/pdf.min.mjs`
- `vendor/pdf.worker.min.mjs`

The exported runtime has no CDN dependency. PDF.js and its worker are copied into the SCORM zip.

## Completion Rule

Completion requires:

1. The learner reaches the end of the controlled PDF.js viewer.
2. The configured progress threshold is satisfied.
3. The learner clicks the acknowledgement button.

Opening the activity does not mark it complete.

## Manual Test Notes

1. Confirm the opening screen still creates and opens standard SCORM projects.
2. Create a PDF Course from multiple raw PDFs.
3. Create a PDF Course from a zip containing PDFs.
4. Edit title, SOP number, description, category, acknowledgement text, threshold, and estimated time.
5. Save the project, then reopen the resulting `.pdfcourse.zip`.
6. Preview a PDF and verify:
   - PDF pages render.
   - Progress changes while scrolling.
   - Acknowledgement remains disabled before the end.
   - Acknowledgement enables after reaching the end.
   - Mock SCORM log records completion only after acknowledgement.
7. Export one PDF and inspect the zip for the required local files.
8. Prepare all Moodle ZIPs and download each independent SCORM package separately from the export window.
9. Upload an individual package to Moodle and verify:
   - It launches without external network dependencies.
   - Resume data is saved.
   - Completion is not sent on open.
   - Completion is sent after end reached plus acknowledgement.
