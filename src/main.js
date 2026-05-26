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
  updateHints, showTerritory, syncLayerVisibility,
  setSceneBg,
  camera,
} from './renderer.js';

import {
  setRadius, updateCamera,
  attachMouseControls, attachTouchControls, pickIntersection,
} from './controls.js';

import {
  buildLayerButtons, updateUI, updateAiBtn, updateUndoBtn,
  showOverlay, hideOverlay, initScoringBtn, syncScoringBtn,
} from './ui.js';

import { signInWithGoogle, signOut, onAuthChange, resolveRedirect } from './auth.js';
import { track } from './track.js';
import { checkPaid, watchPaid } from './payment.js';

import {
  createRoom, joinRoom, rejoinRoom, subscribeRoom, pushGameState,
  sendChat, subscribeChat, signalLeave, leaveRoom,
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
  if (currentUser) {
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
resolveRedirect().then(result => {
  if (!result) return;                     // no pending redirect
  currentUser = result.user;
  updateAuthUI();
  if (sessionStorage.getItem('pendingCreateGame')) {
    sessionStorage.removeItem('pendingCreateGame');
    // resume create-game flow after redirect sign-in
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
  updateAiBtn(gameOver, playMode, current);
  // Disable undo only while waiting for the opponent's undo response
  updateUndoBtn(history.length, waitingForUndoResponse);
}

// ─── Sync UI button active states ────────────────────────────────────────────
function syncSizeButtons() {
  document.querySelectorAll('#sizeButtons button').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.size) === N)
  );
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
  document.getElementById('overlay').style.display = 'flex';
}

// ─── Apply opponent's move from Firebase ─────────────────────────────────────
function applyOpponentState(remoteData) {
  const n = remoteData.N ?? N;
  let newBoard;
  try { newBoard = unflattenBoard(JSON.parse(remoteData.board), n); }
  catch (_) { return; }

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
  const wasOver = gameOver; // undoMove() clears gameOver; capture it first
  if (!undoMove()) return;
  rebuildStoneMeshes(lastPlaced);
  syncLayerVisibility(lastPlaced);
  if (wasOver) hideOverlay();
  saveToStorage();
  refreshUI(); refreshHints();
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
    if (wasOver) hideOverlay();
    refreshUI(); refreshHints();
    await pushGameState({ board, N, current, captures, consecutivePasses, gameOver, koState, lastPlaced });
  } else {
    refreshUI(); // re-enable button
    setUndoBtnText('Declined');
    setTimeout(() => setUndoBtnText('Undo'), 2000);
  }
}

// ─── AI move ─────────────────────────────────────────────────────────────────
function doAiMove() {
  if (gameOver) return;
  const move = aiMove(current);
  if (!move) {
    const over = doPass();
    if (over) { endGame(); return; }
    refreshUI(); refreshHints();
    return;
  }
  tryPlace(move[0], move[1], move[2]);
}

// ─── End game ────────────────────────────────────────────────────────────────
function endGame() {
  setGameOver(true);
  updateHints(current, true, isComputerTurn, isLegal, koState);

  let terrResult = { black: 0, white: 0, neutral: 0 };
  if (scoringMode === 'territory' || scoringMode === 'both') {
    terrResult = showTerritory();
  }
  showOverlay(captures[0], captures[1], scoringMode, terrResult, komi);
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
  clearScene();
  initBoard();
  if (!isOnline) clearStorage();
  setRadius(cfg(N).camR);
  updateCamera();
  buildGrid();
  buildDots();
  buildLayerButtons(handleLayerToggle);
  syncSizeButtons();
  syncModeButtons();
  syncDifficultyButtons();
  syncScoringBtn();
  refreshUI(); refreshHints();
  hideOverlay();
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
};

document.getElementById('undoBtn').onclick        = handleUndo;
document.getElementById('overlayUndoBtn').onclick = handleUndo;

document.getElementById('aiBtn').onclick = () => {
  if (gameOver) return;
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

  // Step 1: must be signed in
  if (!currentUser) {
    try {
      const result = await signInWithGoogle();
      if (result) {
        currentUser = result.user;
        updateAuthUI();
        track('signin_completed');
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
};

document.getElementById('closeChatBtn').onclick = () => {
  chatOpen = false;
  chatPanel.style.display = 'none';
};

function handleNewChatMsg(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (msg.player === myPlayer ? 'mine' : 'theirs');
  if (msg.player !== myPlayer) {
    const sender = document.createElement('div');
    sender.className = 'sender';
    sender.textContent = 'Opponent';
    div.appendChild(sender);
  }
  div.appendChild(document.createTextNode(msg.text));
  chatMessages.appendChild(div);
  // Keep only the last 2 messages — older ones are removed
  while (chatMessages.children.length > 2) {
    chatMessages.removeChild(chatMessages.firstChild);
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
function closeSettings() { settingsModal.style.display = 'none'; }

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
