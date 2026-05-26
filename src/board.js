// ─── board.js — game state, legality, captures, ko, territory ────────────────

export let N = 5;
export let board, current, captures, consecutivePasses, gameOver, koState, lastPlaced, layerVisible;
export let scoringMode  = 'both';
export let playMode     = 'pvc';
export let komi         = 6.5;
export let aiDifficulty = 'medium'; // 'easy' | 'medium' | 'hard'
export let history      = [];   // undo stack

export function setN(n)              { N = n; }
export function setScoringMode(m)    { scoringMode = m; }
export function setPlayMode(m)       { playMode = m; }
export function setKomi(k)           { komi = k; }
export function setAiDifficulty(d)   { aiDifficulty = d; }

// ─── Board config per size ───────────────────────────────────────────────────
export function cfg(n) {
  if (n === 3) return { sp: 1.4,  stoneR: 0.44, hintR: 0.34, dotR: 0.07,  camR: 10 };
  if (n === 5) return { sp: 1.0,  stoneR: 0.38, hintR: 0.28, dotR: 0.055, camR: 16 };
  if (n === 7) return { sp: 0.82, stoneR: 0.28, hintR: 0.22, dotR: 0.045, camR: 22 };
  /*  9  */    return { sp: 0.65, stoneR: 0.20, hintR: 0.15, dotR: 0.028, camR: 32 };
}

export let C   = cfg(5);
export let SP  = C.sp;
export let OFF = -(5 - 1) / 2 * C.sp;

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function stoneKey(x, y, z) { return `${x},${y},${z}`; }
export function boardStr(b) { return b.map(p => p.map(r => r.join('')).join('')).join(''); }

export function neighbors(x, y, z) {
  const ns = [];
  for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
    const nx = x+dx, ny = y+dy, nz = z+dz;
    if (nx>=0 && nx<N && ny>=0 && ny<N && nz>=0 && nz<N) ns.push([nx, ny, nz]);
  }
  return ns;
}

export function getGroup(brd, x, y, z) {
  const color = brd[x][y][z];
  if (!color) return { stones: [], liberties: [] };
  const visited = new Set(), liberties = new Set();
  const stack = [[x, y, z]]; visited.add(stoneKey(x, y, z));
  while (stack.length) {
    const [cx, cy, cz] = stack.pop();
    for (const [nx, ny, nz] of neighbors(cx, cy, cz)) {
      const k = stoneKey(nx, ny, nz);
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

// ─── Territory flood-fill ────────────────────────────────────────────────────
export function computeTerritory(brd) {
  const ownership = Array(N).fill(null).map(() =>
    Array(N).fill(null).map(() => Array(N).fill(0))
  );
  const visited = new Set();
  let black = 0, white = 0, neutral = 0;
  for (let sx=0; sx<N; sx++) for (let sy=0; sy<N; sy++) for (let sz=0; sz<N; sz++) {
    const sk = stoneKey(sx, sy, sz);
    if (brd[sx][sy][sz] !== 0 || visited.has(sk)) continue;
    const region = [], borders = new Set();
    const stack = [[sx, sy, sz]]; visited.add(sk);
    while (stack.length) {
      const [cx, cy, cz] = stack.pop(); region.push([cx, cy, cz]);
      for (const [nx, ny, nz] of neighbors(cx, cy, cz)) {
        const nk = stoneKey(nx, ny, nz);
        if (brd[nx][ny][nz] !== 0) borders.add(brd[nx][ny][nz]);
        else if (!visited.has(nk)) { visited.add(nk); stack.push([nx, ny, nz]); }
      }
    }
    const owner = borders.size === 1 ? [...borders][0] : 0;
    for (const [rx, ry, rz] of region) {
      ownership[rx][ry][rz] = owner;
      if (owner === 1) black++; else if (owner === 2) white++; else neutral++;
    }
  }
  return { black, white, neutral, ownership };
}

// ─── Legality check ──────────────────────────────────────────────────────────
export function isLegal(x, y, z, player, brd, ko) {
  if (brd[x][y][z] !== 0) return false;
  const b = brd.map(a => a.map(r => [...r]));
  b[x][y][z] = player;
  const opp = 3 - player;
  let captured = [];
  for (const [nx, ny, nz] of neighbors(x, y, z)) {
    if (b[nx][ny][nz] === opp) {
      const { stones, liberties } = getGroup(b, nx, ny, nz);
      if (liberties.length === 0) captured = [...captured, ...stones];
    }
  }
  for (const [cx, cy, cz] of captured) b[cx][cy][cz] = 0;
  const { liberties } = getGroup(b, x, y, z);
  if (liberties.length === 0 && captured.length === 0) return false;
  if (ko && boardStr(b) === ko) return false;
  return true;
}

export function legalMoves(player) {
  const moves = [];
  for (let x=0; x<N; x++) for (let y=0; y<N; y++) for (let z=0; z<N; z++)
    if (isLegal(x, y, z, player, board, koState)) moves.push([x, y, z]);
  return moves;
}

// ─── Undo history ─────────────────────────────────────────────────────────────
function pushHistory() {
  history.push({
    board: board.map(a => a.map(r => [...r])),
    current,
    captures: [...captures],
    koState,
    lastPlaced: lastPlaced ? { ...lastPlaced } : null,
    consecutivePasses,
  });
  if (history.length > 30) history.shift(); // cap at 30 entries
}

export function undoMove() {
  if (history.length === 0) return false;
  const s = history.pop();
  board             = s.board;
  current           = s.current;
  captures          = s.captures;
  koState           = s.koState;
  lastPlaced        = s.lastPlaced;
  consecutivePasses = s.consecutivePasses;
  gameOver          = false;
  return true;
}

// ─── localStorage save / load ────────────────────────────────────────────────
export function saveToStorage() {
  try {
    localStorage.setItem('go3d_save', JSON.stringify({
      N, board, current, captures, consecutivePasses,
      koState, lastPlaced, layerVisible,
      scoringMode, playMode, komi,
      history: history.slice(-20),
    }));
  } catch (_) {}
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem('go3d_save');
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s || !s.board || !s.N) return false;
    N                = s.N;
    board            = s.board;
    current          = s.current          ?? 1;
    captures         = s.captures         ?? [0, 0];
    consecutivePasses= s.consecutivePasses?? 0;
    koState          = s.koState          ?? null;
    lastPlaced       = s.lastPlaced       ?? null;
    layerVisible     = s.layerVisible     ?? Array(N).fill(true);
    scoringMode      = s.scoringMode      ?? 'both';
    playMode         = s.playMode         ?? 'pvc';
    komi             = s.komi             ?? 6.5;
    history          = s.history          ?? [];
    gameOver         = false;
    C   = cfg(N);
    SP  = C.sp;
    OFF = -(N - 1) / 2 * SP;
    return true;
  } catch (_) { return false; }
}

export function clearStorage() {
  localStorage.removeItem('go3d_save');
}

// ─── Board init ──────────────────────────────────────────────────────────────
export function initBoard() {
  board = Array(N).fill(null).map(() =>
    Array(N).fill(null).map(() => Array(N).fill(0))
  );
  current = 1; captures = [0, 0]; consecutivePasses = 0;
  gameOver = false; koState = null; lastPlaced = null;
  layerVisible = Array(N).fill(true);
  history = [];
  C = cfg(N); SP = C.sp; OFF = -(N - 1) / 2 * SP;
}

// ─── Place a stone (mutates module state) ────────────────────────────────────
export function placeStone(x, y, z) {
  if (gameOver || board[x][y][z] !== 0) return { ok: false };
  if (!isLegal(x, y, z, current, board, koState)) return { ok: false };

  pushHistory(); // save snapshot for undo

  const prevStr = boardStr(board);
  const brd = board.map(a => a.map(b => [...b]));
  brd[x][y][z] = current;
  const opp = 3 - current;
  let captured = [];
  for (const [nx, ny, nz] of neighbors(x, y, z)) {
    if (brd[nx][ny][nz] === opp) {
      const { stones, liberties } = getGroup(brd, nx, ny, nz);
      if (liberties.length === 0) captured = [...captured, ...stones];
    }
  }
  for (const [cx, cy, cz] of captured) brd[cx][cy][cz] = 0;
  board = brd;
  koState = captured.length === 1 ? prevStr : null;
  consecutivePasses = 0;
  captures[current - 1] += captured.length;
  lastPlaced = { x, y, z };
  const color = current;
  current = opp;
  return { ok: true, captured, color };
}

export function doPass() {
  consecutivePasses++;
  current = 3 - current;
  koState = null;
  return consecutivePasses >= 2;
}

export function setGameOver(v) { gameOver = v; }
export function setLayerVisible(y, v) { layerVisible[y] = v; }

// ─── Apply full state received from Firebase (online multiplayer) ─────────────
export function applyRemoteState(data) {
  board             = data.board;
  current           = data.current;
  captures          = [data.capturesBlack ?? 0, data.capturesWhite ?? 0];
  consecutivePasses = data.consecutivePasses ?? 0;
  gameOver          = data.gameOver ?? false;
  koState           = data.koState ?? null;
  lastPlaced        = (data.lastX != null)
    ? { x: data.lastX, y: data.lastY, z: data.lastZ }
    : null;
}
