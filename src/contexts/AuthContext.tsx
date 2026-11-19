import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import type { Movie, MovieGenre } from '../types/cinema';

export interface UserProfile {
  uid: string;
  displayName: string;
  favoriteGenre?: MovieGenre;
}

export interface SavedMovieEntry {
  movieId: string;
  userId: string;
  title: string;
  genre: string;
  quality: string;
  year: number;
  posterUrl: string;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  savedMovies: SavedMovieEntry[];
  authReady: boolean;
  isAdmin: boolean;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  logInWithEmail: (email: string, password: string) => Promise<void>;
  logInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  updateUserProfile: (displayName: string, favoriteGenre?: MovieGenre) => Promise<void>;
  toggleSaveMovie: (movie: Movie) => Promise<boolean>;
  isMovieSaved: (movieId: string) => boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const BOOTSTRAP_ADMIN_EMAIL = 'madubachigozie00@gmail.com';
const AuthContext = createContext<AuthContextValue | null>(null);
const pendingUserInit = new Map<string, Promise<void>>();

function sanitizeDisplayName(name: string, fallbackEmail?: string | null): string {
  const cleaned = name.trim().slice(0, 40);
  if (cleaned) return cleaned;
  if (fallbackEmail) {
    return fallbackEmail.split('@')[0].slice(0, 40) || 'Member';
  }
  return 'Member';
}

function ensureUserDocuments(user: User, preferredName?: string): Promise<void> {
  const existingPromise = pendingUserInit.get(user.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const run = (async () => {
    const displayName = sanitizeDisplayName(
      preferredName || user.displayName || '',
      user.email
    );

    const publicPath = `users/${user.uid}/public/profile`;
    const publicRef = doc(db, 'users', user.uid, 'public', 'profile');
    try {
      const snap = await getDocFromServer(publicRef);
      if (!snap.exists()) {
        await setDoc(publicRef, {
          uid: user.uid,
          displayName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, publicPath);
    }

    if (user.email) {
      const privatePath = `users/${user.uid}/private/account`;
      const privateRef = doc(db, 'users', user.uid, 'private', 'account');
      try {
        const privSnap = await getDocFromServer(privateRef);
        if (!privSnap.exists()) {
          await setDoc(privateRef, {
            uid: user.uid,
            email: user.email.slice(0, 160),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, privatePath);
      }
    }
  })().finally(() => {
    pendingUserInit.delete(user.uid);
  });

  pendingUserInit.set(user.uid, run);
  return run;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [savedMovies, setSavedMovies] = useState<SavedMovieEntry[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setProfile(null);
        setSavedMovies([]);
        setIsAdmin(false);
        return;
      }

      const isBootstrapAdmin = Boolean(
        nextUser.emailVerified &&
          nextUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
      );

      let cachedDisplayName = sanitizeDisplayName(nextUser.displayName || '', nextUser.email);
      let cachedAdmin = isBootstrapAdmin;
      try {
        const rawHint = localStorage.getItem(`tsm_auth_hint_${nextUser.uid}`);
        if (rawHint) {
          const parsed = JSON.parse(rawHint) as { displayName?: string; isAdmin?: boolean };
          if (parsed.displayName) cachedDisplayName = parsed.displayName;
          if (!isBootstrapAdmin && typeof parsed.isAdmin === 'boolean') cachedAdmin = parsed.isAdmin;
        }
      } catch {
        // Ignore cache read error
      }

      setIsAdmin(cachedAdmin);
      setProfile({
        uid: nextUser.uid,
        displayName: cachedDisplayName,
      });

      // Run Firestore user doc sync in background so auth & admin UI are instant
      void ensureUserDocuments(nextUser).catch(() => {
        // Error already logged cleanly by handleFirestoreError
      });

      if (!isBootstrapAdmin) {
        const adminPath = `admins/${nextUser.uid}`;
        try {
          const adminSnap = await getDocFromServer(doc(db, 'admins', nextUser.uid));
          const resolvedAdmin = adminSnap.exists();
          setIsAdmin(resolvedAdmin);
          try {
            localStorage.setItem(
              `tsm_auth_hint_${nextUser.uid}`,
              JSON.stringify({ displayName: cachedDisplayName, isAdmin: resolvedAdmin })
            );
          } catch {
            // Ignore cache write error
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, adminPath);
        }
      }
    });
    return unsub;
  }, []);

  // Sync user's public profile & saved watchlist only when authenticated
  useEffect(() => {
    if (!authReady || !user) return;

    const profilePath = `users/${user.uid}/public/profile`;
    const profileRef = doc(db, 'users', user.uid, 'public', 'profile');
    const unsubProfile = onSnapshot(
      profileRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as {
            uid?: string;
            displayName?: string;
            favoriteGenre?: MovieGenre;
          };
          setProfile({
            uid: data.uid || user.uid,
            displayName: data.displayName || user.displayName || 'Member',
            favoriteGenre: data.favoriteGenre,
          });
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, profilePath);
      }
    );

    const savedPath = `users/${user.uid}/savedMovies`;
    const savedCol = collection(db, 'users', user.uid, 'savedMovies');
    const unsubSaved = onSnapshot(
      savedCol,
      (snapshot) => {
        const items: SavedMovieEntry[] = snapshot.docs.map((d) => {
          const data = d.data() as SavedMovieEntry;
          return {
            movieId: data.movieId || d.id,
            userId: data.userId || user.uid,
            title: data.title || '',
            genre: data.genre || '',
            quality: data.quality || '',
            year: Number(data.year) || 2026,
            posterUrl: data.posterUrl || '',
          };
        });
        setSavedMovies(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, savedPath);
      }
    );

    return () => {
      unsubProfile();
      unsubSaved();
    };
  }, [authReady, user]);

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName: string) => {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const cleanName = sanitizeDisplayName(displayName, email);
      await updateProfile(cred.user, { displayName: cleanName });
      await ensureUserDocuments(cred.user, cleanName);

      const profilePath = `users/${cred.user.uid}/public/profile`;
      const profileRef = doc(db, 'users', cred.user.uid, 'public', 'profile');
      try {
        await updateDoc(profileRef, {
          displayName: cleanName,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, profilePath);
      }
      setProfile({ uid: cred.user.uid, displayName: cleanName });
    },
    []
  );

  const logInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const logInWithGoogle = useCallback(async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    await ensureUserDocuments(cred.user);
  }, []);

  const logOut = useCallback(async () => {
    await signOut(auth);
  }, []);

  const updateUserProfile = useCallback(
    async (displayName: string, favoriteGenre?: MovieGenre) => {
      if (!user) return;
      const cleanName = sanitizeDisplayName(displayName, user.email);
      await updateProfile(user, { displayName: cleanName });
      await ensureUserDocuments(user, cleanName);

      const profilePath = `users/${user.uid}/public/profile`;
      const profileRef = doc(db, 'users', user.uid, 'public', 'profile');
      try {
        const payload: Record<string, unknown> = {
          displayName: cleanName,
          updatedAt: serverTimestamp(),
        };
        if (favoriteGenre) {
          payload.favoriteGenre = favoriteGenre;
        }
        await updateDoc(profileRef, payload);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, profilePath);
      }
    },
    [user]
  );

  const isMovieSaved = useCallback(
    (movieId: string) => savedMovies.some((m) => m.movieId === movieId),
    [savedMovies]
  );

  const toggleSaveMovie = useCallback(
    async (movie: Movie): Promise<boolean> => {
      if (!user) return false;
      const docPath = `users/${user.uid}/savedMovies/${movie.id}`;
      const docRef = doc(db, 'users', user.uid, 'savedMovies', movie.id);
      const alreadySaved = savedMovies.some((m) => m.movieId === movie.id);

      try {
        if (alreadySaved) {
          await deleteDoc(docRef);
          return false;
        } else {
          await setDoc(docRef, {
            movieId: movie.id.slice(0, 128),
            userId: user.uid,
            title: movie.title.slice(0, 140),
            genre: movie.genre.slice(0, 32),
            quality: movie.quality.slice(0, 24),
            year: Number(movie.year) || 2026,
            posterUrl: (movie.posterUrl || '/app-icon.jpg').slice(0, 500),
            addedAt: serverTimestamp(),
          });
          return true;
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    },
    [user, savedMovies]
  );

  const getIdToken = useCallback(async (forceRefresh = false) => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken(forceRefresh);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        savedMovies,
        authReady,
        isAdmin,
        signUpWithEmail,
        logInWithEmail,
        logInWithGoogle,
        logOut,
        updateUserProfile,
        toggleSaveMovie,
        isMovieSaved,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
