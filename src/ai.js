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
  if (N === 9) return new Set([2, 4, 6]);
  /*  11 */    return new Set([2, 5, 8]);
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

// ─── MCTS — used for Hard difficulty ─────────────────────────────────────────
// UCT (UCB1 applied to Trees) with random rollouts and a fast neighbour-scan
// heuristic (_qs) for move ordering.  All boards are flat Int8Arrays so copies
// are essentially a single memcpy — much cheaper than nested JS arrays.

const _MC_C  = 1.41;   // UCB1 exploration constant (≈ √2)
const _MC_RD = 25;     // max moves per rollout
const _MC_K  = 10;     // expansion candidates per node
const _D6    = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

function _fi(x, y, z) { return x*N*N + y*N + z; }

// Snapshot current board → flat Int8Array
function _flat() {
  const f = new Int8Array(N*N*N);
  for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++)
    f[_fi(x,y,z)] = board[x][y][z];
  return f;
}

// BFS group on a flat board → { stones:[idx,...], libs:number }
function _grp(f, si) {
  const c = f[si]; if (!c) return { stones:[], libs:0 };
  const sz = N*N*N;
  const vis = new Uint8Array(sz), lv = new Uint8Array(sz);
  vis[si] = 1;
  const stk = [si], stones = [si]; let libs = 0;
  while (stk.length) {
    const i = stk.pop();
    const x=(i/(N*N))|0, r=i%(N*N), y=(r/N)|0, z=r%N;
    for (const [dx,dy,dz] of _D6) {
      const nx=x+dx, ny=y+dy, nz=z+dz;
      if (nx<0||nx>=N||ny<0||ny>=N||nz<0||nz>=N) continue;
      const ni = _fi(nx,ny,nz);
      if      (f[ni]===0 && !lv[ni])            { lv[ni]=1; libs++; }
      else if (f[ni]===c  && !vis[ni])           { vis[ni]=1; stk.push(ni); stones.push(ni); }
    }
  }
  return { stones, libs };
}

// Apply [x,y,z] to a flat copy → new board or null (occupied / suicide)
function _apply(f, x, y, z, pl) {
  const pi = _fi(x,y,z); if (f[pi]!==0) return null;
  const b = new Int8Array(f);
  b[pi] = pl;
  const opp = 3-pl;
  for (const [dx,dy,dz] of _D6) {
    const nx=x+dx, ny=y+dy, nz=z+dz;
    if (nx<0||nx>=N||ny<0||ny>=N||nz<0||nz>=N) continue;
    const ni = _fi(nx,ny,nz);
    if (b[ni]!==opp) continue;
    const { stones, libs } = _grp(b, ni);
    if (libs===0) for (const s of stones) b[s]=0;
  }
  if (_grp(b, pi).libs===0) return null; // suicide
  return b;
}

// O(1) neighbour-scan heuristic — no allocation, no board copy
// Rewards captures, ataris, connectivity, and centrality.
function _qs(f, x, y, z, pl) {
  const opp = 3-pl; let s = 0;
  for (const [dx,dy,dz] of _D6) {
    const nx=x+dx, ny=y+dy, nz=z+dz;
    if (nx<0||nx>=N||ny<0||ny>=N||nz<0||nz>=N) continue;
    const ni = _fi(nx,ny,nz);
    if (f[ni]===opp) {
      // Estimate libs of enemy neighbour from its own direct neighbours.
      // Subtract 1 because we're about to fill one of those liberties.
      let e = -1;
      for (const [dx2,dy2,dz2] of _D6) {
        const nnx=nx+dx2, nny=ny+dy2, nnz=nz+dz2;
        if (nnx<0||nnx>=N||nny<0||nny>=N||nnz<0||nnz>=N) continue;
        if (f[_fi(nnx,nny,nnz)]===0) e++;
      }
      if      (e<=0) s+=250;   // likely capture
      else if (e===1) s+=80;   // likely atari
      else           s+=8;
    } else if (f[ni]===pl) s+=12;
  }
  const cx=x-(N-1)/2, cy=y-(N-1)/2, cz=z-(N-1)/2;
  s += 22 - Math.sqrt(cx*cx+cy*cy+cz*cz)*3;
  return s;
}

// Top-K candidate moves by _qs (legality checked lazily during expansion)
function _topK(f, pl, k) {
  const sz = N*N*N, scored = [];
  for (let i=0; i<sz; i++) {
    if (f[i]!==0) continue;
    const x=(i/(N*N))|0, r=i%(N*N), y=(r/N)|0, z=r%N;
    scored.push({ x, y, z, s: _qs(f,x,y,z,pl) + Math.random()*6 });
  }
  scored.sort((a,b) => b.s - a.s);
  return scored.slice(0, k).map(({ x, y, z }) => [x, y, z]);
}

// Random rollout limited to _MC_RD moves.
// Returns 1 if aiPl leads by stone count at the end, else 0.
function _rollout(f, curPl, aiPl) {
  let b = new Int8Array(f), p = curPl, passes = 0;
  const sz = N*N*N;
  for (let d=0; d<_MC_RD && passes<2; d++) {
    let moved = false;
    for (let t=0; t<12 && !moved; t++) {
      const i = (Math.random()*sz)|0;
      if (b[i]!==0) continue;
      const x=(i/(N*N))|0, r=i%(N*N), y=(r/N)|0, z=r%N;
      const nb = _apply(b,x,y,z,p);
      if (nb) { b=nb; moved=true; }
    }
    if (moved) passes=0; else passes++;
    p = 3-p;
  }
  let ai=0, op=0;
  for (let i=0;i<sz;i++) { if(b[i]===aiPl) ai++; else if(b[i]) op++; }
  return ai >= op ? 1 : 0;
}

// MCTS node factory
function _node(brd, player, move, parent) {
  return { brd, player, move, parent, wins:0, visits:0, children:[], untried:null };
}

// UCB1 score
function _ucb(n, pv) {
  if (!n.visits) return Infinity;
  return n.wins/n.visits + _MC_C * Math.sqrt(Math.log(pv)/n.visits);
}

// Walk down the tree to the most promising under-explored node
function _select(root) {
  let n = root;
  while ((n.untried===null || n.untried.length===0) && n.children.length>0) {
    const pv = n.visits;
    n = n.children.reduce((b,c) => _ucb(c,pv) > _ucb(b,pv) ? c : b);
  }
  return n;
}

// Main MCTS function — returns [x,y,z] or null (pass)
function mctsMove(player) {
  const flat = _flat();
  const root = _node(flat, player, null, null);
  root.untried = _topK(flat, player, _MC_K);

  const thinkMs  = N <= 3 ? 1500 : N <= 5 ? 2000 : 3000; // scales with board size
  const deadline = Date.now() + thinkMs;

  while (Date.now() < deadline) {
    // 1. Select
    let node = _select(root);

    // 2. Expand — try candidates until a legal one is found
    if (node.untried===null) node.untried = _topK(node.brd, node.player, _MC_K);
    let expanded = false;
    while (node.untried.length>0 && !expanded) {
      const [x,y,z] = node.untried.pop();
      const nb = _apply(node.brd, x, y, z, node.player);
      if (nb) {
        const child = _node(nb, 3-node.player, [x,y,z], node);
        node.children.push(child);
        node = child;
        expanded = true;
      }
    }

    // 3. Rollout
    const result = _rollout(node.brd, node.player, player);

    // 4. Backpropagate
    let n = node;
    while (n) { n.visits++; n.wins+=result; n=n.parent; }
  }

  if (!root.children.length) return null;
  return root.children.reduce((a,b) => a.visits>b.visits ? a : b).move;
}

// ─── Main AI entry point ──────────────────────────────────────────────────────
export function aiMove(player) {
  const moves = legalMoves(player);
  if (moves.length === 0) return null;

  // Hard: MCTS on small boards (enough iterations to be strong),
  //       minimax on large boards (too few MCTS iterations to beat a good eval function)
  if (aiDifficulty === 'hard' && N <= 5) return mctsMove(player);

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
