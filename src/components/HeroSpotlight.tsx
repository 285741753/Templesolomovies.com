import { useState } from 'react';
import { Check, Download, Film, Play, Plus, Tv } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { Movie } from '../types/cinema';

interface HeroSpotlightProps {
  movie: Movie | undefined;
  totalMovies: number;
  totalDownloads: number;
  onlineCount: number;
  isAdmin: boolean;
  isSaved: boolean;
  onDownload: (movie: Movie) => void;
  onPreview: (movie: Movie) => void;
  onToggleSave: (movie: Movie) => void;
  onStartWatchParty?: (movie: Movie) => void;
  onOpenUpload: () => void;
}

export function HeroSpotlight({
  movie,
  totalMovies,
  totalDownloads,
  onlineCount,
  isAdmin,
  isSaved,
  onDownload,
  onPreview,
  onToggleSave,
  onStartWatchParty,
  onOpenUpload,
}: HeroSpotlightProps) {
  const { t } = useLanguage();
  const [imgError, setImgError] = useState(false);

  const heroImage = movie?.backdropUrl || movie?.posterUrl || '';

  return (
    <section id="spotlight" className="border-b border-[#27272A]/80 bg-[#09090B]">
      <div className="mx-auto max-w-[1440px] px-4 pt-4 pb-6 sm:px-6 lg:px-8">
        {movie ? (
          <div className="relative overflow-hidden rounded-2xl border border-[#27272A] bg-[#111114] min-h-[340px] sm:min-h-[420px] lg:min-h-[470px] flex flex-col justify-between">
            {/* Full-bleed Cinema Still */}
            {heroImage && !imgError ? (
              <img
                src={heroImage}
                alt={`${movie.title} featured still`}
                decoding="async"
                fetchPriority="high"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#18181B] to-[#09090B]">
                <Film className="h-14 w-14 text-[#E5A93B]/40" aria-hidden="true" />
              </div>
            )}

            {/* Measured Contrast Scrim */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-[#09090B]/55 to-black/25" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#09090B]/85 via-[#09090B]/35 to-transparent" />

            {/* Top Row: Featured Badge + Quick Vault Readout */}
            <div className="relative z-10 flex items-center justify-between gap-4 p-4 sm:p-6">
              <span className="inline-flex items-center rounded-full bg-[#E5A93B] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#09090B] shadow">
                {t('featuredPill')}
              </span>

              <div className="hidden sm:flex items-center gap-3 text-xs font-mono tabular-nums text-[#D4D4D8] bg-[#09090B]/70 border border-[#27272A] rounded-lg px-3 py-1.5">
                <span>{totalMovies} titles</span>
                <span aria-hidden="true">·</span>
                <span>{totalDownloads.toLocaleString()} {t('downloadsLabel')}</span>
                <span aria-hidden="true">·</span>
                <span>{onlineCount} online</span>
              </div>
            </div>

            {/* Bottom Content Overlay matching Temple Cinema Featured Layout */}
            <div className="relative z-10 p-5 sm:p-8 flex flex-col lg:flex-row lg:items-end justify-between gap-5">
              <div className="max-w-2xl">
                <h1 className="font-display text-3xl sm:text-5xl font-bold uppercase tracking-tight text-[#F5C563] leading-[1.05] text-balance drop-shadow-sm">
                  {movie.title}
                </h1>

                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs sm:text-sm font-medium text-[#E4E4E7] font-mono tabular-nums">
                  <span>{movie.year}</span>
                  <span aria-hidden="true">•</span>
                  <span>{movie.genre}</span>
                  <span aria-hidden="true">•</span>
                  <span>{movie.quality}</span>
                  <span aria-hidden="true">•</span>
                  <span>{movie.duration}</span>
                </div>

                <p className="hidden sm:block mt-3 text-sm text-[#D4D4D8] leading-relaxed line-clamp-2 max-w-xl">
                  {movie.synopsis}
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onPreview(movie)}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#E5A93B] px-6 py-2.5 text-sm font-bold text-[#09090B] hover:bg-[#F5C563] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-lg shadow-black/40"
                  >
                    <Play className="h-4 w-4 fill-current shrink-0" aria-hidden="true" />
                    <span>{t('watchNow')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleSave(movie)}
                    className={`min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSaved
                        ? 'border-[#E5A93B] bg-[#E5A93B]/20 text-[#F5C563]'
                        : 'border-[#52525B] bg-[#09090B]/75 text-[#FAFAFA] hover:border-[#E5A93B]'
                    }`}
                  >
                    {isSaved ? (
                      <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>{isSaved ? t('myListAdded') : t('myListAdd')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDownload(movie)}
                    aria-label={`Download ${movie.title}`}
                    className="min-h-[44px] hidden sm:inline-flex items-center justify-center gap-2 rounded-xl border border-[#27272A] bg-[#09090B]/75 px-4 py-2.5 text-xs font-medium text-[#D4D4D8] hover:border-[#E5A93B] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="h-4 w-4 text-[#E5A93B] shrink-0" aria-hidden="true" />
                    <span>{t('download')}</span>
                  </button>

                  {onStartWatchParty && (
                    <button
                      type="button"
                      onClick={() => onStartWatchParty(movie)}
                      className="min-h-[44px] hidden md:inline-flex items-center justify-center gap-2 rounded-xl border border-[#27272A] bg-[#09090B]/75 px-4 py-2.5 text-xs font-medium text-[#D4D4D8] hover:border-[#E5A93B] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Tv className="h-4 w-4 text-[#E5A93B] shrink-0" aria-hidden="true" />
                      <span>{t('navWatchParty')}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#27272A] bg-[#111114] py-16 px-6 text-center">
            <Film className="h-10 w-10 text-[#E5A93B] mb-3" aria-hidden="true" />
            <h1 className="font-display text-2xl font-bold text-[#FAFAFA] mb-2">
              {t('vaultReadyTitle')}
            </h1>
            <p className="text-sm text-[#A1A1AA] max-w-md mb-6">
              {isAdmin ? t('vaultReadyAdmin') : t('vaultReadyViewer')}
            </p>
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenUpload}
                className="rounded-xl bg-[#E5A93B] px-5 py-2.5 text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
              >
                {t('uploadFirstMovie')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
