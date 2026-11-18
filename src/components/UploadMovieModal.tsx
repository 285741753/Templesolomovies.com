import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Film,
  Image as ImageIcon,
  Link as LinkIcon,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  compressPosterIfNeeded,
  getCloudinaryConfig,
  resolveApiUrl,
  saveLocalCloudinaryConfig,
  uploadToCloudinaryUnsigned,
} from '../services/cloudinary';
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
  'Music',
  'Drama',
  'Thriller',
  'Comedy',
  'Mystery',
  'Documentary',
  'Animation',
  'Horror',
];

const QUALITIES: MovieQuality[] = ['4K UHD', '1080p HD', '720p HD'];

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const DEFAULT_CHUNK_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB default chunks
const FALLBACK_CHUNK_SIZE_BYTES = 768 * 1024; // 768 KB fallback if reverse proxy enforces 1 MB cap
const ALLOWED_VIDEO_EXTS = /\.(mp4|webm|mkv|mov|m4v)$/i;
const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/x-matroska',
  'video/matroska',
  'video/quicktime',
  'video/3gpp',
  'video/x-m4v',
]);
const ALLOWED_POSTER_EXTS = /\.(jpe?g|png|webp)$/i;
const ALLOWED_POSTER_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

class StaticHostUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaticHostUploadError';
  }
}

class UploadHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'UploadHttpError';
    this.status = status;
  }
}

function validateSelectedVideoFile(file: File): string | null {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('image/')) {
    return 'Please choose a video file (images are not allowed here).';
  }
  const hasValidExt = ALLOWED_VIDEO_EXTS.test(file.name || '');
  const hasValidMime = mime.startsWith('video/') || ALLOWED_VIDEO_MIMES.has(mime);
  if (!hasValidExt && !hasValidMime) {
    return 'Please choose a video file (MP4, WEBM, MKV, MOV, or M4V).';
  }
  if (file.size <= 0) {
    return 'The selected video file is empty.';
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return `Video file is too large (${formatFileSize(file.size)}). Maximum allowed is 2 GB.`;
  }
  return null;
}

function validateSelectedPosterFile(file: File): string | null {
  const mime = (file.type || '').toLowerCase();
  const hasValidExt = ALLOWED_POSTER_EXTS.test(file.name || '');
  const hasValidMime = ALLOWED_POSTER_MIMES.has(mime);
  if (!hasValidExt && !hasValidMime) {
    return 'Poster must be a JPG, PNG, or WEBP image file.';
  }
  if (file.size > 10 * 1024 * 1024) {
    return `Poster image is too large (${formatFileSize(file.size)}). Maximum allowed is 10 MB.`;
  }
  return null;
}

function mapHttpStatusFallback(status: number, rawText: string): string {
  if (status === 413) {
    return 'File chunk exceeded proxy body size limit (HTTP 413 Payload Too Large).';
  }
  if (status === 401) {
    return 'Administrator sign-in expired (HTTP 401). Please log in again and retry.';
  }
  if (status === 403) {
    return 'Access denied (HTTP 403): Only the administrator account can upload movies.';
  }
  if (status === 404) {
    return 'Upload endpoint or session not found (HTTP 404). Please retry.';
  }
  if (status >= 502 && status <= 504) {
    return `Server gateway timeout or temporary unavailability (HTTP ${status}). Please try again.`;
  }
  const cleanSnippet = rawText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  return cleanSnippet
    ? `Upload failed (HTTP ${status}): ${cleanSnippet}`
    : `Upload failed with server status HTTP ${status}.`;
}

function isSpaHtmlFallback(status: number, contentType: string, rawText: string): boolean {
  if (!contentType.includes('text/html')) {
    return status === 404 || status === 405;
  }
  // Never misclassify proxy 413/5xx HTML error pages as a static host
  if (status === 413 || status >= 500) {
    return false;
  }
  return status === 200 || status === 404 || status === 405 || rawText.includes('<div id="root">');
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawText = await res.text();

  if (contentType.includes('application/json')) {
    let parsed: (T & { error?: string }) | null = null;
    try {
      parsed = JSON.parse(rawText || '{}') as T & { error?: string };
    } catch {
      throw new UploadHttpError(res.status, `Upload server returned malformed JSON (HTTP ${res.status}).`);
    }
    if (!res.ok) {
      throw new UploadHttpError(res.status, parsed?.error || mapHttpStatusFallback(res.status, rawText));
    }
    return parsed as T;
  }

  if (isSpaHtmlFallback(res.status, contentType, rawText)) {
    throw new StaticHostUploadError(
      'Static hosting detected (no Node upload server at /api/movies).'
    );
  }

  throw new UploadHttpError(
    res.status || 500,
    res.ok
      ? `Upload server returned non-JSON response (${contentType || 'unknown content type'}).`
      : mapHttpStatusFallback(res.status, rawText)
  );
}

function sendXhrFormData<T>(params: {
  url: string;
  formData: FormData;
  token: string | null;
  signal: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<T> {
  const { url, formData, token, signal, onProgress } = params;

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        // Ignore abort errors
      }
      fail(new Error('Upload cancelled.'));
    };

    if (signal.aborted) {
      fail(new Error('Upload cancelled.'));
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    xhr.open('POST', url, true);
    xhr.timeout = 120_000;
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();

      const contentType = (xhr.getResponseHeader('content-type') || '').toLowerCase();
      const rawText = xhr.responseText || '';

      if (!contentType.includes('application/json')) {
        if (isSpaHtmlFallback(xhr.status, contentType, rawText)) {
          reject(
            new StaticHostUploadError(
              'Static hosting detected (no Node upload server at /api/movies).'
            )
          );
          return;
        }
        reject(
          new UploadHttpError(
            xhr.status || 500,
            xhr.status >= 200 && xhr.status < 300
              ? `Upload server returned non-JSON response (${contentType || 'text/html'}).`
              : mapHttpStatusFallback(xhr.status, rawText)
          )
        );
        return;
      }

      let parsed: (T & { error?: string }) | null = null;
      try {
        parsed = JSON.parse(rawText || '{}') as T & { error?: string };
      } catch {
        reject(new UploadHttpError(xhr.status, `Upload server returned unreadable JSON (HTTP ${xhr.status}).`));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as T);
      } else {
        reject(new UploadHttpError(xhr.status, parsed?.error || mapHttpStatusFallback(xhr.status, rawText)));
      }
    };

    xhr.onerror = () => {
      fail(new Error('Network connection dropped while uploading. Check your internet connection and retry.'));
    };

    xhr.ontimeout = () => {
      fail(new Error('Upload request timed out (120s). Check your connection and try again.'));
    };

    xhr.onabort = () => {
      fail(new Error('Upload cancelled.'));
    };

    xhr.send(formData);
  });
}

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
  const [country, setCountry] = useState('Nigeria');
  const [category, setCategory] = useState<
    'Movies' | 'Series' | 'Music' | 'Anime' | 'Nollywood' | 'K-Drama'
  >('Movies');
  const [trailerUrl, setTrailerUrl] = useState('');
  const [synopsis, setSynopsis] = useState('');

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [error, setError] = useState('');
  const [needsCloudSetup, setNeedsCloudSetup] = useState(false);
  const [cloudNameInput, setCloudNameInput] = useState(() => getCloudinaryConfig().cloudName);
  const [cloudPresetInput, setCloudPresetInput] = useState(() => getCloudinaryConfig().uploadPreset);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const posterInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const { setBusyActivity } = usePWAInstall();

  // Keep the browser tab alive and warn before closing mid-upload
  useEffect(() => {
    setBusyActivity('upload', isUploading);
    if (!isUploading) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'A movie upload is currently in progress. Leaving now will cancel the upload.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      setBusyActivity('upload', false);
    };
  }, [isUploading, setBusyActivity]);

  if (!isOpen) return null;

  const inspectVideoFile = (file: File) => {
    const validationError = validateSelectedVideoFile(file);
    if (validationError) {
      setError(validationError);
      if (videoInputRef.current) videoInputRef.current.value = '';
      return;
    }

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
    const posterErr = validateSelectedPosterFile(file);
    if (posterErr) {
      setError(posterErr);
      if (posterInputRef.current) posterInputRef.current.value = '';
      return;
    }
    setError('');
    if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl);
    setPosterFile(file);
    setPosterPreviewUrl(URL.createObjectURL(file));
  };

  const resetForm = () => {
    if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl);
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
    setCountry('Nigeria');
    setCategory('Movies');
    setTrailerUrl('');
    setSynopsis('');
    setUploadProgress(0);
    setUploadStatusText('');
    setError('');
  };

  const handleCancelUpload = () => {
    abortControllerRef.current?.abort();
  };

  const appendMetadataFields = (formData: FormData) => {
    formData.append('title', title.trim());
    formData.append('genre', genre);
    formData.append('year', year.trim() || String(new Date().getFullYear()));
    formData.append('quality', quality);
    formData.append('duration', duration.trim() || '1h 45m');
    formData.append('director', director.trim() || 'Independent');
    formData.append('uploader', uploader.trim() || defaultUploader || 'Community');
    formData.append('imdbRating', imdbRating.trim() || '7.8');
    if (country.trim()) formData.append('country', country.trim());
    formData.append('category', category);
    if (trailerUrl.trim()) formData.append('trailerUrl', trailerUrl.trim());
    formData.append('synopsis', synopsis.trim());
  };

  const uploadViaCloudinaryFallback = async (
    signal: AbortSignal,
    fileToUpload: File
  ): Promise<Movie> => {
    const cleanTitle = title.trim();
    const parsedYear = Math.min(2035, Math.max(1900, Number(year) || new Date().getFullYear()));
    const cleanDuration = duration.trim() || '1h 45m';
    const cleanDirector = director.trim() || 'Independent';
    const cleanUploader = uploader.trim() || defaultUploader || 'TempleSolo';

    let posterUrl = '/storage/posters/midnight_meridian_poster.jpg';
    let posterPublicId: string | undefined;

    if (posterFile) {
      setUploadStatusText('Uploading poster to Cloudinary...');
      const pRes = await uploadToCloudinaryUnsigned(posterFile, {
        folder: 'temple-cinema/posters',
        signal,
        onProgress: (pct) => setUploadProgress(Math.min(10, Math.round(pct * 0.1))),
      });
      posterUrl = pRes.secure_url;
      posterPublicId = pRes.public_id;
    }

    setUploadStatusText('Uploading movie directly to Cloudinary...');
    const vRes = await uploadToCloudinaryUnsigned(fileToUpload, {
      folder: 'temple-cinema/videos',
      signal,
      onProgress: (pct) => {
        const base = posterFile ? 10 : 0;
        const span = posterFile ? 90 : 100;
        setUploadProgress(Math.min(99, Math.round(base + (pct / 100) * span)));
      },
    });

    const finalDuration =
      duration.trim() ||
      (vRes.duration && Number.isFinite(vRes.duration)
        ? formatDurationSeconds(vRes.duration)
        : cleanDuration);

    return {
      id: `movie-cld-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: cleanTitle,
      genre,
      category,
      country: country.trim() || undefined,
      year: parsedYear,
      duration: finalDuration,
      quality,
      director: cleanDirector,
      uploader: cleanUploader,
      synopsis:
        synopsis.trim() ||
        `${cleanTitle} (${parsedYear}) — uploaded to Temple Cinema vault.`,
      imdbRating: Number.isFinite(Number(imdbRating))
        ? Math.round(Math.min(10, Math.max(1, Number(imdbRating))) * 10) / 10
        : 7.8,
      ageRating: '16+',
      posterUrl,
      backdropUrl: posterUrl,
      ...(trailerUrl.trim() ? { trailerUrl: trailerUrl.trim() } : {}),
      videoUrl: vRes.secure_url,
      fileName: fileToUpload.name || `${cleanTitle}.mp4`,
      fileSizeBytes: vRes.bytes || fileToUpload.size,
      mimeType: fileToUpload.type || 'video/mp4',
      downloads: 0,
      featured: false,
      isSeeded: false,
      cloudinaryPublicId: vRes.public_id,
      posterPublicId,
      videoPublicId: vRes.public_id,
      cloudinaryUploaded: true,
      createdAt: new Date().toISOString(),
    };
  };

  const handleSaveCloudSetup = () => {
    const cleanCloud = cloudNameInput.trim();
    const cleanPreset = cloudPresetInput.trim();
    if (!cleanCloud || !cleanPreset) {
      setError('Enter both your public Cloudinary Cloud Name and Unsigned Upload Preset.');
      return;
    }
    saveLocalCloudinaryConfig(cleanCloud, cleanPreset);
    setNeedsCloudSetup(false);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) {
      setError('Please choose a video file to upload.');
      return;
    }
    const videoValidationErr = validateSelectedVideoFile(videoFile);
    if (videoValidationErr) {
      setError(videoValidationErr);
      return;
    }
    if (!title.trim()) {
      setError('Please enter a movie title.');
      return;
    }
    if (trailerUrl.trim() && !/^https?:\/\//i.test(trailerUrl.trim())) {
      setError('Trailer URL must start with http:// or https://.');
      return;
    }

    const token = await getIdToken();
    if (!token) {
      setError('Please sign in with the administrator account to upload movies.');
      return;
    }

    setError('');
    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatusText('Preparing upload...');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Request Screen Wake Lock so mobile devices stay awake during large uploads
    let wakeLock: { release?: () => Promise<void> } | null = null;
    try {
      const navWithWake = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<{ release?: () => Promise<void> }> };
      };
      if (navWithWake.wakeLock) {
        wakeLock = await navWithWake.wakeLock.request('screen').catch(() => null);
      }
    } catch {
      wakeLock = null;
    }

    let createdUploadId: string | null = null;

    try {
      const preparedPoster = posterFile ? await compressPosterIfNeeded(posterFile, 750 * 1024) : null;

      const runChunkedUpload = async (chunkSizeBytes: number): Promise<Movie> => {
        const totalChunks = Math.ceil(videoFile.size / chunkSizeBytes);
        const initRes = await fetch(resolveApiUrl('/api/movies/chunked/init'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            fileName: videoFile.name,
            mimeType: videoFile.type || 'video/mp4',
            fileSizeBytes: videoFile.size,
            totalChunks,
          }),
        });
        const initData = await parseJsonResponse<{ uploadId: string }>(initRes);
        createdUploadId = initData.uploadId;

        for (let i = 0; i < totalChunks; i += 1) {
          if (controller.signal.aborted) {
            throw new Error('Upload cancelled.');
          }

          const start = i * chunkSizeBytes;
          const end = Math.min(videoFile.size, start + chunkSizeBytes);
          const chunkBlob = videoFile.slice(start, end);

          let chunkSuccess = false;
          let lastChunkError: Error | null = null;

          for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
              setUploadStatusText(
                attempt > 1
                  ? `Retrying part ${i + 1} of ${totalChunks} (attempt ${attempt})...`
                  : `Uploading part ${i + 1} of ${totalChunks}...`
              );

              const chunkForm = new FormData();
              chunkForm.append('chunkIndex', String(i));
              chunkForm.append('chunk', chunkBlob, `${videoFile.name}.part${i}`);

              const forceRefresh = attempt > 1;
              const freshToken = (await getIdToken(forceRefresh)) || token;
              await sendXhrFormData<{ received: boolean }>({
                url: resolveApiUrl(
                  `/api/movies/chunked/${encodeURIComponent(createdUploadId!)}/part?chunkIndex=${i}`
                ),
                formData: chunkForm,
                token: freshToken,
                signal: controller.signal,
                onProgress: (loaded, total) => {
                  const chunkFraction = total > 0 ? loaded / total : 0;
                  const overallFraction = (i + chunkFraction) / totalChunks;
                  setUploadProgress(Math.min(95, Math.round(overallFraction * 95)));
                },
              });
              chunkSuccess = true;
              break;
            } catch (chunkErr) {
              if (controller.signal.aborted) {
                throw chunkErr;
              }
              if (
                chunkErr instanceof UploadHttpError &&
                chunkErr.status === 413 &&
                chunkSizeBytes > FALLBACK_CHUNK_SIZE_BYTES
              ) {
                throw chunkErr;
              }
              if (chunkErr instanceof UploadHttpError && chunkErr.status === 401 && attempt === 1) {
                await getIdToken(true);
              }
              lastChunkError =
                chunkErr instanceof Error ? chunkErr : new Error('Chunk upload failed.');
              await new Promise((r) => setTimeout(r, 700 * attempt));
            }
          }

          if (!chunkSuccess) {
            throw lastChunkError || new Error(`Failed uploading part ${i + 1} of ${totalChunks}.`);
          }
        }

        setUploadStatusText('Finalizing movie file on server...');
        setUploadProgress(96);

        const completeForm = new FormData();
        if (preparedPoster) {
          completeForm.append('poster', preparedPoster);
        }
        appendMetadataFields(completeForm);

        const finalToken = (await getIdToken(true)) || token;
        const completed = await sendXhrFormData<{ movie: Movie }>({
          url: resolveApiUrl(`/api/movies/chunked/${encodeURIComponent(createdUploadId)}/complete`),
          formData: completeForm,
          token: finalToken,
          signal: controller.signal,
        });
        createdUploadId = null;
        return completed.movie;
      };

      // Small videos <= 2 MB try direct single request first; auto-fallback to chunked if proxy returns 413
      if (videoFile.size <= DEFAULT_CHUNK_SIZE_BYTES) {
        try {
          setUploadStatusText('Uploading movie file...');
          const formData = new FormData();
          formData.append('video', videoFile);
          if (preparedPoster) {
            formData.append('poster', preparedPoster);
          }
          appendMetadataFields(formData);

          const parsed = await sendXhrFormData<{ movie: Movie }>({
            url: resolveApiUrl('/api/movies'),
            formData,
            token,
            signal: controller.signal,
            onProgress: (loaded, total) => {
              if (total > 0) {
                setUploadProgress(Math.min(99, Math.round((loaded / total) * 100)));
              }
            },
          });
          setUploadProgress(100);
          onUploaded(parsed.movie);
          resetForm();
          onClose();
          return;
        } catch (directErr) {
          if (directErr instanceof UploadHttpError && directErr.status === 413) {
            setUploadStatusText('Switching to smaller proxy-safe chunks...');
            const fallbackMovie = await runChunkedUpload(FALLBACK_CHUNK_SIZE_BYTES);
            setUploadProgress(100);
            setUploadStatusText('Upload complete!');
            onUploaded(fallbackMovie);
            resetForm();
            onClose();
            return;
          }
          throw directErr;
        }
      }

      // Chunked transfer for files > 2 MB (automatically adapts down to 768 KB on HTTP 413)
      let movie: Movie;
      try {
        movie = await runChunkedUpload(DEFAULT_CHUNK_SIZE_BYTES);
      } catch (chunkedErr) {
        if (chunkedErr instanceof UploadHttpError && chunkedErr.status === 413) {
          if (createdUploadId) {
            void fetch(resolveApiUrl(`/api/movies/chunked/${encodeURIComponent(createdUploadId)}/abort`), {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
            createdUploadId = null;
          }
          setUploadProgress(0);
          setUploadStatusText('Retrying with 768 KB proxy-safe chunks...');
          movie = await runChunkedUpload(FALLBACK_CHUNK_SIZE_BYTES);
        } else {
          throw chunkedErr;
        }
      }

      setUploadProgress(100);
      setUploadStatusText('Upload complete!');
      onUploaded(movie);
      resetForm();
      onClose();
    } catch (err) {
      if (createdUploadId) {
        void fetch(resolveApiUrl(`/api/movies/chunked/${encodeURIComponent(createdUploadId)}/abort`), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }

      if (err instanceof StaticHostUploadError) {
        const cloudCfg = getCloudinaryConfig();
        if (cloudCfg.isConfigured) {
          try {
            const cloudMovie = await uploadViaCloudinaryFallback(controller.signal, videoFile);
            setUploadProgress(100);
            setUploadStatusText('Upload complete!');
            onUploaded(cloudMovie);
            resetForm();
            onClose();
            return;
          } catch (cloudErr) {
            setError(
              cloudErr instanceof Error
                ? cloudErr.message
                : 'Cloudinary upload failed. Please try again.'
            );
            return;
          }
        } else {
          setNeedsCloudSetup(true);
          setError(
            'This site host has no Node upload backend at /api/movies. Enter your public Cloudinary Cloud Name and Unsigned Upload Preset below to upload directly from your browser.'
          );
          return;
        }
      }

      console.error('[UploadMovieModal] Upload failed:', err);
      setError(err instanceof Error ? err.message : 'Movie upload failed. Please try again.');
    } finally {
      abortControllerRef.current = null;
      setIsUploading(false);
      try {
        await wakeLock?.release?.();
      } catch {
        // Ignore WakeLock release errors
      }
    }
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
              Add a movie file (MP4, WEBM, MKV, MOV up to 2 GB) for streaming and download.
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
              className="flex items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {needsCloudSetup && (
            <div className="rounded-lg border border-[#E5A93B]/45 bg-[#09090B] p-3.5 space-y-2.5 text-xs">
              <p className="font-semibold text-[#E5A93B]">
                Direct Cloudinary Setup (Unsigned Preset Only — No API Key Required)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={cloudNameInput}
                  onChange={(e) => setCloudNameInput(e.target.value)}
                  placeholder="Cloud Name (e.g. my-cinema)"
                  aria-label="Cloudinary Cloud Name"
                  className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-xs text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                />
                <input
                  type="text"
                  value={cloudPresetInput}
                  onChange={(e) => setCloudPresetInput(e.target.value)}
                  placeholder="Unsigned Upload Preset"
                  aria-label="Cloudinary Unsigned Upload Preset"
                  className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-xs text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveCloudSetup}
                  className="rounded-lg bg-[#E5A93B] px-3.5 py-1.5 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
                >
                  Save & Continue Upload
                </button>
              </div>
            </div>
          )}

          {/* Video File Dropzone */}
          <div>
            <label className="block text-xs font-medium text-[#D4D4D8] mb-2">
              Movie Video File (MP4, WEBM, MKV, MOV)
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!isUploading) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (isUploading) return;
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) inspectVideoFile(dropped);
              }}
              onClick={() => !isUploading && videoInputRef.current?.click()}
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
                accept="video/*,.mp4,.webm,.mkv,.mov,.m4v"
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
                    {formatFileSize(videoFile.size)} · Click to choose a different video
                  </p>
                </>
              ) : (
                <>
                  <Upload className="h-7 w-7 text-[#E5A93B] mb-2" aria-hidden="true" />
                  <p className="text-sm font-medium text-[#FAFAFA]">
                    Drop a video file here, or click to browse
                  </p>
                  <p className="text-xs text-[#71717A] mt-1">
                    MP4, WEBM, MKV, or MOV · Chunked transfer supports up to 2 GB
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
                onClick={() => !isUploading && posterInputRef.current?.click()}
                className="relative flex aspect-[3/4] max-h-36 sm:max-h-full w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-[#27272A] bg-[#09090B] hover:border-[#E5A93B] cursor-pointer"
              >
                <input
                  ref={posterInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
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
                      Auto-captured or JPG/PNG/WEBP
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="movie-country"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                Country
              </label>
              <input
                id="movie-country"
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Nigeria, USA, UK..."
                className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="movie-category"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                Catalog Category
              </label>
              <select
                id="movie-category"
                value={category}
                onChange={(e) =>
                  setCategory(
                    e.target.value as
                      | 'Movies'
                      | 'Series'
                      | 'Music'
                      | 'Anime'
                      | 'Nollywood'
                      | 'K-Drama'
                  )
                }
                className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
              >
                <option value="Movies">Movies</option>
                <option value="Series">Series</option>
                <option value="Music">Music</option>
                <option value="Nollywood">Nollywood</option>
                <option value="Anime">Anime</option>
                <option value="K-Drama">K-Drama</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="movie-trailer-url"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                Trailer URL (YouTube)
              </label>
              <div className="relative">
                <LinkIcon
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#71717A]"
                  aria-hidden="true"
                />
                <input
                  id="movie-trailer-url"
                  type="url"
                  value={trailerUrl}
                  onChange={(e) => setTrailerUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="w-full rounded-lg border border-[#27272A] bg-[#09090B] pl-9 pr-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                />
              </div>
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
            <div className="rounded-lg border border-[#E5A93B]/30 bg-[#09090B] p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono tabular-nums text-[#FAFAFA]">
                <span>{uploadStatusText || 'Uploading movie file to vault...'}</span>
                <span className="text-[#E5A93B] font-bold">{uploadProgress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#27272A]">
                <div
                  className="h-full bg-[#E5A93B] transition-all duration-150"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-[11px] text-[#A1A1AA]">
                Keep this browser tab open until the upload finishes.
              </p>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#27272A]">
            {isUploading ? (
              <button
                type="button"
                onClick={handleCancelUpload}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-500/20 cursor-pointer"
              >
                Cancel Upload
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[#27272A] bg-[#18181B] px-4 py-2 text-sm font-medium text-[#FAFAFA] hover:bg-[#27272A] cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isUploading}
              className="inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-5 py-2 text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-50 cursor-pointer"
            >
              <Film className="h-4 w-4" aria-hidden="true" />
              <span>{isUploading ? `Uploading (${uploadProgress}%)...` : 'Publish Movie'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
