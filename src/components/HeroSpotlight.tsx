import { memo, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Play,
  Plus,
  Tv,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { Movie } from '../types/cinema';

interface HeroSpotlightProps {
  movies: Movie[];
  totalMovies: number;
  totalDownloads: number;
  onlineCount: number;
  isAdmin: boolean;
  isMovieSaved: (movieId: string) => boolean;
  onDownload: (movie: Movie) => void;
  onPreview: (movie: Movie) => void;
  onWatchTrailer?: (movie: Movie) => void;
  onToggleSave: (movie: Movie) => void;
  onStartWatchParty?: (movie: Movie) => void;
  onOpenUpload: () => void;
}

const SLIDE_INTERVAL_MS = 5500;

export const HeroSpotlight = memo(function HeroSpotlight({
  movies,
  totalMovies,
  totalDownloads,
  onlineCount,
  isAdmin,
  isMovieSaved,
  onDownload,
  onPreview,
  onWatchTrailer,
  onToggleSave,
  onStartWatchParty,
  onOpenUpload,
}: HeroSpotlightProps) {
  const { t } = useLanguage();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const touchStartXRef = useRef<number | null>(null);

  // Pick up to 5 featured slides (prioritizing featured flag, then downloads)
  const slides = useMemo(() => {
    if (movies.length === 0) return [];
    return [...movies]
      .sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return b.downloads - a.downloads;
      })
      .slice(0, 5);
  }, [movies]);

  const safeIndex = slides.length > 0 ? activeIndex % slides.length : 0;
  const currentMovie = slides[safeIndex];

  useEffect(() => {
    setActiveIndex(0);
  }, [movies.length]);

  useEffect(() => {
    if (slides.length <= 1 || isPaused) return;
    let timerId: number | null = null;

    const schedule = () => {
      if (document.hidden) return;
      timerId = window.setInterval(() => {
        if (!document.hidden) {
          setActiveIndex((prev) => (prev + 1) % slides.length);
        }
      }, SLIDE_INTERVAL_MS);
    };

    const handleVisibility = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
      if (!document.hidden) {
        schedule();
      }
    };

    schedule();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (timerId !== null) window.clearInterval(timerId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [slides.length, isPaused]);

  // Preload next slide image so slide transitions render instantaneously
  useEffect(() => {
    if (slides.length <= 1) return;
    const nextMovie = slides[(safeIndex + 1) % slides.length];
    const nextSrc = nextMovie?.backdropUrl || nextMovie?.posterUrl;
    if (!nextSrc) return;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = nextSrc;
  }, [slides, safeIndex]);

  const goPrev = () => {
    if (slides.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const goNext = () => {
    if (slides.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % slides.length);
  };

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
    setIsPaused(true);
  };

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current;
    const endX = e.changedTouches[0]?.clientX ?? null;
    touchStartXRef.current = null;
    setIsPaused(false);
    if (startX === null || endX === null) return;
    const delta = startX - endX;
    if (Math.abs(delta) < 40) return;
    if (delta > 0) {
      goNext();
    } else {
      goPrev();
    }
  };

  const heroImage = currentMovie?.backdropUrl || currentMovie?.posterUrl || '';
  const hasImageError = currentMovie ? Boolean(failedImages[currentMovie.id]) : false;
  const isSaved = currentMovie ? isMovieSaved(currentMovie.id) : false;

  return (
    <section
      id="spotlight"
      aria-roledescription="carousel"
      aria-label="Featured releases carousel"
      className="w-full max-w-full overflow-x-clip border-b border-[#27272A]/80 bg-[#0A0A0C]"
    >
      <div className="mx-auto max-w-[1440px] px-4 pt-4 pb-5 sm:px-6 lg:px-8">
        {currentMovie ? (
          <div
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="relative overflow-hidden rounded-2xl border border-[#27272A] bg-[#111114] min-h-[340px] sm:min-h-[420px] lg:min-h-[460px] flex flex-col justify-between select-none"
          >
            {/* Full-bleed Cinema Still */}
            {heroImage && !hasImageError ? (
              <img
                key={currentMovie.id}
                src={heroImage}
                alt={`${currentMovie.title} featured still`}
                decoding="async"
                fetchPriority="high"
                referrerPolicy="no-referrer"
                onError={() =>
                  setFailedImages((prev) => ({ ...prev, [currentMovie.id]: true }))
                }
                className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#18181B] to-[#0A0A0C]">
                <Film className="h-14 w-14 text-[#E6A93C]/40" aria-hidden="true" />
              </div>
            )}

            {/* Measured Contrast Scrim */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0C] via-[#0A0A0C]/55 to-black/25" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0C]/90 via-[#0A0A0C]/40 to-transparent" />

            {/* Top Row: Featured Label + Stats + Carousel Arrows */}
            <div className="relative z-10 flex items-center justify-between gap-3 p-4 sm:p-6">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-[#E6A93C] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#0A0A0C] shadow">
                  {t('featuredPill')}
                </span>
                {slides.length > 1 && (
                  <span className="font-mono text-[11px] tabular-nums text-[#E4E4E7] bg-[#0A0A0C]/75 border border-[#27272A] rounded-md px-2 py-0.5">
                    {safeIndex + 1}/{slides.length}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden md:flex items-center gap-3 text-xs font-mono tabular-nums text-[#D4D4D8] bg-[#0A0A0C]/75 border border-[#27272A] rounded-lg px-3 py-1.5">
                  <span>{totalMovies} titles</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {totalDownloads.toLocaleString()} {t('downloadsLabel')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{onlineCount} online</span>
                </div>

                {slides.length > 1 && (
                  <div className="hidden sm:flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={goPrev}
                      aria-label="Previous featured movie"
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-[#27272A] bg-[#0A0A0C]/75 text-[#FAFAFA] hover:border-[#E6A93C] hover:text-[#E6A93C] transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={goNext}
                      aria-label="Next featured movie"
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-[#27272A] bg-[#0A0A0C]/75 text-[#FAFAFA] hover:border-[#E6A93C] hover:text-[#E6A93C] transition-colors cursor-pointer"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Content Overlay */}
            <div className="relative z-10 p-4 sm:p-8 flex flex-col gap-4">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 min-w-0">
                <div className="max-w-2xl min-w-0 w-full">
                  <h1 className="font-display text-2xl sm:text-5xl font-bold uppercase tracking-tight text-[#F5C563] leading-[1.06] text-balance break-words drop-shadow-sm">
                    {currentMovie.title}
                  </h1>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs sm:text-sm font-medium text-[#E4E4E7] font-mono tabular-nums">
                    <span>{currentMovie.year}</span>
                    <span aria-hidden="true">•</span>
                    <span>{currentMovie.genre}</span>
                    <span aria-hidden="true">•</span>
                    <span>{currentMovie.quality}</span>
                    <span aria-hidden="true">•</span>
                    <span>{currentMovie.duration}</span>
                  </div>

                  <p className="hidden sm:block mt-2.5 text-sm text-[#D4D4D8] leading-relaxed line-clamp-2 max-w-xl">
                    {currentMovie.synopsis}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-2.5 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => onPreview(currentMovie)}
                      className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#E6A93C] px-5 sm:px-6 py-2.5 text-sm font-bold text-[#0A0A0C] hover:bg-[#F5C563] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-lg shadow-black/40"
                    >
                      <Play className="h-4 w-4 fill-current shrink-0" aria-hidden="true" />
                      <span>{t('playLabel')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleSave(currentMovie)}
                      className={`min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border px-4 sm:px-5 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isSaved
                          ? 'border-[#E6A93C] bg-[#E6A93C]/20 text-[#F5C563]'
                          : 'border-[#52525B] bg-[#0A0A0C]/80 text-[#FAFAFA] hover:border-[#E6A93C]'
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
                      onClick={() => onDownload(currentMovie)}
                      aria-label={`Download ${currentMovie.title}`}
                      className="min-h-[44px] hidden sm:inline-flex items-center justify-center gap-2 rounded-xl border border-[#27272A] bg-[#0A0A0C]/80 px-4 py-2.5 text-xs font-medium text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Download className="h-4 w-4 text-[#E6A93C] shrink-0" aria-hidden="true" />
                      <span>{t('download')}</span>
                    </button>

                    {onWatchTrailer && (
                      <button
                        type="button"
                        onClick={() => onWatchTrailer(currentMovie)}
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#27272A] bg-[#0A0A0C]/80 px-3.5 py-2.5 text-xs font-medium text-[#E6A93C] hover:border-[#E6A93C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Film className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>Trailer</span>
                      </button>
                    )}

                    {onStartWatchParty && (
                      <button
                        type="button"
                        onClick={() => onStartWatchParty(currentMovie)}
                        className="min-h-[44px] hidden md:inline-flex items-center justify-center gap-2 rounded-xl border border-[#27272A] bg-[#0A0A0C]/80 px-4 py-2.5 text-xs font-medium text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Tv className="h-4 w-4 text-[#E6A93C] shrink-0" aria-hidden="true" />
                        <span>{t('navWatchParty')}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Carousel Dots */}
                {slides.length > 1 && (
                  <div
                    role="tablist"
                    aria-label="Featured slides"
                    className="flex items-center justify-center lg:justify-end gap-1"
                  >
                    {slides.map((slide, idx) => {
                      const active = idx === safeIndex;
                      return (
                        <button
                          key={slide.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          aria-label={`Show slide ${idx + 1}: ${slide.title}`}
                          onClick={() => setActiveIndex(idx)}
                          className="min-h-[44px] min-w-[26px] inline-flex items-center justify-center cursor-pointer"
                        >
                          <span
                            className={`h-2 rounded-full transition-all ${
                              active
                                ? 'w-6 bg-[#E6A93C]'
                                : 'w-2 bg-[#52525B] hover:bg-[#A1A1AA]'
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#27272A] bg-[#111114] py-16 px-6 text-center">
            <Film className="h-10 w-10 text-[#E6A93C] mb-3" aria-hidden="true" />
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
                className="min-h-[44px] rounded-xl bg-[#E6A93C] px-5 py-2.5 text-sm font-semibold text-[#0A0A0C] hover:bg-[#F5C563] cursor-pointer"
              >
                {t('uploadFirstMovie')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
});
