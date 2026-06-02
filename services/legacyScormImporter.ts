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

const normalizePath = (value: string) => {
  const parts = value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join('/');
};
const basename = (value: string) => normalizePath(value).split('/').pop() || value;
const dirname = (value: string) => {
  const normalized = normalizePath(value);
  return normalized.includes('/') ? normalized.replace(/\/[^/]*$/, '') : '';
};
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
  pagePath: string,
  pageId: string,
  pageTitle: string,
  reader: PackageReader,
  mediaFiles: ImportedProjectMediaFile[],
  mediaItems: MediaItem[],
  seenStorageIds: Set<string>,
  warnings: string[],
) => {
  const resolveMediaBlob = async (src: string) => {
    const normalizedSrc = normalizePath(src);
    const pageDir = dirname(pagePath);
    const candidates = Array.from(new Set([
      normalizedSrc,
      normalizedSrc.replace(/^(\.\.\/)+/, ''),
      pageDir ? normalizePath(`${pageDir}/${normalizedSrc}`) : '',
      pageDir ? normalizePath(`${pageDir}/${normalizedSrc}`).replace(/^(\.\.\/)+/, '') : '',
    ].filter(Boolean)));
    for (const candidate of candidates) {
      const blob = await reader.readBlob(candidate);
      if (blob) return { blob, path: candidate };
    }
    return { blob: null, path: normalizedSrc };
  };

  const addLocalFile = async (src: string, type: 'image' | 'audio' | 'video', title: string) => {
    const resolved = await resolveMediaBlob(src);
    const blob = resolved.blob;
    if (!blob) {
      warnings.push(`Missing media file: ${resolved.path}`);
      return;
    }
    const normalizedSrc = resolved.path;
    const extension = extensionOf(normalizedSrc);
    const storageId = ensureUniqueStorageId(stemOf(normalizedSrc) || `${pageId}-${type}`, seenStorageIds);
    const file = new File([blob], `${storageId}.${extension || 'bin'}`, { type: mimeTypeForExtension(extension) });
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

  const visualContainers = Array.from(doc.querySelectorAll([
    '.media-container',
    '.top-media-layout',
    '.visual-media-strip',
    '.media-frame',
    '.video-frame',
    '.content-container',
  ].join(',')));
  const visualScope = visualContainers.length ? visualContainers : [doc.body];
  const seenSources = new Set<string>();
  for (const container of visualScope) {
    const visualNodes = Array.from(container.querySelectorAll('img[src], video[src], iframe[src], source[src]'));
    for (const node of visualNodes) {
      const src = (node as HTMLImageElement).getAttribute('src')?.trim();
      if (!src || seenSources.has(src)) continue;
      seenSources.add(src);
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

  const audioNodes = Array.from(doc.querySelectorAll('audio[src], audio source[src]'));
  for (const audioNode of audioNodes) {
    const src = audioNode.getAttribute('src')?.trim();
    if (src && seenSources.has(src)) continue;
    if (src) {
      seenSources.add(src);
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
  pagePath: string,
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
    const captionText = await reader.readText(captionFile);
    if (captionText) {
      caption = captionText;
      narration = vttToPlainText(captionText);
    }
  }
  if (!narration) {
    narration = decodeHtml((doc.querySelector('.topic-text')?.textContent || doc.querySelector('.welcome-content')?.textContent || '').replace(/\s+/g, ' ').trim());
  }

  const media: MediaItem[] = [];
  await extractLocalMedia(doc, pagePath, pageId, title, reader, mediaFiles, media, seenStorageIds, warnings);

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

    const parsed = await parsePage(pageId, pagePath, pageHtml, reader, mediaFiles, seenStorageIds, warnings);
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
