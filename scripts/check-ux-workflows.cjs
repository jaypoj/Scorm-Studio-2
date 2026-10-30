// Browser-free regression checks for SCORM Studio 2 course creation and UX wiring.
// Uses only Node.js and the project's TypeScript compiler (installed during npm ci).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const transpile = code => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
let passed = 0;
function check(description, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log(`PASS ${description}`); });
}
function loadConstants() {
  const module = { exports: {} };
  vm.runInNewContext(transpile(read('constants.ts')), { module, exports: module.exports });
  return module.exports;
}
function extractCreateCourse() {
  const source = read('App.tsx');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let text = null;
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleCreateNewCourse') {
      text = node.initializer.getText(ast);
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert(text, 'Cannot find course creation handler');
  return transpile(`const handler = ${text}; handler;`);
}
function makeDirectory(name, entries = []) {
  const children = new Map(entries.map(item => [item.name, item]));
  return {
    kind: 'directory', name,
    async *values() { yield* children.values(); },
    async getDirectoryHandle(name, options = {}) {
      if (!children.has(name) && options.create) children.set(name, makeDirectory(name));
      const result = children.get(name);
      if (!result || result.kind !== 'directory') throw new Error('Missing folder: ' + name);
      return result;
    },
    async getFileHandle(name, options = {}) {
      if (!children.has(name) && options.create) children.set(name, { name, kind: 'file' });
      const result = children.get(name);
      if (!result || result.kind !== 'file') throw new Error('Missing file: ' + name);
      return result;
    },
    children,
  };
}
const simpleRequest = { courseName: 'Safety Sample', mode: 'manual', topics: ['Introduction'], difficulty: 2, model: 'gemini-3.8-flash', rateLimit: 'medium' };
function setup(options = {}) {
  const rootDir = options.root || makeDirectory('Workspace');
  const picker = options.picker || rootDir;
  const data = { errors: [], writes: [], foldersPicked: 0, contextUpdates: [], statuses: [] };
  const window = {
    showDirectoryPicker: async ({mode}) => { assert.equal(mode,'readwrite'); data.foldersPicked++; return picker; }
  };
  window.top = window; window.self = window;
  const globals = {
    context: options.context || null,
    rootEnvironment: options.hasRoot === false ? null : { rootHandle: rootDir, isSandbox: false },
    window,
    aiSettings: {model:'gemini-3.8-flash'},
    DEFAULT_TTS_SETTINGS: {voiceName:'coral',pace:'normal',styleInstructions:''},
    sanitizeFileName: str => str.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g,'_').slice(0, 80) || 'New_Course',
    ScormManager: { createProject: (_name,_topics,_difficulty,_content) => ({ project: {name:'Safety Sample', id:'sample'}, courseContent: { topics: [] }, scormConfig: {} }) },
    generateCourseContent: options.generateCourseContent || (async () => ({topics:[]})),
    importPowerPointCourse: async () => { throw Error('Unexpected PowerPoint path'); },
    importLegacyScormFromZip: async () => { throw Error('Unexpected legacy path'); },
    importLegacyScormFromFolder: async () => { throw Error('Unexpected legacy path'); },
    writeTextFile: async (handle, content) => data.writes.push({ name:handle.name, content }),
    createRestorePoint: async () => {},
    setIsCreatingCourse: () => {},
    setNewCourseError: v => { if (v) data.errors.push(v); },
    setNewCourseStatus: v => data.statuses.push(v),
    setNewCourseProgress: () => {},
    setRootEnvironment: () => {},
    setAvailableProjects: () => {},
    setContext: v => data.contextUpdates.push(v),
    setPronunciationConfig: () => {},
    setScanResult: () => {},
    setView: () => {},
    setIsNewCourseOpen: () => {},
    setLastAutoSaveAt: () => {},
    formatGeminiErrorForUser: err => err.message,
    setTimeout,
    Date,
    console,
  };
  const handler = vm.runInNewContext(extractCreateCourse(), globals);
  return { handler, data, rootDir, picker };
}
(async () => {
  const constants = loadConstants();
  await check('Default Gemini model uses Google-supported API ID', () => {
    assert.equal(constants.DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
    assert(constants.GEMINI_MODEL_OPTIONS.some(x => x.value === constants.DEFAULT_GEMINI_MODEL));
  });
  await check('Model menu contains no duplicated or retired 3 Pro preview ID', () => {
    const ids = constants.GEMINI_MODEL_OPTIONS.map(x => x.value);
    assert.equal(new Set(ids).size, ids.length);
    assert(!ids.includes('gemini-3-pro-preview'));
    for (const id of ['gemini-3.8-flash','gemini-3.6-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3.1-pro-preview']) assert(ids.includes(id));
  });
  await check('Saved older model remains selectable rather than silently changed', () => {
    const options = constants.getGeminiModelOptions('old-project-model');
    assert.equal(options[0].value, 'old-project-model');
    assert.equal(constants.getGeminiModelOptions('gemini-3.8-flash').length, constants.GEMINI_MODEL_OPTIONS.length);
  });
  await check('Creating course creates its named folder and required project files', async () => {
    const run = setup(); await run.handler(simpleRequest);
    assert.deepEqual(run.data.errors, []);
    const folder = run.rootDir.children.get('Safety_Sample');
    assert(folder && folder.kind === 'directory');
    assert(folder.children.has('media') && folder.children.has('_restore_points'));
    assert(folder.children.has('Safety_Sample.scormproj') && folder.children.has('pronunciations.json'));
    assert.equal(run.data.contextUpdates.length, 1);
    assert.equal(run.data.foldersPicked, 0);
  });
  await check('Existing course folder is not overwritten', async () => {
    const folder = makeDirectory('Safety_Sample');
    const run = setup({root:makeDirectory('Workspace', [folder])});
    await run.handler(simpleRequest);
    assert.match(run.data.errors[0], /already exists/);
    assert.equal(run.data.writes.length, 0);
    assert.equal(run.data.contextUpdates.length, 0);
  });
  await check('Folder conflicts on Windows are case-insensitive', async () => {
    const run = setup({root:makeDirectory('Workspace',[makeDirectory('sAFETY_sAMPLE')])});
    await run.handler(simpleRequest);
    assert.match(run.data.errors[0], /already exists/);
    assert.equal(run.data.writes.length, 0);
  });
  await check('AI failure creates no folders or project files', async () => {
    const run = setup({generateCourseContent:async () => {throw Error('Synthetic Gemini outage');}});
    await run.handler({...simpleRequest,mode:'ai'});
    assert.equal(run.rootDir.children.size, 0);
    assert.equal(run.data.writes.length, 0);
    assert(run.data.errors.length > 0);
  });
  await check('No previous workspace selects parent folder exactly once', async () => {
    const run = setup({hasRoot:false});
    await run.handler(simpleRequest);
    assert.equal(run.data.foldersPicked,1);
    assert(run.rootDir.children.has('Safety_Sample'));
  });
  await check('Creating while editing a single opened course prompts for parent', async () => {
    const currentCourseRoot = makeDirectory('Current_Course',[{name:'Current_Course.scormproj',kind:'file'}]);
    const parent = makeDirectory('Parent_Workspace');
    const run = setup({root:currentCourseRoot,picker:parent,context:{rootHandle:currentCourseRoot,isSandbox:false}});
    await run.handler(simpleRequest);
    assert.equal(run.data.foldersPicked,1);
    assert(!currentCourseRoot.children.has('Safety_Sample'));
    assert(parent.children.has('Safety_Sample'));
  });
  await check('Editor keeps media and narration actions connected to original handlers', () => {
    const editor = read('components/TopicEditor.tsx');
    assert(editor.includes('onClick={handleGenerateNarrationAudio}'));
    assert(editor.includes('onClick={handleTranscribe}'));
    assert(editor.includes('onClick={handleGeminiImageGeneration}'));
    assert(editor.includes('<details className='));
    assert(editor.indexOf('Course Page Builder') < editor.indexOf('Visual Media'));
    assert(editor.indexOf('Audio &amp; Captions') < editor.indexOf('Media Assets'));
  });
  await check('Existing password gate precedes AI Settings on the start screen', () => {
    const app = read('App.tsx');
    assert(app.indexOf('if (!isSiteUnlocked)') < app.indexOf('// Login / Load Screen'));
    assert.equal((app.match(/return <PasswordGate onUnlock=/g) || []).length, 1);
  });
  await check('New-course and project screens expose AI Settings', () => {
    const modal = read('components/NewCourseModal.tsx');
    const app = read('App.tsx');
    assert(modal.includes('onClick={onOpenAiSettings}'));
    assert(app.includes('Select Project to Load'));
    assert(app.includes('onClick={() => setIsSettingsOpen(true)}'));
    assert(app.includes('START HERE') === false); // Owned by modal, not duplicated.
    assert(modal.includes('START HERE'));
    assert(modal.includes('allowPowerPointImport'));
  });
  await check('Batch operations are collapsible and still use original callbacks', () => {
    const sidebar = read('components/Sidebar.tsx');
    assert(sidebar.includes('aria-expanded={batchToolsOpen}'));
    assert(sidebar.includes('onClick={onBatchGenerateTts}'));
    assert(sidebar.includes('onClick={onBatchGenerateCaptions}'));
  });
  await check('AI Settings save verifies browser persistence before reporting success', () => {
    const app = read('App.tsx');
    const ast = ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let saveSource;
    const walk = n => {
      if(ts.isVariableDeclaration(n) && n.name.getText(ast)==='saveAiSettings') saveSource = n.initializer.getText(ast);
      ts.forEachChild(n,walk);
    };
    walk(ast);
    assert(saveSource);
    const state = new Map(); const updates=[];
    const handler = vm.runInNewContext(transpile(`const handler=${saveSource}; handler;`), {
      localStorage: { setItem:(k,v)=>state.set(k,v),getItem:k=>state.get(k) },
      setAiSettings:v=>updates.push(v)
    });
    handler({model:'gemini-3.8-flash', azureOpenAiEndpoint:'test-endpoint'});
    assert.equal(updates.length,1);
    assert.equal(JSON.parse(state.get('scorm_ai_settings')).azureOpenAiEndpoint,'test-endpoint');
    assert.equal(updates[0].model,'gemini-3.8-flash');
  });
  await check('AI Settings blocked storage does not silently accept changes', () => {
    const app = read('App.tsx');
    const ast = ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let source;
    const walk = n => { if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='saveAiSettings') source=n.initializer.getText(ast); ts.forEachChild(n,walk); };
    walk(ast);
    const updates=[];
    const handler=vm.runInNewContext(transpile(`const handler=${source}; handler;`), {
      localStorage:{setItem:()=>{throw Error('Blocked by policy');},getItem:()=>null},
      setAiSettings:v=>updates.push(v)
    });
    assert.throws(()=>handler({model:'gemini-3.8-flash'}),/could not save AI Settings/);
    assert.equal(updates.length,0);
    assert(read('components/SettingsModal.tsx').includes('role="alert"'));
  });
  console.log(`UX workflow checks: ${passed}/${passed} passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
