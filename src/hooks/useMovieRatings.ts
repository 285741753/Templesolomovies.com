import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';

export interface RatingRecord {
  ratingId: string;
  movieId: string;
  userId: string;
  rating: number;
}

export type StarDistribution = Record<1 | 2 | 3 | 4 | 5, number>;

export interface MovieRatingSummary {
  average: number;
  count: number;
  userRating: number | null;
  distribution: StarDistribution;
}

function emptyDistribution(): StarDistribution {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

export function useMovieRatings(currentUserId?: string) {
  const [records, setRecords] = useState<RatingRecord[]>([]);

  useEffect(() => {
    const path = 'movieRatings';
    const ratingsQuery = query(
      collection(db, path),
      where('rating', '>=', 1),
      where('rating', '<=', 5)
    );

    const unsubscribe = onSnapshot(
      ratingsQuery,
      (snapshot) => {
        const next: RatingRecord[] = snapshot.docs.map((d) => {
          const data = d.data() as Partial<RatingRecord>;
          return {
            ratingId: data.ratingId || d.id,
            movieId: data.movieId || '',
            userId: data.userId || '',
            rating: Number(data.rating) || 0,
          };
        });
        setRecords(next.filter((r) => r.movieId && r.rating >= 1 && r.rating <= 5));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );

    return () => unsubscribe();
  }, []);

  const ratingsByMovie = useMemo(() => {
    const map = new Map<
      string,
      { sum: number; count: number; userRating: number | null; distribution: StarDistribution }
    >();

    for (const r of records) {
      const entry = map.get(r.movieId) || {
        sum: 0,
        count: 0,
        userRating: null,
        distribution: emptyDistribution(),
      };
      const starKey = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
      entry.sum += starKey;
      entry.count += 1;
      entry.distribution[starKey] += 1;
      if (currentUserId && r.userId === currentUserId) {
        entry.userRating = starKey;
      }
      map.set(r.movieId, entry);
    }

    const result: Record<string, MovieRatingSummary> = {};
    for (const [movieId, entry] of map.entries()) {
      result[movieId] = {
        average: entry.count > 0 ? Math.round((entry.sum / entry.count) * 10) / 10 : 0,
        count: entry.count,
        userRating: entry.userRating,
        distribution: entry.distribution,
      };
    }
    return result;
  }, [records, currentUserId]);

  const rateMovie = useCallback(
    async (movieId: string, stars: number) => {
      if (!currentUserId) return;
      const clamped = Math.min(5, Math.max(1, Math.round(stars)));
      const cleanMovieId = movieId.slice(0, 128);
      const ratingId = `${cleanMovieId}__${currentUserId}`;
      const path = `movieRatings/${ratingId}`;
      const ratingRef = doc(db, 'movieRatings', ratingId);
      const reviewRef = doc(db, 'movieReviews', ratingId);

      try {
        const [existingRating, existingReview] = await Promise.all([
          getDocFromServer(ratingRef),
          getDocFromServer(reviewRef),
        ]);

        const batch = writeBatch(db);
        if (!existingRating.exists()) {
          batch.set(ratingRef, {
            ratingId,
            movieId: cleanMovieId,
            userId: currentUserId,
            rating: clamped,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.update(ratingRef, {
            rating: clamped,
            updatedAt: serverTimestamp(),
          });
        }

        // Keep user's formal review star rating synchronized when one exists
        if (existingReview.exists()) {
          batch.update(reviewRef, {
            rating: clamped,
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

  return { ratingsByMovie, rateMovie };
}
