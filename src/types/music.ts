export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  previewUrl: string | null;
  previewDurationSec: number;
  fullDurationSec: number;
  spotifyUrl: string;
  spotifyUri?: string;
  boomplayUrl: string;
  genre?: string;
  source: 'spotify' | 'itunes-preview';
}

export interface SpotifySessionStatus {
  configured: boolean;
  connected: boolean;
  isPremium: boolean;
  product: 'premium' | 'free' | 'open' | 'unknown';
  displayName?: string;
  avatarUrl?: string;
  callbackUrl: string;
}
