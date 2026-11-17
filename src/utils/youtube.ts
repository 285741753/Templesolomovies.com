const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{6,20}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export function extractYouTubeVideoId(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  let candidateId: string | null = null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    candidateId = pathSegments[0] || null;
  } else if (pathSegments[0] === 'watch') {
    candidateId = parsed.searchParams.get('v');
  } else if (
    pathSegments[0] === 'embed' ||
    pathSegments[0] === 'shorts' ||
    pathSegments[0] === 'live' ||
    pathSegments[0] === 'v'
  ) {
    candidateId = pathSegments[1] || null;
  } else {
    candidateId = parsed.searchParams.get('v');
  }

  if (!candidateId || !YOUTUBE_ID_REGEX.test(candidateId)) {
    return null;
  }

  return candidateId;
}

export function getYouTubeEmbedUrl(
  rawUrl?: string | null,
  options: { autoplay?: boolean } = {}
): string | null {
  const videoId = extractYouTubeVideoId(rawUrl);
  if (!videoId) return null;

  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });
  if (options.autoplay) {
    params.set('autoplay', '1');
  }

  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}
