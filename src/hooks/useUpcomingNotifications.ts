import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { MovieGenre, MovieQuality, UpcomingMovie } from '../types/cinema';

const GUEST_SUBS_KEY = 'tsm_upcoming_subs';
const GUEST_EMAIL_KEY = 'tsm_notify_email';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadGuestSubs(): string[] {
  try {
    const raw = localStorage.getItem(GUEST_SUBS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function loadGuestEmail(): string {
  try {
    return localStorage.getItem(GUEST_EMAIL_KEY) || '';
  } catch {
    return '';
  }
}

export function isValidNotificationEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export function useUpcomingNotifications({
  user,
  authReady,
  getIdToken,
}: {
  user: User | null;
  authReady: boolean;
  getIdToken: () => Promise<string | null>;
}) {
  const [upcomingMovies, setUpcomingMovies] = useState<UpcomingMovie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [firestoreSubIds, setFirestoreSubIds] = useState<string[]>([]);
  const [guestSubIds, setGuestSubIds] = useState<string[]>(() => loadGuestSubs());
  const [savedEmail, setSavedEmail] = useState<string>(() => loadGuestEmail());

  const fetchUpcoming = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/upcoming');
      if (!resp.ok) {
        throw new Error('Could not load upcoming releases.');
      }
      const data = (await resp.json()) as { upcoming?: UpcomingMovie[] };
      if (Array.isArray(data.upcoming)) {
        setUpcomingMovies(data.upcoming);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load upcoming releases.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUpcoming();
  }, [fetchUpcoming]);

  // Attach Firestore listener strictly when authReady && user is authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setFirestoreSubIds([]);
      return;
    }

    const path = `users/${user.uid}/releaseNotifications`;
    const colRef = collection(db, 'users', user.uid, 'releaseNotifications');
    const unsub = onSnapshot(
      colRef,
      (snapshot) => {
        const ids = snapshot.docs.map((d) => d.id);
        setFirestoreSubIds(ids);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );

    return () => unsub();
  }, [authReady, user]);

  const subscribedIdSet = useMemo(() => {
    if (user) {
      return new Set(firestoreSubIds);
    }
    return new Set(guestSubIds);
  }, [user, firestoreSubIds, guestSubIds]);

  const effectiveEmail = useMemo(() => {
    return (user?.email || savedEmail || '').trim().toLowerCase();
  }, [user?.email, savedEmail]);

  const persistGuestSubs = useCallback((nextIds: string[], email?: string) => {
    setGuestSubIds(nextIds);
    try {
      localStorage.setItem(GUEST_SUBS_KEY, JSON.stringify(nextIds));
      if (email) {
        localStorage.setItem(GUEST_EMAIL_KEY, email);
        setSavedEmail(email);
      }
    } catch {
      // Ignore storage quota issues
    }
  }, []);

  const updateCountLocally = useCallback((releaseId: string, subscriberCount: number) => {
    setUpcomingMovies((prev) =>
      prev.map((m) => (m.id === releaseId ? { ...m, subscriberCount } : m))
    );
  }, []);

  const subscribeToRelease = useCallback(
    async (
      release: UpcomingMovie,
      customEmail?: string
    ): Promise<{ ok: boolean; email: string; subscriberCount: number }> => {
      const targetEmail = (customEmail || effectiveEmail).trim().toLowerCase().slice(0, 160);
      if (!isValidNotificationEmail(targetEmail)) {
        throw new Error('Please enter a valid email address.');
      }

      if (user) {
        const docPath = `users/${user.uid}/releaseNotifications/${release.id}`;
        const docRef = doc(db, 'users', user.uid, 'releaseNotifications', release.id);
        try {
          await setDoc(docRef, {
            releaseId: release.id.slice(0, 128),
            userId: user.uid,
            movieTitle: release.title.slice(0, 140),
            releaseDate: release.releaseDate.slice(0, 32),
            email: targetEmail,
            subscribedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, docPath);
        }
      }

      const token = user ? await getIdToken() : null;
      const resp = await fetch(`/api/upcoming/${encodeURIComponent(release.id)}/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: targetEmail, action: 'subscribe' }),
      });

      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || 'Failed to subscribe for release alerts.');
      }

      const data = (await resp.json()) as {
        subscriberCount: number;
        email: string;
      };
      updateCountLocally(release.id, data.subscriberCount);

      if (!user) {
        const nextIds = Array.from(new Set([...guestSubIds, release.id]));
        persistGuestSubs(nextIds, targetEmail);
      } else if (customEmail) {
        setSavedEmail(targetEmail);
      }

      return { ok: true, email: data.email || targetEmail, subscriberCount: data.subscriberCount };
    },
    [effectiveEmail, user, getIdToken, updateCountLocally, guestSubIds, persistGuestSubs]
  );

  const unsubscribeFromRelease = useCallback(
    async (release: UpcomingMovie): Promise<void> => {
      const targetEmail = effectiveEmail;

      if (user) {
        const docPath = `users/${user.uid}/releaseNotifications/${release.id}`;
        const docRef = doc(db, 'users', user.uid, 'releaseNotifications', release.id);
        try {
          await deleteDoc(docRef);
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, docPath);
        }
      }

      if (targetEmail && isValidNotificationEmail(targetEmail)) {
        const token = user ? await getIdToken() : null;
        const resp = await fetch(`/api/upcoming/${encodeURIComponent(release.id)}/notify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ email: targetEmail, action: 'unsubscribe' }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { subscriberCount: number };
          updateCountLocally(release.id, data.subscriberCount);
        }
      }

      if (!user) {
        const nextIds = guestSubIds.filter((id) => id !== release.id);
        persistGuestSubs(nextIds);
      }
    },
    [effectiveEmail, user, getIdToken, updateCountLocally, guestSubIds, persistGuestSubs]
  );

  const subscribeToAllUpcoming = useCallback(
    async (customEmail?: string): Promise<{ count: number; email: string }> => {
      const targetEmail = (customEmail || effectiveEmail).trim().toLowerCase().slice(0, 160);
      if (!isValidNotificationEmail(targetEmail)) {
        throw new Error('Please enter a valid email address.');
      }

      if (user) {
        for (const release of upcomingMovies) {
          if (subscribedIdSet.has(release.id)) continue;
          const docPath = `users/${user.uid}/releaseNotifications/${release.id}`;
          const docRef = doc(db, 'users', user.uid, 'releaseNotifications', release.id);
          try {
            await setDoc(docRef, {
              releaseId: release.id.slice(0, 128),
              userId: user.uid,
              movieTitle: release.title.slice(0, 140),
              releaseDate: release.releaseDate.slice(0, 32),
              email: targetEmail,
              subscribedAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, docPath);
          }
        }
      }

      const token = user ? await getIdToken() : null;
      const resp = await fetch('/api/upcoming/notify-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: targetEmail }),
      });

      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || 'Could not subscribe to upcoming alerts.');
      }

      const data = (await resp.json()) as { subscribedIds: string[]; email: string };
      if (!user) {
        persistGuestSubs(data.subscribedIds, targetEmail);
      } else {
        setSavedEmail(targetEmail);
      }

      return { count: data.subscribedIds.length, email: data.email || targetEmail };
    },
    [effectiveEmail, user, upcomingMovies, subscribedIdSet, getIdToken, persistGuestSubs]
  );

  const createUpcomingRelease = useCallback(
    async (input: {
      title: string;
      genre: MovieGenre;
      releaseDate: string;
      duration: string;
      quality: MovieQuality;
      director: string;
      synopsis: string;
      posterFile?: File | null;
    }): Promise<UpcomingMovie> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error('Administrator authentication required.');
      }

      const form = new FormData();
      form.append('title', input.title);
      form.append('genre', input.genre);
      form.append('releaseDate', input.releaseDate);
      form.append('duration', input.duration);
      form.append('quality', input.quality);
      form.append('director', input.director);
      form.append('synopsis', input.synopsis);
      if (input.posterFile) {
        form.append('poster', input.posterFile);
      }

      const resp = await fetch('/api/upcoming', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || 'Failed to schedule upcoming movie.');
      }

      const data = (await resp.json()) as { upcoming: UpcomingMovie };
      setUpcomingMovies((prev) => {
        if (prev.some((u) => u.id === data.upcoming.id)) return prev;
        return [...prev, data.upcoming].sort((a, b) =>
          a.releaseDate.localeCompare(b.releaseDate)
        );
      });
      return data.upcoming;
    },
    [getIdToken]
  );

  const deleteUpcomingRelease = useCallback(
    async (releaseId: string): Promise<void> => {
      const token = await getIdToken();
      if (!token) return;
      const resp = await fetch(`/api/upcoming/${encodeURIComponent(releaseId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        setUpcomingMovies((prev) => prev.filter((u) => u.id !== releaseId));
      }
    },
    [getIdToken]
  );

  const handleWsUpcomingCreated = useCallback((upcoming: UpcomingMovie) => {
    setUpcomingMovies((prev) => {
      if (prev.some((u) => u.id === upcoming.id)) return prev;
      return [...prev, upcoming].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    });
  }, []);

  const handleWsUpcomingDeleted = useCallback((releaseId: string) => {
    setUpcomingMovies((prev) => prev.filter((u) => u.id !== releaseId));
  }, []);

  const handleWsSubscriberUpdated = useCallback(
    (releaseId: string, subscriberCount: number) => {
      updateCountLocally(releaseId, subscriberCount);
    },
    [updateCountLocally]
  );

  return {
    upcomingMovies,
    isLoading,
    error,
    subscribedIdSet,
    effectiveEmail,
    retryFetch: fetchUpcoming,
    subscribeToRelease,
    unsubscribeFromRelease,
    subscribeToAllUpcoming,
    createUpcomingRelease,
    deleteUpcomingRelease,
    handleWsUpcomingCreated,
    handleWsUpcomingDeleted,
    handleWsSubscriberUpdated,
  };
}
