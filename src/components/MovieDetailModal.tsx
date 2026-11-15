import { useEffect, useState } from 'react';
import { Bookmark, Check, Download, Edit3, MessageSquare, Share2, Star, Trash2, X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { MovieRatingSummary } from '../hooks/useMovieRatings';
import type { Movie, MovieGenre, MovieQuality } from '../types/cinema';
import { formatFileSize } from '../utils/format';

interface MovieDetailModalProps {
  movie: Movie | null;
  isSaved: boolean;
  canManage: boolean;
  isAuthenticated: boolean;
  ratingSummary?: MovieRatingSummary;
  onClose: () => void;
  onDownload: (movie: Movie) => void;
  onShareToChat: (movie: Movie) => void;
  onToggleSave: (movie: Movie) => void;
  onRateMovie: (movieId: string, stars: number) => Promise<void>;
  onMoviePlayed?: (movieId: string) => void;
  onShareSuccess?: (message: string) => void;
  onUpdate: (
    movieId: string,
    updates: {
      title: string;
      genre: MovieGenre;
      quality: MovieQuality;
      director: string;
      synopsis: string;
    }
  ) => Promise<void>;
  onDelete: (movieId: string) => Promise<void>;
}

const GENRES: MovieGenre[] = [
  'Action',
  'Drama',
  'Thriller',
  'Sci-Fi',
  'Comedy',
  'Mystery',
  'Documentary',
  'Animation',
  'Horror',
];

const QUALITIES: MovieQuality[] = ['4K UHD', '1080p HD', '720p HD'];

export function MovieDetailModal({
  movie,
  isSaved,
  canManage,
  isAuthenticated,
  ratingSummary,
  onClose,
  onDownload,
  onShareToChat,
  onToggleSave,
  onRateMovie,
  onMoviePlayed,
  onShareSuccess,
  onUpdate,
  onDelete,
}: MovieDetailModalProps) {
  const { t } = useLanguage();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [hoveredStar, setHoveredStar] = useState<number>(0);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const [editTitle, setEditTitle] = useState('');
  const [editGenre, setEditGenre] = useState<MovieGenre>('Drama');
  const [editQuality, setEditQuality] = useState<MovieQuality>('1080p HD');
  const [editDirector, setEditDirector] = useState('');
  const [editSynopsis, setEditSynopsis] = useState('');

  useEffect(() => {
    setConfirmDelete(false);
    setIsDeleting(false);
    setIsEditing(false);
    setHoveredStar(0);
    setIsSubmittingRating(false);
    setLinkCopied(false);
    if (movie) {
      setEditTitle(movie.title);
      setEditGenre(movie.genre);
      setEditQuality(movie.quality);
      setEditDirector(movie.director);
      setEditSynopsis(movie.synopsis);
    }
  }, [movie]);

  useEffect(() => {
    if (!movie) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [movie, onClose]);

  if (!movie) return null;

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    await onDelete(movie.id);
    setIsDeleting(false);
    onClose();
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) return;
    setIsSavingEdit(true);
    await onUpdate(movie.id, {
      title: editTitle.trim(),
      genre: editGenre,
      quality: editQuality,
      director: editDirector.trim() || movie.director,
      synopsis: editSynopsis.trim() || movie.synopsis,
    });
    setIsSavingEdit(false);
    setIsEditing(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#09090B]/90 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-modal-title"
    >
      <div className="w-full max-w-4xl rounded-xl border border-[#27272A] bg-[#111114] shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#27272A] px-6 py-4">
          <div className="min-w-0">
            <h2
              id="detail-modal-title"
              className="font-display text-xl font-bold text-[#FAFAFA] truncate"
            >
              {movie.title}
            </h2>
            <p className="text-xs text-[#A1A1AA] font-mono tabular-nums mt-0.5">
              {movie.genre} · {movie.year} · {movie.duration} · {movie.quality}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close movie preview"
            className="rounded-lg p-2 text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Video Stream Player */}
        <div className="bg-[#09090B] border-b border-[#27272A]">
          <video
            key={movie.videoUrl}
            src={movie.videoUrl}
            poster={movie.backdropUrl || movie.posterUrl}
            controls
            playsInline
            preload="metadata"
            onPlay={() => onMoviePlayed?.(movie.id)}
            className="w-full aspect-video max-h-[420px] object-contain bg-black"
          />
        </div>

        {/* Movie Details / Inline Owner Edit Form */}
        <div className="p-6 space-y-5">
          {isEditing ? (
            <form onSubmit={handleSaveEdit} className="space-y-4 rounded-lg border border-[#27272A] bg-[#09090B] p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    Director
                  </label>
                  <input
                    type="text"
                    value={editDirector}
                    onChange={(e) => setEditDirector(e.target.value)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    Genre
                  </label>
                  <select
                    value={editGenre}
                    onChange={(e) => setEditGenre(e.target.value as MovieGenre)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  >
                    {GENRES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    Quality
                  </label>
                  <select
                    value={editQuality}
                    onChange={(e) => setEditQuality(e.target.value as MovieQuality)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  >
                    {QUALITIES.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                  Synopsis
                </label>
                <textarea
                  rows={3}
                  value={editSynopsis}
                  onChange={(e) => setEditSynopsis(e.target.value)}
                  className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="rounded-lg border border-[#27272A] px-3.5 py-1.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="rounded-lg bg-[#E5A93B] px-4 py-1.5 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-50 cursor-pointer"
                >
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-[#D4D4D8] leading-relaxed">{movie.synopsis}</p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 rounded-lg border border-[#27272A] bg-[#09090B] p-4 text-xs">
            <div>
              <p className="text-[#71717A] mb-1">Director</p>
              <p className="font-medium text-[#FAFAFA] truncate">{movie.director}</p>
            </div>
            <div>
              <p className="text-[#71717A] mb-1">Uploaded By</p>
              <p className="font-medium text-[#FAFAFA] truncate">{movie.uploader}</p>
            </div>
            <div>
              <p className="text-[#71717A] mb-1">File Size</p>
              <p className="font-mono tabular-nums font-medium text-[#FAFAFA]">
                {formatFileSize(movie.fileSizeBytes)}
              </p>
            </div>
            <div>
              <p className="text-[#71717A] mb-1">Downloads</p>
              <p className="font-mono tabular-nums font-medium text-[#FAFAFA]">
                {movie.downloads.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[#71717A] mb-1">Average Rating</p>
              <p className="inline-flex items-center gap-1.5 font-mono tabular-nums font-medium text-[#FAFAFA]">
                <Star
                  className={`h-3.5 w-3.5 ${
                    ratingSummary?.count ? 'text-[#E5A93B] fill-[#E5A93B]' : 'text-[#52525B]'
                  }`}
                  aria-hidden="true"
                />
                {ratingSummary?.count ? (
                  <span>
                    {ratingSummary.average.toFixed(1)} / 5 ({ratingSummary.count})
                  </span>
                ) : (
                  <span className="text-[#71717A]">No ratings yet</span>
                )}
              </p>
            </div>
          </div>

          {/* 5-Star Rating Control */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-[#27272A] bg-[#09090B] px-4 py-3">
            <div>
              <p className="text-xs font-medium text-[#FAFAFA]">
                {isAuthenticated
                  ? ratingSummary?.userRating
                    ? `Your Rating: ${ratingSummary.userRating} / 5`
                    : 'Rate this Movie'
                  : 'Community 5-Star Rating'}
              </p>
              <p className="text-[11px] text-[#71717A]">
                {isAuthenticated
                  ? 'Click a star to submit or update your rating.'
                  : 'Log in or sign up to leave a 5-star rating.'}
              </p>
            </div>

            <div
              className="flex items-center gap-1"
              onMouseLeave={() => setHoveredStar(0)}
              role="group"
              aria-label={`Rate ${movie.title} from 1 to 5 stars`}
            >
              {[1, 2, 3, 4, 5].map((star) => {
                const activeValue = hoveredStar || ratingSummary?.userRating || 0;
                const filled = star <= activeValue;
                return (
                  <button
                    key={star}
                    type="button"
                    disabled={isSubmittingRating}
                    onMouseEnter={() => setHoveredStar(star)}
                    onClick={async () => {
                      setIsSubmittingRating(true);
                      await onRateMovie(movie.id, star);
                      setIsSubmittingRating(false);
                    }}
                    aria-label={`Rate ${star} ${star === 1 ? 'star' : 'stars'}`}
                    className="rounded p-1.5 hover:bg-[#18181B] disabled:opacity-50 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5A93B]"
                  >
                    <Star
                      className={`h-5 w-5 transition-colors ${
                        filled
                          ? 'text-[#E5A93B] fill-[#E5A93B]'
                          : 'text-[#52525B] hover:text-[#A1A1AA]'
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => onDownload(movie)}
                className="inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-5 py-2.5 text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>Download ({movie.fileName})</span>
              </button>

              <button
                type="button"
                onClick={() => onToggleSave(movie)}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  isSaved
                    ? 'border-[#E5A93B] bg-[#E5A93B]/15 text-[#E5A93B]'
                    : 'border-[#27272A] bg-[#18181B] text-[#FAFAFA] hover:bg-[#27272A]'
                }`}
              >
                <Bookmark
                  className={`h-4 w-4 ${isSaved ? 'fill-current' : ''}`}
                  aria-hidden="true"
                />
                <span>{isSaved ? 'Saved' : 'Save'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onShareToChat(movie);
                  onClose();
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-[#27272A] bg-[#18181B] px-4 py-2.5 text-sm font-medium text-[#FAFAFA] hover:bg-[#27272A] cursor-pointer"
              >
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                <span>Share in Chat</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  const shareUrl = `${window.location.origin}/?movie=${encodeURIComponent(movie.id)}`;
                  const copyToClipboard = async () => {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(shareUrl);
                    } else {
                      const area = document.createElement('textarea');
                      area.value = shareUrl;
                      area.style.position = 'fixed';
                      area.style.opacity = '0';
                      document.body.appendChild(area);
                      area.select();
                      document.execCommand('copy');
                      area.remove();
                    }
                    setLinkCopied(true);
                    onShareSuccess?.(`Copied direct link for "${movie.title}" to clipboard.`);
                    window.setTimeout(() => setLinkCopied(false), 2500);
                  };

                  if (typeof navigator.share === 'function') {
                    try {
                      await navigator.share({
                        title: movie.title,
                        text: `Watch ${movie.title} (${movie.year}) on templesolosmovies.com`,
                        url: shareUrl,
                      });
                      await copyToClipboard().catch(() => {});
                      return;
                    } catch (err) {
                      if (err instanceof Error && err.name === 'AbortError') {
                        return;
                      }
                    }
                  }
                  await copyToClipboard();
                }}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  linkCopied
                    ? 'border-[#E5A93B] bg-[#E5A93B]/15 text-[#E5A93B]'
                    : 'border-[#27272A] bg-[#18181B] text-[#FAFAFA] hover:bg-[#27272A]'
                }`}
              >
                {linkCopied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{linkCopied ? t('linkCopied') : t('shareLink')}</span>
              </button>
            </div>

            {canManage && (
              <div className="flex items-center gap-2">
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:border-[#E5A93B] hover:text-[#FAFAFA] cursor-pointer"
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                )}

                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] px-3 py-2 text-xs font-medium text-[#A1A1AA] hover:border-red-500/40 hover:text-red-300 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-300">Remove from vault?</span>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={handleConfirmDelete}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50 cursor-pointer"
                    >
                      {isDeleting ? 'Removing...' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-md border border-[#27272A] px-2.5 py-1.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
