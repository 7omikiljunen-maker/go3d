// ─── main.js — entry point, wires everything together ────────────────────────
import {
  N, setN, board, current, captures, consecutivePasses, gameOver,
  koState, lastPlaced, layerVisible,
  scoringMode, playMode, setPlayMode,
  komi,
  history,
  initBoard, placeStone, doPass, setGameOver, setLayerVisible,
  isLegal, legalMoves, cfg,
  undoMove,
  saveToStorage, loadFromStorage, clearStorage,
  applyRemoteState,
} from './board.js';

import { aiMove } from './ai.js';
import { playStoneSound, soundEnabled, setSoundEnabled } from './audio.js';

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

import {
  createRoom, joinRoom, subscribeRoom, pushGameState,
  sendChat, subscribeChat, signalLeave, leaveRoom,
  roomCode, myPlayer, isOnline, unflattenBoard,
} from './multiplayer.js';

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
  // Disable undo only in CvC (always AI) or online; PvC allows undo at any time
  updateUndoBtn(history.length, gameOver, playMode === 'cvc' || isOnline);
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

// ─── Online mode UI helpers ───────────────────────────────────────────────────
function enterOnlineMode() {
  app.classList.add('online-mode');
  resetBtn.textContent = 'Leave';
}

function exitOnlineMode() {
  app.classList.remove('online-mode');
  resetBtn.textContent = 'New game';
  chatPanel.style.display = 'none';
  unreadCount = 0;
  chatBadge.style.display = 'none';
  chatMessages.innerHTML = '';
}

// ─── Place stone ─────────────────────────────────────────────────────────────
async function tryPlace(x, y, z) {
  const result = placeStone(x, y, z);
  if (!result.ok) return false;
  playStoneSound();
  if (result.captured.length) removeStonesMesh(result.captured);
  addStoneMesh(x, y, z, result.color);
  if (!isOnline) saveToStorage();
  refreshUI(); refreshHints();

  // Push to Firebase after a successful local move
  if (isOnline) {
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
  if (remoteData.gameOver) endGame();
}

// ─── Undo ─────────────────────────────────────────────────────────────────────
function handleUndo() {
  if (isOnline || gameOver || history.length === 0) return;
  if (playMode === 'cvc') return; // CvC: never allow undo

  if (!undoMove()) return; // always undo exactly one move

  rebuildStoneMeshes(lastPlaced);
  syncLayerVisibility(lastPlaced);
  saveToStorage();
  refreshUI(); refreshHints();
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
  if (!isOnline) clearStorage();
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

document.getElementById('undoBtn').onclick = handleUndo;

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
document.getElementById('helpBtn').onclick   = () => { helpOverlay.style.display = 'flex'; };
document.getElementById('helpClose').onclick = () => { helpOverlay.style.display = 'none'; };
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) helpOverlay.style.display = 'none'; });

// ─── Size & mode buttons (local only) ────────────────────────────────────────
document.querySelectorAll('#sizeButtons button').forEach(btn => {
  btn.onclick = () => {
    if (isOnline) return; // locked in online mode
    const newN = parseInt(btn.dataset.size);
    if (newN === N) return;
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

initScoringBtn();

// ─── Online modal — open ──────────────────────────────────────────────────────
let onlineN = 5; // board size chosen in the online modal

document.getElementById('onlineBtn').onclick = () => {
  closeSettings(); // close settings before opening online modal
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

// ─── Create game ──────────────────────────────────────────────────────────────
document.getElementById('createGameBtn').onclick = async () => {
  const btn = document.getElementById('createGameBtn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  setN(onlineN);
  setupBoard(); // init empty board with chosen size

  const code = await createRoom(N, board);

  btn.disabled = false;
  btn.textContent = '✦ Create game';
  onlineModal.style.display = 'none';

  displayCode.textContent = code;
  waitingOvl.style.display = 'flex';
  roomCodeText.textContent = code;

  // Listen: opponent joined / left
  subscribeRoom(applyOpponentState, () => {
    waitingOvl.style.display = 'none';
    enterOnlineMode();
    syncModeButtons();
    subscribeChat(handleNewChatMsg);
    refreshUI(); refreshHints();
  }, handleOpponentLeft);
};

// ─── Cancel waiting ───────────────────────────────────────────────────────────
document.getElementById('cancelWaitBtn').onclick = () => {
  leaveRoom();
  waitingOvl.style.display = 'none';
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

  const result = await joinRoom(code);

  btn.disabled = false;
  btn.textContent = 'Join game →';

  if (!result.ok) { joinError.textContent = result.error; return; }

  // Apply host's board state
  setN(result.N);
  setupBoard();
  applyOpponentState(result.data);

  onlineModal.style.display = 'none';
  roomCodeText.textContent = code;
  enterOnlineMode();
  syncModeButtons();

  subscribeRoom(applyOpponentState, null, handleOpponentLeft);
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

function openSettings()  { settingsModal.style.display = 'flex'; }
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

// Restore saved theme (or respect OS preference as default)
const savedTheme = localStorage.getItem('go3d-theme') ||
  (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
applyTheme(savedTheme);
syncSoundBtn();

// ─── Start — restore saved game or fresh board ────────────────────────────────
const hadSave = loadFromStorage();
if (hadSave) {
  restoreFromSave();
} else {
  setupBoard();
}

startRenderLoop();
