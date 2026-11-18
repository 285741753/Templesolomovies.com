import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  CheckCircle2,
  Download,
  Film,
  HardDrive,
  MessageSquare,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  WifiOff,
  X,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { MovieRatingSummary } from '../hooks/useMovieRatings';
import type {
  Movie,
  MovieGenre,
  MovieQuality,
  WatchProgressEntry,
} from '../types/cinema';
import { formatFileSize, formatPlaybackTime } from '../utils/format';
import {
  clearRecentSearches,
  loadRecentSearches,
  queryCachedOfflineMovies,
  saveRecentSearch,
  type SearchSortOrder,
} from '../utils/offlineSearchIndex';

export interface SearchPageProps {
  movies: Movie[];
  isOffline: boolean;
  searchQuery: string;
  selectedGenre: 'All' | MovieGenre;
  selectedQuality: 'All' | MovieQuality;
  sortBy: SearchSortOrder;
  savedMovieIds: Set<string>;
  downloadedMovieIds: Set<string>;
  ratingsByMovie: Record<string, MovieRatingSummary>;
  reviewCountByMovie?: Record<string, number>;
  progressByMovie?: Record<string, WatchProgressEntry>;
  onSearchChange: (query: string) => void;
  onSelectGenre: (genre: 'All' | MovieGenre) => void;
  onSelectQuality: (quality: 'All' | MovieQuality) => void;
  onChangeSortBy: (sort: SearchSortOrder) => void;
  onBackHome: () => void;
  onOpenDownloads: () => void;
  onSelectMovie: (movie: Movie) => void;
  onPlayTrailer?: (movie: Movie) => void;
  onDownload: (movie: Movie) => void;
  onToggleSave: (movie: Movie) => void;
  onShareToChat: (movie: Movie) => void;
}

const GENRE_OPTIONS: Array<'All' | MovieGenre> = [
  'All',
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

const QUALITY_OPTIONS: Array<'All' | MovieQuality> = [
  'All',
  '4K UHD',
  '1080p HD',
  '720p HD',
];

function SearchPosterImage({ posterUrl, title }: { posterUrl: string; title: string }) {
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

export function SearchPage({
  movies,
  isOffline,
  searchQuery,
  selectedGenre,
  selectedQuality,
  sortBy,
  savedMovieIds,
  downloadedMovieIds,
  ratingsByMovie,
  reviewCountByMovie = {},
  progressByMovie = {},
  onSearchChange,
  onSelectGenre,
  onSelectQuality,
  onChangeSortBy,
  onBackHome,
  onOpenDownloads,
  onSelectMovie,
  onPlayTrailer,
  onDownload,
  onToggleSave,
  onShareToChat,
}: SearchPageProps) {
  const { t } = useLanguage();
  const [savedOnly, setSavedOnly] = useState(false);
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());
  const [mobileFiltersExpanded, setMobileFiltersExpanded] = useState(true);

  const queryOutput = useMemo(
    () =>
      queryCachedOfflineMovies(
        {
          query: searchQuery,
          genre: selectedGenre,
          quality: selectedQuality,
          sortBy,
          savedOnly,
          savedMovieIds,
          downloadedOnly,
          downloadedMovieIds,
        },
        movies
      ),
    [
      searchQuery,
      selectedGenre,
      selectedQuality,
      sortBy,
      savedOnly,
      savedMovieIds,
      downloadedOnly,
      downloadedMovieIds,
      movies,
    ]
  );

  const {
    results,
    totalCatalogCount,
    indexedCount,
    updatedAt,
    usedLocalIndex,
    genreCounts,
    qualityCounts,
  } = queryOutput;

  const activeFilterItems = useMemo(() => {
    const sortLabels: Record<SearchSortOrder, string> = {
      relevance: 'Best Match',
      newest: t('sortNewest'),
      imdb: t('sortImdb'),
      downloads: t('sortDownloads'),
      year: 'Release Year',
      title: t('sortTitle'),
      oldest: 'Oldest First',
    };

    const items: Array<{ id: string; label: string; onClear: () => void }> = [];
    if (selectedGenre !== 'All') {
      items.push({
        id: 'genre',
        label: `Genre: ${selectedGenre}`,
        onClear: () => onSelectGenre('All'),
      });
    }
    if (selectedQuality !== 'All') {
      items.push({
        id: 'quality',
        label: `Quality: ${selectedQuality}`,
        onClear: () => onSelectQuality('All'),
      });
    }
    if (searchQuery.trim()) {
      items.push({
        id: 'query',
        label: `Search: “${searchQuery.trim()}”`,
        onClear: () => onSearchChange(''),
      });
    }
    if (savedOnly) {
      items.push({
        id: 'saved',
        label: 'Scope: Saved',
        onClear: () => setSavedOnly(false),
      });
    }
    if (downloadedOnly) {
      items.push({
        id: 'downloaded',
        label: 'Scope: Offline Ready',
        onClear: () => setDownloadedOnly(false),
      });
    }
    if (sortBy !== 'relevance') {
      items.push({
        id: 'sort',
        label: `Sort: ${sortLabels[sortBy]}`,
        onClear: () => onChangeSortBy('relevance'),
      });
    }
    return items;
  }, [
    selectedGenre,
    selectedQuality,
    searchQuery,
    savedOnly,
    downloadedOnly,
    sortBy,
    onSelectGenre,
    onSelectQuality,
    onSearchChange,
    onChangeSortBy,
    t,
  ]);

  const hasActiveFilters = activeFilterItems.length > 0;

  const formattedUpdatedAt = useMemo(() => {
    if (!updatedAt) return '';
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(updatedAt));
    } catch {
      return '';
    }
  }, [updatedAt]);

  const handleSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setRecentSearches(saveRecentSearch(searchQuery));
    }
  };

  const handleResetAll = () => {
    onSearchChange('');
    onSelectGenre('All');
    onSelectQuality('All');
    onChangeSortBy('relevance');
    setSavedOnly(false);
    setDownloadedOnly(false);
  };

  const handleApplyRecent = (term: string) => {
    onSearchChange(term);
    setRecentSearches(saveRecentSearch(term));
  };

  return (
    <section
      id="search-page"
      aria-label="Dedicated movie search page"
      className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 pt-5 pb-12 overflow-x-clip min-w-0"
    >
      {/* Top Page Navigation Bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 min-w-0">
        <button
          type="button"
          onClick={onBackHome}
          className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-[#27272A] bg-[#111114] px-4 py-2 text-xs font-medium text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('navHome')}</span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setMobileFiltersExpanded((prev) => !prev)}
            aria-expanded={mobileFiltersExpanded}
            aria-controls="search-filters-panel"
            className={`sm:hidden min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
              mobileFiltersExpanded
                ? 'border-[#E6A93C]/60 bg-[#E6A93C]/10 text-[#E6A93C]'
                : 'border-[#27272A] bg-[#111114] text-[#D4D4D8]'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('filtersToggle')}</span>
          </button>

          <button
            type="button"
            onClick={onOpenDownloads}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#27272A] bg-[#111114] px-4 py-2 text-xs font-semibold text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#FAFAFA] whitespace-nowrap cursor-pointer transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
            <span>{t('navDownloads')}</span>
          </button>
        </div>
      </div>

      {/* Dedicated Search Hero Header & Primary Search Input */}
      <div className="rounded-2xl border border-[#27272A] bg-[#111114] p-4 sm:p-6 mb-6 min-w-0">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-5 min-w-0">
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA]">
              {t('navSearch')}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#A1A1AA]">
              {isOffline ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-[#E6A93C]">
                  <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Offline Mode</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-medium text-[#E6A93C]">
                  <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{usedLocalIndex ? 'Cached Search Index Ready' : 'Live Search'}</span>
                </span>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {indexedCount} cached {indexedCount === 1 ? 'title' : 'titles'}
              </span>
              {formattedUpdatedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Synced {formattedUpdatedAt}</span>
                </>
              )}
            </div>
          </div>

          {/* Dedicated Search Input */}
          <form
            onSubmit={handleSubmitSearch}
            role="search"
            aria-label="Search cached movies"
            className="relative w-full lg:max-w-md min-w-0"
          >
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A1A1AA]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Title, director, genre, year, or keyword..."
              aria-label="Search cached movies"
              className="w-full min-h-[44px] rounded-xl border border-[#3F3F46] bg-[#09090B] py-2.5 pl-10 pr-11 text-base text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E6A93C] focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label={t('clearSearch')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </form>
        </div>

        {/* Recent Searches */}
        {recentSearches.length > 0 && (
          <div className="mb-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 max-w-full">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#71717A] shrink-0">
              Recent:
            </span>
            {recentSearches.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => handleApplyRecent(term)}
                className="min-h-[36px] rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-1 text-xs text-[#D4D4D8] hover:border-[#E6A93C] hover:text-[#FAFAFA] whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                {term}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRecentSearches(clearRecentSearches())}
              className="text-xs text-[#71717A] hover:text-[#E6A93C] whitespace-nowrap shrink-0 cursor-pointer ml-1"
            >
              Clear history
            </button>
          </div>
        )}

        {/* Filter Controls: Quality, Sort Order, Scope Toggles & Genre Tabs */}
        {mobileFiltersExpanded && (
          <div id="search-filters-panel" className="space-y-4 border-t border-[#27272A] pt-4 min-w-0">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end min-w-0">
              {/* Quality Filter */}
              <div className="md:col-span-6 min-w-0">
                <span className="block text-xs font-medium text-[#A1A1AA] mb-2">
                  Video Quality
                </span>
                <div
                  role="group"
                  aria-label="Filter by video quality"
                  className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full"
                >
                  {QUALITY_OPTIONS.map((q) => {
                    const active = selectedQuality === q;
                    const count = qualityCounts[q] ?? 0;
                    return (
                      <button
                        key={q}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onSelectQuality(q)}
                        className={`min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          active
                            ? 'border-[#E6A93C] bg-[#E6A93C] text-[#09090B] font-semibold'
                            : 'border-[#27272A] bg-[#09090B] text-[#D4D4D8] hover:border-[#3F3F46] hover:text-[#FAFAFA]'
                        }`}
                      >
                        <span>{q === 'All' ? 'All Qualities' : q}</span>
                        <span
                          className={`font-mono text-[11px] tabular-nums ${
                            active ? 'text-[#09090B]/80' : 'text-[#71717A]'
                          }`}
                        >
                          ({count})
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sort Order Selector */}
              <div className="md:col-span-3 min-w-0">
                <label
                  htmlFor="search-sort-select"
                  className="block text-xs font-medium text-[#A1A1AA] mb-2"
                >
                  Sort Order
                </label>
                <select
                  id="search-sort-select"
                  value={sortBy}
                  onChange={(e) => onChangeSortBy(e.target.value as SearchSortOrder)}
                  className="w-full min-h-[44px] rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-base text-[#FAFAFA] focus:border-[#E6A93C] focus:outline-none cursor-pointer"
                >
                  <option value="relevance">Best Match</option>
                  <option value="newest">{t('sortNewest')}</option>
                  <option value="imdb">{t('sortImdb')}</option>
                  <option value="downloads">{t('sortDownloads')}</option>
                  <option value="year">Release Year (Newest)</option>
                  <option value="title">{t('sortTitle')}</option>
                  <option value="oldest">Oldest First</option>
                </select>
              </div>

              {/* Quick Library Scope */}
              <div className="md:col-span-3 min-w-0">
                <span className="block text-xs font-medium text-[#A1A1AA] mb-2">
                  Library Scope
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={savedOnly}
                    onClick={() => setSavedOnly((prev) => !prev)}
                    className={`flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      savedOnly
                        ? 'border-[#E6A93C] bg-[#E6A93C]/15 text-[#E6A93C]'
                        : 'border-[#27272A] bg-[#09090B] text-[#D4D4D8] hover:border-[#3F3F46]'
                    }`}
                  >
                    <Bookmark className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Saved ({savedMovieIds.size})</span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={downloadedOnly}
                    onClick={() => setDownloadedOnly((prev) => !prev)}
                    className={`flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      downloadedOnly
                        ? 'border-[#E6A93C] bg-[#E6A93C]/15 text-[#E6A93C]'
                        : 'border-[#27272A] bg-[#09090B] text-[#D4D4D8] hover:border-[#3F3F46]'
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Offline ({downloadedMovieIds.size})</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Genre Filter Tabs */}
            <div className="border-t border-[#27272A] pt-3 min-w-0 max-w-full">
              <div
                className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full"
                role="tablist"
                aria-label="Filter search results by genre"
              >
                {GENRE_OPTIONS.map((genre) => {
                  const active = selectedGenre === genre;
                  const count = genreCounts[genre] ?? 0;
                  return (
                    <button
                      key={genre}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => onSelectGenre(genre)}
                      className={`min-h-[44px] inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'border-[#E6A93C] text-[#FAFAFA] font-semibold'
                          : 'border-transparent text-[#A1A1AA] hover:text-[#FAFAFA] hover:border-[#3F3F46]'
                      }`}
                    >
                      <span>{genre === 'All' ? t('allCategory') : genre}</span>
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          active ? 'text-[#E6A93C]' : 'text-[#71717A]'
                        }`}
                      >
                        ({count})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Current Filters Active Label Summary & Results Count */}
      <div className="mb-5 space-y-3 min-w-0">
        {hasActiveFilters && (
          <div
            role="region"
            aria-label="Current filters"
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[#27272A] bg-[#111114] px-4 py-3 min-w-0"
          >
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-[#FAFAFA] whitespace-nowrap shrink-0">
                Current filters:
              </span>
              {activeFilterItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onClear}
                  aria-label={`Remove ${item.label}`}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[#E6A93C]/40 bg-[#E6A93C]/10 px-3 py-1.5 text-xs font-medium text-[#E6A93C] hover:bg-[#E6A93C]/20 transition-colors max-w-full cursor-pointer"
                >
                  <span className="truncate max-w-[200px] sm:max-w-[260px]">{item.label}</span>
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleResetAll}
              className="min-h-[44px] self-start sm:self-auto inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] px-3.5 py-2 text-xs font-semibold text-[#FAFAFA] hover:border-[#E6A93C] hover:text-[#E6A93C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Clear all filters</span>
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#A1A1AA] min-w-0">
          <p className="font-mono tabular-nums break-words min-w-0">
            {t('showingLabel')} {results.length} of {totalCatalogCount}{' '}
            {totalCatalogCount === 1 ? t('movieSingular') : t('moviePlural')}
            {selectedGenre !== 'All' ? ` · Genre: ${selectedGenre}` : ''}
            {selectedQuality !== 'All' ? ` · Quality: ${selectedQuality}` : ''}
            {savedOnly ? ' · Saved' : ''}
            {downloadedOnly ? ' · Offline Ready' : ''}
            {searchQuery.trim() ? ` · “${searchQuery.trim()}”` : ''}
          </p>
        </div>
      </div>

      {/* Results Grid or Empty State */}
      {results.length === 0 ? (
        <div className="rounded-2xl border border-[#27272A] bg-[#111114] py-16 px-6 text-center">
          <Film className="mx-auto h-10 w-10 text-[#71717A] mb-3" aria-hidden="true" />
          <p className="font-display text-lg font-semibold text-[#FAFAFA] mb-1">
            {totalCatalogCount === 0
              ? 'No cached movies indexed yet'
              : t('emptyMatchTitle')}
          </p>
          <p className="text-sm text-[#A1A1AA] max-w-md mx-auto mb-6">
            {totalCatalogCount === 0
              ? 'Connect to the internet once to sync the catalog into your local search index.'
              : 'Try adjusting your genre, quality, sort order, or search keywords.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetAll}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#E6A93C] px-5 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('viewAllMovies')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onBackHome}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-[#27272A] bg-[#18181B] px-5 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#E6A93C] cursor-pointer"
            >
              <span>← {t('navHome')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {results.map((movie) => {
            const isSaved = savedMovieIds.has(movie.id);
            const isOfflineReady = downloadedMovieIds.has(movie.id);
            const imdbScore = (movie.imdbRating ?? 7.8).toFixed(1);
            const watchProgress = progressByMovie[movie.id];
            const progressPct =
              watchProgress && watchProgress.durationSeconds > 0
                ? Math.min(
                    99,
                    Math.max(
                      2,
                      Math.round((watchProgress.progressSeconds / watchProgress.durationSeconds) * 100)
                    )
                  )
                : 0;

            return (
              <article
                key={movie.id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-[#27272A] bg-[#111114] transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#3F3F46]"
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
                  className="relative aspect-[3/4] w-full overflow-hidden bg-[#18181B] cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#E6A93C]"
                >
                  <SearchPosterImage posterUrl={movie.posterUrl} title={movie.title} />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-transparent to-transparent opacity-80" />

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSave(movie);
                    }}
                    aria-label={
                      isSaved
                        ? `Remove ${movie.title} from watchlist`
                        : `Save ${movie.title} to watchlist`
                    }
                    className={`absolute top-3 right-3 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl backdrop-blur-sm border transition-colors cursor-pointer ${
                      isSaved
                        ? 'bg-[#E6A93C] border-[#E6A93C] text-[#09090B]'
                        : 'bg-[#09090B]/75 border-[#27272A] text-[#FAFAFA] hover:border-[#E6A93C]'
                    }`}
                  >
                    <Bookmark
                      className={`h-4 w-4 ${isSaved ? 'fill-current' : ''}`}
                      aria-hidden="true"
                    />
                  </button>

                  <div className="absolute bottom-3 left-3.5 right-3.5 flex items-center justify-between gap-2 text-xs font-mono tabular-nums text-[#D4D4D8]">
                    <span className="truncate">
                      {movie.quality} · IMDb {imdbScore}
                      {watchProgress
                        ? ` · ${formatPlaybackTime(watchProgress.progressSeconds)}`
                        : ''}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[#FAFAFA] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Play className="h-3.5 w-3.5 text-[#E6A93C]" aria-hidden="true" />
                      <span>{t('preview')}</span>
                    </span>
                  </div>

                  {progressPct > 0 && (
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-[#27272A]">
                      <div className="h-full bg-[#E6A93C]" style={{ width: `${progressPct}%` }} />
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col justify-between p-4 min-w-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#A1A1AA] mb-1.5">
                      <span>{movie.genre}</span>
                      <span aria-hidden="true">·</span>
                      <span>{movie.quality}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{movie.year}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{movie.duration}</span>
                      {isOfflineReady && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#E6A93C] font-medium">Offline Ready</span>
                        </>
                      )}
                    </div>

                    <h2 className="font-display text-lg font-semibold text-[#FAFAFA] leading-snug line-clamp-1 mb-1">
                      <button
                        type="button"
                        onClick={() => onSelectMovie(movie)}
                        className="text-left hover:text-[#E6A93C] transition-colors cursor-pointer"
                      >
                        {movie.title}
                      </button>
                    </h2>

                    <p className="text-[11px] text-[#71717A] mb-2 truncate">
                      {t('directedBy')} <span className="text-[#D4D4D8]">{movie.director}</span>
                      {movie.country ? ` · ${movie.country}` : ''}
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
                              ? 'text-[#E6A93C] fill-[#E6A93C]'
                              : 'text-[#52525B]'
                          }`}
                          aria-hidden="true"
                        />
                        {ratingsByMovie[movie.id]?.count ? (
                          <span>
                            {ratingsByMovie[movie.id].average.toFixed(1)} (
                            {ratingsByMovie[movie.id].count})
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
                        onClick={() =>
                          isOfflineReady ? onSelectMovie(movie) : onDownload(movie)
                        }
                        className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#E6A93C] px-3.5 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] transition-all whitespace-nowrap cursor-pointer"
                      >
                        {isOfflineReady ? (
                          <>
                            <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>Play Offline</span>
                          </>
                        ) : (
                          <>
                            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>{t('download')}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectMovie(movie)}
                        className="min-h-[44px] inline-flex items-center justify-center rounded-xl border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#FAFAFA] hover:bg-[#27272A] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        {t('watch')}
                      </button>

                      {onPlayTrailer && (
                        <button
                          type="button"
                          onClick={() => onPlayTrailer(movie)}
                          title="Watch trailer preview"
                          className="min-h-[44px] inline-flex items-center justify-center rounded-xl border border-[#27272A] bg-[#18181B] px-2.5 py-2 text-xs font-medium text-[#E6A93C] hover:border-[#E6A93C] transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Trailer
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onShareToChat(movie)}
                        aria-label={`Share ${movie.title} in chat`}
                        title="Share to community chat"
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-[#27272A] bg-[#18181B] text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#27272A] transition-colors cursor-pointer"
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
}
