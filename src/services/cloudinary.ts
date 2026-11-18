export interface CloudinaryConfig {
  cloudName: string;
  uploadPreset: string;
  isConfigured: boolean;
  missingVars: string[];
  source: 'env' | 'local' | 'none';
}

export interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
  resource_type: string;
  format?: string;
  bytes?: number;
  duration?: number;
  width?: number;
  height?: number;
}

export interface UnsignedUploadOptions {
  folder?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

const LOCAL_CLOUDINARY_STORAGE_KEY = 'tsm_cloudinary_unsigned_v1';

export const MAX_POSTER_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const CLOUDINARY_CHUNK_THRESHOLD_BYTES = 20 * 1024 * 1024; // 20 MB
const CLOUDINARY_CHUNK_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB chunks (>= 5 MB minimum for Cloudinary)

const ALLOWED_POSTER_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_POSTER_EXT = /\.(jpe?g|png|webp)$/i;

const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4',
  'video/webm',
  'video/x-matroska',
  'video/matroska',
  'video/quicktime',
  'video/3gpp',
  'video/x-m4v',
]);
const ALLOWED_VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v)$/i;

export function resolveApiUrl(apiPath: string): string {
  if (/^https?:\/\//i.test(apiPath)) return apiPath;
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const envBase = String(
    (import.meta.env as Record<string, string | undefined> | undefined)?.VITE_API_BASE_URL || ''
  )
    .trim()
    .replace(/\/+$/, '');
  return envBase ? `${envBase}${normalizedPath}` : normalizedPath;
}

export async function compressPosterIfNeeded(
  file: File,
  maxBytes = 800 * 1024
): Promise<File> {
  if (!file || file.size <= maxBytes || typeof document === 'undefined') {
    return file;
  }
  return new Promise<File>((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxWidth = 1080;
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objectUrl);
            if (!blob || blob.size >= file.size) {
              resolve(file);
              return;
            }
            const cleanBase = (file.name || 'poster').replace(/\.[^/.]+$/, '');
            resolve(new File([blob], `${cleanBase}.jpg`, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          0.82
        );
      } catch {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    img.src = objectUrl;
  });
}

function readLocalCloudinaryConfig(): { cloudName: string; uploadPreset: string } {
  if (typeof window === 'undefined') return { cloudName: '', uploadPreset: '' };
  try {
    const raw = window.localStorage.getItem(LOCAL_CLOUDINARY_STORAGE_KEY);
    if (!raw) return { cloudName: '', uploadPreset: '' };
    const parsed = JSON.parse(raw) as { cloudName?: unknown; uploadPreset?: unknown };
    return {
      cloudName: typeof parsed.cloudName === 'string' ? parsed.cloudName.trim() : '',
      uploadPreset: typeof parsed.uploadPreset === 'string' ? parsed.uploadPreset.trim() : '',
    };
  } catch {
    return { cloudName: '', uploadPreset: '' };
  }
}

export function saveLocalCloudinaryConfig(cloudName: string, uploadPreset: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      LOCAL_CLOUDINARY_STORAGE_KEY,
      JSON.stringify({
        cloudName: cloudName.trim(),
        uploadPreset: uploadPreset.trim(),
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function clearLocalCloudinaryConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LOCAL_CLOUDINARY_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function getCloudinaryConfig(): CloudinaryConfig {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  const envCloud = String(env.VITE_CLOUDINARY_CLOUD_NAME || '').trim();
  const envPreset = String(env.VITE_CLOUDINARY_UPLOAD_PRESET || '').trim();

  if (envCloud && envPreset) {
    return {
      cloudName: envCloud,
      uploadPreset: envPreset,
      isConfigured: true,
      missingVars: [],
      source: 'env',
    };
  }

  const localCfg = readLocalCloudinaryConfig();
  const cloudName = envCloud || localCfg.cloudName;
  const uploadPreset = envPreset || localCfg.uploadPreset;

  const missingVars: string[] = [];
  if (!cloudName) missingVars.push('VITE_CLOUDINARY_CLOUD_NAME');
  if (!uploadPreset) missingVars.push('VITE_CLOUDINARY_UPLOAD_PRESET');

  const source: CloudinaryConfig['source'] =
    missingVars.length === 0 ? (localCfg.cloudName || localCfg.uploadPreset ? 'local' : 'env') : 'none';

  return {
    cloudName,
    uploadPreset,
    isConfigured: missingVars.length === 0,
    missingVars,
    source,
  };
}

export function validatePosterFile(file: File): string | null {
  const mime = (file.type || '').toLowerCase();
  const validType = ALLOWED_POSTER_MIME.has(mime) || ALLOWED_POSTER_EXT.test(file.name);
  if (!validType) {
    return 'Poster must be a JPG, PNG, or WEBP image file.';
  }
  if (file.size > MAX_POSTER_BYTES) {
    return `Poster image is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed is 10 MB.`;
  }
  return null;
}

export function validateVideoFile(file: File): string | null {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('image/')) {
    return 'Please choose a video file (images are not allowed here).';
  }
  const validType =
    mime.startsWith('video/') ||
    ALLOWED_VIDEO_MIME.has(mime) ||
    ALLOWED_VIDEO_EXT.test(file.name || '');
  if (!validType) {
    return 'Please choose a video file (MP4, WEBM, MKV, MOV, or M4V).';
  }
  if (file.size <= 0) {
    return 'Selected video file is empty.';
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return `Video file is too large (${(file.size / (1024 * 1024 * 1024)).toFixed(2)} GB). Maximum allowed is 2 GB.`;
  }
  return null;
}

function sendCloudinaryXhr(params: {
  endpoint: string;
  formData: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<Partial<CloudinaryUploadResult>> {
  const { endpoint, formData, headers, signal, onProgress } = params;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        // Ignore abort errors
      }
      fail('Upload cancelled.');
    };

    if (signal) {
      if (signal.aborted) {
        fail('Upload cancelled.');
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.open('POST', endpoint, true);
    xhr.timeout = 120_000;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        xhr.setRequestHeader(k, v);
      }
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0 && onProgress) {
        onProgress(event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();

      let parsed: Partial<CloudinaryUploadResult> & {
        done?: boolean;
        error?: { message?: string };
      } = {};
      try {
        parsed = JSON.parse(xhr.responseText || '{}') as Partial<CloudinaryUploadResult> & {
          done?: boolean;
          error?: { message?: string };
        };
      } catch {
        // Fallback for non-JSON error body
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed);
        return;
      }

      const apiErr = parsed.error?.message;
      if (apiErr) {
        reject(new Error(`Cloudinary upload failed: ${apiErr}`));
      } else {
        reject(
          new Error(
            `Cloudinary upload failed (HTTP ${xhr.status || 0}). Verify your Cloud Name and Unsigned Upload Preset.`
          )
        );
      }
    };

    xhr.onerror = () => {
      fail('Network error while uploading to Cloudinary. Please check your internet connection.');
    };

    xhr.ontimeout = () => {
      fail('Upload request timed out while sending data to Cloudinary. Retry on a steadier connection.');
    };

    xhr.onabort = () => {
      fail('Upload cancelled.');
    };

    xhr.send(formData);
  });
}

export async function uploadToCloudinaryUnsigned(
  file: File,
  options: UnsignedUploadOptions = {}
): Promise<CloudinaryUploadResult> {
  const { cloudName, uploadPreset, isConfigured, missingVars } = getCloudinaryConfig();

  if (!isConfigured) {
    throw new Error(
      `Cloudinary configuration missing: set ${missingVars.join(' and ')} first.`
    );
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`;

  if (file.size <= CLOUDINARY_CHUNK_THRESHOLD_BYTES) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    if (options.folder) {
      formData.append('folder', options.folder);
    }

    const parsed = await sendCloudinaryXhr({
      endpoint,
      formData,
      signal: options.signal,
      onProgress: (loaded, total) => {
        if (options.onProgress && total > 0) {
          options.onProgress(Math.min(100, Math.max(0, Math.round((loaded / total) * 100))));
        }
      },
    });

    if (!parsed.secure_url || !parsed.public_id) {
      throw new Error('Cloudinary did not return a valid media URL. Verify that the upload preset is set to Unsigned.');
    }

    options.onProgress?.(100);
    return {
      secure_url: parsed.secure_url,
      public_id: parsed.public_id,
      resource_type: parsed.resource_type || 'auto',
      format: parsed.format,
      bytes: parsed.bytes,
      duration: parsed.duration,
      width: parsed.width,
      height: parsed.height,
    };
  }

  // Unsigned chunked upload for large video files (> 20 MB, up to 2 GB)
  const uniqueUploadId = `tsm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const totalBytes = file.size;
  const totalChunks = Math.ceil(totalBytes / CLOUDINARY_CHUNK_SIZE_BYTES);
  let lastResult: Partial<CloudinaryUploadResult> = {};

  for (let i = 0; i < totalChunks; i += 1) {
    if (options.signal?.aborted) {
      throw new Error('Upload cancelled.');
    }

    const start = i * CLOUDINARY_CHUNK_SIZE_BYTES;
    const end = Math.min(totalBytes, start + CLOUDINARY_CHUNK_SIZE_BYTES) - 1;
    const chunkBlob = file.slice(start, end + 1);

    const formData = new FormData();
    formData.append('file', chunkBlob, file.name);
    formData.append('upload_preset', uploadPreset);
    if (options.folder) {
      formData.append('folder', options.folder);
    }

    lastResult = await sendCloudinaryXhr({
      endpoint,
      formData,
      headers: {
        'X-Unique-Upload-Id': uniqueUploadId,
        'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
      },
      signal: options.signal,
      onProgress: (loaded, chunkTotal) => {
        if (options.onProgress) {
          const uploadedSoFar = start + (chunkTotal > 0 ? Math.min(chunkBlob.size, loaded) : 0);
          const pct = Math.min(99, Math.max(0, Math.round((uploadedSoFar / totalBytes) * 100)));
          options.onProgress(pct);
        }
      },
    });
  }

  if (!lastResult.secure_url || !lastResult.public_id) {
    throw new Error('Cloudinary chunked upload completed without returning a media URL.');
  }

  options.onProgress?.(100);
  return {
    secure_url: lastResult.secure_url,
    public_id: lastResult.public_id,
    resource_type: lastResult.resource_type || 'video',
    format: lastResult.format,
    bytes: lastResult.bytes,
    duration: lastResult.duration,
    width: lastResult.width,
    height: lastResult.height,
  };
}

export function getOptimizedPosterUrl(url: string, width = 540): string {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) {
    return url;
  }
  return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width},c_limit/`);
}

export function getDownloadAttachmentUrl(url: string): string {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) {
    return url;
  }
  if (url.includes('fl_attachment')) return url;
  return url.replace('/upload/', '/upload/fl_attachment/');
}
