import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Upload, Download, Play } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useLanguage } from './contexts/LanguageContext';
import { useMovieRatings } from './hooks/useMovieRatings';
import { useMovieReviews, type SubmitReviewInput } from './hooks/useMovieReviews';
import { useUpcomingNotifications } from './hooks/useUpcomingNotifications';
import { useWatchProgress } from './hooks/useWatchProgress';
import { isCellularConnection, useAppSettings } from './hooks/useAppSettings';
import {
  WHATSAPP_CHANNEL_URL,
  type ChatMessage,
  type ChatRoomId,
  type ClientWsEvent,
  type Movie,
  type MovieChatReference,
  type MovieGenre,
  type MovieQuality,
  type OnlineUser,
  type ServerWsEvent,
  type UpcomingMovie,
  type WatchPartyState,
} from './types/cinema';
import { triggerMovieDownload } from './utils/format';
import { Header } from './components/Header';
import { HeroSpotlight } from './components/HeroSpotlight';
import { ContinueWatchingRow } from './components/ContinueWatchingRow';
import { GenreShowcaseRows } from './components/GenreShowcaseRows';
import { BottomNavBar, type MobileNavTab } from './components/BottomNavBar';
import { TrendingNow } from './components/TrendingNow';
import { ComingSoon } from './components/ComingSoon';
import { MovieGrid, type CollectionFilter } from './components/MovieGrid';
import { CommunityChat } from './components/CommunityChat';
import { PWAInstallButton } from './components/PWAInstallButton';
import type { UserWatchStats } from './components/MyStatsModal';

const UploadMovieModal = lazy(() =>
  import('./components/UploadMovieModal').then((m) => ({ default: m.UploadMovieModal }))
);
const MovieDetailModal = lazy(() =>
  import('./components/MovieDetailModal').then((m) => ({ default: m.MovieDetailModal }))
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

const MOVIES_CACHE_KEY = 'tsm_cached_movies_v1';

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
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Movie[]) : [];
  } catch {
    return [];
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
    getIdToken,
  } = useAuth();
  const { ratingsByMovie, rateMovie } = useMovieRatings(user?.uid);
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
  const [catalogSort, setCatalogSort] = useState<'newest' | 'imdb' | 'downloads' | 'title'>('newest');
  const [mobileNavTab, setMobileNavTab] = useState<MobileNavTab>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [authModalState, setAuthModalState] = useState<{
    open: boolean;
    mode: 'login' | 'signup';
  }>({ open: false, mode: 'login' });

  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWatchPartyOpen, setIsWatchPartyOpen] = useState(false);
  const [partyState, setPartyState] = useState<WatchPartyState | null>(null);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [pendingMovieRef, setPendingMovieRef] = useState<MovieChatReference | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [isLowNetwork, setIsLowNetwork] = useState<boolean>(() => detectLowNetwork());

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

  const activeUserId = user?.uid || guestId;
  const activeUsername = profile?.displayName || user?.displayName || guestName;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const savedMovieIds = useMemo(
    () => new Set(savedMovies.map((m) => m.movieId)),
    [savedMovies]
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
          setMovies(data.movies);
          saveCachedMovies(data.movies);
          const sharedId = new URLSearchParams(window.location.search).get('movie');
          if (sharedId) {
            const match = data.movies.find((m) => m.id === sharedId);
            if (match) setSelectedMovie(match);
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
          username: activeUsername,
          room: activeRoom,
        };
        socket.send(JSON.stringify(joinEvent));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ServerWsEvent;
          if (data.type === 'ws:init') {
            setMovies(data.movies);
            saveCachedMovies(data.movies);
            setMessages(data.messages);
            setOnlineUsers(data.onlineUsers);
            setIsLoading(false);
          } else if (data.type === 'movie:created') {
            setMovies((prev) => {
              if (prev.some((m) => m.id === data.movie.id)) return prev;
              const next = [data.movie, ...prev];
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
          } else if (data.type === 'presence:update') {
            setOnlineUsers(data.onlineUsers);
          } else if (data.type === 'party:state') {
            setPartyState(data.party);
          } else if (data.type === 'party:error') {
            showNotice(data.message);
          }
        } catch {
          // Ignore malformed payloads
        }
      };

      socket.onclose = () => {
        if (unmounted) return;
        setIsConnected(false);
        reconnectTimerRef.current = window.setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      unmounted = true;
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
    sendWs({
      type: 'chat:send',
      id,
      room: activeRoom,
      userId: activeUserId,
      username: activeUsername,
      text,
      movieRef,
    });
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

  const handleDownloadMovie = (movie: Movie) => {
    if (settings.downloadWifiOnly && isCellularConnection()) {
      showNotice(t('settingsWifiBlockedNotice'));
      return;
    }
    triggerMovieDownload(movie.id, settings.downloadQuality);
    showNotice(`Downloading ${movie.title} (${settings.downloadQuality} · ${movie.fileName})`);
  };

  const handleDownloadById = (movieId: string) => {
    const found = movies.find((m) => m.id === movieId);
    if (found) handleDownloadMovie(found);
  };

  const handleOpenById = (movieId: string) => {
    const found = movies.find((m) => m.id === movieId);
    if (found) setSelectedMovie(found);
  };

  const handleShareToChat = (movie: Movie) => {
    setPendingMovieRef({
      id: movie.id,
      title: movie.title,
      genre: movie.genre,
      year: movie.year,
      quality: movie.quality,
      posterUrl: movie.posterUrl,
    });
    const chatEl = document.getElementById('community-chat');
    chatEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const handleToggleSave = async (movie: Movie) => {
    if (!user) {
      setAuthModalState({ open: true, mode: 'login' });
      showNotice('Log in or sign up to save movies to your personal watchlist.');
      return;
    }
    const saved = await toggleSaveMovie(movie);
    showNotice(saved ? `Saved "${movie.title}" to your watchlist.` : `Removed "${movie.title}" from watchlist.`);
  };

  const handleRateMovie = async (movieId: string, stars: number) => {
    if (!user) {
      setAuthModalState({ open: true, mode: 'login' });
      showNotice('Log in or sign up to submit a 5-star rating.');
      return;
    }
    await rateMovie(movieId, stars);
    showNotice(`Saved your ${stars}-star rating.`);
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

  const handleOpenUpload = () => {
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
  };

  const handleSelectCollection = (view: CollectionFilter) => {
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
  };

  const handleUpdateMovie = async (
    movieId: string,
    updates: {
      title: string;
      genre: MovieGenre;
      quality: MovieQuality;
      director: string;
      imdbRating?: number;
      synopsis: string;
    }
  ) => {
    if (!isAdmin) {
      showNotice('Only the administrator can edit movie details.');
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
      setMovies((prev) => {
        const next = prev.map((m) => (m.id === movieId ? data.movie : m));
        saveCachedMovies(next);
        return next;
      });
      setSelectedMovie(data.movie);
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
    setMovies((prev) => {
      if (prev.some((m) => m.id === movie.id)) return prev;
      const next = [movie, ...prev];
      saveCachedMovies(next);
      return next;
    });
    showNotice(`"${movie.title}" published to templesolosmovies.com!`);
  };

  const scrollToChat = () => {
    const el = document.getElementById('community-chat');
    el?.scrollIntoView({ behavior: 'smooth' });
  };

  const featuredMovie = movies.find((m) => m.featured) || movies[0];
  const totalDownloads = movies.reduce((sum, m) => sum + m.downloads, 0);

  return (
    <div className="min-h-screen bg-[#09090B] text-[#FAFAFA] flex flex-col">
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
        searchQuery={searchQuery}
        searchInputRef={searchInputRef}
        userStats={userWatchStats}
        onSearchChange={setSearchQuery}
        onOpenUpload={handleOpenUpload}
        onOpenAuth={(mode) => setAuthModalState({ open: true, mode })}
        onOpenStats={() => setIsStatsOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWatchParty={() => setIsWatchPartyOpen(true)}
        onScrollToChat={scrollToChat}
        onSelectCollection={handleSelectCollection}
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
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#E5A93B]/40 bg-[#18181B] px-4 py-2.5 text-xs font-medium text-[#FAFAFA] shadow-xl"
        >
          {notice}
        </div>
      )}

      <main className="flex-1">
        {isLoading && movies.length === 0 ? (
          <div className="mx-auto max-w-[1440px] px-4 py-20 sm:px-6 lg:px-8 text-center text-sm text-[#A1A1AA]">
            Loading movie vault...
          </div>
        ) : (
          <>
            <HeroSpotlight
              movie={featuredMovie}
              totalMovies={movies.length}
              totalDownloads={totalDownloads}
              onlineCount={onlineUsers.length}
              isAdmin={isAdmin}
              isSaved={featuredMovie ? isMovieSaved(featuredMovie.id) : false}
              onDownload={handleDownloadMovie}
              onPreview={setSelectedMovie}
              onToggleSave={handleToggleSave}
              onStartWatchParty={handleStartMovieWatchParty}
              onOpenUpload={handleOpenUpload}
            />
            <ContinueWatchingRow
              movies={movies}
              entries={continueWatchingList}
              onResumeMovie={setSelectedMovie}
              onRemoveProgress={(movieId) => void clearProgress(movieId)}
            />
            <GenreShowcaseRows
              movies={movies}
              savedMovieIds={savedMovieIds}
              ratingsByMovie={ratingsByMovie}
              onSelectMovie={setSelectedMovie}
              onToggleSave={handleToggleSave}
              onSeeAllGenre={(genre) => {
                setCollectionView('all');
                setSelectedGenre(genre);
                document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
              }}
            />
            <TrendingNow
              movies={movies}
              onDownload={handleDownloadMovie}
              onSelectMovie={setSelectedMovie}
            />
          </>
        )}

        <ComingSoon
          upcomingMovies={upcomingMovies}
          isLoading={isUpcomingLoading}
          error={upcomingError}
          subscribedIds={subscribedIdSet}
          effectiveEmail={effectiveEmail}
          isAdmin={isAdmin}
          onRetry={() => void retryUpcoming()}
          onSubscribe={async (release: UpcomingMovie, email?: string) => {
            const res = await subscribeToRelease(release, email);
            showNotice(`Release alert enabled for "${release.title}" (${res.email}).`);
          }}
          onUnsubscribe={async (release: UpcomingMovie) => {
            await unsubscribeFromRelease(release);
            showNotice(`Release alert removed for "${release.title}".`);
          }}
          onSubscribeAll={async (email?: string) => {
            const res = await subscribeToAllUpcoming(email);
            showNotice(`Subscribed ${res.email} to ${res.count} upcoming release alerts.`);
          }}
          onCreateUpcoming={async (input) => {
            const created = await createUpcomingRelease(input);
            showNotice(`Scheduled "${created.title}" in Coming Soon.`);
          }}
          onDeleteUpcoming={async (releaseId) => {
            await deleteUpcomingRelease(releaseId);
            showNotice('Removed upcoming release.');
          }}
        />

        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-8">
              <MovieGrid
                movies={movies}
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
                onSelectMovie={setSelectedMovie}
                onShareToChat={handleShareToChat}
                onToggleSave={handleToggleSave}
                onOpenUpload={handleOpenUpload}
              />

              <section
                id="archive-info"
                className="mt-4 mb-10 rounded-xl border border-[#27272A] bg-[#111114] p-6 sm:p-8"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="font-display text-xl font-bold text-[#FAFAFA]">
                      {t('howItWorksTitle')}
                    </h2>
                    <p className="text-sm text-[#A1A1AA] mt-1">
                      {isAdmin ? t('howItWorksAdminDesc') : t('howItWorksViewerDesc')}
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handleOpenUpload}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('uploadAMovie')}</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 border-t border-[#27272A] pt-6">
                  <div>
                    {isAdmin ? (
                      <>
                        <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA] mb-1.5">
                          <Upload className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                          <span>{t('step1AdminTitle')}</span>
                        </div>
                        <p className="text-xs text-[#A1A1AA] leading-relaxed">
                          {t('step1AdminDesc')}
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA] mb-1.5">
                          <Play className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                          <span>{t('step1ViewerTitle')}</span>
                        </div>
                        <p className="text-xs text-[#A1A1AA] leading-relaxed">
                          {t('step1ViewerDesc')}
                        </p>
                      </>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA] mb-1.5">
                      <Download className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                      <span>{t('step2Title')}</span>
                    </div>
                    <p className="text-xs text-[#A1A1AA] leading-relaxed">
                      {t('step2Desc')}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA] mb-1.5">
                      <MessageSquare className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
                      <span>{t('step3Title')}</span>
                    </div>
                    <p className="text-xs text-[#A1A1AA] leading-relaxed">
                      {t('step3Desc')}
                    </p>
                  </div>
                </div>
              </section>
            </div>

            <div className="lg:col-span-4 pb-10">
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
                onClearPendingMovie={() => setPendingMovieRef(null)}
                onOpenMovieById={handleOpenById}
                onDownloadMovieById={handleDownloadById}
              />
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
          <ChessLounge />
          <CinemaAIStudio />
          <CinemaStage3D />
          <CinemaLocationsMap />
        </Suspense>
      </main>

      <footer className="border-t border-[#27272A] bg-[#09090B] pb-20 lg:pb-0">
        <div className="mx-auto flex max-w-[1440px] flex-col sm:flex-row items-center justify-between gap-4 px-4 py-6 sm:px-6 lg:px-8 text-xs text-[#71717A]">
          <div className="flex items-center gap-2.5 text-[#A1A1AA]">
            <img
              src="/app-icon-full.png"
              alt="Temple Cinema icon"
              className="h-7 w-7 rounded object-cover border border-[#E5A93B]/35"
            />
            <span className="font-medium text-[#E5A93B]">TEMPLE CINEMA</span>
            <span aria-hidden="true">·</span>
            <span>templesolosmovies.com</span>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <a href="#spotlight" className="hover:text-[#FAFAFA] transition-colors">
              {t('footerSpotlight')}
            </a>
            <a href="#catalog" className="hover:text-[#FAFAFA] transition-colors">
              {t('navCatalog')}
            </a>
            <a href="#chess-game" className="hover:text-[#FAFAFA] transition-colors">
              {t('navChess')}
            </a>
            <a href="#ai-studio" className="hover:text-[#FAFAFA] transition-colors">
              {t('navStudio')}
            </a>
            <a href="#stage-3d" className="hover:text-[#FAFAFA] transition-colors">
              {t('navStage3d')}
            </a>
            <a href="#cinema-map" className="hover:text-[#FAFAFA] transition-colors">
              {t('navMap')}
            </a>
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

      <Suspense fallback={null}>
        {authModalState.open && (
          <AuthModal
            isOpen={authModalState.open}
            initialMode={authModalState.mode}
            onClose={() => setAuthModalState((prev) => ({ ...prev, open: false }))}
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

        {selectedMovie && (
          <MovieDetailModal
            movie={selectedMovie}
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
            isLowNetwork={isLowNetwork}
            videoQuality={settings.videoQuality}
            downloadQuality={settings.downloadQuality}
            onSaveProgress={(id, pos, dur) => void saveProgress(id, pos, dur)}
            onClearProgress={(id) => void clearProgress(id)}
            onClose={() => {
              setSelectedMovie(null);
              if (new URLSearchParams(window.location.search).has('movie')) {
                const nextUrl = new URL(window.location.href);
                nextUrl.searchParams.delete('movie');
                window.history.replaceState({}, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
              }
            }}
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

        {isStatsOpen && (
          <MyStatsModal
            isOpen={isStatsOpen}
            displayName={activeUsername}
            stats={userWatchStats}
            onClose={() => setIsStatsOpen(false)}
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

      <BottomNavBar
        activeTab={mobileNavTab}
        onSelectHome={() => {
          setMobileNavTab('home');
          setCollectionView('all');
          setSelectedGenre('All');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onSelectSearch={() => {
          setMobileNavTab('search');
          searchInputRef.current?.focus();
          document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
        }}
        onSelectDownloads={() => {
          setMobileNavTab('downloads');
          setCollectionView('all');
          setSelectedGenre('All');
          setCatalogSort('downloads');
          document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
        }}
        onSelectProfile={() => {
          setMobileNavTab('profile');
          if (user) {
            setIsStatsOpen(true);
          } else {
            setAuthModalState({ open: true, mode: 'login' });
          }
        }}
      />
    </div>
  );
}
