export type PieceColor = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionType = 'q' | 'r' | 'b' | 'n';

export interface ChessPiece {
  color: PieceColor;
  type: PieceType;
}

export type BoardSquare = ChessPiece | null;
export type BoardGrid = BoardSquare[][]; // [row 0..7 (rank 8..1)][col 0..7 (file a..h)]

export interface CastlingRights {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

export interface Coord {
  row: number;
  col: number;
}

export interface ChessMove {
  from: Coord;
  to: Coord;
  piece: ChessPiece;
  captured?: ChessPiece;
  promotion?: PromotionType;
  isCastle?: 'K' | 'Q';
  isEnPassant?: boolean;
  san: string;
}

export interface ChessState {
  board: BoardGrid;
  turn: PieceColor;
  castling: CastlingRights;
  enPassant: Coord | null;
  halfmoveClock: number;
  fullmoveNumber: number;
  history: ChessMove[];
  positionCounts: Record<string, number>;
  status:
    | 'playing'
    | 'checkmate'
    | 'stalemate'
    | 'draw_repetition'
    | 'draw_fifty'
    | 'draw_material';
  winner: PieceColor | null;
  inCheck: PieceColor | null;
  lastMove: { from: Coord; to: Coord } | null;
}

export type BotDifficulty = 'casual' | 'club' | 'master';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export const PIECE_VALUES: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-square tables from White's perspective (row 0 = rank 8, row 7 = rank 1)
const PAWN_PST = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5, 5, 10, 25, 25, 10, 5, 5],
  [0, 0, 0, 22, 22, 0, 0, 0],
  [5, -5, -10, 0, 0, -10, -5, 5],
  [5, 10, 10, -20, -20, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

const KNIGHT_PST = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 0, 0, 0, -20, -40],
  [-30, 0, 10, 15, 15, 10, 0, -30],
  [-30, 5, 15, 20, 20, 15, 5, -30],
  [-30, 0, 15, 20, 20, 15, 0, -30],
  [-30, 5, 10, 15, 15, 10, 5, -30],
  [-40, -20, 0, 5, 5, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50],
];

const BISHOP_PST = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 10, 10, 5, 0, -10],
  [-10, 5, 5, 10, 10, 5, 5, -10],
  [-10, 0, 10, 10, 10, 10, 0, -10],
  [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 5, 0, 0, 0, 0, 5, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20],
];

const ROOK_PST = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [5, 10, 10, 10, 10, 10, 10, 5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [0, 0, 0, 5, 5, 0, 0, 0],
];

const QUEEN_PST = [
  [-20, -10, -10, -5, -5, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 5, 5, 5, 0, -10],
  [-5, 0, 5, 5, 5, 5, 0, -5],
  [0, 0, 5, 5, 5, 5, 0, -5],
  [-10, 5, 5, 5, 5, 5, 0, -10],
  [-10, 0, 5, 0, 0, 0, 0, -10],
  [-20, -10, -10, -5, -5, -10, -10, -20],
];

const KING_PST = [
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-10, -20, -20, -20, -20, -20, -20, -10],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [20, 30, 10, 0, 0, 10, 30, 20],
];

const PST_MAP: Record<PieceType, number[][]> = {
  p: PAWN_PST,
  n: KNIGHT_PST,
  b: BISHOP_PST,
  r: ROOK_PST,
  q: QUEEN_PST,
  k: KING_PST,
};

export function coordToAlgebraic(c: Coord): string {
  return `${FILES[c.col]}${8 - c.row}`;
}

export function cloneBoard(board: BoardGrid): BoardGrid {
  return board.map((row) => row.map((sq) => (sq ? { ...sq } : null)));
}

function opposite(color: PieceColor): PieceColor {
  return color === 'w' ? 'b' : 'w';
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function serializePosition(
  board: BoardGrid,
  turn: PieceColor,
  castling: CastlingRights,
  enPassant: Coord | null
): string {
  const rows = board
    .map((row) =>
      row.map((sq) => (sq ? `${sq.color}${sq.type}` : '..')).join('')
    )
    .join('/');
  const cr = `${castling.wK ? 'K' : ''}${castling.wQ ? 'Q' : ''}${
    castling.bK ? 'k' : ''
  }${castling.bQ ? 'q' : ''}`;
  const ep = enPassant ? coordToAlgebraic(enPassant) : '-';
  return `${rows}|${turn}|${cr}|${ep}`;
}

export function createInitialChessState(): ChessState {
  const backRank: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  const board: BoardGrid = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null)
  );

  for (let c = 0; c < 8; c++) {
    board[0][c] = { color: 'b', type: backRank[c] };
    board[1][c] = { color: 'b', type: 'p' };
    board[6][c] = { color: 'w', type: 'p' };
    board[7][c] = { color: 'w', type: backRank[c] };
  }

  const castling: CastlingRights = { wK: true, wQ: true, bK: true, bQ: true };
  const initialKey = serializePosition(board, 'w', castling, null);

  return {
    board,
    turn: 'w',
    castling,
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    history: [],
    positionCounts: { [initialKey]: 1 },
    status: 'playing',
    winner: null,
    inCheck: null,
    lastMove: null,
  };
}

export function findKing(board: BoardGrid, color: PieceColor): Coord | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (sq && sq.color === color && sq.type === 'k') {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

export function isSquareAttacked(
  board: BoardGrid,
  targetRow: number,
  targetCol: number,
  byColor: PieceColor
): boolean {
  // Pawn attacks
  const pawnSourceRow = byColor === 'w' ? targetRow + 1 : targetRow - 1;
  if (pawnSourceRow >= 0 && pawnSourceRow < 8) {
    for (const dc of [-1, 1]) {
      const pc = targetCol + dc;
      if (pc >= 0 && pc < 8) {
        const sq = board[pawnSourceRow][pc];
        if (sq && sq.color === byColor && sq.type === 'p') return true;
      }
    }
  }

  // Knight attacks
  const knightDeltas = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
  ];
  for (const [dr, dc] of knightDeltas) {
    const nr = targetRow + dr;
    const nc = targetCol + dc;
    if (inBounds(nr, nc)) {
      const sq = board[nr][nc];
      if (sq && sq.color === byColor && sq.type === 'n') return true;
    }
  }

  // King attacks
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const kr = targetRow + dr;
      const kc = targetCol + dc;
      if (inBounds(kr, kc)) {
        const sq = board[kr][kc];
        if (sq && sq.color === byColor && sq.type === 'k') return true;
      }
    }
  }

  // Orthogonal rays (Rook / Queen)
  const orthoDirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [dr, dc] of orthoDirs) {
    let r = targetRow + dr;
    let c = targetCol + dc;
    while (inBounds(r, c)) {
      const sq = board[r][c];
      if (sq) {
        if (sq.color === byColor && (sq.type === 'r' || sq.type === 'q')) {
          return true;
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }

  // Diagonal rays (Bishop / Queen)
  const diagDirs = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];
  for (const [dr, dc] of diagDirs) {
    let r = targetRow + dr;
    let c = targetCol + dc;
    while (inBounds(r, c)) {
      const sq = board[r][c];
      if (sq) {
        if (sq.color === byColor && (sq.type === 'b' || sq.type === 'q')) {
          return true;
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }

  return false;
}

export function isInCheck(board: BoardGrid, color: PieceColor): boolean {
  const king = findKing(board, color);
  if (!king) return false;
  return isSquareAttacked(board, king.row, king.col, opposite(color));
}

interface RawMove {
  from: Coord;
  to: Coord;
  piece: ChessPiece;
  captured?: ChessPiece;
  promotion?: PromotionType;
  isCastle?: 'K' | 'Q';
  isEnPassant?: boolean;
}

function generatePseudoMoves(
  board: BoardGrid,
  turn: PieceColor,
  castling: CastlingRights,
  enPassant: Coord | null
): RawMove[] {
  const moves: RawMove[] = [];
  const enemy = opposite(turn);

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== turn) continue;

      if (piece.type === 'p') {
        const dir = turn === 'w' ? -1 : 1;
        const startRow = turn === 'w' ? 6 : 1;
        const promoRow = turn === 'w' ? 0 : 7;

        const oneStep = r + dir;
        if (inBounds(oneStep, c) && !board[oneStep][c]) {
          if (oneStep === promoRow) {
            for (const promo of ['q', 'r', 'b', 'n'] as PromotionType[]) {
              moves.push({
                from: { row: r, col: c },
                to: { row: oneStep, col: c },
                piece,
                promotion: promo,
              });
            }
          } else {
            moves.push({
              from: { row: r, col: c },
              to: { row: oneStep, col: c },
              piece,
            });
            const twoStep = r + dir * 2;
            if (r === startRow && inBounds(twoStep, c) && !board[twoStep][c]) {
              moves.push({
                from: { row: r, col: c },
                to: { row: twoStep, col: c },
                piece,
              });
            }
          }
        }

        // Diagonal captures & en passant
        for (const dc of [-1, 1]) {
          const tc = c + dc;
          if (!inBounds(oneStep, tc)) continue;
          const target = board[oneStep][tc];
          if (target && target.color === enemy) {
            if (oneStep === promoRow) {
              for (const promo of ['q', 'r', 'b', 'n'] as PromotionType[]) {
                moves.push({
                  from: { row: r, col: c },
                  to: { row: oneStep, col: tc },
                  piece,
                  captured: target,
                  promotion: promo,
                });
              }
            } else {
              moves.push({
                from: { row: r, col: c },
                to: { row: oneStep, col: tc },
                piece,
                captured: target,
              });
            }
          } else if (
            enPassant &&
            enPassant.row === oneStep &&
            enPassant.col === tc
          ) {
            const epCaptured = board[r][tc];
            if (epCaptured && epCaptured.color === enemy && epCaptured.type === 'p') {
              moves.push({
                from: { row: r, col: c },
                to: { row: oneStep, col: tc },
                piece,
                captured: epCaptured,
                isEnPassant: true,
              });
            }
          }
        }
      } else if (piece.type === 'n') {
        const deltas = [
          [-2, -1],
          [-2, 1],
          [-1, -2],
          [-1, 2],
          [1, -2],
          [1, 2],
          [2, -1],
          [2, 1],
        ];
        for (const [dr, dc] of deltas) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          const target = board[nr][nc];
          if (!target || target.color === enemy) {
            moves.push({
              from: { row: r, col: c },
              to: { row: nr, col: nc },
              piece,
              captured: target || undefined,
            });
          }
        }
      } else if (
        piece.type === 'b' ||
        piece.type === 'r' ||
        piece.type === 'q'
      ) {
        const dirs: number[][] = [];
        if (piece.type === 'b' || piece.type === 'q') {
          dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
        }
        if (piece.type === 'r' || piece.type === 'q') {
          dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
        }
        for (const [dr, dc] of dirs) {
          let nr = r + dr;
          let nc = c + dc;
          while (inBounds(nr, nc)) {
            const target = board[nr][nc];
            if (!target) {
              moves.push({
                from: { row: r, col: c },
                to: { row: nr, col: nc },
                piece,
              });
            } else {
              if (target.color === enemy) {
                moves.push({
                  from: { row: r, col: c },
                  to: { row: nr, col: nc },
                  piece,
                  captured: target,
                });
              }
              break;
            }
            nr += dr;
            nc += dc;
          }
        }
      } else if (piece.type === 'k') {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (!inBounds(nr, nc)) continue;
            const target = board[nr][nc];
            if (!target || target.color === enemy) {
              moves.push({
                from: { row: r, col: c },
                to: { row: nr, col: nc },
                piece,
                captured: target || undefined,
              });
            }
          }
        }

        // Castling
        const homeRow = turn === 'w' ? 7 : 0;
        if (r === homeRow && c === 4 && !isSquareAttacked(board, homeRow, 4, enemy)) {
          const canKingside = turn === 'w' ? castling.wK : castling.bK;
          const canQueenside = turn === 'w' ? castling.wQ : castling.bQ;

          if (
            canKingside &&
            !board[homeRow][5] &&
            !board[homeRow][6] &&
            board[homeRow][7]?.color === turn &&
            board[homeRow][7]?.type === 'r' &&
            !isSquareAttacked(board, homeRow, 5, enemy) &&
            !isSquareAttacked(board, homeRow, 6, enemy)
          ) {
            moves.push({
              from: { row: homeRow, col: 4 },
              to: { row: homeRow, col: 6 },
              piece,
              isCastle: 'K',
            });
          }

          if (
            canQueenside &&
            !board[homeRow][3] &&
            !board[homeRow][2] &&
            !board[homeRow][1] &&
            board[homeRow][0]?.color === turn &&
            board[homeRow][0]?.type === 'r' &&
            !isSquareAttacked(board, homeRow, 3, enemy) &&
            !isSquareAttacked(board, homeRow, 2, enemy)
          ) {
            moves.push({
              from: { row: homeRow, col: 4 },
              to: { row: homeRow, col: 2 },
              piece,
              isCastle: 'Q',
            });
          }
        }
      }
    }
  }

  return moves;
}

function applyMoveToBoard(board: BoardGrid, move: RawMove): BoardGrid {
  const next = cloneBoard(board);
  next[move.from.row][move.from.col] = null;

  if (move.isEnPassant) {
    next[move.from.row][move.to.col] = null;
  }

  if (move.isCastle === 'K') {
    const r = move.from.row;
    next[r][5] = next[r][7];
    next[r][7] = null;
  } else if (move.isCastle === 'Q') {
    const r = move.from.row;
    next[r][3] = next[r][0];
    next[r][0] = null;
  }

  next[move.to.row][move.to.col] = move.promotion
    ? { color: move.piece.color, type: move.promotion }
    : { ...move.piece };

  return next;
}

function updateCastlingRights(
  castling: CastlingRights,
  move: RawMove
): CastlingRights {
  const next = { ...castling };
  const { from, to, piece } = move;

  if (piece.type === 'k') {
    if (piece.color === 'w') {
      next.wK = false;
      next.wQ = false;
    } else {
      next.bK = false;
      next.bQ = false;
    }
  }

  if (piece.type === 'r') {
    if (from.row === 7 && from.col === 7) next.wK = false;
    if (from.row === 7 && from.col === 0) next.wQ = false;
    if (from.row === 0 && from.col === 7) next.bK = false;
    if (from.row === 0 && from.col === 0) next.bQ = false;
  }

  if (to.row === 7 && to.col === 7) next.wK = false;
  if (to.row === 7 && to.col === 0) next.wQ = false;
  if (to.row === 0 && to.col === 7) next.bK = false;
  if (to.row === 0 && to.col === 0) next.bQ = false;

  return next;
}

export function getLegalMovesForState(
  board: BoardGrid,
  turn: PieceColor,
  castling: CastlingRights,
  enPassant: Coord | null,
  includeSan = true
): ChessMove[] {
  const pseudo = generatePseudoMoves(board, turn, castling, enPassant);
  const legalRaw: Array<{ raw: RawMove; nextBoard: BoardGrid }> = [];

  for (const raw of pseudo) {
    const nextBoard = applyMoveToBoard(board, raw);
    if (!isInCheck(nextBoard, turn)) {
      legalRaw.push({ raw, nextBoard });
    }
  }

  if (!includeSan) {
    return legalRaw.map(({ raw }) => ({
      ...raw,
      san: '',
    }));
  }

  const enemy = opposite(turn);

  return legalRaw.map(({ raw, nextBoard }) => {
    let baseSan = '';

    if (raw.isCastle === 'K') {
      baseSan = 'O-O';
    } else if (raw.isCastle === 'Q') {
      baseSan = 'O-O-O';
    } else if (raw.piece.type === 'p') {
      const dest = coordToAlgebraic(raw.to);
      if (raw.captured) {
        baseSan = `${FILES[raw.from.col]}x${dest}`;
      } else {
        baseSan = dest;
      }
      if (raw.promotion) {
        baseSan += `=${raw.promotion.toUpperCase()}`;
      }
    } else {
      const pieceLetter = raw.piece.type.toUpperCase();
      const others = legalRaw.filter(
        ({ raw: other }) =>
          other !== raw &&
          other.piece.type === raw.piece.type &&
          other.to.row === raw.to.row &&
          other.to.col === raw.to.col
      );
      let disambig = '';
      if (others.length > 0) {
        const sameFile = others.some((o) => o.raw.from.col === raw.from.col);
        const sameRank = others.some((o) => o.raw.from.row === raw.from.row);
        if (!sameFile) {
          disambig = FILES[raw.from.col];
        } else if (!sameRank) {
          disambig = String(8 - raw.from.row);
        } else {
          disambig = coordToAlgebraic(raw.from);
        }
      }
      const captureMark = raw.captured ? 'x' : '';
      baseSan = `${pieceLetter}${disambig}${captureMark}${coordToAlgebraic(raw.to)}`;
    }

    // Check / Checkmate suffix
    const enemyInCheck = isInCheck(nextBoard, enemy);
    if (enemyInCheck) {
      const nextCastling = updateCastlingRights(castling, raw);
      const nextEp =
        raw.piece.type === 'p' && Math.abs(raw.to.row - raw.from.row) === 2
          ? { row: (raw.from.row + raw.to.row) / 2, col: raw.from.col }
          : null;
      const enemyPseudo = generatePseudoMoves(nextBoard, enemy, nextCastling, nextEp);
      const hasReply = enemyPseudo.some((reply) => {
        const b2 = applyMoveToBoard(nextBoard, reply);
        return !isInCheck(b2, enemy);
      });
      baseSan += hasReply ? '+' : '#';
    }

    return {
      ...raw,
      san: baseSan,
    };
  });
}

function hasInsufficientMaterial(board: BoardGrid): boolean {
  const pieces: Array<{ color: PieceColor; type: PieceType; row: number; col: number }> = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (sq && sq.type !== 'k') {
        pieces.push({ color: sq.color, type: sq.type, row: r, col: c });
      }
    }
  }
  if (pieces.length === 0) return true; // K vs K
  if (pieces.length === 1) {
    return pieces[0].type === 'n' || pieces[0].type === 'b'; // K+N or K+B vs K
  }
  if (
    pieces.length === 2 &&
    pieces[0].type === 'b' &&
    pieces[1].type === 'b' &&
    pieces[0].color !== pieces[1].color
  ) {
    const color0 = (pieces[0].row + pieces[0].col) % 2;
    const color1 = (pieces[1].row + pieces[1].col) % 2;
    return color0 === color1; // Bishops on same color square
  }
  return false;
}

export function applyChessMove(state: ChessState, move: ChessMove): ChessState {
  const nextBoard = applyMoveToBoard(state.board, move);
  const nextTurn = opposite(state.turn);
  const nextCastling = updateCastlingRights(state.castling, move);
  const nextEnPassant =
    move.piece.type === 'p' && Math.abs(move.to.row - move.from.row) === 2
      ? { row: (move.from.row + move.to.row) / 2, col: move.from.col }
      : null;

  const nextHalfmove =
    move.piece.type === 'p' || move.captured ? 0 : state.halfmoveClock + 1;
  const nextFullmove =
    state.turn === 'b' ? state.fullmoveNumber + 1 : state.fullmoveNumber;

  const posKey = serializePosition(nextBoard, nextTurn, nextCastling, nextEnPassant);
  const nextCounts = {
    ...state.positionCounts,
    [posKey]: (state.positionCounts[posKey] || 0) + 1,
  };

  const nextLegal = getLegalMovesForState(
    nextBoard,
    nextTurn,
    nextCastling,
    nextEnPassant,
    false
  );
  const nextInCheck = isInCheck(nextBoard, nextTurn) ? nextTurn : null;

  let status: ChessState['status'] = 'playing';
  let winner: PieceColor | null = null;

  if (nextLegal.length === 0) {
    if (nextInCheck) {
      status = 'checkmate';
      winner = state.turn;
    } else {
      status = 'stalemate';
    }
  } else if (hasInsufficientMaterial(nextBoard)) {
    status = 'draw_material';
  } else if (nextCounts[posKey] >= 3) {
    status = 'draw_repetition';
  } else if (nextHalfmove >= 100) {
    status = 'draw_fifty';
  }

  return {
    board: nextBoard,
    turn: nextTurn,
    castling: nextCastling,
    enPassant: nextEnPassant,
    halfmoveClock: nextHalfmove,
    fullmoveNumber: nextFullmove,
    history: [...state.history, move],
    positionCounts: nextCounts,
    status,
    winner,
    inCheck: nextInCheck,
    lastMove: { from: move.from, to: move.to },
  };
}

export function replayMoves(moves: ChessMove[]): ChessState {
  let state = createInitialChessState();
  for (const m of moves) {
    state = applyChessMove(state, m);
  }
  return state;
}

// Fast heuristic evaluation from White's perspective (+ = White ahead, - = Black ahead)
function evaluateBoard(board: BoardGrid): number {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (!sq) continue;
      const pstRow = sq.color === 'w' ? r : 7 - r;
      const val = PIECE_VALUES[sq.type] + PST_MAP[sq.type][pstRow][c];
      score += sq.color === 'w' ? val : -val;
    }
  }
  return score;
}

function orderMoves(moves: RawMove[]): RawMove[] {
  return [...moves].sort((a, b) => {
    const scoreA =
      (a.captured ? PIECE_VALUES[a.captured.type] * 10 - PIECE_VALUES[a.piece.type] : 0) +
      (a.promotion ? PIECE_VALUES[a.promotion] : 0) +
      (a.isCastle ? 60 : 0);
    const scoreB =
      (b.captured ? PIECE_VALUES[b.captured.type] * 10 - PIECE_VALUES[b.piece.type] : 0) +
      (b.promotion ? PIECE_VALUES[b.promotion] : 0) +
      (b.isCastle ? 60 : 0);
    return scoreB - scoreA;
  });
}

function alphaBeta(
  board: BoardGrid,
  turn: PieceColor,
  castling: CastlingRights,
  enPassant: Coord | null,
  depth: number,
  alpha: number,
  beta: number
): number {
  const pseudo = generatePseudoMoves(board, turn, castling, enPassant);
  const ordered = orderMoves(pseudo);

  const legalMoves: Array<{ raw: RawMove; nextBoard: BoardGrid }> = [];
  for (const raw of ordered) {
    const nextBoard = applyMoveToBoard(board, raw);
    if (!isInCheck(nextBoard, turn)) {
      legalMoves.push({ raw, nextBoard });
    }
  }

  if (legalMoves.length === 0) {
    if (isInCheck(board, turn)) {
      // Prefer faster checkmate
      return turn === 'w' ? -99000 - depth * 100 : 99000 + depth * 100;
    }
    return 0; // Stalemate
  }

  if (depth === 0) {
    return evaluateBoard(board);
  }

  const nextTurn = opposite(turn);

  if (turn === 'w') {
    let maxEval = -Infinity;
    for (const { raw, nextBoard } of legalMoves) {
      const nextCastling = updateCastlingRights(castling, raw);
      const nextEp =
        raw.piece.type === 'p' && Math.abs(raw.to.row - raw.from.row) === 2
          ? { row: (raw.from.row + raw.to.row) / 2, col: raw.from.col }
          : null;
      const ev = alphaBeta(
        nextBoard,
        nextTurn,
        nextCastling,
        nextEp,
        depth - 1,
        alpha,
        beta
      );
      if (ev > maxEval) maxEval = ev;
      if (ev > alpha) alpha = ev;
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const { raw, nextBoard } of legalMoves) {
      const nextCastling = updateCastlingRights(castling, raw);
      const nextEp =
        raw.piece.type === 'p' && Math.abs(raw.to.row - raw.from.row) === 2
          ? { row: (raw.from.row + raw.to.row) / 2, col: raw.from.col }
          : null;
      const ev = alphaBeta(
        nextBoard,
        nextTurn,
        nextCastling,
        nextEp,
        depth - 1,
        alpha,
        beta
      );
      if (ev < minEval) minEval = ev;
      if (ev < beta) beta = ev;
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

export function chooseBestMove(
  state: ChessState,
  difficulty: BotDifficulty
): ChessMove | null {
  const legalMoves = getLegalMovesForState(
    state.board,
    state.turn,
    state.castling,
    state.enPassant,
    true
  );
  if (legalMoves.length === 0) return null;

  const searchDepth =
    difficulty === 'master' ? 2 : difficulty === 'club' ? 1 : 0;
  const maximizing = state.turn === 'w';
  const nextTurn = opposite(state.turn);

  const scored = legalMoves.map((move) => {
    const nextBoard = applyMoveToBoard(state.board, move);
    const nextCastling = updateCastlingRights(state.castling, move);
    const nextEp =
      move.piece.type === 'p' && Math.abs(move.to.row - move.from.row) === 2
        ? { row: (move.from.row + move.to.row) / 2, col: move.from.col }
        : null;

    let score = alphaBeta(
      nextBoard,
      nextTurn,
      nextCastling,
      nextEp,
      searchDepth,
      -Infinity,
      Infinity
    );

    if (difficulty === 'casual') {
      score += (Math.random() - 0.5) * 90;
    } else if (difficulty === 'club') {
      score += (Math.random() - 0.5) * 18;
    }

    return { move, score };
  });

  scored.sort((a, b) => (maximizing ? b.score - a.score : a.score - b.score));
  return scored[0]?.move ?? null;
}

export function getCapturedPieces(history: ChessMove[]): {
  capturedByWhite: ChessPiece[];
  capturedByBlack: ChessPiece[];
  materialAdvantage: number; // + favors White, - favors Black
} {
  const capturedByWhite: ChessPiece[] = [];
  const capturedByBlack: ChessPiece[] = [];
  let whiteSum = 0;
  let blackSum = 0;

  for (const m of history) {
    if (m.captured) {
      if (m.piece.color === 'w') {
        capturedByWhite.push(m.captured);
        whiteSum += PIECE_VALUES[m.captured.type] / 100;
      } else {
        capturedByBlack.push(m.captured);
        blackSum += PIECE_VALUES[m.captured.type] / 100;
      }
    }
  }

  const sortOrder: Record<PieceType, number> = { q: 0, r: 1, b: 2, n: 3, p: 4, k: 5 };
  capturedByWhite.sort((a, b) => sortOrder[a.type] - sortOrder[b.type]);
  capturedByBlack.sort((a, b) => sortOrder[a.type] - sortOrder[b.type]);

  return {
    capturedByWhite,
    capturedByBlack,
    materialAdvantage: Math.round(whiteSum - blackSum),
  };
}
