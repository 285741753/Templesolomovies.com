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
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { ChessPieceSvg } from './ChessPieceSvg';
import { playChessSound } from '../utils/chessAudio';
import {
  applyChessMove,
  chooseBestMove,
  coordToAlgebraic,
  createInitialChessState,
  getCapturedPieces,
  getLegalMovesForState,
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
type GameMode = 'bot' | 'local';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

const PIECE_NAMES: Record<PieceType, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

function sameCoord(a: Coord | null | undefined, b: Coord | null | undefined): boolean {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

export function ChessLounge() {
  const { t } = useLanguage();

  const [phase, setPhase] = useState<GamePhase>('TITLE_MENU');
  const [mode, setMode] = useState<GameMode>('bot');
  const [difficulty, setDifficulty] = useState<BotDifficulty>('club');
  const [humanColor, setHumanColor] = useState<PieceColor>('w');
  const [flipped, setFlipped] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [chessState, setChessState] = useState<ChessState>(() =>
    createInitialChessState()
  );
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

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  useEffect(() => {
    if (moveListRef.current) {
      moveListRef.current.scrollTop = moveListRef.current.scrollHeight;
    }
  }, [chessState.history.length]);

  const legalMoves = useMemo(() => {
    if (phase !== 'PLAYING' || chessState.status !== 'playing' || resignedBy) {
      return [];
    }
    return getLegalMovesForState(
      chessState.board,
      chessState.turn,
      chessState.castling,
      chessState.enPassant,
      true
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

  const executeMove = useCallback(
    (move: ChessMove) => {
      setSelectedSquare(null);
      setPendingPromotion(null);
      setHintMove(null);

      const nextState = applyChessMove(chessState, move);
      setChessState(nextState);

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
    [chessState, soundEnabled]
  );

  // Trigger AI Bot turn cleanly when playing vs Bot
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
    const delayMs = difficulty === 'master' ? 650 : 520;
    botTimerRef.current = window.setTimeout(() => {
      botTimerRef.current = null;
      const best = chooseBestMove(chessState, difficulty);
      setIsBotThinking(false);
      if (best) {
        executeMove(best);
      }
    }, delayMs);

    return () => {
      if (botTimerRef.current !== null) {
        window.clearTimeout(botTimerRef.current);
        botTimerRef.current = null;
      }
    };
  }, [phase, mode, chessState, humanColor, difficulty, resignedBy, executeMove]);

  const handleStartGame = () => {
    clearTimers();
    setChessState(createInitialChessState());
    setResignedBy(null);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setHintMove(null);
    setIsBotThinking(false);
    setFlipped(mode === 'bot' && humanColor === 'b');
    setPhase('PLAYING');
  };

  const handleResetToSetup = () => {
    clearTimers();
    setChessState(createInitialChessState());
    setResignedBy(null);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setHintMove(null);
    setIsBotThinking(false);
    setPhase('TITLE_MENU');
  };

  const canHumanInteract =
    phase === 'PLAYING' &&
    chessState.status === 'playing' &&
    !resignedBy &&
    !isBotThinking &&
    !pendingPromotion &&
    (mode === 'local' || chessState.turn === humanColor);

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

    executeMove(candidates[0]);
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
    if (phase !== 'PLAYING' && phase !== 'GAME_OVER') return;
    if (chessState.history.length === 0 || isBotThinking) return;
    clearTimers();
    setResignedBy(null);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setHintMove(null);

    let pliesToUndo = 1;
    if (mode === 'bot') {
      // Undo back to the human's turn
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
    const losingColor = mode === 'bot' ? humanColor : chessState.turn;
    setResignedBy(losingColor);
    playChessSound('gameover', soundEnabled);
    setPhase('GAME_OVER');
  };

  const topColor: PieceColor = flipped ? 'w' : 'b';
  const bottomColor: PieceColor = flipped ? 'b' : 'w';

  const getPlayerLabel = (color: PieceColor) => {
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
    if (isBotThinking) return t('chessBotThinking');
    if (mode === 'bot' && chessState.turn === humanColor) {
      return `${t('chessYourTurn')} (${chessState.turn === 'w' ? t('chessWhite') : t('chessBlack')})`;
    }
    return chessState.turn === 'w' ? t('chessWhiteToMove') : t('chessBlackToMove');
  }, [phase, isBotThinking, mode, chessState.turn, humanColor, t]);

  const outcome = getOutcomeSummary();

  return (
    <section
      id="chess-game"
      aria-labelledby="chess-heading"
      className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 pb-12"
    >
      <div className="rounded-xl border border-[#27272A] bg-[#111114] p-5 sm:p-7">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#27272A] pb-5 mb-6">
          <div>
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
              <span>{t('chessFlip')}</span>
            </button>
          </div>
        </div>

        {/* Main 2-Column Arena: 8x8 Board + HUD / Setup / History */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Player Bars + 8x8 Chessboard */}
          <div className="lg:col-span-7 flex flex-col items-center">
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
                          className={`relative flex items-center justify-center transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#E5A93B] ${squareBg} ${
                            canHumanInteract ? 'cursor-pointer' : 'cursor-default'
                          }`}
                        >
                          {/* Rank coordinate on leftmost column */}
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

                          {/* File coordinate on bottommost row */}
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

                          {/* Check halo on checked King */}
                          {isKingInCheck && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,rgba(220,38,38,0.65)_0%,rgba(220,38,38,0.18)_62%,transparent_76%)]"
                            />
                          )}

                          {/* Chess Piece */}
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
                              className="relative z-10 w-[82%] h-[82%] transition-transform duration-150"
                            >
                              <ChessPieceSvg color={sqPiece.color} type={sqPiece.type} />
                            </div>
                          )}

                          {/* Legal Move Affordance */}
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
                              onClick={() => executeMove(match)}
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
          <div className="lg:col-span-5 flex flex-col gap-5">
            {/* Live Turn & Check Status Header */}
            <div className="rounded-lg border border-[#27272A] bg-[#09090B] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-[#71717A] mb-0.5">Match Status</p>
                  <p className="font-display text-base font-semibold text-[#FAFAFA]">
                    {turnStatusText}
                  </p>
                </div>
                <div className="text-right font-mono tabular-nums">
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
            </div>

            {phase === 'TITLE_MENU' ? (
              <div className="rounded-lg border border-[#27272A] bg-[#09090B] p-5 space-y-5">
                {/* Mode Selector */}
                <div>
                  <p className="text-xs font-medium text-[#A1A1AA] mb-2">Game Mode</p>
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#111114] p-1 border border-[#27272A]">
                    <button
                      type="button"
                      onClick={() => setMode('bot')}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        mode === 'bot'
                          ? 'bg-[#18181B] text-[#FAFAFA] shadow-sm'
                          : 'text-[#71717A] hover:text-[#D4D4D8]'
                      }`}
                    >
                      <Bot className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                      <span>{t('chessVsBot')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('local')}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        mode === 'local'
                          ? 'bg-[#18181B] text-[#FAFAFA] shadow-sm'
                          : 'text-[#71717A] hover:text-[#D4D4D8]'
                      }`}
                    >
                      <Users className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                      <span>{t('chessPassAndPlay')}</span>
                    </button>
                  </div>
                </div>

                {/* Bot Difficulty + Side Picker */}
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
                            className={`rounded-md px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
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
                          className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
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
                          className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
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

                <p className="text-xs text-[#71717A] leading-relaxed">
                  {t('chessRuleHint')}
                </p>

                <button
                  type="button"
                  onClick={handleStartGame}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93B] px-5 py-3 text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.99] transition-all cursor-pointer"
                >
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  <span>{t('chessStartGame')}</span>
                </button>
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
                        onClick={handleStartGame}
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
                    <button
                      type="button"
                      disabled={chessState.history.length === 0 || isBotThinking}
                      onClick={handleUndo}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] hover:border-[#3F3F46] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                      <span>{t('chessUndo')}</span>
                    </button>

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
                      onClick={handleResign}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs font-medium text-red-300 hover:border-red-500/50 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('chessResign')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleResetToSetup}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <span>{t('chessNewGame')}</span>
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
