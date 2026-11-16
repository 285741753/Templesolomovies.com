import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import type { AppLanguage } from '../contexts/LanguageContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  AppSettings,
  DownloadQualitySetting,
  VideoQualitySetting,
} from '../types/cinema';

const SETTINGS_STORAGE_KEY = 'tsm_app_settings_v1';
const DAILY_NOTIFICATION_STORAGE_KEY = 'tsm_last_daily_notif_ms';
const CACHE_LOCAL_KEYS = ['tsm_cached_movies_v1', 'tsm_cached_upcoming_v1'];

export const VIDEO_QUALITY_OPTIONS: VideoQualitySetting[] = [
  'auto',
  '360p',
  '480p',
  '720p',
  '1080p',
];

export const DOWNLOAD_QUALITY_OPTIONS: DownloadQualitySetting[] = [
  '360p',
  '480p',
  '720p',
  '1080p',
];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  videoQuality: 'auto',
  downloadQuality: '480p',
  downloadWifiOnly: true,
  notificationsEnabled: true,
};

export interface CacheSummary {
  cachedEntries: number;
  estimatedMb: number | null;
}

interface NetworkInformationWithType {
  type?: string;
  effectiveType?: string;
  saveData?: boolean;
}

function isValidVideoQuality(val: unknown): val is VideoQualitySetting {
  return (
    val === 'auto' ||
    val === '360p' ||
    val === '480p' ||
    val === '720p' ||
    val === '1080p'
  );
}

function isValidDownloadQuality(val: unknown): val is DownloadQualitySetting {
  return val === '360p' || val === '480p' || val === '720p' || val === '1080p';
}

function loadLocalSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_APP_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      videoQuality: isValidVideoQuality(parsed.videoQuality)
        ? parsed.videoQuality
        : DEFAULT_APP_SETTINGS.videoQuality,
      downloadQuality: isValidDownloadQuality(parsed.downloadQuality)
        ? parsed.downloadQuality
        : DEFAULT_APP_SETTINGS.downloadQuality,
      downloadWifiOnly:
        typeof parsed.downloadWifiOnly === 'boolean'
          ? parsed.downloadWifiOnly
          : DEFAULT_APP_SETTINGS.downloadWifiOnly,
      notificationsEnabled:
        typeof parsed.notificationsEnabled === 'boolean'
          ? parsed.notificationsEnabled
          : DEFAULT_APP_SETTINGS.notificationsEnabled,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

function persistLocalSettings(next: AppSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

function hasSentDailyNotificationToday(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(DAILY_NOTIFICATION_STORAGE_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return new Date(ts).toDateString() === new Date().toDateString();
  } catch {
    return false;
  }
}

export function isCellularConnection(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as Navigator & { connection?: NetworkInformationWithType })
    .connection;
  if (!conn || typeof conn.type !== 'string') return false;
  return conn.type === 'cellular' || conn.type === 'wimax' || conn.type === 'bluetooth';
}

export function useAppSettings(
  userId: string | undefined,
  authReady: boolean,
  language: AppLanguage,
  setLanguage: (lang: AppLanguage) => void
) {
  const [settings, setSettings] = useState<AppSettings>(() => loadLocalSettings());
  const [dailyNotificationSentToday, setDailyNotificationSentToday] = useState<boolean>(
    () => hasSentDailyNotificationToday()
  );
  const [cacheSummary, setCacheSummary] = useState<CacheSummary>({
    cachedEntries: 0,
    estimatedMb: null,
  });

  // Sync settings from Firestore when authenticated
  useEffect(() => {
    if (!authReady || !userId) return;

    const docPath = `users/${userId}/settings/preferences`;
    const docRef = doc(db, 'users', userId, 'settings', 'preferences');

    const unsub = onSnapshot(
      docRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as {
          videoQuality?: unknown;
          downloadQuality?: unknown;
          downloadWifiOnly?: unknown;
          notificationsEnabled?: unknown;
          language?: unknown;
        };
        const merged: AppSettings = {
          videoQuality: isValidVideoQuality(data.videoQuality)
            ? data.videoQuality
            : DEFAULT_APP_SETTINGS.videoQuality,
          downloadQuality: isValidDownloadQuality(data.downloadQuality)
            ? data.downloadQuality
            : DEFAULT_APP_SETTINGS.downloadQuality,
          downloadWifiOnly:
            typeof data.downloadWifiOnly === 'boolean'
              ? data.downloadWifiOnly
              : DEFAULT_APP_SETTINGS.downloadWifiOnly,
          notificationsEnabled:
            typeof data.notificationsEnabled === 'boolean'
              ? data.notificationsEnabled
              : DEFAULT_APP_SETTINGS.notificationsEnabled,
        };
        setSettings(merged);
        persistLocalSettings(merged);

        if (
          data.language === 'en' ||
          data.language === 'es' ||
          data.language === 'fr' ||
          data.language === 'de' ||
          data.language === 'pt'
        ) {
          setLanguage(data.language);
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, docPath);
      }
    );

    return () => unsub();
  }, [authReady, userId, setLanguage]);

  const persistRemoteSettings = useCallback(
    async (next: AppSettings, nextLanguage: AppLanguage) => {
      if (!userId) return;
      const docPath = `users/${userId}/settings/preferences`;
      const docRef = doc(db, 'users', userId, 'settings', 'preferences');
      try {
        await setDoc(docRef, {
          userId,
          videoQuality: next.videoQuality,
          downloadQuality: next.downloadQuality,
          downloadWifiOnly: next.downloadWifiOnly,
          notificationsEnabled: next.notificationsEnabled,
          language: nextLanguage,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    },
    [userId]
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => {
        const next: AppSettings = {
          videoQuality: isValidVideoQuality(patch.videoQuality)
            ? patch.videoQuality
            : prev.videoQuality,
          downloadQuality: isValidDownloadQuality(patch.downloadQuality)
            ? patch.downloadQuality
            : prev.downloadQuality,
          downloadWifiOnly:
            typeof patch.downloadWifiOnly === 'boolean'
              ? patch.downloadWifiOnly
              : prev.downloadWifiOnly,
          notificationsEnabled:
            typeof patch.notificationsEnabled === 'boolean'
              ? patch.notificationsEnabled
              : prev.notificationsEnabled,
        };
        persistLocalSettings(next);
        void persistRemoteSettings(next, language);
        return next;
      });
    },
    [language, persistRemoteSettings]
  );

  const updateLanguagePreference = useCallback(
    (nextLang: AppLanguage) => {
      setLanguage(nextLang);
      void persistRemoteSettings(settings, nextLang);
    },
    [persistRemoteSettings, setLanguage, settings]
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_APP_SETTINGS);
    persistLocalSettings(DEFAULT_APP_SETTINGS);
    setLanguage('en');
    void persistRemoteSettings(DEFAULT_APP_SETTINGS, 'en');
  }, [persistRemoteSettings, setLanguage]);

  const refreshCacheSummary = useCallback(async () => {
    if (typeof window === 'undefined') return;
    let totalEntries = 0;

    for (const key of CACHE_LOCAL_KEYS) {
      if (window.localStorage.getItem(key)) {
        totalEntries += 1;
      }
    }

    if ('caches' in window) {
      try {
        const cacheNames = await window.caches.keys();
        for (const name of cacheNames) {
          const cache = await window.caches.open(name);
          const keys = await cache.keys();
          totalEntries += keys.length;
        }
      } catch {
        // Ignore cache access errors
      }
    }

    let estimatedMb: number | null = null;
    if (navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        if (typeof est.usage === 'number' && est.usage > 0) {
          estimatedMb = Math.round((est.usage / (1024 * 1024)) * 10) / 10;
        }
      } catch {
        // Ignore storage estimate errors
      }
    }

    setCacheSummary({ cachedEntries: totalEntries, estimatedMb });
  }, []);

  useEffect(() => {
    void refreshCacheSummary();
  }, [refreshCacheSummary]);

  const clearAppCache = useCallback(async (): Promise<{ clearedEntries: number }> => {
    if (typeof window === 'undefined') return { clearedEntries: 0 };
    let clearedEntries = 0;

    for (const key of CACHE_LOCAL_KEYS) {
      if (window.localStorage.getItem(key)) {
        window.localStorage.removeItem(key);
        clearedEntries += 1;
      }
    }

    if ('caches' in window) {
      try {
        const cacheNames = await window.caches.keys();
        for (const name of cacheNames) {
          const cache = await window.caches.open(name);
          const keys = await cache.keys();
          clearedEntries += keys.length;
          await window.caches.delete(name);
        }
      } catch {
        // Ignore cache delete errors
      }
    }

    await refreshCacheSummary();
    return { clearedEntries };
  }, [refreshCacheSummary]);

  const tryDispatchDailyNotification = useCallback(
    (title: string, body: string): boolean => {
      if (!settings.notificationsEnabled) return false;
      if (hasSentDailyNotificationToday()) {
        setDailyNotificationSentToday(true);
        return false;
      }

      const now = Date.now();
      try {
        window.localStorage.setItem(DAILY_NOTIFICATION_STORAGE_KEY, String(now));
      } catch {
        // Ignore storage quota issues
      }
      setDailyNotificationSentToday(true);

      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        window.Notification.permission === 'granted'
      ) {
        try {
          new window.Notification(title, {
            body,
            icon: '/app-icon-full.png',
          });
        } catch {
          // Ignore Notification constructor errors inside restricted iframes
        }
      }

      return true;
    },
    [settings.notificationsEnabled]
  );

  return {
    settings,
    dailyNotificationSentToday,
    cacheSummary,
    updateSettings,
    updateLanguagePreference,
    resetSettings,
    refreshCacheSummary,
    clearAppCache,
    tryDispatchDailyNotification,
  };
}
