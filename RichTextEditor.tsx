import React, { useRef, useEffect, useState } from 'react';
import { Code, Eye, Bold, Italic, List, Type, AlignLeft, ImagePlus, Youtube } from 'lucide-react';
import { MediaSearchModal } from './MediaSearchModal';
import { AISettings } from '../types';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  aiSettings?: AISettings;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, label, placeholder, className, aiSettings }) => {
  const [isSourceMode, setIsSourceMode] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const [isMediaSearchOpen, setIsMediaSearchOpen] = useState(false);
  const [savedRange, setSavedRange] = useState<Range | null>(null);

  // Sync external changes to local state (e.g., when switching topics)
  useEffect(() => {
     // If value is exactly localValue, it likely came from our own handleInput
     // If they differ, we sync localValue and potentially update the DOM
     if (value !== localValue) {
        setLocalValue(value);
        if (contentRef.current && !isSourceMode) {
             // Browser-normalized HTML check:
             // We compare the content directly. If common browsers change things like quotes or whitespace,
             // we avoid a full re-render unless the actual semantic content is different.
             if (contentRef.current.innerHTML !== value) {
                 contentRef.current.innerHTML = value;
             }
        }
     }
  }, [value, isSourceMode]);

  const handleInput = () => {
    if (contentRef.current) {
      const html = contentRef.current.innerHTML;
      if (html !== localValue) {
        setLocalValue(html);
        onChange(html);
      }
    }
  };

  const execCmd = (command: string, cmdValue: string | undefined = undefined) => {
    document.execCommand(command, false, cmdValue);
    if(contentRef.current) contentRef.current.focus();
    handleInput();
  };

  const insertAtCursor = (html: string) => {
    if (!contentRef.current) return;
    contentRef.current.focus();

    const selection = window.getSelection();
    let range: Range | null = null;

    if (savedRange) {
        range = savedRange;
    } else if (selection && selection.rangeCount > 0) {
        range = selection.getRangeAt(0);
    }

    if (range && contentRef.current.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const el = document.createElement("div");
        el.innerHTML = html;
        const frag = document.createDocumentFragment();
        let node, lastNode;
        while ((node = el.firstChild)) {
            lastNode = frag.appendChild(node);
        }
        range.insertNode(frag);
        
        // Preserve selection after insertion
        if (lastNode) {
            range = range.cloneRange();
            range.setStartAfter(lastNode);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        }
    } else {
        // Fallback: append to end
        contentRef.current.innerHTML += html;
    }
    
    handleInput();
    setSavedRange(null);
  };

  return (
    <div className={`border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm flex flex-col ${className || 'min-h-[400px]'}`}>
      {/* Toolbar */}
      <div className="bg-slate-50 border-b border-slate-200 p-2 flex justify-between items-center select-none">
        <div className="flex items-center gap-1">
             {label && <span className="text-xs font-bold text-slate-500 uppercase mr-3">{label}</span>}
             {!isSourceMode && (
                 <>
                    <button onClick={() => execCmd('formatBlock', 'H2')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Heading 2">
                        <Type className="w-4 h-4" />
                    </button>
                    <button onClick={() => execCmd('bold')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Bold">
                        <Bold className="w-4 h-4" />
                    </button>
                    <button onClick={() => execCmd('italic')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Italic">
                        <Italic className="w-4 h-4" />
                    </button>
                    <div className="w-px h-4 bg-slate-300 mx-1"></div>
                    <button onClick={() => execCmd('insertUnorderedList')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Bullet List">
                        <List className="w-4 h-4" />
                    </button>
                    <div className="w-px h-4 bg-slate-300 mx-1"></div>
                    <button 
                        onClick={() => {
                            const selection = window.getSelection();
                            if (selection && selection.rangeCount > 0) {
                                setSavedRange(selection.getRangeAt(0));
                            } else {
                                setSavedRange(null);
                            }
                            setIsMediaSearchOpen(true);
                        }}
                        className="p-1.5 hover:bg-blue-100 rounded text-blue-600 flex items-center gap-1.5 text-xs font-semibold px-3 border border-blue-200 bg-blue-50 transition-colors ml-2"
                        title="Search and Insert Media"
                    >
                        <ImagePlus className="w-4 h-4" />
                        <span>Search Images & YouTube</span>
                    </button>
                 </>
             )}
        </div>
        <button 
            onClick={() => setIsSourceMode(!isSourceMode)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
        >
            {isSourceMode ? <Eye className="w-3 h-3" /> : <Code className="w-3 h-3" />}
            {isSourceMode ? 'Visual Editor' : 'Source Code'}
        </button>
      </div>

      {/* Editor Area */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
         {isSourceMode ? (
             <textarea
                value={localValue}
                onChange={(e) => {
                    setLocalValue(e.target.value);
                    onChange(e.target.value);
                }}
                className="w-full h-full p-4 font-mono text-sm resize-none focus:outline-none bg-slate-50 text-slate-800"
                placeholder={placeholder}
             />
         ) : (
             <div
                ref={contentRef}
                contentEditable
                onInput={handleInput}
                className="flex-1 w-full p-6 focus:outline-none overflow-y-auto [&>h1]:text-3xl [&>h1]:font-bold [&>h1]:mb-4 [&>h2]:text-2xl [&>h2]:font-bold [&>h2]:mb-3 [&>h3]:text-xl [&>h3]:font-bold [&>h3]:mb-2 [&>p]:mb-3 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 text-slate-800"
                dangerouslySetInnerHTML={{ __html: value }}
             />
         )}
      </div>

      {/* Media Search Modal */}
      {aiSettings && (
          <MediaSearchModal 
              isOpen={isMediaSearchOpen}
              onClose={() => setIsMediaSearchOpen(false)}
              settings={aiSettings}
              onInsertImage={(url, alt) => {
                  const imgHtml = `<img src="${url}" alt="${alt}" style="max-width: 100%; height: auto; border-radius: 8px; margin: 1rem 0; display: block;" />`;
                  insertAtCursor(imgHtml);
              }}
              onInsertVideo={(video, startTime, endTime) => {
                  const videoId = video.id?.videoId;
                  const title = video.snippet?.title || 'YouTube Video';
                  const src = `https://www.youtube.com/embed/${videoId}?start=${startTime}${endTime > 0 ? `&end=${endTime}` : ''}`;
                  
                  const formatSecs = (s: number) => {
                    const m = Math.floor(s / 60);
                    const sc = s % 60;
                    return `${m}:${sc.toString().padStart(2, '0')}`;
                  };

                  const timingInfo = startTime > 0 || endTime > 0 
                    ? ` • Starts at ${formatSecs(startTime)}${endTime > 0 ? ` until ${formatSecs(endTime)}` : ''}` 
                    : '';

                  // More robust visual block with title and timing label
                  const thumbnail = video.snippet?.thumbnails?.default?.url;
                  const iframeHtml = `
                    <p><br></p>
                    <div class="youtube-embed-container" style="margin: 1.5rem 0; font-family: sans-serif; display: block; max-width: 100%;">
                      <div style="background: #f1f5f9; padding: 10px 16px; border: 1px solid #e2e8f0; border-bottom: 0; border-radius: 10px 10px 0 0; display: flex; align-items: center; gap: 8px;">
                        ${thumbnail ? `<img src="${thumbnail}" style="width: 24px; height: 18px; object-fit: cover; border-radius: 2px;" />` : `<svg width="16" height="16" viewBox="0 0 24 24" fill="#ef4444" xmlns="http://www.w3.org/2000/svg"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon fill="white" points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg>`}
                        <span style="font-size: 13px; font-weight: 600; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}${timingInfo}</span>
                      </div>
                      <div style="padding: 1rem; background: #f8fafc; border: 1px solid #e2e8f0; border-top: 0; border-bottom: 1px solid #e2e8f0; border-radius: 0 0 10px 10px;">
                        <iframe width="560" height="315" src="${src}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="border-radius: 6px; max-width: 100%; display: block;"></iframe>
                      </div>
                    </div>
                    <p><br></p>
                  `;
                  
                  insertAtCursor(iframeHtml);
              }}
          />
      )}
    </div>
  );
};
