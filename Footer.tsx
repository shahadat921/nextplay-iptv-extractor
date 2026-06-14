import React, { useState } from 'react';
import { Trash2, AlertCircle, CheckCircle, MessageCircle, Send, HelpCircle } from 'lucide-react';

export default function Footer() {
  const [isClearing, setIsClearing] = useState(false);
  const [done, setDone] = useState(false);

  const handleClearCache = async () => {
    setIsClearing(true);
    try {
      // Clear all standard storage
      if (typeof localStorage !== 'undefined') {
        localStorage.clear();
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.clear();
      }

      // Clear Service Worker Caches
      if (typeof window !== 'undefined' && 'caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      }

      // Unregister Service Workers
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(reg => reg.unregister()));
      }

      setDone(true);
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      }, 800);
    } catch (e) {
      console.error("Error clearing application cache: ", e);
      // Hard reload anyway
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }
  };

  return (
    <footer className="border-t border-emerald-100 py-10 mt-12 bg-gradient-to-b from-gray-50 to-emerald-50/40">
      <div className="w-full max-w-2xl mx-auto px-4 text-center space-y-6">
        
        {/* Contact & Feedback Widget */}
        <div id="contact-support-panel" className="bg-white p-5 sm:p-6 rounded-2xl border border-emerald-100/80 shadow-[0_4px_24px_rgba(16,185,129,0.03)] space-y-4 text-left">
          <div className="flex items-center gap-2.5 text-emerald-700">
            <HelpCircle size={20} className="shrink-0" />
            <h3 className="font-bold text-gray-900 text-sm sm:text-base">
              Submit Complaints & Suggestions
            </h3>
          </div>

          <p className="text-xs text-gray-600 leading-relaxed">
            Have any complaints, reports, or suggestions? Reach out to support directly on WhatsApp or Telegram below, and we will get back to you as soon as possible.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
            {/* WhatsApp Link */}
            <a
              href="https://wa.me/8801840128865"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50 text-emerald-800 font-bold text-xs sm:text-sm shadow-2xs transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
            >
              <MessageCircle size={18} className="text-emerald-600 shrink-0" />
              <span>WhatsApp Chat</span>
            </a>

            {/* Telegram Link */}
            <a
              href="https://t.me/+8801840128865"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl border border-sky-200 bg-sky-50/40 hover:bg-sky-50 text-sky-800 font-bold text-xs sm:text-sm shadow-2xs transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
            >
              <Send size={18} className="text-sky-600 shrink-0" />
              <span>Telegram Chat</span>
            </a>
          </div>
          
          <div className="text-center pt-1">
            <span className="text-[10px] text-gray-400 font-mono tracking-wider">
              Account Handled by: +8801840128865
            </span>
          </div>
        </div>

        {/* Troubleshooting & Cache Card */}
        <div id="settings-troubleshooting-panel" className="bg-white p-5 sm:p-6 rounded-2xl border border-rose-100/80 shadow-[0_4px_24px_rgba(244,63,94,0.03)] space-y-4 text-left">
          <div className="flex items-center gap-2.5 text-rose-700">
            <AlertCircle size={20} className="shrink-0" />
            <h3 className="font-bold text-gray-900 text-sm sm:text-base">
              Settings & Troubleshooting
            </h3>
          </div>

          <p className="text-xs text-gray-600 leading-relaxed border-b border-gray-50 pb-2">
            If you are experiencing channel loading issues or if the browser has cached stale configurations, you can use the button below to clear the cache and session data.
          </p>
          <p className="text-[11px] text-gray-500 font-medium italic leading-relaxed">
            Performing a Hard Reload pulls fresh browser scripts, which instantly resolves player, extraction, and script parsing errors.
          </p>

          <div className="pt-2">
            <button
              onClick={handleClearCache}
              disabled={isClearing}
              className={`w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border font-bold text-xs sm:text-sm shadow-xs transition duration-200 cursor-pointer ${
                done 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                  : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100 active:scale-[0.98]'
              } disabled:opacity-75`}
            >
              {done ? (
                <>
                  <CheckCircle size={16} className="animate-bounce" />
                  Cache Cleared! (Reloading...)
                </>
              ) : isClearing ? (
                <>
                  <div className="w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full animate-spin"></div>
                  Clearing Cache...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  Clear Cache & Hard Reload
                </>
              )}
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100">
          <p className="text-gray-500 font-medium text-xs sm:text-sm">
            &copy; {new Date().getFullYear()} NextGenBD. All rights reserved.
          </p>
          <span className="text-[10px] text-gray-400 mt-1 block tracking-wider font-mono">NextPlay IPTV Extractor PWA Ver 2.0</span>
        </div>

      </div>
    </footer>
  );
}
