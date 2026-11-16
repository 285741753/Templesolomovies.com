import { useEffect, useRef, useState } from 'react';
import { Users, Copy, Check, X, Tv, Play, Pause, Share2 } from 'lucide-react';
import type { Movie, WatchPartyState } from '../types/cinema';

interface WatchPartyModalProps {
  isOpen: boolean;
  movies: Movie[];
  partyState: WatchPartyState | null;
  currentUserId: string;
  onJoinOrCreateRoom: (roomCode: string, movieId?: string) => void;
  onSyncPlayback: (roomCode: string, movieId: string, isPlaying: boolean, currentTime: number) => void;
  onLeaveRoom: (roomCode: string) => void;
  onClose: () => void;
}

export function WatchPartyModal({
  isOpen,
  movies,
  partyState,
  currentUserId,
  onJoinOrCreateRoom,
  onSyncPlayback,
  onLeaveRoom,
  onClose,
}: WatchPartyModalProps) {
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const applyingRemoteRef = useRef(false);

  const activeMovie =
    movies.find((m) => m.id === partyState?.movieId) || movies[0] || null;

  useEffect(() => {
    const video = videoRef.current;
    if (!isOpen || !partyState || !video) return;

    const elapsedSinceUpdate = Math.max(0, (Date.now() - partyState.updatedAt) / 1000);
    const targetTime = partyState.isPlaying
      ? partyState.currentTime + elapsedSinceUpdate
      : partyState.currentTime;

    applyingRemoteRef.current = true;
    if (Math.abs(video.currentTime - targetTime) > 0.85) {
      video.currentTime = targetTime;
    }

    if (partyState.isPlaying && video.paused) {
      void video.play().catch(() => {});
    } else if (!partyState.isPlaying && !video.paused) {
      video.pause();
    }

    const timer = window.setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isOpen, partyState]);

  if (!isOpen) return null;

  const handleCopyInvite = async () => {
    if (!partyState) return;
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set('party', partyState.roomCode);
    const urlStr = shareUrl.toString();

    try {
      if (navigator.share) {
        await navigator.share({
          title: `Watch Party · ${activeMovie?.title || 'templesolosmovies.com'}`,
          text: `Join room ${partyState.roomCode} on templesolosmovies.com`,
          url: urlStr,
        });
        return;
      }
    } catch {
      // Fall back to clipboard
    }

    await navigator.clipboard.writeText(urlStr);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2000);
  };

  const emitSync = (nextPlaying: boolean, explicitTime?: number) => {
    if (!partyState || !activeMovie) return;
    const t = explicitTime ?? videoRef.current?.currentTime ?? partyState.currentTime;
    onSyncPlayback(partyState.roomCode, activeMovie.id, nextPlaying, t);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Watch Party Room"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-4xl rounded-2xl border border-[#27272A] bg-[#111114] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-[#27272A] px-5 py-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Tv className="h-5 w-5 text-[#E5A93B] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-[#FAFAFA] truncate">
                Synchronized Watch Party
              </h2>
              <p className="text-xs text-[#A1A1AA]">
                {partyState
                  ? `Room ${partyState.roomCode} · ${partyState.participants.length} watching live`
                  : 'Create a shared room or enter a room code to watch in sync.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Watch Party"
            className="rounded-lg p-1.5 text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {!partyState ? (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-[#27272A] bg-[#09090B] p-5 space-y-3">
                <p className="text-sm font-semibold text-[#FAFAFA]">Host a New Room</p>
                <p className="text-xs text-[#A1A1AA]">
                  Start a synchronized screening room and invite friends with a shareable link.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
                    onJoinOrCreateRoom(code, movies[0]?.id);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  <span>Create Room</span>
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = joinCodeInput.trim().toUpperCase();
                  if (clean) onJoinOrCreateRoom(clean);
                }}
                className="rounded-xl border border-[#27272A] bg-[#09090B] p-5 space-y-3"
              >
                <p className="text-sm font-semibold text-[#FAFAFA]">Join with Room Code</p>
                <p className="text-xs text-[#A1A1AA]">
                  Enter a 6-character party code shared by a friend.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    placeholder="e.g. A7K2MP"
                    maxLength={12}
                    className="flex-1 rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-xs font-mono uppercase text-[#FAFAFA] focus:border-[#E5A93B] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!joinCodeInput.trim()}
                    className="rounded-lg border border-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#E5A93B] hover:bg-[#E5A93B]/10 disabled:opacity-40 cursor-pointer"
                  >
                    Join
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 space-y-3">
              {activeMovie ? (
                <video
                  ref={videoRef}
                  src={activeMovie.videoUrl}
                  poster={activeMovie.posterUrl}
                  controls
                  playsInline
                  onPlay={() => {
                    if (!applyingRemoteRef.current) emitSync(true);
                  }}
                  onPause={() => {
                    if (!applyingRemoteRef.current) emitSync(false);
                  }}
                  onSeeked={() => {
                    if (!applyingRemoteRef.current && videoRef.current) {
                      emitSync(!videoRef.current.paused, videoRef.current.currentTime);
                    }
                  }}
                  className="w-full aspect-video rounded-xl border border-[#27272A] bg-black"
                />
              ) : (
                <div className="w-full aspect-video rounded-xl border border-[#27272A] bg-black flex items-center justify-center text-xs text-[#71717A]">
                  No movie available in vault yet.
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => emitSync(!partyState.isPlaying)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#E5A93B] px-3.5 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
                  >
                    {partyState.isPlaying ? (
                      <>
                        <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Pause for Everyone</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                        <span>Play for Everyone</span>
                      </>
                    )}
                  </button>

                  <select
                    value={activeMovie?.id || ''}
                    onChange={(e) => {
                      onSyncPlayback(partyState.roomCode, e.target.value, false, 0);
                    }}
                    aria-label="Select Watch Party movie"
                    className="rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs text-[#FAFAFA]"
                  >
                    {movies.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} ({m.year})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyInvite()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#FAFAFA] hover:border-[#E5A93B] cursor-pointer"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                        <span>Invite Copied</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                        <span>Invite Friends</span>
                        <Copy className="h-3 w-3 text-[#71717A]" aria-hidden="true" />
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onLeaveRoom(partyState.roomCode)}
                    className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/10 cursor-pointer"
                  >
                    Leave
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-4 rounded-xl border border-[#27272A] bg-[#09090B] p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-[#27272A] pb-2.5">
                <span className="text-xs font-semibold text-[#FAFAFA] flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                  <span>Room Viewers ({partyState.participants.length})</span>
                </span>
                <span className="font-mono text-xs text-[#E5A93B]">{partyState.roomCode}</span>
              </div>

              <ul className="space-y-2 text-xs overflow-y-auto max-h-60">
                {partyState.participants.map((p) => (
                  <li
                    key={p.userId}
                    className="flex items-center justify-between rounded-lg border border-[#27272A]/80 bg-[#111114] px-3 py-2"
                  >
                    <span className="text-[#FAFAFA] truncate">
                      {p.username}
                      {p.userId === currentUserId ? ' (you)' : ''}
                    </span>
                    {p.userId === partyState.hostUserId && (
                      <span className="text-[10px] font-mono uppercase text-[#E5A93B]">Host</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
