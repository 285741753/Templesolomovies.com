import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RotateCcw,
  Lightbulb,
  ArrowUpDown,
  Flag,
  Volume2,
  VolumeX,
  Play,
  Crown,
  AlertTriangle,
  Bot,
  Users,
  Globe,
  Wifi,
  Bluetooth,
  Copy,
  Check,
  RefreshCw,
  LogOut,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { ChessPieceSvg } from './ChessPieceSvg';
import { playChessSound } from '../utils/chessAudio';
import type {
  ChessRoomMovePayload,
  ChessRoomState,
  ChessRoomSummary,
  ClientWsEvent,
  OnlineUser,
} from '../types/cinema';
import {
  applyChessMove,
  chooseBestMove,
  coordToAlgebraic,
  createInitialChessState,
  findLegalMoveByCoords,
  getCapturedPieces,
  getLegalMovesForState,
  replayCompactMoves,
  replayMoves,
  type BotDifficulty,
  type ChessMove,
  type ChessState,
  type Coord,
  type PieceColor,
  type PieceType,
  type PromotionType,
} from '../utils/chessEngine';

type GamePhase = 'TITLE_MENU' | 'PLAYING' | 'GAME_OVER';
type GameMode = 'bot' | 'local' | 'online' | 'p2p';
type P2PTransport = 'wifi' | 'bluetooth';
type P2PStatus = 'idle' | 'hosting' | 'joining' | 'connected' | 'error';

export interface ChessLoungeProps {
  userId?: string;
  username?: string;
  isWsConnected?: boolean;
  onlineUsers?: OnlineUser[];
  chessRoom?: ChessRoomState | null;
  chessRooms?: ChessRoomSummary[];
  chessError?: string | null;
  onClearChessError?: () => void;
  sendWs?: (payload: ClientWsEvent) => void;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

const PIECE_NAMES: Record<PieceType, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

const BLE_UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const BLE_UART_RX_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const BLE_UART_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

function sameCoord(a: Coord | null | undefined, b: Coord | null | undefined): boolean {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

function encodeSignalCode(desc: RTCSessionDescriptionInit): string {
  const json = JSON.stringify({ type: desc.type, sdp: desc.sdp });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function decodeSignalCode(code: string): RTCSessionDescriptionInit {
  const clean = code.trim();
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as RTCSessionDescriptionInit;
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 1500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', onChange);
      window.clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

type P2PWireMessage =
  | { type: 'hello'; username: string }
  | {
      type: 'move';
      fromRow: number;
      fromCol: number;
      toRow: number;
      toCol: number;
      promotion?: PromotionType;
      ply: number;
    }
  | { type: 'resign'; color: PieceColor }
  | { type: 'rematch' };

export function ChessLounge({
  userId = 'guest',
  username = 'MovieFan',
  isWsConnected = false,
  onlineUsers = [],
  chessRoom = null,
  chessRooms = [],
  chessError = null,
  onClearChessError,
  sendWs,
}: ChessLoungeProps) {
  const { t } = useLanguage();

  const [phase, setPhase] = useState<GamePhase>('TITLE_MENU');
  const [mode, setMode] = useState<GameMode>('bot');
  const [difficulty, setDifficulty] = useState<BotDifficulty>('club');
  const [humanColor, setHumanColor] = useState<PieceColor>('w');
  const [onlinePreferredColor, setOnlinePreferredColor] = useState<'w' | 'b' | 'random'>('random');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  // P2P Wi-Fi Direct / Bluetooth state
  const [p2pTransport, setP2PTransport] = useState<P2PTransport>('wifi');
  const [p2pStatus, setP2PStatus] = useState<P2PStatus>('idle');
  const [p2pColor, setP2PColor] = useState<PieceColor>('w');
  const [p2pPeerName, setP2PPeerName] = useState<string>('Nearby Player');
  const [p2pOfferCode, setP2POfferCode] = useState('');
  const [p2pRemoteCode, setP2PRemoteCode] = useState('');
  const [p2pAnswerCode, setP2PAnswerCode] = useState('');
  const [p2pMessage, setP2PMessage] = useState<string | null>(null);
  const [p2pCopied, setP2PCopied] = useState(false);

  const [flipped, setFlipped] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [chessState, setChessState] = useState<ChessState>(() => createInitialChessState());
  const [resignedBy, setResignedBy] = useState<PieceColor | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Coord | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Coord;
    to: Coord;
    candidates: ChessMove[];
  } | null>(null);
  const [hintMove, setHintMove] = useState<{ from: Coord; to: Coord } | null>(null);
  const [isBotThinking, setIsBotThinking] = useState(false);

  const botTimerRef = useRef<number | null>(null);
  const hintTimerRef = useRef<number | null>(null);
  const moveListRef = useRef<HTMLDivElement | null>(null);
  const chessStateRef = useRef(chessState);
  const soundEnabledRef = useRef(soundEnabled);

  // WebRTC & Bluetooth refs
  const rtcPcRef = useRef<RTCPeerConnection | null>(null);
  const rtcChannelRef = useRef<RTCDataChannel | null>(null);
  const bleDeviceRef = useRef<BluetoothDeviceLike | null>(null);
  const bleRxCharRef = useRef<BluetoothRemoteGATTCharacteristicLike | null>(null);
  const lastRoomPlyRef = useRef<number>(0);

  useEffect(() => {
    chessStateRef.current = chessState;
  }, [chessState]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const clearTimers = useCallback(() => {
    if (botTimerRef.current !== null) {
      window.clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }
    if (hintTimerRef.current !== null) {
      window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
  }, []);

  const closeP2PConnections = useCallback(() => {
    try {
      rtcChannelRef.current?.close();
    } catch {
      // ignore
    }
    rtcChannelRef.current = null;
    try {
      rtcPcRef.current?.close();
    } catch {
      // ignore
    }
    rtcPcRef.current = null;

    try {
      if (bleDeviceRef.current?.gatt?.connected) {
        bleDeviceRef.current.gatt.disconnect();
      }
    } catch {
      // ignore
    }
    bleDeviceRef.current = null;
    bleRxCharRef.current = null;
    setP2PStatus('idle');
    setP2POfferCode('');
    setP2PRemoteCode('');
    setP2PAnswerCode('');
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
      closeP2PConnections();
    };
  }, [clearTimers, closeP2PConnections]);

  useEffect(() => {
    if (moveListRef.current) {
      moveListRef.current.scrollTop = moveListRef.current.scrollHeight;
    }
  }, [chessState.history.length]);

  // Sync Online WebSocket Room state into local ChessState
  useEffect(() => {
    if (!chessRoom) {
      lastRoomPlyRef.current = 0;
      return;
    }

    setMode('online');
    const me = chessRoom.players.find((p) => p.userId === userId);
    if (me) {
      setFlipped(me.color === 'b');
    }

    const replayed = replayCompactMoves(chessRoom.moves);
    setChessState(replayed);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setHintMove(null);

    if (chessRoom.moves.length > lastRoomPlyRef.current) {
      const last = replayed.history[replayed.history.length - 1];
      if (replayed.status !== 'playing') {
        playChessSound('gameover', soundEnabledRef.current);
      } else if (replayed.inCheck) {
        playChessSound('check', soundEnabledRef.current);
      } else if (last?.captured) {
        playChessSound('capture', soundEnabledRef.current);
      } else if (last) {
        playChessSound('move', soundEnabledRef.current);
      }
    }
    lastRoomPlyRef.current = chessRoom.moves.length;

    if (chessRoom.resignedBy) {
      setResignedBy(chessRoom.resignedBy);
      setPhase('GAME_OVER');
    } else if (replayed.status !== 'playing') {
      setResignedBy(null);
      setPhase('GAME_OVER');
    } else {
      setResignedBy(null);
      setPhase('PLAYING');
    }
  }, [chessRoom, userId]);

  const legalMoves = useMemo(() => {
    if (phase !== 'PLAYING' || chessState.status !== 'playing' || resignedBy) {
      return [];
    }
    return getLegalMovesForState(
      chessState.board,
      chessState.turn,
      chessState.castling,
      chessState.enPassant,
      false
    );
  }, [phase, chessState, resignedBy]);

  const legalTargetsForSelected = useMemo(() => {
    if (!selectedSquare) return [];
    return legalMoves.filter((m) => sameCoord(m.from, selectedSquare));
  }, [selectedSquare, legalMoves]);

  const { capturedByWhite, capturedByBlack, materialAdvantage } = useMemo(
    () => getCapturedPieces(chessState.history),
    [chessState.history]
  );

  const movePairs = useMemo(() => {
    const pairs: Array<{ moveNumber: number; white?: string; black?: string }> = [];
    for (let i = 0; i < chessState.history.length; i += 2) {
      pairs.push({
        moveNumber: Math.floor(i / 2) + 1,
        white: chessState.history[i]?.san,
        black: chessState.history[i + 1]?.san,
      });
    }
    return pairs;
  }, [chessState.history]);

  const sendP2PPayload = useCallback(async (payload: P2PWireMessage) => {
    const json = JSON.stringify(payload);
    if (rtcChannelRef.current && rtcChannelRef.current.readyState === 'open') {
      rtcChannelRef.current.send(json);
    }
    if (bleRxCharRef.current) {
      let compact = '';
      if (payload.type === 'move') {
        compact = `M:${payload.fromRow},${payload.fromCol},${payload.toRow},${payload.toCol},${payload.promotion || ''},${payload.ply}\n`;
      } else if (payload.type === 'resign') {
        compact = `R:${payload.color}\n`;
      } else if (payload.type === 'rematch') {
        compact = 'REMATCH\n';
      } else if (payload.type === 'hello') {
        compact = `H:${payload.username.slice(0, 14)}\n`;
      }
      if (compact) {
        const bytes = new TextEncoder().encode(compact);
        if (bleRxCharRef.current.writeValueWithoutResponse) {
          await bleRxCharRef.current.writeValueWithoutResponse(bytes);
        } else if (bleRxCharRef.current.writeValueWithResponse) {
          await bleRxCharRef.current.writeValueWithResponse(bytes);
        } else if (bleRxCharRef.current.writeValue) {
          await bleRxCharRef.current.writeValue(bytes);
        }
      }
    }
  }, []);

  const handleIncomingP2PData = useCallback((rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    // Support compact BLE protocol lines or JSON WebRTC messages
    if (trimmed.startsWith('M:')) {
      const parts = trimmed.slice(2).split(',');
      const fromRow = Number(parts[0]);
      const fromCol = Number(parts[1]);
      const toRow = Number(parts[2]);
      const toCol = Number(parts[3]);
      const promotion = (parts[4] || undefined) as PromotionType | undefined;
      const current = chessStateRef.current;
      const move = findLegalMoveByCoords(current, fromRow, fromCol, toRow, toCol, promotion);
      if (move) {
        const nextState = applyChessMove(current, move);
        setChessState(nextState);
        setSelectedSquare(null);
        setPendingPromotion(null);
        setHintMove(null);
        if (nextState.status !== 'playing') {
          playChessSound('gameover', soundEnabledRef.current);
          setPhase('GAME_OVER');
        } else if (nextState.inCheck) {
          playChessSound('check', soundEnabledRef.current);
        } else if (move.captured) {
          playChessSound('capture', soundEnabledRef.current);
        } else {
          playChessSound('move', soundEnabledRef.current);
        }
      }
      return;
    }

    if (trimmed.startsWith('R:')) {
      const color = (trimmed.slice(2).trim() === 'b' ? 'b' : 'w') as PieceColor;
      setResignedBy(color);
      playChessSound('gameover', soundEnabledRef.current);
      setPhase('GAME_OVER');
      return;
    }

    if (trimmed === 'REMATCH') {
      setChessState(createInitialChessState());
      setResignedBy(null);
      setSelectedSquare(null);
      setPendingPromotion(null);
      setHintMove(null);
      setPhase('PLAYING');
      return;
    }

    if (trimmed.startsWith('H:')) {
      const name = trimmed.slice(2).trim();
      if (name) setP2PPeerName(name);
      return;
    }

    try {
      const msg = JSON.parse(trimmed) as P2PWireMessage;
      if (msg.type === 'hello' && msg.username) {
        setP2PPeerName(msg.username);
      } else if (msg.type === 'move') {
        const current = chessStateRef.current;
        if (msg.ply !== current.history.length + 1) return;
        const move = findLegalMoveByCoords(
          current,
          msg.fromRow,
          msg.fromCol,
          msg.toRow,
          msg.toCol,
          msg.promotion
        );
        if (move) {
          const nextState = applyChessMove(current, move);
          setChessState(nextState);
          setSelectedSquare(null);
          setPendingPromotion(null);
          setHintMove(null);
          if (nextState.status !== 'playing') {
            playChessSound('gameover', soundEnabledRef.current);
            setPhase('GAME_OVER');
          } else if (nextState.inCheck) {
            playChessSound('check', soundEnabledRef.current);
          } else if (move.captured) {
            playChessSound('capture', soundEnabledRef.current);
          } else {
            playChessSound('move', soundEnabledRef.current);
          }
        }
      } else if (msg.type === 'resign') {
        setResignedBy(msg.color);
        playChessSound('gameover', soundEnabledRef.current);
        setPhase('GAME_OVER');
      } else if (msg.type === 'rematch') {
        setChessState(createInitialChessState());
        setResignedBy(null);
        setSelectedSquare(null);
        setPendingPromotion(null);
        setHintMove(null);
        setPhase('PLAYING');
      }
    } catch {
      // Ignore unrecognized packets
    }
  }, []);

  const wireDataChannel = useCallback(
    (channel: RTCDataChannel, assignedColor: PieceColor) => {
      rtcChannelRef.current = channel;
      channel.onopen = () => {
        setP2PStatus('connected');
        setP2PColor(assignedColor);
        setFlipped(assignedColor === 'b');
        setP2PMessage(null);
        setChessState(createInitialChessState());
        setResignedBy(null);
        setPhase('PLAYING');
        void sendP2PPayload({ type: 'hello', username });
      };
      channel.onmessage = (ev) => {
        handleIncomingP2PData(String(ev.data || ''));
      };
      channel.onclose = () => {
        setP2PStatus((prev) => (prev === 'connected' ? 'idle' : prev));
        setP2PMessage('Wi-Fi peer disconnected.');
      };
    },
    [handleIncomingP2PData, sendP2PPayload, username]
  );

  const handleHostWifiMatch = async () => {
    closeP2PConnections();
    setP2PMessage(null);
    setP2PStatus('hosting');
    setP2PColor('w');

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      rtcPcRef.current = pc;
      const channel = pc.createDataChannel('temple-chess', { ordered: true });
      wireDataChannel(channel, 'w');

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc, 1400);

      if (!pc.localDescription) {
        throw new Error('Could not generate connection code.');
      }
      setP2POfferCode(encodeSignalCode(pc.localDescription));
    } catch (err) {
      setP2PStatus('error');
      setP2PMessage(
        err instanceof Error ? err.message : 'Unable to initialize Wi-Fi P2P host.'
      );
    }
  };

  const handleJoinWifiOffer = async () => {
    if (!p2pRemoteCode.trim()) {
      setP2PMessage('Paste the Host Offer Code first.');
      return;
    }
    closeP2PConnections();
    setP2PMessage(null);
    setP2PStatus('joining');
    setP2PColor('b');

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      rtcPcRef.current = pc;
      pc.ondatachannel = (ev) => {
        wireDataChannel(ev.channel, 'b');
      };

      const offerDesc = decodeSignalCode(p2pRemoteCode);
      await pc.setRemoteDescription(new RTCSessionDescription(offerDesc));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc, 1400);

      if (!pc.localDescription) {
        throw new Error('Could not generate reply code.');
      }
      setP2PAnswerCode(encodeSignalCode(pc.localDescription));
    } catch {
      setP2PStatus('error');
      setP2PMessage('Invalid Offer Code. Make sure you copied the full code from the Host.');
    }
  };

  const handleHostApplyAnswer = async () => {
    const pc = rtcPcRef.current;
    if (!pc || !p2pRemoteCode.trim()) {
      setP2PMessage('Paste the Guest Answer Code first.');
      return;
    }
    try {
      const answerDesc = decodeSignalCode(p2pRemoteCode);
      await pc.setRemoteDescription(new RTCSessionDescription(answerDesc));
      setP2PMessage('Connecting peer-to-peer...');
    } catch {
      setP2PMessage('Invalid Answer Code. Ask your partner to resend their reply code.');
    }
  };

  const handleConnectBluetooth = async () => {
    setP2PMessage(null);
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      setP2PStatus('error');
      setP2PMessage(
        'Web Bluetooth is not supported in this browser (requires Chrome/Edge/Android HTTPS). Use Wi-Fi Direct or Online Room.'
      );
      return;
    }

    try {
      setP2PStatus('joining');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_UART_SERVICE] }],
        optionalServices: [BLE_UART_SERVICE],
      });
      bleDeviceRef.current = device;
      setP2PPeerName(device.name || 'Bluetooth Chess');

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('Could not open Bluetooth GATT connection.');
      }

      const service = await server.getPrimaryService(BLE_UART_SERVICE);
      const rxChar = await service.getCharacteristic(BLE_UART_RX_CHAR);
      const txChar = await service.getCharacteristic(BLE_UART_TX_CHAR);
      bleRxCharRef.current = rxChar;

      await txChar.startNotifications();
      txChar.addEventListener('characteristicvaluechanged', (event) => {
        const target = event.target as unknown as BluetoothRemoteGATTCharacteristicLike;
        if (!target.value) return;
        const decoded = new TextDecoder().decode(target.value);
        handleIncomingP2PData(decoded);
      });

      device.addEventListener('gattserverdisconnected', () => {
        setP2PStatus('idle');
        setP2PMessage('Bluetooth device disconnected.');
      });

      setP2PColor('w');
      setFlipped(false);
      setP2PStatus('connected');
      setChessState(createInitialChessState());
      setResignedBy(null);
      setPhase('PLAYING');
      void sendP2PPayload({ type: 'hello', username });
    } catch (err) {
      setP2PStatus('error');
      const msg = err instanceof Error ? err.message : 'Bluetooth scan cancelled or unsupported.';
      setP2PMessage(
        msg.includes('cancelled') || msg.includes('User cancelled')
          ? 'Bluetooth device picker closed.'
          : `${msg} Tip: Phones running web browsers cannot act as BLE peripherals directly — use Wi-Fi / Hotspot Direct or Online Room for phone-to-phone play.`
      );
    }
  };

  const executeMove = useCallback(
    (move: ChessMove, isLocalActor = true) => {
      setSelectedSquare(null);
      setPendingPromotion(null);
      setHintMove(null);

      if (mode === 'online' && isLocalActor) {
        if (!chessRoom || !sendWs) return;
        const movePayload: ChessRoomMovePayload = {
          fromRow: move.from.row,
          fromCol: move.from.col,
          toRow: move.to.row,
          toCol: move.to.col,
          promotion: move.promotion,
          san: move.san || `${coordToAlgebraic(move.from)}-${coordToAlgebraic(move.to)}`,
          byColor: chessState.turn,
          ply: chessState.history.length + 1,
        };
        sendWs({
          type: 'chess:move',
          roomCode: chessRoom.roomCode,
          userId,
          move: movePayload,
        });
      }

      const nextState = applyChessMove(chessState, move);
      setChessState(nextState);

      if (mode === 'p2p' && isLocalActor) {
        void sendP2PPayload({
          type: 'move',
          fromRow: move.from.row,
          fromCol: move.from.col,
          toRow: move.to.row,
          toCol: move.to.col,
          promotion: move.promotion,
          ply: nextState.history.length,
        });
      }

      if (nextState.status !== 'playing') {
        playChessSound('gameover', soundEnabled);
        setPhase('GAME_OVER');
      } else if (nextState.inCheck) {
        playChessSound('check', soundEnabled);
      } else if (move.captured) {
        playChessSound('capture', soundEnabled);
      } else {
        playChessSound('move', soundEnabled);
      }
    },
    [chessRoom, chessState, mode, sendP2PPayload, sendWs, soundEnabled, userId]
  );

  // Trigger fast AI Bot turn when playing vs Bot
  useEffect(() => {
    if (
      phase !== 'PLAYING' ||
      mode !== 'bot' ||
      chessState.status !== 'playing' ||
      resignedBy ||
      chessState.turn === humanColor
    ) {
      setIsBotThinking(false);
      return;
    }

    setIsBotThinking(true);
    botTimerRef.current = window.setTimeout(() => {
      botTimerRef.current = null;
      const best = chooseBestMove(chessState, difficulty);
      setIsBotThinking(false);
      if (best) {
        executeMove(best, false);
      }
    }, 90);

    return () => {
      if (botTimerRef.current !== null) {
        window.clearTimeout(botTimerRef.current);
        botTimerRef.current = null;
      }
    };
  }, [phase, mode, chessState, humanColor, difficulty, resignedBy, executeMove]);

  const handleStartGame = () => {
    clearTimers();
    if (mode === 'online') {
      if (!sendWs || !isWsConnected) return;
      onClearChessError?.();
      sendWs({
        type: 'chess:create',
        userId,
        username,
        preferredColor: onlinePreferredColor,
      });
      return;
    }
    if (mode === 'p2p' && p2pStatus !== 'connected') {
      return;
    }

    setChessState(createInitialChessState());
    setResignedBy(null);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setHintMove(null);
    setIsBotThinking(false);
    setFlipped((mode === 'bot' && humanColor === 'b') || (mode === 'p2p' && p2pColor === 'b'));
    setPhase('PLAYING');
  };

  const handleResetToSetup = () => {
    clearTimers();
    if (mode === 'online' && chessRoom && sendWs) {
      sendWs({ type: 'chess:leave', roomCode: chessRoom.roomCode, userId });
    }
    if (mode === 'p2p') {
      closeP2PConnections();
    }
    setChessState(createInitialChessState());
    setResignedBy(null);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setHintMove(null);
    setIsBotThinking(false);
    setPhase('TITLE_MENU');
  };

  const myOnlineColor: PieceColor | null = useMemo(() => {
    if (mode !== 'online' || !chessRoom) return null;
    return chessRoom.players.find((p) => p.userId === userId)?.color || null;
  }, [mode, chessRoom, userId]);

  const isWaitingForOpponent =
    mode === 'online' && Boolean(chessRoom) && chessRoom!.status === 'waiting';

  const canHumanInteract =
    phase === 'PLAYING' &&
    chessState.status === 'playing' &&
    !resignedBy &&
    !isBotThinking &&
    !pendingPromotion &&
    !isWaitingForOpponent &&
    (mode === 'local' ||
      (mode === 'bot' && chessState.turn === humanColor) ||
      (mode === 'online' && myOnlineColor !== null && chessState.turn === myOnlineColor) ||
      (mode === 'p2p' && p2pStatus === 'connected' && chessState.turn === p2pColor));

  const attemptMove = (from: Coord, to: Coord) => {
    const candidates = legalMoves.filter(
      (m) => sameCoord(m.from, from) && sameCoord(m.to, to)
    );
    if (candidates.length === 0) return false;

    const hasPromotion = candidates.some((c) => Boolean(c.promotion));
    if (hasPromotion) {
      setPendingPromotion({ from, to, candidates });
      setSelectedSquare(null);
      return true;
    }

    executeMove(candidates[0], true);
    return true;
  };

  const handleSquareClick = (row: number, col: number) => {
    if (!canHumanInteract) return;
    const clicked: Coord = { row, col };
    const pieceAtClicked = chessState.board[row][col];

    if (selectedSquare) {
      if (sameCoord(selectedSquare, clicked)) {
        setSelectedSquare(null);
        return;
      }

      if (attemptMove(selectedSquare, clicked)) {
        return;
      }
    }

    if (pieceAtClicked && pieceAtClicked.color === chessState.turn) {
      setSelectedSquare(clicked);
      setHintMove(null);
    } else {
      setSelectedSquare(null);
    }
  };

  const handleDropSquare = (targetRow: number, targetCol: number) => {
    if (!canHumanInteract || !selectedSquare) return;
    attemptMove(selectedSquare, { row: targetRow, col: targetCol });
  };

  const handleUndo = () => {
    if (mode === 'online' || mode === 'p2p') return;
    if (phase !== 'PLAYING' && phase !== 'GAME_OVER') return;
    if (chessState.history.length === 0 || isBotThinking) return;
    clearTimers();
    setResignedBy(null);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setHintMove(null);

    let pliesToUndo = 1;
    if (mode === 'bot') {
      pliesToUndo = chessState.turn === humanColor ? 2 : 1;
      if (chessState.history.length < pliesToUndo) {
        pliesToUndo = chessState.history.length;
      }
    }

    const remaining = chessState.history.slice(0, chessState.history.length - pliesToUndo);
    setChessState(replayMoves(remaining));
    setPhase('PLAYING');
  };

  const handleShowHint = () => {
    if (!canHumanInteract) return;
    const recommended = chooseBestMove(chessState, 'club');
    if (!recommended) return;
    if (hintTimerRef.current !== null) {
      window.clearTimeout(hintTimerRef.current);
    }
    setHintMove({ from: recommended.from, to: recommended.to });
    setSelectedSquare(recommended.from);
    hintTimerRef.current = window.setTimeout(() => {
      setHintMove(null);
      hintTimerRef.current = null;
    }, 2400);
  };

  const handleResign = () => {
    if (phase !== 'PLAYING' || chessState.status !== 'playing') return;
    clearTimers();
    setIsBotThinking(false);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setHintMove(null);

    if (mode === 'online' && chessRoom && sendWs) {
      sendWs({ type: 'chess:resign', roomCode: chessRoom.roomCode, userId });
      return;
    }

    const losingColor =
      mode === 'bot'
        ? humanColor
        : mode === 'p2p'
        ? p2pColor
        : chessState.turn;

    if (mode === 'p2p') {
      void sendP2PPayload({ type: 'resign', color: losingColor });
    }

    setResignedBy(losingColor);
    playChessSound('gameover', soundEnabled);
    setPhase('GAME_OVER');
  };

  const handleRematch = () => {
    if (mode === 'online' && chessRoom && sendWs) {
      sendWs({ type: 'chess:rematch', roomCode: chessRoom.roomCode, userId });
      return;
    }
    if (mode === 'p2p') {
      setChessState(createInitialChessState());
      setResignedBy(null);
      setSelectedSquare(null);
      setPendingPromotion(null);
      setHintMove(null);
      setPhase('PLAYING');
      void sendP2PPayload({ type: 'rematch' });
      return;
    }
    handleStartGame();
  };

  const topColor: PieceColor = flipped ? 'w' : 'b';
  const bottomColor: PieceColor = flipped ? 'b' : 'w';

  const getPlayerLabel = (color: PieceColor) => {
    if (mode === 'online' && chessRoom) {
      const player = chessRoom.players.find((p) => p.color === color);
      if (player) {
        return player.userId === userId
          ? `${player.username} (You)`
          : player.username;
      }
      return `Waiting for ${color === 'w' ? 'White' : 'Black'}...`;
    }
    if (mode === 'p2p') {
      if (color === p2pColor) {
        return `${username} (You)`;
      }
      return `${p2pPeerName} (${p2pTransport === 'bluetooth' ? 'BT' : 'Wi-Fi'})`;
    }
    if (mode === 'local') {
      return color === 'w' ? `${t('chessWhite')} (P1)` : `${t('chessBlack')} (P2)`;
    }
    if (color === humanColor) {
      return `You (${color === 'w' ? t('chessWhite') : t('chessBlack')})`;
    }
    const tier =
      difficulty === 'master'
        ? t('chessMaster')
        : difficulty === 'club'
        ? t('chessClub')
        : t('chessCasual');
    return `Vault Bot · ${tier}`;
  };

  const getOutcomeSummary = (): { headline: string; detail: string } => {
    if (resignedBy) {
      const winnerColor = resignedBy === 'w' ? 'b' : 'w';
      return {
        headline: `${winnerColor === 'w' ? t('chessWhite') : t('chessBlack')} wins by resignation`,
        detail: `${resignedBy === 'w' ? t('chessWhite') : t('chessBlack')} resigned after ${chessState.history.length} plies.`,
      };
    }
    if (chessState.status === 'checkmate' && chessState.winner) {
      const winLabel = chessState.winner === 'w' ? t('chessWhite') : t('chessBlack');
      return {
        headline: `Checkmate — ${winLabel} wins`,
        detail: `Victory secured in ${Math.ceil(chessState.history.length / 2)} moves.`,
      };
    }
    if (chessState.status === 'stalemate') {
      return {
        headline: 'Draw by Stalemate',
        detail: 'No legal moves remaining without check.',
      };
    }
    if (chessState.status === 'draw_repetition') {
      return {
        headline: 'Draw by Threefold Repetition',
        detail: 'Identical board position reached three times.',
      };
    }
    if (chessState.status === 'draw_fifty') {
      return {
        headline: 'Draw by 50-Move Rule',
        detail: '50 consecutive moves without pawn advance or capture.',
      };
    }
    if (chessState.status === 'draw_material') {
      return {
        headline: 'Draw by Insufficient Material',
        detail: 'Neither side has mating material remaining.',
      };
    }
    return { headline: '', detail: '' };
  };

  const renderCapturedStrip = (color: PieceColor) => {
    const pieces = color === 'w' ? capturedByWhite : capturedByBlack;
    const adv =
      color === 'w'
        ? materialAdvantage > 0
          ? `+${materialAdvantage}`
          : ''
        : materialAdvantage < 0
        ? `+${Math.abs(materialAdvantage)}`
        : '';

    return (
      <div className="flex items-center gap-1 min-h-[20px]">
        {pieces.map((p, idx) => (
          <span key={`${p.color}-${p.type}-${idx}`} className="h-4 w-4 inline-block">
            <ChessPieceSvg color={p.color} type={p.type} className="h-4 w-4" />
          </span>
        ))}
        {adv && (
          <span className="ml-1 font-mono text-[11px] font-semibold tabular-nums text-[#E5A93B]">
            {adv}
          </span>
        )}
      </div>
    );
  };

  const displayRows = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const displayCols = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  const turnStatusText = useMemo(() => {
    if (phase === 'TITLE_MENU') return t('chessStartGame');
    if (phase === 'GAME_OVER') return t('chessMatchSummary');
    if (isWaitingForOpponent && chessRoom) {
      return `Waiting in Room ${chessRoom.roomCode}...`;
    }
    if (isBotThinking) return t('chessBotThinking');
    if (mode === 'online' && myOnlineColor) {
      return chessState.turn === myOnlineColor
        ? `${t('chessYourTurn')} (${myOnlineColor === 'w' ? t('chessWhite') : t('chessBlack')})`
        : 'Opponent thinking...';
    }
    if (mode === 'p2p') {
      return chessState.turn === p2pColor
        ? `${t('chessYourTurn')} (${p2pColor === 'w' ? t('chessWhite') : t('chessBlack')})`
        : `Waiting for ${p2pPeerName}...`;
    }
    if (mode === 'bot' && chessState.turn === humanColor) {
      return `${t('chessYourTurn')} (${chessState.turn === 'w' ? t('chessWhite') : t('chessBlack')})`;
    }
    return chessState.turn === 'w' ? t('chessWhiteToMove') : t('chessBlackToMove');
  }, [
    phase,
    isWaitingForOpponent,
    chessRoom,
    isBotThinking,
    mode,
    myOnlineColor,
    chessState.turn,
    p2pColor,
    p2pPeerName,
    humanColor,
    t,
  ]);

  const outcome = getOutcomeSummary();

  return (
    <section
      id="chess-game"
      aria-labelledby="chess-heading"
      className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 pb-12"
    >
      <div className="rounded-xl border border-[#27272A] bg-[#111114] p-4 sm:p-7">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#27272A] pb-5 mb-6">
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#E5A93B] tracking-wide mb-1">
              {t('chessEyebrow')}
            </p>
            <h2
              id="chess-heading"
              className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA]"
            >
              {t('chessTitle')}
            </h2>
            <p className="text-sm text-[#A1A1AA] mt-1 max-w-2xl">
              {t('chessSubtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSoundEnabled((prev) => !prev)}
              aria-pressed={soundEnabled}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {soundEnabled ? (
                <Volume2 className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
              ) : (
                <VolumeX className="h-3.5 w-3.5 text-[#71717A]" aria-hidden="true" />
              )}
              <span>{soundEnabled ? t('chessSoundOn') : t('chessSoundOff')}</span>
            </button>

            <button
              type="button"
              onClick={() => setFlipped((prev) => !prev)}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
              <span>{t('chessFlip')}</span>
            </button>
          </div>
        </div>

        {/* Main 2-Column Arena: 8x8 Board + HUD / Setup / Multiplayer */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
          {/* Left: Player Bars + 8x8 Chessboard */}
          <div className="lg:col-span-7 flex flex-col items-center min-w-0">
            <div className="w-full max-w-[540px]">
              {/* Top Player HUD Bar */}
              <div className="flex items-center justify-between gap-3 rounded-t-lg border border-b-0 border-[#27272A] bg-[#09090B] px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`h-3.5 w-3.5 rounded-sm border shrink-0 ${
                      topColor === 'w'
                        ? 'bg-[#FAF8F5] border-[#52525B]'
                        : 'bg-[#18181B] border-[#E5A93B]'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-semibold text-[#FAFAFA] truncate">
                    {getPlayerLabel(topColor)}
                  </span>
                  {phase === 'PLAYING' && chessState.turn === topColor && (
                    <span className="text-[11px] font-mono text-[#E5A93B] shrink-0">
                      · {isBotThinking && mode === 'bot' ? t('chessBotThinking') : 'Active'}
                    </span>
                  )}
                </div>
                {renderCapturedStrip(topColor)}
              </div>

              {/* 8x8 Chessboard Grid */}
              <div className="relative aspect-square w-full border border-[#27272A] bg-[#09090B] select-none overflow-hidden">
                <div
                  role="grid"
                  aria-label="Chessboard"
                  className="grid grid-cols-8 grid-rows-8 h-full w-full"
                >
                  {displayRows.map((r, visualRowIdx) =>
                    displayCols.map((c, visualColIdx) => {
                      const isLight = (r + c) % 2 === 0;
                      const sqPiece = chessState.board[r][c];
                      const coord: Coord = { row: r, col: c };
                      const isSelected = sameCoord(selectedSquare, coord);
                      const targetMove = legalTargetsForSelected.find((m) =>
                        sameCoord(m.to, coord)
                      );
                      const isLegalTarget = Boolean(targetMove);
                      const isLastFrom = sameCoord(chessState.lastMove?.from, coord);
                      const isLastTo = sameCoord(chessState.lastMove?.to, coord);
                      const isHintFrom = sameCoord(hintMove?.from, coord);
                      const isHintTo = sameCoord(hintMove?.to, coord);
                      const isKingInCheck =
                        Boolean(chessState.inCheck) &&
                        sqPiece?.type === 'k' &&
                        sqPiece.color === chessState.inCheck;

                      const algebraic = coordToAlgebraic(coord);
                      const pieceDesc = sqPiece
                        ? `${sqPiece.color === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[sqPiece.type]}`
                        : 'Empty';

                      let squareBg = isLight ? 'bg-[#E7DEC8]' : 'bg-[#63513E]';
                      if (isSelected) {
                        squareBg = 'bg-[#D99B2B]';
                      } else if (isHintFrom || isHintTo) {
                        squareBg = isLight ? 'bg-[#D5E3B8]' : 'bg-[#5A7544]';
                      } else if (isLastFrom || isLastTo) {
                        squareBg = isLight ? 'bg-[#DDD09E]' : 'bg-[#7A6438]';
                      }

                      return (
                        <button
                          key={algebraic}
                          type="button"
                          onClick={() => handleSquareClick(r, c)}
                          onDragOver={(e) => {
                            if (canHumanInteract && isLegalTarget) {
                              e.preventDefault();
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            handleDropSquare(r, c);
                          }}
                          aria-label={`${algebraic} ${pieceDesc}${
                            isLegalTarget ? ' (Legal move)' : ''
                          }`}
                          className={`relative flex items-center justify-center touch-manipulation transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#E5A93B] ${squareBg} ${
                            canHumanInteract ? 'cursor-pointer' : 'cursor-default'
                          }`}
                        >
                          {visualColIdx === 0 && (
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none absolute top-0.5 left-1 text-[10px] font-mono font-semibold leading-none ${
                                isLight ? 'text-[#5C4B37]' : 'text-[#E7DEC8]/85'
                              }`}
                            >
                              {8 - r}
                            </span>
                          )}

                          {visualRowIdx === 7 && (
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none absolute bottom-0.5 right-1 text-[10px] font-mono font-semibold leading-none ${
                                isLight ? 'text-[#5C4B37]' : 'text-[#E7DEC8]/85'
                              }`}
                            >
                              {FILES[c]}
                            </span>
                          )}

                          {isKingInCheck && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,rgba(220,38,38,0.65)_0%,rgba(220,38,38,0.18)_62%,transparent_76%)]"
                            />
                          )}

                          {sqPiece && (
                            <div
                              draggable={
                                canHumanInteract && sqPiece.color === chessState.turn
                              }
                              onDragStart={() => {
                                if (
                                  canHumanInteract &&
                                  sqPiece.color === chessState.turn
                                ) {
                                  setSelectedSquare(coord);
                                  setHintMove(null);
                                }
                              }}
                              className="relative z-10 w-[82%] h-[82%]"
                            >
                              <ChessPieceSvg color={sqPiece.color} type={sqPiece.type} />
                            </div>
                          )}

                          {isLegalTarget && !sqPiece && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none z-20 h-3 w-3 rounded-full bg-[#09090B]/35 ring-1 ring-[#FAFAFA]/30"
                            />
                          )}
                          {isLegalTarget && sqPiece && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-1 z-20 rounded-full border-[3px] border-[#09090B]/45"
                            />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Pawn Promotion Chooser Overlay */}
                {pendingPromotion && (
                  <div
                    role="dialog"
                    aria-label={t('chessChoosePromotion')}
                    className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
                  >
                    <div className="rounded-xl border border-[#27272A] bg-[#111114] p-4 shadow-2xl text-center">
                      <p className="text-xs font-semibold text-[#FAFAFA] mb-3">
                        {t('chessChoosePromotion')}
                      </p>
                      <div className="flex items-center gap-2">
                        {(['q', 'r', 'b', 'n'] as PromotionType[]).map((promoType) => {
                          const match = pendingPromotion.candidates.find(
                            (c) => c.promotion === promoType
                          );
                          if (!match) return null;
                          return (
                            <button
                              key={promoType}
                              type="button"
                              onClick={() => executeMove(match, true)}
                              aria-label={`Promote to ${PIECE_NAMES[promoType]}`}
                              className="flex flex-col items-center gap-1 rounded-lg border border-[#27272A] bg-[#18181B] p-2.5 hover:border-[#E5A93B] transition-colors cursor-pointer"
                            >
                              <div className="h-10 w-10">
                                <ChessPieceSvg
                                  color={chessState.turn}
                                  type={promoType}
                                />
                              </div>
                              <span className="text-[11px] font-medium text-[#D4D4D8]">
                                {PIECE_NAMES[promoType]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Player HUD Bar */}
              <div className="flex items-center justify-between gap-3 rounded-b-lg border border-t-0 border-[#27272A] bg-[#09090B] px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`h-3.5 w-3.5 rounded-sm border shrink-0 ${
                      bottomColor === 'w'
                        ? 'bg-[#FAF8F5] border-[#52525B]'
                        : 'bg-[#18181B] border-[#E5A93B]'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-semibold text-[#FAFAFA] truncate">
                    {getPlayerLabel(bottomColor)}
                  </span>
                  {phase === 'PLAYING' && chessState.turn === bottomColor && (
                    <span className="text-[11px] font-mono text-[#E5A93B] shrink-0">
                      · {isBotThinking && mode === 'bot' ? t('chessBotThinking') : 'Active'}
                    </span>
                  )}
                </div>
                {renderCapturedStrip(bottomColor)}
              </div>
            </div>
          </div>

          {/* Right: Game State Panel (TITLE_MENU / PLAYING / GAME_OVER) */}
          <div className="lg:col-span-5 flex flex-col gap-4 min-w-0">
            {/* Live Turn & Check Status Header */}
            <div className="rounded-lg border border-[#27272A] bg-[#09090B] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-[#71717A] mb-0.5">Match Status</p>
                  <p className="font-display text-base font-semibold text-[#FAFAFA] truncate">
                    {turnStatusText}
                  </p>
                </div>
                <div className="text-right font-mono tabular-nums shrink-0">
                  <p className="text-xs text-[#71717A]">Move</p>
                  <p className="text-base font-semibold text-[#E5A93B]">
                    {chessState.fullmoveNumber}
                  </p>
                </div>
              </div>

              {phase === 'PLAYING' && chessState.inCheck && (
                <div className="mt-3 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-200">
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
                  <span>
                    {chessState.inCheck === 'w' ? t('chessWhite') : t('chessBlack')} is in{' '}
                    {t('chessInCheck')}
                  </span>
                </div>
              )}

              {mode === 'online' && chessRoom && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#E5A93B]/35 bg-[#18181B] px-3 py-2 text-xs">
                  <span className="font-mono text-[#D4D4D8]">
                    Room: <strong className="text-[#E5A93B]">{chessRoom.roomCode}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(chessRoom.roomCode);
                      setCopiedCode(true);
                      window.setTimeout(() => setCopiedCode(false), 1800);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#E5A93B] hover:underline cursor-pointer"
                  >
                    {copiedCode ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                  </button>
                </div>
              )}
            </div>

            {phase === 'TITLE_MENU' ? (
              <div className="rounded-lg border border-[#27272A] bg-[#09090B] p-4 sm:p-5 space-y-5">
                {/* Mode Selector (4 Modes: vs Bot, Pass & Play, Online, Wi-Fi / BT) */}
                <div>
                  <p className="text-xs font-medium text-[#A1A1AA] mb-2">Game Mode</p>
                  <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#111114] p-1 border border-[#27272A]">
                    <button
                      type="button"
                      onClick={() => setMode('bot')}
                      className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        mode === 'bot'
                          ? 'bg-[#18181B] text-[#FAFAFA] shadow-sm border border-[#E5A93B]/30'
                          : 'text-[#71717A] hover:text-[#D4D4D8]'
                      }`}
                    >
                      <Bot className="h-3.5 w-3.5 text-[#E5A93B] shrink-0" aria-hidden="true" />
                      <span className="truncate">{t('chessVsBot')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMode('local')}
                      className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        mode === 'local'
                          ? 'bg-[#18181B] text-[#FAFAFA] shadow-sm border border-[#E5A93B]/30'
                          : 'text-[#71717A] hover:text-[#D4D4D8]'
                      }`}
                    >
                      <Users className="h-3.5 w-3.5 text-[#E5A93B] shrink-0" aria-hidden="true" />
                      <span className="truncate">{t('chessPassAndPlay')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMode('online');
                        sendWs?.({ type: 'chess:list' });
                      }}
                      className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        mode === 'online'
                          ? 'bg-[#18181B] text-[#FAFAFA] shadow-sm border border-[#E5A93B]/30'
                          : 'text-[#71717A] hover:text-[#D4D4D8]'
                      }`}
                    >
                      <Globe className="h-3.5 w-3.5 text-[#E5A93B] shrink-0" aria-hidden="true" />
                      <span className="truncate">Online Room</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMode('p2p')}
                      className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        mode === 'p2p'
                          ? 'bg-[#18181B] text-[#FAFAFA] shadow-sm border border-[#E5A93B]/30'
                          : 'text-[#71717A] hover:text-[#D4D4D8]'
                      }`}
                    >
                      <Wifi className="h-3.5 w-3.5 text-[#E5A93B] shrink-0" aria-hidden="true" />
                      <span className="truncate">Wi-Fi / BT</span>
                    </button>
                  </div>
                </div>

                {/* Bot Setup */}
                {mode === 'bot' && (
                  <>
                    <div>
                      <p className="text-xs font-medium text-[#A1A1AA] mb-2">
                        {t('chessDifficulty')}
                      </p>
                      <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-[#111114] p-1 border border-[#27272A]">
                        {(
                          [
                            { id: 'casual', label: t('chessCasual') },
                            { id: 'club', label: t('chessClub') },
                            { id: 'master', label: t('chessMaster') },
                          ] as Array<{ id: BotDifficulty; label: string }>
                        ).map((tier) => (
                          <button
                            key={tier.id}
                            type="button"
                            onClick={() => setDifficulty(tier.id)}
                            className={`min-h-[38px] rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                              difficulty === tier.id
                                ? 'bg-[#18181B] text-[#E5A93B] shadow-sm'
                                : 'text-[#71717A] hover:text-[#D4D4D8]'
                            }`}
                          >
                            {tier.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-[#A1A1AA] mb-2">
                        {t('chessPlayAs')}
                      </p>
                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#111114] p-1 border border-[#27272A]">
                        <button
                          type="button"
                          onClick={() => {
                            setHumanColor('w');
                            setFlipped(false);
                          }}
                          className={`min-h-[38px] inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                            humanColor === 'w'
                              ? 'bg-[#18181B] text-[#FAFAFA] shadow-sm'
                              : 'text-[#71717A] hover:text-[#D4D4D8]'
                          }`}
                        >
                          <span className="h-3 w-3 rounded-sm bg-[#FAF8F5] border border-[#52525B]" />
                          <span>{t('chessWhite')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setHumanColor('b');
                            setFlipped(true);
                          }}
                          className={`min-h-[38px] inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                            humanColor === 'b'
                              ? 'bg-[#18181B] text-[#FAFAFA] shadow-sm'
                              : 'text-[#71717A] hover:text-[#D4D4D8]'
                          }`}
                        >
                          <span className="h-3 w-3 rounded-sm bg-[#18181B] border border-[#E5A93B]" />
                          <span>{t('chessBlack')}</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Online User-to-User Setup */}
                {mode === 'online' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 text-xs rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2">
                      <span className="text-[#A1A1AA]">
                        Server:{' '}
                        <strong className={isWsConnected ? 'text-emerald-400' : 'text-amber-300'}>
                          {isWsConnected ? `Online (${onlineUsers.length} users)` : 'Offline / Static host'}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => sendWs?.({ type: 'chess:list' })}
                        className="inline-flex items-center gap-1 text-[#E5A93B] hover:underline cursor-pointer"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Refresh</span>
                      </button>
                    </div>

                    {!isWsConnected && (
                      <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-2">
                        <p>
                          Live WebSocket server is unavailable on this host. Switch to{' '}
                          <strong>Wi-Fi / BT Direct</strong> to connect peer-to-peer without a server!
                        </p>
                        <button
                          type="button"
                          onClick={() => setMode('p2p')}
                          className="rounded-md bg-[#E5A93B] px-3 py-1.5 text-xs font-semibold text-[#09090B] cursor-pointer"
                        >
                          Switch to Wi-Fi / BT P2P
                        </button>
                      </div>
                    )}

                    {chessError && (
                      <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        {chessError}
                      </div>
                    )}

                    {/* Create Room Preferred Color */}
                    <div>
                      <p className="text-xs font-medium text-[#A1A1AA] mb-1.5">Create Room As</p>
                      <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-[#111114] p-1 border border-[#27272A]">
                        {(
                          [
                            { id: 'w', label: 'White' },
                            { id: 'b', label: 'Black' },
                            { id: 'random', label: 'Random' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setOnlinePreferredColor(opt.id)}
                            className={`rounded-md px-2 py-1.5 text-xs font-medium cursor-pointer ${
                              onlinePreferredColor === opt.id
                                ? 'bg-[#18181B] text-[#E5A93B]'
                                : 'text-[#71717A] hover:text-[#D4D4D8]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Join Room By Code */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={joinCodeInput}
                        onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                        placeholder="Enter Room Code (e.g. A1B2C3)"
                        className="min-h-[40px] flex-1 min-w-0 rounded-lg border border-[#27272A] bg-[#111114] px-3 py-1.5 text-xs font-mono text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={!isWsConnected || !joinCodeInput.trim()}
                        onClick={() => {
                          onClearChessError?.();
                          sendWs?.({
                            type: 'chess:join',
                            roomCode: joinCodeInput.trim(),
                            userId,
                            username,
                          });
                        }}
                        className="min-h-[40px] rounded-lg border border-[#E5A93B]/60 bg-[#E5A93B]/15 px-3.5 py-1.5 text-xs font-semibold text-[#E5A93B] hover:bg-[#E5A93B]/25 disabled:opacity-40 cursor-pointer shrink-0"
                      >
                        Join
                      </button>
                    </div>

                    {/* Open Rooms List */}
                    {chessRooms.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-mono uppercase tracking-wider text-[#71717A]">
                          Open Tables ({chessRooms.length})
                        </p>
                        <div className="max-h-32 overflow-y-auto space-y-1.5">
                          {chessRooms.map((r) => (
                            <div
                              key={r.roomCode}
                              className="flex items-center justify-between gap-2 rounded-lg border border-[#27272A] bg-[#111114] px-3 py-2 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="font-medium text-[#FAFAFA] truncate">{r.hostName}</p>
                                <p className="font-mono text-[10px] text-[#A1A1AA]">
                                  Code: {r.roomCode} · 1/2 waiting
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  onClearChessError?.();
                                  sendWs?.({
                                    type: 'chess:join',
                                    roomCode: r.roomCode,
                                    userId,
                                    username,
                                  });
                                }}
                                className="rounded-md bg-[#E5A93B] px-3 py-1 text-xs font-semibold text-[#09090B] cursor-pointer shrink-0"
                              >
                                Play
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Nearby Wi-Fi Direct (WebRTC) & Bluetooth Setup */}
                {mode === 'p2p' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#111114] p-1 border border-[#27272A]">
                      <button
                        type="button"
                        onClick={() => setP2PTransport('wifi')}
                        className={`min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                          p2pTransport === 'wifi'
                            ? 'bg-[#18181B] text-[#E5A93B]'
                            : 'text-[#71717A] hover:text-[#D4D4D8]'
                        }`}
                      >
                        <Wifi className="h-3.5 w-3.5" />
                        <span>Wi-Fi / Hotspot</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setP2PTransport('bluetooth')}
                        className={`min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                          p2pTransport === 'bluetooth'
                            ? 'bg-[#18181B] text-[#E5A93B]'
                            : 'text-[#71717A] hover:text-[#D4D4D8]'
                        }`}
                      >
                        <Bluetooth className="h-3.5 w-3.5" />
                        <span>Bluetooth</span>
                      </button>
                    </div>

                    {p2pMessage && (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 leading-relaxed">
                        {p2pMessage}
                      </div>
                    )}

                    {p2pTransport === 'wifi' ? (
                      <div className="space-y-3 rounded-lg border border-[#27272A] bg-[#111114] p-3 text-xs">
                        <p className="text-[#D4D4D8] leading-relaxed">
                          Play directly over local Wi-Fi or mobile Hotspot without needing an online game room:
                        </p>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleHostWifiMatch()}
                            className="min-h-[38px] flex-1 rounded-lg bg-[#E5A93B] px-3 py-1.5 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
                          >
                            1. Host Match (White)
                          </button>
                          <button
                            type="button"
                            onClick={closeP2PConnections}
                            className="min-h-[38px] rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-1.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                          >
                            Reset
                          </button>
                        </div>

                        {p2pOfferCode && (
                          <div className="space-y-2 border-t border-[#27272A] pt-2.5">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-[#E5A93B]">
                                Share this Offer Code with friend:
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  void navigator.clipboard?.writeText(p2pOfferCode);
                                  setP2PCopied(true);
                                  window.setTimeout(() => setP2PCopied(false), 1800);
                                }}
                                className="inline-flex items-center gap-1 text-[#E5A93B] hover:underline cursor-pointer"
                              >
                                {p2pCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                <span>{p2pCopied ? 'Copied!' : 'Copy Offer'}</span>
                              </button>
                            </div>
                            <textarea
                              readOnly
                              rows={2}
                              value={p2pOfferCode}
                              className="w-full rounded border border-[#27272A] bg-[#09090B] p-2 font-mono text-[10px] text-[#A1A1AA]"
                            />
                            <p className="text-[#D4D4D8]">Paste friend&apos;s Answer Code below:</p>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={p2pRemoteCode}
                                onChange={(e) => setP2PRemoteCode(e.target.value)}
                                placeholder="Paste Answer Code..."
                                className="min-h-[38px] flex-1 min-w-0 rounded border border-[#27272A] bg-[#09090B] px-2.5 text-xs text-[#FAFAFA]"
                              />
                              <button
                                type="button"
                                onClick={() => void handleHostApplyAnswer()}
                                className="rounded bg-emerald-500 px-3 text-xs font-semibold text-[#09090B] cursor-pointer shrink-0"
                              >
                                Connect
                              </button>
                            </div>
                          </div>
                        )}

                        {!p2pOfferCode && (
                          <div className="space-y-2 border-t border-[#27272A] pt-2.5">
                            <p className="font-semibold text-[#D4D4D8]">Joining a Host (Black):</p>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={p2pRemoteCode}
                                onChange={(e) => setP2PRemoteCode(e.target.value)}
                                placeholder="Paste Host Offer Code..."
                                className="min-h-[38px] flex-1 min-w-0 rounded border border-[#27272A] bg-[#09090B] px-2.5 text-xs text-[#FAFAFA]"
                              />
                              <button
                                type="button"
                                onClick={() => void handleJoinWifiOffer()}
                                className="rounded border border-[#E5A93B] px-3 text-xs font-semibold text-[#E5A93B] cursor-pointer shrink-0"
                              >
                                Generate Reply
                              </button>
                            </div>

                            {p2pAnswerCode && (
                              <div className="space-y-1.5 pt-1">
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-emerald-400">
                                    Send this Answer Code back to Host:
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void navigator.clipboard?.writeText(p2pAnswerCode);
                                      setP2PCopied(true);
                                      window.setTimeout(() => setP2PCopied(false), 1800);
                                    }}
                                    className="inline-flex items-center gap-1 text-[#E5A93B] hover:underline cursor-pointer"
                                  >
                                    {p2pCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    <span>{p2pCopied ? 'Copied!' : 'Copy Reply'}</span>
                                  </button>
                                </div>
                                <textarea
                                  readOnly
                                  rows={2}
                                  value={p2pAnswerCode}
                                  className="w-full rounded border border-[#27272A] bg-[#09090B] p-2 font-mono text-[10px] text-[#A1A1AA]"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-lg border border-[#27272A] bg-[#111114] p-3 text-xs">
                        <p className="text-[#D4D4D8] leading-relaxed">
                          Pair via Web Bluetooth (BLE UART chess board/peer). Note: Browsers act as BLE Centrals; for direct phone-to-phone play, Wi-Fi / Hotspot Direct works across all mobile browsers.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleConnectBluetooth()}
                            className="min-h-[40px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#E5A93B] px-3 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
                          >
                            <Bluetooth className="h-3.5 w-3.5" />
                            <span>Scan Bluetooth Device</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setP2PTransport('wifi')}
                            className="min-h-[40px] rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#E5A93B] cursor-pointer"
                          >
                            Use Wi-Fi Direct
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {mode !== 'online' && mode !== 'p2p' && (
                  <p className="text-xs text-[#71717A] leading-relaxed">
                    {t('chessRuleHint')}
                  </p>
                )}

                {mode !== 'p2p' && (
                  <button
                    type="button"
                    disabled={mode === 'online' && !isWsConnected}
                    onClick={handleStartGame}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93B] px-5 py-3 text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-40 active:scale-[0.99] transition-all cursor-pointer"
                  >
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    <span>{mode === 'online' ? 'Create Online Room' : t('chessStartGame')}</span>
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Game Over Result Banner */}
                {phase === 'GAME_OVER' && (
                  <div className="rounded-lg border border-[#E5A93B]/50 bg-[#18181B] p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <Crown
                        className="h-5 w-5 text-[#E5A93B] shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <div>
                        <h3 className="font-display text-base font-bold text-[#FAFAFA]">
                          {outcome.headline}
                        </h3>
                        <p className="text-xs text-[#A1A1AA] mt-0.5">{outcome.detail}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={handleRematch}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#E5A93B] px-4 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{t('chessPlayAgain')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleResetToSetup}
                        className="inline-flex items-center justify-center rounded-lg border border-[#27272A] bg-[#09090B] px-4 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        {t('chessNewGame')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Action Bar during Active Play */}
                {phase === 'PLAYING' && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {mode !== 'online' && mode !== 'p2p' ? (
                      <button
                        type="button"
                        disabled={chessState.history.length === 0 || isBotThinking}
                        onClick={handleUndo}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] hover:border-[#3F3F46] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                        <span>{t('chessUndo')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setFlipped((prev) => !prev)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <ArrowUpDown className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                        <span>Flip</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!canHumanInteract}
                      onClick={handleShowHint}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] hover:border-[#3F3F46] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Lightbulb className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                      <span>{t('chessHint')}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isWaitingForOpponent}
                      onClick={handleResign}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs font-medium text-red-300 hover:border-red-500/50 disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('chessResign')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleResetToSetup}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors whitespace-nowrap cursor-pointer"
                    >
                      {mode === 'online' || mode === 'p2p' ? (
                        <>
                          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Leave</span>
                        </>
                      ) : (
                        <span>{t('chessNewGame')}</span>
                      )}
                    </button>
                  </div>
                )}

                {/* Algebraic Notation Move History */}
                <div className="rounded-lg border border-[#27272A] bg-[#09090B] overflow-hidden">
                  <div className="flex items-center justify-between border-b border-[#27272A] px-4 py-2.5">
                    <span className="text-xs font-semibold text-[#FAFAFA]">
                      {t('chessMovesLabel')}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[#71717A]">
                      {chessState.history.length} plies
                    </span>
                  </div>

                  <div
                    ref={moveListRef}
                    className="h-64 overflow-y-auto px-4 py-3 text-xs font-mono tabular-nums"
                  >
                    {movePairs.length === 0 ? (
                      <p className="font-sans text-xs text-[#71717A] py-6 text-center">
                        {t('chessNoMovesYet')}
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {movePairs.map((pair) => (
                          <div
                            key={pair.moveNumber}
                            className="grid grid-cols-12 items-center rounded px-2 py-1 odd:bg-[#111114]/70"
                          >
                            <span className="col-span-2 text-[#71717A]">
                              {pair.moveNumber}.
                            </span>
                            <span className="col-span-5 text-[#FAFAFA] font-medium">
                              {pair.white ?? ''}
                            </span>
                            <span className="col-span-5 text-[#D4D4D8]">
                              {pair.black ?? ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
