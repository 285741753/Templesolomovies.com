import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { MovieReview } from '../types/cinema';

export interface SubmitReviewInput {
  movieId: string;
  authorName: string;
  rating: number;
  headline: string;
  body: string;
  containsSpoilers: boolean;
}

function toEpochMs(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export function useMovieReviews(currentUserId?: string) {
  const [reviews, setReviews] = useState<MovieReview[]>([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(true);

  useEffect(() => {
    const path = 'movieReviews';
    const reviewsQuery = query(
      collection(db, path),
      where('rating', '>=', 1),
      where('rating', '<=', 5)
    );

    const unsubscribe = onSnapshot(
      reviewsQuery,
      (snapshot) => {
        const next: MovieReview[] = snapshot.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const createdAtMs = toEpochMs(data.createdAt);
          const updatedAtMs = toEpochMs(data.updatedAt);
          return {
            reviewId: typeof data.reviewId === 'string' ? data.reviewId : d.id,
            movieId: typeof data.movieId === 'string' ? data.movieId : '',
            userId: typeof data.userId === 'string' ? data.userId : '',
            authorName:
              typeof data.authorName === 'string' && data.authorName.trim()
                ? data.authorName
                : 'Member',
            rating: Number(data.rating) || 0,
            headline: typeof data.headline === 'string' ? data.headline : '',
            body: typeof data.body === 'string' ? data.body : '',
            containsSpoilers: Boolean(data.containsSpoilers),
            createdAtMs,
            updatedAtMs,
          };
        });

        setReviews(
          next
            .filter((r) => r.movieId && r.userId && r.rating >= 1 && r.rating <= 5 && r.body)
            .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
        );
        setIsLoadingReviews(false);
      },
      (err) => {
        setIsLoadingReviews(false);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );

    return () => unsubscribe();
  }, []);

  const reviewsByMovie = useMemo(() => {
    const grouped: Record<string, MovieReview[]> = {};
    for (const review of reviews) {
      if (!grouped[review.movieId]) {
        grouped[review.movieId] = [];
      }
      grouped[review.movieId].push(review);
    }
    return grouped;
  }, [reviews]);

  const reviewCountByMovie = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [movieId, list] of Object.entries(reviewsByMovie)) {
      counts[movieId] = list.length;
    }
    return counts;
  }, [reviewsByMovie]);

  const submitReview = useCallback(
    async (input: SubmitReviewInput) => {
      if (!currentUserId) return;

      const cleanMovieId = input.movieId.trim().slice(0, 128);
      const cleanAuthorName = (input.authorName.trim() || 'Member').slice(0, 40);
      const clampedRating = Math.min(5, Math.max(1, Math.round(input.rating)));
      const cleanHeadline = input.headline.trim().slice(0, 120);
      const cleanBody = input.body.trim().slice(0, 2000);
      const containsSpoilers = Boolean(input.containsSpoilers);

      if (!cleanMovieId || cleanHeadline.length < 3 || cleanBody.length < 20) {
        throw new Error(
          'Please include a headline (at least 3 characters) and a formal review (at least 20 characters).'
        );
      }

      const reviewId = `${cleanMovieId}__${currentUserId}`;
      const path = `movieReviews/${reviewId}`;
      const reviewRef = doc(db, 'movieReviews', reviewId);
      const ratingRef = doc(db, 'movieRatings', reviewId);

      try {
        const [existingReview, existingRating] = await Promise.all([
          getDocFromServer(reviewRef),
          getDocFromServer(ratingRef),
        ]);

        const batch = writeBatch(db);

        if (!existingReview.exists()) {
          batch.set(reviewRef, {
            reviewId,
            movieId: cleanMovieId,
            userId: currentUserId,
            authorName: cleanAuthorName,
            rating: clampedRating,
            headline: cleanHeadline,
            body: cleanBody,
            containsSpoilers,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.update(reviewRef, {
            authorName: cleanAuthorName,
            rating: clampedRating,
            headline: cleanHeadline,
            body: cleanBody,
            containsSpoilers,
            updatedAt: serverTimestamp(),
          });
        }

        if (!existingRating.exists()) {
          batch.set(ratingRef, {
            ratingId: reviewId,
            movieId: cleanMovieId,
            userId: currentUserId,
            rating: clampedRating,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.update(ratingRef, {
            rating: clampedRating,
            updatedAt: serverTimestamp(),
          });
        }

        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [currentUserId]
  );

  const deleteReview = useCallback(
    async (movieId: string, targetUserId?: string) => {
      const uid = targetUserId || currentUserId;
      if (!uid) return;
      const cleanMovieId = movieId.trim().slice(0, 128);
      const reviewId = `${cleanMovieId}__${uid}`;
      const path = `movieReviews/${reviewId}`;
      const ref = doc(db, 'movieReviews', reviewId);

      try {
        await deleteDoc(ref);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [currentUserId]
  );

  return {
    reviewsByMovie,
    reviewCountByMovie,
    isLoadingReviews,
    submitReview,
    deleteReview,
  };
}
