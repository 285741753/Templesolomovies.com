import type { DownloadQualityTier, Movie, SeriesEpisode } from '../types/cinema';

const COUNTRY_BY_GENRE_FALLBACK: Record<string, string> = {
  Nollywood: 'Nigeria',
  Action: 'USA',
  'Sci-Fi': 'USA',
  Thriller: 'UK',
  Drama: 'UK',
  Mystery: 'Canada',
  Comedy: 'USA',
  Documentary: 'Global',
  Animation: 'Japan',
  Horror: 'South Korea',
};

const SEEDED_SERIES_EPISODES: Record<string, SeriesEpisode[]> = {
  'movie-lagos-bloodline': [
    {
      id: 'lb-s1e1',
      season: 1,
      episode: 1,
      title: 'The Harbor Summons',
      duration: '48m',
      videoUrl: '/storage/movies/lagos-bloodline-4k.mp4',
      synopsis: 'A sudden boardroom coup puts Victoria Island docks on lockdown.',
    },
    {
      id: 'lb-s1e2',
      season: 1,
      episode: 2,
      title: 'Ledger of Tides',
      duration: '51m',
      videoUrl: '/storage/movies/the-chiefs-oath-4k.mp4',
      synopsis: 'Missing cargo manifests uncover an old alliance inside Apapa.',
    },
    {
      id: 'lb-s1e3',
      season: 1,
      episode: 3,
      title: 'Crown & Container',
      duration: '54m',
      videoUrl: '/storage/movies/money-and-blood-1080p.mp4',
      synopsis: 'The matriarch confronts the rival syndicate before midnight audit.',
    },
    {
      id: 'lb-s2e1',
      season: 2,
      episode: 1,
      title: 'Return to Third Mainland',
      duration: '52m',
      videoUrl: '/storage/movies/asahi-the-heir-4k.mp4',
      synopsis: 'A new successor steps forward as regional shipping lanes reopen.',
    },
    {
      id: 'lb-s2e2',
      season: 2,
      episode: 2,
      title: 'Steel Over Lagoon',
      duration: '56m',
      videoUrl: '/storage/movies/lagos-bloodline-4k.mp4',
      synopsis: 'Season 2 stakes climax in a historic maritime hearing.',
    },
  ],
  'movie-shadow-hunt': [
    {
      id: 'sh-s1e1',
      season: 1,
      episode: 1,
      title: 'Courier Zero',
      duration: '44m',
      videoUrl: '/storage/movies/shadow-hunt-4k.mp4',
      synopsis: 'An encrypted briefcase disappears along the northern terminal.',
    },
    {
      id: 'sh-s1e2',
      season: 1,
      episode: 2,
      title: 'Neon Pier',
      duration: '46m',
      videoUrl: '/storage/movies/vengeance-protocol-4k.mp4',
      synopsis: 'Tracking signals lead straight into a closed dockside warehouse.',
    },
    {
      id: 'sh-s1e3',
      season: 1,
      episode: 3,
      title: 'Final Extraction',
      duration: '50m',
      videoUrl: '/storage/movies/black-ops-iii-4k.mp4',
      synopsis: 'A tactical standoff decides who controls the syndicate keys.',
    },
  ],
};

export function inferMovieCountry(movie: Movie): string {
  if (movie.country && movie.country.trim()) return movie.country.trim();
  if (movie.genre === 'Nollywood' || /lagos|abuja|niger/i.test(movie.title + ' ' + movie.synopsis)) {
    return 'Nigeria';
  }
  if (/asahi|tokyo|anime/i.test(movie.title + ' ' + movie.director)) {
    return 'Japan';
  }
  if (/seoul|korean|k-drama/i.test(movie.title + ' ' + movie.synopsis)) {
    return 'South Korea';
  }
  return COUNTRY_BY_GENRE_FALLBACK[movie.genre] || 'USA';
}

export function enrichMovie(movie: Movie): Movie {
  const episodes = movie.episodes?.length
    ? movie.episodes
    : SEEDED_SERIES_EPISODES[movie.id];
  const country = inferMovieCountry(movie);
  const genres = Array.from(
    new Set(
      [
        movie.genre,
        ...(Array.isArray(movie.genres) ? movie.genres : []),
      ]
        .map((g) => (typeof g === 'string' ? g.trim() : ''))
        .filter(Boolean)
    )
  );
  const language =
    movie.language?.trim() ||
    (movie.category === 'K-Drama'
      ? 'Korean'
      : movie.category === 'Anime'
        ? 'Japanese'
        : 'English');
  const audioLanguages = movie.audioLanguages?.length
    ? movie.audioLanguages
    : country === 'Nigeria'
      ? ['English', 'Pidgin', 'Yoruba']
      : ['English', 'French', 'Spanish'];
  const subtitleLanguages = movie.subtitleLanguages?.length
    ? movie.subtitleLanguages
    : ['English', 'French', 'Spanish', 'Pidgin'];

  return {
    ...movie,
    genres: genres.length > 0 ? genres : [movie.genre || 'Drama'],
    language,
    country,
    category: movie.category || (episodes?.length ? 'Series' : movie.genre === 'Nollywood' ? 'Nollywood' : 'Movies'),
    episodes,
    audioLanguages,
    subtitleLanguages,
  };
}

export function estimateTierFileSize(
  baseFileSizeBytes: number,
  tier: DownloadQualityTier
): number {
  const safeBase = Math.max(baseFileSizeBytes || 0, 1_400_000);
  const multipliers: Record<DownloadQualityTier, number> = {
    '360p': 0.45,
    '720p': 0.85,
    '1080p': 1.35,
    '4K': 2.6,
  };
  return Math.max(120_000, Math.round(safeBase * multipliers[tier]));
}

export function generateSubtitleVttUrl(
  movie: Movie,
  subtitleLang: string,
  episode?: SeriesEpisode
): string {
  const linesByLang: Record<string, string[]> = {
    English: [
      `[${movie.title}${episode ? ` · S${episode.season} E${episode.episode}` : ''}]`,
      episode?.synopsis || movie.synopsis.slice(0, 110),
      `Directed by ${movie.director} · Streaming on Temple Cinema`,
    ],
    French: [
      `[${movie.title}${episode ? ` · S${episode.season} É${episode.episode}` : ''}]`,
      'Lecture haute définition sur Temple Cinema.',
      `Réalisé par ${movie.director} · templesolosmovies.com`,
    ],
    Spanish: [
      `[${movie.title}${episode ? ` · T${episode.season} E${episode.episode}` : ''}]`,
      'Reproducción en Temple Cinema.',
      `Dirigida por ${movie.director} · templesolosmovies.com`,
    ],
    Pidgin: [
      `[${movie.title}${episode ? ` · S${episode.season} E${episode.episode}` : ''}]`,
      'You dey watch original release for Temple Cinema.',
      `Director na ${movie.director} · Enjoy the show!`,
    ],
  };

  const cues = linesByLang[subtitleLang] || linesByLang.English;
  const vtt = [
    'WEBVTT',
    '',
    '00:00:00.200 --> 00:00:04.500',
    cues[0],
    '',
    '00:00:04.600 --> 00:00:10.000',
    cues[1],
    '',
    '00:00:10.100 --> 00:02:00.000',
    cues[2],
    '',
  ].join('\n');

  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
}
