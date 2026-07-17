import { CourseContent, ScormProject, FileSystemDirectoryHandle, MediaItem } from '../types';

const inferMediaType = (media: Partial<MediaItem> & { mimeType?: string; originalName?: string; original_name?: string; url?: string; storageId?: string; title?: string }): MediaItem['type'] => {
  const rawType = String(media.type || '').toLowerCase();
  if (rawType === 'image' || rawType === 'audio' || rawType === 'video' || rawType === 'caption') {
    return rawType as MediaItem['type'];
  }
  const mimeType = String(media.mimeType || '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  const descriptor = [media.storageId, media.originalName, media.original_name, media.url, media.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|tiff?)\b/.test(descriptor)) return 'image';
  if (/\.(mp3|wav|m4a|aac|ogg)\b/.test(descriptor)) return 'audio';
  if (/\.(mp4|webm|mov|m4v|avi|mkv)\b/.test(descriptor) || /youtube\.com\/embed|youtu\.be\//.test(descriptor)) return 'video';
  return 'image';
};

const normalizeMediaItem = (media: any): MediaItem | null => {
  if (!media) return null;
  const storageId = String(media.storageId || media.id || '').trim();
  const url = typeof media.url === 'string' ? media.url : '';
  if (!storageId && !url) return null;
  const type = inferMediaType(media);
  return {
    id: String(media.id || storageId || `${type}-${Date.now()}`),
    storageId: storageId || `external-${type}-${Date.now()}`,
    type,
    title: media.title || media.originalName || media.original_name || storageId || url || `${type} asset`,
    url,
    content: media.content,
    candidate: Boolean(media.candidate),
    source: media.source,
  };
};

const dedupeMedia = (items: Array<MediaItem | null | undefined>): MediaItem[] => {
  const seen = new Set<string>();
  const normalized: MediaItem[] = [];
  for (const item of items) {
    if (!item) continue;
    const key = `${item.storageId}||${item.url || ''}||${item.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized;
};

const normalizePageMedia = (page: any, legacyProjectMedia: any[]): MediaItem[] => {
  const pageId = page?.id;
  const directMedia = Array.isArray(page?.media) ? page.media : [];
  const legacyLinkedMedia = legacyProjectMedia.filter(item => {
    const linkedPageId = item?.page_id || item?.pageId || item?.page;
    return pageId && linkedPageId === pageId;
  });
  return dedupeMedia([...directMedia, ...legacyLinkedMedia].map(normalizeMediaItem));
};

const emptyPage = (id: string, title: string) => ({
  id,
  title,
  content: '',
  narration: '',
  duration: 1,
  imageKeywords: [],
  imagePrompts: [],
  media: [],
});

const normalizeOutputTheme = (value: unknown): ScormProject['scormConfig']['outputTheme'] => {
  return value === 'legacy-green' || value === 'light-purple' || value === 'dark-violet'
    ? value
    : 'dark-violet';
};

export class ScormManager {
  static createBlankTopic(id: string, title: string) {
    return {
      id,
      title,
      content: `<h2>${title}</h2><p>Add lesson content here.</p>`,
      narration: '',
      duration: 5,
      imageKeywords: [title],
      imagePrompts: [`Professional training image representing ${title}`],
      videoSearchTerms: [`${title} training`],
      media: [],
      knowledgeCheck: {
        questions: [
          {
            id: `kc-${id}`,
            type: 'multiple-choice' as const,
            question: `Which statement best supports ${title}?`,
            options: ['Add correct option', 'Add distractor option', 'Add distractor option', 'Add distractor option'],
            correctAnswer: 'Add correct option',
            feedback: {
              correct: 'Correct. This concept supports the lesson objective.',
              incorrect: 'Review the page content and try again.'
            }
          }
        ]
      }
    };
  }

  static createProject(courseName: string, topics: string[] = [], difficulty = 3, generatedContent?: CourseContent): ScormProject {
    const now = new Date().toISOString();
    const courseContent: CourseContent = generatedContent || {
      welcomePage: {
        ...emptyPage('welcome', `Welcome to ${courseName}`),
        content: `<h2>Course Introduction</h2><p>Welcome to ${courseName}. Use this page to introduce the course purpose, audience, and expected outcomes.</p>`,
        narration: `Welcome to ${courseName}. This course introduces the key concepts, skills, and decisions learners will practice throughout the lessons.`,
        imageKeywords: [courseName],
        imagePrompts: [`Professional training image for ${courseName}`],
      },
      learningObjectivesPage: {
        ...emptyPage('learning-objectives', 'Learning Objectives'),
        content: `<h2>Learning Objectives</h2><ul>${(topics.length ? topics : ['Describe the core concepts', 'Apply the workflow', 'Check understanding']).map(topic => `<li>${topic}</li>`).join('')}</ul>`,
        narration: `By the end of this course, learners will be able to describe the major concepts, apply the recommended workflow, and confirm understanding through practice and assessment.`,
        imageKeywords: ['learning objectives', courseName],
        imagePrompts: [`Professional training image showing learning objectives for ${courseName}`],
      },
      topics: topics.map((topic, index) => ScormManager.createBlankTopic(`topic-${index}`, topic)),
      assessment: {
        narration: null,
        passMark: 80,
        questions: []
      },
      lastModified: now,
    };

    return ScormManager.prepareForSave({
      project: {
        id: `project-${Date.now()}`,
        name: courseName,
        created: now,
        lastModified: now,
        path: '',
      },
      courseData: {
        title: courseName,
        difficulty,
        template: 'default',
        topics,
        customTopics: topics,
      },
      courseContent,
      jsonImportData: {
        isLocked: false,
        isTreeVisible: true,
        rawJson: JSON.stringify(courseContent),
        validationResult: { data: courseContent, isValid: true, summary: 'Created by SCORM Architect.' },
      },
      aiPrompt: null,
      media: { images: [], videos: [], audio: [] },
      scormConfig: {
        version: '1.2',
        passingScore: 80,
        completionCriteria: 'passed',
        requireKnowledgeCheckBeforeContinue: false,
        requireAudioCompletionBeforeContinue: false,
        outputTheme: 'dark-violet',
        contentMode: 'standard',
      },
    });
  }

  static parseProject(text: string): ScormProject {
    const parsed = JSON.parse(text) as ScormProject;
    return ScormManager.prepareForSave(parsed);
  }

  static prepareForSave(project: ScormProject): ScormProject {
    const now = new Date().toISOString();
    const legacyProjectMedia = [
      ...(project.media?.images || []),
      ...(project.media?.videos || []),
      ...(project.media?.audio || []),
    ];
    const courseContent: CourseContent = {
      welcomePage: {
        ...emptyPage('welcome', 'Welcome'),
        ...(project.courseContent?.welcomePage || {}),
        media: normalizePageMedia(project.courseContent?.welcomePage, legacyProjectMedia),
      },
      learningObjectivesPage: {
        ...emptyPage('objectives', 'Learning Objectives'),
        ...(project.courseContent?.learningObjectivesPage || {}),
        media: normalizePageMedia(project.courseContent?.learningObjectivesPage, legacyProjectMedia),
      },
      topics: (project.courseContent?.topics || []).map(topic => ({
        ...topic,
        media: normalizePageMedia(topic, legacyProjectMedia),
      })),
      assessment: project.courseContent?.assessment || { narration: null, passMark: 80, questions: [] },
      lastModified: now,
    };

    const normalized: ScormProject = {
      ...project,
      project: {
        id: project.project?.id || `project-${Date.now()}`,
        name: project.project?.name || project.courseData?.title || 'Untitled SCORM Project',
        created: project.project?.created || now,
        lastModified: now,
        path: project.project?.path || '',
      },
      courseData: {
        title: project.courseData?.title || project.project?.name || 'Untitled Course',
        difficulty: project.courseData?.difficulty || 1,
        template: project.courseData?.template || 'default',
        topics: courseContent.topics.map(t => t.title),
        customTopics: project.courseData?.customTopics ? courseContent.topics.map(t => t.title) : null,
      },
      courseContent,
      jsonImportData: project.jsonImportData || {
        isLocked: false,
        isTreeVisible: true,
        rawJson: '',
        validationResult: { data: courseContent, isValid: true, summary: 'Normalized by SCORM Architect.' },
      },
      aiPrompt: project.aiPrompt || null,
      media: project.media || { images: [], videos: [], audio: [] },
      scormConfig: {
        version: project.scormConfig?.version || '1.2',
        passingScore: project.scormConfig?.passingScore || 80,
        completionCriteria: project.scormConfig?.completionCriteria || 'passed',
        requireKnowledgeCheckBeforeContinue: Boolean(project.scormConfig?.requireKnowledgeCheckBeforeContinue),
        requireAudioCompletionBeforeContinue: Boolean(project.scormConfig?.requireAudioCompletionBeforeContinue),
        outputTheme: normalizeOutputTheme(project.scormConfig?.outputTheme),
        contentMode: project.scormConfig?.contentMode || 'standard',
      },
    };

    normalized.jsonImportData.validationResult.data = courseContent;
    normalized.jsonImportData.validationResult.isValid = true;
    normalized.jsonImportData.rawJson = JSON.stringify(courseContent);
    return normalized;
  }

  static generateStorageId(type: string): string {
    return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  static downloadProject(project: ScormProject) {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.project.name.replace(/\s+/g, '_')}.scormproj`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  static async repairProjectFromAssets(project: ScormProject, assetsHandle: FileSystemDirectoryHandle): Promise<{ project: ScormProject; repairedCount: number; logs: string[] }> {
    const logs: string[] = [];
    let repairedCount = 0;
    const next = ScormManager.prepareForSave(project);
    const pages = [next.courseContent.welcomePage, next.courseContent.learningObjectivesPage, ...next.courseContent.topics];

    try {
      // @ts-ignore browser File System Access API async iterator
      for await (const entry of assetsHandle.values()) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
        try {
          const file = await (entry as any).getFile();
          const meta = JSON.parse(await file.text()) as MediaItem & {
            page_id?: string;
            project_id?: string;
            mimeType?: string;
            originalName?: string;
            original_name?: string;
          };
          if (meta.project_id && meta.project_id !== next.project.id) {
            logs.push(`Skipped ${entry.name}: belongs to a different project.`);
            continue;
          }
          const page = pages.find(p => p.id === meta.page_id);
          const storageId = meta.storageId || meta.id;
          const type = inferMediaType({ ...meta, storageId });
          const title = meta.title || meta.originalName || meta.original_name || storageId;
          if (page && storageId && !(page.media || []).some(m => m.storageId === storageId)) {
            page.media = [...(page.media || []), {
              id: meta.id || storageId,
              storageId,
              type,
              title,
              url: meta.url || '',
              candidate: Boolean((meta as any).candidate),
              source: (meta as any).source,
            }];
            repairedCount += 1;
            logs.push(`Linked ${storageId} to ${page.title}.`);
          }
        } catch (error) {
          logs.push(`Skipped malformed asset metadata ${entry.name}.`);
        }
      }
    } catch (error) {
      logs.push('Asset scan was not available in this browser context.');
    }

    return { project: next, repairedCount, logs };
  }
}
