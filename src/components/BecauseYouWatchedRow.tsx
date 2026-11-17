import { useMemo } from 'react';
import { Film, Play, Sparkles, Star } from 'lucide-react';
import type { Movie } from '../types/cinema';

interface BecauseYouWatchedRowProps {
  seedMovie: Movie | undefined;
  allMovies: Movie[];
  onSelectMovie: (movie: Movie) => void;
  headingPrefix?: string;
}

export function BecauseYouWatchedRow({
  seedMovie,
  allMovies,
  onSelectMovie,
  headingPrefix = 'Because you watched',
}: BecauseYouWatchedRowProps) {
  const recommendations = useMemo(() => {
    if (!seedMovie) return [];
    return allMovies
      .filter((m) => m.id !== seedMovie.id)
      .map((candidate) => {
        let score = 0;
        if (candidate.genre === seedMovie.genre) score += 4;
        if (candidate.country && candidate.country === seedMovie.country) score += 2;
        if (candidate.director === seedMovie.director) score += 2;
        if (candidate.category && candidate.category === seedMovie.category) score += 1;
        score += (candidate.imdbRating ?? 7.5) / 10;
        return { candidate, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((entry) => entry.candidate);
  }, [seedMovie, allMovies]);

  if (!seedMovie || recommendations.length === 0) return null;

  return (
    <section
      aria-label="Because you watched recommendations"
      className="rounded-xl border border-[#27272A] bg-[#0A0A0C] p-4"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-[#E6A93C] mb-1">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Recommended For You</span>
      </div>
      <h3 className="font-display text-base font-bold text-[#FAFAFA] mb-3 truncate">
        {headingPrefix} &ldquo;{seedMovie.title}&rdquo;
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {recommendations.map((rec) => (
          <button
            key={rec.id}
            type="button"
            onClick={() => onSelectMovie(rec)}
            className="group flex flex-col overflow-hidden rounded-xl border border-[#27272A] bg-[#111114] text-left hover:border-[#E6A93C]/70 transition-colors cursor-pointer"
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#18181B]">
              {rec.posterUrl ? (
                <img
                  src={rec.posterUrl}
                  alt={`${rec.title} poster`}
                  loading="lazy"
                  className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Film className="h-7 w-7 text-[#E6A93C]/50" aria-hidden="true" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0C] via-transparent to-transparent" />
              <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#E6A93C]/90 text-[#0A0A0C] opacity-0 group-hover:opacity-100 transition-opacity">
                <Play className="h-3.5 w-3.5 fill-current ml-0.5" aria-hidden="true" />
              </span>
            </div>

            <div className="p-2.5">
              <p className="font-display text-xs font-semibold text-[#FAFAFA] line-clamp-1">
                {rec.title}
              </p>
              <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-[#A1A1AA]">
                <span className="truncate">{rec.genre}</span>
                <span className="inline-flex items-center gap-0.5 text-[#E6A93C]">
                  <Star className="h-2.5 w-2.5 fill-[#E6A93C]" aria-hidden="true" />
                  {(rec.imdbRating ?? 7.8).toFixed(1)}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
