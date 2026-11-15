import { BarChart3, Clock, Film, Sparkles, X } from 'lucide-react';
import { useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

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
  stats: UserWatchStats;
  onClose: () => void;
}

export function MyStatsModal({
  isOpen,
  displayName,
  stats,
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="my-stats-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-2xl border border-[#27272A] bg-[#111114] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#27272A] pb-4 mb-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#E5A93B] mb-1">
              <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{displayName}</span>
            </div>
            <h2
              id="my-stats-title"
              className="font-display text-xl font-bold text-[#FAFAFA]"
            >
              {t('myStatsTitle')}
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-0.5">{t('myStatsSubtitle')}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('cancelAction')}
            className="rounded-lg p-1.5 text-[#71717A] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="rounded-xl border border-[#27272A] bg-[#09090B] p-4">
            <div className="flex items-center gap-2 text-xs text-[#A1A1AA] mb-2">
              <Film className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
              <span>{t('moviesWatchedLabel')}</span>
            </div>
            <p className="font-mono text-2xl font-bold tabular-nums text-[#FAFAFA]">
              {stats.moviesWatched}
            </p>
            <p className="text-[11px] font-mono tabular-nums text-[#71717A] mt-1">
              {stats.watchlistCount} {t('navSaved').toLowerCase()}
            </p>
          </div>

          <div className="rounded-xl border border-[#27272A] bg-[#09090B] p-4">
            <div className="flex items-center gap-2 text-xs text-[#A1A1AA] mb-2">
              <Clock className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
              <span>{t('hoursEntertainmentLabel')}</span>
            </div>
            <p className="font-mono text-2xl font-bold tabular-nums text-[#FAFAFA]">
              {formattedHours}h
            </p>
            <p className="text-[11px] font-mono tabular-nums text-[#71717A] mt-1">
              {stats.totalMinutes.toLocaleString()} min
            </p>
          </div>
        </div>

        {/* Preferred Genres Breakdown */}
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#FAFAFA] mb-3">
            <Sparkles className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
            <span>{t('preferredGenresLabel')}</span>
          </div>

          {stats.preferredGenres.length === 0 ? (
            <div className="rounded-xl border border-[#27272A] bg-[#09090B] p-5 text-center text-xs text-[#A1A1AA]">
              {t('statsEmptyNotice')}
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-[#27272A] bg-[#09090B] p-4">
              {stats.preferredGenres.map((entry) => (
                <div key={entry.genre} className="space-y-1.5">
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
        </div>
      </div>
    </div>
  );
}
