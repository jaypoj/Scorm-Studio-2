import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopicEditor } from './components/TopicEditor';
import { AssessmentEditor } from './components/AssessmentEditor';
import { AIGeneratorModal } from './components/AIGeneratorModal';
import { SettingsModal } from './components/SettingsModal';
import { RichTextEditor } from './components/RichTextEditor';
import { ScormManager } from './services/scormManager';
import { ScormPackager } from './services/scormPackager';
import { ScormProject, ViewState, Topic, ProjectContext, FileSystemDirectoryHandle, FileSystemFileHandle, AISettings, WelcomePage, LearningObjectivesPage, DiscoveredProject } from './types';
import { Loader2, PlusCircle, AlertTriangle, FolderOpen, Download, Box, ShieldCheck, CheckCircle2, ChevronRight } from 'lucide-react';
import { DEFAULT_GEMINI_MODEL } from './constants';
import { createVirtualFileSystem } from './utils/virtualFileSystem';

const App: React.FC = () => {
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [availableProjects, setAvailableProjects] = useState<DiscoveredProject[]>([]);
  const [rootEnvironment, setRootEnvironment] = useState<{rootHandle: FileSystemDirectoryHandle, isSandbox: boolean} | null>(null);
  const [view, setView] = useState<ViewState>('welcome');
  const [isAIMode, setIsAIMode] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Integrity Scan State
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ count: number, logs: string[] } | null>(null);

  // AI Settings State (persisted in localStorage in a real app, here state)
  const [aiSettings, setAiSettings] = useState<AISettings>(() => {
    const saved = localStorage.getItem('scorm_ai_settings');
    // Using default model constant
    return saved ? JSON.parse(saved) : { model: DEFAULT_GEMINI_MODEL };
  });

  const saveAiSettings = (s: AISettings) => {
    setAiSettings(s);
    localStorage.setItem('scorm_ai_settings', JSON.stringify(s));
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

  const processRootHandle = async (currentRootHandle: FileSystemDirectoryHandle, isSandbox: boolean, bypassAutoLoad = false) => {
      setScanResult(null); 
      let discovered: DiscoveredProject[] = [];

      const scanInternal = async (dirHandle: FileSystemDirectoryHandle, depth: number) => {
         if (depth > 5) return; // Prevent excessive depth
         
         let projectFiles: { pHandle: FileSystemFileHandle, pData: ScormProject }[] = [];
         let subDirectories: FileSystemDirectoryHandle[] = [];

         // @ts-ignore
         for await (const entry of dirHandle.values()) {
             if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.scormproj')) {
               const fileEntry = entry as FileSystemFileHandle;
               try {
                   const file = await fileEntry.getFile();
                   const text = await file.text();
                   const pData = ScormManager.parseProject(text);
                   projectFiles.push({ pHandle: fileEntry, pData });
               } catch (e) {
                   console.error("Failed to parse project file:", fileEntry.name, e);
               }
             } else if (entry.kind === 'directory') {
                 subDirectories.push(entry as FileSystemDirectoryHandle);
             }
         }

         for (const { pHandle, pData } of projectFiles) {
             let aHandle: FileSystemDirectoryHandle | null = null;
             const projectStem = pHandle.name.replace(/\.scormproj$/i, '').toLowerCase();

             // Look for a directory literally named `projectName_assets` or exactly matching the project stem
             let matchingDir = subDirectories.find(d => {
                 const name = d.name.toLowerCase();
                 return name === `${projectStem}_assets` || name === projectStem;
             });

             if (matchingDir) {
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

             discovered.push({ projectHandle: pHandle, projectData: pData, assetsHandle: aHandle });
         }

         // Look directly into subdirectories to find independent projects
         for (const subDir of subDirectories) {
              await scanInternal(subDir, depth + 1);
         }
      };

      await scanInternal(currentRootHandle, 0);

      if (discovered.length === 0) {
        throw new Error("No .scormproj files found in the selected folder.");
      }

      setRootEnvironment({ rootHandle: currentRootHandle, isSandbox });
      setAvailableProjects(discovered);

      if (discovered.length === 1 && !bypassAutoLoad) {
          loadProject(discovered[0], currentRootHandle, isSandbox);
      } else {
          setContext(null); // Clear context if any
          setView('project-select');
          setError(null);
      }
  };

  const loadProject = (proj: DiscoveredProject, rootH: FileSystemDirectoryHandle, sandbox: boolean) => {
      setContext({
          projectData: proj.projectData,
          projectHandle: proj.projectHandle,
          assetsHandle: proj.assetsHandle,
          rootHandle: rootH,
          isSandbox: sandbox
      });
      setView('welcome');
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

  // Safe File System Opener (Native API)
  const handleOpenFolder = async () => {
    if (window.self !== window.top) {
        setError("Preview Frame Detected: Please use 'Sandbox Mode' below to test in this window.");
        return;
    }

    try {
      // @ts-ignore - File System Access API
      if (!window.showDirectoryPicker) {
         throw new Error("Native File System API not supported. Use Sandbox Mode.");
      }
      // @ts-ignore
      const rootHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker();
      await processRootHandle(rootHandle, false);

    } catch (err: any) {
      if (err.name === 'SecurityError' || err.message?.includes('Security')) {
         setError("Security Error: Use Sandbox Mode below.");
      } else if (err.name !== 'AbortError') {
        setError(err.message || "Failed to access folder.");
      }
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

  const handleSave = async () => {
    if (!context || !context.projectHandle) return;
    if (isScanning) {
        alert("Please wait for integrity scan to complete.");
        return;
    }

    try {
      const finalProject = ScormManager.prepareForSave(context.projectData);
      const jsonString = JSON.stringify(finalProject, null, 2);
      
      const writable = await context.projectHandle.createWritable({ keepExistingData: false });
      await writable.write(jsonString);
      await writable.close();
      
      setContext({ ...context, projectData: finalProject });
      
      if (context.isSandbox) {
          // In Sandbox, we must download the file because we can't persist to disk
          ScormManager.downloadProject(finalProject);
          alert("Project saved to memory. Download started (Sandbox Mode).");
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
      const zipBlob = await ScormPackager.createScormPackage(context.projectData, context.assetsHandle);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${context.projectData.project.name.replace(/\s+/g, '_')}_SCORM1.2.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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
                             <button 
                                onClick={() => setView({ type: 'topic-edit', id: t.id })}
                                className="text-blue-600 text-sm hover:underline"
                             >
                                Edit
                             </button>
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
           />
        );
      }
    }

    return <div>View Not Found</div>;
  };

  // Login / Load Screen
  if (!context && view !== 'project-select') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
         <div className="bg-white p-10 rounded-xl shadow-xl max-w-lg w-full text-center space-y-6">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <FolderOpen className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800">SCORM Architect Pro</h1>
            <p className="text-slate-500 text-sm">
                Open your project <strong>folder</strong>. The app will detect the <code>.scormproj</code> file and the <code>media</code> folder automatically.
            </p>
            
            {/* Native Open Button */}
            <button 
                onClick={handleOpenFolder}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
            >
                <FolderOpen className="w-5 h-5" />
                Open Folder (Native)
            </button>
            
            <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink-0 mx-4 text-slate-400 text-xs uppercase">or</span>
                <div className="flex-grow border-t border-slate-200"></div>
            </div>
            
            {/* Sandbox Open Button */}
            <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg shadow-sm border border-slate-300 transition-all flex items-center justify-center gap-2"
            >
                <Box className="w-5 h-5" />
                Open Sandbox (Preview Mode)
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
              <strong>Native Mode:</strong> Requires Chrome/Edge & top-level window.<br/>
              <strong>Sandbox Mode:</strong> Works in preview frames. Changes are downloaded on save.
            </p>
         </div>
      </div>
    );
  }

  // Project Select Screen
  if (!context && view === 'project-select') {
     return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center py-12 px-6">
            <div className="max-w-4xl w-full">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-slate-800">Select Project to Load</h1>
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
                </div>
            </div>
        </div>
     );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <Sidebar 
        project={context.projectData} 
        currentView={view} 
        onNavigate={setView}
        onSave={handleSave}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onCloseProject={handleCloseProject}
      />
      
      <main className="flex-1 overflow-y-auto relative">
         {/* Sandbox Indicator */}
         {context.isSandbox && (
             <div className="bg-amber-100 text-amber-800 text-xs font-bold text-center py-1 border-b border-amber-200">
                 SANDBOX MODE: Changes are stored in memory and downloaded on Save.
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
    </div>
  );
};

export default App;