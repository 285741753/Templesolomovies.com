import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Upload, Download, Play } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useLanguage } from './contexts/LanguageContext';
import { useMovieRatings } from './hooks/useMovieRatings';
import { useMovieReviews, type SubmitReviewInput } from './hooks/useMovieReviews';
import { useUpcomingNotifications } from './hooks/useUpcomingNotifications';
import { useWatchProgress } from './hooks/useWatchProgress';
import { isCellularConnection, useAppSettings } from './hooks/useAppSettings';
import { useDownloadManager } from './hooks/useDownloadManager';
import { usePWAInstall } from './hooks/usePWAInstall';
import { useMusicPlayer } from './contexts/MusicPlayerContext';
import {
  WHATSAPP_CHANNEL_URL,
  type ChatMessage,
  type ChatRoomId,
  type ChessRoomState,
  type ChessRoomSummary,
  type ClientWsEvent,
  type DownloadQualityTier,
  type HomeCategoryChip,
  type Movie,
  type MovieChatReference,
  type MovieGenre,
  type MovieQuality,
  type OnlineUser,
  type ServerWsEvent,
  type UpcomingMovie,
  type WatchPartyState,
} from './types/cinema';
import { enrichMovie } from './utils/movieMetadata';
import {
  buildAndSaveOfflineSearchIndex,
  hydrateMoviesFromOfflineIndex,
  type SearchSortOrder,
} from './utils/offlineSearchIndex';
import { Header, type AppMainView } from './components/Header';
import { HeroSpotlight } from './components/HeroSpotlight';
import { CategoryChipsBar, filterMoviesByCategory } from './components/CategoryChipsBar';
import { ContinueWatchingRow } from './components/ContinueWatchingRow';
import { GenreShowcaseRows } from './components/GenreShowcaseRows';
import { NewReleasesRow } from './components/NewReleasesRow';
import { BottomNavBar, type MobileNavTab } from './components/BottomNavBar';
import { TrendingNow } from './components/TrendingNow';
import { MovieGrid, type CollectionFilter } from './components/MovieGrid';
import { PWAInstallButton } from './components/PWAInstallButton';
import { MusicPlayerBar } from './components/MusicPlayerBar';
import { TempleLogoIcon } from './components/TempleLogo';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { UserWatchStats } from './components/MyStatsModal';

const ComingSoon = lazy(() =>
  import('./components/ComingSoon').then((m) => ({ default: m.ComingSoon }))
);
const SearchPage = lazy(() =>
  import('./components/SearchPage').then((m) => ({ default: m.SearchPage }))
);
const DownloadsManagerPanel = lazy(() =>
  import('./components/DownloadsManagerPanel').then((m) => ({ default: m.DownloadsManagerPanel }))
);
const CommunityChat = lazy(() =>
  import('./components/CommunityChat').then((m) => ({ default: m.CommunityChat }))
);
const MusicShowcaseRow = lazy(() =>
  import('./components/MusicShowcaseRow').then((m) => ({ default: m.MusicShowcaseRow }))
);
const UploadMovieModal = lazy(() =>
  import('./components/UploadMovieModal').then((m) => ({ default: m.UploadMovieModal }))
);
const AdminUploadModal = lazy(() =>
  import('./components/AdminUploadModal').then((m) => ({ default: m.AdminUploadModal }))
);
import type { AdminMovieUpdatePayload } from './components/AdminUploadModal';
const MovieDetailModal = lazy(() =>
  import('./components/MovieDetailModal').then((m) => ({ default: m.MovieDetailModal }))
);
const DownloadQualityModal = lazy(() =>
  import('./components/DownloadQualityModal').then((m) => ({ default: m.DownloadQualityModal }))
);
const RequestMovieModal = lazy(() =>
  import('./components/RequestMovieModal').then((m) => ({ default: m.RequestMovieModal }))
);
const AuthModal = lazy(() =>
  import('./components/AuthModal').then((m) => ({ default: m.AuthModal }))
);
const MyStatsModal = lazy(() =>
  import('./components/MyStatsModal').then((m) => ({ default: m.MyStatsModal }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const WatchPartyModal = lazy(() =>
  import('./components/WatchPartyModal').then((m) => ({ default: m.WatchPartyModal }))
);
const ChessLounge = lazy(() =>
  import('./components/ChessLounge').then((m) => ({ default: m.ChessLounge }))
);
const CinemaAIStudio = lazy(() =>
  import('./components/CinemaAIStudio').then((m) => ({ default: m.CinemaAIStudio }))
);
const CinemaStage3D = lazy(() =>
  import('./components/CinemaStage3D').then((m) => ({ default: m.CinemaStage3D }))
);
const CinemaLocationsMap = lazy(() =>
  import('./components/CinemaLocationsMap').then((m) => ({ default: m.CinemaLocationsMap }))
);
const GamesHub = lazy(() =>
  import('./components/GamesHub').then((m) => ({ default: m.GamesHub }))
);

const MOVIES_CACHE_KEY = 'tsm_cached_movies_v1';
const CUSTOM_MOVIES_KEY = 'tsm_custom_movies_v1';
const CUSTOM_EDITS_KEY = 'tsm_custom_movie_edits_v1';
const DELETED_MOVIE_IDS_KEY = 'tsm_deleted_movie_ids_v1';

function loadCustomMovies(): Movie[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_MOVIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Movie[]).map(enrichMovie) : [];
  } catch {
    return [];
  }
}

function saveCustomMovies(movies: Movie[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CUSTOM_MOVIES_KEY, JSON.stringify(movies));
  } catch {
    // Ignore storage quota errors
  }
}

function loadCustomEdits(): Record<string, Partial<Movie>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CUSTOM_EDITS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Partial<Movie>>) : {};
  } catch {
    return {};
  }
}

function saveCustomEdits(edits: Record<string, Partial<Movie>>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CUSTOM_EDITS_KEY, JSON.stringify(edits));
  } catch {
    // Ignore storage quota errors
  }
}

function loadDeletedMovieIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(DELETED_MOVIE_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function saveDeletedMovieIds(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DELETED_MOVIE_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Ignore storage quota errors
  }
}

function mergeMoviesWithLocalPersistence(baseMovies: Movie[]): Movie[] {
  const customMovies = loadCustomMovies();
  const edits = loadCustomEdits();
  const deletedIds = loadDeletedMovieIds();
  const seen = new Set<string>();
  const combined: Movie[] = [];

  for (const item of [...customMovies, ...baseMovies]) {
    if (!item || !item.id || deletedIds.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const patch = edits[item.id];
    combined.push(enrichMovie(patch ? { ...item, ...patch } : item));
  }

  return combined;
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

function getNetworkConnection(): NetworkInformationLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

function detectLowNetwork(): boolean {
  const conn = getNetworkConnection();
  if (!conn) return false;
  if (conn.saveData) return true;
  return conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g';
}

function loadCachedMovies(): Movie[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(MOVIES_CACHE_KEY);
    const parsed = raw ? ((JSON.parse(raw) as unknown) as Movie[]) : null;
    const base =
      Array.isArray(parsed) && parsed.length > 0
        ? parsed
        : hydrateMoviesFromOfflineIndex();
    const safeBase = Array.isArray(base) ? base.map(enrichMovie) : [];
    return mergeMoviesWithLocalPersistence(safeBase);
  } catch {
    return mergeMoviesWithLocalPersistence(hydrateMoviesFromOfflineIndex().map(enrichMovie));
  }
}

function saveCachedMovies(movies: Movie[]) {
  if (typeof window === 'undefined' || movies.length === 0) return;
  try {
    window.localStorage.setItem(MOVIES_CACHE_KEY, JSON.stringify(movies.slice(0, 60)));
  } catch {
    // Ignore storage quota errors
  }
}

function parseDurationMinutes(duration: string | undefined): number {
  if (!duration) return 105;
  let total = 0;
  const hMatch = duration.match(/(\d+)\s*h/i);
  const mMatch = duration.match(/(\d+)\s*m/i);
  if (hMatch) total += Number(hMatch[1]) * 60;
  if (mMatch) total += Number(mMatch[1]);
  return total > 0 ? total : 105;
}

function getOrCreateGuestId(): string {
  const key = 'tsm_user_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = `user-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, created);
  return created;
}

function getOrCreateGuestName(): string {
  const key = 'tsm_username';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = `Viewer${Math.floor(100 + Math.random() * 899)}`;
  localStorage.setItem(key, created);
  return created;
}

function getInitialMainView(): AppMainView {
  if (typeof window === 'undefined') return 'home';
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  if (
    viewParam === 'search' ||
    viewParam === 'downloads' ||
    viewParam === 'games' ||
    viewParam === 'lounge'
  ) {
    return viewParam;
  }
  const pathname = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  if (pathname === '/search') return 'search';
  if (pathname === '/downloads') return 'downloads';
  if (pathname === '/games') return 'games';
  if (pathname === '/lounge') return 'lounge';
  return 'home';
}

function syncMainViewInUrl(view: AppMainView) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (view === 'home') {
      url.searchParams.delete('view');
      if (['/search', '/downloads', '/games', '/lounge'].includes(url.pathname.toLowerCase())) {
        url.pathname = '/';
      }
    } else {
      url.searchParams.set('view', view);
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Ignore history API errors
  }
}

export default function App() {
  const {
    user,
    profile,
    savedMovies,
    authReady,
    isAdmin,
    toggleSaveMovie,
    isMovieSaved,
    updateUserProfile,
    logOut,
    getIdToken,
  } = useAuth();
  const downloadManager = useDownloadManager();
  const {
    ratingsByMovie,
    pendingRatingsByMovie,
    rateMovie,
  } = useMovieRatings(user?.uid, (syncedCount) => {
    showNotice(
      `Synced ${syncedCount} offline movie ${syncedCount === 1 ? 'rating' : 'ratings'} to the server.`
    );
  });
  const {
    reviewsByMovie,
    reviewCountByMovie,
    isLoadingReviews,
    submitReview,
    deleteReview,
  } = useMovieReviews(user?.uid);
  const {
    upcomingMovies,
    isLoading: isUpcomingLoading,
    error: upcomingError,
    subscribedIdSet,
    effectiveEmail,
    retryFetch: retryUpcoming,
    subscribeToRelease,
    unsubscribeFromRelease,
    subscribeToAllUpcoming,
    createUpcomingRelease,
    deleteUpcomingRelease,
    handleWsUpcomingCreated,
    handleWsUpcomingDeleted,
    handleWsSubscriberUpdated,
  } = useUpcomingNotifications({ user, authReady, getIdToken });
  const {
    progressByMovie,
    continueWatchingList,
    saveProgress,
    clearProgress,
  } = useWatchProgress(user?.uid, authReady);
  const { language, setLanguage, t } = useLanguage();
  const {
    settings,
    dailyNotificationSentToday,
    cacheSummary,
    updateSettings,
    updateLanguagePreference,
    resetSettings,
    refreshCacheSummary,
    clearAppCache,
    tryDispatchDailyNotification,
  } = useAppSettings(user?.uid, authReady, language, setLanguage);

  const [movies, setMovies] = useState<Movie[]>(() => loadCachedMovies());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(() => loadCachedMovies().length === 0);

  const [guestId] = useState<string>(() => getOrCreateGuestId());
  const [guestName, setGuestName] = useState<string>(() => getOrCreateGuestName());
  const [activeRoom, setActiveRoom] = useState<ChatRoomId>('general');
  const [collectionView, setCollectionView] = useState<CollectionFilter>('all');
  const [selectedGenre, setSelectedGenre] = useState<'All' | MovieGenre>('All');
  const [selectedQuality, setSelectedQuality] = useState<'All' | MovieQuality>('All');
  const [homeCategory, setHomeCategory] = useState<HomeCategoryChip>('All');
  const [catalogSort, setCatalogSort] = useState<'newest' | 'imdb' | 'downloads' | 'title'>('newest');
  const [searchSort, setSearchSort] = useState<SearchSortOrder>('relevance');
  const [mainView, setMainView] = useState<AppMainView>(() => getInitialMainView());
  const [mobileNavTab, setMobileNavTab] = useState<MobileNavTab>(() => getInitialMainView());
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [authModalState, setAuthModalState] = useState<{
    open: boolean;
    mode: 'login' | 'signup';
  }>({ open: false, mode: 'login' });

  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [selectedMovieInitialTrailer, setSelectedMovieInitialTrailer] = useState(false);
  const [downloadPickerMovie, setDownloadPickerMovie] = useState<Movie | null>(null);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWatchPartyOpen, setIsWatchPartyOpen] = useState(false);
  const [partyState, setPartyState] = useState<WatchPartyState | null>(null);
  const [chessRoom, setChessRoom] = useState<ChessRoomState | null>(null);
  const [chessRooms, setChessRooms] = useState<ChessRoomSummary[]>([]);
  const [chessError, setChessError] = useState<string | null>(null);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [pendingMovieRef, setPendingMovieRef] = useState<MovieChatReference | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [isLowNetwork, setIsLowNetwork] = useState<boolean>(() => detectLowNetwork());
  const { setBusyActivity } = usePWAInstall();
  const { pauseMusic, currentTrack, isMiniDismissed } = useMusicPlayer();

  useEffect(() => {
    const movieActive = Boolean(selectedMovie || isWatchPartyOpen);
    setBusyActivity('playback', movieActive);
    if (movieActive) {
      pauseMusic();
    }
  }, [selectedMovie, isWatchPartyOpen, setBusyActivity, pauseMusic]);

  useEffect(() => {
    setBusyActivity('upload', Boolean(isUploadOpen || isAdminPanelOpen));
  }, [isUploadOpen, isAdminPanelOpen, setBusyActivity]);

  useEffect(() => {
    if (movies.length === 0) return;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(() => buildAndSaveOfflineSearchIndex(movies), {
        timeout: 1200,
      });
      return () => win.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(() => buildAndSaveOfflineSearchIndex(movies), 450);
    return () => window.clearTimeout(timer);
  }, [movies]);

  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    const onMapsQuotaExceeded = () => setMapsQuotaExceeded(true);
    const onConnChange = () => setIsLowNetwork(detectLowNetwork());
    const conn = getNetworkConnection();
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('gmp-quota-exceeded', onMapsQuotaExceeded);
    conn?.addEventListener?.('change', onConnChange);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('gmp-quota-exceeded', onMapsQuotaExceeded);
      conn?.removeEventListener?.('change', onConnChange);
    };
  }, []);

  // Keep horizontal scroll pinned to 0 after keyboard close or orientation change without reflowing during scroll
  useEffect(() => {
    const resetHorizontalOffset = () => {
      if (window.scrollX !== 0) {
        window.scrollTo(0, window.scrollY);
      }
    };
    window.addEventListener('orientationchange', resetHorizontalOffset);
    document.addEventListener('focusout', resetHorizontalOffset, true);
    return () => {
      window.removeEventListener('orientationchange', resetHorizontalOffset);
      document.removeEventListener('focusout', resetHorizontalOffset, true);
    };
  }, []);

  const activeUserId = user?.uid || guestId;
  const activeUsername = profile?.displayName || user?.displayName || guestName;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const activeUsernameRef = useRef(activeUsername);
  const activeRoomRef = useRef(activeRoom);

  useEffect(() => {
    activeUsernameRef.current = activeUsername;
  }, [activeUsername]);

  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  const savedMovieIds = useMemo(
    () => new Set(savedMovies.map((m) => m.movieId)),
    [savedMovies]
  );

  const downloadedMovieIds = useMemo(
    () =>
      new Set(
        downloadManager.tasks
          .filter((task) => task.status === 'completed' || task.offlineAvailable)
          .map((task) => task.movieId)
      ),
    [downloadManager.tasks]
  );

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => {
      setNotice((current) => (current === text ? null : current));
    }, 3500);
  }, []);

  const tryDailyNotifyRef = useRef(tryDispatchDailyNotification);
  useEffect(() => {
    tryDailyNotifyRef.current = tryDispatchDailyNotification;
  }, [tryDispatchDailyNotification]);

  useEffect(() => {
    if (!isAdmin && collectionView === 'uploads') {
      setCollectionView('all');
    }
    if (!isAdmin && isUploadOpen) {
      setIsUploadOpen(false);
    }
  }, [isAdmin, collectionView, isUploadOpen]);

  useEffect(() => {
    let active = true;
    let retryTimer: number | null = null;
    let activeController: AbortController | null = null;

    const loadMovies = async (attempt: number) => {
      const controller = new AbortController();
      activeController = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch('/api/movies', { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { movies?: Movie[] };
        if (active && Array.isArray(data.movies)) {
          const merged = mergeMoviesWithLocalPersistence(data.movies.map(enrichMovie));
          setMovies(merged);
          saveCachedMovies(merged);
          const sharedId = new URLSearchParams(window.location.search).get('movie');
          if (sharedId) {
            const match = merged.find((m) => m.id === sharedId);
            if (match) {
              setSelectedMovieInitialTrailer(false);
              setSelectedMovie(match);
            }
          }
        }
        if (active) setIsLoading(false);
      } catch {
        if (!active) return;
        if (attempt < 1) {
          retryTimer = window.setTimeout(() => {
            void loadMovies(attempt + 1);
          }, 800);
        } else {
          setIsLoading(false);
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    void loadMovies(0);

    return () => {
      active = false;
      activeController?.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, []);

  const hasFetchedChatRef = useRef(false);
  useEffect(() => {
    if (mainView !== 'lounge' || hasFetchedChatRef.current) return;
    hasFetchedChatRef.current = true;
    let active = true;
    const loadChatMessages = async () => {
      try {
        const res = await fetch('/api/chat/messages');
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (active && Array.isArray(data.messages)) {
          setMessages((prev) => {
            if (prev.length === 0) return data.messages!;
            const byId = new Map<string, ChatMessage>();
            for (const m of prev) byId.set(m.id, m);
            for (const m of data.messages!) byId.set(m.id, m);
            return Array.from(byId.values())
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
              .slice(-200);
          });
        }
      } catch {
        // Ignore transient chat load error; WebSocket / polling will retry
      }
    };
    void loadChatMessages();
    return () => {
      active = false;
    };
  }, [mainView]);

  // Poll chat messages over HTTP while WebSocket is disconnected (only on Lounge tab)
  useEffect(() => {
    if (isConnected || mainView !== 'lounge') return;
    let cancelled = false;
    const syncMessages = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/chat/messages');
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (!cancelled && Array.isArray(data.messages)) {
          setMessages((prev) => {
            const byId = new Map<string, ChatMessage>();
            for (const m of prev) byId.set(m.id, m);
            for (const m of data.messages!) byId.set(m.id, m);
            return Array.from(byId.values())
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
              .slice(-200);
          });
        }
      } catch {
        // Ignore background poll errors
      }
    };
    const interval = window.setInterval(() => {
      void syncMessages();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isConnected, mainView]);

  useEffect(() => {
    const key = user ? `tsm_watched_${user.uid}` : 'tsm_watched_guest';
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      setWatchedIds(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      setWatchedIds([]);
    }
  }, [user]);

  const handleRecordWatched = useCallback(
    (movieId: string) => {
      setWatchedIds((prev) => {
        if (prev.includes(movieId)) return prev;
        const next = [...prev, movieId];
        const key = user ? `tsm_watched_${user.uid}` : 'tsm_watched_guest';
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Ignore storage error
        }
        return next;
      });
    },
    [user]
  );

  const userWatchStats = useMemo<UserWatchStats>(() => {
    const uniqueWatchedOrSavedIds = new Set<string>([
      ...watchedIds,
      ...savedMovies.map((s) => s.movieId),
    ]);
    const movieMap = new Map(movies.map((m) => [m.id, m]));
    let totalMinutes = 0;
    const genreCounts = new Map<string, number>();

    for (const id of uniqueWatchedOrSavedIds) {
      const catalogMovie = movieMap.get(id);
      const savedEntry = savedMovies.find((s) => s.movieId === id);
      const genre = catalogMovie?.genre || savedEntry?.genre;
      if (genre) {
        genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
      }
      totalMinutes += parseDurationMinutes(catalogMovie?.duration);
    }

    // Weight preferred genres directly from watchlist data when available
    const genreTotal = Array.from(genreCounts.values()).reduce((sum, c) => sum + c, 0);
    const preferredGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([genre, count]) => ({
        genre,
        count,
        percentage: genreTotal > 0 ? Math.round((count / genreTotal) * 100) : 0,
      }));

    return {
      moviesWatched: uniqueWatchedOrSavedIds.size,
      watchlistCount: savedMovies.length,
      totalHours: totalMinutes / 60,
      totalMinutes,
      preferredGenres,
    };
  }, [watchedIds, savedMovies, movies]);

  // Real-time WebSocket connection synced with current user identity
  useEffect(() => {
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = socket;

      socket.onopen = () => {
        if (unmounted) return;
        setIsConnected(true);
        const joinEvent: ClientWsEvent = {
          type: 'user:join',
          userId: activeUserId,
          username: activeUsernameRef.current,
          room: activeRoomRef.current,
        };
        socket.send(JSON.stringify(joinEvent));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ServerWsEvent;
          if (data.type === 'ws:init') {
            const merged = mergeMoviesWithLocalPersistence(data.movies.map(enrichMovie));
            setMovies((prev) => {
              if (
                prev.length === merged.length &&
                prev.every((m, idx) => m.id === merged[idx]?.id && m.downloads === merged[idx]?.downloads)
              ) {
                return prev;
              }
              saveCachedMovies(merged);
              return merged;
            });
            setMessages(data.messages);
            setOnlineUsers(data.onlineUsers);
            setIsLoading(false);
          } else if (data.type === 'movie:created') {
            const enrichedMovie = enrichMovie(data.movie);
            setMovies((prev) => {
              if (prev.some((m) => m.id === enrichedMovie.id)) return prev;
              const next = [enrichedMovie, ...prev];
              saveCachedMovies(next);
              return next;
            });
            if (
              tryDailyNotifyRef.current(
                `New Release: ${data.movie.title}`,
                `${data.movie.genre} (${data.movie.year}) is now available on TEMPLE CINEMA.`
              )
            ) {
              showNotice(`New drop: "${data.movie.title}" is now streaming.`);
            }
          } else if (data.type === 'movie:deleted') {
            setMovies((prev) => {
              const next = prev.filter((m) => m.id !== data.movieId);
              saveCachedMovies(next);
              return next;
            });
          } else if (data.type === 'movie:download_updated') {
            setMovies((prev) =>
              prev.map((m) =>
                m.id === data.movieId ? { ...m, downloads: data.downloads } : m
              )
            );
            setSelectedMovie((prev) =>
              prev && prev.id === data.movieId
                ? { ...prev, downloads: data.downloads }
                : prev
            );
          } else if (data.type === 'upcoming:created') {
            handleWsUpcomingCreated(data.upcoming);
            if (
              tryDailyNotifyRef.current(
                `Coming Soon: ${data.upcoming.title}`,
                `Scheduled for ${data.upcoming.releaseDate} on TEMPLE CINEMA.`
              )
            ) {
              showNotice(`Upcoming release scheduled: "${data.upcoming.title}".`);
            }
          } else if (data.type === 'upcoming:deleted') {
            handleWsUpcomingDeleted(data.releaseId);
          } else if (data.type === 'upcoming:subscriber_updated') {
            handleWsSubscriberUpdated(data.releaseId, data.subscriberCount);
          } else if (data.type === 'chat:message') {
            setMessages((prev) => {
              if (prev.some((m) => m.id === data.message.id)) return prev;
              return [...prev, data.message];
            });
          } else if (data.type === 'chat:like_updated') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === data.messageId ? { ...m, likedBy: data.likedBy } : m
              )
            );
          } else if (data.type === 'chat:reaction_updated') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === data.messageId ? { ...m, reactions: data.reactions } : m
              )
            );
          } else if (data.type === 'presence:update') {
            setOnlineUsers(data.onlineUsers);
          } else if (data.type === 'party:state') {
            setPartyState(data.party);
          } else if (data.type === 'party:error') {
            showNotice(data.message);
          } else if (data.type === 'chess:rooms') {
            setChessRooms(data.rooms);
          } else if (data.type === 'chess:state') {
            setChessRoom(data.room);
            setChessError(null);
          } else if (data.type === 'chess:left') {
            setChessRoom(null);
          } else if (data.type === 'chess:error') {
            setChessError(data.message);
            showNotice(data.message);
          }
        } catch {
          // Ignore malformed payloads
        }
      };

      socket.onclose = () => {
        if (unmounted) return;
        setIsConnected(false);
        setChessRoom(null);
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          return;
        }
        reconnectTimerRef.current = window.setTimeout(connect, 2500);
      };
    };

    const handleOnlineReconnect = () => {
      if (unmounted) return;
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        connect();
      }
    };

    const startTimer = window.setTimeout(() => {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        connect();
      }
    }, 350);
    window.addEventListener('online', handleOnlineReconnect);

    return () => {
      unmounted = true;
      window.clearTimeout(startTimer);
      window.removeEventListener('online', handleOnlineReconnect);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [activeUserId]);

  // Propagate display name changes over live WebSocket when user logs in/updates profile
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'user:rename', username: activeUsername }));
    }
  }, [activeUsername]);

  const sendWs = useCallback((payload: ClientWsEvent) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const handleJoinOrCreateParty = useCallback(
    (roomCode: string, movieId?: string) => {
      const clean = roomCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
      if (!clean) return;
      sendWs({
        type: 'party:join',
        roomCode: clean,
        movieId,
        userId: activeUserId,
        username: activeUsername,
      });
      setIsWatchPartyOpen(true);
    },
    [activeUserId, activeUsername, sendWs]
  );

  const handleSyncParty = useCallback(
    (roomCode: string, movieId: string, isPlaying: boolean, currentTime: number) => {
      sendWs({
        type: 'party:sync',
        roomCode,
        movieId,
        isPlaying,
        currentTime,
        userId: activeUserId,
      });
    },
    [activeUserId, sendWs]
  );

  const handleLeaveParty = useCallback(
    (roomCode: string) => {
      sendWs({
        type: 'party:leave',
        roomCode,
        userId: activeUserId,
      });
      setPartyState(null);
      if (new URLSearchParams(window.location.search).has('party')) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('party');
        window.history.replaceState({}, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
      }
    },
    [activeUserId, sendWs]
  );

  const handleStartMovieWatchParty = useCallback(
    (movie: Movie) => {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      handleJoinOrCreateParty(code, movie.id);
      showNotice(`Started Watch Party room ${code} for "${movie.title}".`);
    },
    [handleJoinOrCreateParty, showNotice]
  );

  useEffect(() => {
    if (!isConnected) return;
    const partyParam = new URLSearchParams(window.location.search).get('party');
    if (partyParam && !partyState) {
      handleJoinOrCreateParty(partyParam);
    }
  }, [isConnected, partyState, handleJoinOrCreateParty]);

  const handleRenameUser = async (nextName: string) => {
    if (user) {
      await updateUserProfile(nextName);
    } else {
      setGuestName(nextName);
      localStorage.setItem('tsm_username', nextName);
    }
    sendWs({ type: 'user:rename', username: nextName });
  };

  const handleSwitchRoom = (room: ChatRoomId) => {
    setActiveRoom(room);
    sendWs({ type: 'room:switch', room });
  };

  const handleSendMessage = (text: string, movieRef?: MovieChatReference) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic: ChatMessage = {
      id,
      room: activeRoom,
      userId: activeUserId,
      username: activeUsername,
      text: text.trim() || `Shared ${movieRef?.title ?? 'a movie'}`,
      timestamp: new Date().toISOString(),
      movieRef,
      likedBy: [],
    };

    setMessages((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, optimistic]));

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWs({
        type: 'chat:send',
        id,
        room: activeRoom,
        userId: activeUserId,
        username: activeUsername,
        text,
        movieRef,
      });
    } else {
      void fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          room: activeRoom,
          userId: activeUserId,
          username: activeUsername,
          text,
          movieRef,
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { message?: ChatMessage };
          if (data.message) {
            setMessages((prev) =>
              prev.map((m) => (m.id === id ? data.message! : m))
            );
          }
        })
        .catch(() => {
          showNotice('Could not reach the chat server. Message queued locally.');
        });
    }
  };

  const handleToggleLikeMessage = (messageId: string) => {
    const target = messages.find((m) => m.id === messageId);
    if (!target || target.userId === activeUserId) return;

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const currentLikes = Array.isArray(m.likedBy) ? m.likedBy : [];
        const hasLiked = currentLikes.includes(activeUserId);
        return {
          ...m,
          likedBy: hasLiked
            ? currentLikes.filter((id) => id !== activeUserId)
            : [...currentLikes, activeUserId],
        };
      })
    );

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWs({
        type: 'chat:like',
        messageId,
        userId: activeUserId,
      });
    } else {
      void fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: activeUserId }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((payload: { messageId?: string; likedBy?: string[] } | null) => {
          if (payload?.messageId && Array.isArray(payload.likedBy)) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === payload.messageId ? { ...m, likedBy: payload.likedBy } : m
              )
            );
          }
        })
        .catch(() => {});
    }
  };

  const handleToggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      const cleanEmoji = emoji.trim();
      if (!cleanEmoji) return;

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const nextReactions: Record<string, string[]> = { ...(m.reactions || {}) };
          const currentReactors = Array.isArray(nextReactions[cleanEmoji])
            ? nextReactions[cleanEmoji]
            : [];
          if (currentReactors.includes(activeUserId)) {
            const filtered = currentReactors.filter((id) => id !== activeUserId);
            if (filtered.length > 0) {
              nextReactions[cleanEmoji] = filtered;
            } else {
              delete nextReactions[cleanEmoji];
            }
          } else {
            nextReactions[cleanEmoji] = [...currentReactors, activeUserId];
          }
          return { ...m, reactions: nextReactions };
        })
      );

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        sendWs({
          type: 'chat:react',
          messageId,
          userId: activeUserId,
          emoji: cleanEmoji,
        });
      } else {
        void fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/react`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: activeUserId, emoji: cleanEmoji }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then(
            (payload: { messageId?: string; reactions?: Record<string, string[]> } | null) => {
              if (payload?.messageId && payload.reactions) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m
                  )
                );
              }
            }
          )
          .catch(() => {});
      }
    },
    [activeUserId, sendWs]
  );

  const handleOpenMovie = useCallback((movie: Movie, trailerMode = false) => {
    setSelectedMovieInitialTrailer(trailerMode);
    setSelectedMovie(movie);
  }, []);

  const handleOpenMovieDirect = useCallback(
    (movie: Movie) => handleOpenMovie(movie, false),
    [handleOpenMovie]
  );

  const handleOpenMovieTrailer = useCallback(
    (movie: Movie) => handleOpenMovie(movie, true),
    [handleOpenMovie]
  );

  const handleDownloadMovie = useCallback((movie: Movie) => {
    setDownloadPickerMovie(movie);
  }, []);

  const handleConfirmTierDownload = (movie: Movie, tier: DownloadQualityTier) => {
    if (settings.downloadWifiOnly && isCellularConnection()) {
      showNotice(t('settingsWifiBlockedNotice'));
      return;
    }
    downloadManager.startDownload(movie, tier);
    showNotice(`Downloading ${movie.title} (${tier}) — track progress in Downloads.`);
  };

  const handleDownloadById = (movieId: string) => {
    const found = movies.find((m) => m.id === movieId);
    if (found) handleDownloadMovie(found);
  };

  const handleOpenById = (movieId: string) => {
    const found = movies.find((m) => m.id === movieId);
    if (found) handleOpenMovie(found, false);
  };

  const handleShareToChat = useCallback((movie: Movie) => {
    setPendingMovieRef({
      id: movie.id,
      title: movie.title,
      genre: movie.genre,
      year: movie.year,
      quality: movie.quality,
      posterUrl: movie.posterUrl,
    });
    setMainView('lounge');
    setMobileNavTab('lounge');
    window.setTimeout(() => {
      document.getElementById('community-chat')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }, []);

  const handleToggleSave = useCallback(
    async (movie: Movie) => {
      if (!user) {
        setAuthModalState({ open: true, mode: 'login' });
        showNotice('Log in or sign up to save movies to your personal watchlist.');
        return;
      }
      const saved = await toggleSaveMovie(movie);
      showNotice(saved ? `Saved "${movie.title}" to your watchlist.` : `Removed "${movie.title}" from watchlist.`);
    },
    [user, toggleSaveMovie, showNotice]
  );

  const handleRateMovie = async (movieId: string, stars: number) => {
    if (!user && !isOffline) {
      setAuthModalState({ open: true, mode: 'login' });
      showNotice('Log in or sign up to submit a 5-star rating.');
      return;
    }
    const result = await rateMovie(movieId, stars);
    if (result === 'queued-offline') {
      showNotice(`Saved your ${stars}-star rating offline — it will sync once connected.`);
    } else {
      showNotice(`Saved your ${stars}-star rating.`);
    }
  };

  const handleSubmitReview = async (input: SubmitReviewInput) => {
    if (!user) {
      setAuthModalState({ open: true, mode: 'login' });
      showNotice('Log in or sign up to publish a formal movie review.');
      return;
    }
    await submitReview(input);
    showNotice('Published your formal movie review.');
  };

  const handleDeleteReview = async (movieId: string, targetUserId?: string) => {
    if (!user) return;
    await deleteReview(movieId, targetUserId);
    showNotice('Movie review removed.');
  };

  const handleOpenUpload = useCallback(() => {
    if (!user) {
      setAuthModalState({ open: true, mode: 'login' });
      showNotice('Log in with the administrator account to upload movies.');
      return;
    }
    if (!isAdmin) {
      showNotice('Only the site administrator can upload movies.');
      return;
    }
    setIsUploadOpen(true);
  }, [user, isAdmin, showNotice]);

  const handleSelectCollection = useCallback(
    (view: CollectionFilter) => {
      if (view === 'saved' && !user) {
        setAuthModalState({ open: true, mode: 'login' });
        showNotice('Log in to access your saved watchlist.');
        return;
      }
      if (view === 'uploads' && !isAdmin) {
        showNotice('Only the site administrator can manage uploaded movies.');
        return;
      }
      setCollectionView(view);
    },
    [user, isAdmin, showNotice]
  );

  const handleUpdateMovie = async (
    movieId: string,
    updates: {
      title: string;
      genre: MovieGenre;
      quality: MovieQuality;
      director: string;
      country?: string;
      imdbRating?: number;
      trailerUrl?: string;
      synopsis: string;
    }
  ) => {
    if (!isAdmin) {
      showNotice('Only the administrator can edit movie details.');
      return;
    }
    const customList = loadCustomMovies();
    if (customList.some((m) => m.id === movieId)) {
      const nextCustom = customList.map((m) =>
        m.id === movieId ? enrichMovie({ ...m, ...updates }) : m
      );
      saveCustomMovies(nextCustom);
      setMovies((prev) => {
        const next = prev.map((m) => (m.id === movieId ? enrichMovie({ ...m, ...updates }) : m));
        saveCachedMovies(next);
        return next;
      });
      setSelectedMovie((prev) =>
        prev && prev.id === movieId ? enrichMovie({ ...prev, ...updates }) : prev
      );
      showNotice('Movie details updated.');
      return;
    }

    const token = await getIdToken();
    const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const data = (await res.json()) as { movie: Movie };
      const enriched = enrichMovie(data.movie);
      setMovies((prev) => {
        const next = prev.map((m) => (m.id === movieId ? enriched : m));
        saveCachedMovies(next);
        return next;
      });
      setSelectedMovie(enriched);
      showNotice('Movie details updated.');
    } else {
      showNotice('Only the administrator can update movie details.');
    }
  };

  const handleDeleteMovie = async (movieId: string) => {
    if (!isAdmin) {
      showNotice('Only the administrator can remove movies.');
      return;
    }
    const token = await getIdToken();
    const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      setMovies((prev) => {
        const next = prev.filter((m) => m.id !== movieId);
        saveCachedMovies(next);
        return next;
      });
      showNotice('Movie removed from catalog.');
    } else {
      showNotice('Only the administrator can remove movies from the catalog.');
    }
  };

  const handleUploadedMovie = (movie: Movie) => {
    const enriched = enrichMovie(movie);
    if (enriched.cloudinaryUploaded) {
      const currentCustom = loadCustomMovies();
      saveCustomMovies([enriched, ...currentCustom.filter((m) => m.id !== enriched.id)]);
    }
    setMovies((prev) => {
      if (prev.some((m) => m.id === enriched.id)) return prev;
      const next = [enriched, ...prev];
      saveCachedMovies(next);
      return next;
    });
    showNotice(`"${enriched.title}" published to templesolosmovies.com!`);
  };

  const handleCreateCloudinaryMovie = (movie: Movie) => {
    const enriched = enrichMovie(movie);
    const currentCustom = loadCustomMovies();
    saveCustomMovies([enriched, ...currentCustom.filter((m) => m.id !== enriched.id)]);

    const deletedIds = loadDeletedMovieIds();
    if (deletedIds.has(enriched.id)) {
      deletedIds.delete(enriched.id);
      saveDeletedMovieIds(deletedIds);
    }

    setMovies((prev) => {
      const next = [enriched, ...prev.filter((m) => m.id !== enriched.id)];
      saveCachedMovies(next);
      return next;
    });
  };

  const handleAdminEditMovie = async (movieId: string, updates: AdminMovieUpdatePayload) => {
    if (!isAdmin) return;
    const customList = loadCustomMovies();
    const isLocalCustom = customList.some((m) => m.id === movieId);

    if (isLocalCustom) {
      const nextCustom = customList.map((m) =>
        m.id === movieId ? enrichMovie({ ...m, ...updates }) : m
      );
      saveCustomMovies(nextCustom);
    } else {
      const edits = loadCustomEdits();
      edits[movieId] = { ...(edits[movieId] || {}), ...updates };
      saveCustomEdits(edits);

      try {
        const token = await getIdToken();
        if (token) {
          await fetch(`/api/movies/${encodeURIComponent(movieId)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(updates),
          });
        }
      } catch {
        // Keep localStorage override cleanly
      }
    }

    setMovies((prev) => {
      const next = prev.map((m) => (m.id === movieId ? enrichMovie({ ...m, ...updates }) : m));
      saveCachedMovies(next);
      return next;
    });
    setSelectedMovie((prev) =>
      prev && prev.id === movieId ? enrichMovie({ ...prev, ...updates }) : prev
    );
  };

  const handleAdminDeleteMovie = async (movieId: string) => {
    if (!isAdmin) return;
    const customList = loadCustomMovies();
    const isLocalCustom = customList.some((m) => m.id === movieId);

    if (isLocalCustom) {
      saveCustomMovies(customList.filter((m) => m.id !== movieId));
    } else {
      const deletedIds = loadDeletedMovieIds();
      deletedIds.add(movieId);
      saveDeletedMovieIds(deletedIds);

      try {
        const token = await getIdToken();
        if (token) {
          await fetch(`/api/movies/${encodeURIComponent(movieId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      } catch {
        // Keep localStorage deletion cleanly
      }
    }

    setMovies((prev) => {
      const next = prev.filter((m) => m.id !== movieId);
      saveCachedMovies(next);
      return next;
    });
    setSelectedMovie((prev) => (prev && prev.id === movieId ? null : prev));
  };

  useEffect(() => {
    const handlePopState = () => {
      const next = getInitialMainView();
      setMainView(next);
      setMobileNavTab(next);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToView = useCallback((view: AppMainView, anchorId?: string) => {
    setMainView(view);
    setMobileNavTab(view);
    syncMainViewInUrl(view);
    if (anchorId === 'ai-transcribe') {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('temple-open-ai-tab', { detail: 'transcribe' }));
        document.getElementById('ai-studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    } else if (anchorId) {
      window.setTimeout(() => {
        document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleGlobalSearchChange = useCallback((nextQuery: string) => {
    setSearchQuery(nextQuery);
    if (nextQuery.trim().length > 0) {
      setMainView('search');
      setMobileNavTab('search');
      syncMainViewInUrl('search');
    }
  }, []);

  const scrollToChat = () => {
    navigateToView('lounge', 'community-chat');
  };

  const categoryFilteredMovies = useMemo(
    () => filterMoviesByCategory(movies, homeCategory),
    [movies, homeCategory]
  );

  const categoryContinueWatching = useMemo(() => {
    if (homeCategory === 'All') return continueWatchingList;
    const allowedIds = new Set(categoryFilteredMovies.map((m) => m.id));
    return continueWatchingList.filter((entry) => allowedIds.has(entry.movieId));
  }, [continueWatchingList, categoryFilteredMovies, homeCategory]);

  const totalDownloads = useMemo(
    () => movies.reduce((sum, m) => sum + m.downloads, 0),
    [movies]
  );

  const handleSeeAllGenre = useCallback(
    (genre: MovieGenre) => {
      setCollectionView('all');
      setSelectedGenre(genre);
      setSelectedQuality('All');
      navigateToView('search', 'search-page');
    },
    [navigateToView]
  );

  const handleSeeAllNewReleases = useCallback(() => {
    setCollectionView('all');
    setSelectedGenre('All');
    setSelectedQuality('All');
    setSearchSort('newest');
    navigateToView('search', 'search-page');
  }, [navigateToView]);

  const handleOpenRequestModal = useCallback(() => setIsRequestModalOpen(true), []);

  const savedMoviesList = useMemo(
    () => movies.filter((m) => savedMovieIds.has(m.id)),
    [movies, savedMovieIds]
  );

  const watchHistoryList = useMemo(() => {
    const map = new Map(movies.map((m) => [m.id, m]));
    const items: Array<{ movie: Movie; progress?: (typeof progressByMovie)[string]; order: number }> = [];
    const seen = new Set<string>();

    for (const entry of continueWatchingList) {
      const m = map.get(entry.movieId);
      if (m && !seen.has(m.id)) {
        seen.add(m.id);
        items.push({ movie: m, progress: entry, order: entry.updatedAtMs });
      }
    }
    for (let i = watchedIds.length - 1; i >= 0; i -= 1) {
      const id = watchedIds[i];
      const m = map.get(id);
      if (m && !seen.has(m.id)) {
        seen.add(m.id);
        items.push({ movie: m, progress: progressByMovie[id], order: i });
      }
    }
    return items.map(({ movie, progress }) => ({ movie, progress }));
  }, [movies, continueWatchingList, watchedIds, progressByMovie]);

  const handleResumeContinueWatching = useCallback(
    (m: Movie) => handleOpenMovie(m, false),
    [handleOpenMovie]
  );

  const handleRemoveContinueWatching = useCallback(
    (movieId: string) => {
      void clearProgress(movieId);
    },
    [clearProgress]
  );

  const handleRetryUpcoming = useCallback(() => {
    void retryUpcoming();
  }, [retryUpcoming]);

  const handleSubscribeRelease = useCallback(
    async (release: UpcomingMovie, email?: string) => {
      const res = await subscribeToRelease(release, email);
      showNotice(`Release alert enabled for "${release.title}" (${res.email}).`);
    },
    [subscribeToRelease, showNotice]
  );

  const handleUnsubscribeRelease = useCallback(
    async (release: UpcomingMovie) => {
      await unsubscribeFromRelease(release);
      showNotice(`Release alert removed for "${release.title}".`);
    },
    [unsubscribeFromRelease, showNotice]
  );

  const handleSubscribeAllReleases = useCallback(
    async (email?: string) => {
      const res = await subscribeToAllUpcoming(email);
      showNotice(`Subscribed ${res.email} to ${res.count} upcoming release alerts.`);
    },
    [subscribeToAllUpcoming, showNotice]
  );

  const handleCreateUpcomingRelease = useCallback(
    async (input: {
      title: string;
      genre: MovieGenre;
      releaseDate: string;
      duration: string;
      quality: MovieQuality;
      director: string;
      synopsis: string;
      posterFile?: File | null;
    }) => {
      const created = await createUpcomingRelease(input);
      showNotice(`Scheduled "${created.title}" in Coming Soon.`);
    },
    [createUpcomingRelease, showNotice]
  );

  const handleDeleteUpcomingRelease = useCallback(
    async (releaseId: string) => {
      await deleteUpcomingRelease(releaseId);
      showNotice('Removed upcoming release.');
    },
    [deleteUpcomingRelease, showNotice]
  );

  const handleBackToSpotlight = useCallback(() => {
    navigateToView('home', 'spotlight');
  }, [navigateToView]);

  const handleOpenDownloadsFromSearch = useCallback(() => {
    setCollectionView('all');
    setSelectedGenre('All');
    setCatalogSort('downloads');
    navigateToView('downloads', 'catalog');
  }, [navigateToView]);

  const handleShareSiteLink = useCallback(() => {
    showNotice('Preview link copied — ready to share!');
  }, [showNotice]);

  const handleRemoveWatchHistory = useCallback(
    (movieId: string) => {
      void clearProgress(movieId);
      setWatchedIds((prev) => {
        const next = prev.filter((id) => id !== movieId);
        const key = user ? `tsm_watched_${user.uid}` : 'tsm_watched_guest';
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Ignore storage error
        }
        return next;
      });
    },
    [clearProgress, user]
  );

  const activeDownloadsCount = downloadManager.tasks.filter(
    (task) => task.status === 'downloading' || task.status === 'paused'
  ).length;

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-[#0A0A0C] text-[#FAFAFA] flex flex-col">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <Header
        activeView={mainView}
        searchQuery={searchQuery}
        searchInputRef={searchInputRef}
        userStats={userWatchStats}
        onSelectView={navigateToView}
        onSearchChange={handleGlobalSearchChange}
        onOpenUpload={handleOpenUpload}
        onOpenAdminPanel={() => setIsAdminPanelOpen(true)}
        onOpenAuth={(mode) => setAuthModalState({ open: true, mode })}
        onOpenStats={() => setIsStatsOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWatchParty={() => setIsWatchPartyOpen(true)}
        onScrollToChat={scrollToChat}
        onSelectCollection={handleSelectCollection}
        onShareSite={handleShareSiteLink}
        onLoggedOut={() => {
          setCollectionView('all');
          showNotice('You have logged out.');
        }}
      />

      {isOffline && (
        <div
          role="status"
          className="border-b border-[#E5A93B]/30 bg-[#18181B] px-4 py-2 text-center text-xs font-medium text-[#E5A93B]"
        >
          {t('offlineBanner')}
        </div>
      )}

      {!isOffline && isLowNetwork && (
        <div
          role="status"
          className="border-b border-[#27272A] bg-[#111114] px-4 py-1.5 text-center text-[11px] font-medium text-[#A1A1AA]"
        >
          {t('lowNetworkBanner')}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-5 left-1/2 z-50 -translate-x-1/2 max-w-[calc(100vw-2rem)] break-words text-center rounded-lg border border-[#E5A93B]/40 bg-[#18181B] px-4 py-2.5 text-xs font-medium text-[#FAFAFA] shadow-xl"
        >
          {notice}
        </div>
      )}

      <main className="flex-1 w-full max-w-full overflow-x-clip pb-20 lg:pb-6">
        {mainView === 'home' && (
          <>
            {isLoading && movies.length === 0 ? (
              <div className="mx-auto max-w-[1440px] px-4 py-20 sm:px-6 lg:px-8 text-center text-sm text-[#A1A1AA]">
                Loading movie vault...
              </div>
            ) : (
              <>
                {/* 1. Auto-sliding hero banner carousel (5 featured titles, swipe, dots, Play & My List) */}
                <HeroSpotlight
                  movies={categoryFilteredMovies.length > 0 ? categoryFilteredMovies : movies}
                  totalMovies={movies.length}
                  totalDownloads={totalDownloads}
                  onlineCount={onlineUsers.length}
                  isAdmin={isAdmin}
                  isMovieSaved={isMovieSaved}
                  onDownload={handleDownloadMovie}
                  onPreview={handleOpenMovieDirect}
                  onWatchTrailer={handleOpenMovieTrailer}
                  onToggleSave={handleToggleSave}
                  onStartWatchParty={handleStartMovieWatchParty}
                  onOpenUpload={handleOpenUpload}
                />

                {/* 2. Category chips: All, Movies, Series, Anime, Nollywood, K-Drama */}
                <CategoryChipsBar
                  selectedCategory={homeCategory}
                  onSelectCategory={setHomeCategory}
                  filteredCount={categoryFilteredMovies.length}
                />

                {homeCategory === 'Music' && (
                  <ErrorBoundary sectionName="Music" compact>
                    <Suspense fallback={null}>
                      <MusicShowcaseRow />
                    </Suspense>
                  </ErrorBoundary>
                )}

                {categoryFilteredMovies.length === 0 ? (
                  <section className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 lg:px-8">
                    <div className="rounded-2xl border border-[#27272A] bg-[#111114] p-8 text-center">
                      <p className="font-display text-lg font-semibold text-[#FAFAFA] mb-2">
                        No {homeCategory} titles in the vault yet
                      </p>
                      <p className="text-xs text-[#A1A1AA] mb-5">
                        Switch back to All or explore Coming Soon releases below.
                      </p>
                      <button
                        type="button"
                        onClick={() => setHomeCategory('All')}
                        className="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-[#E6A93C] px-5 py-2 text-xs font-bold text-[#0A0A0C] hover:bg-[#F5C563] cursor-pointer"
                      >
                        {t('catAll')}
                      </button>
                    </div>
                  </section>
                ) : (
                  <>
                    {/* 3. Continue Watching */}
                    <ContinueWatchingRow
                      movies={categoryFilteredMovies}
                      entries={categoryContinueWatching}
                      onResumeMovie={handleResumeContinueWatching}
                      onRemoveProgress={handleRemoveContinueWatching}
                    />

                    {/* 4. Trending Now (top 5 most downloaded) */}
                    <TrendingNow
                      movies={categoryFilteredMovies}
                      onDownload={handleDownloadMovie}
                      onSelectMovie={handleOpenMovieDirect}
                    />

                    {/* 5. Genre rows (Action, Nollywood, Sci-Fi, etc.) */}
                    <GenreShowcaseRows
                      movies={categoryFilteredMovies}
                      savedMovieIds={savedMovieIds}
                      ratingsByMovie={ratingsByMovie}
                      onSelectMovie={handleOpenMovieDirect}
                      onToggleSave={handleToggleSave}
                      onSeeAllGenre={handleSeeAllGenre}
                    />

                    {/* 6. New Releases */}
                    <NewReleasesRow
                      movies={categoryFilteredMovies}
                      savedMovieIds={savedMovieIds}
                      ratingsByMovie={ratingsByMovie}
                      onSelectMovie={handleOpenMovieDirect}
                      onDownload={handleDownloadMovie}
                      onToggleSave={handleToggleSave}
                      onSeeAll={handleSeeAllNewReleases}
                    />

                    {homeCategory !== 'Music' && (
                      <ErrorBoundary sectionName="Music" compact>
                        <Suspense fallback={null}>
                          <MusicShowcaseRow />
                        </Suspense>
                      </ErrorBoundary>
                    )}
                  </>
                )}

                {/* 6 (cont). Coming Soon */}
                <ErrorBoundary sectionName="Coming Soon" compact>
                  <Suspense fallback={null}>
                    <ComingSoon
                      upcomingMovies={upcomingMovies}
                      isLoading={isUpcomingLoading}
                      error={upcomingError}
                      subscribedIds={subscribedIdSet}
                      effectiveEmail={effectiveEmail}
                      isAdmin={isAdmin}
                      onRetry={handleRetryUpcoming}
                      onSubscribe={handleSubscribeRelease}
                      onUnsubscribe={handleUnsubscribeRelease}
                      onSubscribeAll={handleSubscribeAllReleases}
                      onCreateUpcoming={handleCreateUpcomingRelease}
                      onDeleteUpcoming={handleDeleteUpcomingRelease}
                    />
                  </Suspense>
                </ErrorBoundary>

                {/* 7. Bottom of Homepage App Install Banner */}
                <PWAInstallButton variant="home-banner" />
              </>
            )}
          </>
        )}

        {mainView === 'search' && (
          <ErrorBoundary sectionName="Search">
            <Suspense
              fallback={
                <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-8 text-xs text-[#A1A1AA]">
                  Loading search catalog...
                </div>
              }
            >
              <SearchPage
                movies={movies}
                isOffline={isOffline}
                searchQuery={searchQuery}
                selectedGenre={selectedGenre}
                selectedQuality={selectedQuality}
                sortBy={searchSort}
                savedMovieIds={savedMovieIds}
                downloadedMovieIds={downloadedMovieIds}
                ratingsByMovie={ratingsByMovie}
                reviewCountByMovie={reviewCountByMovie}
                progressByMovie={progressByMovie}
                onSearchChange={setSearchQuery}
                onSelectGenre={setSelectedGenre}
                onSelectQuality={setSelectedQuality}
                onChangeSortBy={setSearchSort}
                onBackHome={handleBackToSpotlight}
                onOpenDownloads={handleOpenDownloadsFromSearch}
                onSelectMovie={handleOpenMovieDirect}
                onPlayTrailer={handleOpenMovieTrailer}
                onDownload={handleDownloadMovie}
                onToggleSave={handleToggleSave}
                onShareToChat={handleShareToChat}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {mainView === 'downloads' && (
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 pt-5 pb-10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => navigateToView('home', 'spotlight')}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-[#27272A] bg-[#111114] px-4 py-2 text-xs font-medium text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#FAFAFA] transition-colors cursor-pointer"
              >
                <span>← {t('navHome')}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigateToView('search', 'search-page')}
                  className="min-h-[44px] rounded-xl px-4 py-2 text-xs font-semibold border border-[#27272A] bg-[#111114] text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#FAFAFA] cursor-pointer transition-colors"
                >
                  {t('navSearch')}
                </button>
                <button
                  type="button"
                  onClick={() => navigateToView('downloads')}
                  className="min-h-[44px] rounded-xl px-4 py-2 text-xs font-semibold border border-[#E6A93C] bg-[#E6A93C] text-[#0A0A0C] cursor-pointer transition-colors"
                >
                  {t('navDownloads')}
                </button>
              </div>
            </div>

            <ErrorBoundary sectionName="Downloads" compact>
              <Suspense fallback={null}>
                <DownloadsManagerPanel
                  tasks={downloadManager.tasks}
                  storageUsedBytes={downloadManager.storageUsedBytes}
                  onPause={downloadManager.pauseDownload}
                  onResume={downloadManager.resumeDownload}
                  onRemove={(id) => void downloadManager.removeDownload(id)}
                  onOpenMovieById={handleOpenById}
                />
              </Suspense>
            </ErrorBoundary>

            <MovieGrid
              movies={movies}
              isOffline={isOffline}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedGenre={selectedGenre}
              onSelectGenre={setSelectedGenre}
              sortBy={catalogSort}
              onChangeSortBy={setCatalogSort}
              collectionView={collectionView}
              savedMovieIds={savedMovieIds}
              ratingsByMovie={ratingsByMovie}
              reviewCountByMovie={reviewCountByMovie}
              progressByMovie={progressByMovie}
              currentUserId={user?.uid}
              isAdmin={isAdmin}
              onChangeCollectionView={handleSelectCollection}
              onDownload={handleDownloadMovie}
              onSelectMovie={handleOpenMovieDirect}
              onPlayTrailer={handleOpenMovieTrailer}
              onOpenRequestMovie={handleOpenRequestModal}
              onShareToChat={handleShareToChat}
              onToggleSave={handleToggleSave}
              onOpenUpload={handleOpenUpload}
            />
          </div>
        )}

        {mainView === 'games' && (
          <ErrorBoundary sectionName="Temple Football 3D Arena">
            <Suspense
              fallback={
                <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 lg:px-8 text-xs text-[#A1A1AA]">
                  Loading Temple Football 3D Arena...
                </div>
              }
            >
              <GamesHub
                defaultPlayerId={activeUserId}
                defaultPlayerName={activeUsername}
                onBackToCinema={() => navigateToView('home', 'spotlight')}
                onOpenChessLounge={() => navigateToView('lounge', 'chess-game')}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {mainView === 'lounge' && (
          <div id="lounge-hub">
            <section className="border-b border-[#27272A] bg-[#0A0A0C]">
              <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-widest text-[#E6A93C] mb-1">
                      {t('loungeEyebrow')}
                    </p>
                    <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA]">
                      {t('loungeTitle')}
                    </h1>
                    <p className="text-xs sm:text-sm text-[#A1A1AA] mt-1">
                      {t('loungeSubtitle')}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => navigateToView('home', 'spotlight')}
                    className="min-h-[44px] self-start sm:self-auto inline-flex items-center gap-2 rounded-xl border border-[#27272A] bg-[#111114] px-4 py-2 text-xs font-medium text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#FAFAFA] transition-colors cursor-pointer shrink-0"
                  >
                    <span>← {t('navHome')}</span>
                  </button>
                </div>

                {/* Quick Lounge Section Anchors */}
                <div className="mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                  {[
                    { id: 'community-chat', label: t('navChat') },
                    { id: 'chess-game', label: t('navChess') },
                    { id: 'stage-3d', label: t('navStage3d') },
                    { id: 'cinema-map', label: t('navMap') },
                    { id: 'ai-studio', label: t('navStudio') },
                  ].map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="min-h-[44px] inline-flex items-center rounded-xl border border-[#27272A] bg-[#111114] px-4 py-2 text-xs font-semibold text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#E6A93C] whitespace-nowrap shrink-0 transition-colors"
                    >
                      {item.label}
                    </a>
                  ))}
                  <button
                    type="button"
                    onClick={() => navigateToView('lounge', 'ai-transcribe')}
                    className="min-h-[44px] inline-flex items-center rounded-xl border border-[#27272A] bg-[#111114] px-4 py-2 text-xs font-semibold text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#E6A93C] whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    Audio Transcribe
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsWatchPartyOpen(true)}
                    className="min-h-[44px] inline-flex items-center rounded-xl border border-[#E6A93C]/50 bg-[#E6A93C]/10 px-4 py-2 text-xs font-semibold text-[#E6A93C] hover:bg-[#E6A93C]/20 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    {t('navWatchParty')}
                  </button>
                </div>
              </div>
            </section>

            {/* Live Community Chat */}
            <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start min-w-0">
                <div className="lg:col-span-7 min-w-0">
                  <ErrorBoundary sectionName="Community Chat" compact>
                    <Suspense fallback={null}>
                      <CommunityChat
                        messages={messages}
                        onlineUsers={onlineUsers}
                        isConnected={isConnected}
                        username={activeUsername}
                        userId={activeUserId}
                        activeRoom={activeRoom}
                        pendingMovieRef={pendingMovieRef}
                        movies={movies}
                        onSwitchRoom={handleSwitchRoom}
                        onRenameUser={handleRenameUser}
                        onSendMessage={handleSendMessage}
                        onToggleLikeMessage={handleToggleLikeMessage}
                        onToggleReaction={handleToggleReaction}
                        onClearPendingMovie={() => setPendingMovieRef(null)}
                        onOpenMovieById={handleOpenById}
                        onDownloadMovieById={handleDownloadById}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </div>

                <div className="lg:col-span-5 min-w-0">
                  <section
                    id="archive-info"
                    className="rounded-xl border border-[#27272A] bg-[#111114] p-6"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                      <div>
                        <h2 className="font-display text-lg font-bold text-[#FAFAFA]">
                          {t('howItWorksTitle')}
                        </h2>
                        <p className="text-xs text-[#A1A1AA] mt-1">
                          {isAdmin ? t('howItWorksAdminDesc') : t('howItWorksViewerDesc')}
                        </p>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={handleOpenUpload}
                          className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-[#E6A93C] px-4 py-2 text-xs font-semibold text-[#0A0A0C] hover:bg-[#F5C563] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{t('uploadAMovie')}</span>
                        </button>
                      )}
                    </div>

                    <div className="space-y-4 border-t border-[#27272A] pt-5">
                      <div>
                        {isAdmin ? (
                          <>
                            <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA] mb-1">
                              <Upload className="h-4 w-4 text-[#E6A93C]" aria-hidden="true" />
                              <span>{t('step1AdminTitle')}</span>
                            </div>
                            <p className="text-xs text-[#A1A1AA] leading-relaxed">
                              {t('step1AdminDesc')}
                            </p>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA] mb-1">
                              <Play className="h-4 w-4 text-[#E6A93C]" aria-hidden="true" />
                              <span>{t('step1ViewerTitle')}</span>
                            </div>
                            <p className="text-xs text-[#A1A1AA] leading-relaxed">
                              {t('step1ViewerDesc')}
                            </p>
                          </>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA] mb-1">
                          <Download className="h-4 w-4 text-[#E6A93C]" aria-hidden="true" />
                          <span>{t('step2Title')}</span>
                        </div>
                        <p className="text-xs text-[#A1A1AA] leading-relaxed">
                          {t('step2Desc')}
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA] mb-1">
                          <MessageSquare className="h-4 w-4 text-[#E6A93C]" aria-hidden="true" />
                          <span>{t('step3Title')}</span>
                        </div>
                        <p className="text-xs text-[#A1A1AA] leading-relaxed">
                          {t('step3Desc')}
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>

            <Suspense
              fallback={
                <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 text-xs text-[#71717A]">
                  Loading interactive lounges...
                </div>
              }
            >
              <ErrorBoundary sectionName="Chess Lounge" compact>
                <ChessLounge
                  userId={activeUserId}
                  username={activeUsername}
                  isWsConnected={isConnected}
                  onlineUsers={onlineUsers}
                  chessRoom={chessRoom}
                  chessRooms={chessRooms}
                  chessError={chessError}
                  onClearChessError={() => setChessError(null)}
                  sendWs={sendWs}
                />
              </ErrorBoundary>
              <ErrorBoundary sectionName="Cinema 3D Stage" compact>
                <CinemaStage3D />
              </ErrorBoundary>
              <ErrorBoundary sectionName="Cinema Locations Map" compact>
                <CinemaLocationsMap />
              </ErrorBoundary>
              <ErrorBoundary sectionName="Cinema AI Studio & Audio Transcribe" compact>
                <CinemaAIStudio />
              </ErrorBoundary>
            </Suspense>
          </div>
        )}
      </main>

      <footer
        className={`border-t border-[#27272A] bg-[#0A0A0C] ${
          currentTrack && !isMiniDismissed
            ? 'pb-[calc(9.5rem+env(safe-area-inset-bottom))] lg:pb-20'
            : 'pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0'
        }`}
      >
        <div className="mx-auto flex max-w-[1440px] flex-col sm:flex-row items-center justify-between gap-4 px-4 py-6 sm:px-6 lg:px-8 text-xs text-[#71717A]">
          <div className="flex items-center gap-2.5 text-[#A1A1AA]">
            <TempleLogoIcon className="h-7 w-7 shrink-0" />
            <span className="font-medium text-[#E6A93C]">TEMPLE CINEMA</span>
            <span aria-hidden="true">·</span>
            <span>templesolosmovies.com</span>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={() => navigateToView('home', 'spotlight')}
              className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
            >
              {t('footerSpotlight')}
            </button>
            <button
              type="button"
              onClick={() => navigateToView('search', 'search-page')}
              className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
            >
              {t('navSearch')}
            </button>
            <button
              type="button"
              onClick={() => navigateToView('games', 'games-section')}
              className="hover:text-[#E5A93B] transition-colors cursor-pointer"
            >
              Games
            </button>
            <button
              type="button"
              onClick={() => navigateToView('lounge', 'chess-game')}
              className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
            >
              {t('navChess')}
            </button>
            <button
              type="button"
              onClick={() => navigateToView('lounge', 'ai-studio')}
              className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
            >
              {t('navStudio')}
            </button>
            <button
              type="button"
              onClick={() => navigateToView('lounge', 'stage-3d')}
              className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
            >
              {t('navStage3d')}
            </button>
            <button
              type="button"
              onClick={() => navigateToView('lounge', 'cinema-map')}
              className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
            >
              {t('navMap')}
            </button>
            <button
              type="button"
              onClick={() => setIsWatchPartyOpen(true)}
              className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
            >
              {t('navWatchParty')}
            </button>
            <button
              type="button"
              onClick={scrollToChat}
              className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
            >
              {t('footerChatLounge')}
            </button>
            <a
              href={WHATSAPP_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              {t('joinWhatsappChannel')}
            </a>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
            >
              {t('settingsTitle')}
            </button>
            <PWAInstallButton variant="footer" />
            {isAdmin && (
              <button
                type="button"
                onClick={handleOpenUpload}
                className="hover:text-[#FAFAFA] transition-colors cursor-pointer"
              >
                {t('uploadMovie')}
              </button>
            )}
          </div>
        </div>
      </footer>

      <ErrorBoundary sectionName="Cinema Dialogs" compact>
        <Suspense fallback={null}>
        {authModalState.open && (
          <AuthModal
            isOpen={authModalState.open}
            initialMode={authModalState.mode}
            onClose={() => {
              setAuthModalState((prev) => ({ ...prev, open: false }));
              setMobileNavTab(mainView);
            }}
            onSuccess={showNotice}
          />
        )}

        {isAdmin && isUploadOpen && (
          <UploadMovieModal
            isOpen={isUploadOpen}
            defaultUploader={activeUsername}
            onClose={() => setIsUploadOpen(false)}
            onUploaded={handleUploadedMovie}
          />
        )}

        {isAdmin && isAdminPanelOpen && (
          <AdminUploadModal
            isOpen={isAdminPanelOpen}
            movies={movies}
            defaultUploader={activeUsername}
            onClose={() => setIsAdminPanelOpen(false)}
            onCreateMovie={handleCreateCloudinaryMovie}
            onEditMovie={handleAdminEditMovie}
            onDeleteMovie={handleAdminDeleteMovie}
            onNotify={showNotice}
          />
        )}

        {selectedMovie && (
          <MovieDetailModal
            movie={selectedMovie}
            allMovies={movies}
            initialTrailerMode={selectedMovieInitialTrailer}
            isSaved={isMovieSaved(selectedMovie.id)}
            canManage={Boolean(isAdmin && selectedMovie)}
            isAuthenticated={Boolean(user)}
            isAdmin={Boolean(isAdmin)}
            currentUserId={user?.uid}
            currentAuthorName={activeUsername}
            ratingSummary={ratingsByMovie[selectedMovie.id]}
            reviews={reviewsByMovie[selectedMovie.id] || []}
            isLoadingReviews={isLoadingReviews}
            savedProgress={progressByMovie[selectedMovie.id]}
            isInWatchHistory={Boolean(
              progressByMovie[selectedMovie.id] || watchedIds.includes(selectedMovie.id)
            )}
            isOffline={isOffline}
            isPendingRatingSync={Boolean(pendingRatingsByMovie[selectedMovie.id])}
            isLowNetwork={isLowNetwork}
            videoQuality={settings.videoQuality}
            downloadQuality={settings.downloadQuality}
            onSaveProgress={(id, pos, dur) => void saveProgress(id, pos, dur)}
            onClearProgress={(id) => void clearProgress(id)}
            onClearReadHistory={(id) => {
              handleRemoveWatchHistory(id);
              showNotice(`Removed "${selectedMovie.title}" from Continue Watching.`);
            }}
            onClose={() => {
              setSelectedMovie(null);
              setSelectedMovieInitialTrailer(false);
              if (new URLSearchParams(window.location.search).has('movie')) {
                const nextUrl = new URL(window.location.href);
                nextUrl.searchParams.delete('movie');
                window.history.replaceState({}, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
              }
            }}
            onSelectMovie={(m) => handleOpenMovie(m, false)}
            onDownload={handleDownloadMovie}
            onShareToChat={handleShareToChat}
            onStartWatchParty={handleStartMovieWatchParty}
            onToggleSave={handleToggleSave}
            onRateMovie={handleRateMovie}
            onSubmitReview={handleSubmitReview}
            onDeleteReview={handleDeleteReview}
            onRequireAuthForReview={() => {
              setAuthModalState({ open: true, mode: 'login' });
              showNotice('Log in or sign up to write a formal movie review.');
            }}
            onMoviePlayed={handleRecordWatched}
            onShareSuccess={showNotice}
            onUpdate={handleUpdateMovie}
            onDelete={handleDeleteMovie}
          />
        )}

        {downloadPickerMovie && (
          <DownloadQualityModal
            movie={downloadPickerMovie}
            defaultQuality={settings.downloadQuality}
            isWifiBlocked={settings.downloadWifiOnly && isCellularConnection()}
            onConfirm={handleConfirmTierDownload}
            onClose={() => setDownloadPickerMovie(null)}
          />
        )}

        {isRequestModalOpen && (
          <RequestMovieModal
            isOpen={isRequestModalOpen}
            requesterName={activeUsername}
            onSubmitted={(title) =>
              showNotice(`Requested "${title}" — added to the community queue!`)
            }
            onClose={() => setIsRequestModalOpen(false)}
          />
        )}

        {isStatsOpen && (
          <MyStatsModal
            isOpen={isStatsOpen}
            displayName={activeUsername}
            email={user?.email}
            isAuthenticated={Boolean(user)}
            isAdmin={Boolean(isAdmin)}
            stats={userWatchStats}
            allMovies={movies}
            savedMoviesList={savedMoviesList}
            watchHistoryList={watchHistoryList}
            downloadTasks={downloadManager.tasks}
            storageUsedBytes={downloadManager.storageUsedBytes}
            onSelectMovie={(m) => handleOpenMovie(m, false)}
            onToggleSave={handleToggleSave}
            onRemoveHistory={handleRemoveWatchHistory}
            onOpenDownloads={() => navigateToView('downloads', 'catalog')}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenRequestMovie={() => setIsRequestModalOpen(true)}
            onOpenAuth={() => setAuthModalState({ open: true, mode: 'login' })}
            onLogOut={() => {
              void logOut().then(() => {
                setCollectionView('all');
                showNotice('You have logged out.');
              });
            }}
            onClose={() => {
              setIsStatsOpen(false);
              setMobileNavTab(mainView);
            }}
          />
        )}

        {isSettingsOpen && (
          <SettingsModal
            isOpen={isSettingsOpen}
            settings={settings}
            dailyNotificationSentToday={dailyNotificationSentToday}
            cacheSummary={cacheSummary}
            onUpdateSettings={updateSettings}
            onChangeLanguage={updateLanguagePreference}
            onRefreshCacheSummary={refreshCacheSummary}
            onClearCache={clearAppCache}
            onResetDefaults={resetSettings}
            onNotify={showNotice}
            onClose={() => setIsSettingsOpen(false)}
          />
        )}

        {isWatchPartyOpen && (
          <WatchPartyModal
            isOpen={isWatchPartyOpen}
            movies={movies}
            partyState={partyState}
            currentUserId={activeUserId}
            onJoinOrCreateRoom={handleJoinOrCreateParty}
            onSyncPlayback={handleSyncParty}
            onLeaveRoom={handleLeaveParty}
            onClose={() => setIsWatchPartyOpen(false)}
          />
        )}
      </Suspense>
      </ErrorBoundary>

      <MusicPlayerBar />

      <BottomNavBar
        activeTab={mobileNavTab}
        activeDownloadsCount={activeDownloadsCount}
        onSelectHome={() => {
          setCollectionView('all');
          setSelectedGenre('All');
          navigateToView('home', 'spotlight');
        }}
        onSelectSearch={() => {
          navigateToView('search', 'search-page');
        }}
        onSelectDownloads={() => {
          setCollectionView('all');
          setSelectedGenre('All');
          setCatalogSort('downloads');
          navigateToView('downloads', 'catalog');
        }}
        onSelectGames={() => {
          navigateToView('games', 'games-section');
        }}
        onSelectLounge={() => {
          navigateToView('lounge');
        }}
        onSelectProfile={() => {
          setMobileNavTab('profile');
          setIsStatsOpen(true);
        }}
      />
    </div>
  );
}
