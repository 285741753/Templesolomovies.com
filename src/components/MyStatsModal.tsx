import { useEffect } from 'react';
import {
  BarChart3,
  Bookmark,
  Clock,
  Download,
  Film,
  History,
  LogIn,
  LogOut,
  Play,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { DownloadTask, Movie, WatchProgressEntry } from '../types/cinema';
import { formatFileSize, formatPlaybackTime } from '../utils/format';
import { BecauseYouWatchedRow } from './BecauseYouWatchedRow';

export interface GenreStat {
  genre: string;
  count: number;
  percentage: number;
}

export interface UserWatchStats {
  moviesWatched: number;
  watchlistCount: number;
  totalHours: number;
  totalMinutes: number;
  preferredGenres: GenreStat[];
}

interface MyStatsModalProps {
  isOpen: boolean;
  displayName: string;
  email?: string | null;
  isAuthenticated?: boolean;
  isAdmin?: boolean;
  stats: UserWatchStats;
  allMovies?: Movie[];
  savedMoviesList?: Movie[];
  watchHistoryList?: Array<{ movie: Movie; progress?: WatchProgressEntry }>;
  downloadTasks?: DownloadTask[];
  storageUsedBytes?: number;
  onSelectMovie?: (movie: Movie) => void;
  onToggleSave?: (movie: Movie) => void;
  onRemoveHistory?: (movieId: string) => void;
  onOpenDownloads?: () => void;
  onOpenSettings?: () => void;
  onOpenRequestMovie?: () => void;
  onOpenAuth?: () => void;
  onLogOut?: () => void;
  onClose: () => void;
}

export function MyStatsModal({
  isOpen,
  displayName,
  email,
  isAuthenticated = false,
  isAdmin = false,
  stats,
  allMovies = [],
  savedMoviesList = [],
  watchHistoryList = [],
  downloadTasks = [],
  storageUsedBytes = 0,
  onSelectMovie,
  onToggleSave,
  onRemoveHistory,
  onOpenDownloads,
  onOpenSettings,
  onOpenRequestMovie,
  onOpenAuth,
  onLogOut,
  onClose,
}: MyStatsModalProps) {
  const { t } = useLanguage();

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const formattedHours =
    stats.totalHours >= 10
      ? stats.totalHours.toFixed(0)
      : stats.totalHours.toFixed(1);

  const initials = (displayName || 'TC')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const recommendationSeed =
    watchHistoryList[0]?.movie || savedMoviesList[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="my-stats-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-[#27272A] bg-[#111114] p-5 sm:p-6 shadow-2xl my-auto max-h-[92vh] overflow-y-auto space-y-5">
        {/* 1. Profile Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#27272A] pb-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#E6A93C]/60 bg-[#E6A93C]/15 font-display text-base font-bold text-[#E6A93C] shrink-0">
              {initials || 'TC'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2
                  id="my-stats-title"
                  className="font-display text-lg sm:text-xl font-bold text-[#FAFAFA] truncate"
                >
                  {displayName}
                </h2>
                <span className="rounded border border-[#27272A] bg-[#0A0A0C] px-2 py-0.5 font-mono text-[10px] text-[#E6A93C]">
                  {isAdmin ? t('roleAdmin') : isAuthenticated ? t('roleViewer') : 'Guest'}
                </span>
              </div>
              <p className="text-xs text-[#A1A1AA] truncate mt-0.5">
                {email || t('myStatsSubtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('cancelAction')}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[#71717A] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* 2. My List (Watchlist) */}
        <section aria-label="My List Watchlist">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#FAFAFA]">
              <Bookmark className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
              <span>My List ({savedMoviesList.length})</span>
            </div>
          </div>

          {savedMoviesList.length === 0 ? (
            <div className="rounded-xl border border-[#27272A] bg-[#0A0A0C] p-4 text-xs text-[#A1A1AA]">
              {isAuthenticated
                ? 'Tap "+ My List" or the bookmark icon on any title to save it here.'
                : 'Log in to sync your personal watchlist across sessions.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-48 overflow-y-auto pr-1">
              {savedMoviesList.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2.5 rounded-xl border border-[#27272A] bg-[#0A0A0C] p-2.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectMovie?.(m);
                      onClose();
                    }}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <img
                      src={m.posterUrl}
                      alt={`${m.title} poster`}
                      className="h-12 w-9 rounded object-cover border border-[#27272A] shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#FAFAFA] truncate hover:text-[#E6A93C]">
                        {m.title}
                      </p>
                      <p className="text-[11px] font-mono text-[#71717A]">
                        {m.genre} · {m.year}
                      </p>
                    </div>
                  </button>

                  {onToggleSave && (
                    <button
                      type="button"
                      onClick={() => onToggleSave(m)}
                      aria-label={`Remove ${m.title} from My List`}
                      className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-[#71717A] hover:bg-[#18181B] hover:text-red-300 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. Downloads Summary */}
        <section className="rounded-xl border border-[#27272A] bg-[#0A0A0C] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E6A93C]/12 border border-[#E6A93C]/30">
              <Download className="h-4 w-4 text-[#E6A93C]" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[#FAFAFA]">
                Downloads ({downloadTasks.length} files)
              </p>
              <p className="text-[11px] font-mono text-[#A1A1AA]">
                Storage used: {formatFileSize(storageUsedBytes)}
              </p>
            </div>
          </div>

          {onOpenDownloads && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenDownloads();
              }}
              className="min-h-[40px] rounded-xl border border-[#E6A93C]/50 bg-[#E6A93C]/10 px-3.5 py-2 text-xs font-semibold text-[#E6A93C] hover:bg-[#E6A93C]/20 cursor-pointer"
            >
              Open Downloads Manager
            </button>
          )}
        </section>

        {/* 4. Watch History */}
        <section aria-label="Watch History">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#FAFAFA] mb-2.5">
            <History className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
            <span>Watch History ({watchHistoryList.length})</span>
          </div>

          {watchHistoryList.length === 0 ? (
            <div className="rounded-xl border border-[#27272A] bg-[#0A0A0C] p-4 text-xs text-[#A1A1AA]">
              Start watching any movie to see your playback history and resume timestamps here.
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {watchHistoryList.map(({ movie, progress }) => (
                <div
                  key={movie.id}
                  className="flex items-center justify-between gap-2.5 rounded-xl border border-[#27272A] bg-[#0A0A0C] p-2.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectMovie?.(movie);
                      onClose();
                    }}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <img
                      src={movie.posterUrl}
                      alt={`${movie.title} poster`}
                      className="h-12 w-9 rounded object-cover border border-[#27272A] shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#FAFAFA] truncate hover:text-[#E6A93C]">
                        {movie.title}
                      </p>
                      <p className="text-[11px] font-mono text-[#A1A1AA]">
                        {progress
                          ? `Paused at ${formatPlaybackTime(progress.progressSeconds)}`
                          : `${movie.genre} · ${movie.year}`}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectMovie?.(movie);
                        onClose();
                      }}
                      aria-label={`Resume ${movie.title}`}
                      className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg bg-[#E6A93C]/15 text-[#E6A93C] hover:bg-[#E6A93C] hover:text-[#0A0A0C] cursor-pointer"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    </button>
                    {onRemoveHistory && (
                      <button
                        type="button"
                        onClick={() => onRemoveHistory(movie.id)}
                        aria-label={`Clear ${movie.title} from history`}
                        className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-[#71717A] hover:bg-[#18181B] hover:text-red-300 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Because You Watched inside Profile */}
        {recommendationSeed && allMovies.length > 1 && onSelectMovie && (
          <BecauseYouWatchedRow
            seedMovie={recommendationSeed}
            allMovies={allMovies}
            onSelectMovie={(m) => {
              onSelectMovie(m);
              onClose();
            }}
          />
        )}

        {/* 5. Watch Stats Summary */}
        <section>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#FAFAFA] mb-2.5">
            <BarChart3 className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
            <span>{t('myStatsTitle')}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="rounded-xl border border-[#27272A] bg-[#09090B] p-3.5">
              <div className="flex items-center gap-2 text-xs text-[#A1A1AA] mb-1">
                <Film className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                <span>{t('moviesWatchedLabel')}</span>
              </div>
              <p className="font-mono text-xl font-bold tabular-nums text-[#FAFAFA]">
                {stats.moviesWatched}
              </p>
            </div>

            <div className="rounded-xl border border-[#27272A] bg-[#09090B] p-3.5">
              <div className="flex items-center gap-2 text-xs text-[#A1A1AA] mb-1">
                <Clock className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                <span>{t('hoursEntertainmentLabel')}</span>
              </div>
              <p className="font-mono text-xl font-bold tabular-nums text-[#FAFAFA]">
                {formattedHours}h
              </p>
            </div>
          </div>

          {stats.preferredGenres.length > 0 && (
            <div className="space-y-2.5 rounded-xl border border-[#27272A] bg-[#09090B] p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#E6A93C]">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('preferredGenresLabel')}</span>
              </div>
              {stats.preferredGenres.slice(0, 4).map((entry) => (
                <div key={entry.genre} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#FAFAFA]">{entry.genre}</span>
                    <span className="font-mono tabular-nums text-[#A1A1AA]">
                      {entry.count} ({entry.percentage}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#18181B]">
                    <div
                      className="h-full rounded-full bg-[#E5A93B] transition-all duration-300"
                      style={{ width: `${Math.max(8, entry.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 6. Quick Actions Footer (Settings, Request Movie, Auth) */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[#27272A] pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#E6A93C] cursor-pointer"
              >
                <Settings className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
                <span>{t('settingsTitle')}</span>
              </button>
            )}

            {onOpenRequestMovie && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRequestMovie();
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#E6A93C] cursor-pointer"
              >
                <Film className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
                <span>Request a Movie</span>
              </button>
            )}
          </div>

          {isAuthenticated && onLogOut ? (
            <button
              type="button"
              onClick={() => {
                onLogOut();
                onClose();
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('logOut')}</span>
            </button>
          ) : onOpenAuth ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAuth();
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#E6A93C] px-4 py-2 text-xs font-bold text-[#0A0A0C] hover:bg-[#F5C563] cursor-pointer"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('logIn')}</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
