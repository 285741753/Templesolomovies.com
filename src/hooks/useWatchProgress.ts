import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { WatchProgressEntry } from '../types/cinema';

const GUEST_STORAGE_KEY = 'tsm_watch_progress_guest';

function loadGuestProgress(): Record<string, WatchProgressEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, WatchProgressEntry>;
    if (!parsed || typeof parsed !== 'object') return {};
    const valid: Record<string, WatchProgressEntry> = {};
    for (const [movieId, item] of Object.entries(parsed)) {
      if (
        item &&
        typeof item.progressSeconds === 'number' &&
        typeof item.durationSeconds === 'number' &&
        item.progressSeconds > 0 &&
        item.durationSeconds > 0
      ) {
        valid[movieId] = {
          movieId,
          userId: 'guest',
          progressSeconds: item.progressSeconds,
          durationSeconds: item.durationSeconds,
          updatedAtMs: Number(item.updatedAtMs) || Date.now(),
        };
      }
    }
    return valid;
  } catch {
    return {};
  }
}

function persistGuestProgress(map: Record<string, WatchProgressEntry>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function toMillis(val: unknown): number {
  if (val && typeof (val as Timestamp).toMillis === 'function') {
    return (val as Timestamp).toMillis();
  }
  return Date.now();
}

export function useWatchProgress(userId: string | undefined, authReady: boolean) {
  const [progressByMovie, setProgressByMovie] = useState<Record<string, WatchProgressEntry>>(() =>
    loadGuestProgress()
  );

  useEffect(() => {
    if (!authReady) return;

    if (!userId) {
      setProgressByMovie(loadGuestProgress());
      return;
    }

    const colPath = `users/${userId}/watchProgress`;
    const colRef = collection(db, 'users', userId, 'watchProgress');

    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        const next: Record<string, WatchProgressEntry> = {};
        for (const d of snapshot.docs) {
          const data = d.data() as {
            movieId?: string;
            userId?: string;
            progressSeconds?: number;
            durationSeconds?: number;
            updatedAt?: unknown;
          };
          const movieId = (data.movieId || d.id).slice(0, 128);
          const progressSeconds = Number(data.progressSeconds) || 0;
          const durationSeconds = Number(data.durationSeconds) || 0;
          if (movieId && progressSeconds > 0 && durationSeconds > 0) {
            next[movieId] = {
              movieId,
              userId: data.userId || userId,
              progressSeconds,
              durationSeconds,
              updatedAtMs: toMillis(data.updatedAt),
            };
          }
        }
        setProgressByMovie(next);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, colPath);
      }
    );

    return () => unsubscribe();
  }, [userId, authReady]);

  const clearProgress = useCallback(
    async (movieId: string) => {
      const cleanId = movieId.slice(0, 128);
      if (!cleanId) return;

      if (!userId) {
        setProgressByMovie((prev) => {
          if (!(cleanId in prev)) return prev;
          const next = { ...prev };
          delete next[cleanId];
          persistGuestProgress(next);
          return next;
        });
        return;
      }

      setProgressByMovie((prev) => {
        if (!(cleanId in prev)) return prev;
        const next = { ...prev };
        delete next[cleanId];
        return next;
      });

      const docPath = `users/${userId}/watchProgress/${cleanId}`;
      try {
        await deleteDoc(doc(db, 'users', userId, 'watchProgress', cleanId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, docPath);
      }
    },
    [userId]
  );

  const saveProgress = useCallback(
    async (movieId: string, rawProgress: number, rawDuration: number) => {
      const cleanId = movieId.slice(0, 128);
      if (!cleanId || !Number.isFinite(rawDuration) || rawDuration <= 0) return;

      const durationSeconds = Math.min(86400, Math.max(0.1, Math.round(rawDuration * 10) / 10));
      const progressSeconds = Math.min(
        durationSeconds,
        Math.max(0, Math.round(rawProgress * 10) / 10)
      );

      const minStart = Math.min(2, durationSeconds * 0.15);
      const endBuffer = Math.min(3, durationSeconds * 0.05);

      if (progressSeconds >= durationSeconds - endBuffer) {
        await clearProgress(cleanId);
        return;
      }

      if (progressSeconds < minStart) {
        return;
      }

      const nowMs = Date.now();
      const entry: WatchProgressEntry = {
        movieId: cleanId,
        userId: userId || 'guest',
        progressSeconds,
        durationSeconds,
        updatedAtMs: nowMs,
      };

      if (!userId) {
        setProgressByMovie((prev) => {
          const next = { ...prev, [cleanId]: entry };
          persistGuestProgress(next);
          return next;
        });
        return;
      }

      setProgressByMovie((prev) => ({
        ...prev,
        [cleanId]: entry,
      }));

      const docPath = `users/${userId}/watchProgress/${cleanId}`;
      try {
        await setDoc(doc(db, 'users', userId, 'watchProgress', cleanId), {
          movieId: cleanId,
          userId,
          progressSeconds,
          durationSeconds,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    },
    [userId, clearProgress]
  );

  const continueWatchingList = useMemo(() => {
    return Object.values(progressByMovie).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [progressByMovie]);

  return {
    progressByMovie,
    continueWatchingList,
    saveProgress,
    clearProgress,
  };
}
