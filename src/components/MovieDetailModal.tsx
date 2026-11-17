import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Captions,
  Check,
  Download,
  Edit3,
  Film,
  ListVideo,
  Maximize2,
  MessageSquare,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Share2,
  Smartphone,
  Star,
  Trash2,
  Tv,
  Volume2,
  X,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { MovieRatingSummary } from '../hooks/useMovieRatings';
import type { SubmitReviewInput } from '../hooks/useMovieReviews';
import type {
  DownloadQualitySetting,
  Movie,
  MovieGenre,
  MovieQuality,
  MovieReview,
  SeriesEpisode,
  VideoQualitySetting,
  WatchProgressEntry,
} from '../types/cinema';
import { formatFileSize, formatPlaybackTime } from '../utils/format';
import { generateSubtitleVttUrl } from '../utils/movieMetadata';
import { getYouTubeEmbedUrl } from '../utils/youtube';
import { BecauseYouWatchedRow } from './BecauseYouWatchedRow';
import { MovieReviewsSection } from './MovieReviewsSection';

interface MovieDetailModalProps {
  movie: Movie | null;
  allMovies?: Movie[];
  initialTrailerMode?: boolean;
  isSaved: boolean;
  canManage: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  currentUserId?: string;
  currentAuthorName: string;
  ratingSummary?: MovieRatingSummary;
  reviews: MovieReview[];
  isLoadingReviews: boolean;
  savedProgress?: WatchProgressEntry;
  isLowNetwork?: boolean;
  videoQuality?: VideoQualitySetting;
  downloadQuality?: DownloadQualitySetting;
  onSaveProgress?: (movieId: string, progressSeconds: number, durationSeconds: number) => void;
  onClearProgress?: (movieId: string) => void;
  onClose: () => void;
  onSelectMovie?: (movie: Movie) => void;
  onDownload: (movie: Movie) => void;
  onShareToChat: (movie: Movie) => void;
  onStartWatchParty?: (movie: Movie) => void;
  onToggleSave: (movie: Movie) => void;
  onRateMovie: (movieId: string, stars: number) => Promise<void>;
  onSubmitReview: (input: SubmitReviewInput) => Promise<void>;
  onDeleteReview: (movieId: string, targetUserId?: string) => Promise<void>;
  onRequireAuthForReview: () => void;
  onMoviePlayed?: (movieId: string) => void;
  onShareSuccess?: (message: string) => void;
  onUpdate: (
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
  ) => Promise<void>;
  onDelete: (movieId: string) => Promise<void>;
}

const GENRES: MovieGenre[] = [
  'Action',
  'Nollywood',
  'Sci-Fi',
  'Music',
  'Drama',
  'Thriller',
  'Comedy',
  'Mystery',
  'Documentary',
  'Animation',
  'Horror',
];

const QUALITIES: MovieQuality[] = ['4K UHD', '1080p HD', '720p HD'];

const REPORT_REASONS = [
  'Stream won’t play or buffers endlessly',
  'Download fails or file is corrupted',
  'Audio or subtitle language mismatch',
  'Wrong movie or broken episode link',
];

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: 'landscape' | 'landscape-primary' | 'portrait' | 'any') => Promise<void>;
  unlock?: () => void;
};

type WebKitVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: string) => void;
};

function isPortraitViewport(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(orientation: portrait)').matches || window.innerHeight > window.innerWidth;
  }
  return window.innerHeight > window.innerWidth;
}

function isMobileOrTabletViewport(): boolean {
  if (typeof window === 'undefined') return false;
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return window.innerWidth < 1024 || coarsePointer;
}

export function MovieDetailModal({
  movie,
  allMovies = [],
  initialTrailerMode = false,
  isSaved,
  canManage,
  isAuthenticated,
  isAdmin,
  currentUserId,
  currentAuthorName,
  ratingSummary,
  reviews,
  isLoadingReviews,
  savedProgress,
  isLowNetwork = false,
  videoQuality = 'auto',
  downloadQuality = '480p',
  onSaveProgress,
  onClearProgress,
  onClose,
  onSelectMovie,
  onDownload,
  onShareToChat,
  onStartWatchParty,
  onToggleSave,
  onRateMovie,
  onSubmitReview,
  onDeleteReview,
  onRequireAuthForReview,
  onMoviePlayed,
  onShareSuccess,
  onUpdate,
  onDelete,
}: MovieDetailModalProps) {
  const { t } = useLanguage();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [hoveredStar, setHoveredStar] = useState<number>(0);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const [editTitle, setEditTitle] = useState('');
  const [editGenre, setEditGenre] = useState<MovieGenre>('Drama');
  const [editQuality, setEditQuality] = useState<MovieQuality>('1080p HD');
  const [editDirector, setEditDirector] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editImdbRating, setEditImdbRating] = useState('7.8');
  const [editTrailerUrl, setEditTrailerUrl] = useState('');
  const [editSynopsis, setEditSynopsis] = useState('');
  const [resumedFromSeconds, setResumedFromSeconds] = useState(0);

  // Stage 3 states: Series episodes, Subtitle/Audio, Trailer mode, PiP, Broken link report
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  const [autoPlayNext, setAutoPlayNext] = useState<boolean>(true);
  const [nextEpisodeCountdown, setNextEpisodeCountdown] = useState<number | null>(null);

  const [isTrailerMode, setIsTrailerMode] = useState<boolean>(initialTrailerMode);
  const [audioLang, setAudioLang] = useState<string>('English');
  const [subtitleLang, setSubtitleLang] = useState<string>('Off');
  const [subtitleVttUrl, setSubtitleVttUrl] = useState<string>('');
  const [isPipActive, setIsPipActive] = useState<boolean>(false);

  const [reportOpen, setReportOpen] = useState<boolean>(false);
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState<string>('');
  const [reportSubmitting, setReportSubmitting] = useState<boolean>(false);
  const [reportSent, setReportSent] = useState<boolean>(false);

  // Landscape orientation lock & suggestion state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [hasStartedPlaying, setHasStartedPlaying] = useState<boolean>(false);
  const [isPortrait, setIsPortrait] = useState<boolean>(() => isPortraitViewport());
  const [isFullscreenActive, setIsFullscreenActive] = useState<boolean>(false);
  const [showLandscapeSuggestion, setShowLandscapeSuggestion] = useState<boolean>(false);
  const [landscapeNoticeDismissed, setLandscapeNoticeDismissed] = useState<boolean>(false);

  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const orientationLockedRef = useRef<boolean>(false);
  const hasRestoredInitialSeekRef = useRef(false);
  const lastSavedWallMsRef = useRef(0);
  const latestPlaybackRef = useRef<{ movieId: string; time: number; duration: number } | null>(null);

  const episodes = movie?.episodes ?? [];
  const seasons = useMemo(
    () => Array.from(new Set(episodes.map((ep) => ep.season))).sort((a, b) => a - b),
    [episodes]
  );

  const activeEpisode: SeriesEpisode | undefined = useMemo(() => {
    if (episodes.length === 0) return undefined;
    return episodes.find((ep) => ep.id === activeEpisodeId) || episodes[0];
  }, [episodes, activeEpisodeId]);

  const nextEpisode: SeriesEpisode | undefined = useMemo(() => {
    if (!activeEpisode || episodes.length <= 1) return undefined;
    const idx = episodes.findIndex((ep) => ep.id === activeEpisode.id);
    return idx >= 0 && idx + 1 < episodes.length ? episodes[idx + 1] : undefined;
  }, [activeEpisode, episodes]);

  const flushPlaybackProgress = useCallback(() => {
    const video = videoRef.current;
    if (isTrailerMode) return;
    if (video && movie && Number.isFinite(video.duration) && video.duration > 0) {
      if (!hasRestoredInitialSeekRef.current && savedProgress && savedProgress.progressSeconds > 0) {
        return;
      }
      onSaveProgress?.(movie.id, video.currentTime, video.duration);
      return;
    }
    const latest = latestPlaybackRef.current;
    if (latest && latest.duration > 0) {
      onSaveProgress?.(latest.movieId, latest.time, latest.duration);
    }
  }, [isTrailerMode, movie, onSaveProgress, savedProgress]);

  const unlockLandscapeOrientation = useCallback(() => {
    if (!orientationLockedRef.current) return;
    try {
      const orientation = window.screen?.orientation as ScreenOrientationWithLock | undefined;
      orientation?.unlock?.();
    } catch {
      // Ignore unlock failures on unsupported browsers
    } finally {
      orientationLockedRef.current = false;
    }
  }, []);

  const attemptLandscapePlayback = useCallback(async (forceFullscreen = true) => {
    const video = videoRef.current as WebKitVideoElement | null;
    const container = playerContainerRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void })
      | null;

    let enteredFullscreen = Boolean(document.fullscreenElement);
    let lockedLandscape = false;

    if (forceFullscreen && !enteredFullscreen) {
      try {
        if (video && typeof video.requestFullscreen === 'function') {
          await video.requestFullscreen();
          enteredFullscreen = true;
        } else if (container && typeof container.requestFullscreen === 'function') {
          await container.requestFullscreen();
          enteredFullscreen = true;
        } else if (video && typeof video.webkitRequestFullscreen === 'function') {
          await video.webkitRequestFullscreen();
          enteredFullscreen = true;
        } else if (video && typeof video.webkitEnterFullscreen === 'function') {
          video.webkitEnterFullscreen();
          enteredFullscreen = true;
        }
      } catch {
        // Fullscreen may be blocked outside certain gestures or in strict sandboxes
      }
    }

    try {
      const orientation = window.screen?.orientation as ScreenOrientationWithLock | undefined;
      if (orientation && typeof orientation.lock === 'function') {
        await orientation.lock('landscape');
        orientationLockedRef.current = true;
        lockedLandscape = true;
        setShowLandscapeSuggestion(false);
      }
    } catch {
      lockedLandscape = false;
    }

    if (!lockedLandscape && isPortraitViewport() && isMobileOrTabletViewport()) {
      setShowLandscapeSuggestion(true);
    }

    return { enteredFullscreen, lockedLandscape };
  }, []);

  const handlePrimaryPlayClick = useCallback(
    async (fromTrailerSwitch = false) => {
      setHasStartedPlaying(true);
      setLandscapeNoticeDismissed(false);

      if (isMobileOrTabletViewport() && isPortraitViewport()) {
        void attemptLandscapePlayback(true);
      }

      if (fromTrailerSwitch) {
        window.setTimeout(() => {
          void videoRef.current?.play().catch(() => {});
        }, 80);
      } else {
        void videoRef.current?.play().catch(() => {});
      }
    },
    [attemptLandscapePlayback]
  );

  const handleRequestClose = useCallback(() => {
    flushPlaybackProgress();
    unlockLandscapeOrientation();
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    onClose();
  }, [flushPlaybackProgress, unlockLandscapeOrientation, onClose]);

  useEffect(() => {
    setConfirmDelete(false);
    setIsDeleting(false);
    setIsEditing(false);
    setHoveredStar(0);
    setIsSubmittingRating(false);
    setLinkCopied(false);
    setIsTrailerMode(initialTrailerMode);
    setNextEpisodeCountdown(null);
    setReportOpen(false);
    setReportDetails('');
    setReportSent(false);
    setIsPlaying(false);
    setHasStartedPlaying(initialTrailerMode);
    setShowLandscapeSuggestion(false);
    setLandscapeNoticeDismissed(false);
    hasRestoredInitialSeekRef.current = false;
    lastSavedWallMsRef.current = 0;
    latestPlaybackRef.current = null;
    setResumedFromSeconds(savedProgress?.progressSeconds ?? 0);

    if (movie) {
      setEditTitle(movie.title);
      setEditGenre(movie.genre);
      setEditQuality(movie.quality);
      setEditDirector(movie.director);
      setEditCountry(movie.country || '');
      setEditImdbRating((movie.imdbRating ?? 7.8).toFixed(1));
      setEditTrailerUrl(movie.trailerUrl || '');
      setEditSynopsis(movie.synopsis);
      setAudioLang(movie.audioLanguages?.[0] || 'English');
      setSubtitleLang('Off');
      if (movie.episodes && movie.episodes.length > 0) {
        setSelectedSeason(movie.episodes[0].season);
        setActiveEpisodeId(movie.episodes[0].id);
      } else {
        setSelectedSeason(1);
        setActiveEpisodeId(null);
      }
    }
  }, [movie?.id, initialTrailerMode]);

  // Track viewport orientation & fullscreen transitions; auto-unlock when leaving fullscreen
  useEffect(() => {
    if (!movie) return;

    const updateOrientation = () => {
      const portraitNow = isPortraitViewport();
      setIsPortrait(portraitNow);
      if (!portraitNow) {
        setShowLandscapeSuggestion(false);
      }
    };

    const handleFullscreenChange = () => {
      const active = Boolean(
        document.fullscreenElement ||
          (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
      );
      setIsFullscreenActive(active);
      if (!active) {
        unlockLandscapeOrientation();
      }
    };

    updateOrientation();
    window.addEventListener('resize', updateOrientation);
    window.addEventListener('orientationchange', updateOrientation);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', updateOrientation);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      unlockLandscapeOrientation();
    };
  }, [movie?.id, unlockLandscapeOrientation]);

  // Generate and clean up WebVTT subtitle track URL when subtitle language or active episode changes
  useEffect(() => {
    if (!movie || subtitleLang === 'Off') {
      setSubtitleVttUrl('');
      return;
    }
    const url = generateSubtitleVttUrl(movie, subtitleLang, activeEpisode);
    setSubtitleVttUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [movie, subtitleLang, activeEpisode]);

  // Keep native HTML5 TextTrack visibility synced
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks || video.textTracks.length === 0) return;
    for (let i = 0; i < video.textTracks.length; i += 1) {
      video.textTracks[i].mode = subtitleLang === 'Off' ? 'disabled' : 'showing';
    }
  }, [subtitleLang, subtitleVttUrl]);

  // Sync Picture-in-Picture active state with native video element events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnterPip = () => setIsPipActive(true);
    const onLeavePip = () => setIsPipActive(false);
    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
    };
  }, [movie?.id, isTrailerMode, activeEpisode?.id]);

  // Next Episode Auto-Play countdown ticker
  useEffect(() => {
    if (nextEpisodeCountdown === null || !nextEpisode) return;
    if (nextEpisodeCountdown <= 0) {
      setSelectedSeason(nextEpisode.season);
      setActiveEpisodeId(nextEpisode.id);
      setNextEpisodeCountdown(null);
      window.setTimeout(() => {
        void videoRef.current?.play().catch(() => {});
      }, 120);
      return;
    }
    const timer = window.setTimeout(() => {
      setNextEpisodeCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [nextEpisodeCountdown, nextEpisode]);

  useEffect(() => {
    if (!movie) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleRequestClose();
    };
    const handleBeforeUnload = () => {
      flushPlaybackProgress();
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      const latest = latestPlaybackRef.current;
      if (latest && latest.duration > 0) {
        onSaveProgress?.(latest.movieId, latest.time, latest.duration);
      }
    };
  }, [movie?.id, handleRequestClose, flushPlaybackProgress, onSaveProgress]);

  if (!movie) return null;

  const baseVideoUrl = activeEpisode?.videoUrl || movie.videoUrl;
  const youtubeEmbedUrl = getYouTubeEmbedUrl(movie.trailerUrl);
  const youtubeAutoplayEmbedUrl = getYouTubeEmbedUrl(movie.trailerUrl, { autoplay: true });
  const effectiveVideoUrl = isTrailerMode && !youtubeEmbedUrl ? movie.trailerUrl || baseVideoUrl : baseVideoUrl;
  const audioOptions = movie.audioLanguages?.length ? movie.audioLanguages : ['English', 'French', 'Spanish'];
  const subtitleOptions = movie.subtitleLanguages?.length
    ? movie.subtitleLanguages
    : ['English', 'French', 'Spanish', 'Pidgin'];

  const handleSelectEpisode = (ep: SeriesEpisode) => {
    setNextEpisodeCountdown(null);
    setIsTrailerMode(false);
    setHasStartedPlaying(true);
    setSelectedSeason(ep.season);
    setActiveEpisodeId(ep.id);
    window.setTimeout(() => {
      void videoRef.current?.play().catch(() => {});
      if (isMobileOrTabletViewport() && isPortraitViewport()) {
        void attemptLandscapePlayback(true);
      }
    }, 80);
  };

  const handleTogglePip = async () => {
    const video = videoRef.current as
      | (HTMLVideoElement & { webkitSetPresentationMode?: (mode: string) => void; webkitPresentationMode?: string })
      | null;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
        return;
      }
      if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture();
        setIsPipActive(true);
        return;
      }
      if (typeof video.webkitSetPresentationMode === 'function') {
        const nextMode =
          video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
        video.webkitSetPresentationMode(nextMode);
        setIsPipActive(nextMode === 'picture-in-picture');
        return;
      }
      onShareSuccess?.('Picture-in-Picture is not supported on this browser.');
    } catch {
      onShareSuccess?.('Start playing the video first to enter Picture-in-Picture mode.');
    }
  };

  const handleSubmitBrokenLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportSubmitting(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movieId: movie.id,
          movieTitle: movie.title,
          reason: reportReason,
          details: reportDetails.trim() || undefined,
          reportedBy: currentAuthorName,
        }),
      });
      if (res.ok) {
        setReportSent(true);
        setReportOpen(false);
        setReportDetails('');
        onShareSuccess?.(`Thanks — reported broken link for "${movie.title}".`);
      } else {
        onShareSuccess?.('Unable to send report right now.');
      }
    } catch {
      onShareSuccess?.('Network error while reporting broken link.');
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    await onDelete(movie.id);
    setIsDeleting(false);
    onClose();
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) return;
    setIsSavingEdit(true);
    const parsedImdb = Number(editImdbRating);
    await onUpdate(movie.id, {
      title: editTitle.trim(),
      genre: editGenre,
      quality: editQuality,
      director: editDirector.trim() || movie.director,
      country: editCountry.trim() || undefined,
      imdbRating: Number.isFinite(parsedImdb)
        ? Math.round(Math.min(10, Math.max(1, parsedImdb)) * 10) / 10
        : movie.imdbRating,
      trailerUrl: editTrailerUrl.trim() || undefined,
      synopsis: editSynopsis.trim() || movie.synopsis,
    });
    setIsSavingEdit(false);
    setIsEditing(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#09090B]/90 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-modal-title"
    >
      <div className="w-full max-w-4xl rounded-xl border border-[#27272A] bg-[#111114] shadow-2xl overflow-hidden my-auto max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#27272A] px-4 sm:px-6 py-3.5 sm:py-4 sticky top-0 z-20 bg-[#111114]/95 backdrop-blur-md">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2
                id="detail-modal-title"
                className="font-display text-lg sm:text-xl font-bold text-[#FAFAFA] truncate"
              >
                {movie.title}
              </h2>
              {isTrailerMode && (
                <span className="rounded bg-[#E6A93C] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-[#0A0A0C] shrink-0">
                  Trailer
                </span>
              )}
              {!isTrailerMode && activeEpisode && (
                <span className="rounded border border-[#E6A93C]/50 bg-[#E6A93C]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#E6A93C] shrink-0">
                  S{activeEpisode.season} E{activeEpisode.episode}
                </span>
              )}
            </div>
            <p className="text-xs text-[#A1A1AA] font-mono tabular-nums mt-0.5 truncate">
              {movie.genre}
              {movie.country ? ` · ${movie.country}` : ''} · {movie.year} ·{' '}
              {activeEpisode?.duration || movie.duration} · {movie.quality} · IMDb{' '}
              {(movie.imdbRating ?? 7.8).toFixed(1)} · Stream:{' '}
              {videoQuality === 'auto' ? t('settingsAutoOption') : videoQuality}
            </p>
          </div>

          <button
            type="button"
            onClick={handleRequestClose}
            aria-label="Close movie preview"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer shrink-0"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Video Stream Player (or YouTube Embed Player in Trailer Mode) */}
        <div ref={playerContainerRef} className="relative bg-[#09090B] border-b border-[#27272A]">
          <div className="relative">
            {isTrailerMode && youtubeEmbedUrl ? (
              <iframe
                key={`yt-top-${youtubeEmbedUrl}`}
                src={youtubeAutoplayEmbedUrl || youtubeEmbedUrl}
                title={`${movie.title} Official Trailer`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                className="w-full aspect-video max-h-[420px] border-0 bg-black"
              />
            ) : (
            <video
              ref={videoRef}
              key={`${effectiveVideoUrl}-${isTrailerMode ? 'trailer' : 'full'}`}
              src={effectiveVideoUrl}
              poster={movie.backdropUrl || movie.posterUrl}
              controls
              playsInline
              autoPlay={isTrailerMode}
              loop={isTrailerMode}
              preload={isLowNetwork || videoQuality === '360p' ? 'none' : 'metadata'}
              onLoadedMetadata={() => {
                const video = videoRef.current;
                if (!video) return;
                if (
                  !isTrailerMode &&
                  !activeEpisode &&
                  !hasRestoredInitialSeekRef.current &&
                  savedProgress &&
                  savedProgress.progressSeconds > 0
                ) {
                  const safeDuration =
                    Number.isFinite(video.duration) && video.duration > 0
                      ? video.duration
                      : savedProgress.durationSeconds;
                  const target = Math.min(savedProgress.progressSeconds, Math.max(0, safeDuration - 0.5));
                  if (target > 0) {
                    video.currentTime = target;
                    setResumedFromSeconds(target);
                  }
                }
                hasRestoredInitialSeekRef.current = true;
              }}
              onPlay={() => {
                setIsPlaying(true);
                setHasStartedPlaying(true);
                onMoviePlayed?.(movie.id);
                if (isMobileOrTabletViewport() && isPortraitViewport() && !orientationLockedRef.current) {
                  void attemptLandscapePlayback(false);
                }
              }}
              onTimeUpdate={() => {
                const video = videoRef.current;
                if (isTrailerMode || !video || !Number.isFinite(video.duration) || video.duration <= 0) {
                  return;
                }
                if (!hasRestoredInitialSeekRef.current && savedProgress && savedProgress.progressSeconds > 0) {
                  return;
                }
                latestPlaybackRef.current = {
                  movieId: movie.id,
                  time: video.currentTime,
                  duration: video.duration,
                };
                const now = Date.now();
                if (now - lastSavedWallMsRef.current >= 2000) {
                  lastSavedWallMsRef.current = now;
                  onSaveProgress?.(movie.id, video.currentTime, video.duration);
                }
              }}
              onPause={() => {
                setIsPlaying(false);
                const video = videoRef.current;
                if (isTrailerMode || !video || !Number.isFinite(video.duration) || video.duration <= 0) {
                  return;
                }
                if (!hasRestoredInitialSeekRef.current && savedProgress && savedProgress.progressSeconds > 0) {
                  return;
                }
                latestPlaybackRef.current = {
                  movieId: movie.id,
                  time: video.currentTime,
                  duration: video.duration,
                };
                lastSavedWallMsRef.current = Date.now();
                onSaveProgress?.(movie.id, video.currentTime, video.duration);
              }}
              onSeeked={() => {
                const video = videoRef.current;
                if (isTrailerMode || !video || !Number.isFinite(video.duration) || video.duration <= 0) {
                  return;
                }
                if (!hasRestoredInitialSeekRef.current && savedProgress && savedProgress.progressSeconds > 0) {
                  return;
                }
                latestPlaybackRef.current = {
                  movieId: movie.id,
                  time: video.currentTime,
                  duration: video.duration,
                };
                lastSavedWallMsRef.current = Date.now();
                onSaveProgress?.(movie.id, video.currentTime, video.duration);
              }}
              onEnded={() => {
                setIsPlaying(false);
                if (isTrailerMode) return;
                latestPlaybackRef.current = null;
                setResumedFromSeconds(0);
                onClearProgress?.(movie.id);
                if (autoPlayNext && nextEpisode) {
                  setNextEpisodeCountdown(5);
                }
              }}
              className="w-full aspect-video max-h-[420px] object-contain bg-black"
            >
              {subtitleLang !== 'Off' && subtitleVttUrl && (
                <track
                  kind="subtitles"
                  label={subtitleLang}
                  srcLang={subtitleLang.slice(0, 2).toLowerCase()}
                  src={subtitleVttUrl}
                  default
                />
              )}
            </video>
            )}

            {/* Primary Cinema Play Overlay (triggers playback + attempts landscape fullscreen on portrait mobile) */}
            {!hasStartedPlaying && !isPlaying && !isTrailerMode && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-t from-[#0A0A0C]/85 via-[#0A0A0C]/30 to-transparent px-4">
                <button
                  type="button"
                  onClick={() => void handlePrimaryPlayClick()}
                  aria-label={`Play ${movie.title} in cinema view`}
                  className="pointer-events-auto min-h-[48px] inline-flex items-center gap-2.5 rounded-xl bg-[#E6A93C] px-6 py-3 text-sm font-bold text-[#0A0A0C] shadow-lg shadow-black/60 hover:bg-[#F5C563] active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  <span>{activeEpisode ? `Play S${activeEpisode.season} E${activeEpisode.episode}` : 'Play'}</span>
                </button>
                {isPortrait && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[#0A0A0C]/80 border border-[#27272A] px-2.5 py-1 font-mono text-[10px] text-[#E6A93C]">
                    <RotateCw className="h-3 w-3" aria-hidden="true" />
                    <span>Best viewed in landscape</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Landscape Orientation Suggestion Banner (shown on portrait screens when browser blocks auto-rotation) */}
          {showLandscapeSuggestion && !landscapeNoticeDismissed && isPortrait && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[#E6A93C]/40 bg-[#E6A93C]/10 px-4 py-2.5 text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E6A93C]/40 bg-[#0A0A0C] text-[#E6A93C]">
                  <Smartphone className="h-4 w-4 rotate-90" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-[#FAFAFA]">Rotate device to landscape</p>
                  <p className="text-[11px] text-[#A1A1AA]">
                    Turn your phone sideways or tap Fullscreen for widescreen playback.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void attemptLandscapePlayback(true)}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg bg-[#E6A93C] px-3 py-2 text-xs font-bold text-[#0A0A0C] hover:bg-[#F5C563] cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Landscape</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLandscapeNoticeDismissed(true)}
                  aria-label="Dismiss landscape suggestion"
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[#27272A] bg-[#18181B] text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* Next Episode Auto-Play Overlay Bar */}
          {nextEpisodeCountdown !== null && nextEpisode && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E6A93C]/40 bg-[#E6A93C]/10 px-4 py-2.5 text-xs">
              <span className="font-medium text-[#FAFAFA]">
                Playing Next: <span className="text-[#E6A93C] font-semibold">S{nextEpisode.season} E{nextEpisode.episode} · {nextEpisode.title}</span> in {nextEpisodeCountdown}s
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectEpisode(nextEpisode)}
                  className="min-h-[36px] rounded-lg bg-[#E6A93C] px-3 py-1 text-xs font-bold text-[#0A0A0C] hover:bg-[#F5C563] cursor-pointer"
                >
                  Play Now
                </button>
                <button
                  type="button"
                  onClick={() => setNextEpisodeCountdown(null)}
                  className="min-h-[36px] rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-1 text-xs text-[#D4D4D8] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Player Stage 3 Toolbar: Full/Trailer switch, Subtitle, Audio, PiP */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[#27272A] bg-[#111114] px-4 py-2.5">
            <div className="flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#0A0A0C] p-1">
              <button
                type="button"
                onClick={() => {
                  const wasTrailer = isTrailerMode;
                  setIsTrailerMode(false);
                  void handlePrimaryPlayClick(wasTrailer);
                }}
                className={`min-h-[34px] inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer transition-colors ${
                  !isTrailerMode ? 'bg-[#E6A93C] text-[#0A0A0C]' : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
                }`}
              >
                <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                <span>Full Feature</span>
              </button>
              <button
                type="button"
                onClick={() => setIsTrailerMode(true)}
                className={`min-h-[34px] inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer transition-colors ${
                  isTrailerMode ? 'bg-[#E6A93C] text-[#0A0A0C]' : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
                }`}
              >
                <Film className="h-3 w-3" aria-hidden="true" />
                <span>Trailer Preview</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#0A0A0C] px-2.5 py-1.5 text-xs text-[#D4D4D8]">
                <Volume2 className="h-3.5 w-3.5 text-[#E6A93C] shrink-0" aria-hidden="true" />
                <span className="sr-only">Audio language</span>
                <select
                  aria-label="Audio language"
                  value={audioLang}
                  onChange={(e) => {
                    setAudioLang(e.target.value);
                    onShareSuccess?.(`Audio language set to ${e.target.value}.`);
                  }}
                  className="bg-transparent text-xs text-[#FAFAFA] focus:outline-none cursor-pointer"
                >
                  {audioOptions.map((lang) => (
                    <option key={lang} value={lang} className="bg-[#111114]">
                      Audio: {lang}
                    </option>
                  ))}
                </select>
              </label>

              <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#0A0A0C] px-2.5 py-1.5 text-xs text-[#D4D4D8]">
                <Captions className="h-3.5 w-3.5 text-[#E6A93C] shrink-0" aria-hidden="true" />
                <span className="sr-only">Subtitles language</span>
                <select
                  aria-label="Subtitles language"
                  value={subtitleLang}
                  onChange={(e) => setSubtitleLang(e.target.value)}
                  className="bg-transparent text-xs text-[#FAFAFA] focus:outline-none cursor-pointer"
                >
                  <option value="Off" className="bg-[#111114]">
                    Subtitles: Off
                  </option>
                  {subtitleOptions.map((lang) => (
                    <option key={lang} value={lang} className="bg-[#111114]">
                      Sub: {lang}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => {
                  if (isFullscreenActive && document.fullscreenElement) {
                    unlockLandscapeOrientation();
                    void document.exitFullscreen().catch(() => {});
                  } else {
                    void attemptLandscapePlayback(true);
                  }
                }}
                aria-pressed={isFullscreenActive}
                title="Landscape Fullscreen"
                className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  isFullscreenActive
                    ? 'border-[#E6A93C] bg-[#E6A93C]/15 text-[#E6A93C]'
                    : 'border-[#27272A] bg-[#0A0A0C] text-[#D4D4D8] hover:border-[#E6A93C]'
                }`}
              >
                <Maximize2 className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
                <span>{isFullscreenActive ? 'Exit Full' : 'Landscape'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleTogglePip()}
                aria-pressed={isPipActive}
                title="Picture-in-Picture"
                className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  isPipActive
                    ? 'border-[#E6A93C] bg-[#E6A93C]/15 text-[#E6A93C]'
                    : 'border-[#27272A] bg-[#0A0A0C] text-[#D4D4D8] hover:border-[#E6A93C]'
                }`}
              >
                <PictureInPicture2 className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
                <span>PiP</span>
              </button>
            </div>
          </div>

          {!isTrailerMode && resumedFromSeconds > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-[#27272A]/80 bg-[#111114] px-4 py-2 text-xs">
              <span className="font-mono tabular-nums text-[#E5A93B]">
                {t('resumedFrom')} {formatPlaybackTime(resumedFromSeconds)}
              </span>
              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current;
                  if (video) {
                    video.currentTime = 0;
                  }
                  latestPlaybackRef.current = null;
                  setResumedFromSeconds(0);
                  onClearProgress?.(movie.id);
                }}
                className="inline-flex items-center gap-1 text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>{t('startFromBeginning')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Series Seasons & Episodes Section */}
        {episodes.length > 0 && (
          <div className="border-b border-[#27272A] bg-[#0A0A0C] px-4 sm:px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <ListVideo className="h-4 w-4 text-[#E6A93C]" aria-hidden="true" />
                <h3 className="font-display text-sm font-bold text-[#FAFAFA]">
                  Seasons &amp; Episodes
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-lg border border-[#27272A] bg-[#111114] p-1">
                  {seasons.map((seasonNum) => (
                    <button
                      key={seasonNum}
                      type="button"
                      onClick={() => setSelectedSeason(seasonNum)}
                      className={`min-h-[34px] rounded-md px-2.5 py-1 text-xs font-mono font-semibold cursor-pointer ${
                        selectedSeason === seasonNum
                          ? 'bg-[#E6A93C] text-[#0A0A0C]'
                          : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
                      }`}
                    >
                      S{seasonNum}
                    </button>
                  ))}
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-[#D4D4D8] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoPlayNext}
                    onChange={(e) => setAutoPlayNext(e.target.checked)}
                    className="h-4 w-4 accent-[#E6A93C] cursor-pointer"
                  />
                  <span>Auto-play next</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {episodes
                .filter((ep) => ep.season === selectedSeason)
                .map((ep) => {
                  const isCurrent = activeEpisode?.id === ep.id;
                  return (
                    <button
                      key={ep.id}
                      type="button"
                      onClick={() => handleSelectEpisode(ep)}
                      className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                        isCurrent
                          ? 'border-[#E6A93C] bg-[#E6A93C]/10'
                          : 'border-[#27272A] bg-[#111114] hover:border-[#3F3F46]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg font-mono text-xs font-bold shrink-0 ${
                          isCurrent ? 'bg-[#E6A93C] text-[#0A0A0C]' : 'bg-[#18181B] text-[#E6A93C]'
                        }`}
                      >
                        E{ep.episode}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[#FAFAFA] truncate">{ep.title}</p>
                          <span className="font-mono text-[10px] text-[#71717A] shrink-0">
                            {ep.duration}
                          </span>
                        </div>
                        {ep.synopsis && (
                          <p className="mt-1 text-[11px] text-[#A1A1AA] line-clamp-2">
                            {ep.synopsis}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Movie Details / Inline Owner Edit Form */}
        <div className="p-4 sm:p-6 space-y-5">
          {isEditing ? (
            <form onSubmit={handleSaveEdit} className="space-y-4 rounded-lg border border-[#27272A] bg-[#09090B] p-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    Director
                  </label>
                  <input
                    type="text"
                    value={editDirector}
                    onChange={(e) => setEditDirector(e.target.value)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    Country
                  </label>
                  <input
                    type="text"
                    value={editCountry}
                    onChange={(e) => setEditCountry(e.target.value)}
                    placeholder="Nigeria, USA..."
                    className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    Genre
                  </label>
                  <select
                    value={editGenre}
                    onChange={(e) => setEditGenre(e.target.value as MovieGenre)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  >
                    {GENRES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    Quality
                  </label>
                  <select
                    value={editQuality}
                    onChange={(e) => setEditQuality(e.target.value as MovieQuality)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  >
                    {QUALITIES.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    IMDb Rating
                  </label>
                  <input
                    type="number"
                    min={1.0}
                    max={10.0}
                    step={0.1}
                    value={editImdbRating}
                    onChange={(e) => setEditImdbRating(e.target.value)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm font-mono tabular-nums text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                  Trailer URL (YouTube or Direct Video)
                </label>
                <input
                  type="url"
                  value={editTrailerUrl}
                  onChange={(e) => setEditTrailerUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                  Synopsis
                </label>
                <textarea
                  rows={3}
                  value={editSynopsis}
                  onChange={(e) => setEditSynopsis(e.target.value)}
                  className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="rounded-lg border border-[#27272A] px-3.5 py-1.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="rounded-lg bg-[#E5A93B] px-4 py-1.5 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-50 cursor-pointer"
                >
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-[#D4D4D8] leading-relaxed">
              {activeEpisode?.synopsis || movie.synopsis}
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 rounded-lg border border-[#27272A] bg-[#09090B] p-4 text-xs">
            <div>
              <p className="text-[#71717A] mb-1">Director</p>
              <p className="font-medium text-[#FAFAFA] truncate">{movie.director}</p>
            </div>
            <div>
              <p className="text-[#71717A] mb-1">Country</p>
              <p className="font-medium text-[#FAFAFA] truncate">{movie.country || 'International'}</p>
            </div>
            <div>
              <p className="text-[#71717A] mb-1">File Size</p>
              <p className="font-mono tabular-nums font-medium text-[#FAFAFA]">
                {formatFileSize(movie.fileSizeBytes)}
              </p>
            </div>
            <div>
              <p className="text-[#71717A] mb-1">Downloads</p>
              <p className="font-mono tabular-nums font-medium text-[#FAFAFA]">
                {movie.downloads.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[#71717A] mb-1">Average Rating</p>
              <p className="inline-flex items-center gap-1.5 font-mono tabular-nums font-medium text-[#FAFAFA]">
                <Star
                  className={`h-3.5 w-3.5 ${
                    ratingSummary?.count ? 'text-[#E5A93B] fill-[#E5A93B]' : 'text-[#52525B]'
                  }`}
                  aria-hidden="true"
                />
                {ratingSummary?.count ? (
                  <span>
                    {ratingSummary.average.toFixed(1)} / 5 ({ratingSummary.count})
                  </span>
                ) : (
                  <span className="text-[#71717A]">No ratings yet</span>
                )}
              </p>
            </div>
          </div>

          {/* Dedicated YouTube Embed Trailer Player when movie.trailerUrl is present */}
          {youtubeEmbedUrl && !isTrailerMode && (
            <section
              aria-label="Official Trailer"
              className="rounded-xl border border-[#27272A] bg-[#09090B] p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Film className="h-4 w-4 text-[#E6A93C]" aria-hidden="true" />
                  <h3 className="font-display text-sm font-bold text-[#FAFAFA]">
                    Official Trailer
                  </h3>
                  <span className="rounded bg-[#E6A93C]/15 border border-[#E6A93C]/30 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#E6A93C]">
                    YouTube
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsTrailerMode(true)}
                  className="text-xs font-medium text-[#E6A93C] hover:underline cursor-pointer"
                >
                  Open in Top Player
                </button>
              </div>
              <div className="aspect-video w-full overflow-hidden rounded-lg border border-[#27272A] bg-black">
                <iframe
                  key={`yt-section-${youtubeEmbedUrl}`}
                  src={youtubeEmbedUrl}
                  title={`${movie.title} Official Trailer`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  loading="lazy"
                  className="h-full w-full border-0"
                />
              </div>
            </section>
          )}

          {/* 5-Star Rating Control */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-[#27272A] bg-[#09090B] px-4 py-3">
            <div>
              <p className="text-xs font-medium text-[#FAFAFA]">
                {isAuthenticated
                  ? ratingSummary?.userRating
                    ? `Your Rating: ${ratingSummary.userRating} / 5`
                    : 'Rate this Movie'
                  : 'Community 5-Star Rating'}
              </p>
              <p className="text-[11px] text-[#71717A]">
                {isAuthenticated
                  ? 'Click a star to submit or update your rating.'
                  : 'Log in or sign up to leave a 5-star rating.'}
              </p>
            </div>

            <div
              className="flex items-center gap-1"
              onMouseLeave={() => setHoveredStar(0)}
              role="group"
              aria-label={`Rate ${movie.title} from 1 to 5 stars`}
            >
              {[1, 2, 3, 4, 5].map((star) => {
                const activeValue = hoveredStar || ratingSummary?.userRating || 0;
                const filled = star <= activeValue;
                return (
                  <button
                    key={star}
                    type="button"
                    disabled={isSubmittingRating}
                    onMouseEnter={() => setHoveredStar(star)}
                    onClick={async () => {
                      setIsSubmittingRating(true);
                      await onRateMovie(movie.id, star);
                      setIsSubmittingRating(false);
                    }}
                    aria-label={`Rate ${star} ${star === 1 ? 'star' : 'stars'}`}
                    className="rounded p-1.5 hover:bg-[#18181B] disabled:opacity-50 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5A93B]"
                  >
                    <Star
                      className={`h-5 w-5 transition-colors ${
                        filled
                          ? 'text-[#E5A93B] fill-[#E5A93B]'
                          : 'text-[#52525B] hover:text-[#A1A1AA]'
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Primary Actions + Report Broken Link */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => onDownload(movie)}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-5 py-2.5 text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>Download ({downloadQuality} default)</span>
              </button>

              <button
                type="button"
                onClick={() => onToggleSave(movie)}
                className={`min-h-[44px] inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  isSaved
                    ? 'border-[#E5A93B] bg-[#E5A93B]/15 text-[#E5A93B]'
                    : 'border-[#27272A] bg-[#18181B] text-[#FAFAFA] hover:bg-[#27272A]'
                }`}
              >
                <Bookmark
                  className={`h-4 w-4 ${isSaved ? 'fill-current' : ''}`}
                  aria-hidden="true"
                />
                <span>{isSaved ? 'Saved' : 'My List'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onShareToChat(movie);
                  onClose();
                }}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-lg border border-[#27272A] bg-[#18181B] px-4 py-2.5 text-sm font-medium text-[#FAFAFA] hover:bg-[#27272A] cursor-pointer"
              >
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                <span>Share</span>
              </button>

              {onStartWatchParty && (
                <button
                  type="button"
                  onClick={() => {
                    onStartWatchParty(movie);
                    onClose();
                  }}
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-lg border border-[#E5A93B]/50 bg-[#E5A93B]/10 px-4 py-2.5 text-sm font-medium text-[#E5A93B] hover:bg-[#E5A93B]/20 cursor-pointer"
                >
                  <Tv className="h-4 w-4" aria-hidden="true" />
                  <span>{t('navWatchParty')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={async () => {
                  const shareUrl = `${window.location.origin}/?movie=${encodeURIComponent(movie.id)}`;
                  const copyToClipboard = async () => {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(shareUrl);
                    } else {
                      const area = document.createElement('textarea');
                      area.value = shareUrl;
                      area.style.position = 'fixed';
                      area.style.opacity = '0';
                      document.body.appendChild(area);
                      area.select();
                      document.execCommand('copy');
                      area.remove();
                    }
                    setLinkCopied(true);
                    onShareSuccess?.(`Copied direct link for "${movie.title}" to clipboard.`);
                    window.setTimeout(() => setLinkCopied(false), 2500);
                  };

                  if (typeof navigator.share === 'function') {
                    try {
                      await navigator.share({
                        title: movie.title,
                        text: `Watch ${movie.title} (${movie.year}) on templesolosmovies.com`,
                        url: shareUrl,
                      });
                      await copyToClipboard().catch(() => {});
                      return;
                    } catch (err) {
                      if (err instanceof Error && err.name === 'AbortError') {
                        return;
                      }
                    }
                  }
                  await copyToClipboard();
                }}
                className={`min-h-[44px] inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  linkCopied
                    ? 'border-[#E5A93B] bg-[#E5A93B]/15 text-[#E5A93B]'
                    : 'border-[#27272A] bg-[#18181B] text-[#FAFAFA] hover:bg-[#27272A]'
                }`}
              >
                {linkCopied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{linkCopied ? t('linkCopied') : t('shareLink')}</span>
              </button>

              <button
                type="button"
                onClick={() => setReportOpen((prev) => !prev)}
                className={`min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                  reportSent
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-[#27272A] bg-[#18181B] text-[#A1A1AA] hover:border-amber-500/50 hover:text-amber-300'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{reportSent ? 'Link Reported' : 'Report broken link'}</span>
              </button>
            </div>

            {canManage && (
              <div className="flex items-center gap-2">
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:border-[#E5A93B] hover:text-[#FAFAFA] cursor-pointer"
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                )}

                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] px-3 py-2 text-xs font-medium text-[#A1A1AA] hover:border-red-500/40 hover:text-red-300 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-300">Remove from vault?</span>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={handleConfirmDelete}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50 cursor-pointer"
                    >
                      {isDeleting ? 'Removing...' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-md border border-[#27272A] px-2.5 py-1.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Inline Report Broken Link Drawer */}
          {reportOpen && (
            <form
              onSubmit={handleSubmitBrokenLink}
              className="rounded-xl border border-amber-500/40 bg-[#0A0A0C] p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#FAFAFA]">
                  Report broken stream or download link for &ldquo;{movie.title}&rdquo;
                </p>
                <button
                  type="button"
                  onClick={() => setReportOpen(false)}
                  className="text-xs text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  aria-label="Broken link reason"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-xs text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  maxLength={200}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Optional details (quality, episode, error)..."
                  className="rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-xs text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={reportSubmitting}
                  className="min-h-[40px] rounded-lg bg-[#E6A93C] px-4 py-2 text-xs font-bold text-[#0A0A0C] hover:bg-[#F5C563] disabled:opacity-50 cursor-pointer"
                >
                  {reportSubmitting ? 'Sending...' : 'Send Report'}
                </button>
              </div>
            </form>
          )}

          {/* More Like This / Recommendations */}
          {allMovies.length > 1 && onSelectMovie && (
            <BecauseYouWatchedRow
              seedMovie={movie}
              allMovies={allMovies}
              onSelectMovie={onSelectMovie}
              headingPrefix="More like"
            />
          )}

          <MovieReviewsSection
            movieId={movie.id}
            movieTitle={movie.title}
            reviews={reviews}
            ratingSummary={ratingSummary}
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            currentAuthorName={currentAuthorName}
            isLoadingReviews={isLoadingReviews}
            onRequireAuth={onRequireAuthForReview}
            onSubmitReview={onSubmitReview}
            onDeleteReview={onDeleteReview}
          />
        </div>
      </div>
    </div>
  );
}
