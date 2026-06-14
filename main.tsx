import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Version Control to bypass stubborn browser caches
const APP_VERSION = 'v1.6'; // Increment this to force instant update across all devices

if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
  const currentVersion = localStorage.getItem('app_version');
  if (currentVersion !== APP_VERSION) {
    // Unregister service workers first
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      });
    }
    
    // Clear cache storage
    if ('caches' in window) {
      caches.keys().then((names) => {
        for (const name of names) {
          caches.delete(name);
        }
      });
    }

    localStorage.setItem('app_version', APP_VERSION);
    // Reload the page programmatically
    window.location.reload();
  }
}

// Register Service Worker
if ('serviceWorker' in navigator) {
  const registerSW = () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('Service Worker registered successfully:', reg.scope))
      .catch((err) => console.error('Service Worker registration failed:', err));
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    registerSW();
  } else {
    window.addEventListener('load', registerSW);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

