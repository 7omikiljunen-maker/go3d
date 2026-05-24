// ─── ai.js — 2-ply heuristic AI with opening strategy ────────────────────────
import { N, board, legalMoves } from './board.js';

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
  // Opening lasts roughly until each player has placed N² / 2 stones each
  const openingEnd = Math.max(Math.floor(N * N * 0.4), N * 2);
  const midEnd     = Math.floor(N * N * N * 0.5);
  if (count < openingEnd) return 'opening';
  if (count < midEnd)     return 'midgame';
  return 'endgame';
}

// ─── Opening strategy helpers ─────────────────────────────────────────────────

// "Star point" coordinates for each board size.
// These are the high-influence starting positions, analogous to 4-4 in 2D Go.
function starCoordSet() {
  // Returns which indices along one axis are star-point positions
  if (N === 3) return new Set([1]);           // just the centre slice
  if (N === 5) return new Set([1, 3]);        // one-in from each edge
  if (N === 7) return new Set([2, 4]);        // two-in from each edge
  return      new Set([2, 4, 6]);             // 9³: three bands
}

function isStarPoint(x, y, z) {
  const sc = starCoordSet();
  if (sc.has(x) && sc.has(y) && sc.has(z)) return true;
  // Always include the geometric centre regardless of star coord set
  const c = (N - 1) / 2;
  return x === c && y === c && z === c;
}

// How "exposed" is this point: 0 = fully interior, 1 = on a face, 2 = on an edge, 3 = corner
function edgeDegree(x, y, z) {
  return ([0, N-1].includes(x) ? 1 : 0)
       + ([0, N-1].includes(y) ? 1 : 0)
       + ([0, N-1].includes(z) ? 1 : 0);
}

// Does the player already have at least one stone in horizontal layer `y`?
function playerInLayer(brd, y, player) {
  for (let x=0; x<N; x++) for (let z=0; z<N; z++)
    if (brd[x][y][z] === player) return true;
  return false;
}

// Opening-phase bonus: star points, layer spread, corner avoidance
function openingBonus(x, y, z, player, brd) {
  let bonus = 0;

  // ── Star points ────────────────────────────────────────────────────────────
  if (isStarPoint(x, y, z)) {
    bonus += 100;
  } else {
    // Smaller bonus for being one step away from a star point
    for (const [nx, ny, nz] of simNeighbors(x, y, z)) {
      if (isStarPoint(nx, ny, nz)) { bonus += 30; break; }
    }
  }

  // ── Layer spread (3D-specific) ─────────────────────────────────────────────
  // Playing in a new layer expands your 3D presence — reward it.
  if (!playerInLayer(brd, y, player)) bonus += 50;

  // ── Structural penalties ───────────────────────────────────────────────────
  // In 3D Go, corners and edges are *weak* (fewer liberties), unlike 2D Go.
  // Corner: 3 liberties  |  Edge: 4 liberties  |  Face: 5  |  Interior: 6
  const ed = edgeDegree(x, y, z);
  if (ed === 3) bonus -= 90;   // corner — avoid in opening
  if (ed === 2) bonus -= 40;   // edge   — slightly discouraged
  if (ed === 1) bonus -= 10;   // face   — mild penalty

  return bonus;
}

// ─── 1-ply heuristic score for a move ────────────────────────────────────────
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
      if (liberties.length > 1) s += 50;
    }
    if (b[nx][ny][nz] === opp) {
      const { liberties } = simGetGroup(b, nx, ny, nz);
      if (liberties.length === 1) s += 80;
    }
  }

  const nearStone = simNeighbors(x, y, z).some(([nx, ny, nz]) => brd[nx][ny][nz] !== 0);
  if (nearStone) s += 30;

  // Centre preference — stronger in 3D than in 2D Go
  const cx2 = x - (N-1)/2, cy2 = y - (N-1)/2, cz2 = z - (N-1)/2;
  s += 20 - Math.sqrt(cx2*cx2 + cy2*cy2 + cz2*cz2) * 3;

  // Opening: star points, layer spread, no weak corners
  if (phase === 'opening') s += openingBonus(x, y, z, player, brd);

  return s;
}

// ─── Main AI entry point (2-ply: my best move minus opponent's best response) ─
export function aiMove(player) {
  const moves = legalMoves(player);
  if (moves.length === 0) return null;

  const phase = getPhase();
  const opp = 3 - player;

  // Score all moves with 1-ply heuristic + opening strategy
  const scored = moves
    .map(([x, y, z]) => ({ move: [x, y, z], h: score1ply(x, y, z, player, board, phase) }))
    .sort((a, b) => b.h - a.h);

  // Fewer 2-ply candidates for larger boards to stay responsive
  const maxCandidates = N <= 5 ? 20 : N <= 7 ? 12 : 6;
  const candidates = scored.slice(0, Math.min(maxCandidates, scored.length));

  let best = null, bestScore = -Infinity;

  for (const { move: [x, y, z], h } of candidates) {
    const result = simApply(board, x, y, z, player);
    if (!result) continue;

    // Find opponent's best immediate capture in response
    let maxOppCapture = 0;
    for (let ox = 0; ox < N; ox++) {
      for (let oy = 0; oy < N; oy++) {
        for (let oz = 0; oz < N; oz++) {
          if (result.b[ox][oy][oz] !== 0) continue;
          const or2 = simApply(result.b, ox, oy, oz, opp);
          if (or2 && or2.captured > maxOppCapture) maxOppCapture = or2.captured;
        }
      }
    }

    const finalScore = h - maxOppCapture * 180 + Math.random() * 8;
    if (finalScore > bestScore) { bestScore = finalScore; best = [x, y, z]; }
  }

  return best ?? scored[0].move;
}
