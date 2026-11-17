/**
 * Cloudinary utility for Temple Cinema (templesolosmovies.com).
 *
 * Covers:
 * 1. Backend signed upload signature generation (SHA-1 via Web Crypto, keeping API_SECRET off the client)
 * 2. Client chunked / cancellable upload helper for large movie & audio files
 * 3. Responsive poster URL transformations (f_auto, q_auto, width scaling, srcSet)
 * 4. Adaptive HLS video streaming (.m3u8 via sp_auto), auto-thumbnails, preview clips, and fl_attachment downloads
 */

export type CloudinaryResourceType = 'image' | 'video' | 'raw' | 'auto';

export interface CloudinaryServerCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  uploadPreset?: string;
}

export interface SignUploadRequest {
  resourceType?: CloudinaryResourceType;
  folder?: string;
  publicId?: string;
  uploadPreset?: string;
  eager?: string;
  eagerAsync?: boolean;
  tags?: string[];
  overwrite?: boolean;
}

export interface CloudinarySignedPayload {
  mode?: 'signed';
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  uploadUrl: string;
  resourceType: CloudinaryResourceType;
  params: Record<string, string>;
}

export interface CloudinaryUnsignedPayload {
  mode: 'unsigned';
  cloudName: string;
  uploadPreset: string;
  uploadUrl: string;
  resourceType: CloudinaryResourceType;
  params: Record<string, string>;
}

export type CloudinaryUploadPayload = CloudinarySignedPayload | CloudinaryUnsignedPayload;

export interface CloudinaryUploadResponse {
  public_id: string;
  secure_url: string;
  url: string;
  format: string;
  resource_type: string;
  bytes: number;
  duration?: number;
  width?: number;
  height?: number;
  original_filename?: string;
}

export interface PosterTransformOptions {
  cloudName?: string;
  width?: number;
  height?: number;
  crop?: 'fill' | 'limit' | 'scale' | 'thumb';
  gravity?: 'auto' | 'center' | 'face';
  quality?: 'auto' | 'auto:eco' | 'auto:good' | 'auto:best' | number;
  format?: 'auto' | 'webp' | 'avif' | 'jpg';
  dpr?: 'auto' | '1.0' | '2.0';
}

export interface HlsStreamOptions {
  cloudName?: string;
  streamingProfile?: 'auto' | 'hd' | 'full_hd' | '4k' | string;
  maxWidth?: number;
}

export interface VideoDerivativeOptions {
  cloudName?: string;
  width?: number;
  startOffsetSeconds?: number;
  durationSeconds?: number;
}

export interface ChunkedUploadOptions {
  file: File;
  signed: CloudinaryUploadPayload;
  chunkSizeBytes?: number;
  signal?: AbortSignal;
  onProgress?: (percent: number, uploadedBytes: number, totalBytes: number) => void;
}

const DEFAULT_CHUNK_SIZE_BYTES = 6 * 1024 * 1024; // 6 MB (Cloudinary requires >= 5 MB chunks)
const SIGNATURE_EXCLUDED_KEYS = new Set([
  'file',
  'cloud_name',
  'resource_type',
  'api_key',
  'signature',
]);

function readPublicCloudName(override?: string): string {
  if (override?.trim()) return override.trim();
  const viteEnv =
    typeof import.meta !== 'undefined'
      ? (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      : undefined;
  const fromVite = viteEnv?.VITE_CLOUDINARY_CLOUD_NAME;
  if (fromVite?.trim()) return fromVite.trim();
  if (typeof process !== 'undefined' && process.env?.CLOUDINARY_CLOUD_NAME?.trim()) {
    return process.env.CLOUDINARY_CLOUD_NAME.trim();
  }
  return '';
}

function readPublicUploadPreset(override?: string): string {
  if (override?.trim()) return override.trim();
  const viteEnv =
    typeof import.meta !== 'undefined'
      ? (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      : undefined;
  const fromVite = viteEnv?.VITE_CLOUDINARY_UPLOAD_PRESET;
  if (fromVite?.trim()) return fromVite.trim();
  if (typeof process !== 'undefined' && process.env?.CLOUDINARY_UPLOAD_PRESET?.trim()) {
    return process.env.CLOUDINARY_UPLOAD_PRESET.trim();
  }
  return '';
}

function isCloudinaryUrl(value: string): boolean {
  return /^https?:\/\/res\.cloudinary\.com\//i.test(value.trim());
}

/**
 * Extracts cloud name & public_id (without extension) from either a full res.cloudinary.com URL
 * or passes through a raw public_id when cloudName is supplied.
 */
function parseCloudinaryRef(
  publicIdOrUrl: string,
  cloudNameOverride?: string
): { cloudName: string; publicId: string; resourceType?: string } | null {
  const trimmed = publicIdOrUrl.trim();
  if (!trimmed) return null;

  if (isCloudinaryUrl(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const parts = parsed.pathname.split('/').filter(Boolean);
      // Format: /<cloud_name>/<resource_type>/<delivery_type>/[transforms/][v123/]<public_id.ext>
      const cloudName = cloudNameOverride || parts[0] || '';
      const resourceType = parts[1] || 'image';
      const uploadIdx = parts.findIndex((seg) => seg === 'upload' || seg === 'authenticated' || seg === 'private');
      if (uploadIdx === -1) return null;

      let rest = parts.slice(uploadIdx + 1);
      // Drop existing transformation segments (contain ',' or match known single transform prefixes like w_540 / f_auto / sp_auto / fl_attachment)
      while (
        rest.length > 1 &&
        (/^[a-z]{1,4}_[^/]+$/i.test(rest[0]) || rest[0].includes(','))
      ) {
        rest = rest.slice(1);
      }
      // Drop version segment v1234567890 if present
      if (rest.length > 1 && /^v\d+$/i.test(rest[0])) {
        rest = rest.slice(1);
      }

      const rawId = rest.join('/');
      const publicId = rawId.replace(/\.[a-z0-9]{2,5}$/i, '');
      return cloudName && publicId ? { cloudName, publicId, resourceType } : null;
    } catch {
      return null;
    }
  }

  // Leave local /storage/... or external non-Cloudinary URLs untouched
  if (/^(https?:\/\/|\/|data:|blob:)/i.test(trimmed)) {
    return null;
  }

  const cloudName = readPublicCloudName(cloudNameOverride);
  if (!cloudName) return null;
  return {
    cloudName,
    publicId: trimmed.replace(/\.[a-z0-9]{2,5}$/i, ''),
  };
}

/**
 * Normalizes and sorts upload parameters into Cloudinary's canonical string-to-sign format.
 */
export function buildSignaturePayload(
  paramsToSign: Record<string, string | number | boolean | undefined>
): string {
  const entries = Object.entries(paramsToSign)
    .filter(([key, value]) => {
      if (SIGNATURE_EXCLUDED_KEYS.has(key)) return false;
      return value !== undefined && value !== null && String(value) !== '';
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`);

  return entries.join('&');
}

/**
 * Generates a Cloudinary SHA-1 upload signature.
 * IMPORTANT: Call ONLY on the Express backend with CLOUDINARY_API_SECRET.
 */
export async function signCloudinaryParams(
  paramsToSign: Record<string, string | number | boolean | undefined>,
  apiSecret: string
): Promise<string> {
  if (typeof window !== 'undefined') {
    throw new Error('Security violation: Cloudinary API secret signing must run on the server only.');
  }
  const cleanSecret = apiSecret.trim();
  if (!cleanSecret) {
    throw new Error('Missing CLOUDINARY_API_SECRET for signed upload generation.');
  }

  const payload = `${buildSignaturePayload(paramsToSign)}${cleanSecret}`;
  const encoded = new TextEncoder().encode(payload);
  const digest = await globalThis.crypto.subtle.digest('SHA-1', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Produces complete signed upload parameters on the server for the browser to POST directly to Cloudinary.
 */
export async function createSignedUploadPayload(
  options: SignUploadRequest,
  credentials: CloudinaryServerCredentials
): Promise<CloudinarySignedPayload> {
  const cloudName = credentials.cloudName.trim();
  const apiKey = credentials.apiKey.trim();
  const apiSecret = credentials.apiSecret.trim();

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary credentials (cloudName, apiKey, apiSecret) are incomplete.');
  }

  const resourceType: CloudinaryResourceType = options.resourceType || 'auto';
  const timestamp = Math.floor(Date.now() / 1000);

  const rawParams: Record<string, string | number | boolean | undefined> = {
    timestamp,
    folder: options.folder?.trim() || 'temple-cinema',
    public_id: options.publicId?.trim() || undefined,
    upload_preset: options.uploadPreset?.trim() || credentials.uploadPreset?.trim() || undefined,
    eager:
      options.eager?.trim() ||
      (resourceType === 'video' ? 'sp_auto/m3u8' : undefined),
    eager_async: resourceType === 'video' ? (options.eagerAsync ?? true) : undefined,
    tags: options.tags?.length ? options.tags.join(',') : undefined,
    overwrite: options.overwrite,
  };

  const signature = await signCloudinaryParams(rawParams, apiSecret);
  const stringParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawParams)) {
    if (v !== undefined && v !== null && String(v) !== '') {
      stringParams[k] = String(v);
    }
  }

  return {
    mode: 'signed',
    cloudName,
    apiKey,
    timestamp,
    signature,
    resourceType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`,
    params: stringParams,
  };
}

/**
 * Produces upload parameters for an UNSIGNED Cloudinary Upload Preset (no API secret required).
 * Reads VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET automatically if omitted.
 */
export function createUnsignedUploadPayload(options: {
  cloudName?: string;
  uploadPreset?: string;
  resourceType?: CloudinaryResourceType;
  folder?: string;
  tags?: string[];
} = {}): CloudinaryUnsignedPayload {
  const cloudName = readPublicCloudName(options.cloudName);
  const uploadPreset = readPublicUploadPreset(options.uploadPreset);
  if (!cloudName || !uploadPreset) {
    throw new Error(
      'Both cloudName (VITE_CLOUDINARY_CLOUD_NAME) and an unsigned uploadPreset (VITE_CLOUDINARY_UPLOAD_PRESET) are required.'
    );
  }

  const resourceType: CloudinaryResourceType = options.resourceType || 'auto';
  const params: Record<string, string> = {
    upload_preset: uploadPreset,
  };
  if (options.folder?.trim()) params.folder = options.folder.trim();
  if (options.tags?.length) params.tags = options.tags.join(',');

  return {
    mode: 'unsigned',
    cloudName,
    uploadPreset,
    resourceType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`,
    params,
  };
}

/**
 * Convenience wrapper for direct unsigned browser uploads (chunked, cancellable, with progress).
 */
export async function uploadFileUnsignedToCloudinary(
  file: File,
  options: {
    cloudName?: string;
    uploadPreset?: string;
    resourceType?: CloudinaryResourceType;
    folder?: string;
    tags?: string[];
    chunkSizeBytes?: number;
    signal?: AbortSignal;
    onProgress?: (percent: number, uploadedBytes: number, totalBytes: number) => void;
  } = {}
): Promise<CloudinaryUploadResponse> {
  const payload = createUnsignedUploadPayload({
    cloudName: options.cloudName,
    uploadPreset: options.uploadPreset,
    resourceType: options.resourceType,
    folder: options.folder,
    tags: options.tags,
  });
  return uploadChunkedToCloudinary({
    file,
    signed: payload,
    chunkSizeBytes: options.chunkSizeBytes,
    signal: options.signal,
    onProgress: options.onProgress,
  });
}

/**
 * Browser-side chunked upload helper supporting both signed and unsigned Cloudinary presets.
 * Supports progress reporting and AbortSignal cancellation for large movie/audio files.
 */
export async function uploadChunkedToCloudinary({
  file,
  signed,
  chunkSizeBytes = DEFAULT_CHUNK_SIZE_BYTES,
  signal,
  onProgress,
}: ChunkedUploadOptions): Promise<CloudinaryUploadResponse> {
  const totalBytes = file.size;
  const effectiveChunkSize = Math.max(5 * 1024 * 1024, chunkSizeBytes);
  const uniqueUploadId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const sendChunk = (start: number, end: number): Promise<CloudinaryUploadResponse> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Upload cancelled', 'AbortError'));
        return;
      }

      const xhr = new XMLHttpRequest();
      const isSingleRequest = start === 0 && end >= totalBytes;
      const chunkBlob = isSingleRequest ? file : file.slice(start, end);

      const formData = new FormData();
      formData.append('file', chunkBlob, file.name);
      if (signed.mode !== 'unsigned') {
        formData.append('api_key', signed.apiKey);
        formData.append('signature', signed.signature);
      }
      for (const [key, val] of Object.entries(signed.params)) {
        formData.append(key, val);
      }

      const onAbort = () => {
        xhr.abort();
        reject(new DOMException('Upload cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      xhr.open('POST', signed.uploadUrl, true);
      if (!isSingleRequest) {
        xhr.setRequestHeader('X-Unique-Upload-Id', uniqueUploadId);
        xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${totalBytes}`);
      }

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || !onProgress) return;
        const uploaded = Math.min(totalBytes, start + event.loaded);
        const pct = Math.min(100, Math.round((uploaded / Math.max(1, totalBytes)) * 100));
        onProgress(pct, uploaded, totalBytes);
      };

      xhr.onload = () => {
        signal?.removeEventListener('abort', onAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const parsed = JSON.parse(xhr.responseText) as CloudinaryUploadResponse;
            resolve(parsed);
          } catch {
            reject(new Error('Invalid JSON response returned by Cloudinary.'));
          }
          return;
        }
        try {
          const errBody = JSON.parse(xhr.responseText) as { error?: { message?: string } };
          reject(new Error(errBody.error?.message || `Cloudinary upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Cloudinary upload failed (${xhr.status})`));
        }
      };

      xhr.onerror = () => {
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('Network error while uploading media to Cloudinary.'));
      };

      xhr.send(formData);
    });

  if (totalBytes <= effectiveChunkSize) {
    const res = await sendChunk(0, totalBytes);
    onProgress?.(100, totalBytes, totalBytes);
    return res;
  }

  let offset = 0;
  let lastResponse: CloudinaryUploadResponse | null = null;
  while (offset < totalBytes) {
    const nextEnd = Math.min(totalBytes, offset + effectiveChunkSize);
    lastResponse = await sendChunk(offset, nextEnd);
    offset = nextEnd;
  }

  if (!lastResponse) {
    throw new Error('Upload completed with empty Cloudinary metadata.');
  }
  onProgress?.(100, totalBytes, totalBytes);
  return lastResponse;
}

/**
 * Generates an optimized WebP/AVIF poster URL (f_auto, q_auto, width-capped).
 * Non-Cloudinary URLs (such as local /storage/posters/* assets) pass through unchanged.
 */
export function getOptimizedPosterUrl(
  publicIdOrUrl: string,
  options: PosterTransformOptions = {}
): string {
  const parsed = parseCloudinaryRef(publicIdOrUrl, options.cloudName);
  if (!parsed) return publicIdOrUrl;

  const width = options.width ?? 540;
  const crop = options.crop ?? (options.height ? 'fill' : 'limit');
  const format = options.format ?? 'auto';
  const quality = options.quality ?? 'auto';
  const dpr = options.dpr ?? 'auto';

  const transforms = [
    `f_${format}`,
    `q_${quality}`,
    `dpr_${dpr}`,
    `c_${crop}`,
    `w_${width}`,
    ...(options.height ? [`h_${options.height}`] : []),
    ...(crop === 'fill' || crop === 'thumb' ? [`g_${options.gravity ?? 'auto'}`] : []),
  ].join(',');

  return `https://res.cloudinary.com/${encodeURIComponent(parsed.cloudName)}/image/upload/${transforms}/${parsed.publicId}`;
}

/**
 * Builds a responsive srcSet string so phones download compact posters on weak mobile data.
 */
export function getPosterSrcSet(
  publicIdOrUrl: string,
  widths: number[] = [320, 540, 800],
  options: Omit<PosterTransformOptions, 'width'> = {}
): string {
  if (!parseCloudinaryRef(publicIdOrUrl, options.cloudName)) return '';
  return widths
    .map((w) => `${getOptimizedPosterUrl(publicIdOrUrl, { ...options, width: w })} ${w}w`)
    .join(', ');
}

/**
 * Generates an adaptive HLS (.m3u8) streaming URL using Cloudinary streaming profiles (e.g. sp_auto).
 */
export function getHlsStreamUrl(
  publicIdOrUrl: string,
  options: HlsStreamOptions = {}
): string {
  const parsed = parseCloudinaryRef(publicIdOrUrl, options.cloudName);
  if (!parsed) return publicIdOrUrl;

  const profile = options.streamingProfile || 'auto';
  const transforms = [
    `sp_${profile}`,
    ...(options.maxWidth ? [`c_limit,w_${options.maxWidth}`] : []),
  ].join('/');

  return `https://res.cloudinary.com/${encodeURIComponent(parsed.cloudName)}/video/upload/${transforms}/${parsed.publicId}.m3u8`;
}

/**
 * Returns both adaptive HLS (.m3u8) and progressive MP4 (f_mp4,q_auto) URLs for <video> playback.
 */
export function getAdaptiveVideoSources(
  publicIdOrUrl: string,
  options: HlsStreamOptions = {}
): {
  hlsUrl: string;
  mp4FallbackUrl: string;
  isCloudinary: boolean;
} {
  const parsed = parseCloudinaryRef(publicIdOrUrl, options.cloudName);
  if (!parsed) {
    return {
      hlsUrl: publicIdOrUrl,
      mp4FallbackUrl: publicIdOrUrl,
      isCloudinary: false,
    };
  }

  const mp4Transform = options.maxWidth
    ? `f_mp4,q_auto,c_limit,w_${options.maxWidth}`
    : 'f_mp4,q_auto';

  return {
    hlsUrl: getHlsStreamUrl(publicIdOrUrl, options),
    mp4FallbackUrl: `https://res.cloudinary.com/${encodeURIComponent(parsed.cloudName)}/video/upload/${mp4Transform}/${parsed.publicId}.mp4`,
    isCloudinary: true,
  };
}

/**
 * Detects whether the current browser natively plays HLS (.m3u8) in <video> (Safari, iOS, some Android browsers).
 */
export function canPlayNativeHls(): boolean {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('video');
  return Boolean(
    probe.canPlayType('application/vnd.apple.mpegurl') ||
      probe.canPlayType('application/x-mpegURL')
  );
}

/**
 * Automatically extracts an optimized frame thumbnail from a Cloudinary video upload.
 */
export function getAutoVideoThumbnailUrl(
  publicIdOrUrl: string,
  options: VideoDerivativeOptions = {}
): string {
  const parsed = parseCloudinaryRef(publicIdOrUrl, options.cloudName);
  if (!parsed) return '';

  const offset = options.startOffsetSeconds ?? 2;
  const width = options.width ?? 640;
  const transforms = `so_${offset},f_auto,q_auto,c_limit,w_${width}`;
  return `https://res.cloudinary.com/${encodeURIComponent(parsed.cloudName)}/video/upload/${transforms}/${parsed.publicId}.jpg`;
}

/**
 * Automatically generates a lightweight muted MP4 preview clip (trailer snippet) from a full video.
 */
export function getAutoVideoPreviewClipUrl(
  publicIdOrUrl: string,
  options: VideoDerivativeOptions = {}
): string {
  const parsed = parseCloudinaryRef(publicIdOrUrl, options.cloudName);
  if (!parsed) return publicIdOrUrl;

  const startOffset = options.startOffsetSeconds ?? 0;
  const duration = options.durationSeconds ?? 8;
  const width = options.width ?? 640;
  const transforms = `so_${startOffset},du_${duration},ac_none,f_mp4,q_auto:eco,c_limit,w_${width}`;
  return `https://res.cloudinary.com/${encodeURIComponent(parsed.cloudName)}/video/upload/${transforms}/${parsed.publicId}.mp4`;
}

/**
 * Generates an audio delivery URL compressed with q_auto and f_auto.
 */
export function getOptimizedAudioUrl(publicIdOrUrl: string, cloudName?: string): string {
  const parsed = parseCloudinaryRef(publicIdOrUrl, cloudName);
  if (!parsed) return publicIdOrUrl;
  return `https://res.cloudinary.com/${encodeURIComponent(parsed.cloudName)}/video/upload/f_auto,q_auto/${parsed.publicId}`;
}

/**
 * Generates a direct browser/offline download URL with Cloudinary's fl_attachment flag.
 */
export function getAttachmentDownloadUrl(
  publicIdOrUrl: string,
  options: {
    cloudName?: string;
    fileName?: string;
    resourceType?: 'video' | 'image' | 'raw';
    quality?: '360p' | '480p' | '720p' | '1080p' | '4K';
  } = {}
): string {
  const parsed = parseCloudinaryRef(publicIdOrUrl, options.cloudName);
  if (!parsed) return publicIdOrUrl;

  const resourceType = options.resourceType || (parsed.resourceType === 'image' ? 'image' : 'video');
  const safeName = options.fileName
    ? options.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[a-z0-9]{2,5}$/i, '')
    : '';
  const attachmentFlag = safeName ? `fl_attachment:${safeName}` : 'fl_attachment';

  const widthByQuality: Record<string, string> = {
    '360p': 'c_limit,w_640,q_auto:eco',
    '480p': 'c_limit,w_854,q_auto:good',
    '720p': 'c_limit,w_1280,q_auto',
    '1080p': 'c_limit,w_1920,q_auto',
    '4K': 'q_auto:best',
  };
  const qualityPart = options.quality && resourceType === 'video' ? `,${widthByQuality[options.quality] || ''}` : '';

  return `https://res.cloudinary.com/${encodeURIComponent(parsed.cloudName)}/${resourceType}/upload/${attachmentFlag}${qualityPart}/${parsed.publicId}`;
}
