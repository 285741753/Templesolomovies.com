import { useMemo, useState } from 'react';
import { Download, Film, Play, TrendingUp } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { Movie } from '../types/cinema';

interface TrendingNowProps {
  movies: Movie[];
  onDownload: (movie: Movie) => void;
  onSelectMovie: (movie: Movie) => void;
}

function TrendingPoster({ posterUrl, title }: { posterUrl: string; title: string }) {
  const [failed, setFailed] = useState(false);

  if (!posterUrl || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-[#18181B] to-[#09090B] p-4 text-center">
        <Film className="h-8 w-8 text-[#E5A93B]/60 mb-2" aria-hidden="true" />
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
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
}

export function TrendingNow({ movies, onDownload, onSelectMovie }: TrendingNowProps) {
  const { t } = useLanguage();
  const topFive = useMemo(() => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const thisWeek = movies
      .filter((m) => {
        const created = new Date(m.createdAt).getTime();
        return Number.isFinite(created) && now - created <= sevenDaysMs;
      })
      .sort((a, b) => b.downloads - a.downloads);

    if (thisWeek.length >= 5) {
      return thisWeek.slice(0, 5);
    }

    const thisWeekIds = new Set(thisWeek.map((m) => m.id));
    const remaining = movies
      .filter((m) => !thisWeekIds.has(m.id))
      .sort((a, b) => b.downloads - a.downloads);

    return [...thisWeek, ...remaining].slice(0, 5);
  }, [movies]);

  if (topFive.length === 0) return null;

  return (
    <section
      id="trending-now"
      aria-labelledby="trending-heading"
      className="border-b border-[#27272A] bg-[#09090B]"
    >
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#E5A93B] mb-1">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('trendingEyebrow')}</span>
            </div>
            <h2
              id="trending-heading"
              className="font-display text-2xl font-bold tracking-tight text-[#FAFAFA]"
            >
              {t('trendingHeading')}
            </h2>
          </div>

          <p className="text-xs text-[#71717A] font-mono tabular-nums">
            {t('trendingSubtitle', { count: topFive.length })}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {topFive.map((movie, index) => {
            const rank = String(index + 1).padStart(2, '0');
            return (
              <article
                key={movie.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-[#27272A] bg-[#111114] transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#3F3F46]"
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
                  aria-label={`Preview ${movie.title}`}
                  className="relative aspect-[4/3] w-full overflow-hidden bg-[#18181B] cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#E5A93B]"
                >
                  <TrendingPoster posterUrl={movie.posterUrl} title={movie.title} />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#09090B]/90 via-[#09090B]/20 to-transparent" />

                  <span className="absolute top-2.5 left-3 font-mono text-sm font-semibold tabular-nums text-[#E5A93B]">
                    {rank}
                  </span>

                  <span className="absolute bottom-2.5 right-3 inline-flex items-center gap-1 text-[11px] font-medium text-[#FAFAFA] opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="h-3 w-3 text-[#E5A93B]" aria-hidden="true" />
                    {t('preview')}
                  </span>
                </div>

                <div className="flex flex-1 flex-col justify-between p-3.5">
                  <div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#A1A1AA] mb-1">
                      <span>{movie.genre}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{movie.quality}</span>
                    </div>

                    <h3 className="font-display text-sm font-semibold text-[#FAFAFA] line-clamp-1 mb-2">
                      <button
                        type="button"
                        onClick={() => onSelectMovie(movie)}
                        className="text-left hover:text-[#E5A93B] transition-colors cursor-pointer"
                      >
                        {movie.title}
                      </button>
                    </h3>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[#27272A]/80">
                    <span className="font-mono text-xs tabular-nums text-[#D4D4D8]">
                      {movie.downloads.toLocaleString()} {t('downloadsLabel')}
                    </span>

                    <button
                      type="button"
                      onClick={() => onDownload(movie)}
                      aria-label={`Download ${movie.title}`}
                      title={`Download ${movie.title}`}
                      className="inline-flex items-center justify-center rounded-md bg-[#E5A93B] p-1.5 text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.97] transition-all cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
