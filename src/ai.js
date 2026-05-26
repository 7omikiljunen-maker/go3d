// ─── ai.js — Minimax AI with alpha-beta pruning ───────────────────────────────
import { N, board, legalMoves, aiDifficulty } from './board.js';

// ─── Self-contained board helpers (work on explicit board copies) ─────────────
function simNeighbors(x, y, z) {
  const ns = [];
  for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
    const nx = x+dx, ny = y+dy, nz = z+dz;
    if (nx>=0 && nx<N && ny>=0 && ny<N && nz>=0 && nz<N) ns.push([nx, ny, nz]);
  }
  return ns;
}

function simGetGroup(brd, x, y, z) {
  const color = brd[x][y][z];
  if (!color) return { stones: [], liberties: [] };
  const visited = new Set(), liberties = new Set();
  const key = (a,b,c) => `${a},${b},${c}`;
  const stack = [[x, y, z]]; visited.add(key(x,y,z));
  while (stack.length) {
    const [cx, cy, cz] = stack.pop();
    for (const [nx, ny, nz] of simNeighbors(cx, cy, cz)) {
      const k = key(nx, ny, nz);
      if (brd[nx][ny][nz] === 0) liberties.add(k);
      else if (brd[nx][ny][nz] === color && !visited.has(k)) {
        visited.add(k); stack.push([nx, ny, nz]);
      }
    }
  }
  return {
    stones: [...visited].map(k => k.split(',').map(Number)),
    liberties: [...liberties],
  };
}

// Apply a move to a board copy. Returns { b, captured } or null on suicide.
function simApply(brd, x, y, z, player) {
  const b = brd.map(a => a.map(r => [...r]));
  b[x][y][z] = player;
  const opp = 3 - player;
  let captured = [];
  for (const [nx, ny, nz] of simNeighbors(x, y, z)) {
    if (b[nx][ny][nz] === opp) {
      const { stones, liberties } = simGetGroup(b, nx, ny, nz);
      if (liberties.length === 0) captured = [...captured, ...stones];
    }
  }
  for (const [cx, cy, cz] of captured) b[cx][cy][cz] = 0;
  const { liberties } = simGetGroup(b, x, y, z);
  if (liberties.length === 0 && captured.length === 0) return null;
  return { b, captured: captured.length };
}

// ─── Phase detection ──────────────────────────────────────────────────────────
function boardStoneCount() {
  let n = 0;
  for (let x=0; x<N; x++) for (let y=0; y<N; y++) for (let z=0; z<N; z++)
    if (board[x][y][z] !== 0) n++;
  return n;
}

function getPhase() {
  const count  = boardStoneCount();
  const openingEnd = Math.max(Math.floor(N * N * 0.4), N * 2);
  const midEnd     = Math.floor(N * N * N * 0.5);
  if (count < openingEnd) return 'opening';
  if (count < midEnd)     return 'midgame';
  return 'endgame';
}

// ─── Opening strategy helpers ─────────────────────────────────────────────────
function starCoordSet() {
  if (N === 3) return new Set([1]);
  if (N === 5) return new Set([1, 3]);
  if (N === 7) return new Set([2, 4]);
  return      new Set([2, 4, 6]);
}

function isStarPoint(x, y, z) {
  const sc = starCoordSet();
  if (sc.has(x) && sc.has(y) && sc.has(z)) return true;
  const c = (N - 1) / 2;
  return x === c && y === c && z === c;
}

function edgeDegree(x, y, z) {
  return ([0, N-1].includes(x) ? 1 : 0)
       + ([0, N-1].includes(y) ? 1 : 0)
       + ([0, N-1].includes(z) ? 1 : 0);
}

function playerInLayer(brd, y, player) {
  for (let x=0; x<N; x++) for (let z=0; z<N; z++)
    if (brd[x][y][z] === player) return true;
  return false;
}

function openingBonus(x, y, z, player, brd) {
  let bonus = 0;
  if (isStarPoint(x, y, z)) {
    bonus += 100;
  } else {
    for (const [nx, ny, nz] of simNeighbors(x, y, z)) {
      if (isStarPoint(nx, ny, nz)) { bonus += 30; break; }
    }
  }
  if (!playerInLayer(brd, y, player)) bonus += 50;
  const ed = edgeDegree(x, y, z);
  if (ed === 3) bonus -= 90;
  if (ed === 2) bonus -= 40;
  if (ed === 1) bonus -= 10;
  return bonus;
}

// ─── 1-ply heuristic score for move ordering ─────────────────────────────────
function score1ply(x, y, z, player, brd, phase) {
  let s = 0;
  const opp = 3 - player;
  const b = brd.map(a => a.map(r => [...r]));
  b[x][y][z] = player;
  let captured = [];
  for (const [nx, ny, nz] of simNeighbors(x, y, z)) {
    if (b[nx][ny][nz] === opp) {
      const { stones, liberties } = simGetGroup(b, nx, ny, nz);
      if (liberties.length === 0) captured = [...captured, ...stones];
    }
  }
  for (const [cx, cy, cz] of captured) b[cx][cy][cz] = 0;

  s += captured.length * 200;

  for (const [nx, ny, nz] of simNeighbors(x, y, z)) {
    if (b[nx][ny][nz] === player) {
      const { liberties } = simGetGroup(b, nx, ny, nz);
      if (liberties.length > 1) s += 30;  // reduced: less reward for safe connectivity
    }
    if (b[nx][ny][nz] === opp) {
      const { liberties } = simGetGroup(b, nx, ny, nz);
      if (liberties.length === 1) s += 160; // increased: aggressively hunt atari
      if (liberties.length === 2) s += 60;  // also reward putting opponent under pressure
    }
  }

  const nearStone = simNeighbors(x, y, z).some(([nx, ny, nz]) => brd[nx][ny][nz] !== 0);
  if (nearStone) s += 30;

  const cx2 = x - (N-1)/2, cy2 = y - (N-1)/2, cz2 = z - (N-1)/2;
  s += 20 - Math.sqrt(cx2*cx2 + cy2*cy2 + cz2*cz2) * 3;

  if (phase === 'opening') s += openingBonus(x, y, z, player, brd);

  // Eye-building bonus: if placing here causes any adjacent empty cell to
  // become a true eye (all its in-bounds neighbours are now own stones),
  // reward the move.  This makes the move-ordering favour eye-formation
  // before the deeper search even runs.
  for (const [nx, ny, nz] of simNeighbors(x, y, z)) {
    if (b[nx][ny][nz] !== 0) continue; // must be an empty neighbour
    if (simNeighbors(nx, ny, nz).every(([nnx, nny, nnz]) => b[nnx][nny][nnz] === player)) {
      s += 150; // completing a true eye is very valuable
    }
  }

  // Heavy penalty for filling completely enclosed own territory.
  // All 6 neighbours (within bounds) are own stones → this cell is an interior void;
  // placing here wastes a move and gains nothing strategically.
  const nbrs = simNeighbors(x, y, z);
  if (nbrs.length > 0 && nbrs.every(([nx, ny, nz]) => brd[nx][ny][nz] === player)) s -= 500;

  return s;
}

// ─── Static board evaluation (used at leaf nodes) ────────────────────────────
// Scores the whole board from aiPlayer's perspective.
// +ve = good for AI, -ve = bad for AI.
function staticEval(brd, aiPlayer) {
  let score = 0;
  const visited = new Set();
  const key = (x, y, z) => `${x},${y},${z}`;

  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) {
    const color = brd[x][y][z];
    if (!color) continue;
    const k = key(x, y, z);
    if (visited.has(k)) continue;

    const { stones, liberties } = simGetGroup(brd, x, y, z);
    stones.forEach(([sx, sy, sz]) => visited.add(key(sx, sy, sz)));

    const sign     = color === aiPlayer ? 1 : -1;
    const libCount = liberties.length;
    const size     = stones.length;

    // Stone count
    score += sign * size * 100;

    // Liberty pressure — less defensive than before so AI takes more risks
    if      (libCount === 1) score -= sign * 250;  // atari: still bad but not paralysing
    else if (libCount === 2) score -= sign * 30;   // mild pressure
    else                     score += sign * Math.min(libCount, 6) * 10;

    // Group size — reduced so AI doesn't obsess over connectivity
    score += sign * size * 5;

    // Positional value: central stones are worth more than edge/corner stones.
    // Distance is normalised by the board's half-side so the ±35-point range
    // stays proportional on every board size (3³ through 9³).
    // This persists through the full minimax search so the AI genuinely prefers
    // the centre, not just as a move-ordering hint.
    const halfSide = (N - 1) / 2 || 1;
    for (const [sx, sy, sz] of stones) {
      const dx = sx - halfSide, dy = sy - halfSide, dz = sz - halfSide;
      const distNorm = Math.sqrt(dx*dx + dy*dy + dz*dz) / halfSide;
      score += sign * (25 - distNorm * 20);
    }

    // Eye counting: a liberty is a "true eye" when every one of its (up to 6)
    // in-bounds neighbours is a stone of this group's colour.  The opponent can
    // never legally fill a true eye (doing so would be immediate suicide), so
    // each eye is a permanent, uncapturable liberty.
    // Two or more eyes → the group is immortal; add a large "alive" bonus.
    let eyeCount = 0;
    for (const libKey of liberties) {
      const [lx, ly, lz] = libKey.split(',').map(Number);
      const allOwn = simNeighbors(lx, ly, lz).every(([nx, ny, nz]) => brd[nx][ny][nz] === color);
      if (allOwn) eyeCount++;
    }
    if (eyeCount > 0) score += sign * eyeCount * 80;
    if (eyeCount >= 2) score += sign * 250; // alive group — cannot be captured
  }

  // ── Territory: BFS flood-fill from each player's stones ─────────────────────
  // AI stones block the opponent's flood, and vice versa.
  // Empty cells the opponent can't reach at all = securely enclosed AI territory.
  // This directly rewards building surrounding walls around empty space.
  score += territoryScore(brd, aiPlayer);

  return score;
}

// ─── BFS territory scoring ────────────────────────────────────────────────────
// Floods outward from each player's stones. Enemy stones act as walls.
// An empty cell closer to AI than opponent = AI influence (and vice versa).
// A cell the opponent simply can't reach = fully enclosed AI territory.
function territoryScore(brd, aiPlayer) {
  const opp = 3 - aiPlayer;
  const INF = N * N * N + 1;
  const size = N * N * N;
  const aiDist  = new Int32Array(size).fill(INF);
  const oppDist = new Int32Array(size).fill(INF);
  const idx = (x, y, z) => x*N*N + y*N + z;
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

  // Seed BFS queues from each player's stones
  const aiQ = [], oppQ = [];
  for (let x=0; x<N; x++) for (let y=0; y<N; y++) for (let z=0; z<N; z++) {
    if (brd[x][y][z] === aiPlayer) { aiDist[idx(x,y,z)]  = 0; aiQ.push(x, y, z); }
    if (brd[x][y][z] === opp)      { oppDist[idx(x,y,z)] = 0; oppQ.push(x, y, z); }
  }

  // BFS: spread through empty cells only, blocked by enemy stones (the walls)
  function bfs(q, dist, blocker) {
    for (let i = 0; i < q.length; i += 3) {
      const x=q[i], y=q[i+1], z=q[i+2], d=dist[idx(x,y,z)];
      for (const [dx,dy,dz] of dirs) {
        const nx=x+dx, ny=y+dy, nz=z+dz;
        if (nx<0||nx>=N||ny<0||ny>=N||nz<0||nz>=N) continue;
        if (brd[nx][ny][nz] === blocker) continue; // wall — can't pass
        const ni = idx(nx,ny,nz);
        if (dist[ni] === INF) { dist[ni] = d+1; q.push(nx, ny, nz); }
      }
    }
  }

  bfs(aiQ,  aiDist,  opp);      // AI flood blocked by opponent stones
  bfs(oppQ, oppDist, aiPlayer); // opponent flood blocked by AI stones

  // Score each empty cell
  let score = 0;
  for (let x=0; x<N; x++) for (let y=0; y<N; y++) for (let z=0; z<N; z++) {
    if (brd[x][y][z] !== 0) continue;
    const da = aiDist[idx(x,y,z)];
    const do_ = oppDist[idx(x,y,z)];
    if (da === INF && do_ === INF) continue; // unreachable by both — ignore
    if (da  < do_)  score += 22;             // AI closer — AI influence
    if (do_ < da)   score -= 22;             // opponent closer
    if (da  < INF && do_ === INF) score += 20; // fully enclosed by AI walls
    if (do_ < INF && da  === INF) score -= 20; // fully enclosed by opponent
  }
  return score;
}

// ─── Candidate moves: top `limit` moves ordered by 1-ply heuristic ───────────
function candidateMoves(brd, player, limit, phase) {
  const moves = [];
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++)
      for (let z = 0; z < N; z++)
        if (brd[x][y][z] === 0) moves.push([x, y, z]);

  if (moves.length <= limit) return moves;

  return moves
    .map(([x, y, z]) => ({ move: [x, y, z], h: score1ply(x, y, z, player, brd, phase) }))
    .sort((a, b) => b.h - a.h)
    .slice(0, limit)
    .map(e => e.move);
}

// ─── Alpha-beta minimax ───────────────────────────────────────────────────────
// isMaximizing = true  → it's the AI's turn (maximise score)
// isMaximizing = false → it's the opponent's turn (minimise score)
function minimax(brd, depth, alpha, beta, isMaximizing, aiPlayer, phase, candLimit) {
  if (depth === 0) return staticEval(brd, aiPlayer);

  const player    = isMaximizing ? aiPlayer : 3 - aiPlayer;
  const candidates = candidateMoves(brd, player, candLimit, phase);
  if (candidates.length === 0) return staticEval(brd, aiPlayer);

  if (isMaximizing) {
    let best = -Infinity;
    for (const [x, y, z] of candidates) {
      const result = simApply(brd, x, y, z, player);
      if (!result) continue;
      const s = minimax(result.b, depth - 1, alpha, beta, false, aiPlayer, phase, candLimit);
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (beta <= alpha) break; // ── prune ──
    }
    return best === -Infinity ? staticEval(brd, aiPlayer) : best;
  } else {
    let best = Infinity;
    for (const [x, y, z] of candidates) {
      const result = simApply(brd, x, y, z, player);
      if (!result) continue;
      const s = minimax(result.b, depth - 1, alpha, beta, true, aiPlayer, phase, candLimit);
      if (s < best) best = s;
      if (s < beta) beta = s;
      if (beta <= alpha) break; // ── prune ──
    }
    return best === Infinity ? staticEval(brd, aiPlayer) : best;
  }
}

// ─── Main AI entry point ──────────────────────────────────────────────────────
export function aiMove(player) {
  const moves = legalMoves(player);
  if (moves.length === 0) return null;

  // Easy: 40 % of moves are completely random — makes the AI feel genuinely weak
  if (aiDifficulty === 'easy' && Math.random() < 0.4) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const phase = getPhase();

  // Depth and candidate limits tuned per difficulty × board size
  //   depth     = how many half-moves ahead
  //   rootCands = moves considered at root
  //   deepCands = moves considered at each deeper level
  //   noise     = random tie-break jitter added to scores
  const depth = aiDifficulty === 'hard'
    ? (N <= 3 ? 4 : N <= 5 ? 4 : N <= 7 ? 3 : 2)
    : aiDifficulty === 'easy'
    ? 1
    : (N <= 3 ? 4 : N <= 5 ? 3 : 2);                          // medium

  const rootCands = aiDifficulty === 'hard'
    ? (N <= 3 ? 25 : N <= 5 ? 20 : N <= 7 ? 14 : 8)
    : aiDifficulty === 'easy'
    ? 5
    : (N <= 3 ? 20 : N <= 5 ? 15 : N <= 7 ? 10 : 6);          // medium

  const deepCands = aiDifficulty === 'hard'
    ? (N <= 3 ? 15 : N <= 5 ? 10 : N <= 7 ? 7 : 5)
    : aiDifficulty === 'easy'
    ? 3
    : (N <= 3 ? 12 : N <= 5 ? 8  : N <= 7 ? 5 : 4);           // medium

  const noise = aiDifficulty === 'hard' ? 0 : aiDifficulty === 'easy' ? 50 : 5;

  // ── Pass evaluation ──────────────────────────────────────────────────────────
  // Score of PASSING = run a shallow search where the opponent moves first.
  // If no placement beats this, the AI should pass instead of wasting a move.
  // Skipped during the opening so the AI always plays in the early game.
  const passDepth = Math.min(depth - 1, 2);
  const passScore = (phase !== 'opening')
    ? minimax(board, passDepth, -Infinity, Infinity, false, player, phase, deepCands)
    : -Infinity;

  // Order root candidates by 1-ply score so the best moves are searched first
  // (this maximises how often alpha-beta can prune early)
  const rootCandidates = moves
    .map(([x, y, z]) => ({ move: [x, y, z], h: score1ply(x, y, z, player, board, phase) }))
    .sort((a, b) => b.h - a.h)
    .slice(0, rootCands);

  let best = null, bestNoisyScore = -Infinity, bestCleanScore = -Infinity;

  for (const { move: [x, y, z] } of rootCandidates) {
    const result = simApply(board, x, y, z, player);
    if (!result) continue;

    // Search from opponent's perspective one level down
    const s = minimax(result.b, depth - 1, -Infinity, Infinity, false, player, phase, deepCands);
    const noisy = s + Math.random() * noise;

    if (noisy > bestNoisyScore) {
      bestNoisyScore = noisy;
      bestCleanScore = s;   // track clean score for pass comparison
      best = [x, y, z];
    }
  }

  // Pass if no move is genuinely better than passing.
  // A small margin (+5) favours playing over passing when scores are virtually equal,
  // but correctly passes when all remaining moves just fill settled territory.
  if (best === null || bestCleanScore <= passScore + 5) return null;

  return best;
}
