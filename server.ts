import express from "express";
import path from "path";
import fs from "fs";

// --- Helper Functions ---

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
    const url = new URL(urlStr);
    const pathname = url.pathname;
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

function extractM3uFromHtml(html: string): string {
  return html
    .replace(/<\/(div|p|tr|li|pre|code|h[1-6]|dd|dt|thead|tbody|option)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractPageTitle(html: string): string {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (match && match[1]) {
    return match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();
  }
  return '';
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

function parseM3UContent(text: string, sourceUrl: string, strictHtmlFilter: boolean): any[] {
  // Decode common HTML entities just in case
  text = text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const channels = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (/^\s*#\s*EXTINF/i.test(line)) {
      const metadata = line;
      // Search forward for the first valid stream URL or general URL
      let streamUrl = "";
      let groupExplicit = "";
      
      for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
        const forwardLine = lines[j];
        
        // Stop searching if we hit another EXTINF line to avoid mismatched pairs
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
        
        // Match standard protocols or stream urls
        if (/^(https?|rtmp|rtsp|rtp|srt|mms|http):\/\//i.test(forwardLine) || isStreamUrl(forwardLine)) {
          streamUrl = forwardLine;
          break;
        }
      }
      
      if (streamUrl) {
        // Resolve relative URLs if needed
        if (!/^[a-z0-9]+:\/\//i.test(streamUrl) && sourceUrl && sourceUrl !== "pasted-raw-code") {
          try {
            streamUrl = new URL(streamUrl, sourceUrl).href;
          } catch (e) {
            // Keep original
          }
        }

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

  // Fallback: If no channels were extracted structured, scrape any plain stream URLs present
  if (channels.length === 0) {
    const foundUrls = new Set<string>();
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const urlRegex = /((?:https?|rtmp|rtsp|rtp|srt|mms):\/\/[^\s"',<>|]+)/i;
      const match = line.match(urlRegex);
      if (match) {
        let streamUrl = match[1];
        
        if (!/^[a-z0-9]+:\/\//i.test(streamUrl) && sourceUrl && sourceUrl !== "pasted-raw-code") {
          try {
            streamUrl = new URL(streamUrl, sourceUrl).href;
          } catch (e) {}
        }

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

function scrapeStreamsFromHtml(html: string, pageUrl: string): any[] {
  const channels: any[] = [];
  const foundUrls = new Set<string>();
  const pageTitle = extractPageTitle(html) || 'Web Scraped Streams';
  
  const hrefRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    let rawUrl = match[1].trim();
    let anchorText = match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    
    if (!rawUrl || rawUrl.startsWith('#') || rawUrl.startsWith('javascript:')) continue;
    
    let absoluteUrl = rawUrl;
    if (!/^[a-z0-9]+:\/\//i.test(rawUrl)) {
      try {
        absoluteUrl = new URL(rawUrl, pageUrl).href;
      } catch (e) { continue; }
    }
    
    if (isStreamUrl(absoluteUrl) && !foundUrls.has(absoluteUrl)) {
      foundUrls.add(absoluteUrl);
      let title = anchorText.replace(/&[a-z0-9#]+;/gi, '').trim() || extractTitleFromUrl(absoluteUrl);
      
      const finalTitle = title || "Unnamed Channel";
      const rawBlock = `#EXTINF:-1 tvg-logo="" group-title="${pageTitle}",${finalTitle}\n${absoluteUrl}`;
      channels.push({
        id: Math.random().toString(36).substring(2, 11),
        title: finalTitle,
        group: pageTitle,
        logo: '',
        url: absoluteUrl,
        rawBlock: rawBlock
      });
    }
  }
  
  const srcRegex = /<(source|video|iframe|audio|embed)\s+(?:[^>]*?\s+)?src=["']([^"']+)["']/gi;
  while ((match = srcRegex.exec(html)) !== null) {
    let rawUrl = match[2].trim();
    if (!rawUrl) continue;
    
    let absoluteUrl = rawUrl;
    if (!/^[a-z0-9]+:\/\//i.test(rawUrl)) {
      try {
        absoluteUrl = new URL(rawUrl, pageUrl).href;
      } catch (e) { continue; }
    }
    
    if (isStreamUrl(absoluteUrl) && !foundUrls.has(absoluteUrl)) {
      foundUrls.add(absoluteUrl);
      const title = extractTitleFromUrl(absoluteUrl);
      const finalTitle = title || "Unnamed Channel";
      const rawBlock = `#EXTINF:-1 tvg-logo="" group-title="${pageTitle}",${finalTitle}\n${absoluteUrl}`;
      channels.push({
        id: Math.random().toString(36).substring(2, 11),
        title: finalTitle,
        group: pageTitle,
        logo: '',
        url: absoluteUrl,
        rawBlock: rawBlock
      });
    }
  }

  // Broad fallback: Scan the entire HTML for any generic stream URLs
  const rawUrlRegex = /(https?:\/\/[^\s"'`<>]+)/gi;
  let rawMatch;
  while ((rawMatch = rawUrlRegex.exec(html)) !== null) {
    let rawUrl = rawMatch[1].trim();
    rawUrl = rawUrl.replace(/[.,;:"')\]]+$/, ''); // Clean common trailing punctuation
    
    if (isStreamUrl(rawUrl) && !foundUrls.has(rawUrl)) {
      foundUrls.add(rawUrl);
      const title = extractTitleFromUrl(rawUrl);
      const finalTitle = title || "Unnamed Channel";
      const rawBlock = `#EXTINF:-1 tvg-logo="" group-title="${pageTitle}",${finalTitle}\n${rawUrl}`;
      channels.push({
        id: Math.random().toString(36).substring(2, 11),
        title: finalTitle,
        group: pageTitle,
        logo: '',
        url: rawUrl,
        rawBlock: rawBlock
      });
    }
  }
  
  return channels;
}

function normalizeUrlOptions(rawUrl: string): string {
  let u = rawUrl.trim();
  
  // Google Sheets to CSV conversion
  if (u.includes('docs.google.com/spreadsheets/')) {
    const sheetIdMatch = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (sheetIdMatch && sheetIdMatch[1]) {
      return `https://docs.google.com/spreadsheets/d/${sheetIdMatch[1]}/export?format=csv`;
    }
  }

  if (u.includes('github.com/') && u.includes('/blob/')) {
    return u.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/');
  }
  if (u.includes('github.com/') && u.includes('/raw/')) {
    return u.replace('github.com/', 'raw.githubusercontent.com/').replace('/raw/', '/');
  }
  
  if (u.includes('gist.github.com/')) {
    const cleanU = u.split('?')[0].replace(/\/$/, '');
    if (!cleanU.endsWith('/raw') && !cleanU.includes('/raw/')) {
      return cleanU.replace('gist.github.com/', 'gist.githubusercontent.com/') + '/raw';
    }
  }
  
  if (u.includes('pastebin.com/')) {
    if (!u.includes('/raw/')) {
      const match = u.match(/pastebin\.com\/([a-zA-Z0-9]+)$/) || u.match(/pastebin\.com\/raw\.php\?i=([a-zA-Z0-9]+)/);
      if (match) return `https://pastebin.com/raw/${match[1]}`;
    }
  }
  
  if (u.includes('paste.ee/p/')) {
    return u.replace('paste.ee/p/', 'paste.ee/r/');
  }
  
  if (u.includes('sourceb.in/') && !u.includes('/raw/')) {
    return u.replace('sourceb.in/', 'sourceb.in/raw/');
  }

  if (u.includes('dropbox.com/s/')) {
    return u.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
            .replace('dropbox.com', 'dl.dropboxusercontent.com')
            .replace(/\?dl=[01]/g, '');
  }
  if (u.includes('drive.google.com/')) {
    const fileIdMatch = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (fileIdMatch && fileIdMatch[1]) {
      return `https://docs.google.com/uc?export=download&id=${fileIdMatch[1]}`;
    }
  }
  if ((u.includes('rentry.co/') || u.includes('rentry.org/')) && !u.endsWith('/raw')) {
    return u.split('?')[0].replace(/\/$/, '') + '/raw';
  }
  return u;
}

async function fetchWithFallbacks(targetUrl: string): Promise<string> {
  // Gracefully accept expired and self-signed certificates
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const configs = [
    // 1. VLC Player (Extremely common, bypasses generic server/agent security blocks on IPTV lists)
    {
      headers: {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        'Accept': '*/*'
      }
    },
    // 2. TiviMate Player
    {
      headers: {
        'User-Agent': 'TiviMate/4.7.0',
        'Accept': '*/*'
      }
    },
    // 3. GSE Smart IPTV
    {
      headers: {
        'User-Agent': 'GSE Smart IPTV',
        'Accept': '*/*'
      }
    },
    // 4. IP-TV Player
    {
      headers: {
        'User-Agent': 'IP-TV Player',
        'Accept': '*/*'
      }
    },
    // 5. Clean Simple Browser style
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    },
    // 6. Full Browser style (with language and accept flags)
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    },
    // 7. Simple Curl style
    {
      headers: {
        'User-Agent': 'curl/8.4.0'
      }
    },
    // 8. Default Node-fetch style
    {
      headers: {}
    }
  ];

  let lastError: any = null;

  for (const config of configs) {
    try {
      let currentUrl = targetUrl;
      let response = null;
      let redirectCount = 0;
      const maxRedirects = 8;

      // Handle manual redirects to preserve User-Agent and key headers
      while (redirectCount < maxRedirects) {
        response = await fetch(currentUrl, {
          redirect: 'manual',
          headers: config.headers
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (location) {
            currentUrl = new URL(location, currentUrl).href;
            redirectCount++;
            continue;
          }
        }
        break;
      }

      if (response && response.ok) {
        const text = await response.text();
        if (text && text.trim().length > 0) {
          return text;
        }
      } else if (response) {
        lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to connect or download files from the link.");
}

// --- Express App ---

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.post("/api/fetch-channels", async (req, res) => {
    let { url } = req.body;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "Input is required" });
    }
    
    try {
      let targetUrl = url.trim();
      let text = "";
      
      // Determine if paste or URL
      const isRawM3u = targetUrl.startsWith('#EXTM3U') || targetUrl.includes('#EXTINF') || targetUrl.includes('EXTM3U');
      
      if (isRawM3u) {
        text = targetUrl;
        targetUrl = "pasted-raw-code";
      } else {
        targetUrl = normalizeUrlOptions(targetUrl);
        
        try {
          text = await fetchWithFallbacks(targetUrl);
        } catch (fetchErr: any) {
          return res.status(400).json({ 
            error: `Error loading playlist: ${fetchErr.message}. Please verify the link is active and public.\n\nলিংকটি থেকে প্লেলিস্ট লোড করা যায়নি: ${fetchErr.message}। দয়া করে নিশ্চিত করুন যে লিংকটি সচল ও পাবলিকলি অ্যাক্সেসযোগ্য রয়েছে।` 
          });
        }

        // Dedicated Mediafire scraper
        if (targetUrl.includes('mediafire.com/')) {
          const downloadMatch = text.match(/href="(https?:\/\/download[0-9]*\.mediafire\.com\/[^"]+)"/i) || 
                                text.match(/(https?:\/\/download[0-9]*\.mediafire\.com\/[^"'\s>]+)/i);
          if (downloadMatch && downloadMatch[1]) {
            const directMediafireUrl = downloadMatch[1];
            const mfResponse = await fetch(directMediafireUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            if (mfResponse.ok) text = await mfResponse.text();
          }
        }
      }

      // Google Drive large file virus-scan approval page automatic bypass
      if (targetUrl.includes('docs.google.com/uc?') && text.includes('confirm=')) {
        const confirmMatch = text.match(/confirm=([a-zA-Z0-9_-]+)/) || text.match(/&amp;confirm=([a-zA-Z0-9_-]+)/);
        if (confirmMatch && confirmMatch[1]) {
          const fileIdMatch = targetUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
          if (fileIdMatch && fileIdMatch[1]) {
            const confirmedUrl = `https://docs.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileIdMatch[1]}`;
            try {
              text = await fetchWithFallbacks(confirmedUrl);
            } catch (err) {
              console.log("Failed to follow Google Drive scan warning redirect", err);
            }
          }
        }
      }

      // Check if the response is actually HTML
      const isHtmlContent = /^\s*<!DOCTYPE/i.test(text) || /<html/i.test(text) || text.includes('</html');
      let channels: any[] = [];
      
      if (isHtmlContent && targetUrl !== "pasted-raw-code") {
        if (/#EXTM3U/i.test(text) || /#EXTINF/i.test(text)) {
          // HTML page containing M3U
          text = extractM3uFromHtml(text);
          channels = parseM3UContent(text, targetUrl, true);
        } else {
          // Standard HTML page - scrape streams
          channels = scrapeStreamsFromHtml(text, targetUrl);
        }
      } else {
        // Standard text processing
        channels = parseM3UContent(text, targetUrl, false);
      }

      if (!channels || channels.length === 0) {
        if (isHtmlContent) {
          const pageTitle = extractPageTitle(text) || 'Unknown Webpage';
          const snippetText = text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300);

          return res.status(400).json({ 
            error: "The link returned a webpage (HTML), and no stream links or M3U playlist content could be found. Please provide a direct Raw M3U playlist link.",
            debug: {
              isHtml: true,
              pageTitle: pageTitle,
              snippet: snippetText,
              url: url
            }
          });
        } else {
          return res.status(400).json({ 
            error: "We could not find any valid channels in the provided content. Make sure it is a valid M3U file or stream links." 
          });
        }
      }
      
      return res.json(channels);
      
    } catch (error: any) {
      console.error('API Error:', error);
      res.status(500).json({ error: error.message || "An unexpected error occurred" });
    }
  });

  // Serve static assets
  const sendAsset = (fileName: string, contentType: string, res: express.Response) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type, Accept");
    res.header("Content-Type", contentType);

    const paths = [
      path.join(process.cwd(), "dist", fileName),
      path.join(process.cwd(), "public", fileName)
    ];

    for (const p of paths) {
      if (fs.existsSync(p)) return res.sendFile(p);
    }
    return res.status(404).send("File not found");
  };

  app.get("/manifest.json", (req, res) => sendAsset("manifest.json", "application/json", res));
  app.get("/sw.js", (req, res) => sendAsset("sw.js", "application/javascript", res));
  app.get("/logo.jpg", (req, res) => sendAsset("logo.jpg", "image/jpeg", res));

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();

