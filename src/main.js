// ─── main.js — entry point, wires everything together ────────────────────────
import {
  N, setN, board, current, captures, consecutivePasses, gameOver,
  koState, lastPlaced, layerVisible,
  scoringMode, playMode, setPlayMode,
  aiDifficulty, setAiDifficulty,
  komi,
  history,
  initBoard, placeStone, doPass, setGameOver, setLayerVisible,
  isLegal, legalMoves, cfg,
  undoMove,
  saveToStorage, loadFromStorage, clearStorage,
  applyRemoteState,
} from './board.js';

import { aiMove } from './ai.js';
import { playStoneSound, playCaptureSound, soundEnabled, setSoundEnabled } from './audio.js';

import {
  initRenderer, resizeRenderer, startRenderLoop,
  buildGrid, buildDots, clearScene,
  addStoneMesh, removeStonesMesh, rebuildStoneMeshes,
  updateHints, showTerritory, clearTerritory, toggleTerritory, syncLayerVisibility,
  setSceneBg, setOnFrame,
  camera,
} from './renderer.js';

import {
  setRadius, updateCamera,
  attachMouseControls, attachTouchControls, pickIntersection,
  autoRotateTick, bumpDragTime,
} from './controls.js';

import {
  buildLayerButtons, updateUI, updateAiBtn, updateUndoBtn,
  showOverlay, hideOverlay, initScoringBtn, syncScoringBtn,
} from './ui.js';

import { signInWithGoogle, signInAnonymously, signOut, onAuthChange, resolveRedirect } from './auth.js';
import { track } from './track.js';
import { checkPaid, watchPaid } from './payment.js';

import {
  createRoom, joinRoom, rejoinRoom, subscribeRoom, pushGameState,
  sendChat, subscribeChat, signalLeave, leaveRoom, deleteRoom,
  sendUndoRequest, sendUndoResponse,
  roomCode, myPlayer, isOnline, unflattenBoard,
} from './multiplayer.js';

// ─── Custom confirm dialog ────────────────────────────────────────────────────
function showConfirm(msg) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-msg').textContent = msg;
    modal.classList.add('open');
    const cleanup = (result) => {
      modal.classList.remove('open');
      document.getElementById('confirmOk').removeEventListener('click', onOk);
      document.getElementById('confirmCancel').removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk     = () => cleanup(true);
    const onCancel = () => cleanup(false);
    document.getElementById('confirmOk').addEventListener('click', onOk);
    document.getElementById('confirmCancel').addEventListener('click', onCancel);
  });
}

// ─── Auth state ───────────────────────────────────────────────────────────────
let currentUser = null;

function updateAuthUI() {
  const el = document.getElementById('authStatus');
  if (!el) return;
  // Anonymous users (auto-signed-in guests) are treated as "not signed in" for
  // the create-game UI — they have no displayName/email, and any payment they
  // made would be tied to a UID that vanishes when cookies are cleared.
  if (currentUser && !currentUser.isAnonymous) {
    el.innerHTML =
      `Signed in as <b>${currentUser.displayName ?? currentUser.email}</b> &nbsp;·&nbsp; <a id="signOutLink">Sign out</a>`;
    document.getElementById('signOutLink').onclick = () => signOut();
  } else {
    el.textContent = 'Sign in required to create a game';
  }
}

onAuthChange(user => {
  currentUser = user;
  updateAuthUI();
});

// ─── Handle redirect sign-in (mobile) ────────────────────────────────────────
// Call resolveRedirect() unconditionally — Firebase needs this every page load
// to finalize any pending redirect (especially in iOS Private Browsing where
// sessionStorage may have been cleared between the redirect-out and back).
// Only re-open the modal if pendingCreateGame was set.
resolveRedirect().then(result => {
  if (!result) return;
  currentUser = result.user;
  updateAuthUI();
  if (sessionStorage.getItem('pendingCreateGame')) {
    sessionStorage.removeItem('pendingCreateGame');
    onlineModal.style.display = 'flex';    // re-open the online modal
  }
}).catch(() => {});

// ─── Canvas & renderer init ───────────────────────────────────────────────────
const canvas = document.getElementById('c');
initRenderer(canvas);

// ─── UI element refs ──────────────────────────────────────────────────────────
const app           = document.getElementById('app');
const onlineModal   = document.getElementById('online-modal');
const waitingOvl    = document.getElementById('waiting-overlay');
const chatPanel     = document.getElementById('chat-panel');
const chatMessages  = document.getElementById('chat-messages');
const chatInput     = document.getElementById('chatInput');
const chatBadge     = document.getElementById('chatBadge');
const roomCodeText  = document.getElementById('roomCodeText');
const displayCode   = document.getElementById('displayCode');
const joinError     = document.getElementById('joinError');
const resetBtn      = document.getElementById('resetBtn');

// ─── Helpers (read live board.js bindings at call time) ──────────────────────
function isComputerTurn() {
  if (isOnline)              return false; // never AI in online game
  if (playMode === 'cvc')    return true;
  if (playMode === 'pvc' && current === 2) return true;
  return false;
}

function isMyOnlineTurn() {
  return isOnline && current === myPlayer;
}

function refreshHints() {
  updateHints(current, gameOver, isComputerTurn, isLegal, koState);
}

function refreshUI() {
  updateUI(current, captures, isComputerTurn);
  // Compute automove button status: pending (timer running) > paused > idle
  const status = automoveTimer ? 'pending'
               : (automoveEnabled && automovePaused) ? 'paused'
               : 'idle';
  updateAiBtn(gameOver, playMode, current, status);
  // Disable undo only while waiting for the opponent's undo response
  updateUndoBtn(history.length, waitingForUndoResponse);
}

// ─── Automove (AI plays automatically in PvC / CvC) ──────────────────────────
// Two pieces of state:
//   automoveEnabled — persistent user preference (Settings → AUTOMOVE)
//   automovePaused  — transient, just for this game. Resets on new game.
let automoveEnabled = localStorage.getItem('go3d-automove') !== '0'; // default ON
let automovePaused  = false;
let automoveTimer   = null;

function cancelAutoMove() {
  if (automoveTimer) {
    clearTimeout(automoveTimer);
    automoveTimer = null;
  }
}

function scheduleAutoMove() {
  cancelAutoMove();
  if (!automoveEnabled || automovePaused || gameOver || isOnline) return;
  if (!isComputerTurn()) return;
  // Don't kick off auto-play while the user is configuring in a modal — they
  // chose a board size / mode in Settings and we shouldn't start moving until
  // they've closed Settings. closeSettings() calls scheduleAutoMove() again.
  if (anyOverlayOpen()) return;
  // PvC: short delay so the player sees their own move land. CvC: slower so
  // it's watchable as the two AIs play through.
  const delay = playMode === 'cvc' ? 1500 : 600;
  automoveTimer = setTimeout(() => {
    automoveTimer = null;
    refreshUI();              // button text flips from "Pause" back to default
    doAiMove();
  }, delay);
  refreshUI();                // button immediately shows "⏸ Pause auto"
}

// ─── Sync UI button active states ────────────────────────────────────────────
function syncSizeButtons() {
  document.querySelectorAll('#sizeButtons button').forEach(b => {
    const n = parseInt(b.dataset.size);
    b.classList.toggle('active', n === N);
    if (n === 11) b.disabled = playMode !== 'pvp';
  });
}

function syncModeButtons() {
  document.querySelectorAll('#modeButtons button[data-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === playMode)
  );
  document.getElementById('onlineBtn').classList.toggle('active', isOnline);
}

function syncDifficultyButtons() {
  document.querySelectorAll('#difficultyButtons button').forEach(b =>
    b.classList.toggle('active', b.dataset.difficulty === aiDifficulty)
  );
}

// ─── Online mode UI helpers ───────────────────────────────────────────────────
function enterOnlineMode() {
  app.classList.add('online-mode');
  resetBtn.textContent = 'Leave';
  startIdleMonitor();
}

function exitOnlineMode() {
  app.classList.remove('online-mode');
  resetBtn.textContent = 'New game';
  chatPanel.style.display = 'none';
  unreadCount = 0;
  chatBadge.style.display = 'none';
  chatMessages.innerHTML = '';
  waitingForUndoResponse = false;
  setUndoBtnText('Undo');
  stopIdleMonitor();
  sessionStorage.removeItem('go3d-online-room');
  sessionStorage.removeItem('go3d-online-player');
}

// ─── Idle monitor (online games) ──────────────────────────────────────────────
//   - Soft notice when opponent has been silent for 15 min
//   - Auto-end game if 24 h pass with no moves
const IDLE_NOTICE_MS  = 15 * 60 * 1000;
const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
let remoteLastMoveAt = 0;
let idleInterval     = null;
const idleBanner     = document.getElementById('idle-banner');

function updateLastMoveAt(ts) {
  if (typeof ts === 'number' && ts > remoteLastMoveAt) remoteLastMoveAt = ts;
  idleBanner.classList.remove('show');   // any update means activity — hide notice
}

function startIdleMonitor() {
  remoteLastMoveAt = Date.now();
  idleBanner.classList.remove('show');
  if (idleInterval) clearInterval(idleInterval);
  idleInterval = setInterval(() => {
    if (!isOnline || gameOver) return;
    const elapsed = Date.now() - remoteLastMoveAt;

    // 24 h timeout — auto-end game
    if (elapsed > IDLE_TIMEOUT_MS) {
      stopIdleMonitor();
      setGameOver(true);
      alert('Game ended: no moves for 24 hours.');
      handleOpponentLeft(true);
      return;
    }

    // 15-min soft notice — only when waiting for opponent
    const waitingForOpponent = current !== myPlayer;
    if (waitingForOpponent && elapsed > IDLE_NOTICE_MS) {
      idleBanner.classList.add('show');
    } else {
      idleBanner.classList.remove('show');
    }
  }, 30 * 1000);   // check every 30 s
}

function stopIdleMonitor() {
  if (idleInterval) { clearInterval(idleInterval); idleInterval = null; }
  idleBanner.classList.remove('show');
}

// ─── Place stone ─────────────────────────────────────────────────────────────
async function tryPlace(x, y, z) {
  const result = placeStone(x, y, z);
  if (!result.ok) return false;
  playStoneSound();
  if (result.captured.length) {
    removeStonesMesh(result.captured);
    // Slight delay so the placement clack lands first, then captures clatter
    setTimeout(() => playCaptureSound(result.captured.length), 80);
  }
  addStoneMesh(x, y, z, result.color);
  if (!isOnline) saveToStorage();
  refreshUI(); refreshHints();

  // Push to Firebase after a successful local move
  if (isOnline) {
    updateLastMoveAt(Date.now());   // reset idle timer locally
    await pushGameState({ board, N, current, captures, consecutivePasses, gameOver, koState, lastPlaced });
  }
  // After a local move, if the next turn is the AI's, chain an automove
  if (!isOnline && !gameOver && isComputerTurn()) scheduleAutoMove();
  return true;
}

// ─── Opponent left notification ───────────────────────────────────────────────
function handleOpponentLeft(gameWasActive) {
  // Always hide the waiting overlay in case we're still there
  waitingOvl.style.display = 'none';
  document.getElementById('overlayTitle').textContent = gameWasActive
    ? '👋 Opponent left'
    : '👋 Nobody joined';
  document.getElementById('overlayBody').textContent = gameWasActive
    ? 'Your opponent has left the game.'
    : 'Your opponent left before the game started.';
  document.getElementById('overlayUndoBtn').style.display = 'none';
  document.getElementById('overlay').style.display = 'flex';
}

// ─── Validate remote room state — defense against malicious Firebase writes ──
// Firebase rules limit WHO can write, but not WHAT they write. Validate every
// field before trusting it. Out-of-range N (e.g. 1000000) would freeze the tab
// inside unflattenBoard's N³ loop, so this check is load-bearing for safety.
const VALID_BOARD_SIZES = [3, 5, 7, 9, 11];

function validateRemoteState(d) {
  if (!d || typeof d !== 'object') return false;
  if (!VALID_BOARD_SIZES.includes(d.N)) return false;
  if (typeof d.board !== 'string' || d.board.length > 100000) return false;
  if (d.current !== 1 && d.current !== 2) return false;

  const capOK = v => typeof v === 'number' && v >= 0 && v <= 10000 && Number.isFinite(v);
  if (!capOK(d.capturesBlack ?? 0)) return false;
  if (!capOK(d.capturesWhite ?? 0)) return false;

  if (d.consecutivePasses != null &&
      (typeof d.consecutivePasses !== 'number' || d.consecutivePasses < 0 || d.consecutivePasses > 10)) {
    return false;
  }
  // lastX/Y/Z must be in range [0, N-1] if set
  const coordOK = v => v == null || (Number.isInteger(v) && v >= 0 && v < d.N);
  if (!coordOK(d.lastX) || !coordOK(d.lastY) || !coordOK(d.lastZ)) return false;

  return true;
}

// ─── Apply opponent's move from Firebase ─────────────────────────────────────
function applyOpponentState(remoteData) {
  if (!validateRemoteState(remoteData)) {
    console.warn('Rejected malformed remote state');
    return;
  }
  const n = remoteData.N;
  let newBoard;
  try {
    const flat = JSON.parse(remoteData.board);
    if (!Array.isArray(flat) || flat.length !== n * n * n) return;
    newBoard = unflattenBoard(flat, n);
  } catch (_) { return; }

  // Snapshot pre-state so we can detect what changed
  const prevTotalCaptures = (captures[0] ?? 0) + (captures[1] ?? 0);
  const prevLast          = lastPlaced
    ? `${lastPlaced.x},${lastPlaced.y},${lastPlaced.z}`
    : '';
  const newLast           = (remoteData.lastX !== null && remoteData.lastX !== undefined)
    ? `${remoteData.lastX},${remoteData.lastY},${remoteData.lastZ}`
    : '';
  const newTotalCaptures  = (remoteData.capturesBlack ?? 0) + (remoteData.capturesWhite ?? 0);
  const opponentCaptured  = Math.max(0, newTotalCaptures - prevTotalCaptures);
  const isNewMove         = newLast !== '' && newLast !== prevLast;

  applyRemoteState({
    board:             newBoard,
    current:           remoteData.current,
    capturesBlack:     remoteData.capturesBlack    ?? 0,
    capturesWhite:     remoteData.capturesWhite    ?? 0,
    consecutivePasses: remoteData.consecutivePasses?? 0,
    gameOver:          remoteData.gameOver         ?? false,
    koState:           remoteData.koState          ?? null,
    lastX:             remoteData.lastX            ?? null,
    lastY:             remoteData.lastY            ?? null,
    lastZ:             remoteData.lastZ            ?? null,
  });
  rebuildStoneMeshes(lastPlaced);
  syncLayerVisibility(lastPlaced);
  refreshUI(); refreshHints();

  // Opponent placed a stone — clack sound + capture clatter if applicable
  if (isNewMove) {
    playStoneSound();
    if (opponentCaptured > 0) {
      setTimeout(() => playCaptureSound(opponentCaptured), 80);
    }
  }

  // Update idle monitor with the freshest move timestamp from the room
  if (remoteData.lastMoveAt) updateLastMoveAt(remoteData.lastMoveAt);

  if (remoteData.gameOver) endGame();
  else hideOverlay(); // in case opponent's undo reversed a game-over on this side
}

// ─── Undo ─────────────────────────────────────────────────────────────────────
let waitingForUndoResponse = false;

function handleUndo() {
  if (history.length === 0) return;

  if (isOnline) { requestOnlineUndo(); return; }

  // Local undo (offline modes, including post-game)
  cancelAutoMove();     // user wants to study — don't fire any queued AI move
  const wasOver = gameOver; // undoMove() clears gameOver; capture it first
  if (!undoMove()) return;
  rebuildStoneMeshes(lastPlaced);
  syncLayerVisibility(lastPlaced);
  if (wasOver) { hideOverlay(); clearTerritory(); }
  saveToStorage();
  refreshUI(); refreshHints();
  // If automove is enabled and undo landed us on an AI turn, auto-resume.
  // To step back further, click Undo again before the AI plays — handleUndo
  // cancels the pending automove first thing, so undos can chain rapidly.
  if (automoveEnabled && !gameOver && isComputerTurn()) {
    scheduleAutoMove();
  }
}

// ─── Online undo — request/response ──────────────────────────────────────────
/** Keep the main undo button and the overlay undo button in sync. */
function setUndoBtnText(text) {
  document.getElementById('undoBtn').textContent        = text;
  document.getElementById('overlayUndoBtn').textContent = text;
}

function requestOnlineUndo() {
  if (waitingForUndoResponse || history.length === 0) return;
  waitingForUndoResponse = true;
  setUndoBtnText('Waiting…');
  refreshUI(); // disables button via waitingForUndoResponse
  sendUndoRequest();
}

/** Called on the RESPONDER's side when opponent requests undo. */
function handleUndoRequest(reqSeq) {
  showConfirm('Opponent wants to undo their last move. Allow?').then(accepted => {
    sendUndoResponse(reqSeq, accepted);
  });
}

/** Called on the REQUESTER's side when opponent responds. */
async function handleUndoResponse(accepted) {
  waitingForUndoResponse = false;
  setUndoBtnText('Undo');

  if (accepted) {
    const wasOver = gameOver;
    if (!undoMove()) { refreshUI(); return; }
    rebuildStoneMeshes(lastPlaced);
    syncLayerVisibility(lastPlaced);
    if (wasOver) { hideOverlay(); clearTerritory(); }
    refreshUI(); refreshHints();
    await pushGameState({ board, N, current, captures, consecutivePasses, gameOver, koState, lastPlaced });
  } else {
    refreshUI(); // re-enable button
    setUndoBtnText('Declined');
    setTimeout(() => setUndoBtnText('Undo'), 2000);
  }
}

// ─── AI move ─────────────────────────────────────────────────────────────────
async function doAiMove() {
  if (gameOver) return;

  // MCTS (Hard) takes ~2 s — show a thinking indicator and yield one frame
  // so the button text renders before the synchronous compute blocks the UI.
  const aiBtn = document.getElementById('aiBtn');
  const isHard = aiDifficulty === 'hard';
  if (isHard) {
    aiBtn.textContent = 'Thinking…';
    aiBtn.disabled = true;
    await new Promise(r => setTimeout(r, 30));
  }

  // Compute the move — wrapped in try/finally so the button NEVER stays stuck
  // on "Thinking…" even if MCTS throws or returns unexpectedly. On error,
  // fall back to a random legal move so the game keeps playing (instead of
  // passing → another pass → immediate game end).
  let move = null;
  try {
    move = aiMove(current);
  } catch (err) {
    // Rich diagnostic so the root cause is visible even without source maps
    console.error('AI compute failed — falling back to random legal move:', err);
    console.error('AI ctx:', {
      message: err && err.message,
      stack:   err && err.stack,
      N, current, aiDifficulty,
      playMode, gameOver,
      koState,
      historyLen: history.length,
    });
    const legal = legalMoves(current);
    if (legal.length > 0) {
      move = legal[Math.floor(Math.random() * legal.length)];
    }
  } finally {
    if (isHard) {
      aiBtn.disabled    = false;
      aiBtn.textContent = '';        // wipe "Thinking…" before refreshUI runs
    }
    refreshUI();                     // immediately re-label the button
  }

  if (!move) {
    const over = doPass();
    if (over) { endGame(); return; }
    refreshUI(); refreshHints();
    // Even on a pass, the next turn might also be AI (CvC) — keep the chain alive
    if (!isOnline && !gameOver && isComputerTurn()) scheduleAutoMove();
    return;
  }
  tryPlace(move[0], move[1], move[2]);
}

// ─── End game ────────────────────────────────────────────────────────────────
function endGame() {
  setGameOver(true);
  cancelAutoMove();
  updateHints(current, true, isComputerTurn, isLegal, koState);

  // Always paint territory visually; only count it in the score if the mode calls for it
  const terrResult = showTerritory();
  const terrForScore = (scoringMode === 'territory' || scoringMode === 'both')
    ? terrResult : { black: 0, white: 0, neutral: 0 };
  showOverlay(captures[0], captures[1], scoringMode, terrForScore, komi);
  // Show overlay undo button only when there is something to undo
  document.getElementById('overlayUndoBtn').style.display = history.length > 0 ? '' : 'none';
  if (!isOnline) clearStorage();
  track('game_completed', {
    mode: isOnline ? 'online' : playMode,
    board_size: N,
    black_captures: captures[0],
    white_captures: captures[1],
  });
}

// ─── Setup / reset ───────────────────────────────────────────────────────────
function setupBoard() {
  cancelAutoMove();        // any pending move from the previous game is stale
  automovePaused = false;  // new game = unpaused (pause is per-game only)
  clearScene();
  initBoard();
  if (!isOnline) clearStorage();
  setRadius(cfg(N).camR);
  updateCamera();
  bumpDragTime();   // give the user 1 s to see the freshly-positioned board
  buildGrid();
  buildDots();
  buildLayerButtons(handleLayerToggle);
  syncSizeButtons();
  syncModeButtons();
  syncDifficultyButtons();
  syncScoringBtn();
  refreshUI(); refreshHints();
  hideOverlay();
  // CvC starts with AI on move 1; kick off the chain if automove is on.
  if (!isOnline && isComputerTurn()) scheduleAutoMove();
}

// ─── Restore visual state after loadFromStorage ───────────────────────────────
function restoreFromSave() {
  clearScene();
  setRadius(cfg(N).camR);
  updateCamera();
  buildGrid();
  buildDots();
  buildLayerButtons(handleLayerToggle);
  rebuildStoneMeshes(lastPlaced);
  syncSizeButtons();
  syncModeButtons();
  syncDifficultyButtons();
  syncScoringBtn();
  refreshUI(); refreshHints();
  hideOverlay();
}

// ─── Layer toggle callback ────────────────────────────────────────────────────
function handleLayerToggle() {
  buildGrid();
  syncLayerVisibility(lastPlaced);
  refreshHints();
}

// ─── Click handler ───────────────────────────────────────────────────────────
function handleClickAt(cx, cy) {
  if (gameOver) return;
  if (isOnline) {
    if (current !== myPlayer) return; // not your turn
  } else {
    if (isComputerTurn()) return;
  }
  const hit = pickIntersection(cx, cy, canvas);
  if (hit) tryPlace(hit.x, hit.y, hit.z);
}

// ─── Button wiring (local game) ───────────────────────────────────────────────
document.getElementById('passBtn').onclick = async () => {
  if (gameOver) return;
  if (isOnline) {
    if (current !== myPlayer) return;
    const over = doPass();
    if (over) setGameOver(true); // set BEFORE pushing so remote sees gameOver:true
    updateLastMoveAt(Date.now());
    await pushGameState({ board, N, current, captures, consecutivePasses, gameOver, koState, lastPlaced });
    if (over) { endGame(); return; }
    refreshUI(); refreshHints();
    return;
  }
  if (isComputerTurn()) return;
  const over = doPass();
  if (over) { endGame(); return; }
  refreshUI(); refreshHints();
  // Human passed locally → if it's now the AI's turn, chain a move
  if (!isOnline && !gameOver && isComputerTurn()) scheduleAutoMove();
};

document.getElementById('undoBtn').onclick        = handleUndo;
document.getElementById('overlayUndoBtn').onclick = handleUndo;

document.getElementById('overlayTerrBtn').onclick = () => {
  const visible = toggleTerritory();
  document.getElementById('overlayTerrBtn').textContent = visible ? 'Hide territory' : 'Show territory';
};

document.getElementById('aiBtn').onclick = () => {
  if (gameOver) return;
  // Three behaviors depending on state:
  //   1) An automove is queued    → Pause: cancel timer + set paused flag (this game only)
  //   2) Paused and queued nothing → Resume: clear paused flag + schedule next AI move
  //   3) Otherwise (setting OFF)   → Manual: trigger one AI move
  if (automoveTimer) {
    cancelAutoMove();
    automovePaused = true;
    refreshUI();
    return;
  }
  if (automoveEnabled && automovePaused) {
    automovePaused = false;
    refreshUI();
    if (isComputerTurn()) scheduleAutoMove();
    return;
  }
  if (playMode === 'cvc' || (playMode === 'pvc' && current === 2)) doAiMove();
};

document.getElementById('resetBtn').onclick = async () => {
  if (isOnline) {
    await signalLeave();
    leaveRoom();
    exitOnlineMode();
    setPlayMode('pvc');
    syncModeButtons();
    setupBoard();
  } else {
    setupBoard();
  }
};

document.getElementById('overlayClose').onclick = async () => {
  if (isOnline) {
    await signalLeave();
    leaveRoom();
    exitOnlineMode();
    setPlayMode('pvc');
    syncModeButtons();
  }
  setupBoard();
};

// ─── Help ────────────────────────────────────────────────────────────────────
const helpOverlay = document.getElementById('help-overlay');
document.getElementById('helpBtn').onclick   = () => { helpOverlay.style.display = 'block'; setTimeout(() => { helpOverlay.scrollTop = 0; }, 0); };
document.getElementById('helpClose').onclick = () => { helpOverlay.style.display = 'none'; };
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) helpOverlay.style.display = 'none'; });

// ─── Size & mode buttons (local only) ────────────────────────────────────────
document.querySelectorAll('#sizeButtons button').forEach(btn => {
  btn.onclick = async () => {
    if (isOnline) return; // locked in online mode
    const newN = parseInt(btn.dataset.size);
    if (newN === N) return;
    if (history.length > 0 && !await showConfirm('Start a new game with this board size?')) return;
    setN(newN);
    syncSizeButtons();
    setupBoard();
  };
});

document.querySelectorAll('#modeButtons button[data-mode]').forEach(btn => {
  btn.onclick = () => {
    if (isOnline) return;
    setPlayMode(btn.dataset.mode);
    if (playMode !== 'pvp' && N === 11) setN(9); // 11³ is PvP only
    syncModeButtons();
    setupBoard();
  };
});

document.querySelectorAll('#difficultyButtons button').forEach(btn => {
  btn.onclick = () => {
    if (isOnline) return;
    setAiDifficulty(btn.dataset.difficulty);
    localStorage.setItem('go3d-difficulty', btn.dataset.difficulty);
    syncDifficultyButtons();
  };
});

initScoringBtn();

// ─── Online modal — open ──────────────────────────────────────────────────────
let onlineN = 5; // board size chosen in the online modal

document.getElementById('onlineBtn').onclick = () => {
  closeSettings(); // close settings before opening online modal
  updateAuthUI();  // refresh sign-in status every time modal opens
  // Sync the modal size selector to current N
  onlineN = N;
  document.querySelectorAll('.online-size-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.n) === onlineN);
  });
  joinError.textContent = '';
  document.getElementById('joinCodeInput').value = '';
  onlineModal.style.display = 'flex';
};

document.getElementById('onlineBackBtn').onclick = () => {
  onlineModal.style.display = 'none';
};

// Size picker inside modal
document.querySelectorAll('.online-size-btn').forEach(btn => {
  btn.onclick = () => {
    onlineN = parseInt(btn.dataset.n);
    document.querySelectorAll('.online-size-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.n) === onlineN)
    );
  };
});

// ─── Create game — core logic (called after auth + payment are confirmed) ─────
async function doCreateGame() {
  const btn = document.getElementById('createGameBtn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  setN(onlineN);
  setupBoard();

  let code;
  try {
    code = await createRoom(N, board);
    track('room_created', { board_size: N });
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '✦ Create game';
    track('room_create_failed', { error: err.code || err.message || String(err) });
    alert('Could not create game: ' + (err.code || err.message || err));
    return;
  }

  btn.disabled = false;
  btn.textContent = '✦ Create game';
  onlineModal.style.display = 'none';

  displayCode.textContent = code;
  waitingOvl.style.display = 'flex';
  roomCodeText.textContent = code;
  sessionStorage.setItem('go3d-online-room',   code);
  sessionStorage.setItem('go3d-online-player', '1');

  subscribeRoom(applyOpponentState, () => {
    waitingOvl.style.display = 'none';
    enterOnlineMode();
    syncModeButtons();
    subscribeChat(handleNewChatMsg);
    refreshUI(); refreshHints();
  }, handleOpponentLeft, handleUndoRequest, handleUndoResponse);
}

// ─── Payment gate ─────────────────────────────────────────────────────────────
const STRIPE_LINK = 'https://buy.stripe.com/cNi3cv1d38TL6MzcFP4Vy00';
let stopWatchingPayment = null;

function showPaymentGate(uid) {
  const modal = document.getElementById('payment-modal');
  modal.classList.add('open');
  document.getElementById('payStatus').textContent = '';
  document.getElementById('payBtn').textContent = 'Pay €1 →';
  document.getElementById('payBtn').disabled = false;

  // Listen for Firebase confirmation — fires automatically when webhook writes paid:true
  stopWatchingPayment = watchPaid(uid, () => {
    track('payment_completed', { value: 1, currency: 'EUR' });
    closePaymentGate();
    doCreateGame();
  });

  document.getElementById('payBtn').onclick = () => {
    track('payment_initiated');
    window.open(`${STRIPE_LINK}?client_reference_id=${uid}`, '_blank');
    document.getElementById('payBtn').textContent = 'Waiting for payment…';
    document.getElementById('payBtn').disabled = true;
    document.getElementById('payStatus').textContent =
      'Complete payment in the new tab — this page will update automatically.';
  };

  document.getElementById('payBackBtn').onclick = () => {
    track('payment_cancelled');
    closePaymentGate();
  };
}

function closePaymentGate() {
  document.getElementById('payment-modal').classList.remove('open');
  if (stopWatchingPayment) { stopWatchingPayment(); stopWatchingPayment = null; }
}

// ─── Create game button ───────────────────────────────────────────────────────
document.getElementById('createGameBtn').onclick = async () => {
  track('create_game_clicked', { board_size: onlineN });

  // Step 1: must be signed in with a REAL account. Anonymous guests don't count
  // — their UID is ephemeral, so any payment would be lost when cookies clear.
  if (!currentUser || currentUser.isAnonymous) {
    try {
      const result = await signInWithGoogle();
      if (result) {
        currentUser = result.user;
        updateAuthUI();
        track('signin_completed');
      } else {
        // Mobile redirect path — page will reload after redirect.
        // Return here; the resolveRedirect handler picks up on reload.
        return;
      }
    } catch (_) {
      track('signin_cancelled');
      return; // user closed the popup
    }
  }

  // Step 2: must have paid
  const paid = await checkPaid(currentUser.uid);
  if (!paid) {
    track('payment_gate_shown');
    showPaymentGate(currentUser.uid);
    return;
  }

  await doCreateGame();
};

// ─── Cancel waiting ───────────────────────────────────────────────────────────
document.getElementById('cancelWaitBtn').onclick = () => {
  deleteRoom(); // no opponent joined yet — delete immediately
  leaveRoom();
  waitingOvl.style.display = 'none';
  sessionStorage.removeItem('go3d-online-room');
  sessionStorage.removeItem('go3d-online-player');
  setPlayMode('pvc');
  syncModeButtons();
  setupBoard();
};

// ─── Join game ────────────────────────────────────────────────────────────────
document.getElementById('joinGameBtn').onclick = async () => {
  const code = document.getElementById('joinCodeInput').value.trim();
  if (code.length !== 6) { joinError.textContent = 'Code must be 6 characters'; return; }
  joinError.textContent = '';

  const btn = document.getElementById('joinGameBtn');
  btn.disabled = true;
  btn.textContent = 'Joining…';

  // Firebase rules require all writes to be authenticated. Guests don't need
  // a Google account, but they do need a UID — sign in anonymously if needed.
  if (!currentUser) {
    try { await signInAnonymously(); }
    catch (err) {
      track('join_game_failed', { error: 'anon_auth_failed' });
      joinError.textContent = 'Could not connect — please try again';
      btn.disabled = false;
      btn.textContent = 'Join game →';
      return;
    }
  }

  track('join_game_attempted');
  const result = await joinRoom(code);

  btn.disabled = false;
  btn.textContent = 'Join game →';

  if (!result.ok) {
    track('join_game_failed', { error: result.error });
    joinError.textContent = result.error;
    return;
  }
  track('room_joined', { board_size: result.N });

  // Apply host's board state
  setN(result.N);
  setupBoard();
  applyOpponentState(result.data);

  onlineModal.style.display = 'none';
  roomCodeText.textContent = code;
  enterOnlineMode();
  syncModeButtons();
  sessionStorage.setItem('go3d-online-room',   code);
  sessionStorage.setItem('go3d-online-player', '2');

  subscribeRoom(applyOpponentState, null, handleOpponentLeft, handleUndoRequest, handleUndoResponse);
  subscribeChat(handleNewChatMsg);
  refreshUI(); refreshHints();
};

// ─── Chat ─────────────────────────────────────────────────────────────────────
let unreadCount = 0;
let chatOpen = false;

document.getElementById('chatBtn').onclick = () => {
  chatOpen = true;
  chatPanel.style.display = 'flex';
  unreadCount = 0;
  chatBadge.style.display = 'none';
  // Jump to latest message when opening
  requestAnimationFrame(() => { chatMessages.scrollTop = chatMessages.scrollHeight; });
};

document.getElementById('closeChatBtn').onclick = () => {
  chatOpen = false;
  chatPanel.style.display = 'none';
};

function handleNewChatMsg(msg) {
  // Defensive: even if rules let a bad message slip through, never let one
  // freeze the UI with a 10 MB string. Coerce + cap before rendering.
  const text = String(msg.text ?? '').slice(0, 500);
  if (!text) return;

  const div = document.createElement('div');
  div.className = 'chat-msg ' + (msg.player === myPlayer ? 'mine' : 'theirs');
  if (msg.player !== myPlayer) {
    const sender = document.createElement('div');
    sender.className = 'sender';
    sender.textContent = 'Opponent';
    div.appendChild(sender);
  }
  div.appendChild(document.createTextNode(text));
  chatMessages.appendChild(div);
  // Auto-scroll to bottom — unless the user has scrolled up to read history
  const nearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 60;
  if (nearBottom || msg.player === myPlayer) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  if (!chatOpen && msg.player !== myPlayer) {
    unreadCount++;
    chatBadge.style.display = 'flex';
    chatBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
  }
}

async function doSendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  await sendChat(text);
}

document.getElementById('chatSendBtn').onclick = doSendChat;
document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSendChat();
});

// ─── Controls ────────────────────────────────────────────────────────────────
attachMouseControls(canvas, handleClickAt);
attachTouchControls(canvas, handleClickAt);

// ─── Resize ──────────────────────────────────────────────────────────────────
function resize() { resizeRenderer(canvas); }
resize();
window.addEventListener('resize', resize);

// ─── Settings panel ───────────────────────────────────────────────────────────
const settingsModal = document.getElementById('settings-modal');

function openSettings()  { settingsModal.style.display = 'block'; settingsModal.scrollTop = 0; }
function closeSettings() {
  settingsModal.style.display = 'none';
  // If the user changed board size / mode inside Settings (which calls
  // setupBoard), the scheduled automove was deferred while the modal was
  // open. Now that it's closed, kick it off if appropriate.
  if (!isOnline && !gameOver && isComputerTurn()) scheduleAutoMove();
}

document.getElementById('gearBtn').onclick     = openSettings;
document.getElementById('settingsClose').onclick = closeSettings;
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });

// ──�� Sound toggle ─────────────────────────────────────────────────────────────
function syncSoundBtn() {
  document.getElementById('soundBtn').textContent = soundEnabled ? '🔊 On' : '🔇 Off';
}
document.getElementById('soundBtn').onclick = () => {
  setSoundEnabled(!soundEnabled);
  syncSoundBtn();
};

// ─── Theme toggle ─────────────────────────────────────────────────────────────
const BG_DARK  = 0x1a1a2e;
const BG_LIGHT = 0xdce3f0;

function applyTheme(name) {
  const isLight = name === 'light';
  document.documentElement.dataset.theme = isLight ? 'light' : '';
  setSceneBg(isLight ? BG_LIGHT : BG_DARK, isLight);
  // Button shows current state so the user knows what's active
  document.getElementById('themeBtn').textContent = isLight ? '☀️ Light' : '🌙 Dark';
  localStorage.setItem('go3d-theme', name);
}

document.getElementById('themeBtn').onclick = () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
};

// ─── Auto-rotate toggle ───────────────────────────────────────────────────────
// Default ON — only off if the user has explicitly turned it off
let rotateMode = localStorage.getItem('go3d-rotate') !== '0';

function syncRotateBtn() {
  document.getElementById('rotateBtn').textContent = rotateMode ? '🔄 On' : '🔄 Off';
}
document.getElementById('rotateBtn').onclick = () => {
  rotateMode = !rotateMode;
  localStorage.setItem('go3d-rotate', rotateMode ? '1' : '0');
  syncRotateBtn();
};

// ─── Automove toggle ─────────────────────────────────────────────────────────
function syncAutomoveBtn() {
  document.getElementById('automoveBtn').textContent =
    automoveEnabled ? '⚡ On' : '⚡ Off';
}
document.getElementById('automoveBtn').onclick = () => {
  automoveEnabled = !automoveEnabled;
  localStorage.setItem('go3d-automove', automoveEnabled ? '1' : '0');
  syncAutomoveBtn();
  // Toggling the setting always clears any transient paused state.
  automovePaused = false;
  if (!automoveEnabled) {
    cancelAutoMove();
    refreshUI();
  } else if (!gameOver && !isOnline && isComputerTurn()) {
    // Toggling on while it's already the AI's turn — kick off a move
    scheduleAutoMove();
  }
};

// Pause auto-rotate while any modal or full-screen overlay is open — the user
// is reading text and wants the board behind to stay put for visual context.
function anyOverlayOpen() {
  const ids = ['overlay', 'online-modal', 'waiting-overlay',
               'payment-modal', 'settings-modal', 'confirm-modal'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.classList.contains('open')) return true;
    const disp = el.style.display;
    if (disp && disp !== 'none') return true;
  }
  return false;
}

setOnFrame(dt => {
  if (rotateMode && !anyOverlayOpen()) autoRotateTick(dt);
});

// ─── PWA install prompt ───────────────────────────────────────────────────────
let installPrompt = null;
const installRow    = document.getElementById('installRow');
const installBtn    = document.getElementById('installBtn');
const installBanner = document.getElementById('install-banner');

function hideInstallUI() {
  installPrompt = null;
  installBanner.classList.remove('show');
  installBtn.textContent  = '✓ Installed';
  installBtn.disabled     = true;
  installBtn.style.opacity = '0.5';
}

async function triggerInstall() {
  track('install_clicked');
  if (!installPrompt) {
    // already installed or browser doesn't support — guide user
    alert('To install: click the install icon (⊕) in your browser address bar, or use browser menu → "Install Go 3D".');
    return;
  }
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  track('install_outcome', { outcome });
  if (outcome === 'accepted') hideInstallUI();
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  installBtn.textContent   = '⬇ Install';
  installBtn.disabled      = false;
  installBtn.style.opacity = '1';
  if (!localStorage.getItem('installDismissed')) {
    installBanner.classList.add('show');
  }
});

window.addEventListener('appinstalled', hideInstallUI);

installBtn.onclick = triggerInstall;
installBanner.querySelector('#installBannerBtn').onclick     = triggerInstall;
installBanner.querySelector('#installBannerDismiss').onclick = () => {
  installBanner.classList.remove('show');
  localStorage.setItem('installDismissed', '1');
};

// Restore saved theme (or respect OS preference as default)
const savedTheme = localStorage.getItem('go3d-theme') || 'dark';
applyTheme(savedTheme);
syncSoundBtn();
syncRotateBtn();
syncAutomoveBtn();

// Restore saved AI difficulty
const savedDifficulty = localStorage.getItem('go3d-difficulty');
if (savedDifficulty) setAiDifficulty(savedDifficulty);

// ─── Rejoin interrupted online game after page refresh ───────────────────────
async function tryRejoinOnlineGame() {
  const savedRoom   = sessionStorage.getItem('go3d-online-room');
  const savedPlayer = parseInt(sessionStorage.getItem('go3d-online-player'));
  if (!savedRoom || !savedPlayer) return false;

  let result;
  try { result = await rejoinRoom(savedRoom, savedPlayer); }
  catch (_) { result = { ok: false }; }

  if (!result.ok) {
    sessionStorage.removeItem('go3d-online-room');
    sessionStorage.removeItem('go3d-online-player');
    return false;
  }

  setN(result.N);

  if (!result.guestEverJoined && savedPlayer === 1) {
    // Host refreshed while still waiting for opponent — restore waiting screen
    setupBoard();
    displayCode.textContent = savedRoom;
    waitingOvl.style.display = 'flex';
    roomCodeText.textContent = savedRoom;
    subscribeRoom(applyOpponentState, () => {
      waitingOvl.style.display = 'none';
      enterOnlineMode();
      syncModeButtons();
      subscribeChat(handleNewChatMsg);
      refreshUI(); refreshHints();
    }, handleOpponentLeft, handleUndoRequest, handleUndoResponse);
  } else {
    // Game was in progress — enter online mode FIRST so CSS is correct
    // before setupBoard/applyOpponentState call refreshUI internally
    roomCodeText.textContent = savedRoom;
    enterOnlineMode();
    syncModeButtons();
    setupBoard();
    applyOpponentState(result.data);
    subscribeRoom(applyOpponentState, null, handleOpponentLeft, handleUndoRequest, handleUndoResponse);
    subscribeChat(handleNewChatMsg);
    refreshUI(); refreshHints();
  }

  return true;
}

// ─── Start — show blank board immediately, then async: rejoin online game or
//             restore local saved game ─────────────────────────────────────────
setupBoard();
startRenderLoop();

(async () => {
  const rejoined = await tryRejoinOnlineGame();
  if (!rejoined) {
    // No online session — restore saved local game if one exists
    const hadSave = loadFromStorage();
    if (hadSave) restoreFromSave();
  }
})();
