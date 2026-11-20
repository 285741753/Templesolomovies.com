import { memo, useState, type FormEvent } from 'react';
import { Disc3, ExternalLink, Music2, Pause, Play, Search } from 'lucide-react';
import {
  buildBoomplaySearchUrl,
  buildSpotifySearchUrl,
  MUSIC_GENRES,
} from '../constants/musicGenres';
import { useMusicPlayer } from '../contexts/MusicPlayerContext';

export const MusicShowcaseRow = memo(function MusicShowcaseRow() {
  const {
    tracks,
    currentTrack,
    isPlaying,
    isLoadingTracks,
    trackError,
    noticeMessage,
    selectedGenre,
    spotifyStatus,
    searchTracks,
    selectGenre,
    playTrack,
    togglePlayPause,
    connectSpotify,
    setExpanded,
  } = useMusicPlayer();

  const [draftQuery, setDraftQuery] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void searchTracks(draftQuery.trim(), selectedGenre);
  };

  const spotifyDirectSearchUrl = buildSpotifySearchUrl(draftQuery, selectedGenre);
  const boomplayDirectSearchUrl = buildBoomplaySearchUrl(draftQuery, selectedGenre);

  return (
    <section
      id="music-soundtracks"
      aria-labelledby="music-soundtracks-heading"
      className="perf-section border-b border-[#27272A] bg-[#09090B]"
    >
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 space-y-5">
        {/* Header & Spotify Login */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#E5A93B] mb-1">
              <Music2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Music Genres · Spotify &amp; Boomplay Search</span>
            </div>
            <h2
              id="music-soundtracks-heading"
              className="font-display text-2xl font-bold tracking-tight text-[#FAFAFA]"
            >
              Music Previews &amp; Spotify Player
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-1">
              Pick a music genre or search any song/artist to play 30s previews, open Spotify &amp; Boomplay search, or stream full tracks with Spotify Premium.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {spotifyStatus.connected ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 cursor-pointer"
              >
                <span>
                  {spotifyStatus.isPremium
                    ? `Spotify Premium (${spotifyStatus.displayName || 'Connected'})`
                    : `Spotify Free (${spotifyStatus.displayName || '30s Previews'})`}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void connectSpotify()}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 cursor-pointer"
              >
                <span>Log in with Spotify</span>
              </button>
            )}
          </div>
        </div>

        {/* Search Input + Direct Spotify & Boomplay Search Links */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <form onSubmit={handleSubmit} className="relative flex-1 max-w-xl flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A1A1AA]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={draftQuery}
                onChange={(e) => setDraftQuery(e.target.value)}
                placeholder={
                  selectedGenre !== 'All'
                    ? `Search ${selectedGenre} songs or artists...`
                    : 'Search songs, artists, soundtracks...'
                }
                aria-label="Search music tracks"
                className="w-full rounded-xl border border-[#27272A] bg-[#111114] py-2.5 pl-10 pr-3 text-base text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="min-h-[44px] rounded-xl bg-[#E5A93B] px-4 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Search
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href={spotifyDirectSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/45 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors whitespace-nowrap"
            >
              <span>Search Spotify</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </a>
            <a
              href={boomplayDirectSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#E5A93B]/45 bg-[#E5A93B]/10 px-3.5 py-2 text-xs font-semibold text-[#E5A93B] hover:bg-[#E5A93B]/20 transition-colors whitespace-nowrap"
            >
              <span>Search Boomplay</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </a>
          </div>
        </div>

        {/* Music Genres Filter Bar */}
        <div
          role="tablist"
          aria-label="Music genres"
          className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5"
        >
          {MUSIC_GENRES.map((genre) => {
            const active = selectedGenre === genre.id;
            return (
              <button
                key={genre.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  void selectGenre(genre.id, draftQuery.trim());
                }}
                className={`min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? 'border-[#E5A93B] bg-[#E5A93B] text-[#09090B]'
                    : 'border-[#27272A] bg-[#111114] text-[#D4D4D8] hover:border-[#E5A93B]/70 hover:text-[#FAFAFA]'
                }`}
              >
                <Disc3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{genre.label}</span>
              </button>
            );
          })}
        </div>

        {noticeMessage && (
          <p className="rounded-xl border border-[#E5A93B]/35 bg-[#E5A93B]/10 px-4 py-2.5 text-xs text-[#F5C563]">
            {noticeMessage}
          </p>
        )}

        {trackError && tracks.length === 0 ? (
          <div className="rounded-xl border border-[#27272A] bg-[#111114] p-6 text-center text-xs text-[#A1A1AA]">
            {trackError}
          </div>
        ) : isLoadingTracks && tracks.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((idx) => (
              <div
                key={idx}
                className="h-24 rounded-xl border border-[#27272A] bg-[#111114] animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {tracks.slice(0, 8).map((track) => {
              const active = currentTrack?.id === track.id;
              const playingThis = active && isPlaying;
              return (
                <article
                  key={track.id}
                  className={`flex flex-col justify-between gap-3 rounded-xl border p-3.5 transition-colors ${
                    active
                      ? 'border-[#E5A93B] bg-[#14120D]'
                      : 'border-[#27272A] bg-[#111114] hover:border-[#3F3F46]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {track.artworkUrl ? (
                      <img
                        src={track.artworkUrl}
                        alt={`${track.title} artwork`}
                        loading="lazy"
                        decoding="async"
                        className="h-14 w-14 rounded-lg border border-[#27272A] object-cover shrink-0"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-[#27272A] bg-[#18181B] shrink-0">
                        <Music2 className="h-5 w-5 text-[#E5A93B]" aria-hidden="true" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-sm font-semibold text-[#FAFAFA] truncate">
                        {track.title}
                      </h3>
                      <p className="text-xs text-[#A1A1AA] truncate">{track.artist}</p>
                      <p className="text-[11px] font-mono text-[#71717A] truncate mt-0.5">
                        {track.genre ? `${track.genre} · ` : ''}
                        {spotifyStatus.isPremium && track.spotifyUri
                          ? 'Full Song'
                          : track.previewUrl
                            ? '30s Preview'
                            : 'External'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#27272A]/80">
                    <button
                      type="button"
                      onClick={() => {
                        if (active) {
                          void togglePlayPause();
                        } else {
                          void playTrack(track, tracks);
                        }
                      }}
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#E5A93B] px-3.5 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] whitespace-nowrap cursor-pointer"
                    >
                      {playingThis ? (
                        <>
                          <Pause className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                          <span>{track.spotifyUri && spotifyStatus.isPremium ? 'Play' : '30s Preview'}</span>
                        </>
                      )}
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={track.spotifyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in Spotify"
                        className="min-h-[40px] inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
                      >
                        <span>Spotify</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                      <a
                        href={track.boomplayUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in Boomplay"
                        className="min-h-[40px] inline-flex items-center gap-1 rounded-lg border border-[#E5A93B]/40 bg-[#E5A93B]/10 px-2.5 py-1.5 text-[11px] font-medium text-[#E5A93B] hover:bg-[#E5A93B]/20"
                      >
                        <span>Boomplay</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
});
