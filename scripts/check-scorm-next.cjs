'use strict';

// Regression tests for the navigation.js generated into SCORM 1.2 ZIPs.
// Run after npm ci: node scripts/check-scorm-next.cjs
// Tests use simulated page responses and DOM controls; no real LMS is required.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'scormPackager.ts'), 'utf8');
const begin = source.indexOf('const buildNavigation =');
const end = source.indexOf('\nexport class ScormPackager', begin);
assert(begin >= 0 && end > begin, 'Could not locate the active generated navigation builder');
const builderTs = source.slice(begin, end) + '\nmodule.exports = buildNavigation;';
const compiled = ts.transpileModule(builderTs, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  fileName: 'scorm-navigation-extract.ts',
  reportDiagnostics: true,
});
const syntaxErrors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.equal(syntaxErrors.length, 0, syntaxErrors.map(e => ts.flattenDiagnosticMessageText(e.messageText, ' ')).join('\n'));
const builderModule = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: builderModule, exports: builderModule.exports });
const buildNavigation = builderModule.exports;

const pages = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'lesson-1', title: 'Lesson 1' },
  { id: 'lesson-2', title: 'Lesson 2' },
];
const pause = () => new Promise(resolve => setImmediate(resolve));

function createRuntime(settings = {}) {
  const eventHandlers = new Map();
  const requests = [];
  const alerts = [];
  const storage = new Map();
  const makeStorage = () => ({
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  });
  const classes = { toggle() {} };
  const navItems = pages.map(() => ({ classList: classes }));
  const elements = Object.fromEntries([
    'prev-button', 'next-button', 'gate-message', 'progress-fill', 'progress-text', 'content-container',
  ].map(id => [id, { id, style: {}, textContent: '', innerHTML: '', title: '', disabled: false, scrollTop: 0 }]));
  const question = { dataset: { completed: 'false' }, querySelector: () => null };
  const audioListeners = new Map();
  const audio = {
    dataset: { completed: 'false' }, duration: 12, currentTime: 0, ended: false,
    addEventListener: (type, fn) => audioListeners.set(type, fn),
  };
  const document = {
    getElementById: id => elements[id] || null,
    querySelectorAll: selector => {
      if (selector === '.nav-item') return navItems;
      if (selector === '.narration-audio') return settings.hasAudio ? [audio] : [];
      return [];
    },
    querySelector: selector => {
      if (selector === '.knowledge-check') return settings.hasKnowledge ? question : null;
      if (selector === '.narration-audio') return settings.hasAudio ? audio : null;
      return null;
    },
    documentElement: { scrollTop: 0 },
    body: { scrollTop: 0, appendChild: node => alerts.push(node.textContent) },
    createElement: () => ({ className: '', textContent: '', remove() {} }),
    addEventListener: (type, fn) => {
      if (!eventHandlers.has(type)) eventHandlers.set(type, []);
      eventHandlers.get(type).push(fn);
    },
  };
  const window = { scrollTo() {}, localStorage: makeStorage(), sessionStorage: makeStorage() };
  const fetch = url => new Promise((resolve, reject) => requests.push({ url, resolve, reject }));
  const context = vm.createContext({
    window, document, fetch, setTimeout: () => 1, console: { warn: () => {} },
  });
  vm.runInContext(buildNavigation(pages, 80, {
    requireKnowledgeCheckBeforeContinue: Boolean(settings.hasKnowledge),
    requireAudioCompletionBeforeContinue: Boolean(settings.hasAudio),
  }), context);
  for (const handler of eventHandlers.get('DOMContentLoaded') || []) handler();

  return {
    requests, alerts, window, elements, question, audio, audioListeners, context,
    next: () => elements['next-button'].onclick(),
    previous: () => elements['prev-button'].onclick(),
    sidebar: index => {
      const target = { dataset: { index: String(index) } };
      const event = { target: { closest: () => target }, preventDefault() {} };
      for (const handler of eventHandlers.get('click') || []) handler(event);
    },
    current: () => vm.runInContext('current', context),
    visited: () => vm.runInContext('Array.from(visited)', context),
  };
}
function succeed(request, text = '<p>Ready</p>') {
  request.resolve({ ok: true, status: 200, text: async () => text });
}
function failHttp(request, status = 503) {
  request.resolve({ ok: false, status, text: async () => 'Service unavailable' });
}

let checks = 0;
async function check(title, test) {
  await test();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, '0')}: ${title}`);
}

async function loadedRuntime(settings) {
  const app = createRuntime(settings);
  assert.equal(app.requests.length, 1);
  succeed(app.requests[0], '<p>Welcome loaded</p>');
  await pause();
  return app;
}

(async () => {
  await check('Initial page is not marked visited until the fetch completes', async () => {
    const app = createRuntime();
    assert.equal(app.elements['next-button'].disabled, true);
    assert.equal(app.visited().length, 0);
    succeed(app.requests[0]);
    await pause();
    assert.equal(app.current(), 0);
    assert.deepEqual(Array.from(app.visited()), ['welcome']);
    assert.equal(app.elements['next-button'].disabled, false);
  });

  await check('Rapid Next clicks cannot initiate overlapping page fetches', async () => {
    const app = await loadedRuntime();
    app.next(); app.next(); app.next();
    assert.equal(app.requests.length, 2);
    assert.equal(app.requests[1].url, 'pages/lesson-1.html');
    assert.equal(app.current(), 0);
    assert.equal(app.elements['next-button'].disabled, true);
    assert.equal(app.elements['prev-button'].disabled, true);
    succeed(app.requests[1], '<p>Lesson 1 loaded</p>');
    await pause();
    assert.equal(app.current(), 1);
    assert.equal(app.elements['next-button'].disabled, false);
  });

  await check('A failed HTTP request keeps the current lesson and content intact', async () => {
    const app = await loadedRuntime();
    app.next();
    failHttp(app.requests[1], 404);
    await pause();
    assert.equal(app.current(), 0);
    assert.equal(app.elements['content-container'].innerHTML, '<p>Welcome loaded</p>');
    assert.deepEqual(Array.from(app.visited()), ['welcome']);
    assert.equal(app.elements['next-button'].textContent, 'Retry Page');
    assert.equal(app.elements['next-button'].disabled, false);
    assert.match(app.elements['gate-message'].textContent, /could not load/i);
  });

  await check('Retry Page loads the previously failed target rather than skipping it', async () => {
    const app = await loadedRuntime();
    app.next();
    failHttp(app.requests[1]);
    await pause();
    app.next();
    assert.equal(app.requests.length, 3);
    assert.equal(app.requests[2].url, 'pages/lesson-1.html');
    succeed(app.requests[2], '<p>Recovered lesson</p>');
    await pause();
    assert.equal(app.current(), 1);
    assert.equal(app.elements['content-container'].innerHTML, '<p>Recovered lesson</p>');
    assert.equal(app.elements['next-button'].textContent, 'Next');
    assert.equal(app.elements['gate-message'].textContent, '');
  });

  await check('An initial-page load error retries page one, not page two', async () => {
    const app = createRuntime();
    failHttp(app.requests[0]);
    await pause();
    assert.equal(app.elements['next-button'].textContent, 'Retry Page');
    app.next();
    assert.equal(app.requests[1].url, 'pages/welcome.html');
    succeed(app.requests[1]);
    await pause();
    assert.equal(app.current(), 0);
    assert.deepEqual(Array.from(app.visited()), ['welcome']);
  });

  await check('A network rejection also shows Retry Page without corrupting progress', async () => {
    const app = await loadedRuntime();
    app.next();
    app.requests[1].reject(new Error('Network disconnected'));
    await pause();
    assert.equal(app.current(), 0);
    assert.equal(app.elements['next-button'].textContent, 'Retry Page');
    assert.deepEqual(Array.from(app.visited()), ['welcome']);
    app.next();
    assert.equal(app.requests[2].url, 'pages/lesson-1.html');
  });

  await check('Sidebar clicks during a pending page load cannot change the target', async () => {
    const app = await loadedRuntime();
    app.next();
    app.sidebar(2);
    assert.equal(app.requests.length, 2);
    succeed(app.requests[1]);
    await pause();
    assert.equal(app.current(), 1);
  });

  await check('Malformed sidebar indexes are rejected instead of being clamped', async () => {
    const app = await loadedRuntime();
    app.sidebar(-1);
    app.sidebar(999);
    app.sidebar('invalid');
    assert.equal(app.requests.length, 1);
    assert.equal(app.current(), 0);
  });

  await check('Required knowledge-check gates remain enforced on direct Next invocation', async () => {
    const app = await loadedRuntime({ hasKnowledge: true });
    assert.equal(app.elements['next-button'].disabled, true);
    app.next();
    assert.equal(app.requests.length, 1);
    app.question.dataset.completed = 'true';
    vm.runInContext('updateNextGate()', app.context);
    assert.equal(app.elements['next-button'].disabled, false);
    app.next();
    assert.equal(app.requests[1].url, 'pages/lesson-1.html');
  });

  await check('Required audio gate unlocks only after the audio completion event', async () => {
    const app = await loadedRuntime({ hasAudio: true });
    assert.equal(app.elements['next-button'].disabled, true);
    app.next();
    assert.equal(app.requests.length, 1);
    app.audio.ended = true;
    app.audio.currentTime = app.audio.duration;
    app.audioListeners.get('ended')();
    assert.equal(app.elements['next-button'].disabled, false);
    app.next();
    assert.equal(app.requests[1].url, 'pages/lesson-1.html');
  });

  await check('The Next button advances normally when page files are available', async () => {
    const app = await loadedRuntime();
    app.next(); succeed(app.requests[1]); await pause();
    app.next(); succeed(app.requests[2]); await pause();
    assert.equal(app.current(), 2);
    assert.equal(app.elements['next-button'].textContent, 'Finish');
    assert.equal(app.elements['next-button'].disabled, false);
    assert.deepEqual(Array.from(app.visited()), ['welcome', 'lesson-1', 'lesson-2']);
  });

  console.log(`SCORM Next navigation regression checks: ${checks} passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
