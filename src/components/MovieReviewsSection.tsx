import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  Star,
  Trash2,
} from 'lucide-react';
import type { MovieRatingSummary } from '../hooks/useMovieRatings';
import type { SubmitReviewInput } from '../hooks/useMovieReviews';
import type { MovieReview } from '../types/cinema';

type ReviewSort = 'newest' | 'highest' | 'lowest';

interface MovieReviewsSectionProps {
  movieId: string;
  movieTitle: string;
  reviews: MovieReview[];
  ratingSummary?: MovieRatingSummary;
  isAuthenticated: boolean;
  isAdmin: boolean;
  currentUserId?: string;
  currentAuthorName: string;
  isLoadingReviews: boolean;
  onRequireAuth: () => void;
  onSubmitReview: (input: SubmitReviewInput) => Promise<void>;
  onDeleteReview: (movieId: string, targetUserId?: string) => Promise<void>;
}

const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Below Average',
  3: 'Solid',
  4: 'Recommended',
  5: 'Masterpiece',
};

function formatReviewDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function MovieReviewsSection({
  movieId,
  movieTitle,
  reviews,
  ratingSummary,
  isAuthenticated,
  isAdmin,
  currentUserId,
  currentAuthorName,
  isLoadingReviews,
  onRequireAuth,
  onSubmitReview,
  onDeleteReview,
}: MovieReviewsSectionProps) {
  const existingUserReview = useMemo(
    () => (currentUserId ? reviews.find((r) => r.userId === currentUserId) : undefined),
    [reviews, currentUserId]
  );

  const [isComposing, setIsComposing] = useState(false);
  const [sortBy, setSortBy] = useState<ReviewSort>('newest');
  const [formRating, setFormRating] = useState<number>(5);
  const [hoveredFormStar, setHoveredFormStar] = useState<number>(0);
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [containsSpoilers, setContainsSpoilers] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revealedSpoilerIds, setRevealedSpoilerIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setIsComposing(false);
    setFormError(null);
    setConfirmDeleteId(null);
    setDeletingId(null);
    setRevealedSpoilerIds(new Set());
  }, [movieId]);

  const openComposer = () => {
    if (!isAuthenticated) {
      onRequireAuth();
      return;
    }
    if (existingUserReview) {
      setFormRating(existingUserReview.rating);
      setHeadline(existingUserReview.headline);
      setBody(existingUserReview.body);
      setContainsSpoilers(existingUserReview.containsSpoilers);
    } else {
      setFormRating(ratingSummary?.userRating || 5);
      setHeadline('');
      setBody('');
      setContainsSpoilers(false);
    }
    setFormError(null);
    setIsComposing(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedHeadline = headline.trim();
    const trimmedBody = body.trim();

    if (trimmedHeadline.length < 3) {
      setFormError('Please enter a review headline of at least 3 characters.');
      return;
    }
    if (trimmedBody.length < 20) {
      setFormError(
        `Please write at least 20 characters for your formal critique (${trimmedBody.length}/20).`
      );
      return;
    }

    setFormError(null);
    setIsSaving(true);
    try {
      await onSubmitReview({
        movieId,
        authorName: currentAuthorName,
        rating: formRating,
        headline: trimmedHeadline,
        body: trimmedBody,
        containsSpoilers,
      });
      setIsComposing(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unable to save review right now.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async (review: MovieReview) => {
    setDeletingId(review.reviewId);
    try {
      await onDeleteReview(review.movieId, review.userId);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  const toggleRevealSpoiler = (reviewId: string) => {
    setRevealedSpoilerIds((prev) => {
      const next = new Set(prev);
      if (next.has(reviewId)) next.delete(reviewId);
      else next.add(reviewId);
      return next;
    });
  };

  const sortedReviews = useMemo(() => {
    const copy = [...reviews];
    if (sortBy === 'highest') {
      return copy.sort((a, b) => b.rating - a.rating || b.updatedAtMs - a.updatedAtMs);
    }
    if (sortBy === 'lowest') {
      return copy.sort((a, b) => a.rating - b.rating || b.updatedAtMs - a.updatedAtMs);
    }
    return copy.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [reviews, sortBy]);

  const totalRatingsCount = ratingSummary?.count ?? 0;
  const averageScore = ratingSummary?.average ?? 0;
  const distribution = ratingSummary?.distribution ?? { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  return (
    <section
      aria-label={`Reviews for ${movieTitle}`}
      className="border-t border-[#27272A] pt-6 space-y-5"
    >
      {/* Header & Sort */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[#FAFAFA] flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
            <span>Formal Movie Reviews</span>
          </h3>
          <p className="text-xs text-[#A1A1AA] mt-0.5 font-mono tabular-nums">
            {reviews.length} {reviews.length === 1 ? 'written review' : 'written reviews'} ·{' '}
            {totalRatingsCount} {totalRatingsCount === 1 ? 'star rating' : 'star ratings'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {reviews.length > 1 && (
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ReviewSort)}
              aria-label="Sort movie reviews"
              className="rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none cursor-pointer"
            >
              <option value="newest">Most Recent</option>
              <option value="highest">Highest Rated</option>
              <option value="lowest">Lowest Rated</option>
            </select>
          )}

          {!isComposing && (
            <button
              type="button"
              onClick={openComposer}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {!isAuthenticated
                  ? 'Sign In to Review'
                  : existingUserReview
                  ? 'Edit Your Review'
                  : 'Write a Review'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Aggregate Score & 5-Star Distribution Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 rounded-lg border border-[#27272A] bg-[#09090B] p-4">
        <div className="sm:col-span-4 flex flex-col justify-center sm:border-r sm:border-[#27272A] sm:pr-5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold tabular-nums text-[#FAFAFA]">
              {totalRatingsCount > 0 ? averageScore.toFixed(1) : '—'}
            </span>
            <span className="font-mono text-xs text-[#71717A]">/ 5.0</span>
          </div>
          <div className="flex items-center gap-1 mt-1.5" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`h-3.5 w-3.5 ${
                  totalRatingsCount > 0 && star <= Math.round(averageScore)
                    ? 'text-[#E5A93B] fill-[#E5A93B]'
                    : 'text-[#3F3F46]'
                }`}
              />
            ))}
          </div>
          <p className="text-[11px] text-[#71717A] mt-1.5 font-mono tabular-nums">
            Based on {totalRatingsCount} {totalRatingsCount === 1 ? 'member' : 'members'}
          </p>
        </div>

        <div className="sm:col-span-8 space-y-1.5 justify-center flex flex-col">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const count = distribution[star] || 0;
            const pct = totalRatingsCount > 0 ? Math.round((count / totalRatingsCount) * 100) : 0;
            return (
              <div key={star} className="flex items-center gap-2.5 text-xs">
                <span className="w-8 font-mono tabular-nums text-[#A1A1AA] text-right shrink-0">
                  {star} ★
                </span>
                <div className="flex-1 h-2 rounded-full bg-[#18181B] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#E5A93B] transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 font-mono tabular-nums text-[11px] text-[#71717A] text-right shrink-0">
                  {pct}% ({count})
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Formal Review Composer */}
      {isComposing && (
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-[#E5A93B]/40 bg-[#09090B] p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#27272A] pb-3">
            <div>
              <h4 className="font-display text-sm font-semibold text-[#FAFAFA]">
                {existingUserReview
                  ? `Update your review for ${movieTitle}`
                  : `Write a formal review for ${movieTitle}`}
              </h4>
              <p className="text-[11px] text-[#71717A]">
                Publishing as <span className="text-[#D4D4D8] font-medium">{currentAuthorName}</span>
              </p>
            </div>

            <div
              className="flex items-center gap-1"
              onMouseLeave={() => setHoveredFormStar(0)}
              role="group"
              aria-label="Select review star rating"
            >
              {[1, 2, 3, 4, 5].map((star) => {
                const active = star <= (hoveredFormStar || formRating);
                return (
                  <button
                    key={star}
                    type="button"
                    onMouseEnter={() => setHoveredFormStar(star)}
                    onClick={() => setFormRating(star)}
                    aria-label={`${star} stars`}
                    className="p-1 rounded hover:bg-[#18181B] cursor-pointer"
                  >
                    <Star
                      className={`h-4 w-4 ${
                        active ? 'text-[#E5A93B] fill-[#E5A93B]' : 'text-[#52525B]'
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
              <span className="ml-2 text-xs font-mono tabular-nums text-[#E5A93B]">
                {hoveredFormStar || formRating}/5 · {RATING_LABELS[hoveredFormStar || formRating]}
              </span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="review-headline-input"
                className="text-xs font-medium text-[#D4D4D8]"
              >
                Review Headline
              </label>
              <span className="font-mono text-[11px] tabular-nums text-[#71717A]">
                {headline.trim().length}/120
              </span>
            </div>
            <input
              id="review-headline-input"
              type="text"
              required
              maxLength={120}
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Summarize your verdict in one clear headline..."
              className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="review-body-input"
                className="text-xs font-medium text-[#D4D4D8]"
              >
                Formal Critique
              </label>
              <span className="font-mono text-[11px] tabular-nums text-[#71717A]">
                {body.trim().length}/2000 (min 20)
              </span>
            </div>
            <textarea
              id="review-body-input"
              required
              rows={4}
              maxLength={2000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Evaluate the direction, screenplay, performances, pacing, and cinematography..."
              className="w-full rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none resize-y leading-relaxed"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-[#D4D4D8] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={containsSpoilers}
                onChange={(e) => setContainsSpoilers(e.target.checked)}
                className="h-4 w-4 rounded border-[#27272A] bg-[#111114] accent-[#E5A93B] cursor-pointer"
              />
              <span>Contains plot spoilers</span>
            </label>

            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsComposing(false);
                  setFormError(null);
                }}
                className="rounded-lg border border-[#27272A] px-3.5 py-2 text-xs font-medium text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {isSaving
                  ? 'Publishing...'
                  : existingUserReview
                  ? 'Update Review'
                  : 'Publish Review'}
              </button>
            </div>
          </div>

          {formError && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}
        </form>
      )}

      {/* Community Reviews List */}
      {isLoadingReviews ? (
        <div className="rounded-lg border border-[#27272A] bg-[#09090B] p-6 text-center text-xs text-[#71717A]">
          Loading reviews...
        </div>
      ) : sortedReviews.length === 0 ? (
        <div className="rounded-lg border border-[#27272A] bg-[#09090B] p-6 text-center space-y-2">
          <p className="text-sm font-medium text-[#D4D4D8]">No written reviews yet</p>
          <p className="text-xs text-[#71717A]">
            Be the first member to publish a formal critique for {movieTitle}.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedReviews.map((review) => {
            const isOwnReview = Boolean(currentUserId && review.userId === currentUserId);
            const canDelete = isOwnReview || isAdmin;
            const isEdited = review.updatedAtMs - review.createdAtMs > 5000;
            const spoilerHidden =
              review.containsSpoilers &&
              !isOwnReview &&
              !revealedSpoilerIds.has(review.reviewId);

            return (
              <article
                key={review.reviewId}
                className={`rounded-lg border bg-[#09090B] p-4 space-y-2.5 ${
                  isOwnReview ? 'border-[#E5A93B]/45' : 'border-[#27272A]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#A1A1AA]">
                    <span className="font-semibold text-[#FAFAFA]">{review.authorName}</span>
                    {isOwnReview && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#E5A93B] font-medium">Your review</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <time className="font-mono tabular-nums text-[11px] text-[#71717A]">
                      {formatReviewDate(review.updatedAtMs)}
                    </time>
                    {isEdited && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[11px] text-[#71717A]">Edited</span>
                      </>
                    )}
                    {review.containsSpoilers && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[11px] text-amber-300 font-medium">
                          Contains spoilers
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-0.5" aria-hidden="true">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`h-3.5 w-3.5 ${
                            star <= review.rating
                              ? 'text-[#E5A93B] fill-[#E5A93B]'
                              : 'text-[#3F3F46]'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="font-mono text-xs tabular-nums font-medium text-[#FAFAFA]">
                      {review.rating}/5
                    </span>
                  </div>
                </div>

                <h4 className="font-display text-base font-semibold text-[#FAFAFA] leading-snug">
                  {review.headline}
                </h4>

                {spoilerHidden ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#27272A] bg-[#111114] px-3.5 py-2.5 text-xs">
                    <span className="text-[#A1A1AA]">
                      Plot spoilers are hidden for this review.
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleRevealSpoiler(review.reviewId)}
                      className="inline-flex items-center gap-1.5 text-[#E5A93B] hover:underline font-medium cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Reveal review</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-[#D4D4D8] leading-relaxed whitespace-pre-line">
                      {review.body}
                    </p>
                    {review.containsSpoilers && !isOwnReview && (
                      <button
                        type="button"
                        onClick={() => toggleRevealSpoiler(review.reviewId)}
                        className="inline-flex items-center gap-1 text-[11px] text-[#71717A] hover:text-[#D4D4D8] cursor-pointer"
                      >
                        <EyeOff className="h-3 w-3" aria-hidden="true" />
                        <span>Hide spoiler review</span>
                      </button>
                    )}
                  </div>
                )}

                {(isOwnReview || canDelete) && (
                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#27272A]/60">
                    {isOwnReview && (
                      <button
                        type="button"
                        onClick={openComposer}
                        className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium text-[#D4D4D8] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
                      >
                        <Edit3 className="h-3 w-3" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                    )}

                    {canDelete &&
                      (confirmDeleteId !== review.reviewId ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(review.reviewId)}
                          className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium text-[#A1A1AA] hover:bg-[#18181B] hover:text-red-300 cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          <span>Delete</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-red-300">Delete review?</span>
                          <button
                            type="button"
                            disabled={deletingId === review.reviewId}
                            onClick={() => handleConfirmDelete(review)}
                            className="rounded bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-500 disabled:opacity-50 cursor-pointer"
                          >
                            {deletingId === review.reviewId ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded border border-[#27272A] px-2 py-1 text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
