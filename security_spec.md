# Security Specification — templesolosmovies.com

## 1. Data Invariants
1. **Default Deny**: Every unmatched Firestore path is denied for all reads and writes.
2. **PII Isolation**: Private account metadata (`/users/{userId}/private/account`, containing `email`) is readable and writable exclusively by `request.auth.uid == userId` or verified `isAdmin()`. No blanket `list` is permitted on `/users`.
3. **Public Profile Boundaries**: `/users/{userId}/public/profile` contains only non-PII fields (`uid`, `displayName`, `favoriteGenre`, `createdAt`, `updatedAt`) and enforces strict string length bounds and immutable `uid` / `createdAt`.
4. **Watchlist Ownership**: `/users/{userId}/savedMovies/{movieId}` documents belong strictly to `userId`; `userId` and `movieId` must match the path variables, and `addedAt` must equal `request.time`.
5. **Movie Ratings Integrity**: `/movieRatings/{ratingId}` enforces `ratingId == movieId + '__' + userId`, integer `rating` in `[1, 5]`, `userId == request.auth.uid`, and server timestamps.
6. **Administrator RBAC (`/admins/{userId}`)**: `isAdmin()` requires either an existing `/admins/{request.auth.uid}` record OR `request.auth.token.email_verified == true && request.auth.token.email == 'madubachigozie00@gmail.com'`. Ordinary users cannot create or modify `/admins/{userId}` documents, nor can they upload, edit, or delete catalog movies via `/api/movies` (`POST`, `PATCH`, `DELETE`).
7. **Action-Based Updates**: Updates validate the full schema and constrain `affectedKeys().hasOnly(...)` per action, preserving immutable `uid` and `createdAt`.
8. **Coming Soon & Release Notifications**: `/upcomingMovies/{releaseId}` is readable when `status in ['upcoming', 'released']` and writable exclusively by verified `isAdmin()`. User notification subscriptions at `/users/{userId}/releaseNotifications/{releaseId}` contain user `email` (PII) and are strictly isolated to `isOwner(userId)` or `isAdmin()` with server `subscribedAt == request.time`.
9. **Formal Movie Reviews Integrity**: `/movieReviews/{reviewId}` enforces `reviewId == movieId + '__' + userId`, integer `rating` in `[1, 5]`, non-empty `headline` (`3..120` chars) and `body` (`20..2000` chars), `containsSpoilers` boolean, `userId == request.auth.uid`, immutable `movieId`/`userId`/`createdAt`, and server timestamps. Updates and deletes are restricted to the review author or verified `isAdmin()`.
10. **Watch Progress Ownership**: `/users/{userId}/watchProgress/{movieId}` stores non-PII numeric playback timestamps (`progressSeconds`, `durationSeconds` in `[0, 86400]`) strictly isolated to `isOwner(userId)`, with immutable `movieId`/`userId` and server `updatedAt == request.time`.
11. **User Settings Ownership**: `/users/{userId}/settings/preferences` stores strict allowlisted app settings (`videoQuality`, `downloadQuality`, `downloadWifiOnly`, `notificationsEnabled`, `language`) scoped strictly to `isOwner(userId)` with server `updatedAt == request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated profile read**: Unauthenticated client requests `get /users/user123/private/account` → `PERMISSION_DENIED`.
2. **Cross-user PII read**: Authenticated ordinary `userA` requests `get /users/userB/private/account` → `PERMISSION_DENIED`.
3. **Cross-user watchlist list**: Authenticated ordinary `userA` runs `list /users/userB/savedMovies` → `PERMISSION_DENIED`.
4. **Shadow field injection on profile create**: `userA` creates `/users/userA/public/profile` with extra field `isAdmin: true` → `PERMISSION_DENIED` (`hasOnly` check).
5. **Identity spoofing on profile create**: `userA` creates `/users/userA/public/profile` with `uid: "userB"` → `PERMISSION_DENIED`.
6. **Oversized ID poisoning**: `userA` writes `/users/userA/savedMovies/${'x'.repeat(200)}` → `PERMISSION_DENIED` (`isValidId`).
7. **Invalid character ID injection**: `userA` writes `/users/userA/savedMovies/bad$id!` → `PERMISSION_DENIED`.
8. **Client-forged timestamp**: `userA` creates `/users/userA/savedMovies/m1` with `addedAt` set to a past date instead of `request.time` → `PERMISSION_DENIED`.
9. **Immutable field mutation**: `userA` updates `/users/userA/public/profile` attempting to change `createdAt` or `uid` → `PERMISSION_DENIED`.
10. **Value poisoning (type mismatch)**: `userA` updates `/users/userA/public/profile` with `displayName: 12345` → `PERMISSION_DENIED`.
11. **Self-assigned admin escalation**: Ordinary `userA` attempts to create `/admins/userA` or spoof unverified admin email → `PERMISSION_DENIED` (`email_verified == true` + `isAdmin()`).
12. **Blanket collection read**: Authenticated ordinary `userA` queries `list /users` or `list /admins` → `PERMISSION_DENIED`.
