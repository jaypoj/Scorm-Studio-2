import React, { useState, useEffect } from 'react';
import { Topic, MediaItem, FileSystemDirectoryHandle, FileSystemHandle, FileSystemFileHandle, AISettings, WelcomePage, LearningObjectivesPage, Question, PronunciationConfig, PronunciationEntry, TtsSettings, BatchJobType, BatchProgressItem } from '../types';
import { Upload, Image as ImageIcon, Sparkles, Wand2, Mic, Search, BookOpen, ChevronRight, ExternalLink, Activity, X, Info, FileAudio, FileVideo, AlertCircle, Loader2, Link, CheckSquare, Plus, Trash2, CheckCircle2, XCircle, Bot, Maximize2, FileText, Play, Clock } from 'lucide-react';
import { ScormManager } from '../services/scormManager';
import { formatGeminiErrorForUser, generateImageFromPrompt, transcribeAudioToVTT, researchTerm, generateDistractors } from '../services/geminiService';
import { buildTtsDiagnosticReport, generateNarrationAudio } from '../services/ttsService';
import { BinaryDecoder } from '../services/binaryDecoder';
import { RichTextEditor } from './RichTextEditor';
import { MediaSearchModal } from './MediaSearchModal';
import { ErrorDiagnosticsModal } from './ErrorDiagnosticsModal';
import { DEFAULT_TTS_SETTINGS, OPENAI_TTS_VOICES, TTS_PACE_OPTIONS } from '../constants';
import { buildVttFromNarration, estimateNarrationDurationSeconds, readAudioDurationSeconds } from '../utils/captions';

interface TopicEditorProps {
  data: Topic | WelcomePage | LearningObjectivesPage;
  onChange: (updatedData: Topic | WelcomePage | LearningObjectivesPage) => void;
  assetsHandle: FileSystemDirectoryHandle | null;
  onAssetCreate: (file: File, id: string) => Promise<void>;
  aiSettings: AISettings;
  label?: string;
  projectId: string;
  pronunciationConfig: PronunciationConfig;
  onPronunciationConfigChange: (config: PronunciationConfig) => void;
  batchJob: BatchJobType;
  batchProgress: BatchProgressItem[];
}

export const TopicEditor: React.FC<TopicEditorProps> = ({ data, onChange, assetsHandle, onAssetCreate, aiSettings, label, projectId, pronunciationConfig, onPronunciationConfigChange, batchJob, batchProgress }) => {
  const [generatingImg, setGeneratingImg] = useState<number | null>(null);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [imageImportUrl, setImageImportUrl] = useState('');
  const [backendFailureCount, setBackendFailureCount] = useState(0);
  const [isAiRecoveryOpen, setIsAiRecoveryOpen] = useState(false);
  const [showAiMoreOptions, setShowAiMoreOptions] = useState(false);
  const [lastAiFailure, setLastAiFailure] = useState<{ action: string; message: string } | null>(null);
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
  const [ttsDiagnosticReport, setTtsDiagnosticReport] = useState<string | null>(null);
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const [isMaximizedCaption, setIsMaximizedCaption] = useState(false);
  const [isMediaSearchOpen, setIsMediaSearchOpen] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [selectedImagePromptIndexes, setSelectedImagePromptIndexes] = useState<number[]>([0, 1, 2]);
  const [customImagePrompt, setCustomImagePrompt] = useState('');
  const [isCustomImagePromptSelected, setIsCustomImagePromptSelected] = useState(false);
  const [newPronunciationTerm, setNewPronunciationTerm] = useState('');
  const [newPronunciationReplacement, setNewPronunciationReplacement] = useState('');
  
  // Auto-discovered items that haven't been saved to JSON yet
  const [discoveredMedia, setDiscoveredMedia] = useState<MediaItem[]>([]);

  const inferMediaType = (m: Partial<MediaItem>): string => {
    const explicit = String(m.type || '').toLowerCase();
    if (['image', 'audio', 'video', 'caption'].includes(explicit)) return explicit;
    const descriptor = [m.storageId, m.url, m.title].filter(Boolean).join(' ').toLowerCase();
    if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|tiff?)\b/.test(descriptor)) return 'image';
    if (/\.(mp3|wav|m4a|aac|ogg)\b/.test(descriptor)) return 'audio';
    if (/\.(mp4|webm|mov|m4v|avi|mkv)\b/.test(descriptor) || /youtube\.com\/embed|youtu\.be\//.test(descriptor)) return 'video';
    return explicit || 'image';
  };

  // Helper to safely get lowercase type
  const getMediaType = (m: MediaItem): string => inferMediaType(m);

  // Helper to check if this is a Topic page (supports KC)
  const isTopicPage = data.id.startsWith('topic-');

  const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error || 'Unknown error.');

  const isBackendOrQuotaFailure = (error: unknown) => {
    const message = getErrorMessage(error).toLowerCase();
    return message.includes('"code":500') ||
      message.includes('"code":503') ||
      message.includes('"code":429') ||
      message.includes('internal') ||
      message.includes('unavailable') ||
      message.includes('resource_exhausted') ||
      message.includes('quota exceeded') ||
      message.includes('high demand');
  };

  const getFriendlyAiFailureMessage = (error: unknown) => {
    const message = getErrorMessage(error);
    const lower = message.toLowerCase();
    if (lower.includes('azure openai tts')) {
      return 'Azure OpenAI TTS needs attention. Completed pages are saved and batch work can be resumed after settings are corrected or the provider retry window passes.';
    }
    if (lower.includes('quota exceeded') || lower.includes('resource_exhausted') || message.includes('"code":429')) {
      return 'Gemini quota was exhausted for the Google Cloud project behind this key, not just the key itself. This applies to remaining Gemini features such as image generation or uploaded-audio transcription; completed pages are saved and batch work can be resumed after quota resets.';
    }
    if (lower.includes('high demand') || lower.includes('unavailable') || message.includes('"code":503')) {
      return 'Gemini is temporarily overloaded. The app tried its fallbacks, but the backend is still unavailable.';
    }
    if (lower.includes('internal') || message.includes('"code":500')) {
      return 'Gemini returned an internal backend error. If this happens twice in a row, try a new AI Studio key or one of the alternate caption/image routes.';
    }
    return message;
  };

  const recordAiFailure = (action: string, error: unknown) => {
    const message = `${getFriendlyAiFailureMessage(error)}\n\n${formatGeminiErrorForUser(error, action)}`;
    setLastAiFailure({ action, message });
    if (!isBackendOrQuotaFailure(error)) return false;

    const nextCount = backendFailureCount + 1;
    setBackendFailureCount(nextCount);
    if (nextCount >= 2) {
      setIsAiRecoveryOpen(true);
      return true;
    }
    return false;
  };

  const clearAiFailures = () => {
    setBackendFailureCount(0);
    setLastAiFailure(null);
  };

  const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const openChatGptImage = (prompt: string) => {
    const fullPrompt = `Generate a professional training image for an e-learning course. ${prompt}`;
    openExternal(`https://chatgpt.com/?q=${encodeURIComponent(fullPrompt)}`);
  };

  const getDetachedStorageIds = (page: Topic | WelcomePage | LearningObjectivesPage = data) =>
    new Set((page.detachedMediaStorageIds || []).map(id => id.toLowerCase()));

  // Effect to load media previews with Binary Decoding and Metadata
  useEffect(() => {
    let isMounted = true;
    
    const loadPreviewsAndDiscover = async () => {
      const logs: string[] = [];
      const filesFound: string[] = [];
      const potentiallyDiscovered: MediaItem[] = [];
      const detachedStorageIds = getDetachedStorageIds();
      
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
                         
                         if (meta.page_id && meta.page_id === data.id && (!meta.project_id || meta.project_id === projectId)) {
                             const storageId = meta.storageId || meta.id || name.replace('.json', '');
                             if (detachedStorageIds.has(String(storageId).toLowerCase())) continue;
                             const alreadyLinked = data.media?.some(m => m.storageId === storageId);
                             
                             if (!alreadyLinked) {
                                 const inferredType = inferMediaType({
                                     type: meta.type,
                                     storageId,
                                     title: meta.title || meta.originalName || meta.original_name,
                                     url: meta.url,
                                 });
                                 potentiallyDiscovered.push({
                                     id: `discovered-${storageId}`, 
                                     storageId: storageId,
                                     type: inferredType as any,
                                     title: meta.title || meta.originalName || meta.original_name || storageId,
                                     url: '',
                                     candidate: Boolean(meta.candidate),
                                     source: meta.source
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
                const expectedType = getMediaType(media) as 'image' | 'audio' | 'video';
                const { blob, mimeType } = await BinaryDecoder.decodeMedia(file, expectedType, explicitMimeType);
                if (expectedType === 'image' && !mimeType.startsWith('image/')) {
                    logs.push(`Skipped ${media.storageId}: decoded MIME ${mimeType} is not an image.`);
                    continue;
                }
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
  }, [data.media, data.detachedMediaStorageIds, assetsHandle, data.id]);

  // Combine Props Data + Smart Discovery Data
  const allMedia = [...(data.media || []), ...discoveredMedia];
  const isNarrationAudio = (media: MediaItem) => getMediaType(media) === 'audio' && !media.candidate && media.source !== 'powerpoint';
  const visualMedia = allMedia.filter(m => !m.candidate && ['image', 'video'].includes(getMediaType(m)));
  const featuredAudio = allMedia.find(isNarrationAudio);
  const hasPowerPointNotes = 'notes' in data && typeof (data as Topic).notes === 'string';

  const extractGoogleImageQueries = () => {
    const stripHtml = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ');
    const stopWords = new Set([
      'about', 'above', 'across', 'after', 'again', 'also', 'because', 'before', 'being', 'course', 'define',
      'during', 'each', 'ensure', 'finally', 'first', 'focus', 'from', 'have', 'into', 'learn', 'lesson',
      'module', 'more', 'page', 'part', 'proper', 'showing', 'that', 'their', 'there', 'these', 'this',
      'through', 'using', 'when', 'where', 'which', 'while', 'will', 'with', 'working', 'your'
    ]);
    const sourceText = [
      data.title,
      ...(data.imageKeywords || []),
      ...(data.imagePrompts || []),
      stripHtml(data.content || ''),
      data.narration || ''
    ].join(' ');
    const words = sourceText
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map(word => word.replace(/^-+|-+$/g, ''))
      .filter(word => word.length > 2 && !stopWords.has(word));

    const scores = new Map<string, number>();
    const addPhrase = (phrase: string, score: number) => {
      const normalized = phrase.trim().replace(/\s+/g, ' ');
      if (!normalized || normalized.length < 4) return;
      if (normalized.split(' ').some(word => stopWords.has(word))) return;
      scores.set(normalized, (scores.get(normalized) || 0) + score);
    };

    (data.imageKeywords || []).forEach(keyword => addPhrase(keyword.toLowerCase(), 12));
    data.imagePrompts?.forEach(prompt => {
      const promptWords = prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(word => word.length > 2 && !stopWords.has(word));
      for (let i = 0; i < promptWords.length - 1; i++) addPhrase(promptWords.slice(i, i + 3).join(' '), 5);
    });

    for (let i = 0; i < words.length; i++) {
      addPhrase(words[i], 1);
      if (i < words.length - 1) addPhrase(`${words[i]} ${words[i + 1]}`, 3);
      if (i < words.length - 2) addPhrase(`${words[i]} ${words[i + 1]} ${words[i + 2]}`, 4);
    }

    const ranked = Array.from(scores.entries())
      .filter(([phrase]) => !/^\d+$/.test(phrase))
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
      .map(([phrase]) => phrase);

    return Array.from(new Set([...(data.imageKeywords || []), ...ranked, data.title].filter(Boolean))).slice(0, 4);
  };

  const googleImageQueries = extractGoogleImageQueries();
  const imagePromptSuggestions = Array.from(new Set([
    ...(data.imagePrompts || []),
    data.imagePrompts?.[0] ? `${data.imagePrompts[0]} Alternate composition with a different realistic training angle.` : `Professional training image showing ${data.title}`,
    `Clean instructional visual for ${data.title} with workplace context and realistic detail.`,
  ].filter(Boolean))).slice(0, 3);
  const selectedImagePrompts = imagePromptSuggestions
    .map((prompt, index) => ({ prompt, index }))
    .filter(item => selectedImagePromptIndexes.includes(item.index));
  useEffect(() => {
    setSelectedImagePromptIndexes(imagePromptSuggestions.map((_, index) => index));
    setCustomImagePrompt('');
    setIsCustomImagePromptSelected(false);
  }, [data.id, data.imagePrompts]);

  const openGoogleImages = (query: string) => {
    window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
  };

  const toggleImagePromptSelection = (index: number) => {
    setSelectedImagePromptIndexes(prev => prev.includes(index)
      ? prev.filter(item => item !== index)
      : [...prev, index].sort((a, b) => a - b));
  };

  const getAllSelectedImagePromptText = () => [
    ...selectedImagePrompts.map(item => item.prompt),
    ...(isCustomImagePromptSelected && customImagePrompt.trim() ? [customImagePrompt.trim()] : []),
  ];

  const getSelectedImagePromptText = () => getAllSelectedImagePromptText().join('\n\nAlternative image concept:\n');

  const handleChatGptImageGeneration = () => {
    const promptText = getSelectedImagePromptText();
    if (!promptText) {
      alert('Select at least one image prompt first.');
      return;
    }
    openChatGptImage(promptText);
  };

  const handleGeminiImageGeneration = async () => {
    const prompts = getAllSelectedImagePromptText();
    if (prompts.length === 0) {
      alert('Select at least one image prompt first.');
      return;
    }
    for (const [index, prompt] of prompts.entries()) {
      await handleGenerateImage(index, prompt);
    }
  };

  const readImageDimensions = (file: File) => new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image dimensions.'));
    };
    image.src = url;
  });

  const getImageQualityWarning = async (file: File) => {
    if (!file.type.startsWith('image/')) return null;

    const { width, height } = await readImageDimensions(file);
    const megapixels = (width * height) / 1_000_000;
    const fileSizeKb = file.size / 1024;
    const extension = file.name.split('.').pop()?.toLowerCase();
    const minSizeKb = extension === 'png' || file.type === 'image/png' ? 250 : 120;

    const issues: string[] = [];
    if (width < 1280 || height < 720) issues.push(`${width}x${height}px is below the recommended 1280x720 minimum`);
    if (megapixels < 0.9) issues.push(`${megapixels.toFixed(1)} megapixels may look soft in SCORM playback`);
    if (fileSizeKb < minSizeKb) issues.push(`${Math.round(fileSizeKb)} KB is small for a ${extension || file.type || 'image'} file`);

    return issues.length > 0 ? `This image may be low quality:\n\n${issues.join('\n')}\n\nUse it anyway?` : null;
  };

  const getSafeMediaExtension = (file: File, type: 'image' | 'audio' | 'video') => {
    const rawExtension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
    if (rawExtension && /^[a-z0-9]{2,5}$/.test(rawExtension)) return rawExtension;

    const byMime: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
      'audio/mp4': 'm4a',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
    };
    return byMime[file.type] || (type === 'image' ? 'png' : type === 'audio' ? 'wav' : 'mp4');
  };

  const confirmImageQuality = async (file: File) => {
    try {
      const warning = await getImageQualityWarning(file);
      return warning ? window.confirm(warning) : true;
    } catch (error) {
      console.warn('Could not inspect image quality', error);
      return true;
    }
  };

  const attachFileAsMedia = async (file: File, title = file.name) => {
    if (!assetsHandle) {
      alert("No asset folder linked.");
      return;
    }

    const type = file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') ? 'audio' : 'video';
    if (type === 'image' && !(await confirmImageQuality(file))) return;

    const storageId = ScormManager.generateStorageId(type);
    const ext = getSafeMediaExtension(file, type);
    const newFileName = `${storageId}.${ext}`;
    const mimeType = file.type || BinaryDecoder.getMimeTypeFromExtension(ext) || (type === 'image' ? 'image/png' : 'application/octet-stream');
    const newFile = new File([file], newFileName, { type: mimeType });

    await onAssetCreate(newFile, storageId);

    try {
      const metadata = {
        id: storageId,
        storageId,
        project_id: projectId,
        page_id: data.id,
        type,
        title,
        originalName: title,
        original_name: title,
        mimeType,
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
      storageId,
      type: type as any,
      title,
      url: ""
    };
    onChange({ ...data, media: data.media ? [...data.media, newMedia] : [newMedia] });
  };

  const attachExternalImage = (url: string, title = 'External image') => {
    const shouldUse = window.confirm("This image URL could not be downloaded into the project, so quality could not be inspected. Attach it as an external image anyway?");
    if (!shouldUse) return;

    const newMedia: MediaItem = {
      id: `media-${Date.now()}`,
      storageId: `external-image-${Date.now()}`,
      type: 'image',
      title,
      url
    };
    onChange({ ...data, media: data.media ? [...data.media, newMedia] : [newMedia] });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await attachFileAsMedia(file);
    e.target.value = '';
  };

  const importImageFromUrl = async (url = imageImportUrl.trim()) => {
    if (!url) return;
    setIsImportingImage(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Image request failed (${res.status}).`);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('The URL did not return an image.');
      const extension = blob.type.split('/')[1] || 'jpg';
      const file = new File([blob], `imported-image.${extension}`, { type: blob.type });
      await attachFileAsMedia(file, url.split('/').pop() || 'Imported image');
      setImageImportUrl('');
    } catch (error: any) {
      console.warn("Could not download image URL", error);
      attachExternalImage(url, url.split('/').pop() || 'External image');
      setImageImportUrl('');
    } finally {
      setIsImportingImage(false);
    }
  };

  const handleImageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files as FileList).find((f: File) => f.type.startsWith('image/'));
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (file) await attachFileAsMedia(file);
    else if (url) await importImageFromUrl(url);
  };

  const handleImagePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(e.clipboardData.files as FileList).find((f: File) => f.type.startsWith('image/'));
    const url = e.clipboardData.getData('text/plain');
    if (file) {
      e.preventDefault();
      await attachFileAsMedia(file, 'Pasted image');
    } else if (/^https?:\/\//i.test(url)) {
      e.preventDefault();
      await importImageFromUrl(url);
    }
  };

  const handleGenerateImage = async (promptIndex: number, promptText: string) => {
    setGeneratingImg(promptIndex);
    try {
       const base64Data = await generateImageFromPrompt(promptText, aiSettings);
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
            storageId,
            project_id: projectId,
            page_id: data.id,
            type: 'image',
            title: `AI Generated: ${promptText.substring(0, 40)}`,
            originalName: `ai-gen-${Date.now()}.png`,
            original_name: `ai-gen-${Date.now()}.png`,
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
      clearAiFailures();
    } catch (e: any) {
      console.error("Failed to generate image", e);
      const recoveryOpened = recordAiFailure('Image generation', e);
      if (!recoveryOpened) alert(`Failed to generate image:\n\n${formatGeminiErrorForUser(e, 'Image generation')}`);
    } finally {
      setGeneratingImg(null);
    }
  };

  const handleGenerateNarrationAudio = async () => {
    if (!assetsHandle) {
      alert("No asset folder linked.");
      return;
    }
    if (!data.narration?.trim()) {
      alert("Add narration script before generating audio.");
      return;
    }

    setGeneratingAudio(true);
    try {
      const audioBlob = await generateNarrationAudio(aiSettings, data.narration, pronunciationConfig.tts, pronunciationConfig.pronunciations);
      const storageId = ScormManager.generateStorageId('audio');
      const file = new File([audioBlob], `${storageId}.wav`, { type: 'audio/wav' });
      await onAssetCreate(file, storageId);

      const metadata = {
        id: storageId,
        storageId,
        project_id: projectId,
        page_id: data.id,
        type: 'audio',
        title: `Narration: ${data.title}`,
        originalName: `${storageId}.wav`,
        original_name: `${storageId}.wav`,
        mimeType: 'audio/wav',
        extension: 'wav',
        source: 'azure-openai-tts',
        created: new Date().toISOString()
      };
      const metadataFile = new File([JSON.stringify(metadata, null, 2)], `${storageId}.json`, { type: 'application/json' });
      await onAssetCreate(metadataFile, storageId);

      const newMedia: MediaItem = {
        id: `media-${Date.now()}`,
        storageId,
        type: 'audio',
        title: `Narration: ${data.title}`,
        url: '',
        source: 'azure-openai-tts'
      };
      onChange({
        ...data,
        media: [
          ...(data.media || []).filter(media => !isNarrationAudio(media)),
          newMedia
        ]
      });
      clearAiFailures();
    } catch (e: any) {
      console.error("Failed to generate narration audio", e);
      setTtsDiagnosticReport(buildTtsDiagnosticReport(e, 'Text-to-speech narration'));
      const recoveryOpened = recordAiFailure('Text-to-speech narration', e);
      if (!recoveryOpened) setIsAiRecoveryOpen(false);
    } finally {
      setGeneratingAudio(false);
    }
  };

  const updateTtsSettings = (tts: TtsSettings) => {
    onPronunciationConfigChange({ ...pronunciationConfig, tts });
  };

  const updatePronunciationEntry = (id: string, patch: Partial<PronunciationEntry>) => {
    onPronunciationConfigChange({
      ...pronunciationConfig,
      pronunciations: pronunciationConfig.pronunciations.map(entry => entry.id === id ? { ...entry, ...patch } : entry),
    });
  };

  const addPronunciationEntry = () => {
    const term = newPronunciationTerm.trim();
    const replacement = newPronunciationReplacement.trim();
    if (!term || !replacement) return;
    onPronunciationConfigChange({
      ...pronunciationConfig,
      pronunciations: [
        ...pronunciationConfig.pronunciations,
        { id: `pron-${Date.now()}`, term, replacement },
      ],
    });
    setNewPronunciationTerm('');
    setNewPronunciationReplacement('');
  };

  const removePronunciationEntry = (id: string) => {
    onPronunciationConfigChange({
      ...pronunciationConfig,
      pronunciations: pronunciationConfig.pronunciations.filter(entry => entry.id !== id),
    });
  };

  const handleTranscribe = async () => {
    // 1. Find Audio
    const audioItem = allMedia.find(isNarrationAudio);
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
       let resolvedAudioSource: string | undefined = audioItem.source;
       
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
                   if (meta.source) resolvedAudioSource = meta.source;
               } catch(e) { }

               break;
           }
       }
       
       if (!file) throw new Error(`Audio file (${audioItem.storageId}) not found on disk.`);
       
       // 3. Ensure valid MIME type for Gemini
       // Files from FileSystemAccessAPI often have "application/octet-stream" or "" if extension is .bin
       // Gemini API throws 400 for these. We must decode/sniff the real type.
       const { blob, mimeType } = await BinaryDecoder.decodeMedia(file, 'audio', explicitMimeType);
       
       const isGeneratedNarrationAudio = (resolvedAudioSource === 'azure-openai-tts' || resolvedAudioSource === 'gemini-tts' || (audioItem.title || '').startsWith('Narration:'));
       let vtt = '';

       if (isGeneratedNarrationAudio && data.narration?.trim()) {
         const durationSeconds = await readAudioDurationSeconds(blob).catch(() => estimateNarrationDurationSeconds(data.narration));
         vtt = buildVttFromNarration(data.narration, durationSeconds);
       } else {
         // Default fallback if sniffing fails (unlikely for standard audio)
         const finalMime = (mimeType === 'application/octet-stream' || !mimeType) ? 'audio/mp3' : mimeType;
         const fileToSend = new File([blob], file.name, { type: finalMime });
         vtt = await transcribeAudioToVTT(fileToSend, aiSettings);
       }
       
       // 5. Update Editor directly
       onChange({ ...data, caption: vtt });
       clearAiFailures();

    } catch (e: any) {
       console.error(e);
       const message = getErrorMessage(e);
       const friendlyMessage = message.includes('"code":503') || message.includes('UNAVAILABLE')
        ? 'Gemini is temporarily overloaded. The app tried alternate transcription models and keys, but they were unavailable too. Please try again in a few minutes.'
        : message.includes('"code":429') || message.toLowerCase().includes('quota exceeded')
          ? 'Caption generation hit the current API quota. A paid Gemini project or another transcription provider is needed for reliable high-volume captions.'
          : message;
       const recoveryOpened = recordAiFailure('Caption generation', e);
       if (!recoveryOpened) alert(`Caption Generation Failed:\n\n${formatGeminiErrorForUser(e, 'Caption generation')}\n\n${friendlyMessage}`);
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
      const isConfirmed = window.confirm("Remove this media from the current page?\n\nThe file will remain in the media folder so existing projects cannot lose saved assets.");
      if (!isConfirmed) return;

      const matchesMedia = (media: MediaItem) => media.id === mediaId || media.storageId === storageId;
      const newMedia = (data.media || []).filter(media => !matchesMedia(media));
      const detachedMediaStorageIds = Array.from(new Set([
          ...(data.detachedMediaStorageIds || []),
          storageId,
      ].filter(Boolean)));
      setDiscoveredMedia(prev => prev.filter(media => !matchesMedia(media)));
      onChange({ ...data, media: newMedia, detachedMediaStorageIds });
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

        {/* TOP VISUAL MEDIA */}
        {visualMedia.length > 0 && (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                 <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-blue-600" />
                        Visual Media
                    </h3>
                 </div>
                 
                 <div className={`grid gap-4 ${visualMedia.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
                    {visualMedia.map(media => {
                      const type = getMediaType(media);
                      const preview = previews[media.id] || media.url || '';

                      return (
                        <div key={media.id} className="relative bg-slate-100 rounded-lg overflow-hidden border border-slate-200 min-h-[220px] flex items-center justify-center">
                          {type === 'image' && preview ? (
                            <img
                              src={preview}
                              alt={media.title || 'Visual media'}
                              className="max-h-[400px] w-auto object-contain cursor-pointer"
                              onClick={() => setExpandedImage(media.id)}
                            />
                          ) : type === 'video' && preview ? (
                            preview.includes('youtube.com/embed') ? (
                              <iframe
                                src={preview}
                                className="w-full aspect-video border-0"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowFullScreen
                                title={media.title || 'Video'}
                              />
                            ) : (
                              <video controls src={preview} className="w-full aspect-video bg-black" />
                            )
                          ) : (
                            <div className="flex flex-col items-center text-slate-400 gap-2">
                              <Loader2 className="w-8 h-8 animate-spin" />
                              <span>Loading Preview...</span>
                            </div>
                          )}
                          {discoveredMedia.some(d => d.id === media.id) && (
                            <span className="absolute top-3 left-3 bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full font-bold">Auto-Detected</span>
                          )}
                        </div>
                      );
                    })}
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
                  onPasteImage={(file) => attachFileAsMedia(file, 'Pasted image')}
                  onPasteImageUrl={(url) => importImageFromUrl(url)}
                  className="h-[500px]"
                  aiSettings={aiSettings}
                />
            </div>

            {hasPowerPointNotes && (
              <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center justify-between">
                  <span>PowerPoint Notes</span>
                  <button
                    type="button"
                    onClick={() => onChange({ ...data, narration: (data as Topic).notes || data.narration })}
                    disabled={!(data as Topic).notes?.trim()}
                    className="text-[10px] bg-violet-600 text-white px-2 py-1 rounded font-semibold hover:bg-violet-700 disabled:opacity-50"
                  >
                    Use as Narration
                  </button>
                </h3>
                <textarea
                  value={(data as Topic).notes || ''}
                  onChange={(e) => onChange({ ...data, notes: e.target.value } as Topic)}
                  rows={4}
                  className="w-full p-3 bg-white text-slate-900 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-violet-500 focus:outline-none"
                  placeholder="Speaker notes imported from PowerPoint..."
                />
                <p className="mt-2 text-[11px] text-slate-500">
                  Imported slide notes stay with this page. Use them as narration when the old deck used notes for voiceover text.
                </p>
              </div>
            )}

            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center justify-between">
                    <span>Narration Script</span>
                    <span className="flex items-center gap-2">
                        {featuredAudio && <span className="text-[10px] bg-green-100 text-green-800 px-2 py-0.5 rounded-full flex items-center gap-1"><Mic className="w-3 h-3"/> Audio Linked</span>}
                        <button
                            onClick={handleGenerateNarrationAudio}
                            disabled={generatingAudio || !assetsHandle || !data.narration?.trim()}
                            className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                            title="Generate narration audio with Azure OpenAI TTS using the runtime key in AI Settings."
                        >
                            {generatingAudio ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
                            Generate TTS
                        </button>
                    </span>
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

                <div className="mt-4 border-t border-slate-100 pt-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Voice Model</label>
                            <select
                                value={pronunciationConfig.tts.voiceName || DEFAULT_TTS_SETTINGS.voiceName}
                                onChange={(e) => updateTtsSettings({ ...pronunciationConfig.tts, voiceName: e.target.value })}
                                className="w-full p-2 text-xs bg-white border border-slate-200 rounded text-slate-800"
                            >
                                {OPENAI_TTS_VOICES.map(voice => <option key={voice} value={voice}>{voice}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Speed / Pace</label>
                            <select
                                value={pronunciationConfig.tts.pace || DEFAULT_TTS_SETTINGS.pace}
                                onChange={(e) => updateTtsSettings({ ...pronunciationConfig.tts, pace: e.target.value as TtsSettings['pace'] })}
                                className="w-full p-2 text-xs bg-white border border-slate-200 rounded text-slate-800"
                            >
                                {TTS_PACE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Style Instructions</label>
                        <textarea
                            value={pronunciationConfig.tts.styleInstructions || DEFAULT_TTS_SETTINGS.styleInstructions}
                            onChange={(e) => updateTtsSettings({ ...pronunciationConfig.tts, styleInstructions: e.target.value })}
                            rows={2}
                            className="w-full p-2 text-xs bg-white border border-slate-200 rounded text-slate-800"
                            placeholder="Describe tone, delivery, and audience..."
                        />
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-md p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="text-xs font-bold text-slate-700">Pronunciation Replacements</div>
                            <div className="text-[10px] text-slate-500">Saved to project folder</div>
                        </div>
                        <div className="space-y-2">
                            {pronunciationConfig.pronunciations.map(entry => (
                                <div key={entry.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                    <input
                                        value={entry.term}
                                        onChange={(e) => updatePronunciationEntry(entry.id, { term: e.target.value })}
                                        className="min-w-0 p-2 text-xs border border-slate-200 rounded bg-white text-slate-800"
                                        placeholder="ARC"
                                    />
                                    <input
                                        value={entry.replacement}
                                        onChange={(e) => updatePronunciationEntry(entry.id, { replacement: e.target.value })}
                                        className="min-w-0 p-2 text-xs border border-slate-200 rounded bg-white text-slate-800"
                                        placeholder="A. R. C."
                                    />
                                    <button
                                        onClick={() => removePronunciationEntry(entry.id)}
                                        className="p-2 text-slate-400 hover:text-red-500"
                                        title="Remove pronunciation"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                <input
                                    value={newPronunciationTerm}
                                    onChange={(e) => setNewPronunciationTerm(e.target.value)}
                                    className="min-w-0 p-2 text-xs border border-slate-200 rounded bg-white text-slate-800"
                                    placeholder="Word / acronym"
                                />
                                <input
                                    value={newPronunciationReplacement}
                                    onChange={(e) => setNewPronunciationReplacement(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && addPronunciationEntry()}
                                    className="min-w-0 p-2 text-xs border border-slate-200 rounded bg-white text-slate-800"
                                    placeholder="Phonetic replacement"
                                />
                                <button
                                    onClick={addPronunciationEntry}
                                    className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                    disabled={!newPronunciationTerm.trim() || !newPronunciationReplacement.trim()}
                                    title="Add pronunciation"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {batchProgress.length > 0 && (
                        <div className="bg-white border border-slate-200 rounded-md p-3 space-y-2">
                            <div className="text-xs font-bold text-slate-700">Batch Progress</div>
                            {batchProgress.map(item => {
                                const audioDone = item.audioStatus === 'done';
                                const captionDone = item.captionStatus === 'done';
                                const isRunning = item.audioStatus === 'running' || item.captionStatus === 'running';
                                const message = item.providerMessage || item.message;
                                return (
                                    <div key={item.pageId} className={`rounded border p-2 text-xs ${item.quotaPaused ? 'border-amber-200 bg-amber-50' : 'border-transparent bg-slate-50'}`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate text-slate-700" title={item.title}>{item.title}</span>
                                            <span className="flex items-center gap-2 shrink-0">
                                                <span title={`Audio: ${item.audioStatus}`} className={audioDone ? 'text-green-600' : item.quotaPaused ? 'text-amber-600' : isRunning && item.audioStatus === 'running' ? 'text-blue-600' : 'text-slate-300'}>
                                                    {item.audioStatus === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
                                                </span>
                                                <span title={`Captions: ${item.captionStatus}`} className={captionDone ? 'text-green-600' : item.quotaPaused ? 'text-amber-600' : isRunning && item.captionStatus === 'running' ? 'text-purple-600' : 'text-slate-300'}>
                                                    {item.captionStatus === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                                                </span>
                                            </span>
                                        </div>
                                        {message && (
                                            <div className={item.quotaPaused ? 'mt-1 text-[11px] text-amber-800' : 'mt-1 text-[11px] text-slate-500'}>
                                                {message}
                                                {item.retryAfterSeconds ? ` Retry after about ${item.retryAfterSeconds}s.` : ''}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <p className="text-[10px] text-slate-500">Azure TTS uses the runtime key in AI Settings. Existing audio is preserved by default, and VTT is built locally from narration when possible.</p>
                </div>
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
                 {/* Media Creation */}
                <div className="bg-white p-6 rounded-lg shadow-sm border border-blue-100">
                    <h3 className="text-sm font-bold mb-4 flex items-center gap-2 text-slate-900">
                        <Sparkles className="w-4 h-4 text-blue-600" />
                        Create or Find Visuals
                    </h3>
                    <div className="space-y-3">
                        {imagePromptSuggestions.length > 0 && (
                            <>
                                <div className="space-y-2">
                                    {imagePromptSuggestions.map((prompt, i) => (
                                        <label key={i} className="flex items-start gap-2 bg-blue-50/70 p-3 rounded border border-blue-100 cursor-pointer hover:border-blue-300">
                                            <input
                                                type="checkbox"
                                                checked={selectedImagePromptIndexes.includes(i)}
                                                onChange={() => toggleImagePromptSelection(i)}
                                                className="mt-0.5 accent-blue-600"
                                            />
                                            <span className="text-xs text-slate-700 italic leading-relaxed">"{prompt}"</span>
                                        </label>
                                    ))}
                                    <label className="flex items-start gap-2 bg-white p-3 rounded border border-blue-100 cursor-pointer hover:border-blue-300">
                                        <input
                                            type="checkbox"
                                            checked={isCustomImagePromptSelected}
                                            onChange={() => setIsCustomImagePromptSelected(prev => !prev)}
                                            className="mt-0.5 accent-blue-600"
                                        />
                                        <textarea
                                            value={customImagePrompt}
                                            onChange={(e) => {
                                                setCustomImagePrompt(e.target.value);
                                                if (e.target.value.trim()) setIsCustomImagePromptSelected(true);
                                            }}
                                            rows={3}
                                            className="min-w-0 flex-1 p-2 text-xs border border-slate-200 rounded bg-white text-slate-800 focus:outline-none focus:border-blue-400"
                                            placeholder="Type or paste a custom image prompt..."
                                        />
                                    </label>
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                    <button 
                                        onClick={handleChatGptImageGeneration}
                                        className="w-full py-2 bg-slate-900 text-white hover:bg-slate-800 text-xs font-semibold rounded flex items-center justify-center gap-2"
                                    >
                                        <ExternalLink className="w-3 h-3" />
                                        Generate with ChatGPT 2.0 Image
                                    </button>
                                    <button 
                                        onClick={handleGeminiImageGeneration}
                                        disabled={generatingImg !== null}
                                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded flex items-center justify-center gap-2 disabled:opacity-50"
                                        title="Use Gemini API image generation if this project has quota"
                                    >
                                        {generatingImg !== null ? <Wand2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                                        Google Gemini
                                    </button>
                                </div>
                            </>
                        )}
                        {imagePromptSuggestions.length === 0 && (
                           <p className="text-xs text-slate-500 text-center">No image prompts.</p>
                        )}
                    </div>

                    <div
                        onDrop={handleImageDrop}
                        onDragOver={(e) => e.preventDefault()}
                        onPaste={handleImagePaste}
                        tabIndex={0}
                        className={`mt-5 p-3 rounded-md border-2 border-dashed outline-none transition-colors ${assetsHandle ? 'border-blue-200 bg-blue-50/60 focus:border-blue-400 focus:bg-blue-50' : 'border-slate-200 bg-slate-50 opacity-60'}`}
                    >
                        <div className="text-xs font-bold text-blue-900 mb-2 flex items-center gap-2">
                            <ExternalLink className="w-3 h-3" />
                            Search on Google Images
                        </div>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {googleImageQueries.map(query => (
                                <button
                                    key={query}
                                    type="button"
                                    onClick={() => openGoogleImages(query)}
                                    className="px-3 py-2 bg-white border border-blue-200 rounded text-blue-700 text-xs font-semibold hover:bg-blue-50 flex items-center gap-2 max-w-full"
                                    title={`Search Google Images for ${query}`}
                                >
                                    <ExternalLink className="w-3 h-3 shrink-0" />
                                    <span className="truncate">{query}</span>
                                </button>
                            ))}
                        </div>
                        <span className="block text-[10px] text-slate-500 mb-2">Paste or drop an image here</span>
                        <div className="flex gap-2">
                            <input
                                type="url"
                                value={imageImportUrl}
                                onChange={(e) => setImageImportUrl(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && importImageFromUrl()}
                                disabled={!assetsHandle || isImportingImage}
                                className="min-w-0 flex-1 px-3 py-2 bg-white border border-slate-200 rounded text-xs text-slate-800 focus:outline-none focus:border-blue-400"
                                placeholder="Paste image URL..."
                            />
                            <button
                                type="button"
                                onClick={() => importImageFromUrl()}
                                disabled={!assetsHandle || isImportingImage || !imageImportUrl.trim()}
                                className="px-3 py-2 bg-blue-600 text-white rounded text-xs font-semibold disabled:opacity-50"
                            >
                                {isImportingImage ? 'Importing' : 'Import'}
                            </button>
                        </div>
                    </div>
                    
                    <div className="flex gap-2">
                        <label className={`flex-1 flex items-center justify-center px-4 py-3 border-2 border-dashed rounded-md transition-colors group ${assetsHandle ? 'bg-white border-slate-300 cursor-pointer hover:border-blue-400 hover:bg-blue-50' : 'bg-slate-100 border-slate-200 cursor-not-allowed'}`}>
                        <Upload className="w-5 h-5 text-slate-400 group-hover:text-blue-500 mr-2" />
                        <span className="text-sm font-medium text-slate-600 group-hover:text-blue-600">Upload</span>
                        <input type="file" className="hidden" onChange={handleFileUpload} disabled={!assetsHandle} accept="image/*,audio/*,video/*" />
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
                        const isCandidate = Boolean(m.candidate);

                        return (
                            <div key={m.id} className={`flex flex-col gap-2 p-3 rounded border hover:border-blue-200 transition-colors relative ${isDiscovered ? 'bg-amber-50 border-amber-200' : isCandidate ? 'bg-violet-50 border-violet-200' : 'bg-slate-50 border-slate-100'}`}>
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
                                            {isCandidate && <span className="text-[9px] bg-violet-200 text-violet-800 px-1 rounded">PPT Candidate</span>}
                                        </div>
                                        <p className="text-[10px] text-slate-500 truncate mb-1">ID: {m.storageId}</p>
                                        {isCandidate && (
                                          <button
                                            type="button"
                                            onClick={() => onChange({
                                              ...data,
                                              media: (data.media || []).map(item => item.id === m.id ? { ...item, candidate: false } : item)
                                            })}
                                            className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded bg-violet-600 text-white hover:bg-violet-700"
                                          >
                                            <CheckCircle2 className="w-3 h-3" />
                                            Add to Page
                                          </button>
                                        )}
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
                            Upload or Generate above.
                        </div>
                    )}
                    </div>

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

      {ttsDiagnosticReport && (
          <ErrorDiagnosticsModal
              title="Azure OpenAI TTS Error Diagnostics"
              report={ttsDiagnosticReport}
              onClose={() => setTtsDiagnosticReport(null)}
          />
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

      {isAiRecoveryOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
              <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl border border-slate-200 overflow-hidden">
                  <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4">
                      <div>
                          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                              <AlertCircle className="w-5 h-5 text-amber-600" />
                              AI Provider Needs Attention
                          </h2>
                          <p className="text-sm text-slate-600 mt-1">
                              {lastAiFailure?.action || 'AI generation'} failed twice in a row.
                          </p>
                      </div>
                      <button onClick={() => setIsAiRecoveryOpen(false)} className="p-1 text-slate-400 hover:text-slate-700">
                          <X className="w-5 h-5" />
                      </button>
                  </div>

                  <div className="p-5 space-y-4">
                      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
                          {lastAiFailure?.message || 'The current provider returned a backend, quota, or capacity failure.'}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <button
                              onClick={() => openExternal('https://aistudio.google.com/apikey')}
                              className="p-4 text-left border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-md"
                          >
                              <div className="font-semibold text-blue-900 flex items-center gap-2">
                                  <ExternalLink className="w-4 h-4" />
                                  Get a New Gemini API Key
                              </div>
                              <p className="text-xs text-blue-800 mt-1">
                                  Create a free AI Studio key, add it to `.env.local`, then restart the app.
                              </p>
                          </button>

                          <button
                              onClick={() => openChatGptImage(data.imagePrompts?.[0] || data.title)}
                              className="p-4 text-left border border-slate-200 bg-slate-50 hover:bg-slate-100 rounded-md"
                          >
                              <div className="font-semibold text-slate-900 flex items-center gap-2">
                                  <ExternalLink className="w-4 h-4" />
                                  Use ChatGPT Images
                              </div>
                              <p className="text-xs text-slate-700 mt-1">
                                  Opens ChatGPT with a suggested image prompt for this page.
                              </p>
                          </button>
                      </div>

                      <div className="text-xs text-slate-600 space-y-2">
                          <p>Gemini quota is tracked per Google Cloud project. A second key from the same project usually shares the same exhausted quota.</p>
                          <p>Use AI Settings to paste the Azure endpoint and TTS key. The key is stored in this browser like the runtime Gemini key.</p>
                      </div>

                      <button
                          onClick={() => setShowAiMoreOptions(!showAiMoreOptions)}
                          className="text-sm font-semibold text-slate-700 hover:text-slate-950 flex items-center gap-1"
                      >
                          {showAiMoreOptions ? <ChevronRight className="w-4 h-4 rotate-90" /> : <ChevronRight className="w-4 h-4" />}
                          More Options
                      </button>

                      {showAiMoreOptions && (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <button
                                  onClick={() => openExternal('https://build.nvidia.com/nvidia/parakeet-ctc-1_1b-asr/api')}
                                  className="p-3 text-left border border-slate-200 rounded-md hover:bg-slate-50"
                              >
                                  <div className="font-semibold text-sm text-slate-900">NVIDIA Parakeet</div>
                                  <p className="text-xs text-slate-600 mt-1">ASR option, but likely needs server-side integration.</p>
                              </button>
                              <button
                                  onClick={() => openExternal('https://huggingface.co/docs/transformers.js/main/en/pipelines#automatic-speech-recognition')}
                                  className="p-3 text-left border border-slate-200 rounded-md hover:bg-slate-50"
                              >
                                  <div className="font-semibold text-sm text-slate-900">Transformers.js</div>
                                  <p className="text-xs text-slate-600 mt-1">Best free offline caption fallback using browser Whisper.</p>
                              </button>
                              <button
                                  onClick={() => openExternal('https://ai.google.dev/gemini-api/docs/rate-limits')}
                                  className="p-3 text-left border border-slate-200 rounded-md hover:bg-slate-50"
                              >
                                  <div className="font-semibold text-sm text-slate-900">Gemini Quotas</div>
                                  <p className="text-xs text-slate-600 mt-1">Check free-tier limits and billing requirements.</p>
                              </button>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
      
      {aiSettings && (
          <MediaSearchModal 
              isOpen={isMediaSearchOpen}
              onClose={() => setIsMediaSearchOpen(false)}
              settings={aiSettings}
              onInsertImage={async (url, alt, previewUrl) => {
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
                                  storageId: finalStorageId,
                                  project_id: projectId,
                                  page_id: data.id,
                                  type: 'image',
                                  title: alt || newFileName,
                                  originalName: alt || newFileName,
                                  original_name: alt || newFileName,
                                  mimeType: blob.type,
                                  extension: ext,
                                  created: new Date().toISOString()
                              };
                              const metadataFile = new File([JSON.stringify(metadata, null, 2)], `${finalStorageId}.json`, { type: 'application/json' });
                              await onAssetCreate(metadataFile, finalStorageId);
                              
                              finalMediaUrl = ""; // Since we successfully saved it to assets, we will load it via BinaryDecoder
                          } catch (fetchErr) {
                              console.warn("Could not download external image to package locally, will use absolute URL", fetchErr);
                              finalMediaUrl = previewUrl || url;
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
