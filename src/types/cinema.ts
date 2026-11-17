export const WHATSAPP_CHANNEL_URL =
  'https://whatsapp.com/channel/0029VbD1VkL9sBI2TwMNmg3I';

export type MovieGenre =
  | 'Action'
  | 'Nollywood'
  | 'Sci-Fi'
  | 'Music'
  | 'Thriller'
  | 'Drama'
  | 'Mystery'
  | 'Comedy'
  | 'Documentary'
  | 'Animation'
  | 'Horror';

export type HomeCategoryChip =
  | 'All'
  | 'Movies'
  | 'Series'
  | 'Music'
  | 'Anime'
  | 'Nollywood'
  | 'K-Drama';

export type MovieQuality = '4K UHD' | '1080p HD' | '720p HD';

export interface SeriesEpisode {
  id: string;
  season: number;
  episode: number;
  title: string;
  duration: string;
  videoUrl: string;
  synopsis?: string;
}

export interface MovieMetadata {
  title: string;
  genre: MovieGenre;
  category?: Exclude<HomeCategoryChip, 'All'>;
  country?: string;
  year: number;
  duration: string;
  quality: MovieQuality;
  director: string;
  synopsis: string;
  imdbRating?: number;
  posterUrl: string;
  backdropUrl?: string;
  trailerUrl?: string;
  videoUrl: string;
  ageRating?: string;
}

export interface Movie extends MovieMetadata {
  id: string;
  uploader: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  downloads: number;
  featured: boolean;
  isSeeded?: boolean;
  ownerUid?: string;
  createdAt: string;
  cloudinaryPublicId?: string;
  posterPublicId?: string;
  videoPublicId?: string;
  cloudinaryUploaded?: boolean;
  episodes?: SeriesEpisode[];
  audioLanguages?: string[];
  subtitleLanguages?: string[];
}

export interface UpcomingMovie {
  id: string;
  title: string;
  genre: MovieGenre;
  releaseDate: string; // YYYY-MM-DD
  duration: string;
  quality: MovieQuality;
  director: string;
  synopsis: string;
  posterUrl: string;
  trailerUrl?: string;
  subscriberCount: number;
  createdAt: string;
}

export interface MovieReview {
  reviewId: string;
  movieId: string;
  userId: string;
  authorName: string;
  rating: number;
  headline: string;
  body: string;
  containsSpoilers: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface WatchProgressEntry {
  movieId: string;
  userId: string;
  progressSeconds: number;
  durationSeconds: number;
  updatedAtMs: number;
}

export type VideoQualitySetting = 'auto' | '360p' | '480p' | '720p' | '1080p';
export type DownloadQualitySetting = '360p' | '480p' | '720p' | '1080p';
export type DownloadQualityTier = '360p' | '720p' | '1080p' | '4K';

export interface DownloadTask {
  id: string;
  movieId: string;
  title: string;
  posterUrl: string;
  fileName: string;
  quality: DownloadQualityTier;
  status: 'downloading' | 'paused' | 'completed' | 'error';
  receivedBytes: number;
  totalBytes: number;
  speedBps: number;
  errorMessage?: string;
  sourceUrl?: string;
  offlineAvailable: boolean;
  updatedAt: number;
}

export interface MovieRequestItem {
  id: string;
  title: string;
  year?: number;
  country?: string;
  notes?: string;
  requestedBy: string;
  upvotes: number;
  status: 'pending' | 'added';
  createdAt: string;
}

export interface BrokenLinkReport {
  id: string;
  movieId: string;
  movieTitle: string;
  reason: string;
  details?: string;
  reportedBy: string;
  status: 'open' | 'resolved';
  createdAt: string;
}

export interface AppSettings {
  videoQuality: VideoQualitySetting;
  downloadQuality: DownloadQualitySetting;
  downloadWifiOnly: boolean;
  notificationsEnabled: boolean;
}

export type ChatRoomId = 'general' | 'requests' | 'drops';

export interface MovieChatReference {
  id: string;
  title: string;
  genre: string;
  year: number;
  quality: string;
  posterUrl: string;
}

export interface ChatMessage {
  id: string;
  room: ChatRoomId;
  userId: string;
  username: string;
  text: string;
  timestamp: string;
  isSystem?: boolean;
  movieRef?: MovieChatReference;
  likedBy?: string[];
}

export interface OnlineUser {
  userId: string;
  username: string;
  room: ChatRoomId;
}

export interface WatchPartyParticipant {
  userId: string;
  username: string;
}

export interface WatchPartyState {
  roomCode: string;
  movieId: string;
  isPlaying: boolean;
  currentTime: number;
  updatedAt: number;
  hostUserId: string;
  hostName: string;
  participants: WatchPartyParticipant[];
}

export type ServerWsEvent =
  | {
      type: 'ws:init';
      movies: Movie[];
      messages: ChatMessage[];
      onlineUsers: OnlineUser[];
    }
  | {
      type: 'movie:created';
      movie: Movie;
    }
  | {
      type: 'movie:deleted';
      movieId: string;
    }
  | {
      type: 'movie:download_updated';
      movieId: string;
      downloads: number;
    }
  | {
      type: 'upcoming:created';
      upcoming: UpcomingMovie;
    }
  | {
      type: 'upcoming:deleted';
      releaseId: string;
    }
  | {
      type: 'upcoming:subscriber_updated';
      releaseId: string;
      subscriberCount: number;
    }
  | {
      type: 'chat:message';
      message: ChatMessage;
    }
  | {
      type: 'chat:like_updated';
      messageId: string;
      likedBy: string[];
    }
  | {
      type: 'presence:update';
      onlineUsers: OnlineUser[];
    }
  | {
      type: 'party:state';
      party: WatchPartyState;
    }
  | {
      type: 'party:error';
      message: string;
    };

export type ClientWsEvent =
  | {
      type: 'user:join';
      userId: string;
      username: string;
      room: ChatRoomId;
    }
  | {
      type: 'user:rename';
      username: string;
    }
  | {
      type: 'room:switch';
      room: ChatRoomId;
    }
  | {
      type: 'chat:send';
      id: string;
      room: ChatRoomId;
      userId: string;
      username: string;
      text: string;
      movieRef?: MovieChatReference;
    }
  | {
      type: 'chat:like';
      messageId: string;
      userId: string;
    }
  | {
      type: 'party:join';
      roomCode: string;
      movieId?: string;
      userId: string;
      username: string;
    }
  | {
      type: 'party:leave';
      roomCode: string;
      userId: string;
    }
  | {
      type: 'party:sync';
      roomCode: string;
      movieId: string;
      isPlaying: boolean;
      currentTime: number;
      userId: string;
    };
