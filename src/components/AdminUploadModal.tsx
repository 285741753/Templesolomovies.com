import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Film,
  Image as ImageIcon,
  Layers,
  Link as LinkIcon,
  ShieldCheck,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import {
  getCloudinaryConfig,
  uploadToCloudinaryUnsigned,
  validatePosterFile,
  validateVideoFile,
} from '../services/cloudinary';
import type { HomeCategoryChip, Movie, MovieGenre, MovieQuality } from '../types/cinema';
import { formatDurationSeconds, formatFileSize } from '../utils/format';

export interface AdminMovieUpdatePayload {
  title: string;
  synopsis: string;
  year: number;
  genre: MovieGenre;
  category: Exclude<HomeCategoryChip, 'All'>;
  ageRating: string;
  duration: string;
  trailerUrl?: string;
}

interface AdminUploadModalProps {
  isOpen: boolean;
  movies: Movie[];
  defaultUploader: string;
  onClose: () => void;
  onCreateMovie: (movie: Movie) => void;
  onEditMovie: (movieId: string, updates: AdminMovieUpdatePayload) => Promise<void> | void;
  onDeleteMovie: (movieId: string) => Promise<void> | void;
  onNotify: (message: string) => void;
}

type AdminTab = 'upload' | 'manage';
type CategoryOption = Exclude<HomeCategoryChip, 'All'>;

const GENRES: MovieGenre[] = [
  'Action',
  'Nollywood',
  'Sci-Fi',
  'Music',
  'Drama',
  'Thriller',
  'Comedy',
  'Mystery',
  'Documentary',
  'Animation',
  'Horror',
];

const CATEGORY_OPTIONS: Array<{ value: CategoryOption; label: string }> = [
  { value: 'Movies', label: 'Movie' },
  { value: 'Series', label: 'Series' },
  { value: 'Anime', label: 'Anime' },
  { value: 'Nollywood', label: 'Nollywood' },
  { value: 'K-Drama', label: 'K-Drama' },
  { value: 'Music', label: 'Music' },
];

const AGE_RATINGS = ['G', 'PG', '13+', '16+', '18+', 'R'] as const;

export function AdminUploadModal({
  isOpen,
  movies,
  defaultUploader,
  onClose,
  onCreateMovie,
  onEditMovie,
  onDeleteMovie,
  onNotify,
}: AdminUploadModalProps) {
  const cloudinaryConfig = useMemo(() => getCloudinaryConfig(), []);
  const [activeTab, setActiveTab] = useState<AdminTab>('upload');

  // Upload form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [genre, setGenre] = useState<MovieGenre>('Action');
  const [category, setCategory] = useState<CategoryOption>('Movies');
  const [ageRating, setAgeRating] = useState<string>('16+');
  const [runtime, setRuntime] = useState('');
  const [quality, setQuality] = useState<MovieQuality>('1080p HD');
  const [trailerUrl, setTrailerUrl] = useState('');

  // File selections & local previews
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreviewUrl, setPosterPreviewUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('');

  // Upload state & per-file XHR progress
  const [isUploading, setIsUploading] = useState(false);
  const [posterProgress, setPosterProgress] = useState(0);
  const [videoProgress, setVideoProgress] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const posterInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  // Manage Titles inline edit / delete state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editYear, setEditYear] = useState('2026');
  const [editGenre, setEditGenre] = useState<MovieGenre>('Action');
  const [editCategory, setEditCategory] = useState<CategoryOption>('Movies');
  const [editAgeRating, setEditAgeRating] = useState('16+');
  const [editRuntime, setEditRuntime] = useState('2h 00m');
  const [editTrailerUrl, setEditTrailerUrl] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUploading) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isUploading, onClose]);

  useEffect(() => {
    return () => {
      if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl);
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [posterPreviewUrl, videoPreviewUrl]);

  if (!isOpen) return null;

  const handleSelectPoster = (file: File | undefined) => {
    if (!file) return;
    const err = validatePosterFile(file);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl);
    setPosterFile(file);
    setPosterPreviewUrl(URL.createObjectURL(file));
    setPosterProgress(0);
  };

  const handleSelectVideo = (file: File | undefined) => {
    if (!file) return;
    const err = validateVideoFile(file);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    const objUrl = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoPreviewUrl(objUrl);
    setVideoProgress(0);

    if (!title.trim()) {
      const cleanName = file.name
        .replace(/\.[^/.]+$/, '')
        .replace(/[._-]+/g, ' ')
        .trim();
      setTitle(cleanName);
    }

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = objUrl;
    probe.onloadedmetadata = () => {
      if (probe.duration && Number.isFinite(probe.duration)) {
        setRuntime((prev) => prev || formatDurationSeconds(probe.duration));
      }
    };
  };

  const resetUploadForm = () => {
    if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setTitle('');
    setDescription('');
    setYear(String(new Date().getFullYear()));
    setGenre('Action');
    setCategory('Movies');
    setAgeRating('16+');
    setRuntime('');
    setQuality('1080p HD');
    setTrailerUrl('');
    setPosterFile(null);
    setPosterPreviewUrl('');
    setVideoFile(null);
    setVideoPreviewUrl('');
    setPosterProgress(0);
    setVideoProgress(0);
    setFormError(null);
  };

  const handleCancelUpload = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsUploading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!cloudinaryConfig.isConfigured) {
      setFormError(
        `Cloudinary uploads are unavailable because ${cloudinaryConfig.missingVars.join(' and ')} ${
          cloudinaryConfig.missingVars.length === 1 ? 'is' : 'are'
        } not configured.`
      );
      return;
    }

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFormError('Please enter a movie title.');
      return;
    }

    if (!posterFile) {
      setFormError('Please select a poster image (JPG, PNG, or WEBP, max 5 MB).');
      return;
    }
    const posterValidationError = validatePosterFile(posterFile);
    if (posterValidationError) {
      setFormError(posterValidationError);
      return;
    }

    if (!videoFile) {
      setFormError('Please select a video file (MP4 or WEBM, max 100 MB).');
      return;
    }
    const videoValidationError = validateVideoFile(videoFile);
    if (videoValidationError) {
      setFormError(videoValidationError);
      return;
    }

    const parsedYear = Math.min(2035, Math.max(1900, Number(year) || new Date().getFullYear()));
    const cleanRuntime = runtime.trim() || '1h 45m';
    const cleanDescription =
      description.trim() ||
      `${cleanTitle} (${parsedYear}) — uploaded to Temple Cinema vault.`;
    const cleanTrailer = trailerUrl.trim();
    if (cleanTrailer && !/^https?:\/\//i.test(cleanTrailer)) {
      setFormError('Trailer URL must start with http:// or https://.');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsUploading(true);
    setPosterProgress(0);
    setVideoProgress(0);

    try {
      const [posterRes, videoRes] = await Promise.all([
        uploadToCloudinaryUnsigned(posterFile, {
          folder: 'temple-cinema/posters',
          onProgress: (pct) => setPosterProgress(pct),
          signal: controller.signal,
        }),
        uploadToCloudinaryUnsigned(videoFile, {
          folder: 'temple-cinema/videos',
          onProgress: (pct) => setVideoProgress(pct),
          signal: controller.signal,
        }),
      ]);

      const derivedRuntime =
        runtime.trim() ||
        (videoRes.duration && Number.isFinite(videoRes.duration)
          ? formatDurationSeconds(videoRes.duration)
          : cleanRuntime);

      const movieId = `movie-cld-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newMovie: Movie = {
        id: movieId,
        title: cleanTitle,
        genre,
        category,
        year: parsedYear,
        duration: derivedRuntime,
        quality,
        director: defaultUploader || 'TempleSolo Admin',
        uploader: defaultUploader || 'TempleSolo Admin',
        synopsis: cleanDescription,
        imdbRating: 8.2,
        ageRating,
        posterUrl: posterRes.secure_url,
        backdropUrl: posterRes.secure_url,
        ...(cleanTrailer ? { trailerUrl: cleanTrailer } : {}),
        videoUrl: videoRes.secure_url,
        fileName: videoFile.name || `${cleanTitle}.mp4`,
        fileSizeBytes: videoRes.bytes || videoFile.size,
        mimeType: videoFile.type || 'video/mp4',
        downloads: 0,
        featured: false,
        isSeeded: false,
        cloudinaryPublicId: videoRes.public_id,
        posterPublicId: posterRes.public_id,
        videoPublicId: videoRes.public_id,
        cloudinaryUploaded: true,
        createdAt: new Date().toISOString(),
      };

      onCreateMovie(newMovie);
      onNotify(`"${newMovie.title}" uploaded via Cloudinary and published to Home, Trending, and Search!`);
      resetUploadForm();
      setActiveTab('manage');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      abortControllerRef.current = null;
    }
  };

  const beginEdit = (movie: Movie) => {
    setEditingId(movie.id);
    setEditTitle(movie.title);
    setEditDescription(movie.synopsis);
    setEditYear(String(movie.year));
    setEditGenre(movie.genre);
    setEditCategory((movie.category as CategoryOption) || 'Movies');
    setEditAgeRating(movie.ageRating || '16+');
    setEditRuntime(movie.duration || '1h 45m');
    setEditTrailerUrl(movie.trailerUrl || '');
    setConfirmDeleteId(null);
  };

  const handleSaveEdit = async (movieId: string) => {
    if (!editTitle.trim()) return;
    setSavingEdit(true);
    try {
      await onEditMovie(movieId, {
        title: editTitle.trim(),
        synopsis: editDescription.trim() || editTitle.trim(),
        year: Math.min(2035, Math.max(1900, Number(editYear) || new Date().getFullYear())),
        genre: editGenre,
        category: editCategory,
        ageRating: editAgeRating,
        duration: editRuntime.trim() || '1h 45m',
        trailerUrl: editTrailerUrl.trim() || undefined,
      });
      setEditingId(null);
      onNotify(`Updated "${editTitle.trim()}".`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (movie: Movie) => {
    await onDeleteMovie(movie.id);
    setConfirmDeleteId(null);
    if (editingId === movie.id) setEditingId(null);
    onNotify(`Deleted "${movie.title}" from catalog.`);
  };

  const sortedManageMovies = [...movies].sort((a, b) => {
    const aCld = a.cloudinaryUploaded ? 1 : 0;
    const bCld = b.cloudinaryUploaded ? 1 : 0;
    if (aCld !== bCld) return bCld - aCld;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0C]/85 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-panel-title"
    >
      <div className="w-full max-w-3xl rounded-2xl border border-[#27272A] bg-[#111114] shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#27272A] px-5 py-4 bg-[#09090B]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E6A93C]/40 bg-[#E6A93C]/10 text-[#E6A93C]">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="admin-panel-title"
                className="font-display text-base sm:text-lg font-bold text-[#FAFAFA] truncate"
              >
                Admin Studio — Cloudinary Vault
              </h2>
              <p className="text-xs text-[#A1A1AA] truncate">
                Direct unsigned uploads to Cloudinary & catalog management
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isUploading}
            onClick={onClose}
            aria-label="Close Admin panel"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] disabled:opacity-40 cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-[#27272A] bg-[#09090B] px-5 py-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`min-h-[44px] inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-[#E6A93C] text-[#0A0A0C]'
                : 'border border-[#27272A] bg-[#111114] text-[#D4D4D8] hover:text-[#FAFAFA]'
            }`}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Upload Movie</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('manage')}
            className={`min-h-[44px] inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === 'manage'
                ? 'bg-[#E6A93C] text-[#0A0A0C]'
                : 'border border-[#27272A] bg-[#111114] text-[#D4D4D8] hover:text-[#FAFAFA]'
            }`}
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
            <span>Manage Titles ({movies.length})</span>
          </button>
        </div>

        {/* Tab 1: Upload Movie */}
        {activeTab === 'upload' && (
          <form
            onSubmit={handleSubmit}
            className="p-5 sm:p-6 space-y-5 max-h-[78vh] overflow-y-auto"
          >
            {!cloudinaryConfig.isConfigured && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-semibold text-amber-100">
                    Cloudinary environment variables not configured
                  </p>
                  <p className="text-amber-200/90 leading-relaxed">
                    Missing{' '}
                    <span className="font-mono text-amber-100">
                      {cloudinaryConfig.missingVars.join(', ')}
                    </span>
                    . Add them to your environment configuration (unsigned upload preset only — never expose API secret in the frontend) and reload to publish directly to Cloudinary.
                  </p>
                </div>
              </div>
            )}

            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            {/* Poster & Video Upload Pickers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Poster Image Upload (JPG/PNG/WEBP, max 5 MB) */}
              <div className="rounded-xl border border-[#27272A] bg-[#09090B] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#FAFAFA] flex items-center gap-1.5">
                    <ImageIcon className="h-4 w-4 text-[#E6A93C]" aria-hidden="true" />
                    Poster Image
                  </span>
                  <span className="font-mono text-[10px] text-[#71717A]">
                    JPG / PNG / WEBP · Max 5 MB
                  </span>
                </div>

                <input
                  ref={posterInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(e) => handleSelectPoster(e.target.files?.[0])}
                />

                <div
                  onClick={() => !isUploading && posterInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
                      e.preventDefault();
                      posterInputRef.current?.click();
                    }
                  }}
                  className="relative flex aspect-[16/10] w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-[#3F3F46] bg-[#111114] hover:border-[#E6A93C] transition-colors cursor-pointer"
                >
                  {posterPreviewUrl ? (
                    <img
                      src={posterPreviewUrl}
                      alt="Poster preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="p-4 text-center">
                      <ImageIcon className="mx-auto h-6 w-6 text-[#E6A93C] mb-1.5" aria-hidden="true" />
                      <p className="text-xs font-medium text-[#FAFAFA]">Tap to select poster</p>
                      <p className="text-[11px] text-[#71717A] mt-0.5">Up to 5 MB</p>
                    </div>
                  )}
                </div>

                {posterFile && (
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#A1A1AA]">
                    <span className="truncate">{posterFile.name}</span>
                    <span className="shrink-0">{formatFileSize(posterFile.size)}</span>
                  </div>
                )}

                {(isUploading || posterProgress > 0) && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#E6A93C]">
                      <span>Poster upload</span>
                      <span>{posterProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#27272A]">
                      <div
                        className="h-full bg-[#E6A93C] transition-all duration-150"
                        style={{ width: `${posterProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Video File Upload (MP4/WEBM, max 100 MB) */}
              <div className="rounded-xl border border-[#27272A] bg-[#09090B] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#FAFAFA] flex items-center gap-1.5">
                    <Video className="h-4 w-4 text-[#E6A93C]" aria-hidden="true" />
                    Video File
                  </span>
                  <span className="font-mono text-[10px] text-[#71717A]">
                    MP4 / WEBM · Max 100 MB
                  </span>
                </div>

                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/webm,.mp4,.webm"
                  className="hidden"
                  onChange={(e) => handleSelectVideo(e.target.files?.[0])}
                />

                {videoPreviewUrl ? (
                  <div className="space-y-2">
                    <div className="aspect-[16/10] w-full overflow-hidden rounded-lg border border-[#27272A] bg-black">
                      <video
                        src={videoPreviewUrl}
                        controls
                        playsInline
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => videoInputRef.current?.click()}
                      className="text-[11px] font-medium text-[#E6A93C] hover:underline disabled:opacity-40 cursor-pointer"
                    >
                      Choose a different video file
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => !isUploading && videoInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
                        e.preventDefault();
                        videoInputRef.current?.click();
                      }
                    }}
                    className="flex aspect-[16/10] w-full flex-col items-center justify-center rounded-lg border border-dashed border-[#3F3F46] bg-[#111114] hover:border-[#E6A93C] transition-colors cursor-pointer"
                  >
                    <Film className="h-6 w-6 text-[#E6A93C] mb-1.5" aria-hidden="true" />
                    <p className="text-xs font-medium text-[#FAFAFA]">Tap to select video</p>
                    <p className="text-[11px] text-[#71717A] mt-0.5">MP4 or WEBM · Up to 100 MB</p>
                  </div>
                )}

                {videoFile && (
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#A1A1AA]">
                    <span className="truncate">{videoFile.name}</span>
                    <span className="shrink-0">{formatFileSize(videoFile.size)}</span>
                  </div>
                )}

                {(isUploading || videoProgress > 0) && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#E6A93C]">
                      <span>Video upload</span>
                      <span>{videoProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#27272A]">
                      <div
                        className="h-full bg-[#E6A93C] transition-all duration-150"
                        style={{ width: `${videoProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Metadata Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="admin-movie-title"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Title *
                </label>
                <input
                  id="admin-movie-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Lagos Horizon"
                  className="min-h-[44px] w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E6A93C] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="admin-movie-trailer"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Optional Trailer URL
                </label>
                <div className="relative">
                  <LinkIcon
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#71717A]"
                    aria-hidden="true"
                  />
                  <input
                    id="admin-movie-trailer"
                    type="url"
                    value={trailerUrl}
                    onChange={(e) => setTrailerUrl(e.target.value)}
                    placeholder="https://..."
                    className="min-h-[44px] w-full rounded-lg border border-[#27272A] bg-[#09090B] pl-9 pr-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E6A93C] focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-movie-description"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                Description
              </label>
              <textarea
                id="admin-movie-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write a synopsis or description..."
                className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E6A93C] focus:outline-none resize-none"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label
                  htmlFor="admin-movie-year"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Year
                </label>
                <input
                  id="admin-movie-year"
                  type="number"
                  min={1900}
                  max={2035}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm font-mono tabular-nums text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="admin-movie-genre"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Genre
                </label>
                <select
                  id="admin-movie-genre"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value as MovieGenre)}
                  className="min-h-[44px] w-full rounded-lg border border-[#27272A] bg-[#09090B] px-2.5 py-2 text-sm text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
                >
                  {GENRES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="admin-movie-category"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Category
                </label>
                <select
                  id="admin-movie-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CategoryOption)}
                  className="min-h-[44px] w-full rounded-lg border border-[#27272A] bg-[#09090B] px-2.5 py-2 text-sm text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="admin-movie-age"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Age Rating
                </label>
                <select
                  id="admin-movie-age"
                  value={ageRating}
                  onChange={(e) => setAgeRating(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-[#27272A] bg-[#09090B] px-2.5 py-2 text-sm font-mono text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
                >
                  {AGE_RATINGS.map((rating) => (
                    <option key={rating} value={rating}>
                      {rating}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="admin-movie-runtime"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Runtime
                </label>
                <input
                  id="admin-movie-runtime"
                  type="text"
                  value={runtime}
                  onChange={(e) => setRuntime(e.target.value)}
                  placeholder="e.g. 2h 05m"
                  className="min-h-[44px] w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm font-mono text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E6A93C] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="admin-movie-quality"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Quality
                </label>
                <select
                  id="admin-movie-quality"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as MovieQuality)}
                  className="min-h-[44px] w-full rounded-lg border border-[#27272A] bg-[#09090B] px-2.5 py-2 text-sm text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
                >
                  <option value="4K UHD">4K UHD</option>
                  <option value="1080p HD">1080p HD</option>
                  <option value="720p HD">720p HD</option>
                </select>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-[#27272A]">
              {isUploading ? (
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="min-h-[44px] rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs sm:text-sm font-semibold text-red-200 hover:bg-red-500/20 cursor-pointer"
                >
                  Cancel Upload
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] rounded-xl border border-[#27272A] bg-[#18181B] px-4 py-2 text-xs sm:text-sm font-medium text-[#FAFAFA] hover:bg-[#27272A] cursor-pointer"
                >
                  Close
                </button>
              )}

              <button
                type="submit"
                disabled={isUploading || !cloudinaryConfig.isConfigured}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#E6A93C] px-5 py-2 text-xs sm:text-sm font-bold text-[#0A0A0C] hover:bg-[#F5C563] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>{isUploading ? 'Uploading to Cloudinary...' : 'Upload & Publish'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Manage Titles */}
        {activeTab === 'manage' && (
          <div className="p-5 sm:p-6 space-y-3 max-h-[78vh] overflow-y-auto">
            {sortedManageMovies.length === 0 ? (
              <div className="rounded-xl border border-[#27272A] bg-[#09090B] p-8 text-center">
                <Film className="mx-auto h-8 w-8 text-[#71717A] mb-2" aria-hidden="true" />
                <p className="text-sm font-semibold text-[#FAFAFA]">No titles in the vault yet</p>
                <p className="text-xs text-[#71717A] mt-1">
                  Switch to Upload Movie to publish your first Cloudinary release.
                </p>
              </div>
            ) : (
              sortedManageMovies.map((movie) => {
                const isEditing = editingId === movie.id;
                const isConfirmDelete = confirmDeleteId === movie.id;

                return (
                  <div
                    key={movie.id}
                    className="rounded-xl border border-[#27272A] bg-[#09090B] p-3.5 sm:p-4 space-y-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-[#18181B] border border-[#27272A]">
                        {movie.posterUrl ? (
                          <img
                            src={movie.posterUrl}
                            alt={movie.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Film className="h-4 w-4 text-[#71717A]" aria-hidden="true" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-sm font-semibold text-[#FAFAFA] truncate">
                            {movie.title}
                          </h3>
                          {movie.cloudinaryUploaded && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                              Cloudinary
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] font-mono text-[#A1A1AA] mt-0.5">
                          {movie.category || 'Movies'} · {movie.genre} · {movie.year} ·{' '}
                          {movie.ageRating || '16+'} · {movie.duration}
                        </p>

                        {(movie.videoPublicId || movie.posterPublicId || movie.cloudinaryPublicId) && (
                          <p className="text-[10px] font-mono text-[#71717A] mt-1 truncate">
                            public_id:{' '}
                            {movie.videoPublicId || movie.cloudinaryPublicId || movie.posterPublicId}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => (isEditing ? setEditingId(null) : beginEdit(movie))}
                          aria-label={`Edit ${movie.title}`}
                          className="min-h-[38px] inline-flex items-center gap-1 rounded-lg border border-[#27272A] bg-[#18181B] px-2.5 py-1.5 text-xs font-medium text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#FAFAFA] cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
                          <span className="hidden sm:inline">{isEditing ? 'Close' : 'Edit'}</span>
                        </button>

                        {!isConfirmDelete ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(movie.id)}
                            aria-label={`Delete ${movie.title}`}
                            className="min-h-[38px] inline-flex items-center gap-1 rounded-lg border border-[#27272A] bg-[#18181B] px-2.5 py-1.5 text-xs font-medium text-red-300 hover:border-red-500/50 hover:bg-red-500/10 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Delete</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void handleDelete(movie)}
                              className="min-h-[38px] rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500 cursor-pointer"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[38px] rounded-lg border border-[#27272A] bg-[#18181B] px-2.5 py-1.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {isEditing && (
                      <div className="border-t border-[#27272A] pt-3 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] text-[#A1A1AA] mb-1">Title</label>
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="min-h-[40px] w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-1.5 text-xs text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#A1A1AA] mb-1">
                              Trailer URL
                            </label>
                            <input
                              type="url"
                              value={editTrailerUrl}
                              onChange={(e) => setEditTrailerUrl(e.target.value)}
                              placeholder="https://..."
                              className="min-h-[40px] w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-1.5 text-xs text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] text-[#A1A1AA] mb-1">
                            Description
                          </label>
                          <textarea
                            rows={2}
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-1.5 text-xs text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none resize-none"
                          />
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                          <div>
                            <label className="block text-[11px] text-[#A1A1AA] mb-1">Year</label>
                            <input
                              type="number"
                              value={editYear}
                              onChange={(e) => setEditYear(e.target.value)}
                              className="min-h-[40px] w-full rounded-lg border border-[#27272A] bg-[#111114] px-2.5 py-1.5 text-xs font-mono text-[#FAFAFA]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#A1A1AA] mb-1">Genre</label>
                            <select
                              value={editGenre}
                              onChange={(e) => setEditGenre(e.target.value as MovieGenre)}
                              className="min-h-[40px] w-full rounded-lg border border-[#27272A] bg-[#111114] px-2 py-1.5 text-xs text-[#FAFAFA]"
                            >
                              {GENRES.map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#A1A1AA] mb-1">Category</label>
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value as CategoryOption)}
                              className="min-h-[40px] w-full rounded-lg border border-[#27272A] bg-[#111114] px-2 py-1.5 text-xs text-[#FAFAFA]"
                            >
                              {CATEGORY_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#A1A1AA] mb-1">
                              Age Rating
                            </label>
                            <select
                              value={editAgeRating}
                              onChange={(e) => setEditAgeRating(e.target.value)}
                              className="min-h-[40px] w-full rounded-lg border border-[#27272A] bg-[#111114] px-2 py-1.5 text-xs font-mono text-[#FAFAFA]"
                            >
                              {AGE_RATINGS.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#A1A1AA] mb-1">Runtime</label>
                            <input
                              type="text"
                              value={editRuntime}
                              onChange={(e) => setEditRuntime(e.target.value)}
                              className="min-h-[40px] w-full rounded-lg border border-[#27272A] bg-[#111114] px-2.5 py-1.5 text-xs font-mono text-[#FAFAFA]"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="min-h-[38px] rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-1.5 text-xs text-[#D4D4D8] cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={savingEdit}
                            onClick={() => void handleSaveEdit(movie.id)}
                            className="min-h-[38px] rounded-lg bg-[#E6A93C] px-4 py-1.5 text-xs font-bold text-[#0A0A0C] hover:bg-[#F5C563] disabled:opacity-50 cursor-pointer"
                          >
                            {savingEdit ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
