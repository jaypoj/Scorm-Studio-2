// Synthetic, nonconfidential generated-package regression tests (Node.js 22, no DOM dependency).
// Execute `npm run check:scorm-runtime` after `npm ci`.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'services/scormRuntime/api.js'), 'utf8');
const navigationSource = fs.readFileSync(path.join(root, 'services/scormRuntime/navigation.js'), 'utf8');

class InMemoryZip {
  constructor() { this.files = new Map(); }
  file(name, content) { this.files.set(name, content); return this; }
  async generateAsync() { return this.files; }
}
function loadPackager(zipClass = InMemoryZip) {
  const tsSource = fs.readFileSync(path.join(root, 'services/scormPackager.ts'), 'utf8');
  const compiled = ts.transpileModule(tsSource, {
    fileName: 'scormPackager.ts',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  });
  const module = { exports: {} };
  const fakeRequire = id => {
    if (id === 'jszip') return { default: zipClass, __esModule: true };
    if (id === './scormRuntime/api.js?raw') return { default: apiSource, __esModule: true };
    if (id === './scormRuntime/navigation.js?raw') return { default: navigationSource, __esModule: true };
    if (id === '../utils/captions') return {
      sanitizeWebVtt: value => value || '', buildVttFromNarration: () => '', estimateNarrationDurationSeconds: () => 0
    };
    throw new Error('Unexpected packager dependency: ' + id);
  };
  new Function('require', 'module', 'exports', compiled.outputText)(fakeRequire, module, module.exports);
  return module.exports.ScormPackager;
}
const ScormPackager = loadPackager();
function makeQuestion(index, type = 'multiple-choice') {
  return {
    id: 'q-' + index,
    type,
    question: 'Synthetic question ' + index + '?',
    options: type === 'true-false' ? undefined : ['Correct option', 'Incorrect option'],
    correctAnswer: type === 'true-false' ? 'true' : 'Correct option',
    feedback: { correct: 'Correct.', incorrect: 'Try again.' }
  };
}
function makePage(id, knowledge = false, audio = false) {
  return {
    id, title: id, content: '<p>Generic synthetic learning content.</p>', narration: '', duration: 1,
    imageKeywords: [], imagePrompts: [], media: audio ? [{ id: 'audio_' + id, storageId: 'audio_' + id, type: 'audio', url: 'media/audio.mp3' }] : [],
    ...(knowledge ? { knowledgeCheck: { questions: [makeQuestion(1, 'true-false')] } } : {})
  };
}
function makeProject(options = {}) {
  const topics = Array.from({ length: options.lessons || 1 }, (_, index) => makePage('topic-' + index, Boolean(options.knowledge), Boolean(options.audio)));
  return {
    project: { id: options.projectId || 'synthetic-course', name: 'Synthetic course', created: '', lastModified: '', path: '' },
    courseData: { title: 'Synthetic course', difficulty: 1, template: 'default', topics: [], customTopics: null },
    courseContent: {
      welcomePage: makePage('welcome'), learningObjectivesPage: makePage('objectives'), topics,
      assessment: {
        narration: null, passMark: options.passMark ?? 80, maxAttempts: options.maxAttempts ?? null,
        ...(options.reviewPolicy ? { reviewPolicy: options.reviewPolicy } : {}),
        questions: Array.from({ length: options.questions === undefined ? 10 : options.questions }, (_, i) => makeQuestion(i + 1))
      }
    },
    media: { images: [], videos: [], audio: [] },
    scormConfig: {
      version: '1.2', passingScore: options.passMark ?? 80, completionCriteria: 'passed',
      requireKnowledgeCheckBeforeContinue: options.knowledgePolicy === 'pass',
      knowledgeCheckPolicy: options.knowledgePolicy || 'optional',
      scoreTracking: options.scoreTracking || 'best',
      requireAudioCompletionBeforeContinue: Boolean(options.audioGate),
      outputTheme: 'dark-violet', contentMode: options.ppt ? 'ppt-import' : 'standard'
    }
  };
}
async function build(options) {
  const project = makeProject(options);
  const files = await ScormPackager.createScormPackage(project, null);
  return { project, files };
}
class ClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    if (force === false) this.values.delete(value); else if (force || !this.values.has(value)) this.values.add(value);
    else this.values.delete(value);
  }
  contains(value) { return this.values.has(value); }
}
class Element {
  constructor(id = '') {
    this.id = id; this.textContent = ''; this._innerHTML = ''; this.dataset = {};
    this.style = {}; this.hidden = false; this.disabled = false;
    this.className = ''; this.classList = new ClassList();
    this.attributes = {}; this.listeners = {};
  }
  set innerHTML(value) { this._innerHTML = value; if (this.onHtml) this.onHtml(value); }
  get innerHTML() { return this._innerHTML; }
  setAttribute(k, value) { this.attributes[k] = value; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  getAttribute(k) { return this.attributes[k] || ''; }
  focus() {}
}
class QuestionNode extends Element {
  constructor(attrs, html) {
    super();
    this.dataset = {};
    for (const match of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)) {
      const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = match[2];
    }
    this.inputs = [...html.matchAll(/<input type="radio"[^>]+value="([^"]+)"/g)].map(match => {
      const input = new Element(); input.value = match[1]; input.checked = false; return input;
    });
    this.feedback = new Element(); this.feedback.className = 'feedback';
  }
  querySelector(sel) {
    if (sel === 'input:checked') return this.inputs.find(input => input.checked) || null;
    if (sel === '.feedback') return this.feedback;
    return null;
  }
  querySelectorAll(sel) { return sel === 'input' ? this.inputs : []; }
}
class Card extends Element {
  constructor(questions = []) {
    super(); this.questions = questions; this.button = new Element('knowledge-submit');
    this.button.closest = selector => selector === '.knowledge-check' ? this : null;
  }
  querySelector(sel) { return sel === '.check-button' ? this.button : null; }
  querySelectorAll(sel) { return sel === '.question' ? this.questions : []; }
}
class DocumentMock {
  constructor(files, count) {
    this.files = files;
    this.listeners = {};
    this.elements = new Map();
    for (const id of ['progress-fill', 'progress-text', 'content-container', 'prev-button', 'next-button',
      'save-exit-button', 'gate-message', 'runtime-status', 'runtime-alert']) this.elements.set(id, new Element(id));
    this.links = Array.from({ length: count }, () => new Element());
    const container = this.elements.get('content-container');
    container.onHtml = html => this.loadHtml(html);
    this.currentCard = null; this.currentKind = null;
    this.body = new Element('body'); this.documentElement = new Element('html');
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  getElementById(id) { return this.elements.get(id) || null; }
  createElement(tag) { return new Element(tag); }
  querySelector(sel) {
    if (sel === '.knowledge-check') return this.currentKind === 'knowledge' ? this.currentCard : null;
    if (sel === '.assessment-card') return this.currentKind === 'assessment' ? this.currentCard : null;
    return null;
  }
  querySelectorAll(sel) {
    if (sel === '.nav-item') return this.links;
    if (sel === '.assessment-card .question') return this.currentKind === 'assessment' ? this.currentCard.questions : [];
    if (sel === '.synced-caption[data-caption-src]' || sel === '.narration-audio') return [];
    return [];
  }
  loadHtml(html) {
    this.currentKind = html.includes('class="page-card assessment-card"') ? 'assessment' :
      html.includes('class="knowledge-check"') ? 'knowledge' : null;
    const matches = [...html.matchAll(/<div class="question"([^>]*)>/g)];
    const questions = matches.map((match, index) => new QuestionNode(match[1], html.slice(match.index, matches[index + 1]?.index || html.length)));
    this.currentCard = this.currentKind ? new Card(questions) : null;
    for (const id of ['assessment-submit', 'assessment-retake', 'assessment-save-exit', 'assessment-result']) {
      this.elements.delete(id);
    }
    if (this.currentKind === 'assessment') {
      for (const id of ['assessment-submit', 'assessment-retake', 'assessment-save-exit', 'assessment-result']) {
        this.elements.set(id, new Element(id));
      }
    }
  }
  fireReady() { for (const fn of this.listeners.DOMContentLoaded || []) fn(); }
}
class MockLms {
  constructor(initial = {}, options = {}) {
    this.values = { 'cmi.core.lesson_status': 'not attempted', ...initial };
    this.options = options;
    this.events = [];
    this.active = false;
    this.commitCalls = 0;
    this.finishCalls = 0;
    this.initCalls = 0;
  }
  LMSInitialize() { this.initCalls++; this.active = !this.options.failInitialize; return String(this.active); }
  LMSGetValue(key) {
    this.events.push(['get', key]);
    if (key === 'cmi.interactions._count') return String(this.events.filter(event => event[0] === 'set' && /^cmi.interactions\.\d+\.id$/.test(event[1])).length);
    return this.values[key] === undefined ? '' : String(this.values[key]);
  }
  LMSSetValue(key, value) {
    this.events.push(['set', key, value]);
    if (!this.active || key === this.options.failSetKey) return 'false';
    this.values[key] = value;
    return 'true';
  }
  LMSCommit() { this.commitCalls++; this.events.push(['commit']); return String(this.active && !this.options.failCommit); }
  LMSFinish() { this.finishCalls++; this.events.push(['finish']); if (this.options.failFinish) return 'false'; this.active = false; return 'true'; }
  LMSGetLastError() { return this.options.failCommit || this.options.failFinish || this.options.failSetKey || this.options.failInitialize ? '101' : '0'; }
  LMSGetErrorString() { return 'Synthetic API failure'; }
}
async function simulator(options = {}, lms = new MockLms(), localStore = new Map()) {
  const { files } = await build(options);
  const js = files.get('scripts/navigation.js');
  const declaredPages = JSON.parse(js.match(/^const PAGES=(.+);\n/)[1]);
  const doc = new DocumentMock(files, declaredPages.length);
  const windowListeners = {};
  const deferredFetches = [];
  const failedPageLoads = new Map(Object.entries(options.failPageLoads || {}));
  const window = {
    origin: options.opaquePreview ? 'null' : 'http://localhost',
    API: options.apiInOpener ? undefined : (lms || undefined), opener: options.apiInOpener ? { API: lms, parent: null } : null, localStorage: {
      getItem: key => localStore.get(key) || '', setItem: (key, value) => localStore.set(key, value)
    },
    scrollTo() {}, close() { if (options.cannotClose) throw new Error('Window close blocked'); this.closed = true; },
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); }
  };
  window.parent = options.blockedParent ? { get API() { throw new Error('Cross-origin parent'); } } : window;
  const context = vm.createContext({
    window, document: doc,
    fetch: href => {
      if (href === options.deferPage) {
        return new Promise(resolve => deferredFetches.push({ href, resolve }));
      }
      const remaining = failedPageLoads.get(href) || 0;
      if (remaining > 0) {
        failedPageLoads.set(href, remaining - 1);
        return Promise.resolve({ ok: false, status: 503, text: async () => 'Temporary failure' });
      }
      const contents = files.get(href);
      return Promise.resolve({ ok: contents !== undefined, status: contents === undefined ? 404 : 200, text: async () => contents || '' });
    },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array, console
  });
  vm.runInContext(files.get('scripts/scorm-api.js'), context, { filename: 'generated/scripts/scorm-api.js' });
  vm.runInContext(js, context, { filename: 'generated/scripts/navigation.js' });
  doc.fireReady();
  await new Promise(resolve => setImmediate(resolve));
  const run = async source => { const output = vm.runInContext(source, context); return output && typeof output.then === 'function' ? await output : output; };
  const answer = (index, correct = true) => {
    const question = doc.currentCard.questions[index];
    const targetValue = correct ? question.dataset.correctOptionId : question.inputs.find(input => input.value !== question.dataset.correctOptionId).value;
    for (const input of question.inputs) input.checked = input.value === targetValue;
  };
  const answerAll = (correctCount, total) => {
    const count = total ?? doc.currentCard.questions.length;
    for (let i = 0; i < count; i++) answer(i, i < correctCount);
  };
  return { files, declaredPages, doc, window, lms, localStore, run, answer, answerAll, windowListeners, deferredFetches };
}
async function toAssessment(sim) { await sim.run('loadPage(PAGES.length - 1)'); }
async function toKnowledge(sim) { await sim.run('loadPage(2)'); }

const results = [];
async function check(id, description, fn) {
  try { await fn(); results.push({ id, success: true, description }); console.log('PASS ' + id + ': ' + description); }
  catch (error) { results.push({ id, success: false, description }); console.error('FAIL ' + id + ': ' + description + '\n' + (error.stack || error)); }
}
(async () => {
  await check('T01', 'Required knowledge check unlocks immediately on correct answer', async () => {
    const s = await simulator({ knowledge: true, knowledgePolicy: 'pass' });
    await toKnowledge(s); assert.equal(s.doc.getElementById('next-button').disabled, true);
    s.answer(0); await s.run('submitKnowledgeCheck(document.querySelector(".knowledge-check").button)');
    assert.equal(s.doc.getElementById('next-button').disabled, false);
  });
  await check('T02', 'Incorrect required check remains gated and can be retried', async () => {
    const s = await simulator({ knowledge: true, knowledgePolicy: 'pass' }); await toKnowledge(s);
    s.answer(0, false); await s.run('submitKnowledgeCheck(document.querySelector(".knowledge-check").button)');
    assert.equal(s.doc.getElementById('next-button').disabled, true);
    s.answer(0); await s.run('submitKnowledgeCheck(document.querySelector(".knowledge-check").button)');
    assert.equal(s.doc.getElementById('next-button').disabled, false);
  });
  await check('T03', 'Attempt-only incorrect check unlocks after complete attempt', async () => {
    const s = await simulator({ knowledge: true, knowledgePolicy: 'attempt' }); await toKnowledge(s);
    s.answer(0, false); await s.run('submitKnowledgeCheck(document.querySelector(".knowledge-check").button)');
    assert.equal(s.doc.getElementById('next-button').disabled, false);
  });
  await check('T04', 'Completed knowledge check restored from LMS suspend state', async () => {
    const lms = new MockLms(); let s = await simulator({ knowledge: true, knowledgePolicy: 'pass' }, lms);
    await toKnowledge(s); s.answer(0); await s.run('submitKnowledgeCheck(document.querySelector(".knowledge-check").button)');
    assert.equal(JSON.parse(lms.values['cmi.suspend_data']).v, 2);
    s = await simulator({ knowledge: true, knowledgePolicy: 'pass' }, lms);
    assert.equal(s.doc.getElementById('next-button').disabled, false);
    assert.equal(s.doc.currentCard.button.disabled, true);
  });
  await check('T05', '100% lessons viewed does not complete an unpassed assessment course', async () => {
    const lms = new MockLms(); const s = await simulator({}, lms);
    for (let i = 0; i < s.declaredPages.length; i++) await s.run('loadPage(' + i + ')');
    assert.equal(s.doc.getElementById('progress-text').textContent, '100% of lessons viewed');
    assert.notEqual(lms.values['cmi.core.lesson_status'], 'completed');
    assert.notEqual(lms.values['cmi.core.lesson_status'], 'passed');
  });
  for (const [id, score, result] of [['T06', 79, 'failed'], ['T07', 80, 'passed'], ['T08', 100, 'passed']]) {
    await check(id, 'Assessment ' + score + '% records ' + result, async () => {
      const lms = new MockLms(); const s = await simulator({ questions: 100 }, lms); await toAssessment(s);
      s.answerAll(score); await s.run('submitAssessment()');
      assert.equal(Number(lms.values['cmi.core.score.raw']), score);
      assert.equal(lms.values['cmi.core.lesson_status'], result);
    });
  }
  await check('T09', 'Unanswered required assessment question blocks submission', async () => {
    const lms = new MockLms(); const s = await simulator({}, lms); await toAssessment(s);
    s.answer(0); await s.run('submitAssessment()');
    assert.equal(lms.values['cmi.core.score.raw'], undefined);
    assert.equal(s.doc.getElementById('assessment-submit').hidden, false);
  });
  await check('T10', 'Retake clears every answer, feedback item and prior result', async () => {
    const s = await simulator({ questions: 5 }); await toAssessment(s);
    s.answerAll(0); await s.run('submitAssessment()');
    await s.run('retakeAssessment()');
    assert.ok(s.doc.currentCard.questions.every(q => q.inputs.every(input => !input.checked)));
    assert.ok(s.doc.currentCard.questions.every(q => q.feedback.textContent === ''));
    assert.equal(s.doc.getElementById('assessment-submit').hidden, false);
  });
  await check('T11', 'Retake requires all questions to be answered anew', async () => {
    const lms = new MockLms(); const s = await simulator({ questions: 5 }, lms); await toAssessment(s);
    s.answerAll(0); await s.run('submitAssessment()'); await s.run('retakeAssessment()');
    s.answer(0); await s.run('submitAssessment()');
    assert.equal(JSON.parse(lms.values['cmi.suspend_data']).a.n, 1);
  });
  await check('T12', 'Best-score retake preserves earlier passed score and status', async () => {
    const lms = new MockLms(); const s = await simulator({ questions: 10, scoreTracking: 'best' }, lms); await toAssessment(s);
    s.answerAll(10); await s.run('submitAssessment()'); await s.run('retakeAssessment()');
    s.answerAll(4); await s.run('submitAssessment()');
    assert.equal(lms.values['cmi.core.lesson_status'], 'passed');
    assert.equal(Number(lms.values['cmi.core.score.raw']), 100);
    assert.equal(s.doc.getElementById('next-button').disabled, false);
  });
  await check('T13', 'New registration never restores stale local preview pass', async () => {
    const store = new Map();
    const preview = await simulator({}, null, store); await toAssessment(preview);
    preview.answerAll(10); await preview.run('submitAssessment()');
    const lms = new MockLms(); const s = await simulator({}, lms, store);
    assert.equal(lms.values['cmi.core.lesson_status'], 'incomplete');
    assert.equal(s.doc.getElementById('next-button').disabled, false); // First page is a lesson.
    await toAssessment(s);
    assert.equal(s.doc.getElementById('assessment-submit').hidden, false);
  });
  await check('T14', 'Legacy direct failed status cannot downgrade a pass under best tracking', async () => {
    const lms = new MockLms({ 'cmi.core.lesson_status': 'passed' });
    const s = await simulator({}, lms); await s.run("window.SafeSCORM.setValue('cmi.core.lesson_status','failed')");
    assert.equal(lms.values['cmi.core.lesson_status'], 'passed');
  });
  await check('T15', 'SafeSCORM.setStatus failed alias uses the same pass protection', async () => {
    const lms = new MockLms({ 'cmi.core.lesson_status': 'passed' });
    const s = await simulator({}, lms); await s.run("window.SafeSCORM.setStatus({success:'failed'})");
    assert.equal(lms.values['cmi.core.lesson_status'], 'passed');
  });
  await check('T16', 'Midcourse Save & Exit writes suspend, bookmark, time and finishes once', async () => {
    const lms = new MockLms(); const s = await simulator({}, lms);
    await s.run('loadPage(1)'); await s.run('saveAndExitCourse()');
    assert.equal(lms.values['cmi.core.lesson_location'], 'objectives');
    assert.equal(lms.values['cmi.core.exit'], 'suspend');
    assert.match(lms.values['cmi.core.session_time'], /^\d{4}:\d\d:\d\d$/);
    assert.equal(lms.finishCalls, 1);
    for (const callback of s.windowListeners.pagehide || []) callback();
    assert.equal(lms.finishCalls, 1);
  });
  await check('T17', 'Failed quiz resumes at the assessment without changing failure', async () => {
    const lms = new MockLms(); let s = await simulator({}, lms); await toAssessment(s);
    s.answerAll(4); await s.run('submitAssessment()'); await s.run('saveAndExitCourse()');
    s = await simulator({}, lms);
    assert.equal(await s.run('currentPageId()'), 'assessment');
    assert.equal(s.doc.getElementById('assessment-retake').hidden, false);
    assert.equal(lms.values['cmi.core.lesson_status'], 'failed');
  });
  await check('T18', 'Commit false prevents exit and displays retryable error', async () => {
    const lms = new MockLms({}, { failCommit: true }); const s = await simulator({}, lms);
    await s.run('saveAndExitCourse()');
    assert.equal(lms.finishCalls, 0); assert.equal(s.window.closed, undefined);
    assert.match(s.doc.getElementById('runtime-status').textContent, /failed/i);
  });
  await check('T19', 'Finish false leaves course open and displays retryable error', async () => {
    const lms = new MockLms({}, { failFinish: true }); const s = await simulator({}, lms);
    await s.run('saveAndExitCourse()');
    assert.equal(lms.finishCalls, 1); assert.equal(s.window.closed, undefined);
    assert.match(s.doc.getElementById('runtime-status').textContent, /not confirm session termination/);
  });
  await check('T20', 'Blocked window close reports manual LMS-close fallback', async () => {
    const lms = new MockLms(); const s = await simulator({ cannotClose: true }, lms);
    await s.run('saveAndExitCourse()'); assert.equal(lms.finishCalls, 1);
    assert.match(s.doc.getElementById('runtime-status').textContent, /Workday\/LMS Close/);
  });
  await check('T21', 'Assessment and footer exit buttons call one canonical lifecycle', async () => {
    const lms = new MockLms(); const s = await simulator({}, lms);
    assert.equal(typeof s.doc.getElementById('save-exit-button').onclick, 'function');
    await toAssessment(s); assert.match(s.files.get('pages/assessment.html'), /saveAndExitCourse\(\)/);
    assert.match(s.files.get('index.html'), /id="save-exit-button"/);
    await s.run('saveAndExitCourse()'); await s.run('saveAndExitCourse()');
    assert.equal(lms.finishCalls, 1);
  });
  await check('T22', 'No competing beforeunload commit/terminate handler', async () => {
    const s = await simulator(); assert.equal(s.windowListeners.beforeunload, undefined);
    assert.equal(s.windowListeners.pagehide.length, 1);
  });
  await check('T23', 'Long-course resume stays compact and within SCORM 1.2 limit', async () => {
    const lms = new MockLms(); const s = await simulator({ lessons: 1000, questions: 0 }, lms);
    for (let i = 0; i < s.declaredPages.length; i++) await s.run('visited.add(PAGES[' + i + '].id)');
    await s.run('save()');
    assert.ok(lms.values['cmi.suspend_data'].length <= 4096);
    assert.equal(s.doc.getElementById('progress-text').textContent, '100% of lessons viewed');
  });
  await check('T24', 'No LMS API explicitly presents preview mode without LMS claims', async () => {
    const s = await simulator({}, null);
    assert.match(s.doc.getElementById('runtime-status').textContent, /Preview Mode/);
    await s.run('saveAndExitCourse()');
    assert.match(s.doc.getElementById('runtime-status').textContent, /No LMS session/);
  });
  await check('T25', 'Actual generated package file map has a valid SCORM 1.2 manifest and launch dependencies', async () => {
    const { files } = await build({ knowledge: true });
    const manifest = files.get('imsmanifest.xml');
    assert.match(manifest, /<manifest /); assert.match(manifest, /SCORM<\/schema><schemaversion>1\.2/);
    assert.match(manifest, /<adlcp:masteryscore>80<\/adlcp:masteryscore>/);
    for (const [, href] of manifest.matchAll(/<file href="([^"]+)"\s*\/>/g)) assert.ok(files.has(href), 'Missing manifest file ' + href);
    assert.match(files.get('index.html'), /scripts\/navigation\.js/);
    new vm.Script(files.get('scripts/scorm-api.js'));
    new vm.Script(files.get('scripts/navigation.js'));
  });
  await check('T26', 'Legacy project question structure can be republished without content loss', async () => {
    const { project, files } = await build({ knowledge: true, passMark: 85 });
    const restored = JSON.parse(files.get('project.json'));
    assert.deepEqual(restored.courseContent.topics, JSON.parse(JSON.stringify(project.courseContent.topics))); 
    assert.equal(restored.scormConfig.passingScore, 85);
    assert.match(files.get('pages/topic-0.html'), /Synthetic question/);
  });
  await check('E01', 'No-assessment course marks completed only after all required content', async () => {
    const lms = new MockLms(); const s = await simulator({ questions: 0 }, lms);
    assert.equal(s.declaredPages.some(page => page.assessment), false);
    assert.notEqual(lms.values['cmi.core.lesson_status'], 'completed');
    for (let i = 0; i < s.declaredPages.length; i++) await s.run('loadPage(' + i + ')');
    assert.equal(lms.values['cmi.core.lesson_status'], 'completed');
  });
  await check('E02', 'Invalid correct answer fails package export (never falls back to first choice)', async () => {
    const project = makeProject({ questions: 1 });
    project.courseContent.assessment.questions[0].correctAnswer = 'Not an offered choice';
    await assert.rejects(() => ScormPackager.createScormPackage(project, null), /set a correct answer/);
  });
  await check('E03', 'Explicit latest-score policy permits a legitimate same-registration downgrade', async () => {
    const lms = new MockLms(); const s = await simulator({ questions: 10, scoreTracking: 'latest' }, lms); await toAssessment(s);
    s.answerAll(10); await s.run('submitAssessment()'); await s.run('retakeAssessment()');
    s.answerAll(4); await s.run('submitAssessment()');
    assert.equal(lms.values['cmi.core.lesson_status'], 'failed');
    assert.equal(Number(lms.values['cmi.core.score.raw']), 40);
  });
  await check('E04', 'One failed retake cannot be resubmitted without a full reset', async () => {
    const lms = new MockLms(); const s = await simulator({ questions: 2, maxAttempts: 2 }, lms); await toAssessment(s);
    s.answerAll(0); await s.run('submitAssessment()'); await s.run('submitAssessment()');
    assert.equal(JSON.parse(lms.values['cmi.suspend_data']).a.n, 1);
    await s.run('retakeAssessment()'); s.answerAll(0); await s.run('submitAssessment()');
    assert.equal(JSON.parse(lms.values['cmi.suspend_data']).a.n, 2);
    assert.equal(s.doc.getElementById('assessment-retake').hidden, true);
  });
  await check('E05', 'LMSInitialize false is not treated as an active connection', async () => {
    const lms = new MockLms({}, { failInitialize: true }); const s = await simulator({}, lms);
    assert.match(s.doc.getElementById('runtime-status').textContent, /Preview Mode/);
    assert.equal(lms.events.some(event => event[0] === 'set'), false);
  });
  await check('E06', 'LMS write failure never claims Save & Exit succeeded', async () => {
    const lms = new MockLms({}, { failSetKey: 'cmi.suspend_data' }); const s = await simulator({}, lms);
    await s.run('saveAndExitCourse()');
    assert.equal(lms.finishCalls, 0);
    assert.match(s.doc.getElementById('runtime-status').textContent, /failed/i);
  });
  await check('E07', 'Unanswered knowledge check cannot be accepted as a valid attempt', async () => {
    const s = await simulator({ knowledge: true, knowledgePolicy: 'attempt' }); await toKnowledge(s);
    await s.run('submitKnowledgeCheck(document.querySelector(".knowledge-check").button)');
    assert.equal(s.doc.getElementById('next-button').disabled, true);
  });
  await check('E08', '80% score threshold does not round 79.5% into a pass', async () => {
    const lms = new MockLms(); const s = await simulator({ questions: 200 }, lms); await toAssessment(s);
    s.answerAll(159); await s.run('submitAssessment()');
    assert.equal(lms.values['cmi.core.lesson_status'], 'failed');
    assert.equal(Number(lms.values['cmi.core.score.raw']), 79.5);
  });
  await check('E09', 'Configured first-score policy retains first submitted result', async () => {
    const lms = new MockLms(); const s = await simulator({ questions: 10, scoreTracking: 'first' }, lms); await toAssessment(s);
    s.answerAll(4); await s.run('submitAssessment()'); await s.run('retakeAssessment()');
    s.answerAll(10); await s.run('submitAssessment()');
    assert.equal(Number(lms.values['cmi.core.score.raw']), 40);
    assert.equal(lms.values['cmi.core.lesson_status'], 'failed');
  });
  await check('E10', 'Previous passed LMS status remains on page navigation and assessment reset', async () => {
    const lms = new MockLms({ 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '95' });
    const s = await simulator({ questions: 10 }, lms); await toAssessment(s);
    s.answerAll(4); await s.run('submitAssessment()');
    assert.equal(lms.values['cmi.core.lesson_status'], 'passed');
    assert.equal(lms.values['cmi.core.score.raw'], '95');
  });
  await check('E11', 'Large unfinished assessment fails resume validation rather than silently truncating', async () => {
    const lms = new MockLms(); const s = await simulator({ questions: 2000 }, lms); await toAssessment(s);
    await s.run('assessmentState.answers = new Array(2000).fill(1); save()');
    assert.match(s.doc.getElementById('runtime-status').textContent, /4,096/);
  });
  await check('E12', 'Attempt limit blocks further full retakes', async () => {
    const s = await simulator({ maxAttempts: 1 }); await toAssessment(s); s.answerAll(0);
    await s.run('submitAssessment()');
    assert.equal(s.doc.getElementById('assessment-retake').hidden, true);
  });
  await check('E13', 'SCORM API discovery tolerates blocked cross-origin parent', async () => {
    const lms = new MockLms(); const s = await simulator({ apiInOpener: true, blockedParent: true }, lms);
    assert.equal(s.lms.initCalls, 1);
    assert.equal(s.doc.getElementById('runtime-status').textContent, '');
  });
  await check('E14', 'Legacy completed status is corrected for an unpassed graded course', async () => {
    const lms = new MockLms({ 'cmi.core.lesson_status': 'completed' });
    await simulator({}, lms);
    assert.equal(lms.values['cmi.core.lesson_status'], 'incomplete');
  });
  await check('E15', 'A previously passed learner without old suspend data retains the authoritative LMS result', async () => {
    const lms = new MockLms({ 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '100', 'cmi.core.lesson_location': 'assessment' });
    const s = await simulator({}, lms);
    assert.equal(s.doc.getElementById('assessment-submit').hidden, true);
    assert.equal(s.doc.getElementById('next-button').disabled, false);
    assert.equal(lms.values['cmi.core.score.raw'], '100');
  });
  await check('E16', 'After-pass review policy does not reveal feedback for failed assessments', async () => {
    const s = await simulator({ questions: 2, reviewPolicy: 'after-pass' }); await toAssessment(s);
    s.answerAll(1); await s.run('submitAssessment()');
    assert.ok(s.doc.currentCard.questions.every(q => q.feedback.textContent === ''));
    await s.run('retakeAssessment()'); s.answerAll(2); await s.run('submitAssessment()');
    assert.ok(s.doc.currentCard.questions.every(q => q.feedback.textContent === 'Correct.'));
  });
  await check('E17', 'Older saved projects preserve pass-gated knowledge checks and original pass mark', async () => {
    const source = fs.readFileSync(path.join(root, 'services/scormManager.ts'), 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const module = { exports: {} };
    new Function('module', 'exports', compiled)(module, module.exports);
    const legacy = makeProject({ passMark: 85, knowledge: true, knowledgePolicy: 'pass' });
    delete legacy.scormConfig.knowledgeCheckPolicy;
    legacy.scormConfig.passingScore = 80;
    const normalized = module.exports.ScormManager.prepareForSave(legacy);
    assert.equal(normalized.scormConfig.knowledgeCheckPolicy, 'pass');
    assert.equal(normalized.scormConfig.passingScore, 85);
    assert.equal(normalized.courseContent.assessment.passMark, 85);
  });
  await check('E18', 'Export rejects duplicate answer-choice text that would grade ambiguously', async () => {
    const project = makeProject({ questions: 1 });
    project.courseContent.assessment.questions[0].options = ['Correct option', 'Correct option'];
    await assert.rejects(() => ScormPackager.createScormPackage(project, null), /distinct/);
  });
  await check('E19', 'Default assessment review hides the answer key after a failed attempt', async () => {
    const s = await simulator({ questions: 2 }); await toAssessment(s);
    s.answerAll(1); await s.run('submitAssessment()');
    assert.ok(s.doc.currentCard.questions.every(q => q.feedback.textContent === ''));
    assert.equal(s.doc.getElementById('assessment-retake').hidden, false);
    await s.run('retakeAssessment()');
    assert.ok(s.doc.currentCard.questions.every(q => q.inputs.every(input => !input.checked)));
    assert.ok(s.doc.currentCard.questions.every(q => q.feedback.textContent === ''));
  });
  await check('E20', 'Different standalone courses do not inherit one another course assessment bookmark', async () => {
    const storage = new Map();
    const a = await simulator({ projectId: 'course-A' }, null, storage);
    await toAssessment(a); a.answerAll(10); await a.run('submitAssessment()');
    const b = await simulator({ projectId: 'course-B' }, null, storage);
    assert.equal(await b.run('current'), 0);
    assert.equal(b.doc.currentKind, null);
  });
  await check('E21', 'Temporary page failure preserves current content and Retry Page restores target', async () => {
    const s = await simulator({ failPageLoads: { 'pages/topic-0.html': 1 } });
    const originalHtml = s.doc.getElementById('content-container').innerHTML;
    await s.run('nextPage()'); await new Promise(resolve => setImmediate(resolve)); // objectives (loads normally)
    await s.run('nextPage()'); await new Promise(resolve => setImmediate(resolve)); // first topic fails
    assert.equal(await s.run('current'), 1);
    assert.notEqual(s.doc.getElementById('content-container').innerHTML, originalHtml);
    const objectives = s.doc.getElementById('content-container').innerHTML;
    assert.equal(s.doc.getElementById('next-button').textContent, 'Retry Page');
    assert.equal(s.doc.getElementById('content-container').innerHTML, objectives);
    await s.run('nextPage()'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(await s.run('current'), 2);
    assert.equal(s.doc.getElementById('next-button').textContent, 'Next');
  });
  await check('E22', 'Rapid Next clicks cannot start overlapping learner-page downloads', async () => {
    const s = await simulator({ deferPage: 'pages/objectives.html' });
    const pending = s.run('nextPage()');
    const extra = s.run('nextPage()');
    assert.equal(s.deferredFetches.length, 1);
    assert.equal(await s.run('current'), 0);
    const html = s.files.get('pages/objectives.html');
    s.deferredFetches[0].resolve({ ok: true, status: 200, text: async () => html });
    await Promise.all([pending, extra]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await s.run('current'), 1);
  });
  await check('E23', 'Isolated Course Preview keeps its progress in memory without LMS claims', async () => {
    const s = await simulator({ opaquePreview: true }, null);
    await toAssessment(s); s.answerAll(10); await s.run('submitAssessment()');
    await s.run('saveAndExitCourse()');
    assert.match(s.doc.getElementById('runtime-status').textContent, /No LMS progress was recorded/);
    assert.equal(s.doc.getElementById('runtime-status').className.includes('is-error'), false);
  });
  await check('E24', 'Sidebar cannot skip untouched lessons to open assessment on a fresh registration', async () => {
    const s = await simulator();
    await s.run('navigateSidebar(PAGES.length - 1)');
    assert.equal(await s.run('current'), 0);
    assert.equal(s.doc.currentKind, null);
  });
  await check('E25', 'A completed lesson never labels the next unanswered knowledge check complete', async () => {
    const lms = new MockLms();
    const s = await simulator({ knowledge: true, knowledgePolicy: 'pass', lessons: 2 }, lms);
    await s.run('loadPage(2)');
    s.answer(0);
    await s.run('submitKnowledgeCheck(document.querySelector(".knowledge-check").button)');
    assert.equal(s.doc.getElementById('next-button').disabled, false);
    assert.match(s.doc.getElementById('runtime-alert').textContent, /Knowledge check complete/);

    await s.run('nextPage()');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await s.run('currentPageId()'), 'topic-1');
    assert.equal(s.doc.currentCard.button.disabled, false, 'New check should accept its own answer');
    assert.equal(s.doc.getElementById('next-button').disabled, true, 'Next remains gated until new question is passed');
    assert.equal(s.doc.getElementById('runtime-alert').textContent, '', 'Old success message must be removed');
    assert.equal(s.doc.getElementById('runtime-alert').hidden, true);

    await s.run('prevPage()');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(s.doc.currentCard.button.disabled, true, 'Earlier check remains completed');
    await s.run('nextPage()');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(s.doc.getElementById('next-button').disabled, true, 'Returning does not wrongly complete new check');
    s.answer(0);
    await s.run('submitKnowledgeCheck(document.querySelector(".knowledge-check").button)');
    assert.equal(s.doc.getElementById('next-button').disabled, false);
  });
  await check('E26', 'A failed page load does not clear an alert about the current page', async () => {
    const s = await simulator({ knowledge: true, knowledgePolicy: 'pass', failPageLoads: { 'pages/topic-1.html': 1 }, lessons: 2 });
    await s.run('loadPage(2)');
    s.answer(0);
    await s.run('submitKnowledgeCheck(document.querySelector(".knowledge-check").button)');
    await s.run('nextPage()');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await s.run('currentPageId()'), 'topic-0');
    assert.match(s.doc.getElementById('runtime-status').textContent, /Could not load/);
    assert.match(s.doc.getElementById('runtime-alert').textContent, /Knowledge check complete/);
    await s.run('nextPage()');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await s.run('currentPageId()'), 'topic-1');
    assert.equal(s.doc.getElementById('runtime-alert').hidden, true);
  });
  // Production `npm ci` installs JSZip. Validate a REAL SCORM ZIP byte stream in GitHub Actions.
  let RealJSZip;
  try { RealJSZip = require('jszip'); } catch (error) { /* Absent in the upload-only inspection environment. */ }
  if (RealJSZip) {
    await check('B01', 'Binary SCORM ZIP can be reopened with every declared manifest resource', async () => {
      const RealPackager = loadPackager(RealJSZip);
      const blob = await RealPackager.createScormPackage(makeProject({ knowledge: true }), null);
      const zip = await RealJSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
      const manifest = await zip.file('imsmanifest.xml').async('string');
      assert.match(manifest, /<schemaversion>1\.2<\/schemaversion>/);
      assert.ok(zip.file('index.html'));
      for (const [, href] of manifest.matchAll(/<file href="([^"]+)"\s*\/>/g)) {
        assert.ok(zip.file(href), 'Missing ZIP entry: ' + href);
      }
    });
  } else console.log('NOT RUN B01: real binary ZIP validation requires installed JSZip (runs after npm ci on GitHub).');
  const failures = results.filter(item => !item.success);
  console.log('\n' + (results.length - failures.length) + '/' + results.length + ' generated-runtime tests passed.');
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
