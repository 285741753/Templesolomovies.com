import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { LanguageProvider } from './contexts/LanguageContext.tsx';
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

// Prevent iOS/mobile pinch-to-zoom & double-tap zoom while preserving normal scrolling and single taps
if (typeof document !== 'undefined') {
  const preventGesture = (e: Event) => {
    e.preventDefault();
  };
  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });

  let touchMoved = false;
  let startX = 0;
  let startY = 0;
  let lastTouchEnd = 0;

  document.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (e.touches.length > 1) return;
      touchMoved = false;
      const t = e.touches[0];
      if (t) {
        startX = t.clientX;
        startY = t.clientY;
      }
    },
    { passive: true }
  );

  document.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (e.touches.length > 1) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      const t = e.touches[0];
      if (t && (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10)) {
        touchMoved = true;
      }
    },
    { passive: false }
  );

  document.addEventListener(
    'touchend',
    (e: TouchEvent) => {
      if (touchMoved || e.touches.length > 0 || e.changedTouches.length > 1) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      const now = Date.now();
      if (now - lastTouchEnd <= 280) {
        if (e.cancelable) e.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
}

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <AuthProvider>
      <App />
    </AuthProvider>
  </LanguageProvider>
);
