import React, { useState, useEffect } from 'react';
import { Topic, MediaItem, FileSystemDirectoryHandle, FileSystemHandle, FileSystemFileHandle, AISettings, WelcomePage, LearningObjectivesPage, Question } from '../types';
import { Upload, Image as ImageIcon, Sparkles, Wand2, Mic, Search, BookOpen, ChevronRight, ExternalLink, Activity, X, Info, FileAudio, FileVideo, AlertCircle, Loader2, Link, CheckSquare, Plus, Trash2, CheckCircle2, XCircle, Bot, Maximize2, FileText, Play, Clock } from 'lucide-react';
import { ScormManager } from '../services/scormManager';
import { generateImageFromPrompt, transcribeAudioToVTT, researchTerm, generateDistractors } from '../services/geminiService';
import { BinaryDecoder } from '../services/binaryDecoder';
import { RichTextEditor } from './RichTextEditor';
import { MediaSearchModal } from './MediaSearchModal';

interface TopicEditorProps {
  data: Topic | WelcomePage | LearningObjectivesPage;
  onChange: (updatedData: Topic | WelcomePage | LearningObjectivesPage) => void;
  assetsHandle: FileSystemDirectoryHandle | null;
  onAssetCreate: (file: File, id: string) => Promise<void>;
  aiSettings: AISettings;
  label?: string;
}

export const TopicEditor: React.FC<TopicEditorProps> = ({ data, onChange, assetsHandle, onAssetCreate, aiSettings, label }) => {
  const [generatingImg, setGeneratingImg] = useState<number | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [showResearch, setShowResearch] = useState(false);
  const [researchTermInput, setResearchTermInput] = useState('');
  const [researchResult, setResearchResult] = useState<{definition: string, expansion: string} | null>(null);
  const [researching, setResearching] = useState(false);
  const [assetsCount, setAssetsCount] = useState<number>(0);
  
  // Knowledge Check State
  const [loadingDistractors, setLoadingDistractors] = useState<string | null>(null);
  
  // UI State
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const [isMaximizedCaption, setIsMaximizedCaption] = useState(false);
  const [isMediaSearchOpen, setIsMediaSearchOpen] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  
  // Auto-discovered items that haven't been saved to JSON yet
  const [discoveredMedia, setDiscoveredMedia] = useState<MediaItem[]>([]);

  // Helper to safely get lowercase type
  const getMediaType = (m: MediaItem): string => (m.type || '').toLowerCase();

  // Helper to check if this is a Topic page (supports KC)
  const isTopicPage = data.id.startsWith('topic-');

  // Effect to load media previews with Binary Decoding and Metadata
  useEffect(() => {
    let isMounted = true;
    
    const loadPreviewsAndDiscover = async () => {
      const logs: string[] = [];
      const filesFound: string[] = [];
      const potentiallyDiscovered: MediaItem[] = [];
      
      logs.push("Starting Media Scan & Smart Discovery...");

      // Index the assets folder once for performance and case-insensitivity
      const assetFiles = new Map<string, FileSystemFileHandle>();
      if (assetsHandle) {
          try {
             // @ts-ignore
             for await (const entryRaw of assetsHandle.values()) {
                 const entry = entryRaw as FileSystemHandle;
                 if (entry.kind === 'file') {
                     filesFound.push(entry.name);
                     // Store original name
                     assetFiles.set(entry.name, entry as FileSystemFileHandle);
                     // Store lower case name for fallback
                     assetFiles.set(entry.name.toLowerCase(), entry as FileSystemFileHandle);
                 }
             }
             logs.push(`Indexed ${filesFound.length} files in assets folder: ${assetsHandle.name}`);
             
             // --- SMART DISCOVERY PHASE ---
             for (const [key, handle] of assetFiles.entries()) {
                 const name = key as string;
                 if (name.toLowerCase().endsWith('.json')) {
                     try {
                         const file = await handle.getFile();
                         const text = await file.text();
                         const meta = JSON.parse(text);
                         
                         if (meta.page_id && meta.page_id === data.id) {
                             const storageId = meta.id || name.replace('.json', '');
                             const alreadyLinked = data.media?.some(m => m.storageId === storageId);
                             
                             if (!alreadyLinked) {
                                 potentiallyDiscovered.push({
                                     id: `discovered-${storageId}`, 
                                     storageId: storageId,
                                     type: (meta.type || 'image') as any,
                                     title: meta.original_name || storageId,
                                     url: ''
                                 });
                             }
                         }
                     } catch (err) { }
                 }
             }
          } catch (e: any) {
              console.warn("Error indexing assets folder:", e);
          }
      }
      
      if (isMounted) {
          setAssetsCount(assetFiles.size > 0 ? assetFiles.size / 2 : 0);
          setAvailableFiles(filesFound);
          if (potentiallyDiscovered.length > 0) {
              setDiscoveredMedia(potentiallyDiscovered);
          } else {
              setDiscoveredMedia([]);
          }
      }

      // Combine real media + discovered media for preview generation
      const combinedMedia = [...(data.media || []), ...potentiallyDiscovered];

      if (combinedMedia.length === 0) {
          if (isMounted) setDiagnosticLogs(logs);
          return;
      }

      const newPreviews: Record<string, string> = {};
      
      for (const media of combinedMedia) {
        // 1. Prioritize direct URLs (External or Data URIs)
        if (media.url && media.url.length > 5 && !media.url.startsWith('blob:')) {
            newPreviews[media.id] = media.url;
            if (media.url.startsWith('http') || media.url.startsWith('data:')) {
               continue;
            }
        }

        if (!media.storageId || !assetsHandle) continue;
        
        try {
             const lowerId = media.storageId.toLowerCase();
             
             // Find Binary File
             let fileHandle = 
                assetFiles.get(media.storageId) || 
                assetFiles.get(lowerId) ||
                assetFiles.get(`${media.storageId}.bin`) ||
                assetFiles.get(`${lowerId}.bin`);
             
             // Fuzzy search
             if (!fileHandle) {
                 for (const [key, handle] of assetFiles.entries()) {
                     const name = String(key);
                     if (name.startsWith(String(media.storageId)) || name.toLowerCase().startsWith(String(lowerId))) {
                         if (!name.toLowerCase().endsWith('.json')) {
                            fileHandle = handle;
                            break;
                         }
                     }
                 }
             }

             // Find Metadata for MIME type
             let explicitMimeType: string | undefined = undefined;
             const jsonHandle = assetFiles.get(`${media.storageId}.json`) || assetFiles.get(`${lowerId}.json`);

             if (jsonHandle) {
                 try {
                     const jsonFile = await jsonHandle.getFile();
                     const meta = JSON.parse(await jsonFile.text());
                     
                     if (meta.mimeType) explicitMimeType = meta.mimeType;
                     else if (meta.extension) explicitMimeType = BinaryDecoder.getMimeTypeFromExtension(meta.extension) || undefined;
                     else if (meta.type && meta.type.includes('/')) explicitMimeType = meta.type;
                 } catch (e) { }
             }

             if (fileHandle) {
                const file = await fileHandle.getFile();
                const { blob } = await BinaryDecoder.decodeMedia(file, media.type, explicitMimeType);
                newPreviews[media.id] = URL.createObjectURL(blob);
             }
        } catch (e: any) {
          console.warn("Could not load preview for", media.storageId, e);
        }
      }
      
      if (isMounted) {
          setPreviews(newPreviews);
          setDiagnosticLogs(logs);
      } else {
           Object.values(newPreviews).forEach((url: string) => {
              if (url.startsWith('blob:')) URL.revokeObjectURL(url);
           });
      }
    };

    loadPreviewsAndDiscover();
    return () => {
      isMounted = false;
      Object.values(previews as Record<string, string>).forEach((url: string) => {
          if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
    };
  }, [data.media, assetsHandle, data.id]);

  // Combine Props Data + Smart Discovery Data
  const allMedia = [...(data.media || []), ...discoveredMedia];
  const featuredImage = allMedia.find(m => getMediaType(m) === 'image');
  const featuredAudio = allMedia.find(m => getMediaType(m) === 'audio');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') ? 'audio' : 'video';
    const storageId = ScormManager.generateStorageId(type);
    
    const ext = file.name.split('.').pop() || 'bin';
    const newFileName = `${storageId}.${ext}`;
    const newFile = new File([file], newFileName, { type: file.type });
    
    await onAssetCreate(newFile, storageId);
    
    try {
        const metadata = {
            id: storageId,
            page_id: data.id,
            originalName: file.name,
            mimeType: file.type,
            extension: ext,
            created: new Date().toISOString()
        };
        const metadataFile = new File([JSON.stringify(metadata, null, 2)], `${storageId}.json`, { type: 'application/json' });
        await onAssetCreate(metadataFile, storageId);
    } catch (e) {
        console.warn("Could not create metadata file", e);
    }
    
    const newMedia: MediaItem = {
      id: `media-${Date.now()}`,
      storageId: storageId,
      type: type as any,
      title: file.name,
      url: "" 
    };
    onChange({ ...data, media: data.media ? [...data.media, newMedia] : [newMedia] });
  };

  const handleGenerateImage = async (promptIndex: number, promptText: string) => {
    setGeneratingImg(promptIndex);
    try {
       const base64Data = await generateImageFromPrompt(promptText);
       const byteCharacters = atob(base64Data);
       const byteNumbers = new Array(byteCharacters.length);
       for (let i = 0; i < byteCharacters.length; i++) {
         byteNumbers[i] = byteCharacters.charCodeAt(i);
       }
       const byteArray = new Uint8Array(byteNumbers);
       const blob = new Blob([byteArray], { type: "image/png" });
       
       const storageId = ScormManager.generateStorageId('image');
       
       const file = new File([blob], `${storageId}.png`, { type: "image/png" });
       await onAssetCreate(file, storageId);
       
       const metadata = {
            id: storageId,
            page_id: data.id,
            originalName: `ai-gen-${Date.now()}.png`,
            mimeType: "image/png",
            extension: "png",
            prompt: promptText,
            created: new Date().toISOString()
       };
       const metadataFile = new File([JSON.stringify(metadata, null, 2)], `${storageId}.json`, { type: 'application/json' });
       await onAssetCreate(metadataFile, storageId);

       const newMedia: MediaItem = {
         id: `media-${Date.now()}`,
         storageId: storageId,
         type: 'image',
         title: `AI Generated: ${promptText.substring(0, 15)}...`
       };
       onChange({ ...data, media: data.media ? [...data.media, newMedia] : [newMedia] });
    } catch (e) {
      alert("Failed to generate image. See console.");
    } finally {
      setGeneratingImg(null);
    }
  };

  const handleTranscribe = async () => {
    // 1. Find Audio
    const audioItem = allMedia.find(m => getMediaType(m) === 'audio');
    if (!audioItem) {
      alert("No audio file found attached to this page. Please upload narration audio first.");
      return;
    }

    if (!assetsHandle) {
        alert("Assets folder not linked.");
        return;
    }

    setTranscribing(true);
    try {
       let file: File | null = null;
       let explicitMimeType: string | undefined = undefined;
       
       // 2. Resolve File from FileSystem
       // @ts-ignore
       for await (const entryRaw of assetsHandle.values()) {
           const entry = entryRaw as FileSystemHandle;
           const entryName = entry.name.toLowerCase();
           const storageName = audioItem.storageId.toLowerCase();
           
           // Match logic: Exact match or prefix match (ignoring .json files)
           if ((entryName.startsWith(storageName) || entryName === `${storageName}.bin`) && !entryName.endsWith('.json')) {
               const fileHandle = await assetsHandle.getFileHandle(entry.name);
               file = await fileHandle.getFile();

               // Attempt to find metadata JSON for MIME type
               try {
                   const jsonHandle = await assetsHandle.getFileHandle(`${audioItem.storageId}.json`);
                   const jsonFile = await jsonHandle.getFile();
                   const meta = JSON.parse(await jsonFile.text());
                   if(meta.mimeType) explicitMimeType = meta.mimeType;
               } catch(e) { }

               break;
           }
       }
       
       if (!file) throw new Error(`Audio file (${audioItem.storageId}) not found on disk.`);
       
       // 3. Ensure valid MIME type for Gemini
       // Files from FileSystemAccessAPI often have "application/octet-stream" or "" if extension is .bin
       // Gemini API throws 400 for these. We must decode/sniff the real type.
       const { blob, mimeType } = await BinaryDecoder.decodeMedia(file, 'audio', explicitMimeType);
       
       // Default fallback if sniffing fails (unlikely for standard audio)
       const finalMime = (mimeType === 'application/octet-stream' || !mimeType) ? 'audio/mp3' : mimeType;
       
       const fileToSend = new File([blob], file.name, { type: finalMime });

       // 4. Send to AI
       const vtt = await transcribeAudioToVTT(fileToSend);
       
       // 5. Update Editor directly
       onChange({ ...data, caption: vtt });

    } catch (e: any) {
       console.error(e);
       alert(`Caption Generation Failed: ${e.message}`);
    } finally {
      setTranscribing(false);
    }
  };

  const handleResearch = async () => {
      if (!researchTermInput) return;
      setResearching(true);
      try {
          const result = await researchTerm(aiSettings, researchTermInput, data.content);
          setResearchResult(result);
      } catch (e) {
          alert("Research failed.");
      } finally {
          setResearching(false);
      }
  };

  const insertResearch = () => {
      if (!researchResult) return;
      const injection = `
        <div class="research-box">
            <h3>${researchTermInput}</h3>
            <p>${researchResult.definition}</p>
            ${researchResult.expansion}
        </div>
      `;
      onChange({ ...data, content: data.content + injection });
      setResearchResult(null);
      setResearchTermInput('');
  };

  const handleLinkDiscovered = () => {
      if (discoveredMedia.length > 0) {
          onChange({ 
              ...data, 
              media: [...(data.media || []), ...discoveredMedia] 
          });
          setDiscoveredMedia([]); 
      }
  };

  // --- Knowledge Check Logic ---
  const handleAddQuestion = () => {
      if (!isTopicPage) return;
      const topic = data as Topic;
      const currentQuestions = topic.knowledgeCheck?.questions || [];
      const newQ: Question = {
          id: `kc-${Date.now()}`,
          type: 'multiple-choice',
          question: 'New Knowledge Check Question',
          correctAnswer: '',
          options: ['Option 1', 'Option 2'],
          feedback: { correct: 'Correct!', incorrect: 'Incorrect, try again.' }
      };
      
      const newKnowledgeCheck = {
          ...(topic.knowledgeCheck || {}),
          questions: [...currentQuestions, newQ]
      };
      
      onChange({ ...topic, knowledgeCheck: newKnowledgeCheck });
  };

  const updateQuestion = (index: number, q: Question) => {
      if (!isTopicPage) return;
      const topic = data as Topic;
      const currentQuestions = [...(topic.knowledgeCheck?.questions || [])];
      currentQuestions[index] = q;
      onChange({ ...topic, knowledgeCheck: { ...(topic.knowledgeCheck || {}), questions: currentQuestions } });
  };

  const removeQuestion = (index: number) => {
      if (!isTopicPage) return;
      const topic = data as Topic;
      const currentQuestions = topic.knowledgeCheck?.questions || [];
      const newQuestions = currentQuestions.filter((_, i) => i !== index);
      onChange({ ...topic, knowledgeCheck: { ...(topic.knowledgeCheck || {}), questions: newQuestions } });
  };

  const handleSetMainImage = (mediaId: string) => {
      const mediaList = [...(data.media || [])];
      const index = mediaList.findIndex(m => m.id === mediaId);
      if (index > 0) {
          const [movedItem] = mediaList.splice(index, 1);
          mediaList.unshift(movedItem);
          onChange({ ...data, media: mediaList });
      } else if (index === -1) {
          const dMedia = discoveredMedia.find(m => m.id === mediaId);
          if (dMedia) {
              const newList = [dMedia, ...mediaList];
              onChange({...data, media: newList});
              setDiscoveredMedia(discoveredMedia.filter(m => m.id !== mediaId));
          }
      }
      setExpandedImage(null);
  };

  const handleDeleteMedia = async (mediaId: string, storageId: string) => {
      const isConfirmed = window.confirm("Are you sure you want to delete this media asset?");
      if (!isConfirmed) return;
      
      const newMedia = (data.media || []).filter(m => m.id !== mediaId);
      onChange({ ...data, media: newMedia });
      
      if (assetsHandle) {
          try {
              // @ts-ignore
              for await (const entry of assetsHandle.values()) {
                  if (entry.name.startsWith(storageId)) {
                      await assetsHandle.removeEntry(entry.name);
                  }
              }
          } catch (e) {
              console.log("Could not entirely delete asset files from file system. They are detached though.");
          }
      }
  };

  const handleGenerateDistractors = async (index: number, q: Question) => {
    if (!q.question || !q.correctAnswer) {
        alert("Please enter a question and a correct answer first.");
        return;
    }
    
    setLoadingDistractors(q.id);
    try {
        const distractors = await generateDistractors(aiSettings, q.question, q.correctAnswer, data.content);
        const uniqueDistractors = distractors.filter(d => d.toLowerCase() !== q.correctAnswer.toLowerCase());
        const newOptions = [q.correctAnswer, ...uniqueDistractors.slice(0, 3)];
        newOptions.sort(() => Math.random() - 0.5);
        updateQuestion(index, { ...q, options: newOptions });
    } catch (e) {
        alert("Failed to generate distractors.");
    } finally {
        setLoadingDistractors(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20 relative flex gap-4">
      {/* Maximized Caption Overlay */}
      {isMaximizedCaption && (
         <div className="fixed inset-0 bg-white z-50 p-8 flex flex-col animate-in fade-in zoom-in duration-200">
             <div className="flex justify-between items-center mb-4 pb-4 border-b">
                 <h2 className="text-xl font-bold flex items-center gap-2">
                     <FileText className="w-6 h-6 text-blue-600" />
                     Caption Editor (Full Screen)
                 </h2>
                 <button onClick={() => setIsMaximizedCaption(false)} className="p-2 hover:bg-slate-100 rounded-full">
                     <X className="w-6 h-6 text-slate-500" />
                 </button>
             </div>
             <textarea
                value={data.caption || ''}
                onChange={(e) => onChange({ ...data, caption: e.target.value })}
                className="flex-1 w-full p-6 bg-slate-50 font-mono text-sm border rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="WEBVTT..."
                spellCheck={false}
             />
             <div className="mt-2 text-right text-slate-500 font-mono">
                 {data.caption?.length || 0} characters
             </div>
         </div>
      )}

      <div className="flex-1 space-y-6">
        {/* Header */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
            <div className="flex justify-between items-start mb-2">
                <label className="block text-sm font-medium text-slate-700">{label || "Page Title"}</label>
                {discoveredMedia.length > 0 && (
                    <button 
                       onClick={handleLinkDiscovered}
                       className="text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full font-bold border border-amber-200 hover:bg-amber-100 flex items-center gap-2 animate-pulse"
                    >
                        <Link className="w-3 h-3" />
                        Link {discoveredMedia.length} Found Items
                    </button>
                )}
            </div>
            <input
            type="text"
            value={data.title}
            onChange={(e) => onChange({ ...data, title: e.target.value })}
            className="w-full text-xl font-bold border-b-2 border-slate-200 focus:border-blue-500 focus:outline-none py-2 text-slate-900 bg-white"
            />
        </div>

        {/* FEATURED MEDIA CARD */}
        {featuredImage && (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                 <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-blue-600" />
                        Featured Visual
                        {discoveredMedia.some(d => d.id === featuredImage.id) && (
                            <span className="bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full">Auto-Detected</span>
                        )}
                    </h3>
                 </div>
                 
                 <div className="relative bg-slate-100 rounded-lg overflow-hidden border border-slate-200 min-h-[200px] flex items-center justify-center">
                      {previews[featuredImage.id] ? (
                          <img 
                              src={previews[featuredImage.id]} 
                              alt="Featured" 
                              className="max-h-[400px] w-auto object-contain"
                          />
                      ) : (
                          <div className="flex flex-col items-center text-slate-400 gap-2">
                              <Loader2 className="w-8 h-8 animate-spin" />
                              <span>Loading Preview...</span>
                          </div>
                      )}
                 </div>
            </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
            <div className="relative">
                <div className="flex justify-end items-center mb-2">
                    <button 
                       onClick={() => setShowResearch(!showResearch)}
                       className={`text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors ${showResearch ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                        {showResearch ? <ChevronRight className="w-3 h-3" /> : <Search className="w-3 h-3" />}
                        {showResearch ? 'Close Research' : 'Deep Research'}
                    </button>
                </div>
                
                <RichTextEditor 
                  label="Content"
                  value={data.content}
                  onChange={(val) => onChange({ ...data, content: val })}
                  className="h-[500px]"
                  aiSettings={aiSettings}
                />
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center justify-between">
                    Narration Script
                    {featuredAudio && <span className="text-[10px] bg-green-100 text-green-800 px-2 py-0.5 rounded-full flex items-center gap-1"><Mic className="w-3 h-3"/> Audio Linked</span>}
                </h3>
                
                {/* Inline Audio Player for Narration */}
                {featuredAudio && previews[featuredAudio.id] && (
                    <div className="mb-4 bg-slate-50 p-2 rounded border border-slate-100">
                        <audio controls src={previews[featuredAudio.id]} className="w-full h-8" />
                    </div>
                )}

                <textarea
                value={data.narration || ''}
                onChange={(e) => onChange({ ...data, narration: e.target.value })}
                rows={4}
                className="w-full p-3 bg-white text-slate-900 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Script for voiceover..."
                />
            </div>

            {/* KNOWLEDGE CHECK EDITOR - Only for Topics */}
            {isTopicPage && (
                <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                     <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <CheckSquare className="w-4 h-4 text-blue-600"/>
                        Knowledge Check
                     </h3>
                     
                     <div className="space-y-6">
                        {(data as Topic).knowledgeCheck?.questions.map((q, idx) => (
                          <div key={q.id} className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                            <div className="px-4 py-2 border-b border-slate-200 flex justify-between items-center bg-slate-100">
                              <span className="text-xs font-bold text-slate-600">Q{idx + 1}</span>
                              <div className="flex items-center gap-2">
                                <select 
                                  value={q.type}
                                  onChange={(e) => updateQuestion(idx, { ...q, type: e.target.value as any })}
                                  className="text-xs border-slate-300 rounded px-1 py-0.5 bg-white"
                                >
                                  <option value="multiple-choice">Multiple Choice</option>
                                  <option value="true-false">True / False</option>
                                </select>
                                <button onClick={() => removeQuestion(idx)} className="text-slate-400 hover:text-red-500">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            
                            <div className="p-4 space-y-3">
                                <div>
                                    <input 
                                      type="text" 
                                      value={q.question}
                                      onChange={(e) => updateQuestion(idx, { ...q, question: e.target.value })}
                                      className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded text-sm focus:border-blue-500 focus:outline-none"
                                      placeholder="Enter question text..."
                                    />
                                </div>
                                {/* Question Options Logic Omitted for brevity, assumed standard */}
                            </div>
                          </div>
                        ))}
                        
                        <button 
                          onClick={handleAddQuestion}
                          className="w-full py-2 border-2 border-dashed border-slate-300 rounded text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                        >
                          <Plus className="w-4 h-4" />
                          Add Question
                        </button>
                     </div>
                </div>
            )}
            </div>

            <div className="space-y-6">
                 {/* AI Asset Studio */}
                <div className="bg-slate-900 p-6 rounded-lg shadow-lg border border-slate-800 text-white">
                    <h3 className="text-sm font-bold mb-4 flex items-center gap-2 text-purple-400">
                    <Sparkles className="w-4 h-4" />
                    AI Asset Studio
                    </h3>
                    <div className="space-y-4">
                        {data.imagePrompts?.map((prompt, i) => (
                        <div key={i} className="bg-slate-800 p-3 rounded border border-slate-700">
                            <p className="text-xs text-slate-300 mb-2 italic line-clamp-2">"{prompt}"</p>
                            <button 
                                onClick={() => handleGenerateImage(i, prompt)}
                                disabled={generatingImg === i}
                                className="w-full py-1.5 bg-purple-600 hover:bg-purple-50 text-xs font-semibold rounded flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {generatingImg === i ? <Wand2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                                Generate
                            </button>
                        </div>
                        ))}
                        {(!data.imagePrompts || data.imagePrompts.length === 0) && (
                           <p className="text-xs text-slate-500 text-center">No image prompts.</p>
                        )}
                    </div>
                </div>
                 {/* Media Manager */}
                <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center justify-between">
                    <span>Media Assets</span>
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${assetsHandle ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                        {assetsHandle ? `Linked: ${assetsHandle.name}` : 'No Access'}
                    </span>
                    </h3>
                    
                    <div className="space-y-3 mb-4 max-h-[400px] overflow-y-auto">
                    {allMedia?.map(m => {
                        const type = getMediaType(m);
                        const isImage = type === 'image';
                        const isAudio = type === 'audio';
                        const isVideo = type === 'video';
                        const isDiscovered = discoveredMedia.some(dm => dm.id === m.id);

                        return (
                            <div key={m.id} className={`flex flex-col gap-2 p-3 rounded border hover:border-blue-200 transition-colors relative ${isDiscovered ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
                                <div className="flex items-start gap-3">
                                    <div className="w-20 h-20 bg-slate-200 rounded flex items-center justify-center shrink-0 overflow-hidden border border-slate-300 relative group">
                                    {isImage && previews[m.id] ? (
                                        <img 
                                            src={previews[m.id]} 
                                            alt="preview" 
                                            onClick={() => setExpandedImage(m.id)}
                                            className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity" 
                                            title="Click to expand"
                                        />
                                    ) : isAudio ? (
                                        <FileAudio className="w-8 h-8 text-slate-500" />
                                    ) : isVideo ? (
                                        <FileVideo className="w-8 h-8 text-slate-500" />
                                    ) : (
                                        <Clock className="w-8 h-8 text-slate-500" />
                                    )}
                                    </div>
                                    <div className="overflow-hidden flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium text-slate-700 truncate" title={m.title}>{m.title || m.storageId}</p>
                                            {isDiscovered && <span className="text-[9px] bg-amber-200 text-amber-800 px-1 rounded">New</span>}
                                        </div>
                                        <p className="text-[10px] text-slate-500 truncate mb-1">ID: {m.storageId}</p>
                                    </div>
                                    <button 
                                        onClick={() => handleDeleteMedia(m.id, m.storageId)}
                                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors ml-auto top-3 right-3 shrink-0"
                                        title="Delete Media"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                                {isAudio && (
                                    <audio controls src={previews[m.id]} className="w-full h-8 mt-1" />
                                )}
                            </div>
                        );
                    })}
                    {(!allMedia || allMedia.length === 0) && (
                        <div className="text-center py-8 text-slate-400 text-xs italic bg-slate-50 rounded border border-dashed border-slate-200">
                            No media assets attached.<br/>
                            Upload or Generate below.
                        </div>
                    )}
                    </div>
                    
                    <div className="flex gap-2">
                        <label className={`flex-1 flex items-center justify-center px-4 py-3 border-2 border-dashed rounded-md transition-colors group ${assetsHandle ? 'bg-white border-slate-300 cursor-pointer hover:border-blue-400 hover:bg-blue-50' : 'bg-slate-100 border-slate-200 cursor-not-allowed'}`}>
                        <Upload className="w-5 h-5 text-slate-400 group-hover:text-blue-500 mr-2" />
                        <span className="text-sm font-medium text-slate-600 group-hover:text-blue-600">Upload</span>
                        <input type="file" className="hidden" onChange={handleFileUpload} disabled={!assetsHandle} />
                        </label>
                        
                        <button 
                            onClick={() => setShowDiagnostics(true)}
                            className="px-3 py-3 border-2 border-dashed border-slate-300 rounded-md hover:bg-slate-50 hover:border-slate-400 text-slate-500"
                            title="Run Diagnostics"
                        >
                            <Activity className="w-5 h-5" />
                        </button>
                    </div>

                    <button 
                         onClick={() => setIsMediaSearchOpen(true)}
                         className="w-full mt-2 py-2.5 border-2 border-dashed border-blue-200 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-600 font-medium flex items-center justify-center gap-2 text-sm"
                    >
                        <Search className="w-4 h-4" />
                        Search Images & YouTube
                    </button>

                </div>
                 {/* Captions AI Generator */}
                <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                            <FileText className="w-4 h-4 text-slate-500" />
                            Captions (WebVTT)
                        </h3>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => setIsMaximizedCaption(true)}
                                className="text-[10px] flex items-center gap-1 bg-slate-100 text-slate-600 px-2 py-1 rounded hover:bg-slate-200"
                                title="Maximize Editor"
                            >
                                <Maximize2 className="w-3 h-3" />
                                Expand
                            </button>
                        </div>
                    </div>

                    <div className="mb-4">
                        <button 
                            onClick={handleTranscribe}
                            disabled={transcribing || !assetsHandle || !featuredAudio}
                            className={`w-full py-3 rounded-md flex items-center justify-center gap-2 text-sm font-semibold transition-all ${
                                transcribing 
                                ? 'bg-purple-100 text-purple-700 cursor-not-allowed' 
                                : 'bg-purple-600 text-white hover:bg-purple-700 shadow-sm hover:shadow-md'
                            }`}
                        >
                            {transcribing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Generating Captions...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4" />
                                    Generate Captions from Audio
                                </>
                            )}
                        </button>
                        {!featuredAudio && (
                             <p className="text-[10px] text-amber-600 mt-2 text-center">
                                 <AlertCircle className="w-3 h-3 inline mr-1" />
                                 Attach audio file above to enable generation.
                             </p>
                        )}
                    </div>

                    <textarea
                        value={data.caption || ''}
                        onChange={(e) => onChange({ ...data, caption: e.target.value })}
                        className="w-full p-3 bg-slate-50 text-slate-900 text-xs font-mono border rounded-md focus:outline-none border-slate-200 focus:border-blue-500 min-h-[200px] resize-y"
                        placeholder="WEBVTT..."
                        spellCheck={false}
                    />
                    <div className="mt-1 text-right text-[10px] text-slate-400">
                        {data.caption?.length || 0} characters
                    </div>
                </div>
            </div>
        </div>
      </div>
      
      {/* Full Size Image Modal */}
      {expandedImage && previews[expandedImage] && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-4">
               <div className="flex justify-end w-full max-w-5xl mb-2 space-x-2">
                    <button 
                         onClick={() => handleSetMainImage(expandedImage)}
                         className="bg-purple-600 text-white px-4 py-2 rounded font-medium text-sm flex items-center gap-2 hover:bg-purple-500"
                    >
                         <CheckCircle2 className="w-4 h-4" />
                         Set as Main Image
                    </button>
                    <button onClick={() => setExpandedImage(null)} className="p-2 hover:bg-white/10 rounded text-white">
                        <X className="w-6 h-6" />
                    </button>
               </div>
               <img 
                   src={previews[expandedImage]} 
                   alt="Expanded view" 
                   className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
               />
          </div>
      )}

      {/* Diagnostics Modal */}
      {showDiagnostics && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-8">
              <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                      <h2 className="font-bold flex items-center gap-2">
                          <Activity className="w-5 h-5 text-blue-600" />
                          Asset Diagnostics
                      </h2>
                      <button onClick={() => setShowDiagnostics(false)} className="p-1 hover:bg-slate-200 rounded">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  <div className="flex-1 overflow-auto p-4 font-mono text-xs bg-slate-900 text-green-400 whitespace-pre-wrap">
                      {diagnosticLogs.map((log, i) => (
                          <div key={i} className="mb-1">{log}</div>
                      ))}
                      <div className="mt-4 pt-4 border-t border-slate-700 text-yellow-400">
                          --- All Files Found in Folder ---
                          <div className="grid grid-cols-3 gap-2 mt-2">
                              {availableFiles.map(f => (
                                  <span key={f} className="bg-slate-800 px-1">{f}</span>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Research Sidebar */}
      {showResearch && (
        <div className="w-80 bg-white border-l border-slate-200 p-4 shadow-lg flex flex-col animate-in slide-in-from-right duration-300">
           <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                 <BookOpen className="w-4 h-4 text-purple-600" />
                 Assistant
              </h3>
              <button onClick={() => setShowResearch(false)} className="text-slate-400 hover:text-slate-600">
                 <ChevronRight className="w-4 h-4" />
              </button>
           </div>
           
           <div className="space-y-4 flex-1">
               <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Research Term</label>
                  <div className="flex gap-2">
                    <input 
                       type="text" 
                       value={researchTermInput}
                       onChange={(e) => setResearchTermInput(e.target.value)}
                       className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded text-sm text-slate-900"
                       placeholder="e.g. NEC Article 500"
                    />
                    <button 
                       onClick={handleResearch}
                       disabled={researching || !researchTermInput}
                       className="p-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                    >
                       {researching ? <Sparkles className="w-4 h-4 animate-spin"/> : <Search className="w-4 h-4"/>}
                    </button>
                  </div>
               </div>

               {researchResult && (
                   <div className="bg-purple-50 p-3 rounded border border-purple-100 text-sm space-y-3">
                       <div>
                           <span className="font-bold text-purple-800 block mb-1">Definition</span>
                           <p className="text-slate-700">{researchResult.definition}</p>
                       </div>
                       <div>
                           <span className="font-bold text-purple-800 block mb-1">Details</span>
                           <div className="text-slate-700" dangerouslySetInnerHTML={{ __html: researchResult.expansion }} />
                       </div>
                       <button 
                         onClick={insertResearch}
                         className="w-full py-2 bg-white border border-purple-300 text-purple-700 rounded font-medium text-xs hover:bg-purple-100"
                       >
                         Insert into Content
                       </button>
                   </div>
               )}
           </div>
        </div>
      )}
      
      {aiSettings && (
          <MediaSearchModal 
              isOpen={isMediaSearchOpen}
              onClose={() => setIsMediaSearchOpen(false)}
              settings={aiSettings}
              onInsertImage={async (url, alt) => {
                  try {
                      // Attempt to download the image so it's packaged in the media folder
                      let finalMediaUrl = url;
                      let finalStorageId = `img-${Date.now()}`;
                      
                      if (assetsHandle && url.startsWith('http')) {
                          try {
                              const res = await fetch(url);
                              const blob = await res.blob();
                              const ext = blob.type.split('/')[1] || 'jpg';
                              const newFileName = `${finalStorageId}.${ext}`;
                              const newFile = new File([blob], newFileName, { type: blob.type });
                              
                              await onAssetCreate(newFile, finalStorageId);
                              
                              // Create metadata
                              const metadata = {
                                  id: finalStorageId,
                                  page_id: data.id,
                                  originalName: alt || newFileName,
                                  mimeType: blob.type,
                                  extension: ext,
                                  created: new Date().toISOString()
                              };
                              const metadataFile = new File([JSON.stringify(metadata, null, 2)], `${finalStorageId}.json`, { type: 'application/json' });
                              await onAssetCreate(metadataFile, finalStorageId);
                              
                              finalMediaUrl = ""; // Since we successfully saved it to assets, we will load it via BinaryDecoder
                          } catch (fetchErr) {
                              console.warn("Could not download external image to package locally, will use absolute URL", fetchErr);
                          }
                      }

                      const newMedia: MediaItem = {
                          id: `media-${Date.now()}`,
                          storageId: finalStorageId,
                          type: 'image',
                          title: alt,
                          url: finalMediaUrl
                      };
                      onChange({ ...data, media: data.media ? [...data.media, newMedia] : [newMedia] });
                  } catch (e) {
                      console.error("Failed to insert image", e);
                  }
              }}
              onInsertVideo={(video, startTime, endTime) => {
                  const videoId = video.id?.videoId;
                  const title = video.snippet?.title || 'YouTube Video';
                  const url = `https://www.youtube.com/embed/${videoId}?start=${startTime}${endTime > 0 ? `&end=${endTime}` : ''}`;
                  
                  const newMedia: MediaItem = {
                      id: `media-${Date.now()}`,
                      storageId: `external-${Date.now()}`,
                      type: 'video',
                      title: title,
                      url: url
                  };
                  onChange({ ...data, media: data.media ? [...data.media, newMedia] : [newMedia] });
              }}
          />
      )}
    </div>
  );
};