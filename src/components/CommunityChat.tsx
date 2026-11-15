import { useEffect, useRef, useState } from 'react';
import { Send, Users, Edit2, Check, Film, Download, X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import type {
  ChatMessage,
  ChatRoomId,
  Movie,
  MovieChatReference,
  OnlineUser,
} from '../types/cinema';
import { formatTime } from '../utils/format';

interface CommunityChatProps {
  messages: ChatMessage[];
  onlineUsers: OnlineUser[];
  isConnected: boolean;
  username: string;
  userId: string;
  activeRoom: ChatRoomId;
  pendingMovieRef: MovieChatReference | null;
  movies: Movie[];
  onSwitchRoom: (room: ChatRoomId) => void;
  onRenameUser: (nextName: string) => void;
  onSendMessage: (text: string, movieRef?: MovieChatReference) => void;
  onClearPendingMovie: () => void;
  onOpenMovieById: (movieId: string) => void;
  onDownloadMovieById: (movieId: string) => void;
}

export function CommunityChat({
  messages,
  onlineUsers,
  isConnected,
  username,
  userId,
  activeRoom,
  pendingMovieRef,
  movies,
  onSwitchRoom,
  onRenameUser,
  onSendMessage,
  onClearPendingMovie,
  onOpenMovieById,
  onDownloadMovieById,
}: CommunityChatProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(username);
  const [showUsers, setShowUsers] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const localizedRooms: { id: ChatRoomId; label: string; description: string }[] = [
    { id: 'general', label: t('roomGeneralLabel'), description: t('roomGeneralDesc') },
    { id: 'requests', label: t('roomRequestsLabel'), description: t('roomRequestsDesc') },
    { id: 'drops', label: t('roomDropsLabel'), description: t('roomDropsDesc') },
  ];

  const roomMessages = messages.filter((m) => m.room === activeRoom);
  const activeRoomMeta = localizedRooms.find((r) => r.id === activeRoom) || localizedRooms[0];

  useEffect(() => {
    setNameInput(username);
  }, [username]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [roomMessages.length, activeRoom]);

  const handleSaveName = () => {
    const trimmed = nameInput.trim().slice(0, 32);
    if (trimmed) {
      onRenameUser(trimmed);
    } else {
      setNameInput(username);
    }
    setEditingName(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed && !pendingMovieRef) return;
    onSendMessage(trimmed, pendingMovieRef || undefined);
    setDraft('');
    if (pendingMovieRef) {
      onClearPendingMovie();
    }
  };

  return (
    <aside
      id="community-chat"
      aria-label="Community Chat"
      className="flex flex-col rounded-xl border border-[#27272A] bg-[#111114] overflow-hidden h-[620px] lg:h-[calc(100vh-110px)] lg:sticky lg:top-[76px]"
    >
      {/* Chat Header */}
      <div className="border-b border-[#27272A] px-4 py-3.5 bg-[#111114]">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-[#FAFAFA] truncate">
              {t('chatTitle')}
            </h2>
            <p className="text-xs text-[#71717A] truncate">
              {activeRoomMeta.description}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-mono tabular-nums ${
                isConnected ? 'text-emerald-400' : 'text-amber-400'
              }`}
              title={isConnected ? 'WebSocket connected' : 'Reconnecting to chat server'}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isConnected ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
                aria-hidden="true"
              />
              <span>{isConnected ? t('chatLive') : t('chatSyncing')}</span>
            </span>

            <button
              type="button"
              onClick={() => setShowUsers((prev) => !prev)}
              aria-expanded={showUsers}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#27272A] bg-[#18181B] px-2.5 py-1 text-xs font-mono tabular-nums text-[#D4D4D8] hover:text-[#FAFAFA] cursor-pointer"
            >
              <Users className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
              <span>{onlineUsers.length}</span>
            </button>
          </div>
        </div>

        {/* Channel Switcher */}
        <div className="flex items-center gap-1 rounded-lg bg-[#09090B] p-1 border border-[#27272A]/80">
          {localizedRooms.map((room) => {
            const active = room.id === activeRoom;
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => onSwitchRoom(room.id)}
                className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#18181B] text-[#FAFAFA] shadow-sm'
                    : 'text-[#71717A] hover:text-[#D4D4D8]'
                }`}
              >
                # {room.label}
              </button>
            );
          })}
        </div>

        {/* Display Name Bar */}
        <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
          {editingName ? (
            <div className="flex flex-1 items-center gap-1.5">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') {
                    setNameInput(username);
                    setEditingName(false);
                  }
                }}
                maxLength={32}
                aria-label="Your chat display name"
                autoFocus
                className="flex-1 rounded-md border border-[#E5A93B] bg-[#09090B] px-2 py-1 text-xs text-[#FAFAFA] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveName}
                aria-label="Save display name"
                className="rounded-md bg-[#E5A93B] p-1 text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[#A1A1AA]">
              <span>{t('chattingAs')}</span>
              <span className="font-medium text-[#FAFAFA]">{username}</span>
              <button
                type="button"
                onClick={() => setEditingName(true)}
                aria-label="Change display name"
                className="inline-flex items-center gap-1 text-[#71717A] hover:text-[#E5A93B] transition-colors cursor-pointer ml-1"
              >
                <Edit2 className="h-3 w-3" aria-hidden="true" />
                <span>{t('edit')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Expandable Online Users Drawer */}
        {showUsers && (
          <div className="mt-2.5 rounded-lg border border-[#27272A] bg-[#09090B] p-2.5 max-h-28 overflow-y-auto">
            <p className="text-[11px] font-medium text-[#71717A] mb-1.5">
              {t('activeMembers')} ({onlineUsers.length})
            </p>
            {onlineUsers.length === 0 ? (
              <p className="text-xs text-[#71717A]">{t('connecting')}</p>
            ) : (
              <ul className="space-y-1">
                {onlineUsers.map((u) => (
                  <li
                    key={u.userId}
                    className="flex items-center justify-between text-xs text-[#D4D4D8]"
                  >
                    <span className="truncate">
                      {u.username}
                      {u.userId === userId ? ' (you)' : ''}
                    </span>
                    <span className="font-mono text-[11px] text-[#71717A]">
                      #{u.room}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Messages Feed */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
        {roomMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center px-4">
            <p className="text-sm font-medium text-[#D4D4D8] mb-1">
              {t('noMessagesInRoom', { room: activeRoomMeta.label })}
            </p>
            <p className="text-xs text-[#71717A]">
              {t('startConversation')}
            </p>
          </div>
        ) : (
          roomMessages.map((msg) => {
            const isOwn = msg.userId === userId;
            const movieExists = msg.movieRef
              ? movies.some((m) => m.id === msg.movieRef?.id)
              : false;

            return (
              <div key={msg.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      msg.isSystem
                        ? 'text-[#E5A93B]'
                        : isOwn
                        ? 'text-[#FAFAFA]'
                        : 'text-[#D4D4D8]'
                    }`}
                  >
                    {msg.username}
                    {isOwn && !msg.isSystem ? ' (you)' : ''}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-[#71717A] shrink-0">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>

                <p className="text-sm text-[#D4D4D8] leading-relaxed break-words">
                  {msg.text}
                </p>

                {msg.movieRef && (
                  <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-[#27272A] bg-[#09090B] p-2">
                    <div className="h-12 w-9 shrink-0 overflow-hidden rounded bg-[#18181B]">
                      {msg.movieRef.posterUrl ? (
                        <img
                          src={msg.movieRef.posterUrl}
                          alt={msg.movieRef.title}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Film className="h-4 w-4 text-[#71717A]" aria-hidden="true" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#FAFAFA] truncate">
                        {msg.movieRef.title}
                      </p>
                      <p className="text-[11px] text-[#71717A] font-mono tabular-nums truncate">
                        {msg.movieRef.genre} · {msg.movieRef.year} · {msg.movieRef.quality}
                      </p>
                    </div>

                    {movieExists && (
                      <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => onOpenMovieById(msg.movieRef!.id)}
                            className="rounded px-2 py-1 text-[11px] font-medium text-[#D4D4D8] hover:bg-[#18181B] hover:text-[#FAFAFA] cursor-pointer"
                          >
                            {t('view')}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDownloadMovieById(msg.movieRef!.id)}
                            aria-label={`Download ${msg.movieRef.title}`}
                            className="rounded bg-[#E5A93B] p-1.5 text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
                          >
                            <Download className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Message Composer */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-[#27272A] bg-[#09090B] p-3"
        >
          {pendingMovieRef && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-[#27272A] bg-[#18181B] px-2.5 py-1.5 text-xs">
              <span className="truncate text-[#D4D4D8]">
                Sharing <strong className="text-[#FAFAFA]">{pendingMovieRef.title}</strong>
              </span>
              <button
                type="button"
                onClick={onClearPendingMovie}
                aria-label="Remove attached movie"
                className="text-[#71717A] hover:text-[#FAFAFA] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('messageRoomPlaceholder', { room: activeRoomMeta.label })}
              aria-label={t('messageRoomPlaceholder', { room: activeRoomMeta.label })}
            maxLength={1000}
            className="flex-1 rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() && !pendingMovieRef}
            aria-label="Send message"
            className="inline-flex items-center justify-center rounded-lg bg-[#E5A93B] p-2.5 text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </aside>
  );
}
