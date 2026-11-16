import { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Download,
  Film,
  Globe,
  Info,
  MessageCircle,
  RotateCcw,
  Settings,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { LANGUAGES, useLanguage, type AppLanguage } from '../contexts/LanguageContext';
import {
  DOWNLOAD_QUALITY_OPTIONS,
  VIDEO_QUALITY_OPTIONS,
  type CacheSummary,
} from '../hooks/useAppSettings';
import { WHATSAPP_CHANNEL_URL, type AppSettings } from '../types/cinema';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  dailyNotificationSentToday: boolean;
  cacheSummary: CacheSummary;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onChangeLanguage: (lang: AppLanguage) => void;
  onRefreshCacheSummary: () => Promise<void>;
  onClearCache: () => Promise<{ clearedEntries: number }>;
  onResetDefaults: () => void;
  onNotify: (message: string) => void;
  onClose: () => void;
}

export function SettingsModal({
  isOpen,
  settings,
  dailyNotificationSentToday,
  cacheSummary,
  onUpdateSettings,
  onChangeLanguage,
  onRefreshCacheSummary,
  onClearCache,
  onResetDefaults,
  onNotify,
  onClose,
}: SettingsModalProps) {
  const { language, t } = useLanguage();
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [justClearedCache, setJustClearedCache] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setJustClearedCache(false);
    void onRefreshCacheSummary();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, onRefreshCacheSummary]);

  if (!isOpen) return null;

  const handleToggleNotifications = async () => {
    const nextEnabled = !settings.notificationsEnabled;
    onUpdateSettings({ notificationsEnabled: nextEnabled });
    if (
      nextEnabled &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      window.Notification.permission === 'default'
    ) {
      try {
        await window.Notification.requestPermission();
      } catch {
        // Ignore browser notification permission errors
      }
    }
  };

  const handleClearCacheClick = async () => {
    if (isClearingCache) return;
    setIsClearingCache(true);
    try {
      const result = await onClearCache();
      setJustClearedCache(true);
      onNotify(
        result.clearedEntries > 0
          ? `${t('settingsCacheClearedBtn')} (${result.clearedEntries})`
          : t('settingsCacheClearedBtn')
      );
      window.setTimeout(() => setJustClearedCache(false), 2500);
    } finally {
      setIsClearingCache(false);
    }
  };

  const cacheStatusText =
    cacheSummary.cachedEntries > 0
      ? cacheSummary.estimatedMb !== null
        ? `${t('settingsCacheCount', { count: cacheSummary.cachedEntries })} · ${cacheSummary.estimatedMb} MB`
        : t('settingsCacheCount', { count: cacheSummary.cachedEntries })
      : t('settingsCacheEmpty');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#09090B]/90 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-[#27272A] bg-[#111114] shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#27272A] px-6 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#E5A93B] mb-1">
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              <span>TEMPLE CINEMA</span>
            </div>
            <h2
              id="settings-modal-title"
              className="font-display text-xl font-bold text-[#FAFAFA]"
            >
              {t('settingsTitle')}
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-0.5">{t('settingsSubtitle')}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('cancelAction')}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93B]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Ordered Settings Rows 1 - 7 */}
        <div className="divide-y divide-[#27272A] px-6 max-h-[72vh] overflow-y-auto">
          {/* 1. Video Quality */}
          <div className="py-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93B] pt-0.5">
                  1.
                </span>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA]">
                    <Film className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                    <span>{t('settingsVideoQualityLabel')}</span>
                  </div>
                  <p className="text-xs text-[#A1A1AA] mt-0.5">
                    {t('settingsVideoQualityDesc')}
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93B] whitespace-nowrap shrink-0">
                {settings.videoQuality === 'auto'
                  ? t('settingsAutoOption')
                  : settings.videoQuality}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label={t('settingsVideoQualityLabel')}
              className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] p-1"
            >
              {VIDEO_QUALITY_OPTIONS.map((option) => {
                const active = settings.videoQuality === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onUpdateSettings({ videoQuality: option })}
                    className={`min-h-[36px] flex-1 rounded-md px-3 py-1.5 font-mono text-xs tabular-nums transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-[#E5A93B] text-[#09090B] font-semibold'
                        : 'text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#18181B]'
                    }`}
                  >
                    {option === 'auto' ? t('settingsAutoOption') : option}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Download Quality */}
          <div className="py-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93B] pt-0.5">
                  2.
                </span>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA]">
                    <Download className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                    <span>{t('settingsDownloadQualityLabel')}</span>
                  </div>
                  <p className="text-xs text-[#A1A1AA] mt-0.5">
                    {t('settingsDownloadQualityDesc')}
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93B] whitespace-nowrap shrink-0">
                {settings.downloadQuality}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label={t('settingsDownloadQualityLabel')}
              className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] p-1"
            >
              {DOWNLOAD_QUALITY_OPTIONS.map((option) => {
                const active = settings.downloadQuality === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onUpdateSettings({ downloadQuality: option })}
                    className={`min-h-[36px] flex-1 rounded-md px-3 py-1.5 font-mono text-xs tabular-nums transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-[#E5A93B] text-[#09090B] font-semibold'
                        : 'text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#18181B]'
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Download Only On WiFi */}
          <div className="py-5 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93B] pt-0.5">
                3.
              </span>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA]">
                  <Wifi className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                  <span>{t('settingsWifiOnlyLabel')}</span>
                </div>
                <p className="text-xs text-[#A1A1AA] mt-0.5">
                  {t('settingsWifiOnlyDesc')}
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={settings.downloadWifiOnly}
              aria-label={t('settingsWifiOnlyLabel')}
              onClick={() =>
                onUpdateSettings({ downloadWifiOnly: !settings.downloadWifiOnly })
              }
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93B] ${
                settings.downloadWifiOnly
                  ? 'border-[#E5A93B] bg-[#E5A93B]'
                  : 'border-[#3F3F46] bg-[#18181B]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full transition-transform ${
                  settings.downloadWifiOnly
                    ? 'translate-x-6 bg-[#09090B]'
                    : 'translate-x-1 bg-[#A1A1AA]'
                }`}
              />
            </button>
          </div>

          {/* 4. Notifications (Default ON, max 1 per day) */}
          <div className="py-5 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93B] pt-0.5">
                4.
              </span>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA]">
                  <Bell className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                  <span>{t('settingsNotificationsLabel')}</span>
                </div>
                <p className="text-xs text-[#A1A1AA] mt-0.5">
                  {t('settingsNotificationsDesc')}
                </p>
                {settings.notificationsEnabled && (
                  <p className="text-[11px] font-mono tabular-nums text-[#71717A] mt-1">
                    {dailyNotificationSentToday
                      ? t('settingsNotificationsCapActive')
                      : t('settingsNotificationsCapReady')}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={settings.notificationsEnabled}
              aria-label={t('settingsNotificationsLabel')}
              onClick={() => void handleToggleNotifications()}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93B] ${
                settings.notificationsEnabled
                  ? 'border-[#E5A93B] bg-[#E5A93B]'
                  : 'border-[#3F3F46] bg-[#18181B]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full transition-transform ${
                  settings.notificationsEnabled
                    ? 'translate-x-6 bg-[#09090B]'
                    : 'translate-x-1 bg-[#A1A1AA]'
                }`}
              />
            </button>
          </div>

          {/* 5. Language */}
          <div className="py-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93B] pt-0.5">
                  5.
                </span>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA]">
                    <Globe className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                    <span>{t('settingsLanguageLabel')}</span>
                  </div>
                  <p className="text-xs text-[#A1A1AA] mt-0.5">
                    {t('settingsLanguageDesc')}
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs font-semibold text-[#E5A93B] whitespace-nowrap shrink-0">
                {LANGUAGES.find((l) => l.code === language)?.nativeName || 'English'}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label={t('settingsLanguageLabel')}
              className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] p-1"
            >
              {LANGUAGES.map((lang) => {
                const active = language === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onChangeLanguage(lang.code)}
                    className={`min-h-[36px] flex-1 rounded-md px-3 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-[#E5A93B] text-[#09090B] font-semibold'
                        : 'text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#18181B]'
                    }`}
                  >
                    {lang.nativeName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 6. Clear Cache */}
          <div className="py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93B] pt-0.5">
                6.
              </span>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA]">
                  <Trash2 className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                  <span>{t('settingsClearCacheLabel')}</span>
                </div>
                <p className="text-xs text-[#A1A1AA] mt-0.5">
                  {t('settingsClearCacheDesc')}
                </p>
                <p className="text-[11px] font-mono tabular-nums text-[#71717A] mt-1">
                  {cacheStatusText}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={isClearingCache}
              onClick={() => void handleClearCacheClick()}
              className={`min-h-[40px] inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 ${
                justClearedCache
                  ? 'border-[#E5A93B] bg-[#E5A93B]/15 text-[#E5A93B]'
                  : 'border-[#27272A] bg-[#09090B] text-[#FAFAFA] hover:border-[#E5A93B] hover:text-[#E5A93B]'
              }`}
            >
              {justClearedCache ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                {justClearedCache ? t('settingsCacheClearedBtn') : t('settingsClearCacheBtn')}
              </span>
            </button>
          </div>

          {/* 7. About Temple Cinema */}
          <div className="py-5">
            <div className="flex items-start gap-3">
              <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93B] pt-0.5">
                7.
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA]">
                  <Info className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                  <span>{t('settingsAboutLabel')}</span>
                </div>

                <div className="mt-3 flex items-start gap-3.5">
                  <img
                    src="/app-icon-full.png"
                    alt="Temple Cinema"
                    className="h-12 w-12 rounded-xl object-cover border border-[#E5A93B]/35 shrink-0"
                  />
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-display font-bold tracking-wider text-[#E5A93B]">
                        TEMPLE CINEMA
                      </span>
                      <span aria-hidden="true" className="text-[#52525B]">
                        ·
                      </span>
                      <span className="font-mono text-[#A1A1AA]">
                        templesolosmovies.com
                      </span>
                    </div>
                    <p className="text-xs text-[#A1A1AA] leading-relaxed">
                      {t('settingsAboutDesc')}
                    </p>
                    <a
                      href={WHATSAPP_CHANNEL_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors pt-0.5"
                    >
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('joinWhatsappChannel')}</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[#27272A] bg-[#09090B] px-6 py-3.5">
          <button
            type="button"
            onClick={() => {
              onResetDefaults();
              onNotify(`${t('settingsTitle')}: ${t('settingsResetDefaults')}`);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('settingsResetDefaults')}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] rounded-lg bg-[#E5A93B] px-5 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
