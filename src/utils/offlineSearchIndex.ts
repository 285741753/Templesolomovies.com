import type { Movie, MovieGenre, MovieQuality } from '../types/cinema';
import { enrichMovie } from './movieMetadata';

export const OFFLINE_SEARCH_INDEX_KEY = 'tsm_offline_search_index_v1';
export const RECENT_SEARCHES_KEY = 'tsm_recent_searches_v1';

export type SearchSortOrder =
  | 'relevance'
  | 'newest'
  | 'oldest'
  | 'imdb'
  | 'downloads'
  | 'year'
  | 'title';

export interface OfflineSearchFilters {
  query?: string;
  genre?: 'All' | MovieGenre;
  quality?: 'All' | MovieQuality;
  sortBy?: SearchSortOrder;
  savedOnly?: boolean;
  savedMovieIds?: Set<string>;
  downloadedOnly?: boolean;
  downloadedMovieIds?: Set<string>;
}

export interface OfflineSearchQueryResult {
  results: Movie[];
  totalCatalogCount: number;
  indexedCount: number;
  updatedAt: number | null;
  usedLocalIndex: boolean;
  scores: Map<string, number>;
  genreCounts: Record<string, number>;
  qualityCounts: Record<string, number>;
}

export interface OfflineIndexedDoc {
  id: string;
  title: string;
  genre: string;
  category: string;
  director: string;
  country: string;
  year: number;
  quality: string;
  duration: string;
  synopsis: string;
  posterUrl: string;
  backdropUrl?: string;
  trailerUrl?: string;
  videoUrl: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  downloads: number;
  featured: boolean;
  uploader: string;
  imdbRating: number;
  ageRating?: string;
  createdAt: string;
}

export interface OfflineSearchIndexPayload {
  version: 1;
  updatedAt: number;
  docs: Record<string, OfflineIndexedDoc>;
  tokens: Record<string, string[]>;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function extractWords(text: string): string[] {
  const cleaned = normalizeText(text).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/).filter(Boolean);
}

function expandIndexTokens(words: string[]): string[] {
  const tokenSet = new Set<string>();
  for (const word of words) {
    if (!word) continue;
    tokenSet.add(word);
    // Add 2..8 char prefixes for fast prefix matching when offline
    if (word.length >= 2) {
      const maxLen = Math.min(word.length, 8);
      for (let len = 2; len <= maxLen; len += 1) {
        tokenSet.add(word.slice(0, len));
      }
    }
  }
  return Array.from(tokenSet);
}

function toIndexedDoc(movie: Movie): OfflineIndexedDoc {
  return {
    id: movie.id,
    title: movie.title,
    genre: movie.genre,
    category: movie.category || 'Movies',
    director: movie.director || 'Independent',
    country: movie.country || 'International',
    year: Number(movie.year) || 2026,
    quality: movie.quality || '1080p HD',
    duration: movie.duration || '1h 45m',
    synopsis: movie.synopsis || '',
    posterUrl: movie.posterUrl || '/app-icon.jpg',
    backdropUrl: movie.backdropUrl,
    trailerUrl: movie.trailerUrl,
    videoUrl: movie.videoUrl || '',
    fileName: movie.fileName || `${movie.title}.mp4`,
    fileSizeBytes: Number(movie.fileSizeBytes) || 0,
    mimeType: movie.mimeType || 'video/mp4',
    downloads: Number(movie.downloads) || 0,
    featured: Boolean(movie.featured),
    uploader: movie.uploader || 'TempleSolo',
    imdbRating: Number(movie.imdbRating) || 7.8,
    ageRating: movie.ageRating,
    createdAt: movie.createdAt || new Date().toISOString(),
  };
}

export function buildAndSaveOfflineSearchIndex(movies: Movie[]): OfflineSearchIndexPayload | null {
  if (typeof window === 'undefined' || movies.length === 0) return null;

  const docs: Record<string, OfflineIndexedDoc> = {};
  const tokenSets = new Map<string, Set<string>>();

  for (const movie of movies) {
    if (!movie || !movie.id) continue;
    const doc = toIndexedDoc(movie);
    docs[movie.id] = doc;

    const searchableText = [
      doc.title,
      doc.director,
      doc.genre,
      doc.category,
      doc.country,
      String(doc.year),
      doc.quality,
      doc.synopsis,
    ].join(' ');

    const words = extractWords(searchableText);
    const expanded = expandIndexTokens(words);
    for (const token of expanded) {
      let set = tokenSets.get(token);
      if (!set) {
        set = new Set<string>();
        tokenSets.set(token, set);
      }
      set.add(movie.id);
    }
  }

  const tokens: Record<string, string[]> = {};
  for (const [token, idSet] of tokenSets.entries()) {
    tokens[token] = Array.from(idSet);
  }

  const payload: OfflineSearchIndexPayload = {
    version: 1,
    updatedAt: Date.now(),
    docs,
    tokens,
  };

  try {
    window.localStorage.setItem(OFFLINE_SEARCH_INDEX_KEY, JSON.stringify(payload));
  } catch {
    // Retry with compact synopsis if storage quota is tight
    try {
      const compactDocs: Record<string, OfflineIndexedDoc> = {};
      for (const [id, d] of Object.entries(docs)) {
        compactDocs[id] = { ...d, synopsis: d.synopsis.slice(0, 140) };
      }
      window.localStorage.setItem(
        OFFLINE_SEARCH_INDEX_KEY,
        JSON.stringify({ ...payload, docs: compactDocs })
      );
    } catch {
      // Ignore unrecoverable storage quota limits
    }
  }

  return payload;
}

export function loadOfflineSearchIndex(): OfflineSearchIndexPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OFFLINE_SEARCH_INDEX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineSearchIndexPayload>;
    if (
      parsed.version !== 1 ||
      !parsed.docs ||
      typeof parsed.docs !== 'object' ||
      !parsed.tokens ||
      typeof parsed.tokens !== 'object'
    ) {
      return null;
    }
    return parsed as OfflineSearchIndexPayload;
  } catch {
    return null;
  }
}

export function getOfflineIndexStats(): { indexedCount: number; updatedAt: number | null } {
  const index = loadOfflineSearchIndex();
  if (!index) return { indexedCount: 0, updatedAt: null };
  return {
    indexedCount: Object.keys(index.docs).length,
    updatedAt: index.updatedAt || null,
  };
}

export function hydrateMoviesFromOfflineIndex(): Movie[] {
  const index = loadOfflineSearchIndex();
  if (!index) return [];
  return Object.values(index.docs).map((doc) =>
    enrichMovie({
      id: doc.id,
      title: doc.title,
      genre: doc.genre as Movie['genre'],
      category: doc.category as Movie['category'],
      country: doc.country,
      year: doc.year,
      duration: doc.duration,
      quality: doc.quality as Movie['quality'],
      director: doc.director,
      uploader: doc.uploader,
      synopsis: doc.synopsis,
      imdbRating: doc.imdbRating,
      ageRating: doc.ageRating,
      posterUrl: doc.posterUrl,
      backdropUrl: doc.backdropUrl,
      trailerUrl: doc.trailerUrl,
      videoUrl: doc.videoUrl,
      fileName: doc.fileName,
      fileSizeBytes: doc.fileSizeBytes,
      mimeType: doc.mimeType,
      downloads: doc.downloads,
      featured: doc.featured,
      createdAt: doc.createdAt,
    })
  );
}

export function searchOfflineIndex(
  query: string,
  liveMovies: Movie[] = []
): {
  matchedIds: Set<string>;
  scores: Map<string, number>;
  usedLocalIndex: boolean;
  indexedCount: number;
} {
  const cleanQuery = query.trim();
  const storedIndex = loadOfflineSearchIndex();
  const indexedCount = storedIndex
    ? Object.keys(storedIndex.docs).length
    : liveMovies.length;

  if (!cleanQuery) {
    return {
      matchedIds: new Set(liveMovies.map((m) => m.id)),
      scores: new Map(),
      usedLocalIndex: Boolean(storedIndex),
      indexedCount,
    };
  }

  const terms = extractWords(cleanQuery);
  const scores = new Map<string, number>();

  // Score from persisted inverted token index in localStorage first
  if (storedIndex && terms.length > 0) {
    let candidateIds: Set<string> | null = null;
    for (const term of terms) {
      const lookupKey = term.length > 8 ? term.slice(0, 8) : term;
      const hits = storedIndex.tokens[term] || storedIndex.tokens[lookupKey] || [];
      const termSet = new Set<string>(hits);
      if (candidateIds === null) {
        candidateIds = termSet;
      } else {
        candidateIds = new Set<string>(Array.from<string>(candidateIds).filter((id) => termSet.has(id)));
      }
    }

    if (candidateIds) {
      const normalizedQuery = normalizeText(cleanQuery);
      for (const id of candidateIds) {
        const doc = storedIndex.docs[id];
        if (!doc) continue;
        const normTitle = normalizeText(doc.title);
        const normDirector = normalizeText(doc.director);
        const normGenre = normalizeText(`${doc.genre} ${doc.category} ${doc.country}`);
        const normSynopsis = normalizeText(doc.synopsis);

        // Verify full substring match when a term > 8 chars
        const allTermsPresent = terms.every(
          (term) =>
            normTitle.includes(term) ||
            normDirector.includes(term) ||
            normGenre.includes(term) ||
            String(doc.year).includes(term) ||
            normSynopsis.includes(term)
        );
        if (!allTermsPresent) continue;

        let rank = 10;
        if (normTitle === normalizedQuery) rank += 100;
        else if (normTitle.startsWith(normalizedQuery)) rank += 60;
        else if (normTitle.includes(normalizedQuery)) rank += 35;
        if (normDirector.includes(normalizedQuery)) rank += 20;
        if (normGenre.includes(normalizedQuery)) rank += 15;
        scores.set(id, rank);
      }
    }
  }

  // Also ensure any newest in-memory movies not yet written match seamlessly
  if (liveMovies.length > 0) {
    const normalizedQuery = normalizeText(cleanQuery);
    for (const m of liveMovies) {
      const haystack = normalizeText(
        `${m.title} ${m.director} ${m.genre} ${m.category || ''} ${m.country || ''} ${m.year} ${m.synopsis}`
      );
      const allMatch =
        terms.length > 0
          ? terms.every((t) => haystack.includes(t))
          : haystack.includes(normalizedQuery);
      if (allMatch) {
        const prev = scores.get(m.id) ?? 0;
        const normTitle = normalizeText(m.title);
        const boost = normTitle.startsWith(normalizedQuery)
          ? 65
          : normTitle.includes(normalizedQuery)
          ? 35
          : 10;
        scores.set(m.id, Math.max(prev, boost));
      }
    }
  }

  return {
    matchedIds: new Set(scores.keys()),
    scores,
    usedLocalIndex: Boolean(storedIndex),
    indexedCount,
  };
}

const KNOWN_GENRES: MovieGenre[] = [
  'Action',
  'Nollywood',
  'Sci-Fi',
  'Music',
  'Thriller',
  'Drama',
  'Mystery',
  'Comedy',
  'Documentary',
  'Animation',
  'Horror',
];

const KNOWN_QUALITIES: MovieQuality[] = ['4K UHD', '1080p HD', '720p HD'];

function matchesGenreFilter(movie: Movie, genre: 'All' | MovieGenre): boolean {
  if (genre === 'All') return true;
  if (genre === 'Music') {
    return movie.genre === 'Music' || movie.category === 'Music';
  }
  return movie.genre === genre;
}

export function queryCachedOfflineMovies(
  filters: OfflineSearchFilters,
  liveMovies: Movie[] = []
): OfflineSearchQueryResult {
  const {
    query = '',
    genre = 'All',
    quality = 'All',
    sortBy = 'relevance',
    savedOnly = false,
    savedMovieIds,
    downloadedOnly = false,
    downloadedMovieIds,
  } = filters;

  const storedIndex = loadOfflineSearchIndex();
  const indexedMovies = hydrateMoviesFromOfflineIndex();

  // Merge live in-memory movies with persisted localStorage index movies so offline mode
  // can search & filter the full cached catalog even when network data hasn't loaded.
  const mergedMap = new Map<string, Movie>();
  for (const indexedMovie of indexedMovies) {
    mergedMap.set(indexedMovie.id, indexedMovie);
  }
  for (const liveMovie of liveMovies) {
    if (liveMovie?.id) {
      mergedMap.set(liveMovie.id, enrichMovie(liveMovie));
    }
  }
  const sourceCatalog = Array.from(mergedMap.values());

  const cleanQuery = query.trim();
  const textSearch = searchOfflineIndex(cleanQuery, sourceCatalog);

  // Scope first by text query and collection toggles so facet counts remain accurate
  const baseScoped = sourceCatalog.filter((movie) => {
    if (savedOnly && savedMovieIds && !savedMovieIds.has(movie.id)) return false;
    if (downloadedOnly && downloadedMovieIds && !downloadedMovieIds.has(movie.id)) return false;
    if (cleanQuery && !textSearch.matchedIds.has(movie.id)) return false;
    return true;
  });

  const genreCounts: Record<string, number> = { All: 0 };
  for (const g of KNOWN_GENRES) {
    genreCounts[g] = 0;
  }
  for (const movie of baseScoped) {
    if (quality !== 'All' && movie.quality !== quality) continue;
    genreCounts.All += 1;
    for (const g of KNOWN_GENRES) {
      if (matchesGenreFilter(movie, g)) {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      }
    }
  }

  const qualityCounts: Record<string, number> = { All: 0 };
  for (const q of KNOWN_QUALITIES) {
    qualityCounts[q] = 0;
  }
  for (const movie of baseScoped) {
    if (!matchesGenreFilter(movie, genre)) continue;
    qualityCounts.All += 1;
    qualityCounts[movie.quality] = (qualityCounts[movie.quality] || 0) + 1;
  }

  const filtered = baseScoped.filter((movie) => {
    if (!matchesGenreFilter(movie, genre)) return false;
    if (quality !== 'All' && movie.quality !== quality) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'relevance' && cleanQuery) {
      const rankDiff = (textSearch.scores.get(b.id) || 0) - (textSearch.scores.get(a.id) || 0);
      if (rankDiff !== 0) return rankDiff;
    }
    if (sortBy === 'imdb') {
      const diff = (b.imdbRating ?? 7.8) - (a.imdbRating ?? 7.8);
      if (diff !== 0) return diff;
      return b.downloads - a.downloads;
    }
    if (sortBy === 'downloads') {
      const diff = b.downloads - a.downloads;
      if (diff !== 0) return diff;
    }
    if (sortBy === 'year') {
      const diff = b.year - a.year;
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
    }
    if (sortBy === 'oldest') {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title);
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return {
    results: sorted,
    totalCatalogCount: sourceCatalog.length,
    indexedCount: storedIndex ? Object.keys(storedIndex.docs).length : sourceCatalog.length,
    updatedAt: storedIndex?.updatedAt || null,
    usedLocalIndex: Boolean(storedIndex) || indexedMovies.length > 0,
    scores: textSearch.scores,
    genreCounts,
    qualityCounts,
  };
}

export function loadRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(term: string): string[] {
  const clean = term.trim();
  const current = loadRecentSearches();
  if (!clean) return current;
  const next = [clean, ...current.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 8);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
}

export function clearRecentSearches(): string[] {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  return [];
}

