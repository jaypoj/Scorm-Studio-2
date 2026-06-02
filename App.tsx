import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopicEditor } from './components/TopicEditor';
import { AssessmentEditor } from './components/AssessmentEditor';
import { AIGeneratorModal } from './components/AIGeneratorModal';
import { SettingsModal } from './components/SettingsModal';
import { PasswordGate } from './components/PasswordGate';
import { NewCourseModal, NewCourseRequest } from './components/NewCourseModal';
import { ScormManager } from './services/scormManager';
import { ScormPackager } from './services/scormPackager';
import { formatGeminiErrorForUser, generateCourseContent, transcribeAudioToVTT } from './services/geminiService';
import { formatTtsErrorForUser, generateNarrationAudio, getTtsErrorDetails, isTtsQuotaError } from './services/ttsService';
import { importPowerPointCourse } from './services/powerPointImporter';
import { importLegacyScormFromFolder, importLegacyScormFromZip } from './services/legacyScormImporter';
import { BinaryDecoder } from './services/binaryDecoder';
import { formatGeminiQuotaGuidance, parseGeminiQuotaError, recordGeminiQuotaEvent } from './services/geminiQuota';
import { ScormProject, ViewState, Topic, ProjectContext, FileSystemDirectoryHandle, FileSystemFileHandle, AISettings, WelcomePage, LearningObjectivesPage, DiscoveredProject, PronunciationConfig, MediaItem, BatchJobType, BatchProgressItem, BatchPageStatus, ImportedProjectMediaFile } from './types';
import { Loader2, PlusCircle, AlertTriangle, FolderOpen, Download, ShieldCheck, ChevronRight, FilePlus2, History, Trash2 } from 'lucide-react';
import { DEFAULT_GEMINI_MODEL, DEFAULT_TTS_SETTINGS, OPENAI_TTS_VOICES } from './constants';
import { createVirtualFileSystem } from './utils/virtualFileSystem';
import { buildVttFromNarration, estimateNarrationDurationSeconds, readAudioDurationSeconds } from './utils/captions';

const App: React.FC = () => {
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [availableProjects, setAvailableProjects] = useState<DiscoveredProject[]>([]);
  const [rootEnvironment, setRootEnvironment] = useState<{rootHandle: FileSystemDirectoryHandle, isSandbox: boolean} | null>(null);
  const [view, setView] = useState<ViewState>('welcome');
  const [isAIMode, setIsAIMode] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isNewCourseOpen, setIsNewCourseOpen] = useState(false);
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [newCourseError, setNewCourseError] = useState<string | null>(null);
  const [newCourseStatus, setNewCourseStatus] = useState<string | null>(null);
  const [newCourseProgress, setNewCourseProgress] = useState<number | null>(null);
  const [lastAutoSaveAt, setLastAutoSaveAt] = useState<string | null>(null);
  const [restorePointCount, setRestorePointCount] = useState(0);
  const [pronunciationConfig, setPronunciationConfig] = useState<PronunciationConfig>({ tts: DEFAULT_TTS_SETTINGS, pronunciations: [] });
  const [batchJob, setBatchJob] = useState<BatchJobType>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgressItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSiteUnlocked, setIsSiteUnlocked] = useState(() => sessionStorage.getItem('scorm_studio_unlocked') === 'true');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Integrity Scan State
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ count: number, logs: string[] } | null>(null);

  // AI Settings State (persisted in localStorage in a real app, here state)
  const [aiSettings, setAiSettings] = useState<AISettings>(() => {
    const saved = localStorage.getItem('scorm_ai_settings');
    // Using default model constant
    const parsed = saved ? JSON.parse(saved) : { model: DEFAULT_GEMINI_MODEL };
    return {
      allowBundledGeminiFallback: false,
      regenerateExistingAudio: false,
      ...parsed,
    };
  });

  const saveAiSettings = (s: AISettings) => {
    const normalized = {
      allowBundledGeminiFallback: false,
      regenerateExistingAudio: false,
      ...s,
    };
    setAiSettings(normalized);
    localStorage.setItem('scorm_ai_settings', JSON.stringify(normalized));
  };

  const lockSite = () => {
    sessionStorage.removeItem('scorm_studio_unlocked');
    setIsSiteUnlocked(false);
  };

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
                    // Update context with repaired project
                    setContext(prev => prev ? { ...prev, projectData: project } : null);
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
  }, [context?.projectData?.project?.id]); // Depend on ID to run once per loaded project

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

             // Auto-create assets folder if missing
             if (!aHandle) {
                 try {
                     aHandle = await dirHandle.getDirectoryHandle('media', { create: true });
                 } catch(e) { console.warn("Could not create assets folder"); }
             }

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
      const rootHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker();
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
      if (e.target.files && e.target.files.length > 0) {
          try {
            const virtualRoot = createVirtualFileSystem(e.target.files);
            processRootHandle(virtualRoot, true).catch(err => setError(err.message));
          } catch(err: any) {
              setError("Failed to load sandbox: " + err.message);
          }
      }
  };

  const handleCreateNewCourse = async (request: NewCourseRequest) => {
    setIsCreatingCourse(true);
    setNewCourseError(null);
    setNewCourseStatus('Preparing course workspace...');
    setNewCourseProgress(request.mode === 'powerpoint' || request.mode === 'legacy-scorm' ? 2 : null);
    try {
      let rootHandle = context && !context.isSandbox ? context.rootHandle : null;
      rootHandle = rootHandle || (rootEnvironment && !rootEnvironment.isSandbox ? rootEnvironment.rootHandle : null);
      if (!rootHandle && request.mode === 'powerpoint') {
        throw new Error('PowerPoint import needs an open project folder first. Click Open Project Folder, select a project folder, then create the PowerPoint course again.');
      }
      if (!rootHandle) {
        if (!('showDirectoryPicker' in window) || window.self !== window.top) {
          throw new Error('Creating a new course requires direct folder access in Chrome or Edge. Open the app in a normal browser tab and try again.');
        }

        // @ts-ignore - File System Access API
        rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      }
      const courseFolderName = sanitizeFileName(request.courseName);
      setNewCourseStatus('Creating course folders...');
      const courseFolderHandle = await rootHandle.getDirectoryHandle(courseFolderName, { create: true });
      const assetsHandle = await courseFolderHandle.getDirectoryHandle('media', { create: true });
      await courseFolderHandle.getDirectoryHandle('_restore_points', { create: true });
      const initialPronunciationConfig = { tts: DEFAULT_TTS_SETTINGS, pronunciations: [] };
      const pronunciationHandle = await courseFolderHandle.getFileHandle('pronunciations.json', { create: true });
      await writeTextFile(pronunciationHandle, JSON.stringify(initialPronunciationConfig, null, 2));

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

  const handleAssetCreate = async (file: File, id: string) => {
    if (!context?.assetsHandle) {
      alert("No asset folder linked.");
      return;
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
        return {
             ...prev,
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

  const isPowerPointProject = (project: ScormProject) => project.scormConfig?.contentMode === 'ppt-import';

  const getEditablePages = (project: ScormProject) => isPowerPointProject(project)
    ? [...project.courseContent.topics]
    : [
        project.courseContent.welcomePage,
        project.courseContent.learningObjectivesPage,
        ...project.courseContent.topics,
      ];

  const isNarrationAudioMedia = (media: MediaItem) => media.type === 'audio' && !media.candidate && media.source !== 'powerpoint';

  const isGeneratedNarrationAudioMedia = (media: MediaItem) => {
    if (!isNarrationAudioMedia(media)) return false;
    return media.source === 'azure-openai-tts' || media.source === 'gemini-tts' || (media.title || '').startsWith('Narration:');
  };

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

  const updateBatchProgressItem = (pageId: string, patch: Partial<BatchProgressItem>) => {
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
    return { ...page, media: [...(page.media || []).filter(media => !isGeneratedNarrationAudioMedia(media)), newMedia] };
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
      let existingAudioSkippedCount = 0;
      let failedCount = 0;
      let quotaPaused = false;
      for (const page of pages) {
        if (!page.narration?.trim()) {
          skippedCount += 1;
          updateBatchProgressItem(page.id, { audioStatus: 'skipped', message: 'No narration script.' });
          continue;
        }
        if ((page.media || []).some(isNarrationAudioMedia) && !aiSettings.regenerateExistingAudio) {
          skippedCount += 1;
          existingAudioSkippedCount += 1;
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
            updateBatchProgressDetails(page.id, {
              audioStatus: 'pending',
              quotaPaused: true,
              retryAfterSeconds: details?.retryAfterSeconds,
              providerMessage: formatTtsErrorForUser(error, 'Batch Generate TTS'),
              message: 'Quota paused before this page was generated.',
            });
            break;
          }
          updateBatchProgressItem(page.id, {
            audioStatus: 'error',
            providerMessage: formatTtsErrorForUser(error, 'Batch Generate TTS'),
            message: 'TTS provider error.',
          });
          failedCount += 1;
          continue;
        }
      }
      updateProjectData(project => replacePagesInProject(project, pagesById));
      if (quotaPaused) {
        alert(`Batch TTS paused. Generated audio for ${generatedCount} page${generatedCount === 1 ? '' : 's'} and skipped ${skippedCount}. Completed pages were saved. Resume later after the provider retry window, or after IT raises the Azure OpenAI deployment quota.`);
      } else if (generatedCount === 0 && existingAudioSkippedCount > 0) {
        alert(`Batch TTS complete. No new audio was generated because ${existingAudioSkippedCount} page${existingAudioSkippedCount === 1 ? ' already has' : 's already have'} narration audio. Turn on "Regenerate existing narration audio" in AI Settings if you want to replace it.`);
      } else if (failedCount > 0) {
        alert(`Batch TTS finished with errors. Generated audio for ${generatedCount} page${generatedCount === 1 ? '' : 's'}, skipped ${skippedCount}, and failed ${failedCount}. Open Batch Progress for the provider message on each failed page.`);
      } else {
        alert(`Batch TTS complete. Generated audio for ${generatedCount} page${generatedCount === 1 ? '' : 's'} and skipped ${skippedCount}.`);
      }
    } catch (error: any) {
      console.error(error);
      alert(`Batch TTS failed:\n\n${formatTtsErrorForUser(error, 'Batch Generate TTS')}`);
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

  const addAITopic = (partialTopic: Partial<Topic>) => {
    updateProjectData(prev => {
        const newTopic: Topic = {
            id: `topic-${Date.now()}`,
            title: partialTopic.title || 'New Topic',
            content: partialTopic.content || '',
            narration: partialTopic.narration || '',
            duration: 5,
            imageKeywords: [],
            imagePrompts: partialTopic.imagePrompts || [],
            media: [],
            knowledgeCheck: partialTopic.knowledgeCheck
        };
        return {
            ...prev,
            courseContent: {
                ...prev.courseContent,
                topics: [...prev.courseContent.topics, newTopic]
            }
        };
    });
    // @ts-ignore
    if(context?.projectData) {
       setView('topic-list');
    }
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
                    <button 
                        onClick={() => setIsAIMode(true)}
                        className="bg-purple-600 text-white px-4 py-2 rounded shadow hover:bg-purple-700 flex items-center gap-2"
                    >
                        <PlusCircle className="w-4 h-4" /> AI Generator
                    </button>
                 </div>
                 <div className="space-y-2">
                     {projectData.courseContent.topics.map((t, i) => (
                          <div key={t.id} className="p-4 bg-white border border-slate-200 rounded flex justify-between items-center hover:shadow-sm transition-shadow">
                              <span className="font-medium text-slate-700">{i + 1}. {t.title}</span>
                              <div className="flex items-center gap-2">
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
                      ))}
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
                                    outputTheme: e.target.value as 'dark-violet' | 'legacy-green',
                                }
                            }))}
                            className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:ring-2 focus:ring-purple-500 focus:outline-none"
                        >
                            <option value="dark-violet">Dark violet (default)</option>
                            <option value="legacy-green">Legacy green styleguide</option>
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

  // Login / Load Screen
  if (!context && view !== 'project-select') {
    return (
      <div className="theme-dark min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
         <div className="bg-white p-10 rounded-xl shadow-xl max-w-lg w-full text-center space-y-6">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <FolderOpen className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800">SCORM Architect Pro</h1>
            <p className="text-slate-500 text-sm">
                Open your project <strong>folder</strong>. The app will detect the <code>.scormproj</code> file and the <code>media</code> folder automatically.
            </p>
            
            <button 
                onClick={handleOpenFolder}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
            >
                <FolderOpen className="w-5 h-5" />
                Open Project Folder
            </button>
            <button 
                onClick={() => setIsNewCourseOpen(true)}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
            >
                <FilePlus2 className="w-5 h-5" />
                Create New Course
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

            {error && (
                <div className="p-3 bg-red-50 text-red-600 text-sm rounded flex items-center gap-2 justify-center border border-red-100">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            
            <p className="text-xs text-slate-400 mt-4">
              Direct folder access is used when the browser allows it. Otherwise, the app opens the folder in browser-session mode and downloads the updated project file when you save.
            </p>
         </div>
          <NewCourseModal
             isOpen={isNewCourseOpen}
             isCreating={isCreatingCourse}
             error={newCourseError}
             status={newCourseStatus}
             progress={newCourseProgress}
             aiSettings={aiSettings}
             allowPowerPointImport={Boolean(rootEnvironment && !rootEnvironment.isSandbox)}
             onClose={() => setIsNewCourseOpen(false)}
             onCreate={handleCreateNewCourse}
          />
      </div>
    );
  }

  if (!isSiteUnlocked) {
    return <PasswordGate onUnlock={() => setIsSiteUnlocked(true)} />;
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
                    allowPowerPointImport={Boolean(rootEnvironment && !rootEnvironment.isSandbox)}
                    onClose={() => setIsNewCourseOpen(false)}
                    onCreate={handleCreateNewCourse}
                />
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
                 BROWSER SESSION: Changes stay in memory and the updated project file downloads on Save.
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

      {/* Floating Export Button if authenticated */}
      <div className="fixed bottom-6 right-6">
         <button
           onClick={handleExportScorm}
           disabled={isExporting || isScanning}
           className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-3 font-semibold transition-all hover:scale-105 disabled:opacity-50"
         >
           {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
           Export SCORM Package
         </button>
      </div>

      {isAIMode && (
        <AIGeneratorModal 
          onClose={() => setIsAIMode(false)} 
          onTopicGenerated={addAITopic}
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
        allowPowerPointImport={Boolean(context && !context.isSandbox)}
        onClose={() => setIsNewCourseOpen(false)}
        onCreate={handleCreateNewCourse}
      />
    </div>
  );
};

export default App;
