import { useEffect, useState } from 'react';
import { Download, HardDrive, WifiOff, X } from 'lucide-react';
import type { DownloadQualityTier, Movie } from '../types/cinema';
import { formatFileSize } from '../utils/format';
import { estimateTierFileSize } from '../utils/movieMetadata';

interface DownloadQualityModalProps {
  movie: Movie | null;
  defaultQuality?: string;
  isWifiBlocked: boolean;
  onConfirm: (movie: Movie, quality: DownloadQualityTier) => void;
  onClose: () => void;
}

const QUALITY_TIERS: Array<{
  tier: DownloadQualityTier;
  badge: string;
  desc: string;
}> = [
  { tier: '360p', badge: 'Data Saver', desc: 'Fastest download · Low mobile data' },
  { tier: '720p', badge: 'HD', desc: 'Balanced clarity for phones' },
  { tier: '1080p', badge: 'Full HD', desc: 'Sharp cinema detail' },
  { tier: '4K', badge: 'Ultra HD', desc: 'Maximum bitrate & screen fidelity' },
];

export function DownloadQualityModal({
  movie,
  defaultQuality,
  isWifiBlocked,
  onConfirm,
  onClose,
}: DownloadQualityModalProps) {
  const initialTier: DownloadQualityTier =
    defaultQuality === '360p' ||
    defaultQuality === '720p' ||
    defaultQuality === '1080p'
      ? defaultQuality
      : '720p';

  const [selectedTier, setSelectedTier] = useState<DownloadQualityTier>(initialTier);

  useEffect(() => {
    setSelectedTier(initialTier);
  }, [movie?.id, initialTier]);

  useEffect(() => {
    if (!movie) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [movie, onClose]);

  if (!movie) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-quality-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4 backdrop-blur-sm"
    >
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[#27272A] bg-[#111114] p-5 sm:p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[#27272A] pb-4 mb-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-wider text-[#E6A93C] mb-1">
              Choose Download Quality
            </p>
            <h2
              id="download-quality-title"
              className="font-display text-lg font-bold text-[#FAFAFA] truncate"
            >
              {movie.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close download picker"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {isWifiBlocked && (
          <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            <WifiOff className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <span>
              &quot;Download Only On WiFi&quot; is ON and you are on cellular data. Turn it off in Settings or connect to WiFi.
            </span>
          </div>
        )}

        <div className="space-y-2.5 mb-5" role="radiogroup" aria-label="Download resolution options">
          {QUALITY_TIERS.map(({ tier, badge, desc }) => {
            const active = selectedTier === tier;
            const estSize = estimateTierFileSize(movie.fileSizeBytes, tier);
            return (
              <button
                key={tier}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelectedTier(tier)}
                className={`min-h-[56px] w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer ${
                  active
                    ? 'border-[#E6A93C] bg-[#E6A93C]/12'
                    : 'border-[#27272A] bg-[#0A0A0C] hover:border-[#3F3F46]'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm font-bold text-[#FAFAFA]">
                      {tier}
                    </span>
                    <span className="rounded-md border border-[#27272A] bg-[#18181B] px-1.5 py-0.5 font-mono text-[10px] text-[#E6A93C]">
                      {badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#A1A1AA] mt-0.5">{desc}</p>
                </div>

                <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-[#E4E4E7] shrink-0">
                  <HardDrive className="h-3.5 w-3.5 text-[#71717A]" aria-hidden="true" />
                  <span>{formatFileSize(estSize)}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-1 rounded-xl border border-[#27272A] bg-[#18181B] px-4 py-2.5 text-xs font-semibold text-[#D4D4D8] hover:text-[#FAFAFA] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isWifiBlocked}
            onClick={() => {
              onConfirm(movie, selectedTier);
              onClose();
            }}
            className="min-h-[44px] flex-[2] inline-flex items-center justify-center gap-2 rounded-xl bg-[#E6A93C] px-4 py-2.5 text-xs sm:text-sm font-bold text-[#0A0A0C] hover:bg-[#F5C563] disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>
              Download {selectedTier} ({formatFileSize(estimateTierFileSize(movie.fileSizeBytes, selectedTier))})
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
