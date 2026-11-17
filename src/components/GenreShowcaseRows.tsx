import { useState } from 'react';
import { ArrowRight, Bookmark, Film, Play, Star } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { MovieRatingSummary } from '../hooks/useMovieRatings';
import type { Movie, MovieGenre } from '../types/cinema';

interface GenreShowcaseRowsProps {
  movies: Movie[];
  savedMovieIds: Set<string>;
  ratingsByMovie: Record<string, MovieRatingSummary>;
  onSelectMovie: (movie: Movie) => void;
  onToggleSave: (movie: Movie) => void;
  onSeeAllGenre: (genre: MovieGenre) => void;
}

const SHOWCASE_GENRES: MovieGenre[] = [
  'Action',
  'Nollywood',
  'Sci-Fi',
  'Music',
  'Thriller',
  'Drama',
  'Mystery',
  'Comedy',
  'Documentary',
  'Animation',
  'Horror',
];

function ShowcasePosterImage({ posterUrl, title }: { posterUrl: string; title: string }) {
  const [failed, setFailed] = useState(false);

  if (!posterUrl || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-[#18181B] to-[#09090B] p-4 text-center">
        <Film className="h-9 w-9 text-[#E5A93B]/60 mb-2" aria-hidden="true" />
        <span className="font-display text-xs font-semibold text-[#D4D4D8] line-clamp-2">
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

export function GenreShowcaseRows({
  movies,
  savedMovieIds,
  ratingsByMovie,
  onSelectMovie,
  onToggleSave,
  onSeeAllGenre,
}: GenreShowcaseRowsProps) {
  const { t } = useLanguage();

  return (
    <section aria-label="Curated Genre Rows" className="border-b border-[#27272A]/80 bg-[#09090B]">
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 space-y-8">
        {SHOWCASE_GENRES.map((genre) => {
          const items = movies.filter((m) => m.genre === genre).slice(0, 4);
          if (items.length === 0) return null;

          return (
            <div key={genre}>
              <div className="flex items-center justify-between gap-4 mb-3.5">
                <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#F5C563]">
                  {genre}
                </h2>

                <button
                  type="button"
                  onClick={() => onSeeAllGenre(genre)}
                  className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#E5A93B] hover:text-[#F5C563] transition-colors whitespace-nowrap shrink-0 cursor-pointer min-h-[40px] px-1"
                >
                  <span>{t('seeAll')}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 sm:gap-5">
                {items.map((movie) => {
                  const isSaved = savedMovieIds.has(movie.id);
                  const ratingSummary = ratingsByMovie[movie.id];
                  const ratingLabel = ratingSummary?.count
                    ? ratingSummary.average.toFixed(1)
                    : (movie.imdbRating ?? 8.2).toFixed(1);

                  return (
                    <article
                      key={movie.id}
                      onClick={() => onSelectMovie(movie)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectMovie(movie);
                        }
                      }}
                      aria-label={`Watch ${movie.title}`}
                      className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-[#27272A] bg-[#111114] cursor-pointer transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#E5A93B]/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93B]"
                    >
                      <ShowcasePosterImage posterUrl={movie.posterUrl} title={movie.title} />

                      {/* Cinematic contrast scrim */}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-[#09090B]/35 to-black/25" />

                      {/* Top row: Save button + age/quality indicator */}
                      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2">
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
                          className={`rounded-lg p-1.5 border transition-colors cursor-pointer ${
                            isSaved
                              ? 'bg-[#E5A93B] border-[#E5A93B] text-[#09090B]'
                              : 'bg-[#09090B]/75 border-[#27272A] text-[#FAFAFA] opacity-90 sm:opacity-0 sm:group-hover:opacity-100 hover:border-[#E5A93B]'
                          }`}
                        >
                          <Bookmark
                            className={`h-3.5 w-3.5 ${isSaved ? 'fill-current' : ''}`}
                            aria-hidden="true"
                          />
                        </button>

                        <span className="rounded-md bg-[#09090B]/75 px-2 py-0.5 text-[10px] font-mono tabular-nums text-[#E4E4E7] border border-[#27272A]/70">
                          • {movie.ageRating || '16+'}
                        </span>
                      </div>

                      {/* Center subtle hover play cue */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#E5A93B]/95 text-[#09090B] shadow-lg">
                          <Play className="h-5 w-5 fill-current ml-0.5" aria-hidden="true" />
                        </span>
                      </div>

                      {/* Bottom poster title + rating bar */}
                      <div className="absolute bottom-0 inset-x-0 p-3 sm:p-3.5">
                        <h3 className="font-display text-sm sm:text-base font-bold uppercase tracking-tight text-[#FAFAFA] line-clamp-2 leading-tight drop-shadow">
                          {movie.title}
                        </h3>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-[#D4D4D8]">
                          <span className="truncate">{movie.genre} · {movie.quality}</span>
                          <span className="inline-flex items-center gap-1 text-[#F5C563] shrink-0">
                            <Star className="h-3 w-3 fill-[#F5C563]" aria-hidden="true" />
                            <span>{ratingLabel}</span>
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
