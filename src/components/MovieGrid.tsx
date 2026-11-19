import { memo, useMemo, useState } from 'react';
import {
  Download,
  Play,
  MessageSquare,
  Search,
  Film,
  Upload,
  Bookmark,
  Star,
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { MovieRatingSummary } from '../hooks/useMovieRatings';
import type { Movie, MovieGenre, WatchProgressEntry } from '../types/cinema';
import { formatFileSize, formatPlaybackTime } from '../utils/format';
import { searchOfflineIndex } from '../utils/offlineSearchIndex';

export type CollectionFilter = 'all' | 'saved' | 'uploads';
export type CatalogSortOption = 'newest' | 'imdb' | 'downloads' | 'title';

interface MovieGridProps {
  movies: Movie[];
  isOffline?: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedGenre?: 'All' | MovieGenre;
  onSelectGenre?: (genre: 'All' | MovieGenre) => void;
  sortBy?: CatalogSortOption;
  onChangeSortBy?: (sort: CatalogSortOption) => void;
  collectionView: CollectionFilter;
  savedMovieIds: Set<string>;
  ratingsByMovie: Record<string, MovieRatingSummary>;
  reviewCountByMovie?: Record<string, number>;
  progressByMovie?: Record<string, WatchProgressEntry>;
  currentUserId?: string;
  isAdmin: boolean;
  onChangeCollectionView: (view: CollectionFilter) => void;
  onDownload: (movie: Movie) => void;
  onSelectMovie: (movie: Movie) => void;
  onPlayTrailer?: (movie: Movie) => void;
  onOpenRequestMovie?: () => void;
  onShareToChat: (movie: Movie) => void;
  onToggleSave: (movie: Movie) => void;
  onOpenUpload: () => void;
}

const GENRES: Array<'All' | MovieGenre> = [
  'All',
  'Action',
  'Nollywood',
  'Sci-Fi',
  'Music',
  'Drama',
  'Thriller',
  'Mystery',
  'Comedy',
  'Documentary',
  'Animation',
  'Horror',
];

const IMDB_RANGE_STEPS = ['6.0', '6.5', '7.0', '7.5', '8.0', '8.5', '9.0', '9.5', '10.0'];

function MoviePosterImage({ posterUrl, title }: { posterUrl: string; title: string }) {
  const [failed, setFailed] = useState(false);

  if (!posterUrl || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-[#18181B] to-[#09090B] p-6 text-center">
        <Film className="h-10 w-10 text-[#E5A93B]/60 mb-3" aria-hidden="true" />
        <span className="font-display text-sm font-medium text-[#D4D4D8] line-clamp-2">
          {title}
        </span>
      </div>
    );
  }

  return (
    <img
      src={posterUrl}
      alt={`${title} poster`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
}

export const MovieGrid = memo(function MovieGrid({
  movies,
  isOffline = false,
  searchQuery,
  onSearchChange,
  selectedGenre: controlledGenre,
  onSelectGenre,
  sortBy: controlledSort,
  onChangeSortBy,
  collectionView,
  savedMovieIds,
  ratingsByMovie,
  reviewCountByMovie = {},
  progressByMovie = {},
  currentUserId,
  isAdmin,
  onChangeCollectionView,
  onDownload,
  onSelectMovie,
  onPlayTrailer,
  onOpenRequestMovie,
  onShareToChat,
  onToggleSave,
  onOpenUpload,
}: MovieGridProps) {
  const { t } = useLanguage();
  const [internalGenre, setInternalGenre] = useState<'All' | MovieGenre>('All');
  const [internalSort, setInternalSort] = useState<CatalogSortOption>('newest');

  const [filtersOpen, setFiltersOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 640 : false
  );
  const [selectedDirector, setSelectedDirector] = useState<string>('All');
  const [selectedCountry, setSelectedCountry] = useState<string>('All');
  const [yearFrom, setYearFrom] = useState<string>('');
  const [yearTo, setYearTo] = useState<string>('');
  const [imdbMin, setImdbMin] = useState<string>('');
  const [imdbMax, setImdbMax] = useState<string>('');

  const selectedGenre = controlledGenre ?? internalGenre;
  const setSelectedGenre = onSelectGenre ?? setInternalGenre;
  const sortBy = controlledSort ?? internalSort;
  const setSortBy = onChangeSortBy ?? setInternalSort;

  const availableYears = useMemo(() => {
    const years = Array.from(
      new Set(movies.map((m) => m.year).filter((y) => Number.isFinite(y)))
    );
    return years.sort((a, b) => a - b);
  }, [movies]);

  const availableDirectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of movies) {
      const name = m.director?.trim();
      if (name) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [movies]);

  const availableCountries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of movies) {
      const country = m.country?.trim() || 'International';
      counts.set(country, (counts.get(country) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [movies]);

  const handleYearFromChange = (val: string) => {
    setYearFrom(val);
    if (val && yearTo && Number(val) > Number(yearTo)) {
      setYearTo(val);
    }
  };

  const handleYearToChange = (val: string) => {
    setYearTo(val);
    if (val && yearFrom && Number(val) < Number(yearFrom)) {
      setYearFrom(val);
    }
  };

  const handleImdbMinChange = (val: string) => {
    setImdbMin(val);
    if (val && imdbMax && Number(val) > Number(imdbMax)) {
      setImdbMax(val);
    }
  };

  const handleImdbMaxChange = (val: string) => {
    setImdbMax(val);
    if (val && imdbMin && Number(val) < Number(imdbMin)) {
      setImdbMin(val);
    }
  };

  const activeAdvancedCount =
    (selectedDirector !== 'All' ? 1 : 0) +
    (selectedCountry !== 'All' ? 1 : 0) +
    (yearFrom !== '' || yearTo !== '' ? 1 : 0) +
    (imdbMin !== '' || imdbMax !== '' ? 1 : 0);

  const hasAnyFilter =
    Boolean(searchQuery.trim()) ||
    selectedGenre !== 'All' ||
    activeAdvancedCount > 0;

  const resetAdvancedFilters = () => {
    setSelectedDirector('All');
    setSelectedCountry('All');
    setYearFrom('');
    setYearTo('');
    setImdbMin('');
    setImdbMax('');
  };

  const resetAllFilters = () => {
    onSearchChange('');
    setSelectedGenre('All');
    resetAdvancedFilters();
    onChangeCollectionView('all');
  };

  const offlineSearchResult = useMemo(
    () => searchOfflineIndex(searchQuery, movies),
    [searchQuery, movies]
  );

  const scopedMovies = movies.filter((m) => {
    if (collectionView === 'saved' && !savedMovieIds.has(m.id)) return false;
    if (collectionView === 'uploads' && (!currentUserId || m.ownerUid !== currentUserId)) {
      return false;
    }
    if (selectedDirector !== 'All' && m.director.trim() !== selectedDirector) {
      return false;
    }
    if (selectedCountry !== 'All' && (m.country?.trim() || 'International') !== selectedCountry) {
      return false;
    }
    if (yearFrom !== '' && m.year < Number(yearFrom)) {
      return false;
    }
    if (yearTo !== '' && m.year > Number(yearTo)) {
      return false;
    }
    const score = m.imdbRating ?? 7.8;
    if (imdbMin !== '' && score < Number(imdbMin)) {
      return false;
    }
    if (imdbMax !== '' && score > Number(imdbMax)) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    return offlineSearchResult.matchedIds.has(m.id);
  });

  const categoryCounts = GENRES.reduce<Record<string, number>>((acc, genre) => {
    acc[genre] =
      genre === 'All'
        ? scopedMovies.length
        : genre === 'Music'
        ? scopedMovies.filter((m) => m.genre === 'Music' || m.category === 'Music').length
        : scopedMovies.filter((m) => m.genre === genre).length;
    return acc;
  }, {});

  const filtered = scopedMovies
    .filter((m) => {
      if (selectedGenre === 'All') return true;
      if (selectedGenre === 'Music') return m.genre === 'Music' || m.category === 'Music';
      return m.genre === selectedGenre;
    })
    .sort((a, b) => {
      if (searchQuery.trim()) {
        const rankDiff =
          (offlineSearchResult.scores.get(b.id) || 0) -
          (offlineSearchResult.scores.get(a.id) || 0);
        if (rankDiff !== 0) return rankDiff;
      }
      if (sortBy === 'imdb') return (b.imdbRating ?? 7.8) - (a.imdbRating ?? 7.8);
      if (sortBy === 'downloads') return b.downloads - a.downloads;
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <section id="catalog" className="py-8 w-full max-w-full min-w-0 overflow-x-clip">
      <div className="flex flex-col gap-5 mb-6 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA]">
              {t('catalogTitle')}
            </h2>
            <p className="text-sm text-[#A1A1AA] mt-1">
              {t('catalogSubtitle')}
            </p>
            {(isOffline || offlineSearchResult.usedLocalIndex) && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[11px] text-[#E6A93C]">
                <span>
                  {isOffline ? 'Offline Search Index Active' : 'Local Search Index Ready'} ·{' '}
                  {offlineSearchResult.indexedCount} cached titles
                </span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            <div className="relative flex-1 min-w-0 w-full sm:w-60">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717A]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                className="w-full rounded-lg border border-[#27272A] bg-[#111114] py-2 pl-9 pr-3 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as CatalogSortOption)}
              aria-label="Sort movies"
              className="rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none cursor-pointer"
            >
              <option value="newest">{t('sortNewest')}</option>
              <option value="imdb">{t('sortImdb')}</option>
              <option value="downloads">{t('sortDownloads')}</option>
              <option value="title">{t('sortTitle')}</option>
            </select>

            <button
              type="button"
              onClick={() => setFiltersOpen((prev) => !prev)}
              aria-expanded={filtersOpen}
              aria-controls="catalog-advanced-filters"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filtersOpen || activeAdvancedCount > 0
                  ? 'border-[#E5A93B]/60 bg-[#E5A93B]/10 text-[#E5A93B]'
                  : 'border-[#27272A] bg-[#111114] text-[#FAFAFA] hover:border-[#3F3F46]'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('filtersToggle')}</span>
              {activeAdvancedCount > 0 && (
                <span className="font-mono text-xs tabular-nums">({activeAdvancedCount})</span>
              )}
            </button>
          </div>
        </div>

        {/* Advanced Filtering Controls: Release Year Range, Director, Country, IMDb Rating Range */}
        {filtersOpen && (
          <div
            id="catalog-advanced-filters"
            className="rounded-xl border border-[#27272A] bg-[#111114] p-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Release Year Range */}
              <div>
                <span className="block text-[11px] font-mono uppercase tracking-wider text-[#A1A1AA] mb-1.5">
                  {t('filterYearRange')}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={yearFrom}
                    onChange={(e) => handleYearFromChange(e.target.value)}
                    aria-label={`${t('filterYearRange')} ${t('fromLabel')}`}
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-2.5 py-2 text-xs font-mono tabular-nums text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none cursor-pointer"
                  >
                    <option value="">{t('fromLabel')}: {t('anyOption')}</option>
                    {availableYears.map((y) => (
                      <option key={`from-${y}`} value={String(y)}>
                        {y}
                      </option>
                    ))}
                  </select>

                  <select
                    value={yearTo}
                    onChange={(e) => handleYearToChange(e.target.value)}
                    aria-label={`${t('filterYearRange')} ${t('toLabel')}`}
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-2.5 py-2 text-xs font-mono tabular-nums text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none cursor-pointer"
                  >
                    <option value="">{t('toLabel')}: {t('anyOption')}</option>
                    {availableYears.map((y) => (
                      <option key={`to-${y}`} value={String(y)}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Director Filter */}
              <div>
                <label
                  htmlFor="catalog-director-filter"
                  className="block text-[11px] font-mono uppercase tracking-wider text-[#A1A1AA] mb-1.5"
                >
                  {t('filterDirector')}
                </label>
                <select
                  id="catalog-director-filter"
                  value={selectedDirector}
                  onChange={(e) => setSelectedDirector(e.target.value)}
                  className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none cursor-pointer"
                >
                  <option value="All">{t('allDirectors')}</option>
                  {availableDirectors.map(([director, count]) => (
                    <option key={director} value={director}>
                      {director} ({count})
                    </option>
                  ))}
                </select>
              </div>

              {/* Country Filter */}
              <div>
                <label
                  htmlFor="catalog-country-filter"
                  className="block text-[11px] font-mono uppercase tracking-wider text-[#A1A1AA] mb-1.5"
                >
                  Country
                </label>
                <select
                  id="catalog-country-filter"
                  value={selectedCountry}
                  onChange={(e) => setSelectedCountry(e.target.value)}
                  className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none cursor-pointer"
                >
                  <option value="All">All Countries</option>
                  {availableCountries.map(([country, count]) => (
                    <option key={country} value={country}>
                      {country} ({count})
                    </option>
                  ))}
                </select>
              </div>

              {/* IMDb Rating Range */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-[#A1A1AA]">
                    {t('filterImdbRange')}
                  </span>
                  {activeAdvancedCount > 0 && (
                    <button
                      type="button"
                      onClick={resetAdvancedFilters}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#E5A93B] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      <span>{t('resetFilters')}</span>
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={imdbMin}
                    onChange={(e) => handleImdbMinChange(e.target.value)}
                    aria-label={`${t('filterImdbRange')} ${t('fromLabel')}`}
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-2.5 py-2 text-xs font-mono tabular-nums text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none cursor-pointer"
                  >
                    <option value="">Min: {t('anyOption')}</option>
                    {IMDB_RANGE_STEPS.slice(0, -1).map((val) => (
                      <option key={`imdb-min-${val}`} value={val}>
                        {val}+
                      </option>
                    ))}
                  </select>

                  <select
                    value={imdbMax}
                    onChange={(e) => handleImdbMaxChange(e.target.value)}
                    aria-label={`${t('filterImdbRange')} ${t('toLabel')}`}
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-2.5 py-2 text-xs font-mono tabular-nums text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none cursor-pointer"
                  >
                    <option value="">Max: {t('anyOption')}</option>
                    {IMDB_RANGE_STEPS.slice(1).map((val) => (
                      <option key={`imdb-max-${val}`} value={val}>
                        {val}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Collection Scope + Genre Filter Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
          <div className="flex max-w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-lg border border-[#27272A] bg-[#111114] p-1">
            {(
              [
                { id: 'all', label: t('allMovies') },
                { id: 'saved', label: `${t('navSaved')} (${savedMovieIds.size})` },
                ...(isAdmin ? [{ id: 'uploads' as const, label: t('navUploads') }] : []),
              ] as const
            ).map((tab) => {
              const active = collectionView === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onChangeCollectionView(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[#E5A93B] text-[#09090B] font-semibold'
                      : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenRequestMovie && (
              <button
                type="button"
                onClick={onOpenRequestMovie}
                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-[#E6A93C]/50 bg-[#E6A93C]/10 px-3.5 py-2 text-xs font-semibold text-[#E6A93C] hover:bg-[#E6A93C]/20 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Film className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Request a Movie</span>
              </button>
            )}

            {isAdmin && (
              <button
                type="button"
                onClick={onOpenUpload}
                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] transition-colors whitespace-nowrap cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                <span>{t('uploadNewMovie')}</span>
              </button>
            )}
          </div>
        </div>

        <div className="border-b border-[#27272A] min-w-0 max-w-full">
          <div
            className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full"
            role="tablist"
            aria-label="Filter movies by category"
          >
            {GENRES.map((genre) => {
              const active = selectedGenre === genre;
              const count = categoryCounts[genre] ?? 0;
              return (
                <button
                  key={genre}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedGenre(genre)}
                  className={`relative inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-[#E5A93B] text-[#FAFAFA] font-semibold'
                      : 'border-transparent text-[#A1A1AA] hover:text-[#FAFAFA] hover:border-[#3F3F46]'
                  }`}
                >
                  <span>{genre === 'All' ? t('allCategory') : genre}</span>
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      active ? 'text-[#E5A93B]' : 'text-[#71717A]'
                    }`}
                  >
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {hasAnyFilter && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#A1A1AA] min-w-0">
            <p className="font-mono tabular-nums break-words min-w-0">
              {t('showingLabel')} {filtered.length}{' '}
              {filtered.length === 1 ? t('movieSingular') : t('moviePlural')}
              {selectedGenre !== 'All' ? ` ${t('inCategory')} ${selectedGenre}` : ''}
              {selectedCountry !== 'All' ? ` · ${selectedCountry}` : ''}
              {selectedDirector !== 'All' ? ` · ${t('filterDirector')}: ${selectedDirector}` : ''}
              {(yearFrom || yearTo)
                ? ` · ${yearFrom || availableYears[0] || ''}–${yearTo || availableYears[availableYears.length - 1] || ''}`
                : ''}
              {(imdbMin || imdbMax)
                ? ` · IMDb ${imdbMin || '1.0'}–${imdbMax || '10.0'}`
                : ''}
              {searchQuery.trim() ? ` ${t('matchingQuery')} “${searchQuery.trim()}”` : ''}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {selectedGenre !== 'All' && (
                <button
                  type="button"
                  onClick={() => setSelectedGenre('All')}
                  className="text-[#E5A93B] hover:underline cursor-pointer"
                >
                  {t('allCategoriesReset')}
                </button>
              )}
              {activeAdvancedCount > 0 && (
                <button
                  type="button"
                  onClick={resetAdvancedFilters}
                  className="text-[#E5A93B] hover:underline cursor-pointer"
                >
                  {t('resetFilters')}
                </button>
              )}
              {searchQuery.trim() && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="text-[#E5A93B] hover:underline cursor-pointer"
                >
                  {t('clearSearch')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Movie Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-[#27272A] bg-[#111114] py-16 px-6 text-center">
          <Film className="mx-auto h-9 w-9 text-[#71717A] mb-3" aria-hidden="true" />
          <p className="text-base font-medium text-[#FAFAFA] mb-1">
            {collectionView === 'saved'
              ? t('emptySavedTitle')
              : collectionView === 'uploads'
              ? t('emptyUploadsTitle')
              : t('emptyMatchTitle')}
          </p>
          <p className="text-sm text-[#A1A1AA] mb-5">
            {collectionView === 'saved'
              ? t('emptySavedHint')
              : collectionView === 'uploads'
              ? t('emptyUploadsHint')
              : isAdmin
              ? t('emptyMatchAdminHint')
              : t('emptyMatchViewerHint')}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={resetAllFilters}
              className="rounded-lg border border-[#27272A] bg-[#18181B] px-4 py-2 text-xs font-medium text-[#FAFAFA] hover:bg-[#27272A] cursor-pointer"
            >
              {t('viewAllMovies')}
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenUpload}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('uploadMovie')}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((movie) => {
            const isSaved = savedMovieIds.has(movie.id);
            const imdbScore = (movie.imdbRating ?? 7.8).toFixed(1);
            const watchProgress = progressByMovie[movie.id];
            const progressPct =
              watchProgress && watchProgress.durationSeconds > 0
                ? Math.min(
                    99,
                    Math.max(2, Math.round((watchProgress.progressSeconds / watchProgress.durationSeconds) * 100))
                  )
                : 0;
            return (
              <article
                key={movie.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-[#27272A] bg-[#111114] transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#3F3F46]"
              >
                <div
                  onClick={() => onSelectMovie(movie)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectMovie(movie);
                    }
                  }}
                  aria-label={`Open details for ${movie.title}`}
                  className="relative aspect-[3/4] w-full overflow-hidden bg-[#18181B] cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#E5A93B]"
                >
                  <MoviePosterImage posterUrl={movie.posterUrl} title={movie.title} />

                  <div className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-transparent to-transparent opacity-80" />

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSave(movie);
                    }}
                    aria-label={isSaved ? `Remove ${movie.title} from watchlist` : `Save ${movie.title} to watchlist`}
                    title={isSaved ? 'Saved in watchlist' : 'Save to watchlist'}
                    className={`absolute top-3 right-3 rounded-lg p-2 backdrop-blur-sm border transition-colors cursor-pointer ${
                      isSaved
                        ? 'bg-[#E5A93B] border-[#E5A93B] text-[#09090B]'
                        : 'bg-[#09090B]/70 border-[#27272A] text-[#FAFAFA] hover:border-[#E5A93B]'
                    }`}
                  >
                    <Bookmark
                      className={`h-4 w-4 ${isSaved ? 'fill-current' : ''}`}
                      aria-hidden="true"
                    />
                  </button>

                  <div className="absolute bottom-3 left-3.5 right-3.5 flex items-center justify-between gap-2 text-xs font-mono tabular-nums text-[#D4D4D8]">
                    <span>
                      {movie.quality} · IMDb {imdbScore}
                      {watchProgress
                        ? ` · ${t('resumePlayback')} ${formatPlaybackTime(watchProgress.progressSeconds)}`
                        : ''}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[#FAFAFA] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Play className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                      {t('preview')}
                    </span>
                  </div>

                  {progressPct > 0 && (
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-[#27272A]">
                      <div
                        className="h-full bg-[#E5A93B]"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#A1A1AA] mb-1.5">
                      <span>{movie.genre}</span>
                      {movie.country && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{movie.country}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{movie.year}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{movie.duration}</span>
                    </div>

                    <h3 className="font-display text-lg font-semibold text-[#FAFAFA] leading-snug line-clamp-1 mb-1">
                      <button
                        type="button"
                        onClick={() => onSelectMovie(movie)}
                        className="text-left hover:text-[#E5A93B] transition-colors cursor-pointer"
                      >
                        {movie.title}
                      </button>
                    </h3>

                    <p className="text-[11px] text-[#71717A] mb-2 truncate">
                      {t('directedBy')} <span className="text-[#D4D4D8]">{movie.director}</span>
                    </p>

                    <p className="text-xs text-[#A1A1AA] line-clamp-2 leading-relaxed mb-4">
                      {movie.synopsis}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-[#27272A]/80">
                    <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums text-[#71717A] mb-3">
                      <span className="truncate">
                        {formatFileSize(movie.fileSizeBytes)} · {movie.downloads.toLocaleString()} dl
                      </span>
                      <span className="inline-flex items-center gap-1 text-[#D4D4D8] shrink-0">
                        <Star
                          className={`h-3.5 w-3.5 ${
                            ratingsByMovie[movie.id]?.count
                              ? 'text-[#E5A93B] fill-[#E5A93B]'
                              : 'text-[#52525B]'
                          }`}
                          aria-hidden="true"
                        />
                        {ratingsByMovie[movie.id]?.count ? (
                          <span>
                            {ratingsByMovie[movie.id].average.toFixed(1)} ({ratingsByMovie[movie.id].count})
                            {reviewCountByMovie[movie.id]
                              ? ` · ${reviewCountByMovie[movie.id]} rev`
                              : ''}
                          </span>
                        ) : (
                          <span className="text-[#71717A]">{t('unrated')}</span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onDownload(movie)}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#E5A93B] px-3.5 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] transition-all whitespace-nowrap cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{t('download')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectMovie(movie)}
                        className="inline-flex items-center justify-center rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#FAFAFA] hover:bg-[#27272A] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        {t('watch')}
                      </button>

                      {onPlayTrailer && (
                        <button
                          type="button"
                          onClick={() => onPlayTrailer(movie)}
                          title="Watch trailer preview"
                          className="inline-flex items-center justify-center rounded-lg border border-[#27272A] bg-[#18181B] px-2.5 py-2 text-xs font-medium text-[#E6A93C] hover:border-[#E6A93C] transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Trailer
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onShareToChat(movie)}
                        aria-label={`Share ${movie.title} in chat`}
                        title="Share to community chat"
                        className="inline-flex items-center justify-center rounded-lg border border-[#27272A] bg-[#18181B] p-2 text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#27272A] transition-colors cursor-pointer"
                      >
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
});
