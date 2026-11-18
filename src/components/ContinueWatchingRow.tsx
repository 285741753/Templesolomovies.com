import { useState } from 'react';
import { Film, Play, X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { Movie, WatchProgressEntry } from '../types/cinema';
import { formatPlaybackTime } from '../utils/format';

interface ContinueWatchingRowProps {
  movies: Movie[];
  entries: WatchProgressEntry[];
  onResumeMovie: (movie: Movie) => void;
  onRemoveProgress: (movieId: string) => void;
}

function ContinueThumbnail({
  src,
  title,
}: {
  src: string;
  title: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#18181B] to-[#09090B]">
        <Film className="h-7 w-7 text-[#E5A93B]/60" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`${title} frame`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
}

export function ContinueWatchingRow({
  movies,
  entries,
  onResumeMovie,
  onRemoveProgress,
}: ContinueWatchingRowProps) {
  const { t } = useLanguage();

  const movieMap = new Map(movies.map((m) => [m.id, m]));
  const items = entries
    .map((entry) => {
      const movie = movieMap.get(entry.movieId);
      if (!movie) return null;
      const pct = Math.min(
        99,
        Math.max(2, Math.round((entry.progressSeconds / entry.durationSeconds) * 100))
      );
      return { movie, entry, pct };
    })
    .filter((item): item is { movie: Movie; entry: WatchProgressEntry; pct: number } => item !== null)
    .slice(0, 8);

  const starterPicks = items.length === 0 ? movies.slice(0, 4) : [];

  if (movies.length === 0) return null;

  return (
    <section
      id="continue-watching"
      aria-label={t('continueWatchingTitle')}
      className="border-b border-[#27272A]/80 bg-[#09090B]"
    >
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#FAFAFA]">
              {t('continueWatchingTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-[#A1A1AA] mt-0.5">
              {items.length > 0
                ? t('continueWatchingSubtitle')
                : 'Start watching any movie below to save your timestamp and resume right where you stopped.'}
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-[#71717A] shrink-0">
            {items.length > 0
              ? `${items.length} ${items.length === 1 ? t('movieSingular') : t('moviePlural')}`
              : `${starterPicks.length} ready`}
          </span>
        </div>

        {items.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {items.map(({ movie, entry, pct }) => {
              const remaining = Math.max(0, entry.durationSeconds - entry.progressSeconds);
              return (
                <article
                  key={movie.id}
                  onClick={() => onResumeMovie(movie)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onResumeMovie(movie);
                    }
                  }}
                  aria-label={`${t('resumePlayback')} ${movie.title} at ${formatPlaybackTime(entry.progressSeconds)}`}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-[#27272A] bg-[#111114] cursor-pointer transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#E5A93B]/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93B]"
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-[#18181B]">
                    <ContinueThumbnail
                      src={movie.backdropUrl || movie.posterUrl}
                      title={movie.title}
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-[#09090B]/90 via-black/20 to-transparent" />

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveProgress(movie.id);
                      }}
                      aria-label={`${t('removeContinueWatching')} ${movie.title}`}
                      title={t('removeContinueWatching')}
                      className="absolute top-2 right-2 rounded-lg border border-[#27272A] bg-[#09090B]/80 p-1.5 text-[#A1A1AA] hover:border-[#E5A93B] hover:text-[#FAFAFA] opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>

                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E5A93B]/95 text-[#09090B] shadow-lg transition-transform duration-200 group-hover:scale-105">
                        <Play className="h-4 w-4 fill-current ml-0.5" aria-hidden="true" />
                      </span>
                    </div>

                    <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-[#E4E4E7]">
                      <span className="text-[#E5A93B] font-semibold">
                        {t('resumePlayback')} · {formatPlaybackTime(entry.progressSeconds)}
                      </span>
                      <span className="text-[#A1A1AA]">
                        {formatPlaybackTime(remaining)} {t('timeLeftLabel')}
                      </span>
                    </div>

                    {/* Playback progress bar */}
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-[#27272A]">
                      <div
                        className="h-full bg-[#E5A93B] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-semibold text-[#FAFAFA] truncate group-hover:text-[#E5A93B] transition-colors">
                        {movie.title}
                      </h3>
                      <p className="text-[11px] text-[#71717A] font-mono tabular-nums truncate">
                        {movie.genre} · {formatPlaybackTime(entry.progressSeconds)} /{' '}
                        {formatPlaybackTime(entry.durationSeconds)}
                      </p>
                    </div>
                    <span className="font-mono text-xs tabular-nums font-medium text-[#E5A93B] shrink-0">
                      {pct}%
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {starterPicks.map((movie) => (
              <article
                key={movie.id}
                onClick={() => onResumeMovie(movie)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onResumeMovie(movie);
                  }
                }}
                aria-label={`Start watching ${movie.title}`}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-[#27272A] bg-[#111114] cursor-pointer transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#E5A93B]/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93B]"
              >
                <div className="relative aspect-video w-full overflow-hidden bg-[#18181B]">
                  <ContinueThumbnail
                    src={movie.backdropUrl || movie.posterUrl}
                    title={movie.title}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#09090B]/90 via-black/20 to-transparent" />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E5A93B]/95 text-[#09090B] shadow-lg transition-transform duration-200 group-hover:scale-105">
                      <Play className="h-4 w-4 fill-current ml-0.5" aria-hidden="true" />
                    </span>
                  </div>
                  <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-[#E4E4E7]">
                    <span className="text-[#E5A93B] font-semibold">Watch Now</span>
                    <span className="text-[#A1A1AA]">{movie.duration}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <h3 className="font-display text-sm font-semibold text-[#FAFAFA] truncate group-hover:text-[#E5A93B] transition-colors">
                      {movie.title}
                    </h3>
                    <p className="text-[11px] text-[#71717A] font-mono tabular-nums truncate">
                      {movie.genre} · {movie.quality}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-[#E5A93B] shrink-0">0%</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
