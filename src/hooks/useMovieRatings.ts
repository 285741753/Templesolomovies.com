import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';

export interface RatingRecord {
  ratingId: string;
  movieId: string;
  userId: string;
  rating: number;
}

export interface MovieRatingSummary {
  average: number;
  count: number;
  userRating: number | null;
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
    const map = new Map<string, { sum: number; count: number; userRating: number | null }>();

    for (const r of records) {
      const entry = map.get(r.movieId) || { sum: 0, count: 0, userRating: null };
      entry.sum += r.rating;
      entry.count += 1;
      if (currentUserId && r.userId === currentUserId) {
        entry.userRating = r.rating;
      }
      map.set(r.movieId, entry);
    }

    const result: Record<string, MovieRatingSummary> = {};
    for (const [movieId, entry] of map.entries()) {
      result[movieId] = {
        average: entry.count > 0 ? Math.round((entry.sum / entry.count) * 10) / 10 : 0,
        count: entry.count,
        userRating: entry.userRating,
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
      const ref = doc(db, 'movieRatings', ratingId);

      try {
        const existing = await getDocFromServer(ref);
        if (!existing.exists()) {
          await setDoc(ref, {
            ratingId,
            movieId: cleanMovieId,
            userId: currentUserId,
            rating: clamped,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(ref, {
            rating: clamped,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [currentUserId]
  );

  return { ratingsByMovie, rateMovie };
}
