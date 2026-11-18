import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ArrowDown, ArrowUpRight, Download, Share, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type AppBusyActivitySource = 'playback' | 'upload' | 'mic';

const DISMISS_STORAGE_KEY = 'tsm_pwa_dismissed_until_v1';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const APK_DOWNLOAD_URL = '/downloads/temple-cinema.apk';
const APK_MIME_TYPE = 'application/vnd.android.package-archive';

interface PWAInstallContextValue {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isIOSSafari: boolean;
  isAndroid: boolean;
  isDismissed: boolean;
  isBusy: boolean;
  hasApkFile: boolean;
  apkUrl: string;
  apkMimeType: string;
  isSheetOpen: boolean;
  triggerDownloadApp: () => Promise<void>;
  openSheet: () => void;
  closeSheet: () => void;
  dismissForSevenDays: () => void;
  setBusyActivity: (source: AppBusyActivitySource, active: boolean) => void;
}

const PWAInstallContext = createContext<PWAInstallContextValue | null>(null);

function readDismissedState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until) || until <= Date.now()) {
      window.localStorage.removeItem(DISMISS_STORAGE_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function PWAInstallProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkIsStandalone());
  const [isIOS, setIsIOS] = useState(false);
  const [isIOSSafari, setIsIOSSafari] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(() => readDismissedState());
  const [hasApkFile, setHasApkFile] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [busyFlags, setBusyFlags] = useState<Record<AppBusyActivitySource, boolean>>({
    playback: false,
    upload: false,
    mic: false,
  });
  const [mediaElementPlaying, setMediaElementPlaying] = useState(false);

  const isBusy =
    busyFlags.playback || busyFlags.upload || busyFlags.mic || mediaElementPlaying;

  const setBusyActivity = useCallback((source: AppBusyActivitySource, active: boolean) => {
    setBusyFlags((prev) => {
      if (prev[source] === active) return prev;
      return { ...prev, [source]: active };
    });
  }, []);

  // Automatically close any open install sheet whenever playback, upload, or mic starts
  useEffect(() => {
    if ((isBusy || isInstalled) && isSheetOpen) {
      setIsSheetOpen(false);
    }
  }, [isBusy, isInstalled, isSheetOpen]);

  // Listen to native media playback anywhere in the DOM so prompt never overlaps playing video/audio
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncPlayingMedia = () => {
      const media = document.querySelectorAll('video, audio');
      let anyPlaying = false;
      media.forEach((el) => {
        const m = el as HTMLMediaElement;
        if (!m.paused && !m.ended && m.readyState >= 2) {
          anyPlaying = true;
        }
      });
      setMediaElementPlaying(anyPlaying);
    };

    document.addEventListener('play', syncPlayingMedia, true);
    document.addEventListener('pause', syncPlayingMedia, true);
    document.addEventListener('ended', syncPlayingMedia, true);
    return () => {
      document.removeEventListener('play', syncPlayingMedia, true);
      document.removeEventListener('pause', syncPlayingMedia, true);
      document.removeEventListener('ended', syncPlayingMedia, true);
    };
  }, []);

  useEffect(() => {
    setIsInstalled(checkIsStandalone());

    const ua = window.navigator.userAgent;
    const appleMobile =
      /iphone|ipad|ipod/i.test(ua) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    const safariEngine = /safari/i.test(ua);
    const nonSafariIOSBrowser = /crios|fxios|edgios|opios|duckduckgo/i.test(ua);

    setIsIOS(appleMobile);
    setIsIOSSafari(appleMobile && safariEngine && !nonSafariIOSBrowser);
    setIsAndroid(/android/i.test(ua));

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
        setDeferredPrompt(null);
        setIsSheetOpen(false);
      }
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (!checkIsStandalone()) {
        setDeferredPrompt(e as BeforeInstallPromptEvent);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setIsSheetOpen(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery.addEventListener?.('change', handleDisplayModeChange);

    // Optional APK availability probe (ensures 404/HTML SPA fallback is never mistaken for an APK)
    const controller = new AbortController();
    fetch(APK_DOWNLOAD_URL, { method: 'HEAD', signal: controller.signal })
      .then((res) => {
        if (!res.ok) return;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('android.package-archive') || ct.includes('octet-stream')) {
          setHasApkFile(true);
        }
      })
      .catch(() => {
        // Ignore when APK file is not hosted
      });

    return () => {
      controller.abort();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, []);

  const dismissForSevenDays = useCallback(() => {
    setIsSheetOpen(false);
    setIsDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now() + SEVEN_DAYS_MS));
    } catch {
      // Ignore storage quota restrictions
    }
  }, []);

  const openSheet = useCallback(() => {
    if (isInstalled || isBusy) return;
    setIsSheetOpen(true);
  }, [isInstalled, isBusy]);

  const closeSheet = useCallback(() => {
    setIsSheetOpen(false);
  }, []);

  const runNativeInstallPrompt = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt || isInstalled || isBusy) return false;
    const promptEvent = deferredPrompt;
    setDeferredPrompt(null);
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setIsSheetOpen(false);
        return true;
      }
      dismissForSevenDays();
      return false;
    } catch {
      return false;
    }
  }, [deferredPrompt, isInstalled, isBusy, dismissForSevenDays]);

  const triggerDownloadApp = useCallback(async () => {
    if (isInstalled || isBusy) return;
    if (deferredPrompt && !hasApkFile) {
      await runNativeInstallPrompt();
      return;
    }
    setIsSheetOpen(true);
  }, [isInstalled, isBusy, deferredPrompt, hasApkFile, runNativeInstallPrompt]);

  useEffect(() => {
    if (!isSheetOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSheetOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSheetOpen]);

  const value = useMemo<PWAInstallContextValue>(
    () => ({
      isInstallable: Boolean(deferredPrompt),
      isInstalled,
      isIOS,
      isIOSSafari,
      isAndroid,
      isDismissed,
      isBusy,
      hasApkFile,
      apkUrl: APK_DOWNLOAD_URL,
      apkMimeType: APK_MIME_TYPE,
      isSheetOpen,
      triggerDownloadApp,
      openSheet,
      closeSheet,
      dismissForSevenDays,
      setBusyActivity,
    }),
    [
      deferredPrompt,
      isInstalled,
      isIOS,
      isIOSSafari,
      isAndroid,
      isDismissed,
      isBusy,
      hasApkFile,
      isSheetOpen,
      triggerDownloadApp,
      openSheet,
      closeSheet,
      dismissForSevenDays,
      setBusyActivity,
    ]
  );

  return (
    <PWAInstallContext.Provider value={value}>
      {children}

      {/* Single shared mobile-safe Install Bottom Sheet (never shown on load or during busy states) */}
      {isSheetOpen && !isInstalled && !isBusy && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="temple-install-sheet-title"
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4 touch-manipulation"
          onClick={closeSheet}
        >
          <div
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl border border-[#E5A93B]/45 bg-[#09090B] shadow-2xl px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Bottom-sheet drag handle on mobile */}
            <div className="sm:hidden mx-auto mb-3 h-1.5 w-10 rounded-full bg-[#3F3F46]" />

            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src="/icons/icon-192.png"
                  alt="Temple Cinema"
                  className="h-12 w-12 rounded-xl border border-[#E5A93B]/50 bg-black object-contain shrink-0"
                />
                <div className="min-w-0">
                  <h2
                    id="temple-install-sheet-title"
                    className="font-display text-base font-bold text-[#FAFAFA] truncate"
                  >
                    Get the Temple Cinema app
                  </h2>
                  <p className="text-xs text-[#A1A1AA] truncate">
                    Fast launch · Full-screen viewing · Offline catalog
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeSheet}
                aria-label="Close install instructions"
                className="min-h-[44px] min-w-[44px] -mr-2 -mt-1 flex items-center justify-center rounded-xl text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] touch-manipulation cursor-pointer shrink-0"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {deferredPrompt && (
                <button
                  type="button"
                  onClick={() => void runNativeInstallPrompt()}
                  className="min-h-[48px] w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#E5A93B] px-4 py-3 text-sm font-bold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] transition-all touch-manipulation cursor-pointer"
                >
                  <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Install Temple Cinema App</span>
                </button>
              )}

              {isIOS ? (
                <div className="rounded-xl border border-[#E5A93B]/35 bg-[#111114] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#E5A93B]">
                      Install on iPhone &amp; iPad (Safari)
                    </span>
                    <span
                      aria-hidden="true"
                      className="inline-flex items-center gap-1 rounded-lg bg-[#E5A93B]/15 px-2 py-1 text-[11px] font-medium text-[#E5A93B]"
                    >
                      <Share className="h-3.5 w-3.5" />
                      <ArrowDown className="h-3.5 w-3.5 md:hidden animate-bounce" />
                      <ArrowUpRight className="hidden md:inline h-3.5 w-3.5 animate-bounce" />
                    </span>
                  </div>

                  <p className="text-sm leading-relaxed text-[#FAFAFA]">
                    Tap the{' '}
                    <span className="inline-flex items-center gap-1 rounded border border-[#E5A93B]/40 bg-black px-1.5 py-0.5 text-xs font-semibold text-[#E5A93B] align-baseline">
                      <Share className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Share</span>
                    </span>{' '}
                    icon, then{' '}
                    <span className="font-semibold text-[#E5A93B]">
                      &apos;Add to Home Screen&apos;
                    </span>
                    .
                  </p>

                  {/* Visual arrow guide pointing toward Safari Share button */}
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs text-[#A1A1AA]">
                    <ArrowDown className="h-4 w-4 text-[#E5A93B] md:hidden" aria-hidden="true" />
                    <ArrowUpRight
                      className="hidden md:inline h-4 w-4 text-[#E5A93B]"
                      aria-hidden="true"
                    />
                    <span className="md:hidden">
                      Look for the Share square button at the bottom of Safari
                    </span>
                    <span className="hidden md:inline">
                      Look for the Share square button in the top Safari bar
                    </span>
                  </div>
                </div>
              ) : (
                !deferredPrompt && (
                  <div className="rounded-xl border border-[#27272A] bg-[#111114] p-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#E5A93B]">
                      <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>Install via Browser Menu</span>
                    </div>
                    <p className="text-xs leading-relaxed text-[#D4D4D8]">
                      Open your browser menu (<span className="font-mono text-[#FAFAFA]">⋮</span> or{' '}
                      <span className="font-mono text-[#FAFAFA]">⋯</span>) and tap{' '}
                      <span className="font-semibold text-[#FAFAFA]">&apos;Install app&apos;</span> or{' '}
                      <span className="font-semibold text-[#FAFAFA]">
                        &apos;Add to Home screen&apos;
                      </span>
                      .
                    </p>
                  </div>
                )
              )}

              {/* Direct APK Download option when hosted at /downloads/temple-cinema.apk */}
              {hasApkFile && !isIOS && (
                <div className="rounded-xl border border-[#27272A] bg-[#111114] p-3.5 space-y-2">
                  <a
                    href={APK_DOWNLOAD_URL}
                    type={APK_MIME_TYPE}
                    download="temple-cinema.apk"
                    className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#E5A93B]/60 bg-[#09090B] px-4 py-2.5 text-xs font-semibold text-[#E5A93B] hover:bg-[#18181B] touch-manipulation transition-colors"
                  >
                    <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Download APK</span>
                  </a>
                  <p className="text-[11px] text-center text-[#A1A1AA]">
                    Allow installs from this source if your phone asks.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={dismissForSevenDays}
                className="min-h-[44px] w-full rounded-xl border border-[#27272A] bg-[#111114] px-4 py-2.5 text-xs font-medium text-[#A1A1AA] hover:text-[#FAFAFA] hover:border-[#3F3F46] touch-manipulation transition-colors cursor-pointer"
              >
                Not now (hide prompt for 7 days)
              </button>
            </div>
          </div>
        </div>
      )}
    </PWAInstallContext.Provider>
  );
}

export function usePWAInstallContext(): PWAInstallContextValue {
  const ctx = useContext(PWAInstallContext);
  if (!ctx) {
    throw new Error('usePWAInstallContext must be used inside PWAInstallProvider');
  }
  return ctx;
}
