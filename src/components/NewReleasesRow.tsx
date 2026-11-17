import { useMemo, useState } from 'react';
import { ArrowRight, Bookmark, Download, Film, Play, Sparkles, Star } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { MovieRatingSummary } from '../hooks/useMovieRatings';
import type { Movie } from '../types/cinema';

interface NewReleasesRowProps {
  movies: Movie[];
  savedMovieIds: Set<string>;
  ratingsByMovie: Record<string, MovieRatingSummary>;
  onSelectMovie: (movie: Movie) => void;
  onDownload: (movie: Movie) => void;
  onToggleSave: (movie: Movie) => void;
  onSeeAll: () => void;
}

function NewReleasePoster({ posterUrl, title }: { posterUrl: string; title: string }) {
  const [failed, setFailed] = useState(false);

  if (!posterUrl || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-[#18181B] to-[#0A0A0C] p-4 text-center">
        <Film className="h-8 w-8 text-[#E6A93C]/60 mb-2" aria-hidden="true" />
        <span className="font-display text-xs font-medium text-[#D4D4D8] line-clamp-2">
          {title}
        </span>
      </div>
    );
  }

  return (
    <img
      src={posterUrl}
      alt={`${title} poster`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
    />
  );
}

export function NewReleasesRow({
  movies,
  savedMovieIds,
  ratingsByMovie,
  onSelectMovie,
  onDownload,
  onToggleSave,
  onSeeAll,
}: NewReleasesRowProps) {
  const { t } = useLanguage();

  const recentMovies = useMemo(() => {
    return [...movies]
      .sort((a, b) => {
        const aCustom = !a.isSeeded ? 1 : 0;
        const bCustom = !b.isSeeded ? 1 : 0;
        if (aCustom !== bCustom) return bCustom - aCustom;
        const timeA = new Date(a.createdAt).getTime() || 0;
        const timeB = new Date(b.createdAt).getTime() || 0;
        if (timeA !== timeB) return timeB - timeA;
        return b.year - a.year;
      })
      .slice(0, 6);
  }, [movies]);

  if (recentMovies.length === 0) return null;

  return (
    <section
      id="new-releases"
      aria-labelledby="new-releases-heading"
      className="border-b border-[#27272A]/80 bg-[#0A0A0C]"
    >
      <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#E6A93C] mb-1">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('newReleasesEyebrow')}</span>
            </div>
            <h2
              id="new-releases-heading"
              className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#FAFAFA]"
            >
              {t('newReleasesTitle')}
            </h2>
          </div>

          <button
            type="button"
            onClick={onSeeAll}
            className="min-h-[44px] inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#E6A93C] hover:text-[#F5C563] transition-colors whitespace-nowrap shrink-0 cursor-pointer px-1"
          >
            <span>{t('seeAll')}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 sm:gap-4">
          {recentMovies.map((movie) => {
            const isSaved = savedMovieIds.has(movie.id);
            const ratingSummary = ratingsByMovie[movie.id];
            const ratingLabel = ratingSummary?.count
              ? ratingSummary.average.toFixed(1)
              : (movie.imdbRating ?? 8.0).toFixed(1);

            return (
              <article
                key={movie.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-[#27272A] bg-[#111114] transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#E6A93C]/60"
              >
                <div
                  onClick={() => onSelectMovie(movie)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectMovie(movie);
                    }
                  }}
                  aria-label={`Play ${movie.title}`}
                  className="relative aspect-[3/4] w-full overflow-hidden bg-[#18181B] cursor-pointer"
                >
                  <NewReleasePoster posterUrl={movie.posterUrl} title={movie.title} />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0C] via-[#0A0A0C]/25 to-black/20" />

                  <span className="absolute top-2 left-2 rounded-md border border-[#E6A93C]/40 bg-[#0A0A0C]/85 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#E6A93C]">
                    {movie.year}
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSave(movie);
                    }}
                    aria-label={
                      isSaved
                        ? `Remove ${movie.title} from My List`
                        : `Add ${movie.title} to My List`
                    }
                    className={`absolute top-2 right-2 min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                      isSaved
                        ? 'bg-[#E6A93C] border-[#E6A93C] text-[#0A0A0C]'
                        : 'bg-[#0A0A0C]/80 border-[#27272A] text-[#FAFAFA] hover:border-[#E6A93C]'
                    }`}
                  >
                    <Bookmark
                      className={`h-3.5 w-3.5 ${isSaved ? 'fill-current' : ''}`}
                      aria-hidden="true"
                    />
                  </button>

                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E6A93C]/95 text-[#0A0A0C] shadow-lg">
                      <Play className="h-4 w-4 fill-current ml-0.5" aria-hidden="true" />
                    </span>
                  </div>
                </div>

                <div className="flex flex-1 flex-col justify-between p-2.5 sm:p-3">
                  <div>
                    <h3 className="font-display text-xs sm:text-sm font-semibold text-[#FAFAFA] line-clamp-1">
                      <button
                        type="button"
                        onClick={() => onSelectMovie(movie)}
                        className="text-left hover:text-[#E6A93C] transition-colors cursor-pointer"
                      >
                        {movie.title}
                      </button>
                    </h3>
                    <div className="mt-1 flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums text-[#A1A1AA]">
                      <span className="truncate">{movie.genre}</span>
                      <span className="inline-flex items-center gap-0.5 text-[#E6A93C] shrink-0">
                        <Star className="h-2.5 w-2.5 fill-[#E6A93C]" aria-hidden="true" />
                        <span>{ratingLabel}</span>
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDownload(movie)}
                    className="mt-2.5 min-h-[44px] w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-2.5 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#E6A93C] hover:text-[#E6A93C] transition-colors cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
                    <span>{t('download')}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
