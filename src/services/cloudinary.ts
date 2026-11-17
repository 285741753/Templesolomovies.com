export interface CloudinaryConfig {
  cloudName: string;
  uploadPreset: string;
  isConfigured: boolean;
  missingVars: string[];
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

export const MAX_POSTER_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB

const ALLOWED_POSTER_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_POSTER_EXT = /\.(jpe?g|png|webp)$/i;

const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/webm']);
const ALLOWED_VIDEO_EXT = /\.(mp4|webm)$/i;

export function getCloudinaryConfig(): CloudinaryConfig {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  const cloudName = String(env.VITE_CLOUDINARY_CLOUD_NAME || '').trim();
  const uploadPreset = String(env.VITE_CLOUDINARY_UPLOAD_PRESET || '').trim();

  const missingVars: string[] = [];
  if (!cloudName) missingVars.push('VITE_CLOUDINARY_CLOUD_NAME');
  if (!uploadPreset) missingVars.push('VITE_CLOUDINARY_UPLOAD_PRESET');

  return {
    cloudName,
    uploadPreset,
    isConfigured: missingVars.length === 0,
    missingVars,
  };
}

export function validatePosterFile(file: File): string | null {
  const mime = (file.type || '').toLowerCase();
  const validType = ALLOWED_POSTER_MIME.has(mime) || ALLOWED_POSTER_EXT.test(file.name);
  if (!validType) {
    return 'Poster must be a JPG, PNG, or WEBP image file.';
  }
  if (file.size > MAX_POSTER_BYTES) {
    return `Poster image is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed is 5 MB.`;
  }
  return null;
}

export function validateVideoFile(file: File): string | null {
  const mime = (file.type || '').toLowerCase();
  const validType = ALLOWED_VIDEO_MIME.has(mime) || ALLOWED_VIDEO_EXT.test(file.name);
  if (!validType) {
    return 'Video must be an MP4 or WEBM file.';
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return `Video file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed is 100 MB.`;
  }
  return null;
}

export function uploadToCloudinaryUnsigned(
  file: File,
  options: UnsignedUploadOptions = {}
): Promise<CloudinaryUploadResult> {
  const { cloudName, uploadPreset, isConfigured, missingVars } = getCloudinaryConfig();

  if (!isConfigured) {
    return Promise.reject(
      new Error(
        `Cloudinary configuration missing: set ${missingVars.join(' and ')} in your environment variables.`
      )
    );
  }

  return new Promise((resolve, reject) => {
    const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    if (options.folder) {
      formData.append('folder', options.folder);
    }

    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
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

    if (options.signal) {
      if (options.signal.aborted) {
        fail('Upload cancelled.');
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.open('POST', endpoint, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0 && options.onProgress) {
        const pct = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
        options.onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();

      let parsed: Partial<CloudinaryUploadResult> & { error?: { message?: string } } = {};
      try {
        parsed = JSON.parse(xhr.responseText || '{}') as Partial<CloudinaryUploadResult> & {
          error?: { message?: string };
        };
      } catch {
        // Fallback for non-JSON error body
      }

      if (xhr.status >= 200 && xhr.status < 300 && parsed.secure_url && parsed.public_id) {
        options.onProgress?.(100);
        resolve({
          secure_url: parsed.secure_url,
          public_id: parsed.public_id,
          resource_type: parsed.resource_type || 'auto',
          format: parsed.format,
          bytes: parsed.bytes,
          duration: parsed.duration,
          width: parsed.width,
          height: parsed.height,
        });
        return;
      }

      const apiErr = parsed.error?.message;
      if (apiErr) {
        reject(new Error(`Cloudinary upload failed: ${apiErr}`));
      } else {
        reject(new Error(`Cloudinary upload failed (HTTP ${xhr.status || 0}). Please check your upload preset.`));
      }
    };

    xhr.onerror = () => {
      fail('Network error while uploading to Cloudinary. Please check your internet connection.');
    };

    xhr.onabort = () => {
      fail('Upload cancelled.');
    };

    xhr.send(formData);
  });
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
