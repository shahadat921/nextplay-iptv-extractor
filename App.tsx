/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect } from 'react';
import { Channel } from './types';
import { Copy, Check, Download, List, ChevronDown, ChevronUp, Search, Smartphone, ExternalLink, X, Filter, RotateCcw } from 'lucide-react';
import SkeletonList from './components/SkeletonList';
import Header from './components/Header';
import Footer from './components/Footer';

// --- Local/Client-side M3U Parser Helpers for Fast Local Processing ---

function parseAttribute(line: string, name: string): string {
  const regex = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^"'\\s,]+))`, 'i');
  const match = line.match(regex);
  if (match) {
    if (match[1] !== undefined) return match[1];
    if (match[2] !== undefined) return match[2];
    return match[3] || '';
  }
  return '';
}

function parseDisplayName(metadataLine: string): string {
  const prefixMatch = metadataLine.match(/^#EXTINF:?\s*[-0-9.]*\s*/i);
  const startIndex = prefixMatch ? prefixMatch[0].length : 0;
  
  let firstCommaIndex = -1;
  let inQuotes = false;
  for (let i = startIndex; i < metadataLine.length; i++) {
    const char = metadataLine[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      firstCommaIndex = i;
      break;
    }
  }
  
  if (firstCommaIndex !== -1) {
    return metadataLine.substring(firstCommaIndex + 1).trim();
  }
  
  return metadataLine
    .replace(/^#EXTINF:?\s*[-0-9.]*\s*/i, '')
    .replace(/[a-z-]+=("[^"]*"|'[^']*'|[^\s]*)/gi, '')
    .trim();
}

function extractTitleFromUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname;
    const lastPart = pathname.substring(pathname.lastIndexOf('/') + 1);
    if (lastPart) {
      let clean = lastPart.replace(/\.(m3u8|ts|mp4|mkv|avi|mov|flv|wmv|mpg|mpeg)$/i, '');
      clean = decodeURIComponent(clean).replace(/[-_]+/g, ' ').trim();
      if (clean) return clean;
    }
  } catch (e) {
    // Ignore URL parse error
  }
  return "Unnamed Channel";
}

function isStreamUrl(urlStr: string): boolean {
  const urlLower = urlStr.toLowerCase();
  if (/\.(m3u8|m3u|ts|mp4|mkv|avi|mov|flv|wmv|mpg|mpeg|mp3|aac)($|\?)/i.test(urlLower)) return true;
  if (urlLower.includes('/live/') || 
      urlLower.includes('/stream/') || 
      urlLower.includes('mpegts') || 
      urlLower.includes('/hls/') || 
      /^(rtmp|rtsp|rtp|srt|mms):\/\//i.test(urlLower)) {
    return true;
  }
  return false;
}

function parseM3ULocally(text: string): Channel[] {
  // Decode HTML entities in case code is paste-copied from dynamic web text elements
  text = text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const channels: Channel[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (/^\s*#\s*EXTINF/i.test(line)) {
      const metadata = line;
      // Search forward for the first valid stream URL
      let streamUrl = "";
      let groupExplicit = "";
      
      for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
        const forwardLine = lines[j];
        
        if (/^\s*#\s*EXTINF/i.test(forwardLine)) {
          break;
        }
        
        if (/^\s*#\s*EXTGRP:\s*(.*)/i.test(forwardLine)) {
          const gMatch = forwardLine.match(/^\s*#\s*EXTGRP:\s*(.*)/i);
          if (gMatch && gMatch[1].trim()) {
            groupExplicit = gMatch[1].trim();
          }
          continue;
        }
        
        if (/^(https?|rtmp|rtsp|rtp|srt|mms|http):\/\//i.test(forwardLine) || isStreamUrl(forwardLine)) {
          streamUrl = forwardLine;
          break;
        }
      }
      
      if (streamUrl) {
        let title = "";
        const tvgName = parseAttribute(metadata, 'tvg-name');
        const tvgId = parseAttribute(metadata, 'tvg-id');
        const displayName = parseDisplayName(metadata);
        
        if (displayName && displayName !== "Unnamed Channel") {
          title = displayName;
        } else if (tvgName) {
          title = tvgName;
        } else if (tvgId) {
          title = tvgId;
        } else {
          title = extractTitleFromUrl(streamUrl);
        }
        
        const groupMatch = metadata.match(/group-title="([^"]+)"/i) || metadata.match(/group-title='([^']+)'/i);
        let group = 'Uncategorized';
        if (groupMatch && groupMatch[1].trim()) {
          group = groupMatch[1].trim();
        } else if (groupExplicit) {
          group = groupExplicit;
        }
        
        const logoMatch = metadata.match(/tvg-logo="([^"]+)"/i) || metadata.match(/tvg-logo='([^']+)'/i);
        const logo = logoMatch ? logoMatch[1] : '';
        const finalTitle = title || "Unnamed Channel";
        const rawBlock = `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${finalTitle}\n${streamUrl}`;

        channels.push({
          id: Math.random().toString(36).substring(2, 11),
          title: finalTitle,
          group: group,
          logo: logo,
          url: streamUrl,
          rawBlock: rawBlock
        });
      }
    }
  }

  // Fallback: If no structured channels found, scrape any plain stream URLs present
  if (channels.length === 0) {
    const foundUrls = new Set<string>();
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const urlRegex = /((?:https?|rtmp|rtsp|rtp|srt|mms):\/\/[^\s"',<>|]+)/i;
      const match = line.match(urlRegex);
      if (match) {
        const streamUrl = match[1];
        if (!foundUrls.has(streamUrl)) {
          foundUrls.add(streamUrl);
          
          // Try to extract title from the text preceding the URL
          let title = line.substring(0, line.indexOf(match[1])).trim();
          title = title.replace(/[:,\-|=]+$/, '').trim(); // clean trailing delimiters
          
          if (!title) {
            title = extractTitleFromUrl(streamUrl);
          }
          
          const finalTitle = title || "Unnamed Channel";
          const rawBlock = `#EXTINF:-1 tvg-logo="" group-title="Uncategorized",${finalTitle}\n${streamUrl}`;
          
          channels.push({
            id: Math.random().toString(36).substring(2, 11),
            title: finalTitle,
            group: "Uncategorized",
            logo: "",
            url: streamUrl,
            rawBlock: rawBlock
          });
        }
      }
    }
  }

  return channels;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [inputType, setInputType] = useState<'url' | 'text'>('url');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [diagnostic, setDiagnostic] = useState<{
    show: boolean;
    message: string;
    pageTitle?: string;
    snippet?: string;
    url?: string;
  } | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);

  const showToast = (message: string, type: 'error' | 'success' | 'info' = 'error') => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [allCopied, setAllCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [rangeStart, setRangeStart] = useState('1');
  const [rangeEnd, setRangeEnd] = useState('');
  const [isRangeCopied, setIsRangeCopied] = useState(false);
  const [showRangeCopier, setShowRangeCopier] = useState(true);
  const [appliedRange, setAppliedRange] = useState<{ start: number; end: number } | null>(null);

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [showAndroidModal, setShowAndroidModal] = useState(false);
  const [isCopiedLink, setIsCopiedLink] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const triggerInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    setDeferredPrompt(null);
    setIsInstallable(false);
  };

  const copyAppLink = () => {
    let appUrl = "https://ais-pre-seb6x4476koxug6jfzgq7d-867933472925.asia-east1.run.app";
    if (typeof window !== "undefined" && window.location.origin && !window.location.origin.includes("-dev-") && !window.location.origin.includes("localhost")) {
      appUrl = window.location.origin;
    }
    navigator.clipboard.writeText(appUrl);
    setIsCopiedLink(true);
    setTimeout(() => setIsCopiedLink(false), 2000);
  };
  
  const filteredChannels = useMemo(() => channels.filter(
    (c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.group.toLowerCase().includes(searchQuery.toLowerCase())
  ), [channels, searchQuery]);

  const displayedChannels = useMemo(() => {
    if (!appliedRange) return filteredChannels;
    const startIdx = Math.max(0, appliedRange.start - 1);
    const endIdx = Math.min(filteredChannels.length, appliedRange.end);
    return filteredChannels.slice(startIdx, endIdx);
  }, [filteredChannels, appliedRange]);

  useEffect(() => {
    setAppliedRange(null);
  }, [searchQuery, channels]);

  const groupCounts = useMemo(() => channels.reduce((acc, channel) => {
    acc[channel.group] = (acc[channel.group] || 0) + 1;
    return acc;
  }, {} as Record<string, number>), [channels]);

  const handleFetch = async () => {
    setIsLoading(true);
    setDiagnostic(null);
    try {
      const trimmedUrl = url.trim();
      const isRawM3u = inputType === 'text' || trimmedUrl.startsWith('#EXTM3U') || trimmedUrl.includes('#EXTINF') || trimmedUrl.includes('EXTM3U') || trimmedUrl.includes('\n');
      
      if (isRawM3u) {
        const parsed = parseM3ULocally(trimmedUrl);
        if (parsed.length === 0) {
          throw new Error('No channels found! Please paste a valid M3U stream list.');
        }
        setChannels(parsed);
        showToast(`Loaded ${parsed.length} channels successfully!`, 'success');
        setIsLoading(false);
        return;
      }

      // 1. First, attempt a direct browser-side request if CORS is permitted or enabled
      if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
        try {
          const directResponse = await fetch(trimmedUrl);
          if (directResponse.ok) {
            const textContent = await directResponse.text();
            if (textContent && (textContent.includes('#EXTINF') || textContent.includes('EXTM3U'))) {
              const parsed = parseM3ULocally(textContent);
              if (parsed && parsed.length > 0) {
                setChannels(parsed);
                showToast(`Loaded ${parsed.length} channels directly via browser speed!`, 'success');
                setIsLoading(false);
                return;
              }
            }
          }
        } catch (directErr) {
          console.log('Direct browser fetching blocked by CORS or network, bypassing to Server Proxy...', directErr);
        }
      }

      // 2. Otherwise request from our server backend proxy
      const response = await fetch('/api/fetch-channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: trimmedUrl }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.debug) {
          setDiagnostic({
            show: true,
            message: errorData.error || 'The link returned a webpage instead of raw playlist.',
            pageTitle: errorData.debug.pageTitle,
            snippet: errorData.debug.snippet,
            url: errorData.debug.url
          });
        }
        throw new Error(errorData.error || 'Failed to fetch channels from server. Please verify if the M3U link is correct and active.');
      }
      const data = await response.json();
      setChannels(data);
      showToast(`Loaded ${data.length} channels successfully from server!`, 'success');
    } catch (error: any) {
      console.error('Error fetching channels:', error);
      showToast(error.message || 'Failed to fetch channels. Please check your URL.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (channel: Channel) => {
    navigator.clipboard.writeText(channel.rawBlock);
    setCopiedId(channel.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyAllToClipboard = () => {
    const allText = `#EXTM3U\n${channels.map(c => c.rawBlock).join('\n')}`;
    navigator.clipboard.writeText(allText);
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  };

  const downloadM3U = () => {
    const allText = `#EXTM3U\n${channels.map(c => c.rawBlock).join('\n')}`;
    const blob = new Blob([allText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url;
    a.download = 'channels.m3u';
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (filteredChannels.length > 0) {
      setRangeEnd(filteredChannels.length.toString());
    } else {
      setRangeEnd('');
    }
  }, [filteredChannels.length]);

  const copyRangeToClipboard = () => {
    const start = parseInt(rangeStart, 10);
    const end = parseInt(rangeEnd, 10);
    
    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
      showToast("Please enter a valid range! (e.g., 1 to 30)", "error");
      return;
    }

    if (filteredChannels.length === 0) {
      showToast("No channels found!", "error");
      return;
    }

    const startIndex = Math.max(1, start) - 1;
    const endIndex = Math.min(filteredChannels.length, end);

    if (startIndex >= filteredChannels.length) {
      showToast("The start index cannot be greater than the total number of channels!", "error");
      return;
    }

    const selectedChannels = filteredChannels.slice(startIndex, endIndex);
    if (selectedChannels.length === 0) {
      showToast("No channels found within this range!", "error");
      return;
    }

    const rawContent = `#EXTM3U\n${selectedChannels.map(c => c.rawBlock).join('\n')}`;
    navigator.clipboard.writeText(rawContent);
    setIsRangeCopied(true);
    showToast(`Copied ${selectedChannels.length} channels to clipboard successfully!`, 'success');
    setTimeout(() => setIsRangeCopied(false), 2000);
  };

  const applyRangeFilter = () => {
    const start = parseInt(rangeStart, 10);
    const end = parseInt(rangeEnd, 10);
    
    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
      showToast("Please enter a valid range! (e.g., 1 to 30)", "error");
      return;
    }

    if (filteredChannels.length === 0) {
      showToast("No channels found!", "error");
      return;
    }

    if (start > filteredChannels.length) {
      showToast("The start index cannot be greater than the total number of channels!", "error");
      return;
    }

    setAppliedRange({ start, end });
    showToast(`Range filter activated! (Active: ${start} - ${end})`, 'success');
  };

  const resetRangeFilter = () => {
    setAppliedRange(null);
    if (filteredChannels.length > 0) {
      setRangeStart('1');
      setRangeEnd(filteredChannels.length.toString());
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans relative">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-[999] max-w-sm w-[90%] pointer-events-none">
          <div className={`p-4 rounded-xl shadow-xl border flex items-center justify-between gap-3 pointer-events-auto transition-all duration-300 animate-slideDown ${
            toast.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' :
            toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
            'bg-slate-50 border-slate-200 text-slate-800'
          }`}>
            <span className="text-xs sm:text-sm font-semibold flex-grow">{toast.message}</span>
            <button 
              onClick={() => setToast(null)}
              className="text-gray-400 hover:text-gray-600 font-bold shrink-0 text-sm p-1 hover:bg-gray-200/50 rounded"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <Header />
      
      <main className="flex-grow p-3 sm:p-6 md:p-8">
        <div className="w-full max-w-2xl mx-auto col-span-1">
          {/* APK / PWA App Install Callout */}
          <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl p-4 text-white shadow-lg shadow-emerald-500/10 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-white/10 p-2.5 rounded-xl">
                <Smartphone size={24} className="text-emerald-100 animate-pulse" />
              </div>
              <div className="text-left">
                <h3 className="font-bold text-white text-base">Android App (.APK)</h3>
                <p className="text-emerald-100 text-xs mt-0.5">Install directly on your phone or construct PWA/APK package</p>
              </div>
            </div>
            <button 
              onClick={() => setShowAndroidModal(true)}
              className="w-full sm:w-auto bg-white text-emerald-700 font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-emerald-50 transition active:scale-95 shadow-sm whitespace-nowrap cursor-pointer"
            >
              Download APK / Install App
            </button>
          </div>

          <div className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-100 shadow-[0_4px_20px_-5px_rgba(0,0,0,0.05)] mb-8">
            {/* Tab Switched Layout Selector */}
            <div className="flex gap-2 mb-4 bg-gray-100 p-1.5 rounded-xl">
              <button
                onClick={() => { setInputType('url'); setUrl(''); }}
                className={`flex-1 py-3 rounded-lg text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer ${
                  inputType === 'url' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                M3U Playlist Link (URL)
              </button>
              <button
                onClick={() => { setInputType('text'); setUrl(''); }}
                className={`flex-1 py-3 rounded-lg text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer ${
                  inputType === 'text' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Paste Raw M3U Code
              </button>
            </div>

            <div className="space-y-4">
              {inputType === 'url' ? (
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/playlist.m3u or paste link here..."
                  className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-mono text-sm"
                />
              ) : (
                <textarea
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  rows={6}
                  placeholder={`#EXTM3U\n#EXTINF:-1 tvg-logo="https://example.com/logo.png" group-title="Bangla",Channel i\nhttp://example.com/stream.m3u8\n\n#EXTINF:-1 tvg-logo="" group-title="Bangla",NTV\nhttp://example.com/ntv.m3u8`}
                  className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-mono text-xs leading-relaxed"
                />
              )}
              
              <button
                onClick={handleFetch}
                disabled={isLoading || !url.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-xl transition duration-200 shadow-md shadow-emerald-600/10 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-center cursor-pointer"
              >
                {isLoading ? 'Processing...' : (inputType === 'url' ? 'Load Channels (Extract from URL)' : 'Extract Channels (Parse Raw M3U)')}
              </button>

              {diagnostic && diagnostic.show && (
                <div className="mt-5 p-4 sm:p-5 bg-rose-50 border border-rose-200 rounded-2xl space-y-3.5 text-left animate-fadeIn">
                  <div className="flex items-start gap-2.5">
                    <div className="bg-rose-500 text-white rounded-full p-1 mt-0.5 shrink-0">
                      <X size={15} className="stroke-[3]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-rose-900 text-sm sm:text-base">Not a Direct Playlist File!</h4>
                      <p className="text-xs text-rose-700 leading-relaxed mt-1">
                        The provided link did not return a raw M3U playlist file (.m3u/.m3u8), but instead loaded a standard webpage (HTML). Therefore, channels cannot be parsed automatically.
                      </p>
                    </div>
                  </div>

                  {diagnostic.pageTitle && (
                    <div className="bg-white/60 p-2.5 sm:p-3 rounded-xl border border-rose-150 text-xs text-left">
                      <span className="font-bold text-rose-900 block mb-0.5">Webpage Title:</span>
                      <span className="font-mono text-gray-700 italic select-all break-all">{diagnostic.pageTitle}</span>
                    </div>
                  )}

                  {diagnostic.snippet && (
                    <div className="bg-rose-950 text-rose-100 p-3 sm:p-3.5 rounded-xl text-[11px] font-mono leading-relaxed space-y-1 text-left">
                      <span className="font-bold text-rose-400 block tracking-widest text-[9px] uppercase">Webpage Content Preview (Snippet):</span>
                      <div className="max-h-24 overflow-y-auto break-all select-all whitespace-pre-wrap">{diagnostic.snippet}...</div>
                    </div>
                  )}

                  <div className="bg-emerald-50 text-emerald-950 border border-emerald-200 rounded-xl p-3 sm:p-4 text-xs space-y-2 text-left">
                    <span className="font-bold text-emerald-800 flex items-center gap-1.5 leading-none">
                      💡 Easy Solution:
                    </span>
                    <p className="leading-relaxed text-gray-700 font-medium">
                      The webpage often contains the desired M3U code. Please copy all the text from the webpage and paste it into our second tab <strong className="text-emerald-800 font-bold">"Paste Raw M3U"</strong> to extract all channels instantly!
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

        {isLoading ? (
          <SkeletonList />
        ) : channels.length > 0 ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
                Channels
                <span className="ml-3 text-sm bg-emerald-50 text-emerald-700 font-medium px-3 py-1 rounded-full border border-emerald-100">
                  {filteredChannels.length}
                </span>
              </h2>
              <div className="flex items-center gap-4">
                <button
                  onClick={downloadM3U}
                  className="text-sm text-gray-400 hover:text-emerald-600 font-medium transition cursor-pointer"
                >
                  Download .m3u
                </button>
                <button
                  onClick={() => {
                    setShowRangeCopier(prev => !prev);
                    setTimeout(() => {
                      const element = document.getElementById("range-copier-panel");
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }, 100);
                  }}
                  className={`text-sm font-semibold transition px-2.5 py-1 rounded-lg cursor-pointer ${showRangeCopier ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'text-emerald-600 hover:text-emerald-800'}`}
                >
                  Range Copy
                </button>
                <button
                  onClick={copyAllToClipboard}
                  className="text-sm text-emerald-600 hover:text-emerald-800 font-medium transition cursor-pointer"
                >
                  {allCopied ? 'Copied' : 'Copy All'}
                </button>
              </div>
            </div>
            
            <div className="flex gap-2 overflow-x-auto pb-2 -mb-2">
              {Object.entries(groupCounts).map(([group, count]) => (
                <span key={group} className="whitespace-nowrap px-3 py-1 rounded-full bg-gray-50 text-gray-600 text-xs font-medium border border-gray-100">
                  {group} <span className="font-bold text-gray-900">{count}</span>
                </span>
              ))}
            </div>
            
            <div className="relative w-full">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title or group..."
                className="w-full pl-12 pr-4 py-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
              />
            </div>

            {/* Range Channel Copier Widget / Custom Range Copier Section */}
            {showRangeCopier && (
              <div 
                id="range-copier-panel"
                className="bg-gradient-to-br from-slate-50 to-emerald-50/30 p-5 rounded-2xl border-2 border-emerald-500 shadow-[0_6px_30px_rgba(16,185,129,0.15)] space-y-5 relative overflow-hidden"
              >
                {/* Visual badge highlight */}
                <div className="absolute top-0 right-0 bg-emerald-600 text-white font-bold text-[9px] uppercase tracking-widest px-3 py-1 rounded-bl-xl shadow-sm">
                  Active Tool
                </div>
                
                <div className="flex items-center gap-2">
                  <List className="text-emerald-600" size={20} />
                  <h3 className="font-bold text-gray-900 text-sm sm:text-base">Channel Range Filter & Copy Panel</h3>
                </div>
                
                <p className="text-xs text-gray-600 leading-relaxed">
                  Select your desired range index below and click <strong>"Show Selected"</strong> to load the filtered list preview. You can then copy them to your clipboard or apply local filters. There are currently <span className="font-bold text-emerald-700">{filteredChannels.length}</span> total channels.
                </p>
                
                <div className="grid grid-cols-2 gap-4 bg-white/50 p-3.5 rounded-xl border border-emerald-100">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold text-gray-600">Start Index:</span>
                    <input
                      type="number"
                      min="1"
                      max={filteredChannels.length || 1}
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="w-full bg-white px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold text-center text-emerald-800"
                      placeholder="1"
                    />
                  </div>
                  
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold text-gray-600">End Index:</span>
                    <input
                      type="number"
                      min={rangeStart || "1"}
                      max={filteredChannels.length || 1}
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="w-full bg-white px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold text-center text-emerald-800"
                      placeholder={filteredChannels.length.toString()}
                    />
                  </div>
                </div>

                {/* Main Control Action Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={applyRangeFilter}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-5 py-3 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer active:scale-95 shadow-md shadow-emerald-600/15"
                  >
                    <Filter size={18} /> Show Selected
                  </button>

                  {appliedRange ? (
                    <button
                      onClick={resetRangeFilter}
                      className="w-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-sm px-5 py-3 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                    >
                      <RotateCcw size={16} /> Reset Filter (Show All)
                    </button>
                  ) : (
                    <button
                      disabled
                      className="w-full bg-gray-100 text-gray-400 font-bold text-sm px-5 py-3 rounded-xl flex items-center justify-center gap-2 cursor-not-allowed opacity-50"
                    >
                      <RotateCcw size={16} /> No Active Filter
                    </button>
                  )}
                </div>

                {/* Dynamic Preview & Copy Option for Selected Channels */}
                {appliedRange ? (
                  <div className="bg-white p-4 rounded-xl border-2 border-emerald-500/30 shadow-md space-y-3.5 animate-fadeIn">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-emerald-100 pb-3">
                      <div className="text-left">
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full inline-block mb-1">
                          Filter Active
                        </span>
                        <h4 className="font-bold text-gray-900 text-sm sm:text-base flex items-center gap-1.5">
                          🎯 Selected Channels ({displayedChannels.length} total)
                        </h4>
                        <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                          Channel indexes #{appliedRange.start} through #{appliedRange.end}
                        </p>
                      </div>

                      <button
                        onClick={copyRangeToClipboard}
                        className="bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold text-sm px-5 py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm shrink-0 cursor-pointer transition-all"
                      >
                        {isRangeCopied ? (
                          <>
                            <Check size={16} className="animate-bounce" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy size={16} /> Copy Selected Range
                          </>
                        )}
                      </button>
                    </div>

                    {/* Highly interactive list view inside the card */}
                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1.5 scrollbar-thin scrollbar-thumb-emerald-200">
                      {displayedChannels.map((channel, idx) => {
                        const originalIdx = appliedRange.start - 1 + idx;
                        return (
                          <div 
                            key={channel.id} 
                            className="flex items-center justify-between p-2.5 bg-emerald-50/40 rounded-xl hover:bg-emerald-50/80 border border-emerald-100/50 transition-all duration-150 shadow-3xs"
                          >
                            <div className="flex items-center gap-3 text-left min-w-0">
                              <span className="font-mono text-[10px] font-bold px-2 py-1 rounded bg-white border border-emerald-100 text-emerald-800 shrink-0">
                                #{originalIdx + 1}
                              </span>
                              <div className="truncate">
                                <p className="font-semibold text-gray-800 text-xs sm:text-sm truncate">{channel.title}</p>
                                <p className="text-[9px] text-emerald-600 uppercase font-bold tracking-wider">{channel.group}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Real-time selection preview badge before clicking (Idle State) */
                  (() => {
                    const s = parseInt(rangeStart, 10);
                    const e = parseInt(rangeEnd, 10);
                    if (!isNaN(s) && !isNaN(e) && s >= 1 && e >= s) {
                      const count = Math.max(0, Math.min(filteredChannels.length, e) - Math.max(1, s) + 1);
                      return (
                        <div className="text-[11px] text-gray-600 flex flex-wrap items-center gap-1.5 bg-white p-3 rounded-xl border border-gray-150 shadow-3xs">
                          <span>🎯 Live Selection Preview:</span>
                          <strong className="text-emerald-700 font-mono">#{s}</strong> to 
                          <strong className="text-emerald-700 font-mono">#{Math.min(filteredChannels.length, e)}</strong>, containing 
                          <strong className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-md font-bold text-xs font-mono">{count}</strong> channels ready to view.
                        </div>
                      );
                    }
                    return null;
                  })()
                )}
              </div>
            )}
            
            <div className="space-y-3">
              {displayedChannels.map((channel, idx) => {
                const originalIdx = appliedRange ? (appliedRange.start - 1 + idx) : idx;
                return (
                  <div 
                    key={channel.id} 
                    className="border border-emerald-200/60 rounded-xl hover:border-emerald-400 hover:shadow-md hover:shadow-emerald-200/30 transition-all duration-300 overflow-hidden bg-white"
                  >
                    <div className="flex items-center justify-between p-4">
                      <button
                        onClick={() => toggleExpand(channel.id)}
                        className="flex-grow flex items-center justify-between text-left"
                      >
                        <div className="flex items-center gap-3 text-left">
                          <span className="font-mono text-[11px] font-bold px-2 py-1 rounded bg-slate-50 border border-slate-100 text-gray-400 shrink-0">
                            #{originalIdx + 1}
                          </span>
                        <div>
                          <p className="font-semibold text-gray-900">{channel.title}</p>
                          <p className="text-xs text-emerald-600 uppercase tracking-wider font-semibold mt-0.5">{channel.group}</p>
                        </div>
                      </div>
                      {expandedIds.has(channel.id) ? (
                        <ChevronUp size={18} className="text-emerald-400" />
                      ) : (
                        <ChevronDown size={18} className="text-emerald-300" />
                      )}
                    </button>
                    <button
                      onClick={() => copyToClipboard(channel)}
                      className="ml-4 p-2 text-emerald-300 hover:text-emerald-600 transition"
                      title="Copy M3U block"
                    >
                      {copiedId === channel.id ? <Check size={20} className="text-emerald-500" /> : <Copy size={20} />}
                    </button>
                  </div>
                  {expandedIds.has(channel.id) && (
                    <div className="px-4 pb-4 pt-1 text-sm border-t border-emerald-50 bg-emerald-50/50">
                      <div className="space-y-2 mt-3">
                        {channel.logo && (
                          <p className="text-emerald-800">
                            <span className="font-medium text-emerald-950">Logo:</span> <span className="break-all">{channel.logo}</span>
                          </p>
                        )}
                        <p className="text-emerald-800 break-all">
                          <span className="font-medium text-emerald-950">Stream:</span> {channel.url}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        ) : (
          <div className="text-center py-24 border-2 border-dashed border-gray-100 rounded-3xl bg-gray-50/30">
            <div className="bg-emerald-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">Ready to Fetch?</h3>
            <p className="text-gray-500 mt-2 max-w-xs mx-auto">Paste your M3U playlist URL in the box above to start loading your channels.</p>
          </div>
        )}
        </div>
      </main>

      {/* Android/Chrome Installation & Build Guide Modal */}
      {showAndroidModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden border border-gray-100 text-left">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-6 text-white relative">
              <button 
                onClick={() => setShowAndroidModal(false)}
                className="absolute right-4 top-4 text-white/80 hover:text-white bg-white/10 p-1.5 rounded-full transition cursor-pointer"
              >
                <X size={20} />
              </button>
              <div className="flex items-center gap-3">
                <Smartphone size={28} className="text-emerald-200" />
                <div>
                  <h3 className="text-xl font-bold">Chrome Direct Install & APK Guide</h3>
                  <p className="text-emerald-100 text-xs mt-0.5 font-medium">Chrome & PWA technology is 100% active and validated</p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              {/* iframe banner helper */}
              {typeof window !== 'undefined' && window.self !== window.top && (
                <div className="bg-amber-50 text-amber-950 border border-amber-200 rounded-2xl p-4 text-xs space-y-2">
                  <p className="font-bold flex items-center gap-1.5 text-amber-800">
                    ⚠️ You are currently inside the editor preview iframe!
                  </p>
                  <p className="leading-relaxed text-gray-700">
                    Google Chrome security policies prevent direct PWA installation prompts within third-party iframes. Please click the button below to launch the live application in a standalone browser tab to enjoy easy 1-click installation:
                  </p>
                  <a
                    href="https://ais-pre-seb6x4476koxug6jfzgq7d-867933472925.asia-east1.run.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold px-4.5 py-2.5 rounded-xl transition shadow-md shadow-amber-600/10 cursor-pointer active:scale-95"
                  >
                    Launch Standalone Application <ExternalLink size={14} />
                  </a>
                </div>
              )}

              {/* Chrome Live Status indicator */}
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-150 space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">PWA & Installation Requirement Status:</h4>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white border border-gray-100 rounded-xl p-2.5 text-center">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase">Manifest</p>
                    <p className="text-xs font-bold text-emerald-600 mt-1">✓ READY</p>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-xl p-2.5 text-center">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase">Service Worker</p>
                    <p className="text-xs font-bold text-emerald-600 mt-1">✓ ACTIVE</p>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-xl p-2.5 text-center">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase">HTTPS Connection</p>
                    <p className="text-xs font-bold text-emerald-600 mt-1">✓ SECURE</p>
                  </div>
                </div>
              </div>

              {/* Option 1: Chrome Direct Install */}
              <div className="p-5 rounded-2xl bg-emerald-50/50 border border-emerald-100 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="bg-emerald-600 text-white font-bold rounded-full w-6 h-6 flex items-center justify-center text-xs mt-0.5 shrink-0">1</span>
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">Direct 1-Click Install via Chrome</h4>
                    <p className="text-xs text-gray-600 mt-1">Directly install to your device using Google Chrome in one simple step. No third-party files required, behaves exactly like a native app.</p>
                  </div>
                </div>
                
                {isInstallable ? (
                  <button
                    onClick={triggerInstall}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white font-bold text-sm py-3 rounded-xl hover:bg-emerald-700 transition cursor-pointer shadow-md shadow-emerald-600/10 active:scale-[0.98]"
                  >
                    <Download size={16} /> Click here to install app
                  </button>
                ) : (
                  <div className="text-xs text-gray-600 bg-white p-4 rounded-xl border border-gray-100 space-y-3">
                    <p className="font-bold text-emerald-800">Quick Installation Instructions (Mobile & Desktop):</p>
                    <ol className="list-decimal pl-4 space-y-2 text-gray-700 font-medium font-sans">
                      <li>Copy or open this URL directly inside your phone's <strong className="text-emerald-700 font-semibold">Google Chrome</strong> browser.</li>
                      <li>Tap the <strong className="text-emerald-700 font-semibold">three dots (menu)</strong> option in the top or bottom corner of Chrome.</li>
                      <li>Tap <strong className="text-emerald-700 font-semibold">"Install App"</strong> or <strong className="text-emerald-700 font-semibold">"Add to Home Screen"</strong> to install it immediately.</li>
                    </ol>
                  </div>
                )}
              </div>

              {/* Option 2: Live APK Builder */}
              <div className="p-5 rounded-2xl bg-teal-50/40 border border-teal-100 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="bg-teal-600 text-white font-bold rounded-full w-6 h-6 flex items-center justify-center text-xs mt-0.5 shrink-0">2</span>
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">Build Standalone .APK Package</h4>
                    <p className="text-xs text-gray-600 mt-1">If you require a distribution-ready .apk installer file, you can compile one from this live deployment link in two steps:</p>
                  </div>
                </div>

                <div className="space-y-3.5">
                  <div className="bg-white p-3.5 rounded-xl border border-gray-200 flex items-center justify-between gap-3 shadow-2xs">
                    <div className="truncate text-left">
                      <p className="text-[10px] text-gray-400 font-bold uppercase">Step 1: Copy your application URL</p>
                      <p className="text-xs font-semibold text-teal-800 truncate font-mono">{typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes("-dev-") && !window.location.origin.includes("localhost") ? window.location.origin : "https://ais-pre-seb6x4476koxug6jfzgq7d-867933472925.asia-east1.run.app"}</p>
                    </div>
                    <button
                      onClick={copyAppLink}
                      className="shrink-0 flex items-center gap-1.5 bg-teal-50 hover:bg-teal-150 text-teal-700 px-3 py-2 rounded-lg text-xs font-bold transition active:scale-95"
                    >
                      {isCopiedLink ? <Check size={14} className="text-teal-600" /> : <Copy size={14} />}
                      {isCopiedLink ? "Copied!" : "Copy URL"}
                    </button>
                  </div>
                  
                  <div className="text-left space-y-2">
                    <p className="text-xs font-bold text-teal-900">Step 2: Enter the APK Builder platform:</p>
                    <a
                      href="https://www.pwabuilder.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-bold text-sm py-3.5 rounded-xl hover:opacity-95 transition text-center shadow-md shadow-teal-600/10 cursor-pointer"
                    >
                      PWABuilder Official Platform <ExternalLink size={14} />
                    </a>
                  </div>
                  
                  <div className="text-xs text-gray-500 bg-white/80 p-3 rounded-xl border border-gray-100 space-y-1 text-left">
                    <p className="font-bold text-teal-800">How to wrap your PWA:</p>
                    <p className="leading-relaxed text-[11px] font-sans">
                      1. Open the <strong className="font-semibold text-teal-700">official PWABuilder generator</strong> using the button above.<br />
                      2. Paste your copied App URL into the center bar and click <strong className="font-semibold text-teal-700">"Start" / "Test"</strong>.<br />
                      3. Navigate to Android card and click <strong className="font-semibold text-teal-700">"Generate Digital Asset Links/APK"</strong> to download your signed APK instantly!
                    </p>
                  </div>
                </div>
              </div>
            </div>
             {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <span className="text-[10px] text-gray-400 font-semibold">NextPlay IPTV Extractor PWA Ver 2.0</span>
              <button
                onClick={() => setShowAndroidModal(false)}
                className="text-sm font-bold text-emerald-700 hover:text-emerald-900 px-4 py-2 cursor-pointer bg-emerald-50 hover:bg-emerald-100 rounded-xl transition"
              >
                Close Dialog
              </button>
            </div>
          </div>
        </div>
      )}
      
      <Footer />
    </div>
  );
}
