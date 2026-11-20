import { memo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  LogOut,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import { useMusicPlayer, useMusicProgress } from '../contexts/MusicPlayerContext';

function formatClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const MusicPlayerBar = memo(function MusicPlayerBar() {
  const {
    tracks,
    currentTrack,
    isPlaying,
    noticeMessage,
    playbackMode,
    isExpanded,
    isMiniDismissed,
    spotifyStatus,
    playTrack,
    togglePlayPause,
    nextTrack,
    prevTrack,
    seekTo,
    setExpanded,
    dismissMiniPlayer,
    connectSpotify,
    disconnectSpotify,
  } = useMusicPlayer();
  const { currentTimeSec, durationSec } = useMusicProgress();

  if (!currentTrack || isMiniDismissed) {
    return null;
  }

  const progressPct =
    durationSec > 0 ? Math.min(100, Math.max(0, (currentTimeSec / durationSec) * 100)) : 0;

  return (
    <>
      {/* Fixed Mini Player above mobile BottomNavBar with env(safe-area-inset-bottom) */}
      <aside
        aria-label="Music Mini Player"
        className="fixed left-2 right-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] lg:left-auto lg:right-5 lg:bottom-5 lg:w-[410px] z-30 rounded-2xl border border-[#E5A93B]/45 bg-[#09090B]/98 lg:backdrop-blur-md shadow-2xl overflow-hidden touch-manipulation"
      >
        {/* Top Progress Line */}
        <div className="h-1 w-full bg-[#27272A]">
          <div
            className="h-full bg-[#E5A93B] transition-[width] duration-200"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2">
          {/* Expandable Track Info Trigger */}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={`Expand full player for ${currentTrack.title}`}
            className="flex min-h-[44px] flex-1 items-center gap-2.5 min-w-0 text-left touch-manipulation cursor-pointer"
          >
            {currentTrack.artworkUrl ? (
              <img
                src={currentTrack.artworkUrl}
                alt={`${currentTrack.title} cover`}
                className="h-10 w-10 rounded-lg border border-[#27272A] object-cover shrink-0"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#27272A] bg-[#18181B] shrink-0">
                <Music2 className="h-4 w-4 text-[#E5A93B]" aria-hidden="true" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#FAFAFA] truncate">
                {currentTrack.title}
              </p>
              <p className="text-[11px] text-[#A1A1AA] truncate">
                {currentTrack.artist} ·{' '}
                <span className="text-[#E5A93B]">
                  {playbackMode === 'spotify-sdk' ? 'Spotify Full' : '30s Preview'}
                </span>
              </p>
            </div>
          </button>

          {/* Mini Player Transport Controls */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void togglePlayPause()}
              aria-label={isPlaying ? 'Pause music' : 'Play music'}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#E5A93B] text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.96] transition-all touch-manipulation cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4 fill-current ml-0.5" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => void nextTrack()}
              aria-label="Next track"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[#27272A] bg-[#111114] text-[#FAFAFA] hover:border-[#E5A93B] hover:text-[#E5A93B] touch-manipulation cursor-pointer"
            >
              <SkipForward className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label="Open full music player"
              className="min-h-[44px] min-w-[36px] flex items-center justify-center rounded-xl text-[#A1A1AA] hover:text-[#FAFAFA] touch-manipulation cursor-pointer"
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={dismissMiniPlayer}
              aria-label="Close music mini player"
              className="min-h-[44px] min-w-[36px] flex items-center justify-center rounded-xl text-[#71717A] hover:text-[#FAFAFA] touch-manipulation cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {/* Expandable Full Music Player Sheet */}
      {isExpanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Full Music Player"
          className="fixed inset-0 z-[65] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-0 sm:p-4 touch-manipulation"
          onClick={() => setExpanded(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-[#E5A93B]/45 bg-[#09090B] px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6 shadow-2xl space-y-5"
          >
            {/* Header Bar */}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="Collapse full player"
                className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-xl text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
              >
                <ChevronDown className="h-5 w-5" aria-hidden="true" />
              </button>

              <div className="text-center min-w-0">
                <p className="text-[11px] font-mono uppercase tracking-wider text-[#E5A93B]">
                  {playbackMode === 'spotify-sdk'
                    ? 'Spotify Premium · Full Song'
                    : '30-Second Legal Preview · HTML5 Audio'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="Close full player"
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {noticeMessage && (
              <p className="rounded-xl border border-[#E5A93B]/40 bg-[#E5A93B]/10 px-3.5 py-2 text-xs text-[#F5C563]">
                {noticeMessage}
              </p>
            )}

            {/* Cover Art & Track Metadata */}
            <div className="flex flex-col items-center text-center space-y-3">
              {currentTrack.artworkUrl ? (
                <img
                  src={currentTrack.artworkUrl}
                  alt={`${currentTrack.title} album art`}
                  className="h-44 w-44 sm:h-52 sm:w-52 rounded-2xl border border-[#E5A93B]/40 object-cover shadow-2xl"
                />
              ) : (
                <div className="flex h-44 w-44 items-center justify-center rounded-2xl border border-[#27272A] bg-[#18181B]">
                  <Music2 className="h-12 w-12 text-[#E5A93B]" aria-hidden="true" />
                </div>
              )}

              <div className="min-w-0 max-w-full px-2">
                <h2 className="font-display text-lg sm:text-xl font-bold text-[#FAFAFA] truncate">
                  {currentTrack.title}
                </h2>
                <p className="text-sm text-[#A1A1AA] truncate">
                  {currentTrack.artist} · {currentTrack.album}
                </p>
              </div>
            </div>

            {/* Progress Scrubber */}
            <div className="space-y-1.5">
              <input
                type="range"
                min={0}
                max={Math.max(1, durationSec)}
                value={Math.min(currentTimeSec, durationSec)}
                onChange={(e) => void seekTo(Number(e.target.value))}
                aria-label="Track playback position"
                className="w-full accent-[#E5A93B] cursor-pointer h-2"
              />
              <div className="flex items-center justify-between font-mono text-xs tabular-nums text-[#A1A1AA]">
                <span>{formatClock(currentTimeSec)}</span>
                <span>
                  {formatClock(durationSec)}
                  {playbackMode === 'preview' ? ' preview' : ''}
                </span>
              </div>
            </div>

            {/* Transport Controls */}
            <div className="flex items-center justify-center gap-5">
              <button
                type="button"
                onClick={() => void prevTrack()}
                aria-label="Previous track"
                className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full border border-[#27272A] bg-[#111114] text-[#FAFAFA] hover:border-[#E5A93B] cursor-pointer"
              >
                <SkipBack className="h-5 w-5" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => void togglePlayPause()}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="h-14 w-14 flex items-center justify-center rounded-full bg-[#E5A93B] text-[#09090B] hover:bg-[#F0B84F] shadow-lg active:scale-[0.96] transition-all cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="h-6 w-6 fill-current" aria-hidden="true" />
                ) : (
                  <Play className="h-6 w-6 fill-current ml-0.5" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={() => void nextTrack()}
                aria-label="Next track"
                className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full border border-[#27272A] bg-[#111114] text-[#FAFAFA] hover:border-[#E5A93B] cursor-pointer"
              >
                <SkipForward className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {/* Open Full Track in Spotify / Boomplay */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <a
                href={currentTrack.spotifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Open in Spotify</span>
              </a>

              <a
                href={currentTrack.boomplayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-[#E5A93B]/45 bg-[#E5A93B]/10 px-4 py-2.5 text-xs font-semibold text-[#E5A93B] hover:bg-[#E5A93B]/20 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Open in Boomplay</span>
              </a>
            </div>

            {/* Spotify Premium Web Playback SDK Account Box */}
            <div className="rounded-xl border border-[#27272A] bg-[#111114] p-3.5 space-y-2">
              {spotifyStatus.connected ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#FAFAFA] truncate">
                      {spotifyStatus.displayName || 'Spotify User'}
                    </p>
                    <p className="text-[11px] text-[#A1A1AA]">
                      {spotifyStatus.isPremium
                        ? 'Spotify Premium · Full-track Web Playback SDK enabled'
                        : 'Non-Premium account · 30s previews + Open in Spotify / Boomplay'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void disconnectSpotify()}
                    className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] px-3 py-1.5 text-xs text-[#D4D4D8] hover:border-red-400 hover:text-red-300 cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Log out</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#FAFAFA]">
                      Spotify Premium Full Songs
                    </p>
                    <p className="text-[11px] text-[#A1A1AA]">
                      Log in with Spotify Premium for full streams via Web Playback SDK. Free users listen via legal 30s previews.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void connectSpotify()}
                    className="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-[#09090B] hover:bg-emerald-400 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Log in with Spotify
                  </button>
                </div>
              )}
            </div>

            {/* Up Next Queue */}
            {tracks.length > 1 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#A1A1AA]">Up Next ({tracks.length})</p>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {tracks.map((item) => {
                    const active = item.id === currentTrack.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void playTrack(item)}
                        className={`flex w-full items-center justify-between gap-2.5 rounded-xl border p-2 text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-[#E5A93B] bg-[#E5A93B]/10'
                            : 'border-[#27272A] bg-[#111114] hover:border-[#3F3F46]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {item.artworkUrl && (
                            <img
                              src={item.artworkUrl}
                              alt=""
                              className="h-9 w-9 rounded object-cover shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <p
                              className={`text-xs font-semibold truncate ${
                                active ? 'text-[#E5A93B]' : 'text-[#FAFAFA]'
                              }`}
                            >
                              {item.title}
                            </p>
                            <p className="text-[11px] text-[#71717A] truncate">{item.artist}</p>
                          </div>
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-[#A1A1AA] shrink-0">
                          {active && isPlaying ? 'Playing' : '0:30'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
});
