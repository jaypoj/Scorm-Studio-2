import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSelectedMediaFolder, checkMediaFolderForProject } from '../services/mediaFolderAccess.ts';

let checks = 0;
const check = (label, fn) => Promise.resolve().then(fn).then(() => {
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, '0')}: ${label}`);
});

class TestDirectory {
  kind = 'directory';
  constructor(name, entries = []) {
    this.name = name;
    this.entries = entries;
  }
  async *values() {
    for (const entry of this.entries) yield entry;
  }
}
const file = name => ({ kind: 'file', name });
const courseProject = {
  courseContent: {
    welcomePage: { media: [{ storageId: 'image-1', type: 'image' }] },
    learningObjectivesPage: { media: [{ storageId: 'external-preview-1', url: 'https://example.invalid/image.png' }] },
    topics: [{ media: [{ storageId: 'audio-2', type: 'audio' }, { storageId: 'image-1', type: 'image' }] }],
  },
};

await check('A selected media directory stays selected', async () => {
  const media = new TestDirectory('media', [file('image-1.png')]);
  assert.equal(await resolveSelectedMediaFolder(media), media);
});
await check('A selected course folder resolves its media child', async () => {
  const media = new TestDirectory('media', [file('image-1.png')]);
  const folder = new TestDirectory('course', [new TestDirectory('_restore_points'), media]);
  assert.equal(await resolveSelectedMediaFolder(folder), media);
});
await check('A selected course folder resolves its assets child', async () => {
  const assets = new TestDirectory('assets');
  assert.equal(await resolveSelectedMediaFolder(new TestDirectory('course', [assets])), assets);
});
await check('A selected course_assets folder resolves its media child', async () => {
  const media = new TestDirectory('media');
  const root = new TestDirectory('course_assets', [media]);
  assert.equal(await resolveSelectedMediaFolder(root), media);
});
await check('A parent of course_assets resolves a nested media folder', async () => {
  const media = new TestDirectory('media');
  const root = new TestDirectory('parent', [new TestDirectory('course_assets', [media])]);
  assert.equal(await resolveSelectedMediaFolder(root), media);
});
await check('An ambiguous parent of multiple courses is not guessed', async () => {
  const root = new TestDirectory('parent', [new TestDirectory('course_a_assets'), new TestDirectory('course_b_assets')]);
  assert.equal(await resolveSelectedMediaFolder(root), root);
});
await check('Case-insensitive matching counts files but not JSON metadata', async () => {
  const media = new TestDirectory('media', [file('IMAGE-1.PNG'), file('audio-2.wav'), file('audio-2.json')]);
  assert.deepEqual(await checkMediaFolderForProject(media, courseProject), {
    expectedFileCount: 2, matchedFileCount: 2, fileCount: 2, recognizedFolderName: true,
  });
});
await check('A mismatched directory reports missing linked media', async () => {
  const wrong = new TestDirectory('not-course-media', [file('different.mp4')]);
  assert.deepEqual(await checkMediaFolderForProject(wrong, courseProject), {
    expectedFileCount: 2, matchedFileCount: 0, fileCount: 1, recognizedFolderName: false,
  });
});
await check('Folder inspection does not create, change, or remove files', async () => {
  const media = new TestDirectory('media', [file('image-1.png')]);
  const before = media.entries.map(entry => entry.name);
  await resolveSelectedMediaFolder(media);
  await checkMediaFolderForProject(media, courseProject);
  assert.deepEqual(media.entries.map(entry => entry.name), before);
});
await check('All editor views receive the folder and AI Settings actions', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.equal((app.match(/onLinkAssets=\{handleLinkAssets\}/g) || []).length, 3);
  assert.equal((app.match(/onOpenAiSettings=\{\(\) => setIsSettingsOpen\(true\)\}/g) || []).length, 6); // Three editors and three new-course dialogs.
  assert.equal((app.match(/isSandbox=\{context.isSandbox\}/g) || []).length, 3);
});
await check('Narration, captions, and media explain missing prerequisites', () => {
  const editor = readFileSync(new URL('../components/TopicEditor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /Generate TTS is disabled because the course's media folder is not connected/);
  assert.match(editor, /Azure TTS endpoint or key is not set in this browser/);
  assert.match(editor, /Captions are disabled because the media folder is not connected/);
  assert.match(editor, /Browser-session mode: newly uploaded media/);
});
await check('Sidebar shows complete names instead of truncating them', () => {
  const sidebar = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /title=\{topic.title\}/);
  assert.match(sidebar, /whitespace-normal break-words/);
});

console.log(`Browser workspace regression checks: ${checks} passed.`);
