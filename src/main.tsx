import { registerSW } from 'virtual:pwa-register';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { LanguageProvider } from './contexts/LanguageContext.tsx';
import { MusicPlayerProvider } from './contexts/MusicPlayerContext.tsx';
import { PWAInstallProvider } from './contexts/PWAInstallContext.tsx';
import './index.css';

(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};
const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  origConsoleError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

// Prevent iOS Safari pinch-to-zoom without blocking single-finger scroll performance
if (typeof document !== 'undefined') {
  const preventGesture = (e: Event) => {
    e.preventDefault();
  };
  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });
}

if (typeof window !== 'undefined') {
  if (import.meta.env.DEV) {
    // Clean up any stale dev Service Worker / caches so Vite dev modules never hang or go stale
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          void reg.unregister();
        }
      });
    }
    if ('caches' in window) {
      void window.caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.includes('precache') ||
                key.includes('temple-cinema') ||
                key.includes('workbox')
            )
            .map((key) => window.caches.delete(key))
        )
      );
    }
  } else {
    if ('caches' in window) {
      void window.caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.includes('v5'))
            .filter((key) => key.includes('precache') || key.includes('temple-cinema'))
            .map((key) => window.caches.delete(key))
        )
      );
    }
    if ('serviceWorker' in navigator) {
      registerSW({
        immediate: true,
        onRegisterError(error) {
          console.warn('[PWA] Service worker registration skipped:', error);
        },
      });
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary sectionName="Temple Cinema">
    <LanguageProvider>
      <AuthProvider>
        <PWAInstallProvider>
          <MusicPlayerProvider>
            <App />
          </MusicPlayerProvider>
        </PWAInstallProvider>
      </AuthProvider>
    </LanguageProvider>
  </ErrorBoundary>
);
