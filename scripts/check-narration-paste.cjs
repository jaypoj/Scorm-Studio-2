'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const file = path.join(__dirname, '../utils/narrationPaste.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: 'narrationPaste.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const sandboxModule = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: sandboxModule, exports: sandboxModule.exports });
const normalize = sandboxModule.exports.normalizePastedNarration;
const pairs = [
  ['Stop work.Reassess the conditions.', 'Stop work. Reassess the conditions.'],
  ['Assess risk.Before starting!Stop if needed?Review again.', 'Assess risk. Before starting! Stop if needed? Review again.'],
  ['Already spaced. Correctly spaced.', 'Already spaced. Correctly spaced.'],
  ['Keep newlines.\nStop work.Next shift.', 'Keep newlines.\nStop work. Next shift.'],
  ['This is a 3.5-meter clearance.', 'This is a 3.5-meter clearance.'],
  ['Visit https://example.Com/path and www.example.Com/test.', 'Visit https://example.Com/path and www.example.Com/test.'],
  ['Email user@example.Com for assistance.', 'Email user@example.Com for assistance.'],
  ['Read U.S.A. policy.', 'Read U.S.A. policy.'],
  ['Use file.pdf and text.docx.', 'Use file.pdf and text.docx.'],
  ['Do not change punctuation...Really!', 'Do not change punctuation...Really!'],
  ['', ''],
];
for (const [source, expected] of pairs) {
  assert.equal(normalize(source), expected, source);
}
console.log('Narration paste checks: ' + pairs.length + '/' + pairs.length + ' passed.');
