'use strict';
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../App.tsx'), 'utf8');
const from = source.indexOf('  const replacePagesInProject =');
const to = source.indexOf('\n  const createAudioAssetForPage', from);
assert.ok(from >= 0 && to > from, 'Batch merge helper missing');
const code = source.slice(from, to) + '\nmodule.exports = replacePagesInProject;';
const compiled = ts.transpileModule(code, { fileName: 'batch-merge.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }});
const sandboxModule = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: sandboxModule, exports: sandboxModule.exports,
  isNarrationAudioMedia: media => media.type === 'audio' && !media.candidate && media.source !== 'powerpoint',
});
const merge = sandboxModule.exports;
const page = (content, narration, media=[]) => ({ id:'topic-0', title:'Slide 5', content, narration, media, caption:'original.vtt' });
const current = page('Preserve PRE and POST text', 'latest narration', [{ id:'image1',storageId:'im1',type:'image' }]);
const outdated = page('OLD BODY', 'latest narration', [{ id:'newAudio',storageId:'aud1',type:'audio',source:'azure-openai-tts'}]);
const project = {courseContent: {welcomePage: { id:'welcome' },learningObjectivesPage: {id:'objectives'},topics:[current]}};
const generated = new Map([['topic-0',outdated]]);
const audio = merge(project,generated,'audio');
assert.equal(audio.courseContent.topics[0].content,'Preserve PRE and POST text');
assert.equal(audio.courseContent.topics[0].narration,'latest narration');
assert.equal(audio.courseContent.topics[0].media.length,2);
assert.equal(audio.courseContent.topics[0].media[1].storageId,'aud1');
assert.equal(project.courseContent.topics[0].media.length,1,'input project must remain untouched');
const caption = merge(project,new Map([['topic-0',{...outdated,caption:'new.vtt'}]]),'caption');
assert.equal(caption.courseContent.topics[0].content,'Preserve PRE and POST text');
assert.equal(caption.courseContent.topics[0].caption,'new.vtt');
const stale = merge(project,new Map([['topic-0',page('OLD','older script',outdated.media)]]),'audio');
assert.equal(stale.courseContent.topics[0].media.length,1,'stale TTS must not attach');
console.log('TTS/caption edit-preservation checks: 8/8 passed.');
