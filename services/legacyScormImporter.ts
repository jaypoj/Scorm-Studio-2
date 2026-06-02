import JSZip from 'jszip';
import { CourseContent, ImportedProjectMediaFile, MediaItem, Question, ScormProject, Topic } from '../types';

export interface ImportedLegacyScormCourse {
  courseContent: CourseContent;
  topics: string[];
  mediaFiles: ImportedProjectMediaFile[];
  warnings: string[];
  scormConfigPatch: Partial<ScormProject['scormConfig']>;
  sourceTitle: string;
}

export type LegacyScormImportProgress = (percent: number, message: string) => void;

type PackageReader = {
  listPaths(): string[];
  has(path: string): boolean;
  readText(path: string): Promise<string | null>;
  readBlob(path: string): Promise<Blob | null>;
};

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
const basename = (value: string) => normalizePath(value).split('/').pop() || value;
const extensionOf = (value: string) => basename(value).split('.').pop()?.toLowerCase() || '';
const stemOf = (value: string) => basename(value).replace(/\.[^.]+$/, '');
const escapeHtml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]!));
const decodeHtml = (value: string) => value
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const IMPORTABLE_MEDIA_TYPES = new Set(['image', 'audio', 'video']);

const mimeTypeForExtension = (extension: string) => {
  switch (extension) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'm4a':
    case 'aac': return 'audio/mp4';
    case 'ogg': return 'audio/ogg';
    case 'mp4':
    case 'm4v': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'mov': return 'video/quicktime';
    case 'ogv': return 'video/ogg';
    default: return 'application/octet-stream';
  }
};

const extensionForMimeType = (mimeType: string, fallbackExtension: string) => {
  switch (mimeType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    case 'image/svg+xml': return 'svg';
    case 'audio/mpeg': return 'mp3';
    case 'audio/wav': return 'wav';
    case 'audio/mp4': return 'm4a';
    case 'audio/ogg': return 'ogg';
    case 'video/mp4': return 'mp4';
    case 'video/webm': return 'webm';
    case 'video/quicktime': return 'mov';
    case 'video/ogg': return 'ogv';
    default: return fallbackExtension || 'bin';
  }
};

const inferMimeTypeFromBlob = async (
  blob: Blob,
  expectedType: 'image' | 'audio' | 'video',
  fallbackExtension: string,
) => {
  const extensionMime = mimeTypeForExtension(fallbackExtension);
  if (extensionMime !== 'application/octet-stream') return extensionMime;

  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = Array.from(header).map(byte => String.fromCharCode(byte)).join('');
  if (header[0] === 0xff && header[1] === 0xd8) return 'image/jpeg';
  if (header[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image/png';
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.trimStart().startsWith('<svg')) return 'image/svg+xml';
  if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) return 'audio/mpeg';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii.slice(4, 8) === 'ftyp') return expectedType === 'audio' ? 'audio/mp4' : 'video/mp4';
  if (expectedType === 'image') return 'image/png';
  if (expectedType === 'audio') return 'audio/wav';
  return 'video/mp4';
};

const createZipReader = async (file: File): Promise<PackageReader> => {
  const zip = await JSZip.loadAsync(file);
  const paths = Object.keys(zip.files);
  const manifestPath = paths.find(path => normalizePath(path).toLowerCase().endsWith('imsmanifest.xml'));
  if (!manifestPath) throw new Error('This zip does not contain an imsmanifest.xml file.');
  const rootPrefix = normalizePath(manifestPath).slice(0, -'imsmanifest.xml'.length);

  const resolve = (path: string) => normalizePath(`${rootPrefix}${path}`);

  return {
    listPaths: () => paths.map(path => normalizePath(path).replace(rootPrefix, '')).filter(Boolean),
    has: (path: string) => Boolean(zip.file(resolve(path))),
    readText: async (path: string) => {
      const entry = zip.file(resolve(path));
      return entry ? entry.async('string') : null;
    },
    readBlob: async (path: string) => {
      const entry = zip.file(resolve(path));
      return entry ? entry.async('blob') : null;
    },
  };
};

const createFolderReader = (files: File[]): PackageReader => {
  const entries = new Map<string, File>();
  let manifestRelativePath = '';

  for (const file of files) {
    const relativePath = normalizePath((file as any).webkitRelativePath || file.name);
    if (relativePath.toLowerCase().endsWith('imsmanifest.xml') && !manifestRelativePath) {
      manifestRelativePath = relativePath;
    }
  }

  if (!manifestRelativePath) throw new Error('The selected folder does not contain an imsmanifest.xml file.');
  const rootPrefix = manifestRelativePath.slice(0, -'imsmanifest.xml'.length);

  for (const file of files) {
    const relativePath = normalizePath((file as any).webkitRelativePath || file.name);
    const trimmed = relativePath.startsWith(rootPrefix) ? relativePath.slice(rootPrefix.length) : relativePath;
    entries.set(trimmed, file);
  }

  return {
    listPaths: () => Array.from(entries.keys()),
    has: (path: string) => entries.has(normalizePath(path)),
    readText: async (path: string) => {
      const file = entries.get(normalizePath(path));
      return file ? file.text() : null;
    },
    readBlob: async (path: string) => {
      const file = entries.get(normalizePath(path));
      return file || null;
    },
  };
};

const getParser = () => new DOMParser();

const stripLeadingNumber = (value: string) => value.replace(/^\s*\d+\.\s*/, '').trim();

const vttToPlainText = (value: string) => value
  .replace(/\r/g, '')
  .replace(/^WEBVTT\s*/i, '')
  .split('\n')
  .filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.includes('-->') && !/^\d+$/.test(trimmed) && !trimmed.startsWith('NOTE');
  })
  .map(line => decodeHtml(line.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .join(' ')
  .trim();

const parseManifestTitle = (manifestXml: string) => {
  const doc = getParser().parseFromString(manifestXml, 'text/xml');
  const organizationTitle = doc.querySelector('organization > title');
  const itemTitle = doc.querySelector('organization > item > title');
  return (organizationTitle?.textContent || itemTitle?.textContent || 'Imported Legacy SCORM Course').trim();
};

const parseNavigationSettings = (navigationJs: string, topicCount: number) => {
  const passMarkMatch = navigationJs.match(/\bpassMark\s*:\s*(\d+)/i) || navigationJs.match(/\bpassingScore\s*=\s*(\d+)/i);
  const requireAudioMatch = navigationJs.match(/\bREQUIRE_AUDIO_COMPLETION\s*=\s*(true|false)/i);
  const hasKnowledgeChecks = /PAGES_WITH_KNOWLEDGE_CHECKS\s*=\s*\{[\s\S]*?topic-\d+/i.test(navigationJs) || topicCount > 0;
  return {
    passMark: Number(passMarkMatch?.[1] || 80),
    requireAudioCompletionBeforeContinue: String(requireAudioMatch?.[1] || 'false').toLowerCase() === 'true',
    requireKnowledgeCheckBeforeContinue: hasKnowledgeChecks,
  };
};

const selectFirstInnerHtml = (doc: Document, selectors: string[]) => {
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    if (node?.innerHTML?.trim()) return node.innerHTML.trim();
  }
  return '';
};

const selectText = (doc: Document, selectors: string[]) => {
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    const text = node?.textContent?.trim();
    if (text) return text;
  }
  return '';
};

const inferMediaType = (pathOrUrl: string, tagName: string) => {
  const tag = tagName.toLowerCase();
  const extension = extensionOf(pathOrUrl.split('?')[0]);
  if (tag === 'img' || IMAGE_EXTENSIONS.has(extension)) return 'image' as const;
  return 'video' as const;
};

const ensureUniqueStorageId = (desired: string, seen: Set<string>) => {
  let candidate = desired;
  let counter = 2;
  while (seen.has(candidate)) {
    candidate = `${desired}-${counter++}`;
  }
  seen.add(candidate);
  return candidate;
};

const findMediaPathForStorageId = (
  reader: PackageReader,
  storageId: string,
  type: 'image' | 'audio' | 'video',
  preferredPath?: string,
) => {
  const candidates = reader.listPaths()
    .map(normalizePath)
    .filter(path => path.toLowerCase().startsWith('media/'));
  const normalizedPreferred = preferredPath ? normalizePath(preferredPath) : '';
  if (normalizedPreferred && reader.has(normalizedPreferred)) return normalizedPreferred;

  const normalizedStorageId = storageId.toLowerCase();
  const exactStem = candidates.find(path => stemOf(path).toLowerCase() === normalizedStorageId);
  if (exactStem) return exactStem;

  const extensions = type === 'image' ? IMAGE_EXTENSIONS : type === 'audio' ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS;
  return candidates.find(path => {
    const lowerStem = stemOf(path).toLowerCase();
    const extension = extensionOf(path);
    return lowerStem === normalizedStorageId && (extensions.has(extension) || extension === 'octet-stream' || extension === 'bin');
  }) || null;
};

const createImportedMediaFile = async (
  reader: PackageReader,
  sourcePath: string,
  storageId: string,
  pageId: string,
  type: 'image' | 'audio' | 'video',
  title: string,
  warnings: string[],
): Promise<ImportedProjectMediaFile | null> => {
  const normalizedPath = normalizePath(sourcePath);
  const blob = await reader.readBlob(normalizedPath);
  if (!blob) {
    warnings.push(`Missing media file: ${normalizedPath}`);
    return null;
  }

  const sourceExtension = extensionOf(normalizedPath);
  const mimeType = await inferMimeTypeFromBlob(blob, type, sourceExtension);
  const extension = extensionForMimeType(mimeType, sourceExtension);
  const file = new File([blob], `${storageId}.${extension}`, { type: mimeType });

  return {
    file,
    storageId,
    pageId,
    type,
    title,
    source: 'legacy-scorm',
    originalName: basename(normalizedPath),
  };
};

const normalizeProjectMedia = (media: MediaItem[] | undefined): MediaItem[] => {
  const seen = new Set<string>();
  return (media || [])
    .filter(item => IMPORTABLE_MEDIA_TYPES.has(item.type))
    .map(item => ({
      ...item,
      id: item.id || item.storageId,
      storageId: item.storageId || item.id,
      source: item.source || 'legacy-scorm',
      candidate: Boolean(item.candidate),
      url: item.url?.startsWith('scorm-media://') ? '' : item.url,
    }))
    .filter(item => {
      if (!item.storageId || seen.has(item.storageId)) return false;
      seen.add(item.storageId);
      return true;
    });
};

const normalizePageCaptions = (
  page: CourseContent['welcomePage'] | CourseContent['learningObjectivesPage'] | Topic,
) => {
  const captionItem = (page.media || []).find(item => item.type === 'caption' && item.content);
  return {
    ...page,
    caption: page.caption || captionItem?.content,
    media: normalizeProjectMedia(page.media),
  };
};

const findPageHtmlPath = (reader: PackageReader, pageId: string) => {
  const paths = reader.listPaths().map(normalizePath);
  const candidates = [
    `pages/${pageId}.html`,
    pageId === 'learning-objectives' ? 'pages/objectives.html' : '',
    pageId === 'objectives' ? 'pages/learning-objectives.html' : '',
  ].filter(Boolean);
  return candidates.find(path => reader.has(path))
    || paths.find(path => path.toLowerCase() === `pages/${pageId.toLowerCase()}.html`)
    || null;
};

const extractLocalMediaSourcesFromHtml = (html: string) => {
  const doc = getParser().parseFromString(html, 'text/html');
  const nodes = Array.from(doc.querySelectorAll('img[src], video[src], video source[src], iframe[src]'));
  return nodes.map(node => {
    const src = (node as HTMLElement).getAttribute('src')?.trim() || '';
    if (!src || /^https?:\/\//i.test(src) || src.startsWith('//')) return null;
    const tagName = node.tagName.toLowerCase() === 'source' ? node.parentElement?.tagName || node.tagName : node.tagName;
    const type = inferMediaType(src, tagName);
    return {
      src: normalizePath(src),
      type,
      title: (node as HTMLImageElement).getAttribute('alt') || basename(src),
    };
  }).filter(Boolean) as Array<{ src: string; type: 'image' | 'video'; title: string }>;
};

const extractCaptionFromHtml = async (doc: Document, reader: PackageReader) => {
  const trackSrc = doc.querySelector('audio track[src], video track[src]')?.getAttribute('src')?.trim();
  if (!trackSrc || /^https?:\/\//i.test(trackSrc) || trackSrc.startsWith('//')) return '';
  return await reader.readText(normalizePath(trackSrc)) || '';
};

const importProjectJsonMedia = async (
  reader: PackageReader,
  courseContent: CourseContent,
  mediaFiles: ImportedProjectMediaFile[],
  warnings: string[],
) => {
  const addedStorageIds = new Set<string>();
  const addMediaFile = async (
    pageId: string,
    media: MediaItem,
    preferredPath?: string,
  ) => {
    if (!IMPORTABLE_MEDIA_TYPES.has(media.type) || addedStorageIds.has(media.storageId)) return;
    const type = media.type as 'image' | 'audio' | 'video';
    const mediaPath = findMediaPathForStorageId(reader, media.storageId, type, preferredPath);
    if (!mediaPath) {
      warnings.push(`Could not find a media file for ${media.storageId}.`);
      return;
    }
    const imported = await createImportedMediaFile(
      reader,
      mediaPath,
      media.storageId,
      pageId,
      type,
      media.title || `Imported ${type}`,
      warnings,
    );
    if (imported) {
      mediaFiles.push(imported);
      addedStorageIds.add(media.storageId);
    }
  };

  const pages: Array<{ pageId: string; page: CourseContent['welcomePage'] | CourseContent['learningObjectivesPage'] | Topic }> = [
    { pageId: courseContent.welcomePage.id || 'welcome', page: courseContent.welcomePage },
    { pageId: courseContent.learningObjectivesPage.id || 'learning-objectives', page: courseContent.learningObjectivesPage },
    ...courseContent.topics.map(topic => ({ pageId: topic.id, page: topic })),
  ];

  for (const { pageId, page } of pages) {
    for (const media of page.media || []) {
      await addMediaFile(pageId, media);
    }

    const htmlPath = findPageHtmlPath(reader, pageId);
    if (!htmlPath) continue;
    const html = await reader.readText(htmlPath);
    if (!html) continue;
    for (const source of extractLocalMediaSourcesFromHtml(html)) {
      const storageId = stemOf(source.src);
      if (!storageId || (page.media || []).some(media => media.storageId === storageId)) continue;
      const mediaItem: MediaItem = {
        id: storageId,
        storageId,
        type: source.type,
        title: source.title,
        source: 'legacy-scorm',
      };
      page.media = [...(page.media || []), mediaItem];
      await addMediaFile(pageId, mediaItem, source.src);
    }
  }
};

const importFromProjectJson = async (
  reader: PackageReader,
  projectJson: string,
  sourceTitle: string,
  courseNameOverride: string | undefined,
  onProgress?: LegacyScormImportProgress,
): Promise<ImportedLegacyScormCourse | null> => {
  let project: ScormProject | null = null;
  try {
    project = JSON.parse(projectJson) as ScormProject;
  } catch {
    return null;
  }
  if (!project?.courseContent?.welcomePage || !project.courseContent.learningObjectivesPage || !Array.isArray(project.courseContent.topics)) {
    return null;
  }

  onProgress?.(18, 'Reading exported project data...');
  const courseContent: CourseContent = {
    ...project.courseContent,
    welcomePage: normalizePageCaptions(project.courseContent.welcomePage),
    learningObjectivesPage: normalizePageCaptions(project.courseContent.learningObjectivesPage),
    topics: project.courseContent.topics.map(topic => normalizePageCaptions(topic)),
    assessment: project.courseContent.assessment || { narration: null, passMark: 80, questions: [] },
    lastModified: new Date().toISOString(),
  };

  const mediaFiles: ImportedProjectMediaFile[] = [];
  const warnings: string[] = [];
  onProgress?.(45, 'Recovering imported media files...');
  await importProjectJsonMedia(reader, courseContent, mediaFiles, warnings);

  const finalCourseName = courseNameOverride?.trim() || project.courseData?.title || project.project?.name || sourceTitle;
  return {
    courseContent,
    topics: courseContent.topics.map(topic => topic.title),
    mediaFiles,
    warnings,
    scormConfigPatch: {
      ...(project.scormConfig || {}),
      contentMode: 'standard',
    },
    sourceTitle: finalCourseName,
  };
};

const parseQuestions = (scope: ParentNode, containerSelector: string, questionSelector: string): Question[] => {
  const container = scope.querySelector(containerSelector);
  if (!container) return [];
  const questions: Question[] = [];
  container.querySelectorAll(questionSelector).forEach((questionNode, index) => {
    const questionText = questionNode.querySelector('.kc-question, .question-text')?.textContent?.trim();
    if (!questionText) return;
    const optionLabels = Array.from(questionNode.querySelectorAll('.kc-option span')).map(node => node.textContent?.trim() || '').filter(Boolean);
    const rawCorrect = (questionNode as HTMLElement).dataset.correctAnswer || '';
    const isTrueFalse = optionLabels.length === 2 && optionLabels.every(option => /^(true|false)$/i.test(option));
    const correctAnswer = isTrueFalse
      ? rawCorrect || optionLabels[0]
      : optionLabels.find(option => option === rawCorrect) || rawCorrect || optionLabels[0] || '';

    questions.push({
      id: `${containerSelector.replace(/[^a-z0-9]/gi, '')}-${index}`,
      type: isTrueFalse ? 'true-false' : 'multiple-choice',
      question: decodeHtml(questionText),
      options: isTrueFalse ? undefined : optionLabels,
      correctAnswer: decodeHtml(correctAnswer),
      feedback: {
        correct: decodeHtml((questionNode as HTMLElement).dataset.correctFeedback || 'Correct.'),
        incorrect: decodeHtml((questionNode as HTMLElement).dataset.incorrectFeedback || 'Review the material and try again.'),
      }
    });
  });
  return questions;
};

const extractLocalMedia = async (
  doc: Document,
  pageId: string,
  pageTitle: string,
  reader: PackageReader,
  mediaFiles: ImportedProjectMediaFile[],
  mediaItems: MediaItem[],
  seenStorageIds: Set<string>,
  warnings: string[],
) => {
  const addLocalFile = async (src: string, type: 'image' | 'audio' | 'video', title: string) => {
    const normalizedSrc = normalizePath(src);
    const blob = await reader.readBlob(normalizedSrc);
    if (!blob) {
      warnings.push(`Missing media file: ${normalizedSrc}`);
      return;
    }
    const extension = extensionOf(normalizedSrc);
    const storageId = ensureUniqueStorageId(stemOf(normalizedSrc) || `${pageId}-${type}`, seenStorageIds);
    const mimeType = await inferMimeTypeFromBlob(blob, type, extension);
    const fileExtension = extensionForMimeType(mimeType, extension);
    const file = new File([blob], `${storageId}.${fileExtension}`, { type: mimeType });
    mediaFiles.push({
      file,
      storageId,
      pageId,
      type,
      title,
      source: 'legacy-scorm',
      originalName: basename(normalizedSrc),
    });
    mediaItems.push({
      id: storageId,
      storageId,
      type,
      title,
      source: 'legacy-scorm',
    });
  };

  const mediaContainer = doc.querySelector('.media-container');
  const mediaScopes = Array.from(doc.querySelectorAll('.media-container, .top-media-layout, .visual-media-strip, .content-column'));
  const visualScopes = mediaScopes.length ? mediaScopes : [doc];
  const handledVisualSources = new Set<string>();
  for (const mediaScope of visualScopes) {
    const visualNodes = Array.from(mediaScope.querySelectorAll('img[src], video[src], video source[src], iframe[src]'));
    for (const node of visualNodes) {
      const src = (node as HTMLImageElement).getAttribute('src')?.trim();
      if (!src || handledVisualSources.has(src)) continue;
      handledVisualSources.add(src);
      if (/^https?:\/\//i.test(src) || src.startsWith('//')) {
        mediaItems.push({
          id: `external-${pageId}-${mediaItems.length}`,
          storageId: `external-${pageId}-${mediaItems.length}`,
          type: inferMediaType(src, node.tagName),
          title: (node as HTMLImageElement).getAttribute('alt') || pageTitle,
          url: src,
          source: 'legacy-scorm',
        });
        continue;
      }
      const type = inferMediaType(src, node.tagName);
      const title = (node as HTMLImageElement).getAttribute('alt') || `${pageTitle} ${type}`;
      await addLocalFile(src, type, title);
    }
  }

  const audioNode = doc.querySelector('audio[src], audio source[src]');
  if (audioNode) {
    const src = audioNode.getAttribute('src')?.trim();
    if (src) {
      if (/^https?:\/\//i.test(src) || src.startsWith('//')) {
        mediaItems.push({
          id: `external-audio-${pageId}`,
          storageId: `external-audio-${pageId}`,
          type: 'audio',
          title: `Narration: ${pageTitle}`,
          url: src,
          source: 'legacy-scorm',
        });
      } else {
        await addLocalFile(src, 'audio', `Narration: ${pageTitle}`);
      }
    }
  }
};

const parsePage = async (
  pageId: string,
  html: string,
  reader: PackageReader,
  mediaFiles: ImportedProjectMediaFile[],
  seenStorageIds: Set<string>,
  warnings: string[],
) => {
  const doc = getParser().parseFromString(html, 'text/html');
  const titleSelectors = pageId === 'welcome'
    ? ['.welcome-header h1', '.topic-header h2', 'h1', 'h2']
    : pageId === 'objectives'
      ? ['.topic-header h2', 'h1', 'h2']
      : ['.topic-header h2', 'h2', 'h1'];
  const rawTitle = selectText(doc, titleSelectors) || pageId;
  const title = pageId.startsWith('topic-') ? stripLeadingNumber(rawTitle) : rawTitle;
  const content = selectFirstInnerHtml(doc, [
    '.welcome-content',
    '.topic-text',
    '.objectives-content',
    '.content-column .topic-text',
    '.content-column .welcome-container .welcome-content',
  ]) || `<p>Imported content for ${escapeHtml(title)}.</p>`;

  const captionFile = doc.querySelector('audio[data-caption-file]')?.getAttribute('data-caption-file')?.trim();
  let caption = '';
  let narration = '';
  if (captionFile) {
    const captionText = await reader.readText(normalizePath(captionFile));
    if (captionText) {
      caption = captionText;
      narration = vttToPlainText(captionText);
    }
  }
  if (!caption) {
    caption = await extractCaptionFromHtml(doc, reader);
    if (caption) narration = vttToPlainText(caption);
  }
  if (!narration) {
    narration = decodeHtml((doc.querySelector('.topic-text')?.textContent || doc.querySelector('.welcome-content')?.textContent || '').replace(/\s+/g, ' ').trim());
  }

  const media: MediaItem[] = [];
  await extractLocalMedia(doc, pageId, title, reader, mediaFiles, media, seenStorageIds, warnings);

  const knowledgeQuestions = parseQuestions(doc, '.knowledge-check-container', '.kc-question-wrapper');

  return {
    id: pageId,
    title,
    content,
    narration,
    caption: caption || undefined,
    media,
    knowledgeQuestions,
  };
};

const parseAssessment = (html: string, passMark: number) => {
  const doc = getParser().parseFromString(html, 'text/html');
  const questions = parseQuestions(doc, '.assessment-container', '.question-container');
  return {
    narration: null,
    passMark,
    questions,
  };
};

const importFromReader = async (
  reader: PackageReader,
  courseNameOverride: string | undefined,
  onProgress?: LegacyScormImportProgress
): Promise<ImportedLegacyScormCourse> => {
  onProgress?.(5, 'Reading legacy SCORM package...');
  const manifestXml = await reader.readText('imsmanifest.xml');
  if (!manifestXml) throw new Error('Could not read imsmanifest.xml from the legacy package.');
  const sourceTitle = parseManifestTitle(manifestXml);
  const projectJson = await reader.readText('project.json');
  if (projectJson) {
    const importedProject = await importFromProjectJson(reader, projectJson, sourceTitle, courseNameOverride, onProgress);
    if (importedProject) return importedProject;
  }

  const navigationJs = await reader.readText('scripts/navigation.js');
  const pagePaths = reader.listPaths()
    .filter(path => /^pages\/.+\.html$/i.test(path))
    .sort((a, b) => {
      const aName = basename(a).toLowerCase();
      const bName = basename(b).toLowerCase();
      const rank = (name: string) => {
        if (name === 'welcome.html') return -2;
        if (name === 'objectives.html') return -1;
        if (name === 'assessment.html') return 9999;
        const topicMatch = name.match(/^topic-(\d+)\.html$/);
        return topicMatch ? Number(topicMatch[1]) : 5000;
      };
      return rank(aName) - rank(bName) || aName.localeCompare(bName);
    });

  if (!pagePaths.length) throw new Error('This package does not contain any HTML pages in the pages folder.');

  const mediaFiles: ImportedProjectMediaFile[] = [];
  const warnings: string[] = [];
  const seenStorageIds = new Set<string>();
  const topicPages: Topic[] = [];
  let welcomePage: CourseContent['welcomePage'] | null = null;
  let learningObjectivesPage: CourseContent['learningObjectivesPage'] | null = null;
  let assessmentHtml = '';

  for (const [index, pagePath] of pagePaths.entries()) {
    const pageId = stemOf(pagePath);
    onProgress?.(10 + Math.round(((index + 1) / pagePaths.length) * 75), `Importing ${pageId}...`);
    const pageHtml = await reader.readText(pagePath);
    if (!pageHtml) {
      warnings.push(`Could not read page ${pagePath}.`);
      continue;
    }
    if (pageId === 'assessment') {
      assessmentHtml = pageHtml;
      continue;
    }

    const parsed = await parsePage(pageId, pageHtml, reader, mediaFiles, seenStorageIds, warnings);
    if (pageId === 'welcome') {
      welcomePage = {
        id: 'welcome',
        title: parsed.title || `Welcome to ${courseNameOverride || sourceTitle}`,
        content: parsed.content,
        narration: parsed.narration,
        duration: 5,
        imageKeywords: [parsed.title || sourceTitle],
        imagePrompts: [`Professional training image for ${parsed.title || sourceTitle}`],
        caption: parsed.caption,
        media: parsed.media,
      };
      continue;
    }
    if (pageId === 'objectives') {
      learningObjectivesPage = {
        id: 'learning-objectives',
        title: parsed.title || 'Learning Objectives',
        content: parsed.content,
        narration: parsed.narration,
        duration: 5,
        imageKeywords: ['learning objectives', sourceTitle],
        imagePrompts: [`Professional training image for ${sourceTitle} learning objectives`],
        caption: parsed.caption,
        media: parsed.media,
      };
      continue;
    }

    topicPages.push({
      id: pageId,
      title: parsed.title,
      content: parsed.content,
      narration: parsed.narration,
      duration: 5,
      imageKeywords: [parsed.title],
      imagePrompts: [`Professional training image for ${parsed.title}`],
      videoSearchTerms: [parsed.title],
      caption: parsed.caption,
      media: parsed.media,
      knowledgeCheck: parsed.knowledgeQuestions.length ? { questions: parsed.knowledgeQuestions } : undefined,
    });
  }

  const legacySettings = parseNavigationSettings(navigationJs || '', topicPages.length);
  const assessment = assessmentHtml
    ? parseAssessment(assessmentHtml, legacySettings.passMark)
    : { narration: null, passMark: legacySettings.passMark, questions: [] as Question[] };

  const finalCourseName = courseNameOverride?.trim() || sourceTitle;

  const courseContent: CourseContent = {
    welcomePage: welcomePage || {
      id: 'welcome',
      title: `Welcome to ${finalCourseName}`,
      content: `<h2>${escapeHtml(finalCourseName)}</h2><p>This course was imported from a legacy SCORM package.</p>`,
      narration: `Welcome to ${finalCourseName}.`,
      duration: 5,
      imageKeywords: [finalCourseName],
      imagePrompts: [`Professional training image for ${finalCourseName}`],
      media: [],
    },
    learningObjectivesPage: learningObjectivesPage || {
      id: 'learning-objectives',
      title: 'Learning Objectives',
      content: `<h2>Learning Objectives</h2><ul>${topicPages.slice(0, 8).map(topic => `<li>${escapeHtml(topic.title)}</li>`).join('')}</ul>`,
      narration: topicPages.slice(0, 8).map(topic => topic.title).join('. '),
      duration: 5,
      imageKeywords: ['learning objectives', finalCourseName],
      imagePrompts: [`Professional training image for ${finalCourseName} learning objectives`],
      media: [],
    },
    topics: topicPages,
    assessment,
    lastModified: new Date().toISOString(),
  };

  onProgress?.(94, 'Finalizing imported project...');
  return {
    courseContent,
    topics: topicPages.map(topic => topic.title),
    mediaFiles,
    warnings,
    scormConfigPatch: {
      passingScore: legacySettings.passMark,
      requireKnowledgeCheckBeforeContinue: legacySettings.requireKnowledgeCheckBeforeContinue,
      requireAudioCompletionBeforeContinue: legacySettings.requireAudioCompletionBeforeContinue,
    },
    sourceTitle,
  };
};

export const importLegacyScormFromZip = async (
  file: File,
  courseNameOverride?: string,
  onProgress?: LegacyScormImportProgress
) => importFromReader(await createZipReader(file), courseNameOverride, onProgress);

export const importLegacyScormFromFolder = async (
  files: File[],
  courseNameOverride?: string,
  onProgress?: LegacyScormImportProgress
) => importFromReader(createFolderReader(files), courseNameOverride, onProgress);
