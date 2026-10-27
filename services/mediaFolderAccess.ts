import type { FileSystemDirectoryHandle, ScormProject } from '../types';

// Folder handles are browser- and device-specific. Never write or create files while checking a folder.
const looksLikeMediaFolder = (name: string) => {
  const lower = name.toLowerCase();
  return lower === 'media' || lower === 'assets' || lower.endsWith('_assets');
};

const directoryChildren = async (folder: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle[]> => {
  const children: FileSystemDirectoryHandle[] = [];
  for await (const entry of folder.values()) {
    if (entry.kind === 'directory') children.push(entry as FileSystemDirectoryHandle);
  }
  return children;
};

/** Accept either the actual media folder or its immediate project/course folder. */
export const resolveSelectedMediaFolder = async (selected: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> => {
  const selectedName = selected.name.toLowerCase();
  if (selectedName === 'media' || selectedName === 'assets') return selected;

  const children = await directoryChildren(selected);
  const directMedia = children.find(dir => dir.name.toLowerCase() === 'media')
    || children.find(dir => dir.name.toLowerCase() === 'assets');
  if (directMedia) return directMedia;

  // Some older projects have a course_assets/media structure. Descend only through
  // one unambiguous assets-like folder; never choose between unrelated projects.
  const assetRoots = children.filter(dir => dir.name.toLowerCase().endsWith('_assets'));
  if (assetRoots.length === 1) {
    const nested = await directoryChildren(assetRoots[0]);
    return nested.find(dir => looksLikeMediaFolder(dir.name)) || assetRoots[0];
  }
  return selected;
};

export interface MediaFolderCheck {
  expectedFileCount: number;
  matchedFileCount: number;
  fileCount: number;
  recognizedFolderName: boolean;
}

/** Check for known media files without reading contents, exposing paths, or writing to disk. */
export const checkMediaFolderForProject = async (
  folder: FileSystemDirectoryHandle,
  project: ScormProject,
): Promise<MediaFolderCheck> => {
  const pages = [project.courseContent.welcomePage, project.courseContent.learningObjectivesPage, ...project.courseContent.topics];
  const expected = new Set(pages.flatMap(page => (page.media || [])
    .filter(media => media.storageId && !media.storageId.startsWith('external-') && !/^(https?:|data:|blob:)/i.test(media.url || ''))
    .map(media => media.storageId.toLowerCase())));
  let fileCount = 0;
  const matches = new Set<string>();
  for await (const entry of folder.values()) {
    if (entry.kind !== 'file' || entry.name.toLowerCase().endsWith('.json')) continue;
    fileCount += 1;
    const name = entry.name.toLowerCase();
    for (const id of expected) {
      if (name === id || name.startsWith(`${id}.`)) matches.add(id);
    }
  }
  return {
    expectedFileCount: expected.size,
    matchedFileCount: matches.size,
    fileCount,
    recognizedFolderName: looksLikeMediaFolder(folder.name),
  };
};
