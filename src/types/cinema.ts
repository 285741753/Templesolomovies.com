export type MovieGenre =
  | 'Thriller'
  | 'Sci-Fi'
  | 'Drama'
  | 'Action'
  | 'Mystery'
  | 'Comedy'
  | 'Documentary'
  | 'Animation'
  | 'Horror';

export type MovieQuality = '4K UHD' | '1080p HD' | '720p HD';

export interface Movie {
  id: string;
  title: string;
  genre: MovieGenre;
  year: number;
  duration: string;
  quality: MovieQuality;
  director: string;
  uploader: string;
  synopsis: string;
  posterUrl: string;
  backdropUrl?: string;
  videoUrl: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  downloads: number;
  featured: boolean;
  isSeeded?: boolean;
  ownerUid?: string;
  createdAt: string;
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
  subscriberCount: number;
  createdAt: string;
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
}

export interface OnlineUser {
  userId: string;
  username: string;
  room: ChatRoomId;
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
      type: 'presence:update';
      onlineUsers: OnlineUser[];
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
    };
