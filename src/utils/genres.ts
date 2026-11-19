import genresData from '../data/genres.json';
import type { Movie } from '../types/cinema';

export interface GenreDefinition {
  slug: string;
  name: string;
  gradient: string;
  tagline: string;
}

export const ALL_GENRES_LIST: GenreDefinition[] = genresData as GenreDefinition[];
export const ALL_GENRE_NAMES: string[] = ALL_GENRES_LIST.map((g) => g.name);

const GENRE_BY_NAME = new Map<string, GenreDefinition>(
  ALL_GENRES_LIST.map((g) => [g.name.toLowerCase(), g])
);

const GENRE_BY_SLUG = new Map<string, GenreDefinition>(
  ALL_GENRES_LIST.map((g) => [g.slug.toLowerCase(), g])
);

export function getGenreDefinition(nameOrSlug: string): GenreDefinition {
  const clean = nameOrSlug.trim().toLowerCase();
  return (
    GENRE_BY_NAME.get(clean) ||
    GENRE_BY_SLUG.get(clean) || {
      slug: clean.replace(/[^a-z0-9]+/g, '-'),
      name: nameOrSlug,
      gradient: 'from-amber-600/30 via-zinc-900/45 to-[#111114]',
      tagline: 'Curated Temple Cinema titles',
    }
  );
}

export function getMovieGenres(movie: Pick<Movie, 'genre' | 'genres' | 'category' | 'country' | 'title' | 'synopsis' | 'episodes'>): string[] {
  const out = new Set<string>();
  if (movie.genre) out.add(movie.genre);
  if (Array.isArray(movie.genres)) {
    for (const g of movie.genres) {
      if (typeof g === 'string' && g.trim()) out.add(g.trim());
    }
  }
  return Array.from(out);
}

export function movieHasGenre(
  movie: Pick<Movie, 'genre' | 'genres' | 'category' | 'country' | 'title' | 'synopsis' | 'episodes'>,
  targetGenre: string
): boolean {
  if (!targetGenre || targetGenre === 'All') return true;
  const target = targetGenre.trim();
  const targetLower = target.toLowerCase();

  if (movie.genre?.toLowerCase() === targetLower) return true;
  if (Array.isArray(movie.genres) && movie.genres.some((g) => g.toLowerCase() === targetLower)) {
    return true;
  }
  if (movie.category && movie.category.toLowerCase() === targetLower) return true;

  const text = `${movie.title} ${movie.synopsis} ${movie.country || ''}`.toLowerCase();
  if (target === 'Series' && ((movie.episodes?.length ?? 0) > 0 || movie.category === 'Series')) {
    return true;
  }
  if (target === 'Anime' && (movie.category === 'Anime' || /\b(anime|manga|asahi|tokyo)\b/.test(text))) {
    return true;
  }
  if (target === 'Nollywood' && (movie.category === 'Nollywood' || /\b(nollywood|lagos|abuja|nigeria)\b/.test(text))) {
    return true;
  }
  if (target === 'African Cinema' && (movie.genre === 'Nollywood' || /\b(nigeria|lagos|ghana|kenya|africa|nollywood|accra|joburg)\b/.test(text))) {
    return true;
  }
  if (target === 'Hollywood' && (movie.country?.toLowerCase() === 'usa' || movie.country?.toLowerCase() === 'united states')) {
    return true;
  }
  if (target === 'K-Drama' && (movie.category === 'K-Drama' || /\b(k-drama|kdrama|korean|seoul)\b/.test(text))) {
    return true;
  }
  if (target === 'Concerts' && (movie.genre === 'Music' || /\b(concert|live session|tour|symphony)\b/.test(text))) {
    return true;
  }
  if (target === 'Music' && (movie.genre === 'Music' || movie.category === 'Music')) {
    return true;
  }
  if (target === 'Adventure' && movie.genre === 'Action') {
    return /\b(journey|expedition|quest|frontier|orbit|lagoon|harbor|escape)\b/.test(text);
  }
  if (target === 'Crime' && (movie.genre === 'Thriller' || movie.genre === 'Mystery')) {
    return /\b(syndicate|heist|murder|detective|courier|vault|ledger|ops)\b/.test(text);
  }
  if (target === 'Psychological Thriller' && movie.genre === 'Thriller') {
    return true;
  }
  if (target === 'Epic' && movie.genre === 'Action' && /\b(oath|heir|kingdom|crown|chronicle|protocol)\b/.test(text)) {
    return true;
  }
  return false;
}
