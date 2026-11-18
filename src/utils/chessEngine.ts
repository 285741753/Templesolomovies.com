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

export function computeMoveSan(state: ChessState, move: ChessMove): string {
  if (move.san) return move.san;
  const allLegal = getLegalMovesForState(
    state.board,
    state.turn,
    state.castling,
    state.enPassant,
    false
  );
  const nextBoard = applyMoveToBoard(state.board, move);
  const enemy = opposite(state.turn);
  let baseSan = '';

  if (move.isCastle === 'K') {
    baseSan = 'O-O';
  } else if (move.isCastle === 'Q') {
    baseSan = 'O-O-O';
  } else if (move.piece.type === 'p') {
    const dest = coordToAlgebraic(move.to);
    baseSan = move.captured ? `${FILES[move.from.col]}x${dest}` : dest;
    if (move.promotion) {
      baseSan += `=${move.promotion.toUpperCase()}`;
    }
  } else {
    const pieceLetter = move.piece.type.toUpperCase();
    const others = allLegal.filter(
      (other) =>
        (other.from.row !== move.from.row || other.from.col !== move.from.col) &&
        other.piece.type === move.piece.type &&
        other.to.row === move.to.row &&
        other.to.col === move.to.col
    );
    let disambig = '';
    if (others.length > 0) {
      const sameFile = others.some((o) => o.from.col === move.from.col);
      const sameRank = others.some((o) => o.from.row === move.from.row);
      if (!sameFile) {
        disambig = FILES[move.from.col];
      } else if (!sameRank) {
        disambig = String(8 - move.from.row);
      } else {
        disambig = coordToAlgebraic(move.from);
      }
    }
    const captureMark = move.captured ? 'x' : '';
    baseSan = `${pieceLetter}${disambig}${captureMark}${coordToAlgebraic(move.to)}`;
  }

  if (isInCheck(nextBoard, enemy)) {
    const nextCastling = updateCastlingRights(state.castling, move);
    const nextEp =
      move.piece.type === 'p' && Math.abs(move.to.row - move.from.row) === 2
        ? { row: (move.from.row + move.to.row) / 2, col: move.from.col }
        : null;
    const enemyPseudo = generatePseudoMoves(nextBoard, enemy, nextCastling, nextEp);
    const hasReply = enemyPseudo.some((reply) => !isInCheck(applyMoveToBoard(nextBoard, reply), enemy));
    baseSan += hasReply ? '+' : '#';
  }

  return baseSan;
}

export function applyChessMove(state: ChessState, move: ChessMove): ChessState {
  const san = move.san || computeMoveSan(state, move);
  const recordedMove: ChessMove = san === move.san ? move : { ...move, san };

  const nextBoard = applyMoveToBoard(state.board, recordedMove);
  const nextTurn = opposite(state.turn);
  const nextCastling = updateCastlingRights(state.castling, recordedMove);
  const nextEnPassant =
    recordedMove.piece.type === 'p' && Math.abs(recordedMove.to.row - recordedMove.from.row) === 2
      ? { row: (recordedMove.from.row + recordedMove.to.row) / 2, col: recordedMove.from.col }
      : null;

  const nextHalfmove =
    recordedMove.piece.type === 'p' || recordedMove.captured ? 0 : state.halfmoveClock + 1;
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
    history: [...state.history, recordedMove],
    positionCounts: nextCounts,
    status,
    winner,
    inCheck: nextInCheck,
    lastMove: { from: recordedMove.from, to: recordedMove.to },
  };
}

export function findLegalMoveByCoords(
  state: ChessState,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  promotion?: PromotionType
): ChessMove | null {
  const legal = getLegalMovesForState(
    state.board,
    state.turn,
    state.castling,
    state.enPassant,
    false
  );
  const match = legal.find(
    (m) =>
      m.from.row === fromRow &&
      m.from.col === fromCol &&
      m.to.row === toRow &&
      m.to.col === toCol &&
      (!promotion || m.promotion === promotion)
  );
  if (!match) return null;
  return { ...match, san: computeMoveSan(state, match) };
}

export function replayMoves(moves: ChessMove[]): ChessState {
  let state = createInitialChessState();
  for (const m of moves) {
    state = applyChessMove(state, m);
  }
  return state;
}

export function replayCompactMoves(
  compactMoves: Array<{
    fromRow: number;
    fromCol: number;
    toRow: number;
    toCol: number;
    promotion?: PromotionType;
    san?: string;
  }>
): ChessState {
  let state = createInitialChessState();
  for (const cm of compactMoves) {
    const found = findLegalMoveByCoords(
      state,
      cm.fromRow,
      cm.fromCol,
      cm.toRow,
      cm.toCol,
      cm.promotion
    );
    if (!found) break;
    state = applyChessMove(state, cm.san ? { ...found, san: cm.san } : found);
  }
  return state;
}

// =========================================================================
// Fast Flat Int8Array(64) Zero-Allocation Chess Search Engine
// Piece codes: 0 = empty, +1..+6 = White P,N,B,R,Q,K, -1..-6 = Black P,N,B,R,Q,K
// =========================================================================
const FP_EMPTY = 0;
const FP_PAWN = 1;
const FP_KNIGHT = 2;
const FP_BISHOP = 3;
const FP_ROOK = 4;
const FP_QUEEN = 5;
const FP_KING = 6;

const TYPE_TO_INT: Record<PieceType, number> = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
const FLAT_PIECE_VALUES = [0, 100, 320, 330, 500, 900, 20000];
const FLAT_PST: number[][] = [
  new Array(64).fill(0),
  PAWN_PST.flat(),
  KNIGHT_PST.flat(),
  BISHOP_PST.flat(),
  ROOK_PST.flat(),
  QUEEN_PST.flat(),
  KING_PST.flat(),
];

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
] as const;

const ORTHO_OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const DIAG_OFFSETS = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

// Bitflags for castling: 1=wK, 2=wQ, 4=bK, 8=bQ
interface FlatMove {
  from: number;
  to: number;
  piece: number; // signed
  captured: number; // signed or 0
  promo: number; // 0 or unsigned 2..5
  castle: number; // 0, 1=K, 2=Q
  ep: boolean;
  score: number;
}

function toFlatBoard(board: BoardGrid): Int8Array {
  const flat = new Int8Array(64);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (sq) {
        const code = TYPE_TO_INT[sq.type];
        flat[(r << 3) | c] = sq.color === 'w' ? code : -code;
      }
    }
  }
  return flat;
}

function toCastleMask(castling: CastlingRights): number {
  return (
    (castling.wK ? 1 : 0) |
    (castling.wQ ? 2 : 0) |
    (castling.bK ? 4 : 0) |
    (castling.bQ ? 8 : 0)
  );
}

function isFlatSqAttacked(flat: Int8Array, sqIdx: number, bySide: number): boolean {
  const tr = sqIdx >> 3;
  const tc = sqIdx & 7;

  // Pawns
  const pr = bySide === 1 ? tr + 1 : tr - 1;
  if (pr >= 0 && pr < 8) {
    const pawnCode = bySide * FP_PAWN;
    if (tc > 0 && flat[(pr << 3) | (tc - 1)] === pawnCode) return true;
    if (tc < 7 && flat[(pr << 3) | (tc + 1)] === pawnCode) return true;
  }

  // Knights
  const knightCode = bySide * FP_KNIGHT;
  for (let i = 0; i < 8; i++) {
    const nr = tr + KNIGHT_OFFSETS[i][0];
    const nc = tc + KNIGHT_OFFSETS[i][1];
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && flat[(nr << 3) | nc] === knightCode) {
      return true;
    }
  }

  // King
  const kingCode = bySide * FP_KING;
  for (let dr = -1; dr <= 1; dr++) {
    const nr = tr + dr;
    if (nr < 0 || nr > 7) continue;
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nc = tc + dc;
      if (nc >= 0 && nc < 8 && flat[(nr << 3) | nc] === kingCode) return true;
    }
  }

  // Orthogonal (Rook / Queen)
  const rookCode = bySide * FP_ROOK;
  const queenCode = bySide * FP_QUEEN;
  for (let d = 0; d < 4; d++) {
    const dr = ORTHO_OFFSETS[d][0];
    const dc = ORTHO_OFFSETS[d][1];
    let r = tr + dr;
    let c = tc + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const p = flat[(r << 3) | c];
      if (p !== 0) {
        if (p === rookCode || p === queenCode) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  // Diagonal (Bishop / Queen)
  const bishopCode = bySide * FP_BISHOP;
  for (let d = 0; d < 4; d++) {
    const dr = DIAG_OFFSETS[d][0];
    const dc = DIAG_OFFSETS[d][1];
    let r = tr + dr;
    let c = tc + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const p = flat[(r << 3) | c];
      if (p !== 0) {
        if (p === bishopCode || p === queenCode) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  return false;
}

function findFlatKing(flat: Int8Array, side: number): number {
  const target = side * FP_KING;
  for (let i = 0; i < 64; i++) {
    if (flat[i] === target) return i;
  }
  return -1;
}

function evaluateFlatBoard(flat: Int8Array): number {
  let score = 0;
  for (let idx = 0; idx < 64; idx++) {
    const p = flat[idx];
    if (p === 0) continue;
    if (p > 0) {
      score += FLAT_PIECE_VALUES[p] + FLAT_PST[p][idx];
    } else {
      const absP = -p;
      const r = idx >> 3;
      const c = idx & 7;
      const mirrored = ((7 - r) << 3) | c;
      score -= FLAT_PIECE_VALUES[absP] + FLAT_PST[absP][mirrored];
    }
  }
  return score;
}

function genFlatPseudoMoves(
  flat: Int8Array,
  side: number,
  castleMask: number,
  epSq: number,
  capturesOnly = false
): FlatMove[] {
  const moves: FlatMove[] = [];
  const enemy = -side;

  for (let idx = 0; idx < 64; idx++) {
    const piece = flat[idx];
    if (piece === 0 || (side === 1 ? piece < 0 : piece > 0)) continue;

    const absP = piece > 0 ? piece : -piece;
    const r = idx >> 3;
    const c = idx & 7;

    if (absP === FP_PAWN) {
      const dir = side === 1 ? -1 : 1;
      const startRow = side === 1 ? 6 : 1;
      const promoRow = side === 1 ? 0 : 7;
      const oneRow = r + dir;

      if (oneRow >= 0 && oneRow < 8) {
        const oneSq = (oneRow << 3) | c;
        if (flat[oneSq] === FP_EMPTY) {
          if (oneRow === promoRow) {
            for (const promo of [FP_QUEEN, FP_ROOK, FP_BISHOP, FP_KNIGHT]) {
              moves.push({
                from: idx,
                to: oneSq,
                piece,
                captured: 0,
                promo,
                castle: 0,
                ep: false,
                score: FLAT_PIECE_VALUES[promo],
              });
            }
          } else if (!capturesOnly) {
            moves.push({
              from: idx,
              to: oneSq,
              piece,
              captured: 0,
              promo: 0,
              castle: 0,
              ep: false,
              score: 0,
            });
            if (r === startRow) {
              const twoSq = ((r + dir * 2) << 3) | c;
              if (flat[twoSq] === FP_EMPTY) {
                moves.push({
                  from: idx,
                  to: twoSq,
                  piece,
                  captured: 0,
                  promo: 0,
                  castle: 0,
                  ep: false,
                  score: 0,
                });
              }
            }
          }
        }

        // Captures
        for (let dc = -1; dc <= 1; dc += 2) {
          const nc = c + dc;
          if (nc < 0 || nc > 7) continue;
          const capSq = (oneRow << 3) | nc;
          const target = flat[capSq];
          if (target !== 0 && (side === 1 ? target < 0 : target > 0)) {
            const absT = target > 0 ? target : -target;
            if (oneRow === promoRow) {
              for (const promo of [FP_QUEEN, FP_ROOK, FP_BISHOP, FP_KNIGHT]) {
                moves.push({
                  from: idx,
                  to: capSq,
                  piece,
                  captured: target,
                  promo,
                  castle: 0,
                  ep: false,
                  score: FLAT_PIECE_VALUES[absT] * 10 - 100 + FLAT_PIECE_VALUES[promo],
                });
              }
            } else {
              moves.push({
                from: idx,
                to: capSq,
                piece,
                captured: target,
                promo: 0,
                castle: 0,
                ep: false,
                score: FLAT_PIECE_VALUES[absT] * 10 - 100,
              });
            }
          } else if (capSq === epSq) {
            const epCapSq = (r << 3) | nc;
            const epTarget = flat[epCapSq];
            if (epTarget === enemy * FP_PAWN) {
              moves.push({
                from: idx,
                to: capSq,
                piece,
                captured: epTarget,
                promo: 0,
                castle: 0,
                ep: true,
                score: 900,
              });
            }
          }
        }
      }
    } else if (absP === FP_KNIGHT) {
      for (let i = 0; i < 8; i++) {
        const nr = r + KNIGHT_OFFSETS[i][0];
        const nc = c + KNIGHT_OFFSETS[i][1];
        if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
        const to = (nr << 3) | nc;
        const target = flat[to];
        if (target === 0) {
          if (!capturesOnly) {
            moves.push({ from: idx, to, piece, captured: 0, promo: 0, castle: 0, ep: false, score: 0 });
          }
        } else if (side === 1 ? target < 0 : target > 0) {
          const absT = target > 0 ? target : -target;
          moves.push({
            from: idx,
            to,
            piece,
            captured: target,
            promo: 0,
            castle: 0,
            ep: false,
            score: FLAT_PIECE_VALUES[absT] * 10 - 320,
          });
        }
      }
    } else if (absP === FP_BISHOP || absP === FP_ROOK || absP === FP_QUEEN) {
      const dirs =
        absP === FP_BISHOP
          ? DIAG_OFFSETS
          : absP === FP_ROOK
          ? ORTHO_OFFSETS
          : [...DIAG_OFFSETS, ...ORTHO_OFFSETS];
      const selfVal = FLAT_PIECE_VALUES[absP];
      for (let d = 0; d < dirs.length; d++) {
        const dr = dirs[d][0];
        const dc = dirs[d][1];
        let nr = r + dr;
        let nc = c + dc;
        while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
          const to = (nr << 3) | nc;
          const target = flat[to];
          if (target === 0) {
            if (!capturesOnly) {
              moves.push({ from: idx, to, piece, captured: 0, promo: 0, castle: 0, ep: false, score: 0 });
            }
          } else {
            if (side === 1 ? target < 0 : target > 0) {
              const absT = target > 0 ? target : -target;
              moves.push({
                from: idx,
                to,
                piece,
                captured: target,
                promo: 0,
                castle: 0,
                ep: false,
                score: FLAT_PIECE_VALUES[absT] * 10 - selfVal,
              });
            }
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
    } else if (absP === FP_KING) {
      for (let dr = -1; dr <= 1; dr++) {
        const nr = r + dr;
        if (nr < 0 || nr > 7) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = c + dc;
          if (nc < 0 || nc > 7) continue;
          const to = (nr << 3) | nc;
          const target = flat[to];
          if (target === 0) {
            if (!capturesOnly) {
              moves.push({ from: idx, to, piece, captured: 0, promo: 0, castle: 0, ep: false, score: 0 });
            }
          } else if (side === 1 ? target < 0 : target > 0) {
            const absT = target > 0 ? target : -target;
            moves.push({
              from: idx,
              to,
              piece,
              captured: target,
              promo: 0,
              castle: 0,
              ep: false,
              score: FLAT_PIECE_VALUES[absT] * 10 - 2000,
            });
          }
        }
      }

      if (!capturesOnly) {
        const homeRow = side === 1 ? 7 : 0;
        if (r === homeRow && c === 4 && !isFlatSqAttacked(flat, (homeRow << 3) | 4, enemy)) {
          const canK = side === 1 ? (castleMask & 1) !== 0 : (castleMask & 4) !== 0;
          const canQ = side === 1 ? (castleMask & 2) !== 0 : (castleMask & 8) !== 0;
          if (
            canK &&
            flat[(homeRow << 3) | 5] === 0 &&
            flat[(homeRow << 3) | 6] === 0 &&
            flat[(homeRow << 3) | 7] === side * FP_ROOK &&
            !isFlatSqAttacked(flat, (homeRow << 3) | 5, enemy) &&
            !isFlatSqAttacked(flat, (homeRow << 3) | 6, enemy)
          ) {
            moves.push({
              from: idx,
              to: (homeRow << 3) | 6,
              piece,
              captured: 0,
              promo: 0,
              castle: 1,
              ep: false,
              score: 60,
            });
          }
          if (
            canQ &&
            flat[(homeRow << 3) | 3] === 0 &&
            flat[(homeRow << 3) | 2] === 0 &&
            flat[(homeRow << 3) | 1] === 0 &&
            flat[(homeRow << 3) | 0] === side * FP_ROOK &&
            !isFlatSqAttacked(flat, (homeRow << 3) | 3, enemy) &&
            !isFlatSqAttacked(flat, (homeRow << 3) | 2, enemy)
          ) {
            moves.push({
              from: idx,
              to: (homeRow << 3) | 2,
              piece,
              captured: 0,
              promo: 0,
              castle: 2,
              ep: false,
              score: 55,
            });
          }
        }
      }
    }
  }

  return moves;
}

function nextFlatCastleMask(mask: number, from: number, to: number): number {
  if (from === 60 || to === 60) mask &= ~3;
  if (from === 63 || to === 63) mask &= ~1;
  if (from === 56 || to === 56) mask &= ~2;
  if (from === 4 || to === 4) mask &= ~12;
  if (from === 7 || to === 7) mask &= ~4;
  if (from === 0 || to === 0) mask &= ~8;
  return mask;
}

function makeFlatMove(flat: Int8Array, m: FlatMove) {
  flat[m.from] = FP_EMPTY;
  if (m.ep) {
    const epCapSq = ((m.from >> 3) << 3) | (m.to & 7);
    flat[epCapSq] = FP_EMPTY;
  }
  if (m.castle === 1) {
    const rowBase = m.from & 56;
    flat[rowBase | 5] = flat[rowBase | 7];
    flat[rowBase | 7] = FP_EMPTY;
  } else if (m.castle === 2) {
    const rowBase = m.from & 56;
    flat[rowBase | 3] = flat[rowBase];
    flat[rowBase] = FP_EMPTY;
  }
  flat[m.to] = m.promo ? (m.piece > 0 ? m.promo : -m.promo) : m.piece;
}

function unmakeFlatMove(flat: Int8Array, m: FlatMove) {
  flat[m.from] = m.piece;
  if (m.ep) {
    flat[m.to] = FP_EMPTY;
    const epCapSq = ((m.from >> 3) << 3) | (m.to & 7);
    flat[epCapSq] = m.captured;
  } else {
    flat[m.to] = m.captured;
  }
  if (m.castle === 1) {
    const rowBase = m.from & 56;
    flat[rowBase | 7] = flat[rowBase | 5];
    flat[rowBase | 5] = FP_EMPTY;
  } else if (m.castle === 2) {
    const rowBase = m.from & 56;
    flat[rowBase] = flat[rowBase | 3];
    flat[rowBase | 3] = FP_EMPTY;
  }
}

interface SearchContext {
  nodes: number;
  deadline: number;
  aborted: boolean;
}

function quiescenceFlat(
  flat: Int8Array,
  side: number,
  castleMask: number,
  epSq: number,
  alpha: number,
  beta: number,
  qDepth: number,
  ctx: SearchContext
): number {
  ctx.nodes += 1;
  if ((ctx.nodes & 511) === 0 && performance.now() > ctx.deadline) {
    ctx.aborted = true;
    return evaluateFlatBoard(flat);
  }

  const standPat = evaluateFlatBoard(flat);
  if (qDepth <= 0) return standPat;

  if (side === 1) {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    const caps = genFlatPseudoMoves(flat, side, castleMask, epSq, true);
    caps.sort((a, b) => b.score - a.score);
    for (let i = 0; i < caps.length; i++) {
      const m = caps[i];
      makeFlatMove(flat, m);
      const kIdx = findFlatKing(flat, side);
      const illegal = kIdx !== -1 && isFlatSqAttacked(flat, kIdx, -side);
      if (!illegal) {
        const nextEp =
          Math.abs(m.piece) === FP_PAWN && Math.abs((m.to >> 3) - (m.from >> 3)) === 2
            ? ((m.from + m.to) >> 1)
            : -1;
        const score = quiescenceFlat(
          flat,
          -side,
          nextFlatCastleMask(castleMask, m.from, m.to),
          nextEp,
          alpha,
          beta,
          qDepth - 1,
          ctx
        );
        unmakeFlatMove(flat, m);
        if (ctx.aborted) return alpha;
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      } else {
        unmakeFlatMove(flat, m);
      }
    }
    return alpha;
  } else {
    if (standPat <= alpha) return alpha;
    if (standPat < beta) beta = standPat;
    const caps = genFlatPseudoMoves(flat, side, castleMask, epSq, true);
    caps.sort((a, b) => b.score - a.score);
    for (let i = 0; i < caps.length; i++) {
      const m = caps[i];
      makeFlatMove(flat, m);
      const kIdx = findFlatKing(flat, side);
      const illegal = kIdx !== -1 && isFlatSqAttacked(flat, kIdx, -side);
      if (!illegal) {
        const nextEp =
          Math.abs(m.piece) === FP_PAWN && Math.abs((m.to >> 3) - (m.from >> 3)) === 2
            ? ((m.from + m.to) >> 1)
            : -1;
        const score = quiescenceFlat(
          flat,
          -side,
          nextFlatCastleMask(castleMask, m.from, m.to),
          nextEp,
          alpha,
          beta,
          qDepth - 1,
          ctx
        );
        unmakeFlatMove(flat, m);
        if (ctx.aborted) return beta;
        if (score <= alpha) return alpha;
        if (score < beta) beta = score;
      } else {
        unmakeFlatMove(flat, m);
      }
    }
    return beta;
  }
}

function alphaBetaFlat(
  flat: Int8Array,
  side: number,
  castleMask: number,
  epSq: number,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchContext,
  qDepth: number
): number {
  ctx.nodes += 1;
  if ((ctx.nodes & 511) === 0 && performance.now() > ctx.deadline) {
    ctx.aborted = true;
    return evaluateFlatBoard(flat);
  }

  if (depth <= 0) {
    return qDepth > 0
      ? quiescenceFlat(flat, side, castleMask, epSq, alpha, beta, qDepth, ctx)
      : evaluateFlatBoard(flat);
  }

  const moves = genFlatPseudoMoves(flat, side, castleMask, epSq, false);
  moves.sort((a, b) => b.score - a.score);

  let legalCount = 0;
  let best = side === 1 ? -Infinity : Infinity;

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    makeFlatMove(flat, m);
    const kIdx = findFlatKing(flat, side);
    if (kIdx !== -1 && isFlatSqAttacked(flat, kIdx, -side)) {
      unmakeFlatMove(flat, m);
      continue;
    }

    legalCount += 1;
    const nextMask = nextFlatCastleMask(castleMask, m.from, m.to);
    const nextEp =
      Math.abs(m.piece) === FP_PAWN && Math.abs((m.to >> 3) - (m.from >> 3)) === 2
        ? ((m.from + m.to) >> 1)
        : -1;

    const score = alphaBetaFlat(
      flat,
      -side,
      nextMask,
      nextEp,
      depth - 1,
      alpha,
      beta,
      ctx,
      qDepth
    );
    unmakeFlatMove(flat, m);
    if (ctx.aborted) return best === Infinity || best === -Infinity ? evaluateFlatBoard(flat) : best;

    if (side === 1) {
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (beta <= alpha) break;
    } else {
      if (score < best) best = score;
      if (score < beta) beta = score;
      if (beta <= alpha) break;
    }
  }

  if (legalCount === 0) {
    const kIdx = findFlatKing(flat, side);
    const inChk = kIdx !== -1 && isFlatSqAttacked(flat, kIdx, -side);
    if (inChk) {
      return side === 1 ? -99000 - depth * 100 : 99000 + depth * 100;
    }
    return 0;
  }

  return best;
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
    false
  );
  if (legalMoves.length === 0) return null;

  const flat = toFlatBoard(state.board);
  const castleMask = toCastleMask(state.castling);
  const epSq = state.enPassant ? (state.enPassant.row << 3) | state.enPassant.col : -1;
  const side = state.turn === 'w' ? 1 : -1;

  const maxDepth = difficulty === 'master' ? 3 : difficulty === 'club' ? 2 : 1;
  const qDepth = difficulty === 'master' ? 2 : difficulty === 'club' ? 1 : 0;
  const timeBudgetMs = difficulty === 'master' ? 120 : difficulty === 'club' ? 45 : 8;
  const startTime = performance.now();

  const ctx: SearchContext = {
    nodes: 0,
    deadline: startTime + timeBudgetMs,
    aborted: false,
  };

  let bestMove = legalMoves[0];
  let bestOrdered = [...legalMoves];

  // Iterative deepening from depth 1 up to maxDepth within strict ms budget
  for (let depth = 1; depth <= maxDepth; depth++) {
    const roundScores: Array<{ move: ChessMove; score: number }> = [];
    let alpha = -Infinity;
    let beta = Infinity;

    for (let i = 0; i < bestOrdered.length; i++) {
      const move = bestOrdered[i];
      const fMove: FlatMove = {
        from: (move.from.row << 3) | move.from.col,
        to: (move.to.row << 3) | move.to.col,
        piece: side * TYPE_TO_INT[move.piece.type],
        captured: move.captured
          ? (move.captured.color === 'w' ? 1 : -1) * TYPE_TO_INT[move.captured.type]
          : 0,
        promo: move.promotion ? TYPE_TO_INT[move.promotion] : 0,
        castle: move.isCastle === 'K' ? 1 : move.isCastle === 'Q' ? 2 : 0,
        ep: Boolean(move.isEnPassant),
        score: 0,
      };

      makeFlatMove(flat, fMove);
      const nextMask = nextFlatCastleMask(castleMask, fMove.from, fMove.to);
      const nextEp =
        move.piece.type === 'p' && Math.abs(move.to.row - move.from.row) === 2
          ? (((move.from.row + move.to.row) >> 1) << 3) | move.from.col
          : -1;

      let score = alphaBetaFlat(
        flat,
        -side,
        nextMask,
        nextEp,
        depth - 1,
        alpha,
        beta,
        ctx,
        qDepth
      );
      unmakeFlatMove(flat, fMove);

      if (ctx.aborted) break;

      if (difficulty === 'casual') {
        score += (Math.random() - 0.5) * 90;
      } else if (difficulty === 'club') {
        score += (Math.random() - 0.5) * 14;
      }

      roundScores.push({ move, score });
      if (side === 1) {
        if (score > alpha) alpha = score;
      } else {
        if (score < beta) beta = score;
      }
    }

    if (ctx.aborted && depth > 1) {
      break;
    }

    if (roundScores.length > 0) {
      roundScores.sort((a, b) => (side === 1 ? b.score - a.score : a.score - b.score));
      bestMove = roundScores[0].move;
      bestOrdered = roundScores.map((r) => r.move);
    }

    if (performance.now() - startTime > timeBudgetMs * 0.75) {
      break;
    }
  }

  return {
    ...bestMove,
    san: computeMoveSan(state, bestMove),
  };
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
