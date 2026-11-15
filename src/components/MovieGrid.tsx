import { useState } from 'react';
import {
  Download,
  Play,
  MessageSquare,
  Search,
  Film,
  Upload,
  Bookmark,
  Star,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type { MovieRatingSummary } from '../hooks/useMovieRatings';
import type { Movie, MovieGenre } from '../types/cinema';
import { formatFileSize } from '../utils/format';

export type CollectionFilter = 'all' | 'saved' | 'uploads';

interface MovieGridProps {
  movies: Movie[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  collectionView: CollectionFilter;
  savedMovieIds: Set<string>;
  ratingsByMovie: Record<string, MovieRatingSummary>;
  currentUserId?: string;
  isAdmin: boolean;
  onChangeCollectionView: (view: CollectionFilter) => void;
  onDownload: (movie: Movie) => void;
  onSelectMovie: (movie: Movie) => void;
  onShareToChat: (movie: Movie) => void;
  onToggleSave: (movie: Movie) => void;
  onOpenUpload: () => void;
}

const GENRES: Array<'All' | MovieGenre> = [
  'All',
  'Action',
  'Sci-Fi',
  'Drama',
  'Thriller',
  'Mystery',
  'Comedy',
  'Documentary',
  'Animation',
  'Horror',
];

type SortOption = 'newest' | 'downloads' | 'title';

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
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
}

export function MovieGrid({
  movies,
  searchQuery,
  onSearchChange,
  collectionView,
  savedMovieIds,
  ratingsByMovie,
  currentUserId,
  isAdmin,
  onChangeCollectionView,
  onDownload,
  onSelectMovie,
  onShareToChat,
  onToggleSave,
  onOpenUpload,
}: MovieGridProps) {
  const { t } = useLanguage();
  const [selectedGenre, setSelectedGenre] = useState<'All' | MovieGenre>('All');
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  const scopedMovies = movies.filter((m) => {
    if (collectionView === 'saved' && !savedMovieIds.has(m.id)) return false;
    if (collectionView === 'uploads' && (!currentUserId || m.ownerUid !== currentUserId)) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      m.director.toLowerCase().includes(q) ||
      m.genre.toLowerCase().includes(q)
    );
  });

  const categoryCounts = GENRES.reduce<Record<string, number>>((acc, genre) => {
    acc[genre] =
      genre === 'All'
        ? scopedMovies.length
        : scopedMovies.filter((m) => m.genre === genre).length;
    return acc;
  }, {});

  const filtered = scopedMovies
    .filter((m) => selectedGenre === 'All' || m.genre === selectedGenre)
    .sort((a, b) => {
      if (sortBy === 'downloads') return b.downloads - a.downloads;
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <section id="catalog" className="py-8">
      <div className="flex flex-col gap-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA]">
              {t('catalogTitle')}
            </h2>
            <p className="text-sm text-[#A1A1AA] mt-1">
              {t('catalogSubtitle')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative flex-1 sm:w-64">
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
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label="Sort movies"
              className="rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none cursor-pointer"
            >
              <option value="newest">{t('sortNewest')}</option>
              <option value="downloads">{t('sortDownloads')}</option>
              <option value="title">{t('sortTitle')}</option>
            </select>
          </div>
        </div>

        {/* Collection Scope + Genre Filter Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-[#27272A] bg-[#111114] p-1">
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
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
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

          {isAdmin && (
            <button
              type="button"
              onClick={onOpenUpload}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] transition-colors whitespace-nowrap cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
              <span>{t('uploadNewMovie')}</span>
            </button>
          )}
        </div>

        <div className="border-b border-[#27272A]">
          <div
            className="flex items-center gap-1 overflow-x-auto"
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

        {(searchQuery.trim() || selectedGenre !== 'All') && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#A1A1AA]">
            <p className="font-mono tabular-nums">
              {t('showingLabel')} {filtered.length}{' '}
              {filtered.length === 1 ? t('movieSingular') : t('moviePlural')}
              {selectedGenre !== 'All' ? ` ${t('inCategory')} ${selectedGenre}` : ''}
              {searchQuery.trim() ? ` ${t('matchingQuery')} “${searchQuery.trim()}”` : ''}
            </p>
            <div className="flex items-center gap-3">
              {selectedGenre !== 'All' && (
                <button
                  type="button"
                  onClick={() => setSelectedGenre('All')}
                  className="text-[#E5A93B] hover:underline cursor-pointer"
                >
                  {t('allCategoriesReset')}
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
              onClick={() => {
                onSearchChange('');
                setSelectedGenre('All');
                onChangeCollectionView('all');
              }}
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
                    <span>{movie.quality}</span>
                    <span className="inline-flex items-center gap-1 text-[#FAFAFA] opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                      {t('preview')}
                    </span>
                  </div>
                </div>

                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-[#A1A1AA] mb-1.5">
                      <span>{movie.genre}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{movie.year}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{movie.duration}</span>
                    </div>

                    <h3 className="font-display text-lg font-semibold text-[#FAFAFA] leading-snug line-clamp-1 mb-1.5">
                      <button
                        type="button"
                        onClick={() => onSelectMovie(movie)}
                        className="text-left hover:text-[#E5A93B] transition-colors cursor-pointer"
                      >
                        {movie.title}
                      </button>
                    </h3>

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
}
