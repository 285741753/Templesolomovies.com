import { useState } from 'react';
import {
  Bell,
  BellRing,
  CalendarClock,
  Check,
  Film,
  Mail,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { isValidNotificationEmail } from '../hooks/useUpcomingNotifications';
import type { MovieGenre, MovieQuality, UpcomingMovie } from '../types/cinema';

interface ComingSoonProps {
  upcomingMovies: UpcomingMovie[];
  isLoading: boolean;
  error: string | null;
  subscribedIds: Set<string>;
  effectiveEmail: string;
  isAdmin: boolean;
  onRetry: () => void;
  onSubscribe: (release: UpcomingMovie, email?: string) => Promise<void>;
  onUnsubscribe: (release: UpcomingMovie) => Promise<void>;
  onSubscribeAll: (email?: string) => Promise<void>;
  onCreateUpcoming: (input: {
    title: string;
    genre: MovieGenre;
    releaseDate: string;
    duration: string;
    quality: MovieQuality;
    director: string;
    synopsis: string;
    posterFile?: File | null;
  }) => Promise<void>;
  onDeleteUpcoming: (releaseId: string) => Promise<void>;
}

const GENRE_OPTIONS: MovieGenre[] = [
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

const QUALITY_OPTIONS: MovieQuality[] = ['4K UHD', '1080p HD', '720p HD'];

function formatReleaseDate(dateStr: string): string {
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getDaysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00`).getTime();
  if (Number.isNaN(target)) return 0;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((target - todayStart) / 86400000));
}

function UpcomingPoster({ posterUrl, title }: { posterUrl: string; title: string }) {
  const [failed, setFailed] = useState(false);

  if (!posterUrl || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-[#18181B] to-[#09090B] p-4 text-center">
        <Film className="h-8 w-8 text-[#E5A93B]/60 mb-2" aria-hidden="true" />
        <span className="font-display text-xs font-medium text-[#D4D4D8] line-clamp-2">
          {title}
        </span>
      </div>
    );
  }

  return (
    <img
      src={posterUrl}
      alt={`${title} upcoming release poster`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
}

export function ComingSoon({
  upcomingMovies,
  isLoading,
  error,
  subscribedIds,
  effectiveEmail,
  isAdmin,
  onRetry,
  onSubscribe,
  onUnsubscribe,
  onSubscribeAll,
  onCreateUpcoming,
  onDeleteUpcoming,
}: ComingSoonProps) {
  const { t } = useLanguage();
  const [globalEmail, setGlobalEmail] = useState(effectiveEmail);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalSuccess, setGlobalSuccess] = useState(false);
  const [submittingAll, setSubmittingAll] = useState(false);

  const [activeCardEmailId, setActiveCardEmailId] = useState<string | null>(null);
  const [cardEmailInput, setCardEmailInput] = useState(effectiveEmail);
  const [cardEmailError, setCardEmailError] = useState<string | null>(null);
  const [busyCardId, setBusyCardId] = useState<string | null>(null);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formGenre, setFormGenre] = useState<MovieGenre>('Sci-Fi');
  const [formQuality, setFormQuality] = useState<MovieQuality>('4K UHD');
  const [formReleaseDate, setFormReleaseDate] = useState('2026-12-28');
  const [formDuration, setFormDuration] = useState('2h 05m');
  const [formDirector, setFormDirector] = useState('');
  const [formSynopsis, setFormSynopsis] = useState('');
  const [formPoster, setFormPoster] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [savingUpcoming, setSavingUpcoming] = useState(false);

  const handleGlobalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailToUse = (globalEmail || effectiveEmail).trim();
    if (!isValidNotificationEmail(emailToUse)) {
      setGlobalError(t('invalidEmailMsg'));
      setGlobalSuccess(false);
      return;
    }

    setGlobalError(null);
    setSubmittingAll(true);
    try {
      await onSubscribeAll(emailToUse);
      setGlobalSuccess(true);
      window.setTimeout(() => setGlobalSuccess(false), 4000);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : t('invalidEmailMsg'));
    } finally {
      setSubmittingAll(false);
    }
  };

  const handleCardNotifyClick = async (release: UpcomingMovie) => {
    const isSub = subscribedIds.has(release.id);
    if (isSub) {
      setBusyCardId(release.id);
      try {
        await onUnsubscribe(release);
      } finally {
        setBusyCardId(null);
      }
      return;
    }

    if (effectiveEmail && isValidNotificationEmail(effectiveEmail)) {
      setBusyCardId(release.id);
      try {
        await onSubscribe(release, effectiveEmail);
      } finally {
        setBusyCardId(null);
      }
      return;
    }

    setActiveCardEmailId(release.id);
    setCardEmailInput(effectiveEmail || globalEmail || '');
    setCardEmailError(null);
  };

  const handleCardEmailConfirm = async (e: React.FormEvent, release: UpcomingMovie) => {
    e.preventDefault();
    const cleaned = cardEmailInput.trim();
    if (!isValidNotificationEmail(cleaned)) {
      setCardEmailError(t('invalidEmailMsg'));
      return;
    }

    setCardEmailError(null);
    setBusyCardId(release.id);
    try {
      await onSubscribe(release, cleaned);
      setActiveCardEmailId(null);
      setGlobalEmail(cleaned);
    } catch (err) {
      setCardEmailError(err instanceof Error ? err.message : t('invalidEmailMsg'));
    } finally {
      setBusyCardId(null);
    }
  };

  const handleAdminCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setFormError('Title is required.');
      return;
    }
    setFormError(null);
    setSavingUpcoming(true);
    try {
      await onCreateUpcoming({
        title: formTitle.trim(),
        genre: formGenre,
        releaseDate: formReleaseDate,
        duration: formDuration.trim() || '2h 00m',
        quality: formQuality,
        director: formDirector.trim() || 'TempleSolo Studio',
        synopsis: formSynopsis.trim(),
        posterFile: formPoster,
      });
      setIsAddModalOpen(false);
      setFormTitle('');
      setFormDirector('');
      setFormSynopsis('');
      setFormPoster(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to schedule release.');
    } finally {
      setSavingUpcoming(false);
    }
  };

  return (
    <section
      id="coming-soon"
      aria-labelledby="coming-soon-heading"
      className="w-full max-w-full overflow-x-clip border-b border-[#27272A] bg-[#09090B]"
    >
      <div className="mx-auto max-w-[1440px] px-4 py-9 sm:px-6 lg:px-8">
        {/* Section Header + Global Release Alert Signup */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-7 min-w-0">
          <div className="max-w-2xl min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-[#E5A93B] mb-1">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('comingSoonEyebrow')}</span>
            </div>
            <h2
              id="coming-soon-heading"
              className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA]"
            >
              {t('comingSoonHeading')}
            </h2>
            <p className="text-sm text-[#A1A1AA] mt-1">{t('comingSoonSubtitle')}</p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {effectiveEmail && !isAdmin ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 text-xs text-[#A1A1AA]">
                  <Mail className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                  <span>
                    {t('alertsActiveFor')}{' '}
                    <strong className="text-[#FAFAFA] font-medium">{effectiveEmail}</strong>
                  </span>
                </span>
                <button
                  type="button"
                  disabled={submittingAll || upcomingMovies.length === 0}
                  onClick={() => void onSubscribeAll(effectiveEmail)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#111114] px-3.5 py-2 text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Bell className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                  <span>{t('notifyAllBtn')}</span>
                </button>
              </div>
            ) : (
              <form
                onSubmit={handleGlobalSubmit}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                noValidate
              >
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#71717A]"
                    aria-hidden="true"
                  />
                  <input
                    type="email"
                    value={globalEmail}
                    onChange={(e) => {
                      setGlobalEmail(e.target.value);
                      if (globalError) setGlobalError(null);
                    }}
                    placeholder={t('alertEmailPlaceholder')}
                    aria-label={t('alertEmailPlaceholder')}
                    className="w-full sm:w-64 rounded-lg border border-[#27272A] bg-[#111114] py-2 pl-9 pr-3 text-xs sm:text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submittingAll || upcomingMovies.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {globalSuccess ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('notifiedBtn')}</span>
                    </>
                  ) : (
                    <>
                      <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('notifyAllBtn')}</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                <span>{t('addUpcomingBtn')}</span>
              </button>
            )}
          </div>
        </div>

        {globalError && (
          <p role="alert" className="mb-4 text-xs text-red-400">
            {globalError}
          </p>
        )}

        {/* Loading / Error / Grid */}
        {isLoading && upcomingMovies.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[0, 1].map((idx) => (
              <div
                key={idx}
                className="h-44 rounded-xl border border-[#27272A] bg-[#111114] animate-pulse"
              />
            ))}
          </div>
        ) : error && upcomingMovies.length === 0 ? (
          <div className="rounded-xl border border-[#27272A] bg-[#111114] p-6 flex items-center justify-between gap-4">
            <p className="text-sm text-[#A1A1AA]">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#E5A93B] cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : upcomingMovies.length === 0 ? null : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {upcomingMovies.map((release) => {
              const isSubscribed = subscribedIds.has(release.id);
              const isBusy = busyCardId === release.id;
              const isEditingEmail = activeCardEmailId === release.id;
              const daysUntil = getDaysUntil(release.releaseDate);
              const countdownText =
                daysUntil === 0
                  ? t('releasesToday')
                  : daysUntil === 1
                  ? t('releasesTomorrow')
                  : t('releasesInDays', { days: daysUntil });

              return (
                <article
                  key={release.id}
                  className="group flex flex-col sm:flex-row overflow-hidden rounded-xl border border-[#27272A] bg-[#111114] transition-colors hover:border-[#3F3F46]"
                >
                  {/* Poster Column */}
                  <div className="relative sm:w-40 md:w-44 shrink-0 aspect-[3/4] bg-[#18181B] overflow-hidden">
                    <UpcomingPoster posterUrl={release.posterUrl} title={release.title} />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#09090B]/90 via-transparent to-transparent" />
                    <span className="absolute bottom-2.5 left-3 right-3 font-mono text-[11px] font-semibold tabular-nums text-[#E5A93B]">
                      {countdownText}
                    </span>
                  </div>

                  {/* Content Column */}
                  <div className="flex flex-1 flex-col justify-between p-4 sm:p-5 min-w-0">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#A1A1AA]">
                          <span>{release.genre}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-[#FAFAFA]">
                            {formatReleaseDate(release.releaseDate)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{release.quality}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{release.duration}</span>
                        </div>

                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => void onDeleteUpcoming(release.id)}
                            aria-label={`Remove ${release.title} from Coming Soon`}
                            className="rounded p-1 text-[#71717A] hover:text-red-400 hover:bg-[#18181B] transition-colors shrink-0 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>

                      <h3 className="font-display text-lg font-semibold text-[#FAFAFA] leading-snug mb-1">
                        {release.title}
                      </h3>

                      <p className="text-xs text-[#71717A] mb-2.5">
                        {t('directedBy')} <span className="text-[#D4D4D8]">{release.director}</span>
                      </p>

                      <p className="text-xs text-[#A1A1AA] leading-relaxed line-clamp-2 mb-4">
                        {release.synopsis}
                      </p>
                    </div>

                    {/* Footer Action Bar */}
                    <div className="pt-3 border-t border-[#27272A]/80">
                      {isEditingEmail ? (
                        <form
                          onSubmit={(e) => void handleCardEmailConfirm(e, release)}
                          className="space-y-1.5"
                          noValidate
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="email"
                              value={cardEmailInput}
                              onChange={(e) => {
                                setCardEmailInput(e.target.value);
                                if (cardEmailError) setCardEmailError(null);
                              }}
                              placeholder={t('alertEmailPlaceholder')}
                              aria-label={t('alertEmailPlaceholder')}
                              className="flex-1 min-w-0 rounded-lg border border-[#E5A93B] bg-[#09090B] px-2.5 py-1.5 text-base text-[#FAFAFA] placeholder:text-[#71717A] focus:outline-none"
                            />
                            <button
                              type="submit"
                              disabled={isBusy}
                              className="rounded-lg bg-[#E5A93B] px-3 py-1.5 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                            >
                              {t('confirmNotify')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveCardEmailId(null);
                                setCardEmailError(null);
                              }}
                              aria-label={t('cancelAction')}
                              className="rounded-lg border border-[#27272A] p-1.5 text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                          {cardEmailError && (
                            <p role="alert" className="text-[11px] text-red-400">
                              {cardEmailError}
                            </p>
                          )}
                        </form>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-[#A1A1AA]">
                            <Bell className="h-3.5 w-3.5 text-[#71717A]" aria-hidden="true" />
                            <span>
                              {release.subscriberCount.toLocaleString()} {t('waitingLabel')}
                            </span>
                          </span>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleCardNotifyClick(release)}
                            aria-pressed={isSubscribed}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                              isSubscribed
                                ? 'border border-[#E5A93B]/60 bg-[#18181B] text-[#E5A93B] hover:bg-[#27272A]'
                                : 'bg-[#E5A93B] text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98]'
                            }`}
                          >
                            {isSubscribed ? (
                              <>
                                <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{t('notifiedBtn')}</span>
                              </>
                            ) : (
                              <>
                                <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{t('notifyMe')}</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Admin Add Upcoming Release Modal */}
      {isAdmin && isAddModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-upcoming-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#27272A] bg-[#111114] p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3 mb-5">
              <h3 id="add-upcoming-title" className="font-display text-lg font-bold text-[#FAFAFA]">
                {t('addUpcomingBtn')}
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                aria-label={t('cancelAction')}
                className="rounded-lg p-1.5 text-[#71717A] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={(e) => void handleAdminCreate(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                  Movie Title
                </label>
                <input
                  type="text"
                  required
                  maxLength={140}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Harbor Lights"
                  className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">Genre</label>
                  <select
                    value={formGenre}
                    onChange={(e) => setFormGenre(e.target.value as MovieGenre)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  >
                    {GENRE_OPTIONS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">Quality</label>
                  <select
                    value={formQuality}
                    onChange={(e) => setFormQuality(e.target.value as MovieQuality)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  >
                    {QUALITY_OPTIONS.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                    Release Date
                  </label>
                  <input
                    type="date"
                    required
                    value={formReleaseDate}
                    onChange={(e) => setFormReleaseDate(e.target.value)}
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">Director</label>
                  <input
                    type="text"
                    maxLength={80}
                    value={formDirector}
                    onChange={(e) => setFormDirector(e.target.value)}
                    placeholder="Director name"
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1">Duration</label>
                  <input
                    type="text"
                    maxLength={24}
                    value={formDuration}
                    onChange={(e) => setFormDuration(e.target.value)}
                    placeholder="2h 05m"
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1">Synopsis</label>
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={formSynopsis}
                  onChange={(e) => setFormSynopsis(e.target.value)}
                  placeholder="Brief release synopsis..."
                  className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1">
                  Poster Image (Optional)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFormPoster(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-[#A1A1AA] file:mr-3 file:rounded-md file:border file:border-[#27272A] file:bg-[#18181B] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[#FAFAFA]"
                />
              </div>

              {formError && <p className="text-xs text-red-400">{formError}</p>}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-lg border border-[#27272A] bg-[#18181B] px-4 py-2 text-xs font-medium text-[#FAFAFA] hover:bg-[#27272A] cursor-pointer"
                >
                  {t('cancelAction')}
                </button>
                <button
                  type="submit"
                  disabled={savingUpcoming}
                  className="rounded-lg bg-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-50 cursor-pointer"
                >
                  {savingUpcoming ? 'Saving...' : t('addUpcomingBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
