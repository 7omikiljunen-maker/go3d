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
} from './board.js';

import { aiMove } from './ai.js';

import {
  initRenderer, resizeRenderer, startRenderLoop,
  buildGrid, buildDots, clearScene,
  addStoneMesh, removeStonesMesh, rebuildStoneMeshes,
  updateHints, showTerritory, syncLayerVisibility,
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

// ─── Canvas & renderer init ───────────────────────────────────────────────────
const canvas = document.getElementById('c');
initRenderer(canvas);

// ─── Helpers (read live board.js bindings at call time) ──────────────────────
function isComputerTurn() {
  if (playMode === 'cvc') return true;
  if (playMode === 'pvc' && current === 2) return true;
  return false;
}

function refreshHints() {
  updateHints(current, gameOver, isComputerTurn, isLegal, koState);
}

function refreshUI() {
  updateUI(current, captures, isComputerTurn);
  updateAiBtn(gameOver, playMode, current);
  updateUndoBtn(history.length, gameOver, isComputerTurn);
}

// ─── Sync UI button active states ────────────────────────────────────────────
function syncSizeButtons() {
  document.querySelectorAll('#sizeButtons button').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.size) === N)
  );
}

function syncModeButtons() {
  document.querySelectorAll('#modeButtons button').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === playMode)
  );
}

// ─── Place stone ─────────────────────────────────────────────────────────────
function tryPlace(x, y, z) {
  const result = placeStone(x, y, z);
  if (!result.ok) return false;
  if (result.captured.length) removeStonesMesh(result.captured);
  addStoneMesh(x, y, z, result.color);
  saveToStorage();
  refreshUI(); refreshHints();
  return true;
}

// ─── Undo ─────────────────────────────────────────────────────────────────────
function handleUndo() {
  if (gameOver || history.length === 0 || isComputerTurn()) return;
  if (!undoMove()) return;
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
  updateHints(current, true, isComputerTurn, isLegal, koState); // clear hints

  let terrResult = { black: 0, white: 0, neutral: 0 };
  if (scoringMode === 'territory' || scoringMode === 'both') {
    terrResult = showTerritory();
  }
  showOverlay(captures[0], captures[1], scoringMode, terrResult, komi);
  clearStorage(); // don't restore a finished game
}

// ─── Setup / reset ───────────────────────────────────────────────────────────
function setupBoard() {
  clearScene();
  initBoard();
  clearStorage();
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
  if (gameOver || isComputerTurn()) return;
  const hit = pickIntersection(cx, cy, canvas);
  if (hit) tryPlace(hit.x, hit.y, hit.z);
}

// ─── Button wiring ───────────────────────────────────────────────────────────
document.getElementById('passBtn').onclick = () => {
  if (gameOver || isComputerTurn()) return;
  const over = doPass();
  if (over) { endGame(); return; }
  refreshUI(); refreshHints();
};

document.getElementById('undoBtn').onclick = handleUndo;

document.getElementById('aiBtn').onclick = () => {
  if (gameOver) return;
  if (playMode === 'cvc' || (playMode === 'pvc' && current === 2)) doAiMove();
};

document.getElementById('resetBtn').onclick    = setupBoard;
document.getElementById('overlayClose').onclick = setupBoard;

const helpOverlay = document.getElementById('help-overlay');
document.getElementById('helpBtn').onclick   = () => { helpOverlay.style.display = 'flex'; };
document.getElementById('helpClose').onclick = () => { helpOverlay.style.display = 'none'; };
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) helpOverlay.style.display = 'none'; });

document.querySelectorAll('#sizeButtons button').forEach(btn => {
  btn.onclick = () => {
    const newN = parseInt(btn.dataset.size);
    if (newN === N) return;
    setN(newN);
    syncSizeButtons();
    setupBoard();
  };
});

document.querySelectorAll('#modeButtons button').forEach(btn => {
  btn.onclick = () => {
    setPlayMode(btn.dataset.mode);
    syncModeButtons();
    setupBoard();
  };
});

initScoringBtn();

// ─── Controls ────────────────────────────────────────────────────────────────
attachMouseControls(canvas, handleClickAt);
attachTouchControls(canvas, handleClickAt);

// ─── Resize ──────────────────────────────────────────────────────────────────
function resize() { resizeRenderer(canvas); }
resize();
window.addEventListener('resize', resize);

// ─── Start — restore saved game or fresh board ────────────────────────────────
const hadSave = loadFromStorage();
if (hadSave) {
  restoreFromSave();
} else {
  setupBoard();
}

startRenderLoop();
