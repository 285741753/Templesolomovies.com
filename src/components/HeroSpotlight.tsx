import { useState } from 'react';
import { Download, Play, MessageSquare, Film } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { Movie } from '../types/cinema';
import { formatFileSize } from '../utils/format';

interface HeroSpotlightProps {
  movie: Movie | undefined;
  totalMovies: number;
  totalDownloads: number;
  onlineCount: number;
  isAdmin: boolean;
  onDownload: (movie: Movie) => void;
  onPreview: (movie: Movie) => void;
  onShareToChat: (movie: Movie) => void;
  onOpenUpload: () => void;
}

export function HeroSpotlight({
  movie,
  totalMovies,
  totalDownloads,
  onlineCount,
  isAdmin,
  onDownload,
  onPreview,
  onShareToChat,
  onOpenUpload,
}: HeroSpotlightProps) {
  const { t } = useLanguage();
  const [imgError, setImgError] = useState(false);

  const heroImage = movie?.backdropUrl || movie?.posterUrl || '';

  return (
    <section id="spotlight" className="border-b border-[#27272A]">
      <div className="mx-auto max-w-[1440px] px-4 pt-8 pb-8 sm:px-6 lg:px-8">
        {movie ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left Typographic Column */}
            <div className="lg:col-span-5 flex flex-col justify-between py-2">
              <div>
                <p className="text-xs font-medium tracking-wide text-[#E5A93B] mb-3">
                  {t('featuredRelease')}
                </p>

                <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight text-[#FAFAFA] leading-[1.1] text-balance mb-4">
                  {movie.title}
                </h1>

                {/* Clean Unboxed Metadata */}
                <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[#A1A1AA] font-mono tabular-nums mb-5">
                  <span>{movie.genre}</span>
                  <span aria-hidden="true">·</span>
                  <span>{movie.year}</span>
                  <span aria-hidden="true">·</span>
                  <span>{movie.duration}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#FAFAFA]">{movie.quality}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatFileSize(movie.fileSizeBytes)}</span>
                </div>

                <p className="text-sm sm:text-base text-[#A1A1AA] leading-relaxed max-w-xl mb-6">
                  {movie.synopsis}
                </p>

                <p className="text-xs text-[#71717A] mb-7">
                  {t('directedBy')} <span className="text-[#D4D4D8]">{movie.director}</span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  {t('uploadedBy')} <span className="text-[#D4D4D8]">{movie.uploader}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onDownload(movie)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-5 py-2.5 text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t('downloadMovie')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onPreview(movie)}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#27272A] bg-[#18181B] px-5 py-2.5 text-sm font-medium text-[#FAFAFA] hover:bg-[#27272A] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t('streamPreview')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onShareToChat(movie)}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#27272A] bg-transparent px-4 py-2.5 text-sm font-medium text-[#A1A1AA] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t('discussInChat')}</span>
                </button>
              </div>
            </div>

            {/* Right 16:9 Cinema Backdrop */}
            <div className="lg:col-span-7">
              <div
                onClick={() => onPreview(movie)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPreview(movie);
                  }
                }}
                aria-label={`Preview ${movie.title}`}
                className="group relative h-full min-h-[260px] sm:min-h-[340px] lg:min-h-[380px] w-full overflow-hidden rounded-xl border border-[#27272A] bg-[#111114] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93B]"
              >
                {heroImage && !imgError ? (
                  <img
                    src={heroImage}
                    alt={`${movie.title} film still`}
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#18181B] to-[#09090B] p-8 text-center">
                    <Film className="h-12 w-12 text-[#E5A93B]/60 mb-3" aria-hidden="true" />
                    <span className="font-display text-lg font-semibold text-[#FAFAFA]">
                      {movie.title}
                    </span>
                  </div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-[#09090B]/90 via-[#09090B]/20 to-transparent" />

                <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between gap-4">
                  <div className="text-xs font-mono tabular-nums text-[#D4D4D8]">
                    <span>{movie.downloads.toLocaleString()} {t('downloadsLabel')}</span>
                    <span className="mx-2 text-[#71717A]" aria-hidden="true">·</span>
                    <span>{movie.fileName}</span>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-[#09090B]/80 border border-[#27272A] px-3 py-1.5 text-xs font-medium text-[#FAFAFA] backdrop-blur-sm">
                    <Play className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                    {t('watchClip')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#27272A] bg-[#111114] py-16 px-6 text-center">
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
                className="rounded-lg bg-[#E5A93B] px-5 py-2.5 text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
              >
                {t('uploadFirstMovie')}
              </button>
            )}
          </div>
        )}

        {/* Full-Width 4-Column Vault Metrics Strip */}
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4 border-t border-[#27272A] pt-6">
          <div>
            <p className="text-xs text-[#71717A] mb-1">{t('metricMovies')}</p>
            <p className="font-mono text-xl font-semibold tabular-nums text-[#FAFAFA]">
              {totalMovies}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#71717A] mb-1">{t('metricDownloads')}</p>
            <p className="font-mono text-xl font-semibold tabular-nums text-[#FAFAFA]">
              {totalDownloads.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#71717A] mb-1">{t('metricOnline')}</p>
            <p className="font-mono text-xl font-semibold tabular-nums text-[#FAFAFA]">
              {onlineCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#71717A] mb-1">{t('metricFormats')}</p>
            <p className="font-mono text-sm sm:text-base font-medium text-[#D4D4D8] pt-0.5">
              MP4 · MKV · WEBM · MOV
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
