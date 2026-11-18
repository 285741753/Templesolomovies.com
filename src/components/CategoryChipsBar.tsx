import { useLanguage } from '../contexts/LanguageContext';
import type { HomeCategoryChip, Movie } from '../types/cinema';

export const HOME_CATEGORIES: HomeCategoryChip[] = [
  'All',
  'Movies',
  'Series',
  'Music',
  'Anime',
  'Nollywood',
  'K-Drama',
];

export function filterMoviesByCategory(
  movies: Movie[],
  category: HomeCategoryChip
): Movie[] {
  if (category === 'All') return movies;
  if (category === 'Nollywood') {
    return movies.filter(
      (m) =>
        m.category === 'Nollywood' ||
        m.genre === 'Nollywood' ||
        /\b(nollywood|lagos|nigeria)\b/i.test(`${m.title} ${m.synopsis}`)
    );
  }
  if (category === 'Series') {
    return movies.filter(
      (m) =>
        m.category === 'Series' ||
        /\b(series|season|episode|ep\.?\s*\d+)\b/i.test(`${m.title} ${m.synopsis}`)
    );
  }
  if (category === 'Music') {
    return movies.filter(
      (m) =>
        m.category === 'Music' ||
        m.genre === 'Music' ||
        /\b(music|concert|symphony|soundtrack|acoustic|album|session)\b/i.test(
          `${m.title} ${m.synopsis}`
        )
    );
  }
  if (category === 'Anime') {
    return movies.filter(
      (m) =>
        m.category === 'Anime' ||
        m.genre === 'Animation' ||
        /\b(anime|manga)\b/i.test(`${m.title} ${m.synopsis}`)
    );
  }
  if (category === 'K-Drama') {
    return movies.filter(
      (m) =>
        m.category === 'K-Drama' ||
        /\b(k-drama|kdrama|korean|seoul)\b/i.test(`${m.title} ${m.synopsis}`)
    );
  }
  // 'Movies': default feature films (exclude explicit Series/Music/Anime/K-Drama tags)
  return movies.filter(
    (m) =>
      !m.category ||
      m.category === 'Movies' ||
      m.category === 'Nollywood'
  );
}

interface CategoryChipsBarProps {
  selectedCategory: HomeCategoryChip;
  onSelectCategory: (category: HomeCategoryChip) => void;
  filteredCount: number;
}

export function CategoryChipsBar({
  selectedCategory,
  onSelectCategory,
  filteredCount,
}: CategoryChipsBarProps) {
  const { t } = useLanguage();

  const labelMap: Record<HomeCategoryChip, string> = {
    All: t('catAll'),
    Movies: t('catMovies'),
    Series: t('catSeries'),
    Music: t('catMusic'),
    Anime: t('catAnime'),
    Nollywood: t('catNollywood'),
    'K-Drama': t('catKDrama'),
  };

  return (
    <section
      aria-label="Category filter chips"
      className="w-full max-w-full overflow-hidden border-b border-[#27272A]/80 bg-[#0A0A0C]"
    >
      <div className="mx-auto max-w-[1440px] px-4 py-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3 min-w-0">
        <div
          role="tablist"
          aria-label="Home categories"
          className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto no-scrollbar py-0.5"
        >
          {HOME_CATEGORIES.map((category) => {
            const active = selectedCategory === category;
            return (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectCategory(category)}
                className={`min-h-[44px] inline-flex items-center justify-center rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                  active
                    ? 'border-[#E6A93C] bg-[#E6A93C] text-[#0A0A0C] shadow-sm'
                    : 'border-[#27272A] bg-[#111114] text-[#D4D4D8] hover:border-[#E6A93C]/60 hover:text-[#FAFAFA]'
                }`}
              >
                {labelMap[category]}
              </button>
            );
          })}
        </div>

        <span className="hidden sm:inline-block font-mono text-[11px] tabular-nums text-[#71717A] shrink-0">
          {filteredCount} {filteredCount === 1 ? t('movieSingular') : t('moviePlural')}
        </span>
      </div>
    </section>
  );
}
