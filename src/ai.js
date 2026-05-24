// ─── ai.js — heuristic AI ────────────────────────────────────────────────────
import { N, board, neighbors, getGroup, legalMoves } from './board.js';

export function aiMove(player) {
  const moves = legalMoves(player);
  if (moves.length === 0) return null;
  const opp = 3 - player;

  function scoreMove(x, y, z) {
    let s = 0;
    const b = board.map(a => a.map(r => [...r]));
    b[x][y][z] = player;
    let captured = [];
    for (const [nx, ny, nz] of neighbors(x, y, z)) {
      if (b[nx][ny][nz] === opp) {
        const { stones, liberties } = getGroup(b, nx, ny, nz);
        if (liberties.length === 0) captured = [...captured, ...stones];
      }
    }
    for (const [cx, cy, cz] of captured) b[cx][cy][cz] = 0;

    s += captured.length * 200;   // captures are great

    for (const [nx, ny, nz] of neighbors(x, y, z)) {
      if (b[nx][ny][nz] === player) {
        const { liberties } = getGroup(b, nx, ny, nz);
        if (liberties.length > 1) s += 50;   // saving own group
      }
      if (b[nx][ny][nz] === opp) {
        const { liberties } = getGroup(b, nx, ny, nz);
        if (liberties.length === 1) s += 80;  // putting opponent in atari
      }
    }

    // prefer playing near existing stones
    const nearStone = neighbors(x, y, z).some(([nx, ny, nz]) => board[nx][ny][nz] !== 0);
    if (nearStone) s += 30;

    // prefer centre
    const cx2 = x - (N - 1) / 2, cy2 = y - (N - 1) / 2, cz2 = z - (N - 1) / 2;
    s += 20 - Math.sqrt(cx2*cx2 + cy2*cy2 + cz2*cz2) * 3;

    s += Math.random() * 10;  // tiebreak
    return s;
  }

  let best = null, bestScore = -Infinity;
  for (const [x, y, z] of moves) {
    const s = scoreMove(x, y, z);
    if (s > bestScore) { bestScore = s; best = [x, y, z]; }
  }
  return best;
}
