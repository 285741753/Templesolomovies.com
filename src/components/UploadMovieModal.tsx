import { useEffect, useRef, useState } from 'react';
import { Upload, X, Film, Image as ImageIcon, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { Movie, MovieGenre, MovieQuality } from '../types/cinema';
import { formatDurationSeconds, formatFileSize } from '../utils/format';

interface UploadMovieModalProps {
  isOpen: boolean;
  defaultUploader: string;
  onClose: () => void;
  onUploaded: (movie: Movie) => void;
}

const GENRES: MovieGenre[] = [
  'Action',
  'Nollywood',
  'Sci-Fi',
  'Drama',
  'Thriller',
  'Comedy',
  'Mystery',
  'Documentary',
  'Animation',
  'Horror',
];

const QUALITIES: MovieQuality[] = ['4K UHD', '1080p HD', '720p HD'];

export function UploadMovieModal({
  isOpen,
  defaultUploader,
  onClose,
  onUploaded,
}: UploadMovieModalProps) {
  const { getIdToken } = useAuth();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreviewUrl, setPosterPreviewUrl] = useState<string>('');
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState<MovieGenre>('Action');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quality, setQuality] = useState<MovieQuality>('1080p HD');
  const [duration, setDuration] = useState('');
  const [director, setDirector] = useState('');
  const [uploader, setUploader] = useState(defaultUploader || 'TempleSolo');
  const [imdbRating, setImdbRating] = useState('7.8');
  const [synopsis, setSynopsis] = useState('');

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const posterInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (defaultUploader) {
      setUploader(defaultUploader);
    }
  }, [defaultUploader]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUploading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, isUploading, onClose]);

  if (!isOpen) return null;

  const inspectVideoFile = (file: File) => {
    setVideoFile(file);
    setError('');

    if (!title.trim()) {
      const cleanName = file.name
        .replace(/\.[^/.]+$/, '')
        .replace(/[._-]+/g, ' ')
        .trim();
      setTitle(cleanName);
    }

    const objectUrl = URL.createObjectURL(file);
    const probeVideo = document.createElement('video');
    probeVideo.preload = 'metadata';
    probeVideo.muted = true;
    probeVideo.src = objectUrl;

    probeVideo.onloadedmetadata = () => {
      if (probeVideo.duration && Number.isFinite(probeVideo.duration)) {
        setDuration((prev) => prev || formatDurationSeconds(probeVideo.duration));
        probeVideo.currentTime = Math.min(2, probeVideo.duration / 2);
      } else {
        URL.revokeObjectURL(objectUrl);
      }
    };

    probeVideo.onseeked = () => {
      try {
        if (!posterFile && probeVideo.videoWidth > 0 && probeVideo.videoHeight > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = probeVideo.videoWidth;
          canvas.height = probeVideo.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(probeVideo, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
              (blob) => {
                if (blob) {
                  const captured = new File([blob], 'captured-poster.jpg', {
                    type: 'image/jpeg',
                  });
                  setPosterFile(captured);
                  setPosterPreviewUrl(URL.createObjectURL(captured));
                }
                URL.revokeObjectURL(objectUrl);
              },
              'image/jpeg',
              0.88
            );
            return;
          }
        }
      } catch {
        // Ignore frame capture errors on unsupported codecs
      }
      URL.revokeObjectURL(objectUrl);
    };

    probeVideo.onerror = () => {
      URL.revokeObjectURL(objectUrl);
    };
  };

  const handlePosterSelect = (file: File) => {
    setPosterFile(file);
    setPosterPreviewUrl(URL.createObjectURL(file));
  };

  const resetForm = () => {
    setVideoFile(null);
    setPosterFile(null);
    setPosterPreviewUrl('');
    setTitle('');
    setGenre('Action');
    setYear(String(new Date().getFullYear()));
    setQuality('1080p HD');
    setDuration('');
    setDirector('');
    setImdbRating('7.8');
    setSynopsis('');
    setUploadProgress(0);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) {
      setError('Please select a movie video file to upload.');
      return;
    }
    if (!title.trim()) {
      setError('Please enter a movie title.');
      return;
    }

    setError('');
    setIsUploading(true);
    setUploadProgress(0);

    const token = await getIdToken();

    const formData = new FormData();
    formData.append('video', videoFile);
    if (posterFile) {
      formData.append('poster', posterFile);
    }
    formData.append('title', title.trim());
    formData.append('genre', genre);
    formData.append('year', year.trim() || String(new Date().getFullYear()));
    formData.append('quality', quality);
    formData.append('duration', duration.trim() || '1h 45m');
    formData.append('director', director.trim() || 'Independent');
    formData.append('uploader', uploader.trim() || defaultUploader || 'Community');
    formData.append('imdbRating', imdbRating.trim() || '7.8');
    formData.append('synopsis', synopsis.trim());

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/movies', true);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as { movie: Movie };
          onUploaded(parsed.movie);
          resetForm();
          onClose();
        } catch {
          setError('Unexpected response from upload server.');
        }
      } else {
        try {
          const errObj = JSON.parse(xhr.responseText) as { error?: string };
          setError(errObj.error || 'Movie upload failed. Please try again.');
        } catch {
          setError('Movie upload failed. Please try again.');
        }
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      setError('Network error while uploading movie file.');
    };

    xhr.send(formData);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#09090B]/85 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-[#27272A] bg-[#111114] shadow-2xl overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#27272A] px-6 py-4">
          <div>
            <h2
              id="upload-modal-title"
              className="font-display text-lg font-semibold text-[#FAFAFA]"
            >
              Upload Movie to templesolosmovies.com
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-0.5">
              Add a movie file so visitors can stream previews and download copies.
            </p>
          </div>

          <button
            type="button"
            disabled={isUploading}
            onClick={onClose}
            aria-label="Close upload modal"
            className="rounded-lg p-2 text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] disabled:opacity-40 cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200"
            >
              {error}
            </div>
          )}

          {/* Video File Dropzone */}
          <div>
            <label className="block text-xs font-medium text-[#D4D4D8] mb-2">
              Movie Video File (MP4, MKV, WEBM, MOV, AVI)
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) inspectVideoFile(dropped);
              }}
              onClick={() => videoInputRef.current?.click()}
              className={`flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-7 text-center transition-colors cursor-pointer ${
                isDragging
                  ? 'border-[#E5A93B] bg-[#E5A93B]/10'
                  : videoFile
                  ? 'border-emerald-500/50 bg-[#18181B]'
                  : 'border-[#3F3F46] bg-[#09090B] hover:border-[#E5A93B]'
              }`}
            >
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*,.mkv,.avi,.mov,.mp4,.webm"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (selected) inspectVideoFile(selected);
                }}
              />

              {videoFile ? (
                <>
                  <CheckCircle2
                    className="h-7 w-7 text-emerald-400 mb-2"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium text-[#FAFAFA] break-all">
                    {videoFile.name}
                  </p>
                  <p className="text-xs font-mono tabular-nums text-[#A1A1AA] mt-1">
                    {formatFileSize(videoFile.size)} · Click to choose a different file
                  </p>
                </>
              ) : (
                <>
                  <Upload className="h-7 w-7 text-[#E5A93B] mb-2" aria-hidden="true" />
                  <p className="text-sm font-medium text-[#FAFAFA]">
                    Drop a movie file here, or click to browse
                  </p>
                  <p className="text-xs text-[#71717A] mt-1">
                    Supports high-definition uploads up to 2 GB
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Title & Poster */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-4">
              <div>
                <label
                  htmlFor="movie-title"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Movie Title
                </label>
                <input
                  id="movie-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. The Last Horizon"
                  className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="movie-genre"
                    className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                  >
                    Genre
                  </label>
                  <select
                    id="movie-genre"
                    value={genre}
                    onChange={(e) => setGenre(e.target.value as MovieGenre)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
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
                    htmlFor="movie-quality"
                    className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                  >
                    Quality
                  </label>
                  <select
                    id="movie-quality"
                    value={quality}
                    onChange={(e) => setQuality(e.target.value as MovieQuality)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  >
                    {QUALITIES.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Optional Poster Box */}
            <div>
              <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                Poster Cover (Optional)
              </label>
              <div
                onClick={() => posterInputRef.current?.click()}
                className="relative flex aspect-[3/4] max-h-36 sm:max-h-full w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-[#27272A] bg-[#09090B] hover:border-[#E5A93B] cursor-pointer"
              >
                <input
                  ref={posterInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePosterSelect(f);
                  }}
                />
                {posterPreviewUrl ? (
                  <img
                    src={posterPreviewUrl}
                    alt="Selected poster preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="p-3 text-center">
                    <ImageIcon
                      className="mx-auto h-5 w-5 text-[#71717A] mb-1"
                      aria-hidden="true"
                    />
                    <span className="block text-[11px] text-[#71717A]">
                      Auto-captured or upload image
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Year, Runtime, Director, IMDb, Uploader */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label
                htmlFor="movie-year"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                Release Year
              </label>
              <input
                id="movie-year"
                type="number"
                min={1900}
                max={2030}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm font-mono tabular-nums text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="movie-duration"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                Runtime
              </label>
              <input
                id="movie-duration"
                type="text"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="e.g. 2h 05m"
                className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm font-mono text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="movie-director"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                Director
              </label>
              <input
                id="movie-director"
                type="text"
                value={director}
                onChange={(e) => setDirector(e.target.value)}
                placeholder="Director name"
                className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="movie-imdb"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                IMDb Rating
              </label>
              <input
                id="movie-imdb"
                type="number"
                min={1.0}
                max={10.0}
                step={0.1}
                value={imdbRating}
                onChange={(e) => setImdbRating(e.target.value)}
                className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm font-mono tabular-nums text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label
                htmlFor="movie-uploader"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                Uploaded By
              </label>
              <input
                id="movie-uploader"
                type="text"
                value={uploader}
                onChange={(e) => setUploader(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
              />
            </div>
          </div>

          {/* Synopsis */}
          <div>
            <label
              htmlFor="movie-synopsis"
              className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
            >
              Synopsis
            </label>
            <textarea
              id="movie-synopsis"
              rows={3}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="Write a brief overview of the film..."
              className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none resize-none"
            />
          </div>

          {/* Upload Progress */}
          {isUploading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono tabular-nums text-[#D4D4D8]">
                <span>Uploading movie file to vault...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#27272A]">
                <div
                  className="h-full bg-[#E5A93B] transition-all duration-150"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#27272A]">
            <button
              type="button"
              disabled={isUploading}
              onClick={onClose}
              className="rounded-lg border border-[#27272A] bg-[#18181B] px-4 py-2 text-sm font-medium text-[#FAFAFA] hover:bg-[#27272A] disabled:opacity-40 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-5 py-2 text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-50 cursor-pointer"
            >
              <Film className="h-4 w-4" aria-hidden="true" />
              <span>{isUploading ? 'Uploading...' : 'Publish Movie'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
