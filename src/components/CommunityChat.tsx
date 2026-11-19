import { useEffect, useRef, useState } from 'react';
import {
  Send,
  Users,
  Edit2,
  Check,
  Film,
  Download,
  X,
  Heart,
  MessageCircle,
  ExternalLink,
  SmilePlus,
  Smile,
  ArrowDown,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  WHATSAPP_CHANNEL_URL,
  type ChatMessage,
  type ChatRoomId,
  type Movie,
  type MovieChatReference,
  type OnlineUser,
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
  onToggleLikeMessage: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onClearPendingMovie: () => void;
  onOpenMovieById: (movieId: string) => void;
  onDownloadMovieById: (movieId: string) => void;
}

type EmojiCategoryId = 'recent' | 'faces' | 'cinema' | 'sports' | 'hearts';

const QUICK_REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '🎬', '👏', '⚽'];

const EMOJI_CATEGORIES: { id: EmojiCategoryId; label: string; emojis: string[] }[] = [
  {
    id: 'faces',
    label: 'Faces',
    emojis: [
      '😀', '😂', '🤣', '😍', '🤩', '😎', '🥳', '😭',
      '😮', '🤯', '🤔', '😏', '🙌', '👏', '👍', '👎',
      '🙏', '💯', '🔥', '⚡', '✨', '👀', '🫡', '🫶',
    ],
  },
  {
    id: 'cinema',
    label: 'Cinema',
    emojis: [
      '🎬', '🍿', '🎥', '🎞️', '📽️', '🎭', '🎟️', '📺',
      '🎧', '🎵', '🎶', '🎤', '🌟', '⭐', '🏆', '👑',
      '💥', '🚀', '👽', '🕵️', '🗡️', '👻', '🐉', '🌙',
    ],
  },
  {
    id: 'sports',
    label: 'Sports',
    emojis: [
      '⚽', '🥅', '🏟️', '🥇', '🏆', '♟️', '🎮', '🕹️',
      '🎯', '💪', '🏃', '🔥', '📣', '🎉', '🎊', '🥳',
    ],
  },
  {
    id: 'hearts',
    label: 'Symbols',
    emojis: [
      '❤️', '💛', '🖤', '🧡', '💚', '💙', '💜', '🤍',
      '💖', '💔', '✅', '❌', '❓', '❗', '💬', '📌',
    ],
  },
];

const RECENT_EMOJIS_KEY = 'tsm_chat_recent_emojis_v1';

function loadRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_EMOJIS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (valid.length > 0) return valid.slice(0, 16);
    }
  } catch {
    // Ignore storage access failures
  }
  return QUICK_REACTION_EMOJIS;
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
  onToggleLikeMessage,
  onToggleReaction,
  onClearPendingMovie,
  onOpenMovieById,
  onDownloadMovieById,
}: CommunityChatProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(username);
  const [showUsers, setShowUsers] = useState(false);

  const [isComposerEmojiOpen, setIsComposerEmojiOpen] = useState(false);
  const [activeEmojiTab, setActiveEmojiTab] = useState<EmojiCategoryId>('faces');
  const [recentEmojis, setRecentEmojis] = useState<string[]>(loadRecentEmojis);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [expandedReactionMsgId, setExpandedReactionMsgId] = useState<string | null>(null);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composerPickerRef = useRef<HTMLFormElement | null>(null);
  const isNearBottomRef = useRef(true);
  const prevRoomRef = useRef<ChatRoomId>(activeRoom);
  const prevLatestMsgIdRef = useRef<string | undefined>(undefined);

  const localizedRooms: { id: ChatRoomId; label: string; description: string }[] = [
    { id: 'general', label: t('roomGeneralLabel'), description: t('roomGeneralDesc') },
    { id: 'requests', label: t('roomRequestsLabel'), description: t('roomRequestsDesc') },
    { id: 'drops', label: t('roomDropsLabel'), description: t('roomDropsDesc') },
  ];

  const roomMessages = messages.filter((m) => m.room === activeRoom);
  const latestMessage = roomMessages[roomMessages.length - 1];
  const latestMessageId = latestMessage?.id;
  const activeRoomMeta = localizedRooms.find((r) => r.id === activeRoom) || localizedRooms[0];

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const container = listRef.current;
    if (!container) return;
    window.requestAnimationFrame(() => {
      if (!listRef.current) return;
      if (typeof listRef.current.scrollTo === 'function') {
        listRef.current.scrollTo({
          top: listRef.current.scrollHeight,
          behavior,
        });
      } else {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
      isNearBottomRef.current = true;
      setHasUnreadBelow(false);
    });
  };

  const handleFeedScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= 96;
    isNearBottomRef.current = nearBottom;
    if (nearBottom && hasUnreadBelow) {
      setHasUnreadBelow(false);
    }
  };

  useEffect(() => {
    setNameInput(username);
  }, [username]);

  useEffect(() => {
    const roomChanged = prevRoomRef.current !== activeRoom;
    const msgChanged = prevLatestMsgIdRef.current !== latestMessageId;
    const isInitialRoomLoad = prevLatestMsgIdRef.current === undefined && roomMessages.length > 0;

    prevRoomRef.current = activeRoom;
    prevLatestMsgIdRef.current = latestMessageId;

    if (roomChanged || isInitialRoomLoad) {
      isNearBottomRef.current = true;
      scrollToBottom('auto');
      return;
    }

    if (msgChanged && latestMessage) {
      if (latestMessage.userId === userId || isNearBottomRef.current) {
        scrollToBottom('smooth');
      } else {
        setHasUnreadBelow(true);
      }
    }
  }, [activeRoom, latestMessageId, latestMessage, roomMessages.length, userId]);

  // Dismiss emoji pickers on outside click or Escape key
  useEffect(() => {
    if (!isComposerEmojiOpen && !reactionPickerMsgId) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        composerPickerRef.current &&
        composerPickerRef.current.contains(target)
      ) {
        return;
      }
      if (target.closest('[data-reaction-picker-root="true"]')) {
        return;
      }
      setIsComposerEmojiOpen(false);
      setReactionPickerMsgId(null);
      setExpandedReactionMsgId(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsComposerEmojiOpen(false);
        setReactionPickerMsgId(null);
        setExpandedReactionMsgId(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isComposerEmojiOpen, reactionPickerMsgId]);

  const recordRecentEmoji = (emoji: string) => {
    setRecentEmojis((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 16);
      try {
        localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const handleInsertComposerEmoji = (emoji: string) => {
    recordRecentEmoji(emoji);
    const el = inputRef.current;
    if (!el) {
      setDraft((prev) => `${prev}${emoji}`);
      return;
    }

    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const nextValue = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`.slice(0, 1000);
    setDraft(nextValue);

    const nextCursor = Math.min(start + emoji.length, nextValue.length);
    window.requestAnimationFrame(() => {
      el.focus();
      try {
        el.setSelectionRange(nextCursor, nextCursor);
      } catch {
        // Ignore selection errors on unsupported inputs
      }
    });
  };

  const handlePickMessageReaction = (messageId: string, emoji: string) => {
    recordRecentEmoji(emoji);
    onToggleReaction(messageId, emoji);
    setReactionPickerMsgId(null);
    setExpandedReactionMsgId(null);
  };

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
    isNearBottomRef.current = true;
    onSendMessage(trimmed, pendingMovieRef || undefined);
    setDraft('');
    setIsComposerEmojiOpen(false);
    if (pendingMovieRef) {
      onClearPendingMovie();
    }
    scrollToBottom('smooth');
  };

  const activeCategoryEmojis =
    activeEmojiTab === 'recent'
      ? recentEmojis
      : EMOJI_CATEGORIES.find((c) => c.id === activeEmojiTab)?.emojis ?? EMOJI_CATEGORIES[0].emojis;

  return (
    <aside
      id="community-chat"
      aria-label="Community Chat"
      className="flex w-full max-w-full min-w-0 flex-col rounded-xl border border-[#27272A] bg-[#111114] overflow-hidden h-[620px] lg:h-[calc(100vh-110px)] lg:sticky lg:top-[76px]"
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
              title={
                isConnected
                  ? 'WebSocket live chat connected'
                  : 'Using HTTP fallback sync while WebSocket reconnects'
              }
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
              className="min-h-[36px] inline-flex items-center gap-1.5 rounded-md border border-[#27272A] bg-[#18181B] px-2.5 py-1 text-xs font-mono tabular-nums text-[#D4D4D8] hover:text-[#FAFAFA] cursor-pointer"
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
                className={`min-h-[40px] flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
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
                className="flex-1 min-w-0 rounded-md border border-[#E5A93B] bg-[#09090B] px-2 py-1 text-base text-[#FAFAFA] focus:outline-none"
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

        {/* Official WhatsApp Channel Link */}
        <a
          href={WHATSAPP_CHANNEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/25 px-3 py-2 text-xs transition-colors hover:border-emerald-400/50 hover:bg-emerald-950/40"
        >
          <span className="flex items-center gap-2 min-w-0">
            <MessageCircle className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
            <span className="truncate font-medium text-emerald-200">
              {t('joinWhatsappChannel')}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400 shrink-0">
            <span>{t('whatsappChannel')}</span>
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </span>
        </a>

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
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={listRef}
          onScroll={handleFeedScroll}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5"
        >
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
            const likedBy = Array.isArray(msg.likedBy) ? msg.likedBy : [];
            const likeCount = likedBy.length;
            const hasLiked = likedBy.includes(userId);
            const reactionEntries = Object.entries(msg.reactions || {}).filter(
              ([, users]) => Array.isArray(users) && users.length > 0
            );
            const isReactionOpen = reactionPickerMsgId === msg.id;
            const isReactionExpanded = expandedReactionMsgId === msg.id;

            return (
              <div key={msg.id} className="space-y-1.5">
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

                {/* Like + Emoji Reactions Bar */}
                <div
                  className="relative pt-0.5 flex flex-wrap items-center gap-1.5"
                  data-reaction-picker-root="true"
                >
                  {!isOwn ? (
                    <button
                      type="button"
                      onClick={() => onToggleLikeMessage(msg.id)}
                      aria-pressed={hasLiked}
                      aria-label={`${hasLiked ? t('likedMessage') : t('likeMessage')} — ${msg.username}${likeCount > 0 ? ` (${likeCount})` : ''}`}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer touch-manipulation ${
                        hasLiked
                          ? 'border-[#E5A93B]/50 bg-[#E5A93B]/10 text-[#E5A93B]'
                          : 'border-[#27272A] bg-[#09090B]/60 text-[#71717A] hover:border-[#3F3F46] hover:text-[#D4D4D8]'
                      }`}
                    >
                      <Heart
                        className={`h-3 w-3 ${hasLiked ? 'fill-[#E5A93B] text-[#E5A93B]' : ''}`}
                        aria-hidden="true"
                      />
                      {likeCount > 0 ? (
                        <span className="font-mono tabular-nums">{likeCount}</span>
                      ) : (
                        <span>{t('likeMessage')}</span>
                      )}
                    </button>
                  ) : likeCount > 0 ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-md border border-[#27272A]/80 bg-[#09090B]/60 px-2 py-0.5 text-[11px] font-mono tabular-nums text-[#A1A1AA]"
                      aria-label={`${likeCount} likes`}
                    >
                      <Heart className="h-3 w-3 fill-[#E5A93B]/70 text-[#E5A93B]" aria-hidden="true" />
                      <span>{likeCount}</span>
                    </span>
                  ) : null}

                  {/* Existing Emoji Reaction Badges */}
                  {reactionEntries.map(([emoji, reactors]) => {
                    const reactedByMe = reactors.includes(userId);
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handlePickMessageReaction(msg.id, emoji)}
                        aria-pressed={reactedByMe}
                        aria-label={`React with ${emoji} (${reactors.length})`}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors cursor-pointer touch-manipulation ${
                          reactedByMe
                            ? 'border-[#E5A93B]/60 bg-[#E5A93B]/15 text-[#F5C563]'
                            : 'border-[#27272A] bg-[#09090B]/80 text-[#D4D4D8] hover:border-[#E5A93B]/40'
                        }`}
                      >
                        <span className="leading-none">{emoji}</span>
                        <span className="font-mono text-[11px] tabular-nums">{reactors.length}</span>
                      </button>
                    );
                  })}

                  {/* Add Emoji Reaction Trigger */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsComposerEmojiOpen(false);
                      setExpandedReactionMsgId(null);
                      setReactionPickerMsgId((prev) => (prev === msg.id ? null : msg.id));
                    }}
                    aria-expanded={isReactionOpen}
                    aria-label="Add emoji reaction"
                    title="Add emoji reaction"
                    className={`inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] transition-colors cursor-pointer touch-manipulation ${
                      isReactionOpen
                        ? 'border-[#E5A93B] bg-[#E5A93B]/15 text-[#E5A93B]'
                        : 'border-[#27272A] bg-[#09090B]/60 text-[#71717A] hover:border-[#3F3F46] hover:text-[#E5A93B]'
                    }`}
                  >
                    <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>

                  {/* Floating Reaction Picker */}
                  {isReactionOpen && (
                    <div
                      role="dialog"
                      aria-label="Choose emoji reaction"
                      className="mt-1 w-full rounded-lg border border-[#E5A93B]/40 bg-[#09090B] p-2 shadow-xl"
                    >
                      <div className="flex flex-wrap items-center gap-1">
                        {QUICK_REACTION_EMOJIS.map((emoji) => {
                          const active = (msg.reactions?.[emoji] || []).includes(userId);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handlePickMessageReaction(msg.id, emoji)}
                              aria-label={`React with ${emoji}`}
                              className={`min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-md text-base transition-transform active:scale-95 cursor-pointer touch-manipulation ${
                                active
                                  ? 'bg-[#E5A93B]/25 ring-1 ring-[#E5A93B]'
                                  : 'hover:bg-[#18181B]'
                              }`}
                            >
                              {emoji}
                            </button>
                          );
                        })}

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedReactionMsgId((prev) => (prev === msg.id ? null : msg.id))
                          }
                          className="ml-auto min-h-[36px] rounded-md border border-[#27272A] bg-[#111114] px-2 text-[11px] font-medium text-[#E5A93B] hover:border-[#E5A93B] cursor-pointer touch-manipulation"
                        >
                          {isReactionExpanded ? 'Less' : 'More'}
                        </button>
                      </div>

                      {isReactionExpanded && (
                        <div className="mt-2 pt-2 border-t border-[#27272A] grid grid-cols-8 gap-1 max-h-36 overflow-y-auto">
                          {EMOJI_CATEGORIES.flatMap((c) => c.emojis).map((emoji, idx) => (
                            <button
                              key={`${emoji}-${idx}`}
                              type="button"
                              onClick={() => handlePickMessageReaction(msg.id, emoji)}
                              aria-label={`React with ${emoji}`}
                              className="min-h-[34px] inline-flex items-center justify-center rounded text-base hover:bg-[#18181B] cursor-pointer touch-manipulation"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        </div>

        {hasUnreadBelow && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            aria-label="Jump to latest message"
            className="absolute bottom-3 right-4 min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-[#E5A93B] bg-[#09090B]/95 px-3 py-1.5 text-xs font-semibold text-[#E5A93B] shadow-lg hover:bg-[#E5A93B] hover:text-[#09090B] transition-colors cursor-pointer touch-manipulation"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Latest</span>
          </button>
        )}
      </div>

      {/* Message Composer */}
      <form
        ref={composerPickerRef}
        onSubmit={handleSubmit}
        className="relative border-t border-[#27272A] bg-[#09090B] p-3"
      >
        {/* Composer Emoji Picker Popover */}
        {isComposerEmojiOpen && (
          <div
            role="dialog"
            aria-label="Emoji picker"
            className="mb-2.5 rounded-xl border border-[#E5A93B]/40 bg-[#111114] p-2.5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-1 pb-2 mb-2 border-b border-[#27272A] overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveEmojiTab('recent')}
                  className={`min-h-[32px] rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap cursor-pointer touch-manipulation ${
                    activeEmojiTab === 'recent'
                      ? 'bg-[#E5A93B] text-[#09090B] font-semibold'
                      : 'text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#18181B]'
                  }`}
                >
                  Recent
                </button>
                {EMOJI_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setActiveEmojiTab(cat.id)}
                    className={`min-h-[32px] rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap cursor-pointer touch-manipulation ${
                      activeEmojiTab === cat.id
                        ? 'bg-[#E5A93B] text-[#09090B] font-semibold'
                        : 'text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#18181B]'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setIsComposerEmojiOpen(false)}
                aria-label="Close emoji picker"
                className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-md text-[#71717A] hover:text-[#FAFAFA] hover:bg-[#18181B] cursor-pointer shrink-0"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-8 gap-1 max-h-36 overflow-y-auto">
              {activeCategoryEmojis.map((emoji, idx) => (
                <button
                  key={`${activeEmojiTab}-${emoji}-${idx}`}
                  type="button"
                  onClick={() => handleInsertComposerEmoji(emoji)}
                  aria-label={`Insert ${emoji}`}
                  className="min-h-[38px] inline-flex items-center justify-center rounded-md text-lg hover:bg-[#18181B] active:scale-95 transition-transform cursor-pointer touch-manipulation"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

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
          <button
            type="button"
            onClick={() => {
              setReactionPickerMsgId(null);
              setIsComposerEmojiOpen((prev) => !prev);
            }}
            aria-expanded={isComposerEmojiOpen}
            aria-label="Toggle emoji picker"
            title="Insert emoji"
            className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border transition-colors cursor-pointer touch-manipulation shrink-0 ${
              isComposerEmojiOpen
                ? 'border-[#E5A93B] bg-[#E5A93B]/15 text-[#E5A93B]'
                : 'border-[#27272A] bg-[#111114] text-[#A1A1AA] hover:border-[#E5A93B]/60 hover:text-[#E5A93B]'
            }`}
          >
            <Smile className="h-4 w-4" aria-hidden="true" />
          </button>

          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('messageRoomPlaceholder', { room: activeRoomMeta.label })}
            aria-label={t('messageRoomPlaceholder', { room: activeRoomMeta.label })}
            maxLength={1000}
            className="min-h-[44px] flex-1 min-w-0 rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-base text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() && !pendingMovieRef}
            aria-label="Send message"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg bg-[#E5A93B] p-2.5 text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer touch-manipulation shrink-0"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </aside>
  );
}
