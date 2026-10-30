import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopicEditor } from './components/TopicEditor';
import { CoursePreviewModal } from './components/CoursePreviewModal';
import { AssessmentEditor } from './components/AssessmentEditor';
import { AIGeneratorModal } from './components/AIGeneratorModal';
import { SettingsModal } from './components/SettingsModal';
import { PasswordGate } from './components/PasswordGate';
import { NewCourseModal, NewCourseRequest } from './components/NewCourseModal';
import { ErrorDiagnosticsModal } from './components/ErrorDiagnosticsModal';
import { ScormManager } from './services/scormManager';
import { ScormPackager } from './services/scormPackager';
import { formatGeminiErrorForUser, generateCourseContent, transcribeAudioToVTT } from './services/geminiService';
import { buildTtsDiagnosticReport, formatTtsErrorForUser, generateNarrationAudio, getTtsErrorDetails, isTtsQuotaError } from './services/ttsService';
import { importPowerPointCourse } from './services/powerPointImporter';
import { importLegacyScormFromFolder, importLegacyScormFromZip } from './services/legacyScormImporter';
import { BinaryDecoder } from './services/binaryDecoder';
import { formatGeminiQuotaGuidance, parseGeminiQuotaError, recordGeminiQuotaEvent } from './services/geminiQuota';
import { ScormProject, ViewState, Topic, ProjectContext, FileSystemDirectoryHandle, FileSystemFileHandle, AISettings, WelcomePage, LearningObjectivesPage, DiscoveredProject, PronunciationConfig, MediaItem, BatchJobType, BatchProgressItem, BatchPageStatus, ImportedProjectMediaFile } from './types';
import { Loader2, PlusCircle, AlertTriangle, FolderOpen, Download, ShieldCheck, ChevronRight, FilePlus2, FileArchive, History, Trash2, ArrowUp, ArrowDown, GripVertical, Settings, Eye } from 'lucide-react';
import { DEFAULT_GEMINI_MODEL, DEFAULT_TTS_SETTINGS, OPENAI_TTS_VOICES } from './constants';
import { createVirtualFileSystem } from './utils/virtualFileSystem';
import { checkMediaFolderForProject, resolveSelectedMediaFolder } from './services/mediaFolderAccess';
import { buildVttFromNarration, estimateNarrationDurationSeconds, readAudioDurationSeconds } from './utils/captions';
import { PdfCourseEditor } from './features/pdfCourse/PdfCourseEditor';
import { createPdfCourseProject, openPdfCourseProject } from './features/pdfCourse/pdfProjectZip';
import { PdfCourseProject, PdfCourseWorkflowMode } from './features/pdfCourse/types';

const App: React.FC = () => {
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [availableProjects, setAvailableProjects] = useState<DiscoveredProject[]>([]);
  const [rootEnvironment, setRootEnvironment] = useState<{rootHandle: FileSystemDirectoryHandle, isSandbox: boolean} | null>(null);
  const [view, setView] = useState<ViewState>('welcome');
  const [isAIMode, setIsAIMode] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isNewCourseOpen, setIsNewCourseOpen] = useState(false);
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [newCourseError, setNewCourseError] = useState<string | null>(null);
  const [newCourseStatus, setNewCourseStatus] = useState<string | null>(null);
  const [newCourseProgress, setNewCourseProgress] = useState<number | null>(null);
  const [isAddingTopic, setIsAddingTopic] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [topicDragState, setTopicDragState] = useState<{
    draggedId: string | null;
    overId: string | null;
    position: 'before' | 'after' | null;
  }>({ draggedId: null, overId: null, position: null });
  const [lastAutoSaveAt, setLastAutoSaveAt] = useState<string | null>(null);
  const [restorePointCount, setRestorePointCount] = useState(0);
  const [pronunciationConfig, setPronunciationConfig] = useState<PronunciationConfig>({ tts: DEFAULT_TTS_SETTINGS, pronunciations: [] });
  const [batchJob, setBatchJob] = useState<BatchJobType>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgressItem[]>([]);
  const [ttsDiagnosticReport, setTtsDiagnosticReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pdfCourseProject, setPdfCourseProject] = useState<PdfCourseProject | null>(null);
  const [isSiteUnlocked, setIsSiteUnlocked] = useState(() => sessionStorage.getItem('scorm_studio_unlocked') === 'true');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfCreateInputRef = useRef<HTMLInputElement>(null);
  const pdfBatchCreateInputRef = useRef<HTMLInputElement>(null);
  const pdfOpenInputRef = useRef<HTMLInputElement>(null);
  
  // Integrity Scan State
  const [isScanning, setIsScanning] = useState(false);
  const [mediaWritePermission, setMediaWritePermission] = useState<'granted' | 'prompt' | 'denied' | 'unknown'>('unknown');
  const [scanResult, setScanResult] = useState<{ count: number, logs: string[] } | null>(null);

  // API settings are shared across courses in the same browser profile.
  // Restricted work browsers may block storage; an invalid/blocked entry must
  // not prevent the course builder from opening.
  const [aiSettings, setAiSettings] = useState<AISettings>(() => {
    let parsed: Partial<AISettings> = { model: DEFAULT_GEMINI_MODEL };
    try {
      const saved = localStorage.getItem('scorm_ai_settings');
      if (saved) {
        const restored = JSON.parse(saved);
        if (restored && typeof restored === 'object' && !Array.isArray(restored)) parsed = restored;
      }
    } catch {
      console.warn('Could not restore browser AI settings; check site storage permissions.');
    }
    return {
      allowBundledGeminiFallback: false,
      regenerateExistingAudio: false,
      ...parsed,
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : DEFAULT_GEMINI_MODEL,
    };
  });

  const saveAiSettings = (s: AISettings) => {
    const normalized = {
      allowBundledGeminiFallback: false,
      regenerateExistingAudio: false,
      ...s,
    };
    // Verify persistence before updating the UI or closing the settings dialog.
    // Never show a successful save when this browser rejected local storage.
    try {
      const serialized = JSON.stringify(normalized);
      localStorage.setItem('scorm_ai_settings', serialized);
      if (localStorage.getItem('scorm_ai_settings') !== serialized) {
        throw new Error('Saved settings could not be read back.');
      }
    } catch {
      throw new Error('This browser could not save AI Settings. Check whether site data is blocked or private browsing is enabled, then try again.');
    }
    setAiSettings(normalized);
  };

  const lockSite = () => {
    sessionStorage.removeItem('scorm_studio_unlocked');
    setIsSiteUnlocked(false);
  };

  // The File System Access API does not persist read/write grants across devices
  // (and browsers can revoke them within a session). Query only; a user click is
  // required to request permission again.
  useEffect(() => {
    let active = true;
    setMediaWritePermission('unknown');
    const handle = context?.assetsHandle as (FileSystemDirectoryHandle & {
      queryPermission?: (options: { mode: 'readwrite' }) => Promise<'granted' | 'prompt' | 'denied'>;
    }) | null;
    if (!handle?.queryPermission || context?.isSandbox) return;
    handle.queryPermission({ mode: 'readwrite' }).then(result => {
      if (active) setMediaWritePermission(result);
    }).catch(() => {
      if (active) setMediaWritePermission('unknown');
    });
    return () => { active = false; };
  }, [context?.assetsHandle, context?.isSandbox]);

  // INTEGRITY SCANNER EFFECT
  // Runs whenever context changes, specifically looking for a new project load
  useEffect(() => {
    if (context && context.projectData && context.assetsHandle && !isScanning && !scanResult) {
        const runScan = async () => {
            setIsScanning(true);
            try {
                // Perform the global repair
                const { project, repairedCount, logs } = await ScormManager.repairProjectFromAssets(
                    context.projectData, 
                    context.assetsHandle!
                );
                
                if (repairedCount > 0) {
                    // Never overwrite edits (including media removal) made while the scan ran.
                    setContext(prev => prev?.projectData === context.projectData && prev.assetsHandle === context.assetsHandle
                      ? { ...prev, projectData: project }
                      : prev);
                }
                
                setScanResult({ count: repairedCount, logs });
                console.log("Global Integrity Scan Complete", logs);
            } catch (e) {
                console.error("Scan failed", e);
            } finally {
                setIsScanning(false);
            }
        };
        runScan();
    }
  }, [context?.projectData?.project?.id, context?.assetsHandle]); // Scan again if a missing media folder is reconnected.

  useEffect(() => {
    if (!context?.projectHandle || context.isSandbox || isScanning) return;
    const timeout = window.setTimeout(async () => {
      try {
        const finalProject = ScormManager.prepareForSave(context.projectData);
        await writeTextFile(context.projectHandle!, JSON.stringify(finalProject, null, 2));
        await createRestorePoint(context, finalProject, 'autosave');
        setLastAutoSaveAt(new Date().toLocaleTimeString());
      } catch (autoSaveError) {
        console.warn('Autosave failed.', autoSaveError);
      }
    }, 8000);

    return () => window.clearTimeout(timeout);
  }, [context?.projectData, context?.projectHandle, context?.isSandbox, isScanning]);

  const processRootHandle = async (currentRootHandle: FileSystemDirectoryHandle, isSandbox: boolean, bypassAutoLoad = false) => {
      setScanResult(null); 
      let discovered: DiscoveredProject[] = [];
      let discoveredRestorePoints = 0;
      let foundLegacyScormPackage = false;

      const countRestoreFiles = async (dirHandle: FileSystemDirectoryHandle) => {
          let count = 0;
          try {
              // @ts-ignore browser File System Access API async iterator
              for await (const entry of dirHandle.values()) {
                  if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.scormproj')) count += 1;
              }
          } catch {}
          return count;
      };

      const scanInternal = async (dirHandle: FileSystemDirectoryHandle, depth: number) => {
         if (depth > 5) return; // Prevent excessive depth
         
         let projectFiles: { pHandle: FileSystemFileHandle, pData: ScormProject }[] = [];
         let subDirectories: FileSystemDirectoryHandle[] = [];

         // @ts-ignore
         for await (const entry of dirHandle.values()) {
             const entryName = entry.name.toLowerCase();
             const isRestoreProject = entryName.includes('_autosave_') || entryName.includes('_manual-save_') || entryName.includes('_created_');
             if (entry.kind === 'file' && entryName.endsWith('.scormproj') && !isRestoreProject) {
                const fileEntry = entry as FileSystemFileHandle;
                try {
                   const file = await fileEntry.getFile();
                   const text = await file.text();
                   const pData = ScormManager.parseProject(text);
                   projectFiles.push({ pHandle: fileEntry, pData });
               } catch (e) {
                   console.error("Failed to parse project file:", fileEntry.name, e);
               }
             } else if (entry.kind === 'file' && entryName.endsWith('.scormproj') && isRestoreProject) {
                  discoveredRestorePoints += 1;
             } else if (entry.kind === 'directory') {
                  if (entryName === '_restore_points') {
                      discoveredRestorePoints += await countRestoreFiles(entry as FileSystemDirectoryHandle);
                  } else {
                      subDirectories.push(entry as FileSystemDirectoryHandle);
                  }
                  if ((entry as FileSystemDirectoryHandle).name.toLowerCase() === 'pages') {
                      foundLegacyScormPackage = true;
                  }
             } else if (entry.kind === 'file' && entryName === 'imsmanifest.xml') {
                  foundLegacyScormPackage = true;
             }
          }

         for (const { pHandle, pData } of projectFiles) {
             let aHandle: FileSystemDirectoryHandle | null = null;
             let projectRootHandle: FileSystemDirectoryHandle | null = dirHandle;
             const projectStem = pHandle.name.replace(/\.scormproj$/i, '').toLowerCase();

             // Look for a directory literally named `projectName_assets` or exactly matching the project stem
             let matchingDir = subDirectories.find(d => {
                 const name = d.name.toLowerCase();
                 return name === `${projectStem}_assets` || name === projectStem;
             });

             if (matchingDir) {
                 projectRootHandle = matchingDir;
                 // @ts-ignore
                 for await (const subEntry of matchingDir.values()) {
                     if (subEntry.kind === 'directory') {
                         const subName = subEntry.name.toLowerCase();
                         if (subName === 'media' || subName === 'assets' || subName.endsWith('_assets')) {
                             aHandle = subEntry as FileSystemDirectoryHandle;
                             console.log("Found nested assets folder:", matchingDir.name + '/' + subEntry.name);
                             break;
                         }
                     }
                 }
                 if (!aHandle) {
                     aHandle = matchingDir;
                 }
             }

             // If not found, look for generic 'media' or 'assets' in the current directory if it's the only project
             if (!aHandle && projectFiles.length === 1) {
                 aHandle = subDirectories.find(d => {
                     const n = d.name.toLowerCase();
                     return n === 'media' || n === 'assets' || n.endsWith('_assets');
                 }) || null;
             }

             // Opening a project should never create a fresh empty media folder.
             // If no assets folder is found, keep the project read-only for media until the user selects the correct folder.

              const alreadyDiscovered = await Promise.all(discovered.map(item => item.projectHandle.isSameEntry?.(pHandle)));
              if (!alreadyDiscovered.some(Boolean)) {
                  discovered.push({ projectHandle: pHandle, projectData: pData, assetsHandle: aHandle, projectRootHandle });
              }
         }

         // Look directly into subdirectories to find independent projects
         for (const subDir of subDirectories) {
              await scanInternal(subDir, depth + 1);
         }
      };

      await scanInternal(currentRootHandle, 0);

      setRootEnvironment({ rootHandle: currentRootHandle, isSandbox });
      setAvailableProjects(discovered);
      setRestorePointCount(discoveredRestorePoints);

      if (discovered.length === 1 && !bypassAutoLoad) {
          loadProject(discovered[0], currentRootHandle, isSandbox);
      } else {
          setContext(null); // Clear context if any
          setView('project-select');
          setError(discovered.length === 0
            ? (foundLegacyScormPackage
                ? 'A legacy SCORM package was detected in this folder. Use Create New Course -> Import Legacy SCORM to convert it into an editable project.'
                : 'No existing .scormproj files were found. You can create a new course in this folder.')
            : null);
      }
  };

  const loadProject = (proj: DiscoveredProject, rootH: FileSystemDirectoryHandle, sandbox: boolean) => {
      const projectRootHandle = proj.projectRootHandle || rootH;
      setContext({
          projectData: proj.projectData,
          projectHandle: proj.projectHandle,
          assetsHandle: proj.assetsHandle,
          rootHandle: projectRootHandle,
          isSandbox: sandbox
      });
      loadPronunciationConfig(projectRootHandle, sandbox);
      setView(isPowerPointProject(proj.projectData) && proj.projectData.courseContent.topics[0]
        ? { type: 'topic-edit', id: proj.projectData.courseContent.topics[0].id }
        : 'welcome');
      setError(null);
  };

  const handleCloseProject = async () => {
    setContext(null);
    setScanResult(null);
    if (rootEnvironment && availableProjects.length > 0) {
       setView('project-select');
       // Re-scan to catch any name changes (especially in sandbox mode), bypass autoload
       try {
           await processRootHandle(rootEnvironment.rootHandle, rootEnvironment.isSandbox, true);
       } catch (e) {
           console.error("Failed to re-scan:", e);
           setAvailableProjects([]);
           setRootEnvironment(null);
           setView('welcome');
       }
    } else {
       // Just go back to home screen
       setAvailableProjects([]);
       setRootEnvironment(null);
    }
  };

  const openFolderUpload = () => fileInputRef.current?.click();

  const handleCreatePdfCourse = async (files: File[], workflowMode: PdfCourseWorkflowMode) => {
    if (!files.length) return;
    setError(null);
    try {
      const firstName = files[0].name.replace(/\.(pdf|zip)$/i, '').replace(/[_-]+/g, ' ').trim();
      const fallbackName = workflowMode === 'batch' ? 'Batch PDF Courses' : 'PDF Compliance Course';
      const projectName = firstName
        ? `${firstName} ${workflowMode === 'batch' ? 'Batch PDF Courses' : 'PDF Course'}`
        : fallbackName;
      setPdfCourseProject(await createPdfCourseProject(files, projectName, workflowMode));
    } catch (pdfError) {
      setError(pdfError instanceof Error ? pdfError.message : String(pdfError));
    } finally {
      if (pdfCreateInputRef.current) pdfCreateInputRef.current.value = '';
      if (pdfBatchCreateInputRef.current) pdfBatchCreateInputRef.current.value = '';
    }
  };

  const handleOpenPdfCourse = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      setPdfCourseProject(await openPdfCourseProject(file));
    } catch (pdfError) {
      setError(pdfError instanceof Error ? pdfError.message : String(pdfError));
    } finally {
      if (pdfOpenInputRef.current) pdfOpenInputRef.current.value = '';
    }
  };

  // Unified opener: prefer native folder access, fall back to browser upload mode.
  const handleOpenFolder = async () => {
    setError(null);

    const canUseNativePicker = window.self === window.top && 'showDirectoryPicker' in window;
    if (!canUseNativePicker) {
      openFolderUpload();
      return;
    }

    try {
      // @ts-ignore - File System Access API
      const rootHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await processRootHandle(rootHandle, false);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (err.name === 'SecurityError' || err.message?.includes('Security')) {
        openFolderUpload();
        return;
      }
      setError(err.message || "Failed to access folder.");
    }
  };

  const sanitizeFileName = (value: string) => value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'New_Course';

  const writeTextFile = async (handle: FileSystemFileHandle, text: string) => {
    const writable = await (handle as any).createWritable({ keepExistingData: false });
    await writable.write(text);
    await writable.close();
  };

  const createRestorePoint = async (ctx: ProjectContext, project: ScormProject, reason = 'autosave') => {
    if (!ctx.rootHandle || ctx.isSandbox) return;
    try {
      const restoreDir = await ctx.rootHandle.getDirectoryHandle('_restore_points', { create: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const restoreHandle = await restoreDir.getFileHandle(`${sanitizeFileName(project.project.name)}_${reason}_${stamp}.scormproj`, { create: true });
      await writeTextFile(restoreHandle, JSON.stringify(project, null, 2));
    } catch (restoreError) {
      console.warn('Could not create restore point.', restoreError);
    }
  };

  const normalizePronunciationConfig = (value: Partial<PronunciationConfig> | null | undefined): PronunciationConfig => {
    const tts = { ...DEFAULT_TTS_SETTINGS, ...(value?.tts || {}) };
    if (!OPENAI_TTS_VOICES.includes(tts.voiceName)) tts.voiceName = DEFAULT_TTS_SETTINGS.voiceName;
    return {
      tts,
      pronunciations: Array.isArray(value?.pronunciations) ? value.pronunciations : [],
    };
  };

  const loadPronunciationConfig = async (rootHandle: FileSystemDirectoryHandle | null, sandbox: boolean) => {
    if (!rootHandle || sandbox) {
      setPronunciationConfig({ tts: DEFAULT_TTS_SETTINGS, pronunciations: [] });
      return;
    }
    try {
      const handle = await rootHandle.getFileHandle('pronunciations.json');
      const file = await handle.getFile();
      setPronunciationConfig(normalizePronunciationConfig(JSON.parse(await file.text())));
    } catch {
      const initial = { tts: DEFAULT_TTS_SETTINGS, pronunciations: [] };
      setPronunciationConfig(initial);
      try {
        const handle = await rootHandle.getFileHandle('pronunciations.json', { create: true });
        await writeTextFile(handle, JSON.stringify(initial, null, 2));
      } catch (writeError) {
        console.warn('Could not create pronunciations.json.', writeError);
      }
    }
  };

  const savePronunciationConfig = async (nextConfig: PronunciationConfig) => {
    const normalized = normalizePronunciationConfig(nextConfig);
    setPronunciationConfig(normalized);
    if (!context?.rootHandle || context.isSandbox) return;
    try {
      const handle = await context.rootHandle.getFileHandle('pronunciations.json', { create: true });
      await writeTextFile(handle, JSON.stringify(normalized, null, 2));
    } catch (error) {
      console.warn('Could not save pronunciations.json.', error);
    }
  };

  // Sandbox Opener (Input type=file)
  const handleSandboxSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.currentTarget.files;
      if (files && files.length > 0) {
          try {
            const virtualRoot = createVirtualFileSystem(files);
            processRootHandle(virtualRoot, true).catch(err => setError(err.message));
          } catch(err: any) {
              setError("Failed to load sandbox: " + err.message);
          }
      }
      e.currentTarget.value = '';
  };

  const handleCreateNewCourse = async (request: NewCourseRequest) => {
    setIsCreatingCourse(true);
    setNewCourseError(null);
    setNewCourseStatus('Preparing course workspace...');
    setNewCourseProgress(request.mode === 'powerpoint' || request.mode === 'legacy-scorm' ? 2 : null);
    try {
      // Reuse the selected workspace, not the opened course's own folder.
      // If someone opened a single course folder directly, prompt for a parent
      // instead of silently nesting new courses inside the active course.
      let rootHandle = rootEnvironment && !rootEnvironment.isSandbox
        && (!context || rootEnvironment.rootHandle !== context.rootHandle)
        ? rootEnvironment.rootHandle : null;
      if (!rootHandle) {
        if (!('showDirectoryPicker' in window) || window.self !== window.top) {
          throw new Error('Creating a new course requires direct folder access in Chrome or Edge. Open the app in a normal browser tab and try again.');
        }

        // @ts-ignore - File System Access API
        rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      }
      const courseFolderName = sanitizeFileName(request.courseName);
      // Never overwrite an existing course folder, even if names only differ in case on Windows.
      // @ts-ignore File System Access API async iterator
      for await (const entry of rootHandle.values()) {
        if (entry.kind === 'directory' && entry.name.toLowerCase() === courseFolderName.toLowerCase()) {
          throw new Error(`A folder named "${entry.name}" already exists here. Choose a different course name or open that existing course instead. No files were changed.`);
        }
      }

      const generationSettings = { ...aiSettings, model: request.model };
      setNewCourseStatus(
        request.mode === 'powerpoint'
          ? 'Reading PowerPoint slides...'
          : request.mode === 'legacy-scorm'
            ? 'Reading legacy SCORM package...'
            : request.mode === 'ai'
              ? 'Generating course with AI...'
              : 'Building starter course...'
      );
      await new Promise(resolve => setTimeout(resolve, 50));
      const importedPowerPoint = request.mode === 'powerpoint' && request.powerPointFile
        ? await importPowerPointCourse(request.powerPointFile, request.courseName, (percent, message) => {
            setNewCourseProgress(percent);
            setNewCourseStatus(message);
          })
        : null;
      const importedLegacyScorm = request.mode === 'legacy-scorm'
        ? (request.legacyScormZipFile
            ? await importLegacyScormFromZip(request.legacyScormZipFile, request.courseName, (percent, message) => {
                setNewCourseProgress(percent);
                setNewCourseStatus(message);
              })
            : await importLegacyScormFromFolder(request.legacyScormFolderFiles, request.courseName, (percent, message) => {
                setNewCourseProgress(percent);
                setNewCourseStatus(message);
              }))
        : null;
      const generatedContent = request.mode === 'ai'
        ? await generateCourseContent(generationSettings, request.courseName, request.topics, request.difficulty, request.referenceFiles, request.rateLimit)
        : importedPowerPoint?.courseContent || importedLegacyScorm?.courseContent;
      const projectTopics = importedPowerPoint?.topics || importedLegacyScorm?.topics || request.topics;
      const project = ScormManager.createProject(request.courseName, projectTopics, request.difficulty, generatedContent);
      // Do not create empty course folders when generation/import fails.
      setNewCourseStatus('Creating course folders...');
      const courseFolderHandle = await rootHandle.getDirectoryHandle(courseFolderName, { create: true });
      const assetsHandle = await courseFolderHandle.getDirectoryHandle('media', { create: true });
      await courseFolderHandle.getDirectoryHandle('_restore_points', { create: true });
      const initialPronunciationConfig = { tts: DEFAULT_TTS_SETTINGS, pronunciations: [] };
      const pronunciationHandle = await courseFolderHandle.getFileHandle('pronunciations.json', { create: true });
      await writeTextFile(pronunciationHandle, JSON.stringify(initialPronunciationConfig, null, 2));
      if (importedPowerPoint) {
        project.scormConfig.contentMode = 'ppt-import';
      }
      if (importedLegacyScorm) {
        project.scormConfig = {
          ...project.scormConfig,
          ...importedLegacyScorm.scormConfigPatch,
          contentMode: 'standard',
        };
      }

      if (importedPowerPoint) {
        setNewCourseStatus(`Copying ${importedPowerPoint.mediaFiles.length} PowerPoint media file${importedPowerPoint.mediaFiles.length === 1 ? '' : 's'}...`);
        setNewCourseProgress(92);
        await writeImportedMediaFiles(
          assetsHandle,
          project,
          importedPowerPoint.mediaFiles.map(media => ({
            ...media,
            pageId: project.courseContent.topics.find(topic => topic.media?.some(item => item.storageId === media.storageId))?.id || 'welcome',
            type: ((project.courseContent.topics.flatMap(topic => topic.media || []).find(item => item.storageId === media.storageId)?.type || 'image') as 'image' | 'audio' | 'video'),
            title: project.courseContent.topics.flatMap(topic => topic.media || []).find(item => item.storageId === media.storageId)?.title || media.storageId,
            source: 'powerpoint',
          }))
        );
        if (importedPowerPoint.warnings.length) {
          console.warn('PowerPoint import warnings:', importedPowerPoint.warnings);
        }
      }
      if (importedLegacyScorm) {
        setNewCourseStatus(`Copying ${importedLegacyScorm.mediaFiles.length} legacy media file${importedLegacyScorm.mediaFiles.length === 1 ? '' : 's'}...`);
        setNewCourseProgress(92);
        await writeImportedMediaFiles(assetsHandle, project, importedLegacyScorm.mediaFiles);
        if (importedLegacyScorm.warnings.length) {
          console.warn('Legacy SCORM import warnings:', importedLegacyScorm.warnings);
        }
      }
      setNewCourseStatus('Saving project file...');
      if (importedPowerPoint || importedLegacyScorm) setNewCourseProgress(97);
      const fileName = `${courseFolderName}.scormproj`;
      const projectHandle = await courseFolderHandle.getFileHandle(fileName, { create: true });
      await writeTextFile(projectHandle, JSON.stringify(project, null, 2));

      const nextContext: ProjectContext = {
        projectData: project,
        projectHandle,
        assetsHandle,
        rootHandle: courseFolderHandle,
        isSandbox: false
      };
      await createRestorePoint(nextContext, project, 'created');
      setRootEnvironment({ rootHandle, isSandbox: false });
      setAvailableProjects([{ projectHandle, projectData: project, assetsHandle }]);
      setContext(nextContext);
      setPronunciationConfig(initialPronunciationConfig);
      setScanResult(null);
      setView((importedPowerPoint || importedLegacyScorm) && project.courseContent.topics[0] ? { type: 'topic-edit', id: project.courseContent.topics[0].id } : 'welcome');
      setIsNewCourseOpen(false);
      setLastAutoSaveAt(new Date().toLocaleTimeString());
      setNewCourseStatus(null);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setNewCourseError(request.mode === 'ai'
          ? formatGeminiErrorForUser(err, 'Create New Course')
          : (err.message || 'Failed to create course.'));
      }
    } finally {
      setIsCreatingCourse(false);
      setNewCourseStatus(null);
      setNewCourseProgress(null);
    }
  };

  const handleSave = async () => {
    if (!context || !context.projectHandle) return;
    if (isScanning) {
        alert("Please wait for integrity scan to complete.");
        return;
    }

    try {
      const finalProject = ScormManager.prepareForSave(context.projectData);
      const jsonString = JSON.stringify(finalProject, null, 2);
      
      await writeTextFile(context.projectHandle, jsonString);
      await createRestorePoint(context, finalProject, 'manual-save');
      
      setContext({ ...context, projectData: finalProject });
      
      if (context.isSandbox) {
          // In Sandbox, we must download the file because we can't persist to disk
          ScormManager.downloadProject(finalProject);
          alert("Project saved in this browser session. Download started.");
      } else {
          alert("Project saved successfully to disk.");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to save project file.");
    }
  };

  const handleExportScorm = async () => {
    if (!context) return;
    setIsExporting(true);
    try {
      const zipBlob = await ScormPackager.createScormPackage(context.projectData, context.assetsHandle, context.rootHandle);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${context.projectData.project.name.replace(/\s+/g, '_')}_SCORM1.2.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const unresolvedImages = ScormPackager.lastImageReport?.summary.unresolved || 0;
      if (unresolvedImages > 0) {
        alert(`SCORM package exported, but ${unresolvedImages} image${unresolvedImages === 1 ? '' : 's'} could not be packaged. Open diagnostics/scorm-image-report.json inside the zip to see the exact source and file type details.`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to export SCORM package.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleLinkAssets = async () => {
    if (!context) return;
    if (context.isSandbox) {
      alert('This course was opened in browser-session mode. Close the project and use Open Project Folder in a normal Chrome or Edge tab to grant direct access. Media saved in a browser session is not included in a downloaded .scormproj file.');
      return;
    }
    if (window.self !== window.top || !('showDirectoryPicker' in window)) {
      alert("This browser cannot grant direct folder access here. Open GitHub Pages in a normal Chrome or Edge tab (not an embedded preview), or check your organization's browser policies.");
      return;
    }

    const currentProjectId = context.projectData.project.id;
    try {
      // Must be called directly from a button click; browsers require a user gesture.
      // @ts-ignore File System Access API
      const selected: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const folder = await resolveSelectedMediaFolder(selected);
      const status = await checkMediaFolderForProject(folder, context.projectData);
      if (status.expectedFileCount > 0 && status.matchedFileCount === 0) {
        if (!window.confirm(`No existing linked media files were found in "${folder.name}".\n\nThis might not be the media folder for this course. Linking a different folder will not delete anything, but images and audio may still be unavailable.\n\nUse this folder anyway?`)) return;
      } else if (!status.recognizedFolderName && status.fileCount === 0) {
        if (!window.confirm(`"${folder.name}" is empty and does not look like a media folder.\n\nUse it as this course's media folder anyway?`)) return;
      }

      setContext(prev => prev?.projectData.project.id === currentProjectId ? { ...prev, assetsHandle: folder } : prev);
      setScanResult(null);
    } catch (linkError) {
      if (linkError instanceof DOMException && linkError.name === 'AbortError') return;
      alert(`Could not connect the media folder: ${linkError instanceof Error ? linkError.message : String(linkError)}\n\nIf your employer restricts folder permissions, check with IT. No course files were changed.`);
    }
  };

  const handleAssetCreate = async (file: File, id: string) => {
    if (!context?.assetsHandle) {
      throw new Error('No media folder is linked. Use Connect Media Folder before uploading.');
    }
    try {
      const fileHandle = await context.assetsHandle.getFileHandle(file.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
    } catch (e) {
      console.error("Failed to write asset", e);
      throw e;
    }
  };

  const writeImportedMediaFiles = async (
    assetsHandle: FileSystemDirectoryHandle,
    project: ScormProject,
    mediaFiles: ImportedProjectMediaFile[]
  ) => {
    for (const media of mediaFiles) {
      const fileHandle = await assetsHandle.getFileHandle(media.file.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(media.file);
      await writable.close();

      const metadata = {
        id: media.storageId,
        storageId: media.storageId,
        project_id: project.project.id,
        page_id: media.pageId,
        type: media.type,
        title: media.title,
        originalName: media.originalName || media.file.name,
        original_name: media.originalName || media.file.name,
        mimeType: media.file.type || BinaryDecoder.getMimeTypeFromExtension(media.file.name.split('.').pop() || ''),
        extension: media.file.name.split('.').pop() || '',
        source: media.source || 'legacy-import',
        created: new Date().toISOString()
      };
      const metadataHandle = await assetsHandle.getFileHandle(`${media.storageId}.json`, { create: true });
      await writeTextFile(metadataHandle, JSON.stringify(metadata, null, 2));
    }
  };

  const updateProjectData = (updater: (prev: ScormProject) => ScormProject) => {
    if (!context) return;
    const newData = updater(context.projectData);
    setContext({ ...context, projectData: newData });
  };

  const updateTopic = (updatedPage: Topic | WelcomePage | LearningObjectivesPage) => {
    if (!context) return;
    
    // Determine what type of page we are updating based on the view or ID
    updateProjectData(prev => {
        // Welcome Page
        if (updatedPage.id === prev.courseContent.welcomePage.id) {
            return {
                ...prev,
                courseContent: { ...prev.courseContent, welcomePage: updatedPage as WelcomePage }
            };
        }
        
        // Objectives Page
        if (updatedPage.id === prev.courseContent.learningObjectivesPage.id) {
             return {
                ...prev,
                courseContent: { ...prev.courseContent, learningObjectivesPage: updatedPage as LearningObjectivesPage }
            };
        }

        // Topics
        const newTopics = prev.courseContent.topics.map(t => 
             t.id === updatedPage.id ? (updatedPage as Topic) : t
        );
        const topicTitles = newTopics.map(t => t.title);
        return {
             ...prev,
             courseData: {
                ...prev.courseData,
                topics: topicTitles,
                customTopics: prev.courseData.customTopics ? topicTitles : prev.courseData.customTopics,
             },
             courseContent: { ...prev.courseContent, topics: newTopics }
        };
      });
  };

  const deleteTopicPage = (topicId: string) => {
    if (!context) return;
    const topic = context.projectData.courseContent.topics.find(t => t.id === topicId);
    if (!topic) return;

    const confirmed = window.confirm(`Delete the entire page "${topic.title}"?\n\nThis removes the topic page, its knowledge check, narration text, captions, and media links from the course. Media files already saved in the media folder will remain on disk.`);
    if (!confirmed) return;

    updateProjectData(prev => {
      const remainingTopics = prev.courseContent.topics
        .filter(t => t.id !== topicId);

      return {
        ...prev,
        courseData: {
          ...prev.courseData,
          topics: remainingTopics.map(t => t.title),
          customTopics: prev.courseData.customTopics ? remainingTopics.map(t => t.title) : null,
        },
        courseContent: {
          ...prev.courseContent,
          topics: remainingTopics,
          lastModified: new Date().toISOString(),
        }
      };
    });

    setView('topic-list');
  };

  const getTopicIntegritySignature = (topics: Topic[]) => topics
    .map(topic => JSON.stringify(topic))
    .sort()
    .join('|');

  const reorderTopicPage = (topicId: string, targetIndex: number) => {
    if (!context) return;

    updateProjectData(prev => {
      const currentTopics = prev.courseContent.topics;
      const fromIndex = currentTopics.findIndex(topic => topic.id === topicId);
      const toIndex = Math.max(0, Math.min(targetIndex, currentTopics.length - 1));
      if (fromIndex < 0 || fromIndex === toIndex) return prev;

      const nextTopics = [...currentTopics];
      const [movedTopic] = nextTopics.splice(fromIndex, 1);
      nextTopics.splice(toIndex, 0, movedTopic);

      if (getTopicIntegritySignature(currentTopics) !== getTopicIntegritySignature(nextTopics)) {
        console.warn('Topic move was cancelled because page integrity changed unexpectedly.');
        return prev;
      }

      const topicTitles = nextTopics.map(topic => topic.title);
      return {
        ...prev,
        courseData: {
          ...prev.courseData,
          topics: topicTitles,
          customTopics: prev.courseData.customTopics ? topicTitles : prev.courseData.customTopics,
        },
        courseContent: {
          ...prev.courseContent,
          topics: nextTopics,
          lastModified: new Date().toISOString(),
        },
      };
    });
  };

  const moveTopicPage = (topicId: string, direction: -1 | 1) => {
    if (!context) return;
    const fromIndex = context.projectData.courseContent.topics.findIndex(topic => topic.id === topicId);
    if (fromIndex < 0) return;
    reorderTopicPage(topicId, fromIndex + direction);
  };

  const getDragTargetIndex = (
    topics: Topic[],
    draggedTopicId: string,
    targetTopicId: string,
    position: 'before' | 'after'
  ) => {
    const fromIndex = topics.findIndex(topic => topic.id === draggedTopicId);
    const targetIndex = topics.findIndex(topic => topic.id === targetTopicId);
    if (fromIndex < 0 || targetIndex < 0 || draggedTopicId === targetTopicId) return null;
    if (position === 'before') return targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
    return targetIndex < fromIndex ? targetIndex + 1 : targetIndex;
  };

  const resetTopicDragState = () => {
    setTopicDragState({ draggedId: null, overId: null, position: null });
  };

  const isPowerPointProject = (project: ScormProject) => project.scormConfig?.contentMode === 'ppt-import';

  const getEditablePages = (project: ScormProject) => isPowerPointProject(project)
    ? [...project.courseContent.topics]
    : [
        project.courseContent.welcomePage,
        project.courseContent.learningObjectivesPage,
        ...project.courseContent.topics,
      ];

  const isNarrationAudioMedia = (media: MediaItem) => media.type === 'audio' && !media.candidate && media.source !== 'powerpoint';

  const buildBatchProgress = (pages: Array<Topic | WelcomePage | LearningObjectivesPage>): BatchProgressItem[] => pages.map(page => {
    const hasAudio = (page.media || []).some(isNarrationAudioMedia);
    return {
      pageId: page.id,
      title: page.title,
      audioStatus: hasAudio && !aiSettings.regenerateExistingAudio ? 'done' : 'pending',
      captionStatus: page.caption ? 'done' : 'pending',
      message: hasAudio && !aiSettings.regenerateExistingAudio ? 'Existing narration audio preserved.' : undefined,
    };
  });

  const updateBatchProgressItem = (pageId: string, patch: Partial<Pick<BatchProgressItem, 'audioStatus' | 'captionStatus' | 'message'>>) => {
    setBatchProgress(prev => prev.map(item => item.pageId === pageId ? { ...item, ...patch } : item));
  };

  const updateBatchProgressDetails = (pageId: string, patch: Partial<BatchProgressItem>) => {
    setBatchProgress(prev => prev.map(item => item.pageId === pageId ? { ...item, ...patch } : item));
  };

  const replacePagesInProject = (
    project: ScormProject,
    pagesById: Map<string, Topic | WelcomePage | LearningObjectivesPage>
  ): ScormProject => ({
    ...project,
    courseContent: {
      ...project.courseContent,
      welcomePage: (pagesById.get(project.courseContent.welcomePage.id) as WelcomePage) || project.courseContent.welcomePage,
      learningObjectivesPage: (pagesById.get(project.courseContent.learningObjectivesPage.id) as LearningObjectivesPage) || project.courseContent.learningObjectivesPage,
      topics: project.courseContent.topics.map(topic => (pagesById.get(topic.id) as Topic) || topic),
    }
  });

  const createAudioAssetForPage = async (page: Topic | WelcomePage | LearningObjectivesPage): Promise<Topic | WelcomePage | LearningObjectivesPage> => {
    if (!page.narration?.trim()) return page;
    const audioBlob = await generateNarrationAudio(aiSettings, page.narration, pronunciationConfig.tts, pronunciationConfig.pronunciations);
    const storageId = ScormManager.generateStorageId('audio');
    const file = new File([audioBlob], `${storageId}.wav`, { type: 'audio/wav' });
    await handleAssetCreate(file, storageId);

      const metadata = {
        id: storageId,
        storageId,
        project_id: context.projectData.project.id,
        page_id: page.id,
      type: 'audio',
      title: `Narration: ${page.title}`,
      originalName: `${storageId}.wav`,
      original_name: `${storageId}.wav`,
      mimeType: 'audio/wav',
      extension: 'wav',
      source: 'azure-openai-tts',
      created: new Date().toISOString()
    };
    await handleAssetCreate(new File([JSON.stringify(metadata, null, 2)], `${storageId}.json`, { type: 'application/json' }), storageId);

    const newMedia: MediaItem = {
      id: `media-${Date.now()}-${storageId}`,
      storageId,
      type: 'audio',
      title: `Narration: ${page.title}`,
      url: '',
      source: 'azure-openai-tts'
    };
    return { ...page, media: [...(page.media || []).filter(media => !isNarrationAudioMedia(media)), newMedia] };
  };

  const findAssetFile = async (storageId: string) => {
    if (!context?.assetsHandle) return null;
    const lowerId = storageId.toLowerCase();
    // @ts-ignore
    for await (const entry of context.assetsHandle.values()) {
      if (entry.kind !== 'file') continue;
      const name = entry.name.toLowerCase();
      if (name === lowerId || name.startsWith(`${lowerId}.`)) return entry as FileSystemFileHandle;
    }
    return null;
  };

  const findAssetMetadata = async (storageId: string) => {
    if (!context?.assetsHandle) return null;
    try {
      const handle = await context.assetsHandle.getFileHandle(`${storageId}.json`);
      return JSON.parse(await (await handle.getFile()).text());
    } catch {
      return null;
    }
  };

  const handleBatchGenerateTts = async () => {
    if (!context?.assetsHandle) return;
    const pages = getEditablePages(context.projectData);
    setBatchJob('tts');
    setBatchProgress(buildBatchProgress(pages));
    try {
      const pagesById = new Map<string, Topic | WelcomePage | LearningObjectivesPage>();
      let generatedCount = 0;
      let skippedCount = 0;
      let quotaPaused = false;
      for (const page of pages) {
        if (!page.narration?.trim()) {
          skippedCount += 1;
          updateBatchProgressItem(page.id, { audioStatus: 'skipped', message: 'No narration script.' });
          continue;
        }
        if ((page.media || []).some(isNarrationAudioMedia) && !aiSettings.regenerateExistingAudio) {
          skippedCount += 1;
          updateBatchProgressItem(page.id, { audioStatus: 'done', message: 'Existing narration audio preserved.' });
          continue;
        }
        updateBatchProgressItem(page.id, { audioStatus: 'running' });
        try {
          pagesById.set(page.id, await createAudioAssetForPage(page));
          generatedCount += 1;
          updateBatchProgressItem(page.id, { audioStatus: 'done' });
        } catch (error: any) {
          if (isTtsQuotaError(error)) {
            quotaPaused = true;
            const details = getTtsErrorDetails(error);
            setTtsDiagnosticReport(buildTtsDiagnosticReport(error, `Batch Generate TTS: ${page.title}`));
            updateBatchProgressDetails(page.id, {
              audioStatus: 'pending',
              quotaPaused: true,
              retryAfterSeconds: details?.retryAfterSeconds,
              providerMessage: formatTtsErrorForUser(error, 'Batch Generate TTS'),
              message: 'Quota paused before this page was generated.',
            });
            break;
          }
          setTtsDiagnosticReport(buildTtsDiagnosticReport(error, `Batch Generate TTS: ${page.title}`));
          updateBatchProgressItem(page.id, { audioStatus: 'error', message: error.message || String(error) });
          continue;
        }
      }
      updateProjectData(project => replacePagesInProject(project, pagesById));
      if (quotaPaused) {
        alert(`Batch TTS paused. Generated audio for ${generatedCount} page${generatedCount === 1 ? '' : 's'} and skipped ${skippedCount}. Completed pages were saved. Resume later after the provider retry window, or after IT raises the Azure OpenAI deployment quota.`);
      } else {
        alert(`Batch TTS complete. Generated audio for ${generatedCount} page${generatedCount === 1 ? '' : 's'} and skipped ${skippedCount}.`);
      }
    } catch (error: any) {
      console.error(error);
      setTtsDiagnosticReport(buildTtsDiagnosticReport(error, 'Batch Generate TTS'));
    } finally {
      setBatchJob(null);
    }
  };

  const handleBatchGenerateCaptions = async () => {
    if (!context?.assetsHandle) return;
    const pages = getEditablePages(context.projectData);
    setBatchJob('captions');
    setBatchProgress(buildBatchProgress(pages));
    try {
      const pagesById = new Map<string, Topic | WelcomePage | LearningObjectivesPage>();
      let captionCount = 0;
      let skippedCount = 0;

      for (const page of pages) {
        const audioItem = (page.media || []).find(isNarrationAudioMedia);
        if (page.narration?.trim()) {
          updateBatchProgressItem(page.id, { captionStatus: 'running' });
          const durationSeconds = audioItem
            ? await (async () => {
                const fileHandle = await findAssetFile(audioItem.storageId);
                if (!fileHandle) return estimateNarrationDurationSeconds(page.narration);
                const meta = await findAssetMetadata(audioItem.storageId);
                const file = await fileHandle.getFile();
                const { blob } = await BinaryDecoder.decodeMedia(file, 'audio', meta?.mimeType);
                return readAudioDurationSeconds(blob).catch(() => estimateNarrationDurationSeconds(page.narration));
              })()
            : estimateNarrationDurationSeconds(page.narration);
          pagesById.set(page.id, { ...page, caption: buildVttFromNarration(page.narration, durationSeconds) });
          captionCount += 1;
          updateBatchProgressItem(page.id, { captionStatus: 'done', message: 'Built locally from narration text.' });
          continue;
        }
        if (!audioItem) {
          skippedCount += 1;
          updateBatchProgressItem(page.id, { captionStatus: 'skipped', message: 'No linked audio.' });
          continue;
        }
        const fileHandle = await findAssetFile(audioItem.storageId);
        if (!fileHandle) {
          skippedCount += 1;
          updateBatchProgressItem(page.id, { captionStatus: 'skipped', message: 'Audio file not found.' });
          continue;
        }
        updateBatchProgressItem(page.id, { captionStatus: 'running' });
        try {
          const meta = await findAssetMetadata(audioItem.storageId);
          const file = await fileHandle.getFile();
          const { blob, mimeType } = await BinaryDecoder.decodeMedia(file, 'audio', meta?.mimeType);
          const caption = await transcribeAudioToVTT(new File([blob], file.name, { type: mimeType || meta?.mimeType || 'audio/wav' }), aiSettings);
          pagesById.set(page.id, { ...page, caption });
          captionCount += 1;
          updateBatchProgressItem(page.id, { captionStatus: 'done' });
        } catch (error: any) {
          const quota = parseGeminiQuotaError(error, 'Batch Generate VTT');
          if (quota.isQuotaError) {
            recordGeminiQuotaEvent(quota);
            updateBatchProgressDetails(page.id, {
              captionStatus: 'error',
              quotaPaused: true,
              retryAfterSeconds: quota.retryAfterSeconds,
              providerMessage: formatGeminiQuotaGuidance(quota),
              message: 'Caption transcription quota hit. Add narration text for local VTT or paste captions manually.',
            });
            continue;
          }
          updateBatchProgressItem(page.id, { captionStatus: 'error', message: error.message || String(error) });
          continue;
        }
      }

      updateProjectData(project => replacePagesInProject(project, pagesById));
      alert(`Batch VTT complete. Generated captions for ${captionCount} pages. Skipped ${skippedCount} pages without usable audio.`);
    } catch (error: any) {
      console.error(error);
      alert(`Batch VTT failed:\n\n${formatGeminiErrorForUser(error, 'Batch Generate VTT')}`);
    } finally {
      setBatchJob(null);
    }
  };

  const createUniqueTopicId = (topics: Topic[]) => {
    const existingIds = new Set(topics.map(topic => topic.id));
    const baseId = `topic-${Date.now()}`;
    let id = baseId;
    let suffix = 1;
    while (existingIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    return id;
  };

  const addTopicPage = (partialTopic: Partial<Topic> = {}) => {
    if (!context?.projectData) return;
    const existingTopics = context.projectData.courseContent.topics;
    const topicId = createUniqueTopicId(existingTopics);
    const title = (partialTopic.title || '').trim() || `New Topic ${existingTopics.length + 1}`;
    const blankTopic = ScormManager.createBlankTopic(topicId, title);
    const newTopic: Topic = {
      ...blankTopic,
      ...partialTopic,
      id: topicId,
      title,
      content: partialTopic.content ?? blankTopic.content,
      narration: partialTopic.narration ?? blankTopic.narration,
      duration: partialTopic.duration ?? blankTopic.duration,
      imageKeywords: partialTopic.imageKeywords ?? blankTopic.imageKeywords,
      imagePrompts: partialTopic.imagePrompts ?? blankTopic.imagePrompts,
      videoSearchTerms: partialTopic.videoSearchTerms ?? blankTopic.videoSearchTerms,
      media: partialTopic.media ?? blankTopic.media,
      knowledgeCheck: partialTopic.knowledgeCheck ?? blankTopic.knowledgeCheck,
    };

    updateProjectData(prev => {
      const topics = [...prev.courseContent.topics, newTopic];
      const topicTitles = topics.map(topic => topic.title);
      return {
        ...prev,
        courseData: {
          ...prev.courseData,
          topics: topicTitles,
          customTopics: prev.courseData.customTopics ? topicTitles : prev.courseData.customTopics,
        },
        courseContent: {
          ...prev.courseContent,
          topics,
          lastModified: new Date().toISOString(),
        },
      };
    });

    setView({ type: 'topic-edit', id: topicId });
    setIsAddingTopic(false);
    setNewTopicTitle('');
  };

  const addAITopic = (partialTopic: Partial<Topic>) => {
    addTopicPage(partialTopic);
  };
  
  // Get all topic content combined for context (for distractors)
  const getAllContentContext = () => {
      if(!context) return "";
      return context.projectData.courseContent.topics.map(t => t.content).join("\n\n");
  }

  // Render Content based on View State
  const renderContent = () => {
    if (!context) return null;
    const { projectData } = context;

    if (view === 'welcome') {
      return (
        <TopicEditor
            data={projectData.courseContent.welcomePage}
            onChange={updateTopic}
            assetsHandle={context.assetsHandle}
            onAssetCreate={handleAssetCreate}
            onLinkAssets={handleLinkAssets}
            onOpenAiSettings={() => setIsSettingsOpen(true)}
            isSandbox={context.isSandbox}
            aiSettings={aiSettings}
            label="Welcome Page"
            projectId={projectData.project.id}
            pronunciationConfig={pronunciationConfig}
            onPronunciationConfigChange={savePronunciationConfig}
            batchJob={batchJob}
            batchProgress={batchProgress}
        />
      );
    }
    
    if (view === 'objectives') {
        return (
            <TopicEditor
                data={projectData.courseContent.learningObjectivesPage}
                onChange={updateTopic}
                assetsHandle={context.assetsHandle}
                onAssetCreate={handleAssetCreate}
                onLinkAssets={handleLinkAssets}
                onOpenAiSettings={() => setIsSettingsOpen(true)}
                isSandbox={context.isSandbox}
                aiSettings={aiSettings}
                label="Learning Objectives"
                projectId={projectData.project.id}
                pronunciationConfig={pronunciationConfig}
                onPronunciationConfigChange={savePronunciationConfig}
                batchJob={batchJob}
                batchProgress={batchProgress}
            />
          );
    }

    if (view === 'topic-list') {
        return (
            <div className="max-w-4xl mx-auto">
                 <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-slate-800">Topic Management</h2>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setIsAddingTopic(true)}
                            className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 flex items-center gap-2"
                        >
                            <PlusCircle className="w-4 h-4" /> Add Topic Page
                        </button>
                        <button 
                            onClick={() => setIsAIMode(true)}
                            className="bg-purple-600 text-white px-4 py-2 rounded shadow hover:bg-purple-700 flex items-center gap-2"
                        >
                            <PlusCircle className="w-4 h-4" /> AI Generator
                        </button>
                    </div>
                 </div>
                 {isAddingTopic && (
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            addTopicPage({ title: newTopicTitle });
                        }}
                        className="mb-4 bg-white border border-blue-200 rounded-lg p-4 shadow-sm"
                    >
                        <label className="block text-sm font-semibold text-slate-800 mb-2">New topic page title</label>
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <input
                                value={newTopicTitle}
                                onChange={(event) => setNewTopicTitle(event.target.value)}
                                className="min-w-0 flex-1 p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                placeholder={`New Topic ${projectData.courseContent.topics.length + 1}`}
                                autoFocus
                            />
                            <div className="flex gap-2">
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700"
                                >
                                    Create Page
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsAddingTopic(false);
                                        setNewTopicTitle('');
                                    }}
                                    className="px-4 py-2 bg-slate-100 text-slate-700 rounded font-semibold hover:bg-slate-200"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </form>
                 )}
                 <div className="space-y-2">
                     {projectData.courseContent.topics.map((t, i) => {
                        const isDragging = topicDragState.draggedId === t.id;
                        const isDropTarget = topicDragState.overId === t.id && topicDragState.draggedId !== t.id;
                        return (
                          <div
                              key={t.id}
                              onDragOver={(event) => {
                                if (!topicDragState.draggedId || topicDragState.draggedId === t.id) return;
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                                const rect = event.currentTarget.getBoundingClientRect();
                                const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                                if (topicDragState.overId !== t.id || topicDragState.position !== position) {
                                  setTopicDragState(prev => ({ ...prev, overId: t.id, position }));
                                }
                              }}
                              onDragLeave={(event) => {
                                const nextTarget = event.relatedTarget;
                                if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                                if (topicDragState.overId === t.id) {
                                  setTopicDragState(prev => ({ ...prev, overId: null, position: null }));
                                }
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                const draggedId = event.dataTransfer.getData('application/x-scorm-topic-id') || topicDragState.draggedId || event.dataTransfer.getData('text/plain');
                                const position = topicDragState.position || 'before';
                                const targetIndex = getDragTargetIndex(projectData.courseContent.topics, draggedId, t.id, position);
                                resetTopicDragState();
                                if (targetIndex !== null) reorderTopicPage(draggedId, targetIndex);
                              }}
                              className={`relative p-4 bg-white border rounded flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center hover:shadow-sm transition-shadow ${isDragging ? 'opacity-55 border-blue-300' : 'border-slate-200'} ${isDropTarget ? 'ring-2 ring-blue-200' : ''}`}
                          >
                              {isDropTarget && (
                                  <div
                                     className={`absolute left-4 right-4 h-1 rounded-full bg-blue-500 ${topicDragState.position === 'before' ? 'top-0' : 'bottom-0'}`}
                                     aria-hidden="true"
                                  />
                              )}
                              <div className="min-w-0 flex items-center gap-2">
                                  <button
                                     type="button"
                                     draggable
                                     onDragStart={(event) => {
                                       event.dataTransfer.effectAllowed = 'move';
                                       event.dataTransfer.setData('application/x-scorm-topic-id', t.id);
                                       event.dataTransfer.setData('text/plain', t.id);
                                       setTopicDragState({ draggedId: t.id, overId: null, position: null });
                                     }}
                                     onDragEnd={resetTopicDragState}
                                     className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-200 text-slate-500 cursor-grab active:cursor-grabbing hover:bg-slate-100"
                                     title="Drag to move topic page"
                                     aria-label={`Drag to move ${t.title}`}
                                  >
                                     <GripVertical className="w-4 h-4" />
                                  </button>
                                  <span className="min-w-0 font-medium text-slate-700 break-words whitespace-normal" title={t.title}>{i + 1}. {t.title}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                  <button
                                     type="button"
                                     onClick={() => moveTopicPage(t.id, -1)}
                                     disabled={i === 0}
                                     className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                     title="Move topic page up"
                                     aria-label={`Move ${t.title} up`}
                                  >
                                     <ArrowUp className="w-4 h-4" />
                                  </button>
                                  <button
                                     type="button"
                                     onClick={() => moveTopicPage(t.id, 1)}
                                     disabled={i === projectData.courseContent.topics.length - 1}
                                     className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                     title="Move topic page down"
                                     aria-label={`Move ${t.title} down`}
                                  >
                                     <ArrowDown className="w-4 h-4" />
                                  </button>
                                  <button
                                     onClick={() => setView({ type: 'topic-edit', id: t.id })}
                                     className="text-blue-600 text-sm hover:underline"
                                  >
                                     Edit
                                  </button>
                                  <button
                                     onClick={() => deleteTopicPage(t.id)}
                                     className="inline-flex items-center gap-1 text-red-500 text-sm hover:text-red-700 hover:underline"
                                     title="Delete entire topic page"
                                  >
                                     <Trash2 className="w-3.5 h-3.5" />
                                     Delete
                                  </button>
                              </div>
                          </div>
                        );
                      })}
                 </div>
            </div>
        )
    }

    if (view === 'assessment') {
      return (
        <AssessmentEditor 
          assessment={projectData.courseContent.assessment}
          onChange={(newAssessment) => {
            updateProjectData(p => ({
                ...p,
                courseContent: { ...p.courseContent, assessment: newAssessment }
            }));
          }}
          aiSettings={aiSettings}
          contextText={getAllContentContext()}
        />
      );
    }

    if (view === 'metadata') {
        return (
            <div className="max-w-2xl mx-auto bg-white p-8 rounded shadow-sm border border-slate-200 space-y-4">
                <h2 className="text-2xl font-bold mb-6">Project Metadata</h2>
                <div>
                    <label className="block text-sm font-medium mb-1">Project Name</label>
                    <input 
                        type="text" 
                        value={projectData.project.name}
                        onChange={(e) => updateProjectData(p => ({ ...p, project: { ...p.project, name: e.target.value } }))}
                        className="w-full p-2 bg-white text-slate-900 border rounded"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Pass Mark</label>
                    <input 
                        type="number" 
                        value={projectData.courseContent.assessment.passMark}
                        readOnly // Edit in assessment engine
                        className="w-full p-2 border rounded bg-slate-100 text-slate-500 cursor-not-allowed"
                    />
                </div>
                <div className="pt-4 border-t border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">Course Settings for SCORM Output</h3>
                    <p className="text-sm text-slate-600 mb-4">
                        These settings are enforced inside the exported Moodle SCORM package.
                    </p>
                    <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 mb-3">
                        <label className="block font-semibold text-slate-900 mb-1">SCORM output colors</label>
                        <select
                            value={projectData.scormConfig.outputTheme || 'dark-violet'}
                            onChange={(e) => updateProjectData(p => ({
                                ...p,
                                scormConfig: {
                                    ...p.scormConfig,
                                    outputTheme: e.target.value as 'dark-violet' | 'legacy-green' | 'light-purple',
                                }
                            }))}
                            className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none"
                        >
                            <option value="dark-violet">Dark violet (default)</option>
                            <option value="legacy-green">Legacy green styleguide</option>
                            <option value="light-purple">Light purple / gray</option>
                        </select>
                        <p className="text-sm text-slate-600 mt-2">Controls the color palette of the exported SCORM package only.</p>
                    </div>
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50 mb-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={Boolean(projectData.scormConfig.requireKnowledgeCheckBeforeContinue)}
                            onChange={(e) => updateProjectData(p => ({
                                ...p,
                                scormConfig: {
                                    ...p.scormConfig,
                                    requireKnowledgeCheckBeforeContinue: e.target.checked,
                                }
                            }))}
                            className="mt-1"
                        />
                        <span>
                            <span className="block font-semibold text-slate-900">Require knowledge check before continuing</span>
                            <span className="block text-sm text-slate-600">Learners must submit the page knowledge check correctly before Next unlocks.</span>
                        </span>
                    </label>
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={Boolean(projectData.scormConfig.requireAudioCompletionBeforeContinue)}
                            onChange={(e) => updateProjectData(p => ({
                                ...p,
                                scormConfig: {
                                    ...p.scormConfig,
                                    requireAudioCompletionBeforeContinue: e.target.checked,
                                }
                            }))}
                            className="mt-1"
                        />
                        <span>
                            <span className="block font-semibold text-slate-900">Require full narration audio before continuing</span>
                            <span className="block text-sm text-slate-600">Learners must play each page's narration to the end before Next unlocks.</span>
                        </span>
                    </label>
                </div>
            </div>
        )
    }

    if (typeof view === 'object' && view.type === 'topic-edit') {
      const topic = projectData.courseContent.topics.find(t => t.id === view.id);
      if (topic) {
        return (
           <TopicEditor 
              data={topic} 
              onChange={updateTopic} 
              assetsHandle={context.assetsHandle}
              onAssetCreate={handleAssetCreate}
              onLinkAssets={handleLinkAssets}
              onOpenAiSettings={() => setIsSettingsOpen(true)}
              isSandbox={context.isSandbox}
              aiSettings={aiSettings}
              label="Topic Editor"
              projectId={projectData.project.id}
              pronunciationConfig={pronunciationConfig}
              onPronunciationConfigChange={savePronunciationConfig}
              batchJob={batchJob}
              batchProgress={batchProgress}
           />
        );
      }
    }

    return <div>View Not Found</div>;
  };

  // Apply the existing password gate before displaying the entry screens.
  // AI Settings can now be opened there, so saved keys must stay behind the gate.
  if (!isSiteUnlocked) {
    return <PasswordGate onUnlock={() => setIsSiteUnlocked(true)} />;
  }

  // Login / Load Screen
  if (!context && !pdfCourseProject && view !== 'project-select') {
    return (
      <div className="theme-dark min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
         <div className="bg-white p-10 rounded-xl shadow-xl max-w-lg w-full text-center space-y-6">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <FolderOpen className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800">SCORM Architect Pro</h1>
            <button type="button" onClick={() => setIsSettingsOpen(true)} className="inline-flex items-center justify-center gap-2 text-xs font-semibold border border-slate-300 rounded-lg px-3 py-2 text-blue-700 hover:bg-blue-50">
              <Settings className="w-4 h-4" /> AI Settings (Gemini & Azure TTS)
            </button>
            <p className="text-slate-500 text-sm">
                Choose the standard course builder or the separate PDF compliance/SOP builder.
            </p>

            <button 
                onClick={() => setIsNewCourseOpen(true)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
            >
                <FilePlus2 className="w-5 h-5" />
                Create New Standard SCORM Course
            </button>
            <button 
                onClick={handleOpenFolder}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
            >
                <FolderOpen className="w-5 h-5" />
                Open Standard SCORM Course
            </button>
            <div className="my-2 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              PDF compliance/SOP
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                  onClick={() => pdfCreateInputRef.current?.click()}
                  className="w-full py-3 px-3 bg-[#a9472b] hover:bg-[#8d3823] text-white font-semibold rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
              >
                  <FilePlus2 className="w-5 h-5 shrink-0" />
                  <span>Create Single PDF Course</span>
              </button>
              <button
                  onClick={() => pdfBatchCreateInputRef.current?.click()}
                  className="w-full py-3 px-3 bg-[#8a5a32] hover:bg-[#704725] text-white font-semibold rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
              >
                  <FileArchive className="w-5 h-5 shrink-0" />
                  <span>Create Batch PDF Courses</span>
              </button>
            </div>
            <button
                onClick={() => pdfOpenInputRef.current?.click()}
                className="w-full py-3 bg-[#41644a] hover:bg-[#34513c] text-white font-semibold rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
            >
                <FolderOpen className="w-5 h-5" />
                Open PDF Course
            </button>
            <input 
                ref={fileInputRef}
                type="file"
                // @ts-ignore
                webkitdirectory="" 
                directory=""
                multiple
                className="hidden"
                onChange={handleSandboxSelect}
            />
            <input
                ref={pdfCreateInputRef}
                type="file"
                accept=".pdf,.zip,application/pdf,application/zip"
                className="hidden"
                onChange={event => handleCreatePdfCourse(Array.from(event.target.files || []), 'single')}
            />
            <input
                ref={pdfBatchCreateInputRef}
                type="file"
                accept=".pdf,.zip,application/pdf,application/zip"
                multiple
                className="hidden"
                onChange={event => handleCreatePdfCourse(Array.from(event.target.files || []), 'batch')}
            />
            <input
                ref={pdfOpenInputRef}
                type="file"
                accept=".zip,.pdfcourse"
                className="hidden"
                onChange={event => handleOpenPdfCourse(event.target.files?.[0])}
            />

            {error && (
                <div className="p-3 bg-red-50 text-red-600 text-sm rounded flex items-center gap-2 justify-center border border-red-100">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            
            <p className="text-xs text-slate-500 mt-4 text-left leading-relaxed">
              <strong>Open existing course:</strong> Select its folder containing a .scormproj file and the media subfolder (images/audio may be .bin files). The app discovers course projects; there is no need to upload the project again. New courses automatically create their own folder and media files.
            </p>
            <p className="text-xs text-slate-400 mt-2">
              Direct folder access is used when supported. Browser-session opening does not save uploaded media back to the folder.
            </p>
         </div>
          <NewCourseModal
             isOpen={isNewCourseOpen}
             isCreating={isCreatingCourse}
             error={newCourseError}
             status={newCourseStatus}
             progress={newCourseProgress}
             aiSettings={aiSettings}
             allowPowerPointImport
             destinationFolderName={rootEnvironment && !rootEnvironment.isSandbox ? rootEnvironment.rootHandle.name : null}
             onOpenAiSettings={() => setIsSettingsOpen(true)}
             onClose={() => setIsNewCourseOpen(false)}
             onCreate={handleCreateNewCourse}
          />
          <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={aiSettings} onSave={saveAiSettings} />
      </div>
    );
  }

  if (pdfCourseProject) {
    return (
      <PdfCourseEditor
        project={pdfCourseProject}
        onChange={setPdfCourseProject}
        onClose={() => setPdfCourseProject(null)}
      />
    );
  }

  // Project Select Screen
  if (!context && view === 'project-select') {
     return (
        <div className="theme-dark min-h-screen bg-slate-50 flex flex-col items-center py-12 px-6">
            <div className="max-w-4xl w-full">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-800">Select Project to Load</h1>
                        {error && <p className="text-sm text-slate-400 mt-2">{error}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setIsSettingsOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-300 text-blue-700 hover:bg-blue-50">
                      <Settings className="w-4 h-4" /> AI Settings
                    </button>
                    <button
                        onClick={() => {
                            setNewCourseError(null);
                            setNewCourseStatus(null);
                            setNewCourseProgress(null);
                            setIsNewCourseOpen(true);
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-sm font-semibold shadow"
                    >
                        <FilePlus2 className="w-4 h-4" />
                        Create New Course
                    </button>
                    <button 
                        onClick={() => {
                            setAvailableProjects([]);
                            setRootEnvironment(null);
                            setView('welcome');
                        }}
                        className="text-slate-500 hover:text-slate-700 underline text-sm font-medium"
                    >
                        Back to Folder Selection
                    </button>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {availableProjects.map((p, i) => (
                        <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow cursor-pointer flex justify-between items-center group" onClick={() => loadProject(p, rootEnvironment!.rootHandle, rootEnvironment!.isSandbox)}>
                            <div>
                                <h3 className="font-bold text-lg text-slate-800 group-hover:text-blue-600 transition-colors">{p.projectData.project.name}</h3>
                                <p className="text-sm text-slate-500 mt-1 max-w-[250px] truncate" title={p.projectHandle.name}>
                                    File: {p.projectHandle.name}
                                </p>
                            </div>
                            <div className="w-10 h-10 bg-slate-50 group-hover:bg-blue-50 rounded-full flex items-center justify-center text-slate-400 group-hover:text-blue-600 transition-colors">
                                <ChevronRight className="w-5 h-5" />
                            </div>
                        </div>
                    ))}
                    {restorePointCount > 0 && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex justify-between items-center opacity-90">
                            <div>
                                <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                                    <History className="w-5 h-5 text-blue-600" />
                                    Restore Points
                                </h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    {restorePointCount} timeline backups stored in _restore_points
                                </p>
                            </div>
                            <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center text-slate-400">
                                <History className="w-5 h-5" />
                            </div>
                        </div>
                    )}
                </div>
                <NewCourseModal
                    isOpen={isNewCourseOpen}
                    isCreating={isCreatingCourse}
                    error={newCourseError}
                    status={newCourseStatus}
                    progress={newCourseProgress}
                    aiSettings={aiSettings}
                    allowPowerPointImport
                    destinationFolderName={rootEnvironment && !rootEnvironment.isSandbox ? rootEnvironment.rootHandle.name : null}
                    onOpenAiSettings={() => setIsSettingsOpen(true)}
                    onClose={() => setIsNewCourseOpen(false)}
                    onCreate={handleCreateNewCourse}
                />
                <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={aiSettings} onSave={saveAiSettings} />
            </div>
        </div>
     );
  }

  return (
    <div className="theme-dark flex h-screen bg-slate-50 overflow-hidden font-sans">
      <Sidebar 
        project={context.projectData} 
        currentView={view} 
        onNavigate={setView}
        onSave={handleSave}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onCloseProject={handleCloseProject}
        onLockSite={lockSite}
        onBatchGenerateTts={handleBatchGenerateTts}
        onBatchGenerateCaptions={handleBatchGenerateCaptions}
        batchJob={batchJob}
        batchDisabled={!context.assetsHandle}
        resumeTtsAvailable={batchProgress.some(item => item.quotaPaused || item.audioStatus === 'error' || item.audioStatus === 'pending')}
        onCreateNewCourse={() => {
          setNewCourseError(null);
          setNewCourseStatus(null);
          setNewCourseProgress(null);
          setIsNewCourseOpen(true);
        }}
        hideTemplatePages={isPowerPointProject(context.projectData)}
      />
      
      <main className="flex-1 overflow-y-auto relative">
         {/* Browser-session indicator */}
         {context.isSandbox && (
             <div className="bg-amber-100 text-amber-800 text-xs font-bold text-center py-1 border-b border-amber-200">
                 BROWSER SESSION: Edits stay in memory. Downloading a .scormproj does NOT include newly uploaded media files. Reopen with direct folder access for reliable saving.
             </div>
         )}
         
         {!context.assetsHandle && !context.isSandbox && (
             <div role="status" className="bg-amber-100 text-amber-900 text-xs py-2 px-4 border-b border-amber-200 flex flex-wrap justify-center items-center gap-2">
                 <span>No media folder is linked. Upload, narration generation, and audio captions may be unavailable.</span>
                 <button type="button" onClick={handleLinkAssets} className="font-bold underline">Connect Media Folder</button>
             </div>
         )}
         {context.assetsHandle && !context.isSandbox && (mediaWritePermission === 'prompt' || mediaWritePermission === 'denied') && (
             <div role="status" className="bg-amber-100 text-amber-900 text-xs py-2 px-4 border-b border-amber-200 flex flex-wrap justify-center items-center gap-2">
                 <span>{mediaWritePermission === 'denied' ? 'Media folder write access was denied.' : 'Media folder write access needs renewed permission.'}</span>
                 <button type="button" onClick={handleLinkAssets} className="font-bold underline">Reconnect Media Folder</button>
             </div>
         )}

         {/* Integrity Scanner Status */}
         {isScanning && (
             <div className="bg-blue-600 text-white text-xs font-bold text-center py-2 animate-pulse flex items-center justify-center gap-2">
                 <Loader2 className="w-4 h-4 animate-spin" />
                 Running Integrity Scan on Assets...
             </div>
         )}

         {scanResult && !isScanning && (
             <div className={`text-xs font-bold text-center py-1 flex items-center justify-center gap-2 transition-colors ${
                 scanResult.count > 0 ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-500'
             }`}>
                 <ShieldCheck className="w-4 h-4" />
                 Integrity Scan Complete. Repaired {scanResult.count} items from disk.
             </div>
         )}

         {lastAutoSaveAt && !context.isSandbox && (
             <div className="bg-emerald-50 text-emerald-700 text-xs font-semibold text-center py-1 border-b border-emerald-100">
                 Autosaved with restore point at {lastAutoSaveAt}
             </div>
         )}
         
         <div className="p-8 pb-20">
           {renderContent()}
         </div>
      </main>

      {/* Keep Preview next to Export so authors can test before publishing. */}
      <div className="fixed bottom-6 right-6 flex flex-wrap justify-end gap-3 z-30">
         <button
           type="button"
           onClick={() => setIsPreviewOpen(true)}
           disabled={isExporting || isScanning}
           className="bg-violet-700 hover:bg-violet-600 text-white px-5 py-3 rounded-full shadow-xl flex items-center gap-2 font-semibold transition-colors disabled:opacity-50"
           title="Preview learner pages, navigation, audio and captions without recording LMS progress"
         >
           <Eye className="w-5 h-5" /> Preview Course
         </button>
         <button
           onClick={handleExportScorm}
           disabled={isExporting || isScanning}
           className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-3 font-semibold transition-all hover:scale-105 disabled:opacity-50"
         >
           {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
           Export SCORM Package
         </button>
      </div>

      {isPreviewOpen && (
        <CoursePreviewModal
          project={context.projectData}
          assetsHandle={context.assetsHandle}
          rootHandle={context.rootHandle}
          onClose={() => setIsPreviewOpen(false)}
        />
      )}

      {isAIMode && (
        <AIGeneratorModal 
          onClose={() => setIsAIMode(false)} 
          onTopicGenerated={addAITopic}
          aiSettings={aiSettings}
        />
      )}
      
      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={aiSettings}
        onSave={saveAiSettings}
      />
      <NewCourseModal
        isOpen={isNewCourseOpen}
        isCreating={isCreatingCourse}
        error={newCourseError}
        status={newCourseStatus}
        progress={newCourseProgress}
        aiSettings={aiSettings}
        allowPowerPointImport
        destinationFolderName={rootEnvironment && !rootEnvironment.isSandbox && (!context || rootEnvironment.rootHandle !== context.rootHandle) ? rootEnvironment.rootHandle.name : null}
        onOpenAiSettings={() => setIsSettingsOpen(true)}
        onClose={() => setIsNewCourseOpen(false)}
        onCreate={handleCreateNewCourse}
      />
      {ttsDiagnosticReport && (
        <ErrorDiagnosticsModal
          title="Azure OpenAI TTS Error Diagnostics"
          report={ttsDiagnosticReport}
          onClose={() => setTtsDiagnosticReport(null)}
        />
      )}
    </div>
  );
};

export default App;
