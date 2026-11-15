/**
 * Security verification specification for templesolosmovies.com Firestore rules.
 * Validates the 12 adversarial "Dirty Dozen" payloads against firestore.rules.
 */
export const DIRTY_DOZEN_CASES = [
  { name: 'Unauthenticated private account read', path: '/users/u1/private/account', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-user private account read', path: '/users/u2/private/account', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-user savedMovies list', path: '/users/u2/savedMovies', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Shadow field isAdmin on profile create', path: '/users/u1/public/profile', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'UID spoofing on profile create', path: '/users/u1/public/profile', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Oversized movieId path injection', path: '/users/u1/savedMovies/oversized', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Invalid regex characters in movieId', path: '/users/u1/savedMovies/bad$id', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Forged addedAt timestamp on savedMovie', path: '/users/u1/savedMovies/m1', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Immutable createdAt mutation on profile update', path: '/users/u1/public/profile', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Type poisoning on displayName update', path: '/users/u1/public/profile', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Ordinary user self-granting /admins/{uid} role', path: '/admins/u1', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Ordinary user listing /admins registry', path: '/admins', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-user releaseNotification read', path: '/users/u2/releaseNotifications/upcoming-1', actor: 'u1', expected: 'PERMISSION_DENIED' },
  { name: 'Ordinary user creating /upcomingMovies entry', path: '/upcomingMovies/upcoming-new', actor: 'u1', expected: 'PERMISSION_DENIED' },
] as const;

