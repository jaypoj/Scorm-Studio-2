#!/usr/bin/env node
/* Synthetic, non-sensitive regression checks for the SCORM learner preview. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'services/scormPreview.ts'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'components/CoursePreviewModal.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
let mockedZip;
const moduleExports = {};
const js = ts.transpileModule(source, { fileName: 'scormPreview.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
vm.runInNewContext(js, {
  exports: moduleExports, require: name => {
    assert.equal(name, 'jszip');
    return { loadAsync: async () => mockedZip };
  }, Blob, Uint8Array,
}, { filename: 'scormPreview.js' });
const { createPreviewDocument, createScormPreviewBundle, SCORM_PREVIEW_BOOTSTRAP } = moduleExports;
let passed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('PASS', name); passed++; }
  catch (error) { console.error('FAIL', name, error); process.exitCode = 1; }
};
const input = '<!doctype html><html><head><link rel="stylesheet" href="styles/main.css"><script src="scripts/scorm-api.js"></script></head><body><div id="content-container"></div><script src="scripts/navigation.js"></script></body></html>';
const file = (name, payload, type='string') => ({
  name, dir: false, async: async requestedType => {
    if (requestedType === 'uint8array') return Uint8Array.from(payload);
    assert.equal(requestedType, type);
    return payload;
  },
});
(async () => {
  await check('Preview uses exporter CSS and Next navigation without a SCORM adapter', () => {
    const html = createPreviewDocument(input, '.page-card{color:violet}', 'function nextPage(){}; // Retry Page');
    assert.match(html, /\.page-card\{color:violet\}/);
    assert.match(html, /function nextPage/);
    assert.match(html, /Retry Page/);
    assert.doesNotMatch(html, /src="scripts\/scorm-api\.js"/);
    assert.doesNotMatch(html, /src="scripts\/navigation\.js"/);
  });
  await check('Preview rejects templates without the known exporter scripts', () => {
    assert.throws(() => createPreviewDocument(input.replace('scripts/navigation.js', 'scripts/unknown.js'), '', ''), /unsupported launch template/);
  });
  await check('Inline scripts cannot be terminated by embedded closing script tags', () => {
    const html = createPreviewDocument(input, '', `const title = '</script><p>not injected</p>';`);
    assert.match(html, /<\\\/script>/);
    assert.ok(!html.includes("const title = '</script>"));
  });
  mockedZip = { files: {
    'index.html': file('index.html', input),
    'styles/main.css': file('styles/main.css', '.page-card{padding:20px}'),
    'scripts/navigation.js': file('scripts/navigation.js', 'function nextPage(){}'),
    'pages/welcome.html': file('pages/welcome.html', '<img src="media/picture.png"><audio src="media/narration.mp3"></audio>'),
    'media/picture.png': file('media/picture.png', [137,80,78,71]),
    'media/narration.mp3': file('media/narration.mp3', [73,68,51]),
    'media/captions.vtt': file('media/captions.vtt', [87,69,66,86,84,84]),
    'project.json': file('project.json', '{"geminiApiKey":"DO_NOT_SEND"}'),
    'imsmanifest.xml': file('imsmanifest.xml', '<manifest/>'),
  }, file(name) { return this.files[name]; } };
  const bundle = await createScormPreviewBundle(new Blob());
  await check('ZIP preview carries the generated page and exported media', () => {
    assert.equal(Object.keys(bundle.pages).length, 1);
    assert.equal(bundle.assets.length, 3);
    assert.ok(bundle.pages['pages/welcome.html'].includes('media/narration.mp3'));
    assert.equal(bundle.assets.find(a => a.path === 'media/narration.mp3').blob.type, 'audio/mpeg');
    assert.equal(bundle.assets.find(a => a.path === 'media/captions.vtt').blob.type, 'text/vtt');
  });
  await check('Private project JSON is not sent to preview', () => {
    assert.ok(!('project.json' in bundle.pages));
    assert.ok(!bundle.html.includes('DO_NOT_SEND'));
    assert.ok(bundle.assets.every(a => a.path.startsWith('media/')));
  });
  await check('Missing required SCORM ZIP files returns a clear error', async () => {
    const original = mockedZip;
    mockedZip = { files: { ...original.files, 'scripts/navigation.js': undefined }, file(name) { return this.files[name]; } };
    await assert.rejects(createScormPreviewBundle(new Blob()), /missing its learner interface/);
    mockedZip = original;
  });
  await check('Missing course pages fails rather than showing an empty preview', async () => {
    const original = mockedZip;
    mockedZip = { files: Object.fromEntries(Object.entries(original.files).filter(([name]) => !name.startsWith('pages/'))) };
    mockedZip.file = name => mockedZip.files[name];
    await assert.rejects(createScormPreviewBundle(new Blob()), /no course pages/);
    mockedZip = original;
  });
  await check('Production JSX uses an opaque-origin, script-only iframe sandbox', () => {
    assert.match(modal, /sandbox="allow-scripts"/);
    assert.doesNotMatch(modal, /sandbox="[^"]*allow-same-origin/);
    assert.doesNotMatch(modal, /sandbox="[^"]*allow-top-navigation/);
    assert.doesNotMatch(modal, /sandbox="[^"]*allow-popups/);
  });
  await check('Preview only posts exported pages/assets, not AI credentials', () => {
    assert.match(modal, /pages: bundle.pages/);
    assert.match(modal, /assets: bundle.assets/);
    assert.doesNotMatch(modal, /aiSettings|geminiApiKey|azureOpenAiApiKey/);
  });
  await check('Preview reuses ScormPackager and never writes course project files', () => {
    assert.match(modal, /ScormPackager\.createScormPackage\(project, assetsHandle, rootHandle\)/);
    assert.doesNotMatch(modal, /createWritable|writeTextFile|saveProject|localStorage/);
  });
  await check('Preview is available beside export, without replacing Next button code', () => {
    assert.match(app, /Preview Course/);
    assert.match(app, /<CoursePreviewModal/);
    assert.match(app, /Export SCORM Package/);
  });
  await check('Preview bootstrap uses postMessage handshake and rewrites packed media to local blob URLs', async () => {
    const listeners = {};
    const urlStore = [];
    const fakeDocument = {
      createElement: tag => {
        assert.equal(tag, 'template');
        const result = { value: '', content: { querySelectorAll() { return [{
          getAttribute: attr => {
            const re = new RegExp(attr + '="([^"]*)"');
            return result.value.match(re)?.[1] || null;
          },
          setAttribute: (attr, value) => { result.value = result.value.replace(new RegExp('(' + attr + '=)"[^"]*"'), '$1"' + value + '"'); },
        }]; } } };
        Object.defineProperty(result, 'innerHTML', { get: () => result.value, set: text => { result.value = text; } });
        return result;
      },
    };
    const frame = {
      parent: {},
      fetch: async () => { throw Error('Unexpected network fetch in preview'); },
      addEventListener: (event, callback) => { listeners[event] = callback; },
    };
    const testUrl = { createObjectURL: blob => { const value = 'blob:local-' + urlStore.length; urlStore.push(value); return value; }, revokeObjectURL: url => urlStore.push('revoke:' + url) };
    vm.runInNewContext(SCORM_PREVIEW_BOOTSTRAP, { window: frame, document: fakeDocument, Response, Blob, URL: testUrl }, { filename: 'preview-frame.js' });
    const pending = frame.fetch('pages/welcome.html');
    listeners.message({ source: {}, data: { type: 'scorm-studio-preview-payload', pages: bundle.pages, assets: bundle.assets } });
    let settled = false;
    pending.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false, 'Unknown senders must be rejected');
    listeners.message({ source: frame.parent, data: { type: 'scorm-studio-preview-payload', pages: bundle.pages, assets: bundle.assets } });
    const response = await pending;
    assert.equal(response.status, 200);
    assert.match(await response.text(), /src="blob:local-/);
    const missing = await frame.fetch('pages/missing.html');
    assert.equal(missing.status, 404);
    listeners.pagehide();
    assert.ok(urlStore.includes('revoke:blob:local-0'));
  });
  console.log(`\n${passed} course-preview checks passed.`);
  if (process.exitCode) process.exit(process.exitCode);
})().catch(error => { console.error(error); process.exit(1); });
