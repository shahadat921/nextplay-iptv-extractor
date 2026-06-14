import React from 'react';

export default function Header() {
  return (
    <header className="py-6 mb-8 bg-emerald-600 shadow-sm">
      <div className="w-full max-w-2xl mx-auto flex items-center justify-center gap-4 px-4">
        <img src="/logo.jpg" alt="IPTV Extractor Logo" className="h-16 w-16 rounded-xl shadow-md" />
        <div className="flex flex-col justify-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">NextPlay</h1>
          <span className="text-sm text-emerald-100 font-semibold uppercase tracking-wider">by NextGenBD</span>
        </div>
      </div>
    </header>
  );
}
