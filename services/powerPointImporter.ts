import JSZip from 'jszip';
import { CourseContent, MediaItem, Topic } from '../types';

export interface ImportedPowerPointMedia {
  file: File;
  storageId: string;
}

export interface ImportedPowerPointCourse {
  courseContent: CourseContent;
  topics: string[];
  mediaFiles: ImportedPowerPointMedia[];
  warnings: string[];
}

const slidePathPattern = /^ppt\/slides\/slide(\d+)\.xml$/;

const getExtension = (value: string) => value.split('.').pop()?.toLowerCase() || 'bin';

const contentTypeForExtension = (extension: string) => {
  switch (extension) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    case 'mp3': return 'audio/mpeg';
    case 'm4a': return 'audio/mp4';
    case 'wav': return 'audio/wav';
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'vtt': return 'text/vtt';
    default: return 'application/octet-stream';
  }
};

const stripXml = (value: string) => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const decodeTextRuns = (value: string) => Array.from(value.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
  .map(match => stripXml(match[1] || ''))
  .filter(Boolean)
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

const escapeHtml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]!));

const resolveTargetPath = (fromPath: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1);
  const baseParts = fromPath.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join('/');
};

const parseRelationships = async (zip: JSZip, relsPath: string) => {
  const xml = await zip.file(relsPath)?.async('string');
  if (!xml) return new Map<string, { type: string; target: string }>();
  const relationships = new Map<string, { type: string; target: string }>();
  for (const match of xml.matchAll(/<Relationship\b([^>]+?)\/>/g)) {
    const attrs = match[1] || '';
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const type = attrs.match(/\bType="([^"]+)"/)?.[1] || '';
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1] || '';
    if (id && target) relationships.set(id, { type, target });
  }
  return relationships;
};

const extractTextBlocks = (slideXml: string) => Array.from(slideXml.matchAll(/<p:txBody[\s\S]*?<\/p:txBody>/g))
  .map(match => {
    const body = match[0];
    const paragraphs = Array.from(body.matchAll(/<a:p[\s\S]*?<\/a:p>/g))
      .map(paragraph => ({
        text: decodeTextRuns(paragraph[0]),
        isBullet: /<a:bu(?:Char|AutoNum|Blip)\b/.test(paragraph[0]),
      }))
      .filter(paragraph => paragraph.text);
    return paragraphs;
  })
  .filter(block => block.length > 0);

const extractTables = (slideXml: string) => Array.from(slideXml.matchAll(/<a:tbl[\s\S]*?<\/a:tbl>/g))
  .map(match => {
    const rows = Array.from(match[0].matchAll(/<a:tr[\s\S]*?<\/a:tr>/g))
      .map(row => Array.from(row[0].matchAll(/<a:tc[\s\S]*?<\/a:tc>/g)).map(cell => decodeTextRuns(cell[0])).filter(Boolean))
      .filter(row => row.length > 0);
    if (!rows.length) return '';
    const [header, ...bodyRows] = rows;
    return `<table><thead><tr>${header.map(cell => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${bodyRows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  })
  .filter(Boolean);

const renderParagraphs = (paragraphs: { text: string; isBullet: boolean }[]) => {
  const html: string[] = [];
  let listItems: string[] = [];
  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const paragraph of paragraphs) {
    if (paragraph.isBullet) {
      listItems.push(paragraph.text);
    } else {
      flushList();
      html.push(`<p>${escapeHtml(paragraph.text)}</p>`);
    }
  }
  flushList();
  return html.join('');
};

const buildAssessmentQuestions = (topics: Topic[]) => {
  const sourceTopics = topics.length ? topics : [{
    title: 'Course overview',
  } as Topic];
  return Array.from({ length: 10 }, (_, index) => {
    const topic = sourceTopics[index % sourceTopics.length];
    return {
      id: `ppt-assessment-${index}`,
      type: 'multiple-choice' as const,
      question: 'Which topic was covered in this course?',
      options: [topic.title, 'Unrelated policy', 'Unrelated equipment', 'Unrelated software'],
      correctAnswer: topic.title,
      feedback: {
        correct: 'Correct.',
        incorrect: 'Review the course pages and try again.',
      },
    };
  });
};

const getSlideRelsPath = (slidePath: string) => {
  const name = slidePath.split('/').pop() || '';
  return `ppt/slides/_rels/${name}.rels`;
};

const extractSlideMedia = async (zip: JSZip, slideXml: string, slidePath: string, slideIndex: number) => {
  const mediaItems: MediaItem[] = [];
  const mediaFiles: ImportedPowerPointMedia[] = [];
  let caption = '';
  const relationships = await parseRelationships(zip, getSlideRelsPath(slidePath));
  const relIds = Array.from(new Set(Array.from(slideXml.matchAll(/r:(?:embed|link)="([^"]+)"/g)).map(match => match[1])));

  let imageCount = 0;
  let audioCount = 0;
  let videoCount = 0;

  for (const relId of relIds) {
    const rel = relationships.get(relId);
    if (!rel) continue;
    const targetPath = resolveTargetPath(slidePath, rel.target);
    const zipFile = zip.file(targetPath);
    if (!zipFile) continue;
    const extension = getExtension(targetPath);
    const isImage = rel.type.includes('/image') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension);
    const isAudio = rel.type.includes('/audio') || ['mp3', 'm4a', 'wav'].includes(extension);
    const isVideo = rel.type.includes('/video') || ['mp4', 'webm'].includes(extension);
    const isCaption = extension === 'vtt';
    if (isCaption) {
      caption = await zipFile.async('string');
      continue;
    }
    if (!isImage && !isAudio && !isVideo) continue;

    const count = isImage ? imageCount++ : isAudio ? audioCount++ : videoCount++;
    const kind = isImage ? 'image' : isAudio ? 'audio' : 'video';
    const storageId = `slide-${slideIndex + 1}-${kind}-${count + 1}`;
    const fileName = `${storageId}.${extension}`;
    const blob = await zipFile.async('blob');
    const file = new File([blob], fileName, { type: contentTypeForExtension(extension) });

    mediaFiles.push({ file, storageId });
    mediaItems.push({
      id: `${kind}-${storageId}`,
      storageId,
      type: kind,
      title: `Slide ${slideIndex + 1} ${kind}`,
    });
  }

  return { mediaItems, mediaFiles, caption };
};

const extractNotes = async (zip: JSZip, slidePath: string) => {
  const rels = await parseRelationships(zip, getSlideRelsPath(slidePath));
  const notesRel = Array.from(rels.values()).find(rel => rel.type.includes('/notesSlide'));
  if (!notesRel) return '';
  const notesPath = resolveTargetPath(slidePath, notesRel.target);
  const notesXml = await zip.file(notesPath)?.async('string');
  if (!notesXml) return '';
  return extractTextBlocks(notesXml)
    .flat()
    .map(paragraph => paragraph.text)
    .filter(text => text && !/^slide\s+\d+$/i.test(text))
    .join(' ')
    .trim();
};

export async function importPowerPointCourse(file: File, courseTitle: string): Promise<ImportedPowerPointCourse> {
  if (file.name.toLowerCase().endsWith('.ppt') && !file.name.toLowerCase().endsWith('.pptx')) {
    throw new Error('Legacy .ppt files are not supported yet. Please save/export the file as .pptx and import again.');
  }

  const zip = await JSZip.loadAsync(file);
  const slidePaths = Object.keys(zip.files)
    .filter(path => slidePathPattern.test(path))
    .sort((a, b) => Number(a.match(slidePathPattern)?.[1] || 0) - Number(b.match(slidePathPattern)?.[1] || 0));

  if (!slidePaths.length) throw new Error('No PowerPoint slides were found in this .pptx file.');

  const mediaFiles: ImportedPowerPointMedia[] = [];
  const warnings: string[] = [];
  const topics: Topic[] = [];

  for (const [index, slidePath] of slidePaths.entries()) {
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) continue;
    const blocks = extractTextBlocks(slideXml);
    const flattened = blocks.flat();
    const title = flattened[0]?.text || `Slide ${index + 1}`;
    const bodyParagraphs = flattened.slice(1);
    const tableHtml = extractTables(slideXml).join('');
    const content = `<h2>${escapeHtml(title)}</h2>${renderParagraphs(bodyParagraphs)}${tableHtml || ''}`;
    const notes = await extractNotes(zip, slidePath);
    const slideMedia = await extractSlideMedia(zip, slideXml, slidePath, index);
    mediaFiles.push(...slideMedia.mediaFiles);

    topics.push({
      id: `topic-${index}`,
      title,
      content,
      narration: notes || bodyParagraphs.map(paragraph => paragraph.text).join(' ').slice(0, 900) || `Review the key information from ${title}.`,
      duration: 3,
      imageKeywords: [title],
      imagePrompts: [`Professional training visual for ${title}`],
      videoSearchTerms: [title],
      caption: slideMedia.caption || undefined,
      media: slideMedia.mediaItems,
      knowledgeCheck: {
        questions: [{
          id: `ppt-kc-${index}`,
          type: 'multiple-choice',
          question: `What is the main focus of "${title}"?`,
          options: [title, 'Course navigation', 'Final assessment scoring', 'Software installation'],
          correctAnswer: title,
          feedback: {
            correct: 'Correct. This slide focuses on that topic.',
            incorrect: 'Review the slide content and try again.',
          },
        }],
      },
    });
  }

  if (!mediaFiles.length) warnings.push('No embedded slide media was found. Slide text was still imported.');

  const firstTopic = topics[0]?.title || courseTitle;
  const courseContent: CourseContent = {
    welcomePage: {
      id: 'welcome',
      title: `Welcome to ${courseTitle}`,
      content: `<h2>Course Introduction</h2><p>This course was imported from the PowerPoint file <strong>${escapeHtml(file.name)}</strong>.</p><p>The original slides have been converted into editable course pages.</p>`,
      narration: `Welcome to ${courseTitle}. This course was imported from a PowerPoint deck and converted into editable SCORM course pages.`,
      duration: 2,
      imageKeywords: [courseTitle],
      imagePrompts: [`Professional training course introduction for ${courseTitle}`],
      media: [],
    },
    learningObjectivesPage: {
      id: 'learning-objectives',
      title: 'Learning Objectives',
      content: `<h2>Learning Objectives</h2><ul>${topics.slice(0, 8).map(topic => `<li>Explain ${escapeHtml(topic.title)}.</li>`).join('')}</ul>`,
      narration: `By the end of this course, learners will be able to explain the major topics covered in the imported slide deck, starting with ${firstTopic}.`,
      duration: 2,
      imageKeywords: ['learning objectives', courseTitle],
      imagePrompts: [`Professional training objectives visual for ${courseTitle}`],
      media: [],
    },
    topics,
    assessment: {
      narration: null,
      passMark: 80,
      questions: buildAssessmentQuestions(topics),
    },
    lastModified: new Date().toISOString(),
  };

  return {
    courseContent,
    topics: topics.map(topic => topic.title),
    mediaFiles,
    warnings,
  };
}
