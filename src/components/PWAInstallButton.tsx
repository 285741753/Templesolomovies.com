import { useState } from 'react';
import { Check, Copy, Smartphone, X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'footer';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const { t } = useLanguage();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setShowGuide(true);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Ignore clipboard failures in restricted contexts
    }
  };

  return (
    <>
      {variant === 'footer' ? (
        <button
          type="button"
          onClick={() => void handleAction()}
          className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
        >
          {t('downloadApp')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void handleAction()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5A93B]/40 bg-[#18181B] px-3 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#E5A93B] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Smartphone className="h-3.5 w-3.5 text-[#E5A93B] shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{t('downloadApp')}</span>
          <span className="sm:hidden">{t('downloadAppShort')}</span>
        </button>
      )}

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#09090B]/85 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="download-app-modal-title"
        >
          <div className="w-full max-w-md rounded-xl border border-[#27272A] bg-[#111114] p-6 shadow-2xl text-left">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <img
                  src="/app-icon.jpg"
                  alt="Temple Cinema icon"
                  className="h-11 w-11 rounded-xl object-cover border border-[#27272A] shrink-0"
                />
                <div>
                  <h3
                    id="download-app-modal-title"
                    className="font-display text-base font-semibold text-[#FAFAFA]"
                  >
                    Download templesolosmovies.com App
                  </h3>
                  <p className="text-xs text-[#A1A1AA]">
                    Install directly to your phone or desktop home screen.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close download app dialog"
                className="rounded-lg p-1.5 text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 rounded-lg border border-[#27272A] bg-[#09090B] p-4 text-xs text-[#D4D4D8] leading-relaxed list-decimal list-inside">
                <li>
                  Open this website in <span className="font-semibold text-[#FAFAFA]">Safari</span> on your iPhone or iPad.
                </li>
                <li>
                  Tap the <span className="font-semibold text-[#FAFAFA]">Share</span> icon in the toolbar.
                </li>
                <li>
                  Select <span className="font-semibold text-[#FAFAFA]">Add to Home Screen</span> and tap <span className="font-semibold text-[#FAFAFA]">Add</span>.
                </li>
              </ol>
            ) : (
              <div className="space-y-3 rounded-lg border border-[#27272A] bg-[#09090B] p-4 text-xs text-[#D4D4D8] leading-relaxed">
                <div>
                  <p className="font-semibold text-[#FAFAFA] mb-1">Android (Chrome / Edge)</p>
                  <p className="text-[#A1A1AA]">
                    Open the browser menu (<span className="text-[#FAFAFA]">⋮</span>) and tap <span className="text-[#FAFAFA]">Install app</span> or <span className="text-[#FAFAFA]">Add to Home screen</span>.
                  </p>
                </div>
                <div className="border-t border-[#27272A] pt-3">
                  <p className="font-semibold text-[#FAFAFA] mb-1">Windows / Mac Desktop</p>
                  <p className="text-[#A1A1AA]">
                    Click the <span className="text-[#FAFAFA]">Install</span> icon in your browser&apos;s address bar, or open the link in a standalone tab first.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyUrl()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#3F3F46] cursor-pointer"
              >
                {copiedUrl ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    <span>App Link Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                    <span>Copy App Link</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg bg-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
