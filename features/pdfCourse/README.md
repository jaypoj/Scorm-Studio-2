# PDF Course Feature

This folder contains the additive PDF compliance/SOP course builder. It does not change the standard `.scormproj` schema or standard SCORM exporter.

## Workflows

- **Single PDF Course** accepts one PDF and allows document-specific editing.
- **Batch PDF Courses** accepts multiple PDFs or a ZIP containing PDFs.
- Batch mode uses one shared settings profile for the complete list. It does not support per-file or partial-list setting overrides.
- Every PDF always exports as its own independent Moodle-ready SCORM 1.2 ZIP.

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
- `runtime.js` (course runtime plus the classic PDF.js library and worker handler)
- `pdf-course-metadata.json`
- `pdfs/<original-name>.pdf`
- `vendor/PDFJS-LICENSE.txt`

The exported runtime has no CDN dependency. The official PDF.js legacy browser build and worker handler are bundled directly into one classic `runtime.js`. The Moodle package does not create a web worker or use dynamic imports because Moodle `pluginfile.php` delivery can block module workers or return incompatible MIME types.

## Completion Rule

Completion requires:

1. The learner reaches the end of the controlled PDF.js viewer.
2. The configured progress threshold is satisfied.
3. The learner clicks the acknowledgement button.

Opening the activity does not mark it complete.

## Manual Test Notes

1. Confirm the opening screen still creates and opens standard SCORM projects.
2. Create a Batch PDF Course from multiple raw PDFs.
3. Create a Batch PDF Course from a zip containing PDFs.
4. Edit title, SOP number, description, category, acknowledgement text, threshold, and estimated time.
5. Confirm batch settings update every PDF and batch rows contain no per-file settings.
6. Save the project, then reopen the resulting `.pdfcourse.zip`.
7. Preview a PDF and verify:
   - PDF pages render.
   - Progress changes while scrolling.
   - Acknowledgement remains disabled before the end.
   - Acknowledgement enables after reaching the end.
   - Mock SCORM log records completion only after acknowledgement.
8. Export one PDF and inspect the zip for the required local files.
9. Prepare all Moodle ZIPs and download each independent SCORM package separately from the export window.
10. Upload an individual package to Moodle and verify:
   - It launches without external network dependencies.
   - Resume data is saved.
   - Completion is not sent on open.
   - Completion is sent after end reached plus acknowledgement.
