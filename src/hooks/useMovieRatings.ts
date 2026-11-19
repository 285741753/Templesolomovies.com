import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export interface PendingOfflineRating {
  movieId: string;
  userId: string | null;
  rating: number;
  updatedAtMs: number;
}

export type RateMovieResult = 'synced' | 'queued-offline';

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

const RATINGS_CACHE_KEY = 'tsm_cached_ratings_v1';
const PENDING_RATINGS_KEY = 'tsm_pending_movie_ratings_v1';
const OFFLINE_LOCAL_USER_ID = '__offline_local__';

function loadCachedRatings(): RatingRecord[] {
  try {
    const raw = localStorage.getItem(RATINGS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RatingRecord[]) : [];
  } catch {
    return [];
  }
}

function loadPendingRatings(): Record<string, PendingOfflineRating> {
  try {
    const raw = localStorage.getItem(PENDING_RATINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<PendingOfflineRating>>;
    if (!parsed || typeof parsed !== 'object') return {};
    const valid: Record<string, PendingOfflineRating> = {};
    for (const [movieId, item] of Object.entries(parsed)) {
      const ratingNum = Number(item?.rating);
      if (
        movieId &&
        item &&
        Number.isFinite(ratingNum) &&
        ratingNum >= 1 &&
        ratingNum <= 5
      ) {
        valid[movieId] = {
          movieId,
          userId: typeof item.userId === 'string' && item.userId ? item.userId : null,
          rating: Math.min(5, Math.max(1, Math.round(ratingNum))),
          updatedAtMs: Number(item.updatedAtMs) || Date.now(),
        };
      }
    }
    return valid;
  } catch {
    return {};
  }
}

function persistPendingRatings(map: Record<string, PendingOfflineRating>) {
  try {
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(PENDING_RATINGS_KEY);
    } else {
      localStorage.setItem(PENDING_RATINGS_KEY, JSON.stringify(map));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function isConnectivityError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code || '') : '';
  const msg = 'message' in err ? String((err as { message?: unknown }).message || '') : '';
  return (
    code === 'unavailable' ||
    code === 'failed-precondition' ||
    /offline|network|unavailable|failed to get document/i.test(msg)
  );
}

async function writeRatingToFirestore(movieId: string, userId: string, stars: number) {
  const clamped = Math.min(5, Math.max(1, Math.round(stars)));
  const cleanMovieId = movieId.slice(0, 128);
  const ratingId = `${cleanMovieId}__${userId}`;
  const ratingRef = doc(db, 'movieRatings', ratingId);
  const reviewRef = doc(db, 'movieReviews', ratingId);

  const [existingRating, existingReview] = await Promise.all([
    getDocFromServer(ratingRef),
    getDocFromServer(reviewRef),
  ]);

  const batch = writeBatch(db);
  if (!existingRating.exists()) {
    batch.set(ratingRef, {
      ratingId,
      movieId: cleanMovieId,
      userId,
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
}

export function useMovieRatings(
  currentUserId?: string,
  onSyncedOfflineRatings?: (syncedCount: number) => void
) {
  const [records, setRecords] = useState<RatingRecord[]>(() => loadCachedRatings());
  const [pendingRatingsByMovie, setPendingRatingsByMovie] = useState<
    Record<string, PendingOfflineRating>
  >(() => loadPendingRatings());

  const onSyncedRef = useRef(onSyncedOfflineRatings);
  onSyncedRef.current = onSyncedOfflineRatings;
  const isSyncingRef = useRef(false);

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
        const next: RatingRecord[] = snapshot.docs
          .map((d) => {
            const data = d.data() as Partial<RatingRecord>;
            return {
              ratingId: data.ratingId || d.id,
              movieId: data.movieId || '',
              userId: data.userId || '',
              rating: Number(data.rating) || 0,
            };
          })
          .filter((r) => r.movieId && r.rating >= 1 && r.rating <= 5);
        setRecords(next);
        try {
          localStorage.setItem(RATINGS_CACHE_KEY, JSON.stringify(next.slice(0, 300)));
        } catch {
          // Ignore quota error
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );

    return () => unsubscribe();
  }, []);

  const syncPendingRatings = useCallback(async () => {
    if (!currentUserId || isSyncingRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const currentPending = loadPendingRatings();
    const candidates = Object.values(currentPending).filter(
      (item) => !item.userId || item.userId === currentUserId
    );
    if (candidates.length === 0) return;

    isSyncingRef.current = true;
    let syncedCount = 0;

    try {
      for (const entry of candidates) {
        const path = `movieRatings/${entry.movieId}__${currentUserId}`;
        try {
          await writeRatingToFirestore(entry.movieId, currentUserId, entry.rating);
          delete currentPending[entry.movieId];
          syncedCount += 1;
        } catch (err) {
          if (isConnectivityError(err)) {
            break;
          }
          handleFirestoreError(err, OperationType.WRITE, path);
        }
      }

      if (syncedCount > 0) {
        persistPendingRatings(currentPending);
        setPendingRatingsByMovie({ ...currentPending });
        onSyncedRef.current?.(syncedCount);
      }
    } finally {
      isSyncingRef.current = false;
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    void syncPendingRatings();

    const handleOnline = () => {
      void syncPendingRatings();
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [currentUserId, syncPendingRatings]);

  const ratingsByMovie = useMemo(() => {
    const effectiveActorId = currentUserId || OFFLINE_LOCAL_USER_ID;
    const mergedRecords = [...records];

    for (const pending of Object.values(pendingRatingsByMovie)) {
      if (pending.userId && currentUserId && pending.userId !== currentUserId) {
        continue;
      }
      if (pending.userId && !currentUserId) {
        // Pending rating created while signed in (still apply locally if offline)
        const existingIdx = mergedRecords.findIndex(
          (r) => r.movieId === pending.movieId && r.userId === pending.userId
        );
        if (existingIdx >= 0) {
          mergedRecords[existingIdx] = {
            ...mergedRecords[existingIdx],
            rating: pending.rating,
          };
        } else {
          mergedRecords.push({
            ratingId: `${pending.movieId}__${pending.userId}`,
            movieId: pending.movieId,
            userId: pending.userId,
            rating: pending.rating,
          });
        }
        continue;
      }

      const existingIdx = mergedRecords.findIndex(
        (r) => r.movieId === pending.movieId && r.userId === effectiveActorId
      );
      if (existingIdx >= 0) {
        mergedRecords[existingIdx] = {
          ...mergedRecords[existingIdx],
          rating: pending.rating,
        };
      } else {
        mergedRecords.push({
          ratingId: `${pending.movieId}__${effectiveActorId}`,
          movieId: pending.movieId,
          userId: effectiveActorId,
          rating: pending.rating,
        });
      }
    }

    const map = new Map<
      string,
      { sum: number; count: number; userRating: number | null; distribution: StarDistribution }
    >();

    for (const r of mergedRecords) {
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

      const pendingForMovie = pendingRatingsByMovie[r.movieId];
      const matchesCurrentUser = Boolean(currentUserId && r.userId === currentUserId);
      const matchesPendingLocal = Boolean(
        pendingForMovie &&
          ((!currentUserId && (r.userId === OFFLINE_LOCAL_USER_ID || r.userId === pendingForMovie.userId)) ||
            (currentUserId && !pendingForMovie.userId && r.userId === OFFLINE_LOCAL_USER_ID))
      );

      if (matchesCurrentUser || matchesPendingLocal) {
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
  }, [records, pendingRatingsByMovie, currentUserId]);

  const queueRatingOffline = useCallback(
    (movieId: string, stars: number) => {
      const cleanMovieId = movieId.slice(0, 128);
      const clamped = Math.min(5, Math.max(1, Math.round(stars)));
      const nextMap = {
        ...loadPendingRatings(),
        [cleanMovieId]: {
          movieId: cleanMovieId,
          userId: currentUserId || null,
          rating: clamped,
          updatedAtMs: Date.now(),
        },
      };
      persistPendingRatings(nextMap);
      setPendingRatingsByMovie(nextMap);
    },
    [currentUserId]
  );

  const rateMovie = useCallback(
    async (movieId: string, stars: number): Promise<RateMovieResult> => {
      const clamped = Math.min(5, Math.max(1, Math.round(stars)));
      const cleanMovieId = movieId.slice(0, 128);
      const isOfflineNow = typeof navigator !== 'undefined' && !navigator.onLine;

      if (!currentUserId || isOfflineNow) {
        queueRatingOffline(cleanMovieId, clamped);
        return 'queued-offline';
      }

      const ratingId = `${cleanMovieId}__${currentUserId}`;
      const path = `movieRatings/${ratingId}`;

      try {
        await writeRatingToFirestore(cleanMovieId, currentUserId, clamped);

        // Clear any stale pending entry for this movie once server write succeeds
        setPendingRatingsByMovie((prev) => {
          if (!(cleanMovieId in prev)) return prev;
          const next = { ...prev };
          delete next[cleanMovieId];
          persistPendingRatings(next);
          return next;
        });

        return 'synced';
      } catch (err) {
        if (isConnectivityError(err)) {
          queueRatingOffline(cleanMovieId, clamped);
          return 'queued-offline';
        }
        handleFirestoreError(err, OperationType.WRITE, path);
        return 'synced';
      }
    },
    [currentUserId, queueRatingOffline]
  );

  return {
    ratingsByMovie,
    pendingRatingsByMovie,
    rateMovie,
    syncPendingRatings,
  };
}
