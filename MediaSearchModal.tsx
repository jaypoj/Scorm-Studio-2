import React, { useState } from 'react';
import { Search, Image as ImageIcon, Youtube, X, LayoutTemplate, Loader2, Check, Clock } from 'lucide-react';
import { AISettings } from '../types';

interface MediaSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AISettings;
  onInsertImage: (url: string, alt: string) => void;
  onInsertVideo: (video: any, startTime: number, endTime: number) => void;
}

export const MediaSearchModal: React.FC<MediaSearchModalProps> = ({ isOpen, onClose, settings, onInsertImage, onInsertVideo }) => {
  const [activeTab, setActiveTab] = useState<'image' | 'video'>('image');
  const [imageProvider, setImageProvider] = useState<'openverse' | 'google' | 'wikimedia'>('openverse');
  const [query, setQuery] = useState('');
  const [imgSize, setImgSize] = useState('large'); // icon, small, medium, large, xlarge, xxlarge, huge
  const [isSearching, setIsSearching] = useState(false);
  
  // Results
  const [imageResults, setImageResults] = useState<any[]>([]);
  const [videoResults, setVideoResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Video Preview State
  const [selectedVideo, setSelectedVideo] = useState<any | null>(null);
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(0);
  const [startInput, setStartInput] = useState<string>('0:00');
  const [endInput, setEndInput] = useState<string>('');

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const parseTime = (timeStr: string) => {
    if (!timeStr) return 0;
    if (!timeStr.includes(':')) return parseInt(timeStr) || 0;
    const parts = timeStr.split(':');
    if (parts.length === 2) {
      return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
    }
    return parseInt(timeStr) || 0;
  };

  // Sync inputs when selected video changes
  React.useEffect(() => {
    if (selectedVideo) {
      setStartTime(0);
      setEndTime(0);
      setStartInput('0:00');
      setEndInput('');
    }
  }, [selectedVideo]);

  if (!isOpen) return null;

  const handleSearch = async () => {
    setError(null);
    setIsSearching(true);
    
    try {
        if (activeTab === 'image') {
            const promises: Promise<any[]>[] = [];

            const fetchWithTimeout = (url: string, timeout = 8000) => {
                return Promise.race([
                    fetch(url),
                    new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
                ]);
            };

            // Openverse
            promises.push(
                fetchWithTimeout(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}`)
                .then(res => res.json())
                .then(data => {
                    if (data.error) return [];
                    return (data.results || []).map((item: any) => ({
                        link: item.url,
                        title: item.title,
                        displayLink: item.source || 'openverse.org',
                        image: { width: item.width, height: item.height }
                    }));
                }).catch(e => { console.error("Openverse error:", e); return []; })
            );

            // Wikimedia
            promises.push(
                fetchWithTimeout(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=24&prop=imageinfo&iiprop=url|size&format=json&origin=*`)
                .then(res => res.json())
                .then(data => {
                    if (data.error) return [];
                    const pages = data.query?.pages || {};
                    return Object.values(pages).map((p: any) => {
                        const info = p.imageinfo?.[0] || {};
                        return {
                            link: info.url,
                            title: p.title.replace('File:', '').replace(/\.[^/.]+$/, ""),
                            displayLink: 'commons.wikimedia.org',
                            image: { width: info.width, height: info.height }
                        };
                    });
                }).catch(e => { console.error("Wikimedia error:", e); return []; })
            );

            // Google Custom Search
            const apiKey = settings.googleSearchApiKey || process.env.CUSTOM_GEMINI_API_KEY; 
            const engineId = settings.googleSearchEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID;
            if (apiKey && engineId && apiKey !== 'YOUR_API_KEY' && engineId !== 'YOUR_ENGINE_ID') {
                promises.push(
                    fetchWithTimeout(`https://www.googleapis.com/customsearch/v1?cx=${engineId}&q=${encodeURIComponent(query)}&searchType=image&key=${apiKey}&imgSize=${imgSize}&num=10`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.error) {
                            console.error("Google API error:", data.error);
                            return [];
                        }
                        return data.items || [];
                    }).catch(e => { console.error("Google error:", e); return []; })
                );
            }

            const resultsArrays = await Promise.all(promises);
            
            // Mix results
            const mixedResults: any[] = [];
            const maxLength = Math.max(0, ...resultsArrays.map(arr => arr.length));
            for (let i = 0; i < maxLength; i++) {
                for (const arr of resultsArrays) {
                    if (arr[i]) {
                        mixedResults.push(arr[i]);
                    }
                }
            }

            // Filter valid extensions
            const filteredResults = mixedResults.filter((item: any) => {
                if (!item.link) return false;
                const urlWithoutParams = item.link.split('?')[0].toLowerCase();
                return urlWithoutParams.endsWith('.jpg') || 
                       urlWithoutParams.endsWith('.jpeg') || 
                       urlWithoutParams.endsWith('.png') || 
                       urlWithoutParams.endsWith('.gif') || 
                       urlWithoutParams.endsWith('.svg') || 
                       urlWithoutParams.endsWith('.webp');
            });
            
            if (filteredResults.length === 0) {
                 setError("No images found for this query.");
            }
            
            setImageResults(filteredResults);
        } else {
            const keysToTry = [
                settings.googleSearchApiKey,
                process.env.API_KEY,
                process.env.GEMINI_API_KEY,
                process.env.CUSTOM_GEMINI_API_KEY
            ].filter(Boolean) as string[];

            if (keysToTry.length === 0) {
                throw new Error("No API Key is configured for YouTube Search.");
            }
            
            let lastError = null;
            let successData = null;

            for (const key of keysToTry) {
                try {
                    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=10&q=${encodeURIComponent(query)}&type=video&key=${key}`;
                    const res = await fetch(url);
                    const data = await res.json();
                    
                    if (data.error) {
                        lastError = data.error;
                        continue; // try next key
                    }
                    
                    successData = data;
                    break; // Success!
                } catch (err) {
                    lastError = err;
                }
            }

            if (!successData) {
                console.error("RAW YOUTUBE API ERROR from all keys:", lastError);
                throw new Error("Raw API Error after trying available keys:\n" + JSON.stringify(lastError, null, 2));
            }
            
            setVideoResults(successData.items || []);
            setSelectedVideo(null);
        }
    } catch (e: any) {
        setError(e.message || "An error occurred during search.");
    } finally {
        setIsSearching(false);
    }
  };

  const handleInsertVideo = () => {
      if (selectedVideo && selectedVideo.id?.videoId) {
          onInsertVideo(selectedVideo, startTime, endTime);
          onClose();
      } else if (selectedVideo) {
          setError("This selected video doesn't have a valid ID format.");
      }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center p-4 border-b border-slate-200 shrink-0">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            Media Search
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50">
           <button 
               onClick={() => { setActiveTab('image'); setError(null); }}
               className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'image' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-slate-500 hover:text-slate-700'}`}
           >
               <ImageIcon className="w-4 h-4" /> Google Images
           </button>
           <button 
               onClick={() => { setActiveTab('video'); setError(null); }}
               className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'video' ? 'text-red-600 border-b-2 border-red-600 bg-white' : 'text-slate-500 hover:text-slate-700'}`}
           >
               <Youtube className="w-4 h-4" /> YouTube Videos
           </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-slate-200 flex gap-2 items-center bg-white">
            <div className="relative flex-1">
                <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                    type="text" 
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder={activeTab === 'image' ? "Search for images..." : "Search for YouTube videos..."}
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    autoFocus
                />
            </div>
            {activeTab === 'image' && (
                <div className="flex items-center text-xs text-slate-500 max-w-[200px]">
                    Mixed results from Openverse & Wikimedia
                </div>
            )}
            <button 
                onClick={handleSearch}
                disabled={isSearching || !query}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded font-medium flex items-center justify-center min-w-[100px]"
            >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
            </button>
        </div>

        {/* Error */}
        {error && (
            <div className="p-4 bg-red-50 text-red-600 border-b border-red-100 text-sm overflow-x-auto">
                <pre className="whitespace-pre-wrap font-mono text-xs max-h-40 overflow-y-auto">{error}</pre>
            </div>
        )}

        {/* Results Area */}
        <div className="flex-1 overflow-hidden bg-slate-50 relative flex flex-col min-h-0">
            {activeTab === 'image' ? (
                <div className="flex-1 overflow-y-auto p-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {!isSearching && imageResults.map((item, index) => (
                            <div key={index} className="bg-white rounded overflow-hidden shadow border border-slate-200 group cursor-pointer hover:shadow-md hover:border-blue-300 transition-all flex flex-col">
                                <div className="aspect-video bg-slate-100 relative shrink-0">
                                    <img src={item.link} alt={item.title} className="w-full h-full object-contain" />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                        <button 
                                            onClick={() => {
                                                onInsertImage(item.link, item.title || '');
                                                onClose();
                                            }}
                                            className="bg-white text-blue-600 px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-1 shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform"
                                        >
                                            <Check className="w-4 h-4" /> Insert Image
                                        </button>
                                    </div>
                                </div>
                                <div className="p-2 flex-1">
                                    <p className="text-xs text-slate-700 line-clamp-2" title={item.title}>{item.title}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">{item.image?.width}x{item.image?.height} • {item.displayLink}</p>
                                </div>
                            </div>
                        ))}
                        {!isSearching && imageResults.length === 0 && query && !error && (
                             <div className="col-span-full py-12 text-center text-slate-500">No images found for this query.</div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex overflow-hidden">
                    {/* Column 1: Narrow Results List */}
                    <div className={`${selectedVideo ? 'w-1/4' : 'w-full'} border-r border-slate-200 overflow-y-auto h-full p-4 transition-all duration-300 bg-white`}>
                        <div className="space-y-3">
                            {!isSearching && videoResults.map((item, index) => (
                                <div 
                                    key={index} 
                                    onClick={() => {
                                        setSelectedVideo(item);
                                        setStartTime(0);
                                        setEndTime(0);
                                    }}
                                    className={`flex flex-col gap-2 p-3 rounded-lg border cursor-pointer transition-all ${selectedVideo?.id?.videoId && selectedVideo?.id?.videoId === item.id?.videoId ? 'border-red-500 bg-red-50 shadow-sm' : 'bg-white border-slate-200 hover:border-red-300 hover:shadow-sm'}`}
                                >
                                    <img src={item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url} alt={item.snippet?.title} className="w-full aspect-video object-cover rounded shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className={`font-medium text-slate-800 line-clamp-2 ${selectedVideo ? 'text-[11px]' : 'text-sm'}`}>{item.snippet?.title}</div>
                                        <div className="text-[10px] text-slate-500 mt-1">{item.snippet?.channelTitle}</div>
                                    </div>
                                </div>
                            ))}
                            {!isSearching && videoResults.length === 0 && query && !error && (
                                 <div className="py-12 text-center text-slate-500">No videos found.</div>
                            )}
                        </div>
                    </div>

                    {/* Column 2: Selected Video Preview */}
                    {selectedVideo && (
                        <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden relative group">
                            <iframe 
                                src={`https://www.youtube.com/embed/${selectedVideo.id?.videoId}?autoplay=1&start=${startTime}${endTime > 0 ? `&end=${endTime}` : ''}`} 
                                className="w-full h-full border-0" 
                                allowFullScreen 
                                title="Video Snippet Preview"
                            />
                            <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md p-2 rounded text-white text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity max-w-[200px] truncate">
                                {selectedVideo.snippet?.title}
                            </div>
                        </div>
                    )}

                    {/* Column 3: Timing Controls */}
                    {selectedVideo && (
                        <div className="w-[280px] bg-white border-l border-slate-200 flex flex-col h-full shadow-lg z-10 shrink-0">
                            <div className="p-4 flex-1 overflow-y-auto">
                                <h3 className="font-bold text-slate-800 text-sm mb-6 pb-2 border-b border-slate-100 flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-red-600" />
                                    Clip Options
                                </h3>
                                
                                <div className="space-y-6">
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                                            Start Time
                                        </label>
                                        <div className="space-y-2">
                                            <input 
                                                type="text" 
                                                value={startInput}
                                                onChange={(e) => {
                                                    setStartInput(e.target.value);
                                                    setStartTime(parseTime(e.target.value));
                                                }}
                                                onBlur={() => {
                                                    // Auto-format on blur
                                                    setStartInput(formatTime(startTime));
                                                }}
                                                className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:outline-none text-sm font-mono text-center"
                                                placeholder="0:00"
                                            />
                                            <div className="text-[10px] text-slate-400 text-right font-mono">
                                                {startTime} seconds
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                                            End Time
                                        </label>
                                        <div className="space-y-2">
                                            <input 
                                                type="text" 
                                                value={endInput}
                                                onChange={(e) => {
                                                    setEndInput(e.target.value);
                                                    setEndTime(parseTime(e.target.value));
                                                }}
                                                onBlur={() => {
                                                    // Auto-format on blur if not empty
                                                    if (endTime > 0) {
                                                        setEndInput(formatTime(endTime));
                                                    } else {
                                                        setEndInput('');
                                                    }
                                                }}
                                                className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:outline-none text-sm font-mono text-center"
                                                placeholder="End"
                                            />
                                            <div className="text-[10px] text-slate-400 text-right font-mono">
                                                {endTime > 0 ? `${endTime} seconds` : 'Plays to end'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                                        <p className="text-[10px] text-blue-700 leading-relaxed italic">
                                            Tip: Type as "min:sec" (e.g., 1:30) or raw seconds.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 bg-slate-50 border-t border-slate-200">
                                <button 
                                    onClick={handleInsertVideo}
                                    className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95 shadow-red-100"
                                >
                                    <Youtube className="w-5 h-5" />
                                    Add to Page
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
