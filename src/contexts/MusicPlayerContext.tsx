import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MusicTrack, SpotifySessionStatus } from '../types/music';

interface SpotifySdkPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  addListener: (event: string, cb: (payload: unknown) => void) => void;
  getCurrentState: () => Promise<{
    paused: boolean;
    position: number;
    duration: number;
    track_window?: {
      current_track?: { uri?: string };
    };
  } | null>;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifySdkPlayer;
    };
  }
}

export type ActivePlaybackMode = 'preview' | 'spotify-sdk';

interface MusicPlayerContextValue {
  tracks: MusicTrack[];
  currentTrack: MusicTrack | null;
  isPlaying: boolean;
  isLoadingTracks: boolean;
  trackError: string | null;
  noticeMessage: string | null;
  searchQuery: string;
  selectedGenre: string;
  playbackMode: ActivePlaybackMode;
  isExpanded: boolean;
  isMiniDismissed: boolean;
  spotifyStatus: SpotifySessionStatus;
  sdkReady: boolean;
  searchTracks: (query: string, genre?: string) => Promise<void>;
  selectGenre: (genre: string, query?: string) => Promise<void>;
  playTrack: (track: MusicTrack, nextQueue?: MusicTrack[]) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  pauseMusic: () => void;
  nextTrack: () => Promise<void>;
  prevTrack: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  setExpanded: (expanded: boolean) => void;
  dismissMiniPlayer: () => void;
  connectSpotify: () => Promise<void>;
  disconnectSpotify: () => Promise<void>;
}

interface MusicProgressContextValue {
  currentTimeSec: number;
  durationSec: number;
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);
const MusicProgressContext = createContext<MusicProgressContextValue>({
  currentTimeSec: 0,
  durationSec: 30,
});
const SPOTIFY_SID_STORAGE_KEY = 'tsm_spotify_sid_v1';
const MUSIC_CACHE_STORAGE_KEY = 'tsm_cached_music_v1';
const MUSIC_GENRE_CACHE_STORAGE_KEY = 'tsm_cached_music_genres_v1';
const PREVIEW_MAX_SECONDS = 30;

function loadCachedMusicTracks(): MusicTrack[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(MUSIC_CACHE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as MusicTrack[]) : [];
  } catch {
    return [];
  }
}

function saveCachedMusicTracks(list: MusicTrack[]) {
  if (typeof window === 'undefined' || list.length === 0) return;
  try {
    window.localStorage.setItem(MUSIC_CACHE_STORAGE_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    // Ignore storage quota errors
  }
}

function loadCachedGenreTracksMap(): Record<string, MusicTrack[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(MUSIC_GENRE_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, MusicTrack[]>) : {};
  } catch {
    return {};
  }
}

function saveCachedGenreTracks(genreKey: string, list: MusicTrack[]) {
  if (typeof window === 'undefined' || list.length === 0) return;
  try {
    const current = loadCachedGenreTracksMap();
    const keys = Object.keys(current);
    if (keys.length >= 12 && !current[genreKey]) {
      delete current[keys[0]];
    }
    current[genreKey] = list.slice(0, 16);
    window.localStorage.setItem(MUSIC_GENRE_CACHE_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage quota errors
  }
}

function getStoredSpotifySid(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(SPOTIFY_SID_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function storeSpotifySid(sid: string) {
  if (typeof window === 'undefined') return;
  try {
    if (sid) {
      window.sessionStorage.setItem(SPOTIFY_SID_STORAGE_KEY, sid);
    } else {
      window.sessionStorage.removeItem(SPOTIFY_SID_STORAGE_KEY);
    }
  } catch {
    // Ignore storage error
  }
}

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const initialCachedTracks = useMemo(() => loadCachedMusicTracks(), []);
  const [tracks, setTracks] = useState<MusicTrack[]>(initialCachedTracks);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(() => initialCachedTracks[0] || null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingTracks, setIsLoadingTracks] = useState(() => initialCachedTracks.length === 0);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [playbackMode, setPlaybackMode] = useState<ActivePlaybackMode>('preview');
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(PREVIEW_MAX_SECONDS);
  const [isExpanded, setExpanded] = useState(false);
  const [isMiniDismissed, setIsMiniDismissed] = useState(false);

  const [spotifySid, setSpotifySid] = useState<string>(() => getStoredSpotifySid());
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifySessionStatus>({
    configured: false,
    connected: false,
    isPremium: false,
    product: 'unknown',
    callbackUrl: '',
  });
  const [spotifyDeviceId, setSpotifyDeviceId] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const spotifyPlayerRef = useRef<SpotifySdkPlayer | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const playbackModeRef = useRef(playbackMode);
  const currentTrackRef = useRef(currentTrack);
  const tracksRef = useRef(tracks);
  const spotifySidRef = useRef(spotifySid);
  const selectedGenreRef = useRef(selectedGenre);
  const trackQueryCacheRef = useRef<Map<string, MusicTrack[]>>(new Map());
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);
  useEffect(() => {
    spotifySidRef.current = spotifySid;
  }, [spotifySid]);
  useEffect(() => {
    selectedGenreRef.current = selectedGenre;
  }, [selectedGenre]);

  const showNotice = useCallback((msg: string) => {
    setNoticeMessage(msg);
    window.setTimeout(() => {
      setNoticeMessage((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  const authHeaders = useCallback((): Record<string, string> => {
    const sid = spotifySidRef.current;
    return sid ? { 'X-Spotify-Session': sid } : {};
  }, []);

  const pauseMusic = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
    if (spotifyPlayerRef.current && playbackModeRef.current === 'spotify-sdk') {
      void spotifyPlayerRef.current.pause().catch(() => {});
    }
    setIsPlaying(false);
  }, []);

  // Automatically pause music whenever ANY video element starts playing on the site
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleAnyVideoPlay = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === 'VIDEO') {
        if (isPlayingRef.current) {
          pauseMusic();
          showNotice('Music paused automatically for movie playback.');
        }
      }
    };
    document.addEventListener('play', handleAnyVideoPlay, true);
    return () => document.removeEventListener('play', handleAnyVideoPlay, true);
  }, [pauseMusic, showNotice]);

  // Initialize HTML5 Audio element once (never triggers playback until explicit user tap)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const audio = new Audio();
    audio.preload = 'none';
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      if (playbackModeRef.current !== 'preview') return;
      const clamped = Math.min(PREVIEW_MAX_SECONDS, audio.currentTime || 0);
      setCurrentTimeSec(clamped);
      const rawDur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : PREVIEW_MAX_SECONDS;
      setDurationSec(Math.min(PREVIEW_MAX_SECONDS, rawDur));
      if (audio.currentTime >= PREVIEW_MAX_SECONDS) {
        audio.pause();
        audio.currentTime = 0;
        setCurrentTimeSec(0);
        setIsPlaying(false);
      }
    };

    const handleEnded = () => {
      if (playbackModeRef.current !== 'preview') return;
      setCurrentTimeSec(0);
      setIsPlaying(false);
    };

    const handlePause = () => {
      if (playbackModeRef.current === 'preview') {
        setIsPlaying(false);
      }
    };

    const handlePlay = () => {
      if (playbackModeRef.current === 'preview') {
        setIsPlaying(true);
      }
    };

    const handleError = () => {
      if (playbackModeRef.current === 'preview') {
        setIsPlaying(false);
        showNotice('Preview audio could not load. Use Open in Spotify or Boomplay below.');
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('error', handleError);

    return () => {
      audio.pause();
      audio.src = '';
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('error', handleError);
      audioRef.current = null;
    };
  }, [showNotice]);

  const fetchSpotifyStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/spotify/status', {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (!resp.ok) return;
      const data = (await resp.json()) as SpotifySessionStatus;
      setSpotifyStatus(data);
    } catch {
      // Keep default status cleanly
    }
  }, [authHeaders]);

  const searchTracks = useCallback(
    async (query: string, genreOverride?: string) => {
      const activeGenre = typeof genreOverride === 'string' ? genreOverride : selectedGenreRef.current;
      const cleanQuery = query.trim();
      const cacheKey = `${activeGenre.toLowerCase()}::${cleanQuery.toLowerCase()}`;

      setSearchQuery(query);
      if (typeof genreOverride === 'string') {
        setSelectedGenre(genreOverride);
        selectedGenreRef.current = genreOverride;
      }
      setTrackError(null);

      // 0ms client-side memory cache hit
      const memCached = trackQueryCacheRef.current.get(cacheKey);
      if (memCached && memCached.length > 0) {
        setTracks(memCached);
        setCurrentTrack((prev) => prev || memCached[0] || null);
        setIsLoadingTracks(false);
        return;
      }

      // 0ms offline/warm localStorage genre cache hit while fetching fresh in background
      if (!cleanQuery) {
        const storedGenreMap = loadCachedGenreTracksMap();
        const storedGenreTracks = storedGenreMap[activeGenre];
        if (storedGenreTracks && storedGenreTracks.length > 0) {
          setTracks(storedGenreTracks);
          setCurrentTrack((prev) => prev || storedGenreTracks[0] || null);
        }
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const storedGenreMap = loadCachedGenreTracksMap();
        const offlineList = storedGenreMap[activeGenre] || loadCachedMusicTracks();
        if (offlineList.length > 0) {
          const filteredOffline = cleanQuery
            ? offlineList.filter((item) =>
                `${item.title} ${item.artist} ${item.album} ${item.genre || ''}`
                  .toLowerCase()
                  .includes(cleanQuery.toLowerCase())
              )
            : offlineList;
          setTracks(filteredOffline.length > 0 ? filteredOffline : offlineList);
          setTrackError(null);
        } else {
          setTrackError('Connect once to cache music tracks for offline browsing.');
        }
        setIsLoadingTracks(false);
        return;
      }

      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setIsLoadingTracks(true);
      try {
        const params = new URLSearchParams();
        if (cleanQuery) params.set('q', cleanQuery);
        if (activeGenre && activeGenre !== 'All') params.set('genre', activeGenre);
        const resp = await fetch(`/api/music/tracks?${params.toString()}`, {
          credentials: 'include',
          headers: authHeaders(),
          signal: controller.signal,
        });
        const data = (await resp.json()) as { tracks?: MusicTrack[]; error?: string };
        const nextTracks = Array.isArray(data.tracks) ? data.tracks : [];
        if (controller.signal.aborted) return;

        setTracks(nextTracks);
        if (nextTracks.length > 0) {
          if (trackQueryCacheRef.current.size >= 30) {
            const oldestKey = trackQueryCacheRef.current.keys().next().value;
            if (oldestKey) trackQueryCacheRef.current.delete(oldestKey);
          }
          trackQueryCacheRef.current.set(cacheKey, nextTracks);
          if (!cleanQuery) {
            saveCachedGenreTracks(activeGenre, nextTracks);
          }
          if ((!cleanQuery || cleanQuery.toLowerCase() === 'afrobeats') && activeGenre === 'All') {
            saveCachedMusicTracks(nextTracks);
          }
        }
        // Set initial track display ONLY when none selected yet, WITHOUT starting playback
        setCurrentTrack((prev) => prev || nextTracks[0] || null);
        if (!resp.ok && data.error) {
          setTrackError(data.error);
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        if (tracksRef.current.length === 0) {
          setTrackError('Unable to load music tracks while offline.');
        }
      } finally {
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
          setIsLoadingTracks(false);
        }
      }
    },
    [authHeaders]
  );

  const selectGenre = useCallback(
    async (genre: string, customQuery?: string) => {
      const nextGenre = genre || 'All';
      setSelectedGenre(nextGenre);
      selectedGenreRef.current = nextGenre;
      await searchTracks(typeof customQuery === 'string' ? customQuery : '', nextGenre);
    },
    [searchTracks]
  );

  // Initial load: defer when cached tracks are already hydrated so critical movie catalog loads first
  useEffect(() => {
    const runInitialFetch = () => {
      void fetchSpotifyStatus();
      void searchTracks('Afrobeats', 'All');
    };

    if (initialCachedTracks.length > 0) {
      const win = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      if (typeof win.requestIdleCallback === 'function') {
        const id = win.requestIdleCallback(runInitialFetch, { timeout: 900 });
        return () => win.cancelIdleCallback?.(id);
      }
      const timer = window.setTimeout(runInitialFetch, 250);
      return () => window.clearTimeout(timer);
    }

    runInitialFetch();
  }, [fetchSpotifyStatus, searchTracks, initialCachedTracks.length]);

  // Listen for OAuth popup completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      const isTrusted =
        origin === window.location.origin ||
        origin.endsWith('.run.app') ||
        origin.includes('localhost');
      if (!isTrusted) return;
      if (event.data?.type === 'SPOTIFY_OAUTH_SUCCESS') {
        const sid = typeof event.data.spotifySid === 'string' ? event.data.spotifySid : '';
        if (sid) {
          storeSpotifySid(sid);
          setSpotifySid(sid);
        }
        void fetchSpotifyStatus().then(() => searchTracks(searchQuery || 'Afrobeats'));
        showNotice(
          event.data.isPremium
            ? `Spotify Premium connected (${event.data.displayName || 'User'}) — full songs ready when you press Play.`
            : 'Spotify Free connected — 30-second previews active. Use Open in Spotify for full tracks.'
        );
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchSpotifyStatus, searchTracks, searchQuery, showNotice]);

  // Initialize Spotify Web Playback SDK ONLY when logged in with Spotify Premium
  useEffect(() => {
    if (!spotifyStatus.connected || !spotifyStatus.isPremium) {
      if (spotifyPlayerRef.current) {
        spotifyPlayerRef.current.disconnect();
        spotifyPlayerRef.current = null;
      }
      setSpotifyDeviceId(null);
      setSdkReady(false);
      return;
    }

    let cancelled = false;

    const initPlayer = () => {
      if (cancelled || !window.Spotify || spotifyPlayerRef.current) return;
      const player = new window.Spotify.Player({
        name: 'Temple Cinema',
        volume: 0.85,
        getOAuthToken: (cb) => {
          void fetch('/api/spotify/token', {
            credentials: 'include',
            headers: authHeaders(),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { accessToken?: string } | null) => {
              if (data?.accessToken) {
                cb(data.accessToken);
              }
            })
            .catch(() => {});
        },
      });

      player.addListener('ready', (payload: unknown) => {
        const data = payload as { device_id?: string };
        if (data?.device_id) {
          setSpotifyDeviceId(data.device_id);
          setSdkReady(true);
        }
      });

      player.addListener('not_ready', () => {
        setSdkReady(false);
      });

      player.addListener('player_state_changed', (payload: unknown) => {
        const state = payload as {
          paused?: boolean;
          position?: number;
          duration?: number;
        } | null;
        if (!state || playbackModeRef.current !== 'spotify-sdk') return;
        setIsPlaying(!state.paused);
        if (typeof state.position === 'number') {
          setCurrentTimeSec(Math.floor(state.position / 1000));
        }
        if (typeof state.duration === 'number' && state.duration > 0) {
          setDurationSec(Math.round(state.duration / 1000));
        }
      });

      void player.connect().then((connected) => {
        if (!connected && !cancelled) {
          setSdkReady(false);
        }
      });
      spotifyPlayerRef.current = player;
    };

    if (window.Spotify) {
      initPlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = initPlayer;
      if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
        const script = document.createElement('script');
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [spotifyStatus.connected, spotifyStatus.isPremium, authHeaders]);

  // Smooth progress tick while playing full song via Spotify SDK
  useEffect(() => {
    if (!isPlaying || playbackMode !== 'spotify-sdk') return;
    const timer = window.setInterval(() => {
      setCurrentTimeSec((prev) => Math.min(durationSec, prev + 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, playbackMode, durationSec]);

  const fetchFreshToken = useCallback(async (): Promise<string | null> => {
    try {
      const resp = await fetch('/api/spotify/token', {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as { accessToken?: string };
      return data.accessToken || null;
    } catch {
      return null;
    }
  }, [authHeaders]);

  const playTrack = useCallback(
    async (track: MusicTrack, nextQueue?: MusicTrack[]) => {
      setIsMiniDismissed(false);
      if (nextQueue && nextQueue.length > 0) {
        setTracks(nextQueue);
      }
      setCurrentTrack(track);
      setCurrentTimeSec(0);

      // Legal Engine 1: Spotify Premium Full Song via Web Playback SDK
      if (spotifyStatus.connected && spotifyStatus.isPremium && spotifyDeviceId && track.spotifyUri) {
        if (audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause();
        }
        const token = await fetchFreshToken();
        if (token) {
          try {
            const playResp = await fetch(
              `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ uris: [track.spotifyUri] }),
              }
            );
            if (playResp.ok) {
              setPlaybackMode('spotify-sdk');
              setDurationSec(track.fullDurationSec || 180);
              setIsPlaying(true);
              return;
            }
          } catch {
            // Fall through cleanly to 30s HTML5 audio preview
          }
        }
      }

      // Legal Engine 2: HTML5 Audio 30-Second Official Preview
      if (spotifyPlayerRef.current && playbackModeRef.current === 'spotify-sdk') {
        void spotifyPlayerRef.current.pause().catch(() => {});
      }

      if (!track.previewUrl) {
        setPlaybackMode('preview');
        setDurationSec(PREVIEW_MAX_SECONDS);
        setIsPlaying(false);
        showNotice('No 30s preview URL for this track — tap Open in Spotify or Boomplay.');
        setExpanded(true);
        return;
      }

      const audio = audioRef.current;
      if (!audio) return;

      try {
        setPlaybackMode('preview');
        setDurationSec(PREVIEW_MAX_SECONDS);
        if (audio.src !== track.previewUrl) {
          audio.src = track.previewUrl;
        }
        audio.currentTime = 0;
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
        showNotice('Tap Play to start the 30-second audio preview.');
      }
    },
    [spotifyStatus.connected, spotifyStatus.isPremium, spotifyDeviceId, fetchFreshToken, showNotice]
  );

  const togglePlayPause = useCallback(async () => {
    const active = currentTrackRef.current || tracksRef.current[0];
    if (!active) return;

    if (!currentTrackRef.current) {
      await playTrack(active);
      return;
    }

    if (playbackModeRef.current === 'spotify-sdk' && spotifyPlayerRef.current) {
      if (isPlayingRef.current) {
        await spotifyPlayerRef.current.pause().catch(() => {});
        setIsPlaying(false);
      } else {
        await spotifyPlayerRef.current.resume().catch(() => {});
        setIsPlaying(true);
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (isPlayingRef.current) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (!active.previewUrl) {
        showNotice('30s preview unavailable — use Open in Spotify or Boomplay.');
        setExpanded(true);
        return;
      }
      if (audio.src !== active.previewUrl) {
        audio.src = active.previewUrl;
      }
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  }, [playTrack, showNotice]);

  const nextTrack = useCallback(async () => {
    const list = tracksRef.current;
    if (list.length === 0) return;
    const currIdx = currentTrackRef.current
      ? list.findIndex((t) => t.id === currentTrackRef.current?.id)
      : -1;
    const nextIdx = currIdx >= 0 ? (currIdx + 1) % list.length : 0;
    await playTrack(list[nextIdx]);
  }, [playTrack]);

  const prevTrack = useCallback(async () => {
    const list = tracksRef.current;
    if (list.length === 0) return;
    const currIdx = currentTrackRef.current
      ? list.findIndex((t) => t.id === currentTrackRef.current?.id)
      : 0;
    const prevIdx = (currIdx - 1 + list.length) % list.length;
    await playTrack(list[prevIdx]);
  }, [playTrack]);

  const seekTo = useCallback(async (seconds: number) => {
    const clamped = Math.max(0, Math.min(seconds, durationSec));
    setCurrentTimeSec(clamped);
    if (playbackModeRef.current === 'spotify-sdk' && spotifyPlayerRef.current) {
      await spotifyPlayerRef.current.seek(Math.round(clamped * 1000)).catch(() => {});
      return;
    }
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(PREVIEW_MAX_SECONDS, clamped);
    }
  }, [durationSec]);

  const connectSpotify = useCallback(async () => {
    try {
      const resp = await fetch('/api/spotify/auth-url', { credentials: 'include' });
      const data = (await resp.json()) as {
        configured?: boolean;
        url?: string | null;
        message?: string;
      };
      if (!data.configured || !data.url) {
        showNotice(
          data.message ||
            'Configure SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to enable Spotify login.'
        );
        return;
      }
      const popup = window.open(
        data.url,
        'spotify_oauth_popup',
        'width=540,height=720,menubar=no,toolbar=no'
      );
      if (!popup) {
        showNotice('Allow popups in your browser to log in with Spotify.');
      }
    } catch {
      showNotice('Could not start Spotify login.');
    }
  }, [showNotice]);

  const disconnectSpotify = useCallback(async () => {
    pauseMusic();
    try {
      await fetch('/api/spotify/logout', {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
      });
    } catch {
      // Ignore network errors
    }
    storeSpotifySid('');
    setSpotifySid('');
    setSpotifyDeviceId(null);
    setSdkReady(false);
    setPlaybackMode('preview');
    await fetchSpotifyStatus();
    await searchTracks(searchQuery || 'Afrobeats');
    showNotice('Disconnected Spotify account.');
  }, [pauseMusic, authHeaders, fetchSpotifyStatus, searchTracks, searchQuery, showNotice]);

  const dismissMiniPlayer = useCallback(() => {
    pauseMusic();
    setExpanded(false);
    setIsMiniDismissed(true);
  }, [pauseMusic]);

  const value = useMemo<MusicPlayerContextValue>(
    () => ({
      tracks,
      currentTrack,
      isPlaying,
      isLoadingTracks,
      trackError,
      noticeMessage,
      searchQuery,
      selectedGenre,
      playbackMode,
      isExpanded,
      isMiniDismissed,
      spotifyStatus,
      sdkReady,
      searchTracks,
      selectGenre,
      playTrack,
      togglePlayPause,
      pauseMusic,
      nextTrack,
      prevTrack,
      seekTo,
      setExpanded,
      dismissMiniPlayer,
      connectSpotify,
      disconnectSpotify,
    }),
    [
      tracks,
      currentTrack,
      isPlaying,
      isLoadingTracks,
      trackError,
      noticeMessage,
      searchQuery,
      selectedGenre,
      playbackMode,
      isExpanded,
      isMiniDismissed,
      spotifyStatus,
      sdkReady,
      searchTracks,
      selectGenre,
      playTrack,
      togglePlayPause,
      pauseMusic,
      nextTrack,
      prevTrack,
      seekTo,
      dismissMiniPlayer,
      connectSpotify,
      disconnectSpotify,
    ]
  );

  const progressValue = useMemo<MusicProgressContextValue>(
    () => ({ currentTimeSec, durationSec }),
    [currentTimeSec, durationSec]
  );

  return (
    <MusicPlayerContext.Provider value={value}>
      <MusicProgressContext.Provider value={progressValue}>
        {children}
      </MusicProgressContext.Provider>
    </MusicPlayerContext.Provider>
  );
}

export function useMusicPlayer(): MusicPlayerContextValue {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) {
    throw new Error('useMusicPlayer must be used inside MusicPlayerProvider');
  }
  return ctx;
}

export function useMusicProgress(): MusicProgressContextValue {
  return useContext(MusicProgressContext);
}
