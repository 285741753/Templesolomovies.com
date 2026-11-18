import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'home-banner' | 'profile' | 'footer';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const {
    isInstalled,
    isIOS,
    isDismissed,
    isBusy,
    hasApkFile,
    apkUrl,
    apkMimeType,
    install,
    dismissForSevenDays,
  } = usePWAInstall();

  // Hide completely when already running in standalone mode
  if (isInstalled) {
    return null;
  }

  // Homepage bottom banner: reserve fixed vertical space when eligible, hide on dismissal/busy
  if (variant === 'home-banner') {
    if (isDismissed || isBusy) {
      return null;
    }

    return (
      <section
        aria-label="Download Temple Cinema app"
        className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8"
      >
        <div className="min-h-[96px] rounded-2xl border border-[#E5A93B]/40 bg-gradient-to-r from-[#09090B] via-[#12100B] to-[#09090B] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <img
              src="/icons/icon-192.png"
              alt="Temple Cinema"
              width={48}
              height={48}
              className="h-12 w-12 rounded-xl border border-[#E5A93B]/50 bg-black object-contain shrink-0"
            />
            <div className="min-w-0">
              <p className="font-display text-sm sm:text-base font-bold text-[#FAFAFA] truncate">
                Get the Temple Cinema app
              </p>
              <p className="text-xs text-[#A1A1AA] mt-0.5">
                Install on your phone for instant launch, offline search, and full-screen viewing.
              </p>
              {hasApkFile && !isIOS && (
                <p className="text-[11px] text-[#E5A93B]/90 mt-1">
                  Allow installs from this source if your phone asks.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void install()}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#E5A93B] px-4 py-2.5 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 touch-manipulation cursor-pointer"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Download App</span>
            </button>

            {hasApkFile && !isIOS && (
              <a
                href={apkUrl}
                type={apkMimeType}
                download="temple-cinema.apk"
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E5A93B]/55 bg-[#09090B] px-3.5 py-2.5 text-xs font-semibold text-[#E5A93B] hover:bg-[#18181B] whitespace-nowrap shrink-0 touch-manipulation transition-colors"
              >
                <Smartphone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Download APK</span>
              </a>
            )}

            <button
              type="button"
              onClick={dismissForSevenDays}
              aria-label="Dismiss install banner for 7 days"
              title="Hide for 7 days"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[#27272A] bg-[#111114] text-[#A1A1AA] hover:text-[#FAFAFA] hover:border-[#3F3F46] shrink-0 touch-manipulation cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Profile page card ("Get the Temple Cinema app")
  if (variant === 'profile') {
    if (isBusy) return null;

    return (
      <section
        aria-label="Get the Temple Cinema app"
        className="rounded-xl border border-[#E5A93B]/40 bg-gradient-to-r from-[#09090B] to-[#12100B] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/icons/icon-192.png"
            alt="Temple Cinema"
            width={40}
            height={40}
            className="h-10 w-10 rounded-xl border border-[#E5A93B]/50 bg-black object-contain shrink-0"
          />
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#FAFAFA] truncate">
              Get the Temple Cinema app
            </p>
            <p className="text-[11px] text-[#A1A1AA]">
              {hasApkFile && !isIOS
                ? 'Allow installs from this source if your phone asks.'
                : 'Add to your home screen for one-tap cinema access'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void install()}
            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#E5A93B] px-4 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 touch-manipulation cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Download App</span>
          </button>

          {hasApkFile && !isIOS && (
            <a
              href={apkUrl}
              type={apkMimeType}
              download="temple-cinema.apk"
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E5A93B]/55 bg-[#09090B] px-3.5 py-2 text-xs font-semibold text-[#E5A93B] hover:bg-[#18181B] whitespace-nowrap shrink-0 touch-manipulation transition-colors"
            >
              <Smartphone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Download APK</span>
            </a>
          )}
        </div>
      </section>
    );
  }

  // Never show top bar / footer triggers during active video playback, uploads, or mic/transcription
  if (isBusy) {
    return null;
  }

  if (variant === 'footer') {
    if (isDismissed) return null;
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="min-h-[44px] inline-flex items-center gap-1.5 text-[#E5A93B] hover:text-[#F0B84F] font-medium transition-colors whitespace-nowrap shrink-0 touch-manipulation cursor-pointer"
      >
        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Download App</span>
      </button>
    );
  }

  // Top bar button next to search (respects 7-day prompt dismissal & standalone hiding)
  if (isDismissed) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => void install()}
      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#F5C563]/60 bg-[#E5A93B] px-3 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 touch-manipulation cursor-pointer"
    >
      <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Download App</span>
    </button>
  );
}
