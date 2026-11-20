export interface MusicGenreOption {
  id: string;
  label: string;
  searchTerm: string;
}

export const MUSIC_GENRES: MusicGenreOption[] = [
  { id: 'All', label: 'All Genres', searchTerm: 'Afrobeats' },
  { id: 'Afrobeats', label: 'Afrobeats', searchTerm: 'Afrobeats Burna Boy Wizkid Rema Tems' },
  { id: 'Amapiano', label: 'Amapiano', searchTerm: 'Amapiano Asake Uncle Waffles Kabza' },
  { id: 'Hip-Hop', label: 'Hip-Hop', searchTerm: 'Hip Hop Rap' },
  { id: 'R&B / Soul', label: 'R&B / Soul', searchTerm: 'R&B Soul Tems SZA' },
  { id: 'Gospel', label: 'Gospel', searchTerm: 'Gospel Worship Sinach Nathaniel Bassey' },
  { id: 'Pop', label: 'Pop', searchTerm: 'Pop Top Hits' },
  { id: 'Soundtracks', label: 'Soundtracks', searchTerm: 'Movie Soundtrack Score Hans Zimmer' },
  { id: 'Highlife', label: 'Highlife', searchTerm: 'Highlife Flavour Cavemen' },
  { id: 'Reggae', label: 'Reggae', searchTerm: 'Reggae Dancehall Bob Marley' },
  { id: 'Jazz', label: 'Jazz', searchTerm: 'Jazz Instrumental' },
  { id: 'Electronic', label: 'Electronic', searchTerm: 'Electronic Dance EDM' },
];

export function combineMusicSearchTerms(query: string, genre: string): string {
  const cleanQuery = query.trim();
  const cleanGenre = genre.trim();
  const genreOption = MUSIC_GENRES.find(
    (g) => g.id.toLowerCase() === cleanGenre.toLowerCase() || g.label.toLowerCase() === cleanGenre.toLowerCase()
  );

  if (!cleanGenre || cleanGenre.toLowerCase() === 'all') {
    return cleanQuery || 'Afrobeats';
  }

  if (!cleanQuery) {
    return genreOption ? genreOption.searchTerm : cleanGenre;
  }

  if (cleanQuery.toLowerCase().includes(cleanGenre.toLowerCase())) {
    return cleanQuery;
  }

  return `${cleanQuery} ${cleanGenre}`.trim();
}

export function buildSpotifySearchUrl(query: string, genre = ''): string {
  const effective = combineMusicSearchTerms(query, genre);
  return `https://open.spotify.com/search/${encodeURIComponent(effective)}`;
}

export function buildBoomplaySearchUrl(query: string, genre = ''): string {
  const effective = combineMusicSearchTerms(query, genre);
  return `https://www.boomplay.com/search/default/${encodeURIComponent(effective)}`;
}
