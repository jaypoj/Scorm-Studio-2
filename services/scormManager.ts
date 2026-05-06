import { CourseContent, ScormProject, FileSystemDirectoryHandle, MediaItem } from '../types';

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

export class ScormManager {
  static parseProject(text: string): ScormProject {
    const parsed = JSON.parse(text) as ScormProject;
    return ScormManager.prepareForSave(parsed);
  }

  static prepareForSave(project: ScormProject): ScormProject {
    const now = new Date().toISOString();
    const courseContent: CourseContent = {
      welcomePage: { ...emptyPage('welcome', 'Welcome'), ...(project.courseContent?.welcomePage || {}) },
      learningObjectivesPage: { ...emptyPage('objectives', 'Learning Objectives'), ...(project.courseContent?.learningObjectivesPage || {}) },
      topics: project.courseContent?.topics || [],
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
        topics: project.courseData?.topics || courseContent.topics.map(t => t.title),
        customTopics: project.courseData?.customTopics || null,
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
      scormConfig: project.scormConfig || { version: '1.2', passingScore: 80, completionCriteria: 'passed' },
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
          const meta = JSON.parse(await file.text()) as MediaItem & { page_id?: string; mimeType?: string };
          const page = pages.find(p => p.id === meta.page_id);
          if (page && meta.storageId && !(page.media || []).some(m => m.storageId === meta.storageId)) {
            page.media = [...(page.media || []), { id: meta.id || meta.storageId, storageId: meta.storageId, type: meta.type, title: meta.title }];
            repairedCount += 1;
            logs.push(`Linked ${meta.storageId} to ${page.title}.`);
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
