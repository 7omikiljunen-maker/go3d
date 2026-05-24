// ─── ai.js — 2-ply heuristic AI ──────────────────────────────────────────────
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

function simKey(x, y, z) { return `${x},${y},${z}`; }

function simGetGroup(brd, x, y, z) {
  const color = brd[x][y][z];
  if (!color) return { stones: [], liberties: [] };
  const visited = new Set(), liberties = new Set();
  const stack = [[x, y, z]]; visited.add(simKey(x, y, z));
  while (stack.length) {
    const [cx, cy, cz] = stack.pop();
    for (const [nx, ny, nz] of simNeighbors(cx, cy, cz)) {
      const k = simKey(nx, ny, nz);
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
  if (liberties.length === 0 && captured.length === 0) return null; // suicide
  return { b, captured: captured.length };
}

// ─── 1-ply heuristic score for a move ────────────────────────────────────────
function score1ply(x, y, z, player, brd) {
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
      if (liberties.length > 1) s += 50;  // own group has room
    }
    if (b[nx][ny][nz] === opp) {
      const { liberties } = simGetGroup(b, nx, ny, nz);
      if (liberties.length === 1) s += 80; // put opponent in atari
    }
  }

  const nearStone = simNeighbors(x, y, z).some(([nx, ny, nz]) => brd[nx][ny][nz] !== 0);
  if (nearStone) s += 30;

  const cx2 = x - (N-1)/2, cy2 = y - (N-1)/2, cz2 = z - (N-1)/2;
  s += 20 - Math.sqrt(cx2*cx2 + cy2*cy2 + cz2*cz2) * 3;

  return s;
}

// ─── Main AI entry point (2-ply: my best move minus opponent's best response) ─
export function aiMove(player) {
  const moves = legalMoves(player);
  if (moves.length === 0) return null;
  const opp = 3 - player;

  // Score all moves with 1-ply heuristic, keep top candidates for 2-ply
  const scored = moves
    .map(([x, y, z]) => ({ move: [x, y, z], h: score1ply(x, y, z, player, board) }))
    .sort((a, b) => b.h - a.h);

  // Fewer 2-ply candidates for larger boards to stay responsive
  const maxCandidates = N <= 5 ? 20 : N <= 7 ? 12 : 6;
  const candidateCount = Math.min(maxCandidates, scored.length);
  const candidates = scored.slice(0, candidateCount);

  let best = null, bestScore = -Infinity;

  for (const { move: [x, y, z], h } of candidates) {
    const result = simApply(board, x, y, z, player);
    if (!result) continue; // suicide (shouldn't happen after isLegal, but be safe)

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

    // Final score: my heuristic minus what opponent can immediately take back
    const finalScore = h - maxOppCapture * 180 + Math.random() * 8;
    if (finalScore > bestScore) { bestScore = finalScore; best = [x, y, z]; }
  }

  return best ?? scored[0].move;
}
