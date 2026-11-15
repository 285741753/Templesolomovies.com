import { useEffect, useState } from 'react';
import { X, Mail, Lock, User as UserIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'signup';
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

function formatAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  const message = err instanceof Error ? err.message : String(err);

  if (code === 'auth/operation-not-allowed' || message.includes('operation-not-allowed')) {
    return 'Email/Password sign-in is not yet enabled in Firebase Console (Authentication → Sign-in method → Email/Password). You can enable it there or sign in with Google below.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'An account with this email already exists. Try logging in instead.';
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Invalid email or password. Please check your credentials and try again.';
  }
  if (code === 'auth/weak-password') {
    return 'Password must be at least 6 characters long.';
  }
  if (code === 'auth/invalid-email') {
    return 'Please enter a valid email address.';
  }
  if (code === 'auth/popup-closed-by-user') {
    return 'Google sign-in window was closed before completing.';
  }
  return message || 'Authentication failed. Please try again.';
}

export function AuthModal({
  isOpen,
  initialMode = 'login',
  onClose,
  onSuccess,
}: AuthModalProps) {
  const { signUpWithEmail, logInWithEmail, logInWithGoogle } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError('');
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'signup') {
      if (!displayName.trim()) {
        setError('Please enter a display name.');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(email, password, displayName);
        onSuccess?.(`Welcome to templesolosmovies.com, ${displayName.trim()}!`);
      } else {
        await logInWithEmail(email, password);
        onSuccess?.('Signed in to your account.');
      }
      onClose();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await logInWithGoogle();
      onSuccess?.('Signed in with Google.');
      onClose();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#09090B]/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-[#27272A] bg-[#111114] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#27272A] px-6 py-4">
          <div className="flex items-center gap-3">
            <img
              src="/app-icon.jpg"
              alt="templesolosmovies.com"
              className="h-8 w-8 rounded-lg object-cover border border-[#27272A]"
            />
            <div>
              <h2
                id="auth-modal-title"
                className="font-display text-lg font-semibold text-[#FAFAFA]"
              >
                {mode === 'login' ? 'Log in to your account' : 'Create an account'}
              </h2>
              <p className="text-xs text-[#A1A1AA]">
                Save movies, manage your uploads, and personalize chat
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close authentication modal"
            className="rounded-lg p-2 text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Login / Sign Up Switcher */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#09090B] p-1 border border-[#27272A]">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`rounded-md py-2 text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'bg-[#18181B] text-[#FAFAFA]'
                  : 'text-[#71717A] hover:text-[#D4D4D8]'
              }`}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError('');
              }}
              className={`rounded-md py-2 text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'signup'
                  ? 'bg-[#18181B] text-[#FAFAFA]'
                  : 'text-[#71717A] hover:text-[#D4D4D8]'
              }`}
            >
              Sign Up
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200 leading-relaxed"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label
                  htmlFor="auth-display-name"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Display Name
                </label>
                <div className="relative">
                  <UserIcon
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717A]"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-display-name"
                    type="text"
                    required
                    maxLength={40}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. TempleSolo"
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] py-2.5 pl-9 pr-3 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717A]"
                  aria-hidden="true"
                />
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-[#27272A] bg-[#09090B] py-2.5 pl-9 pr-3 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717A]"
                  aria-hidden="true"
                />
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full rounded-lg border border-[#27272A] bg-[#09090B] py-2.5 pl-9 pr-3 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                />
              </div>
            </div>

            {mode === 'signup' && (
              <div>
                <label
                  htmlFor="auth-confirm-password"
                  className="block text-xs font-medium text-[#D4D4D8] mb-1.5"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717A]"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-confirm-password"
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full rounded-lg border border-[#27272A] bg-[#09090B] py-2.5 pl-9 pr-3 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-[#E5A93B] py-2.5 text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting
                ? 'Please wait...'
                : mode === 'login'
                ? 'Log In'
                : 'Create Account'}
            </button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-[#27272A]" />
            <span className="mx-3 shrink text-xs text-[#71717A]">or</span>
            <div className="flex-grow border-t border-[#27272A]" />
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleGoogleSignIn}
            className="w-full rounded-lg border border-[#27272A] bg-[#18181B] py-2.5 text-sm font-medium text-[#FAFAFA] hover:bg-[#27272A] disabled:opacity-50 cursor-pointer"
          >
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}
