// ─── main.js — entry point, wires everything together ────────────────────────
import {
  N, setN, board, current, captures, consecutivePasses, gameOver,
  koState, lastPlaced, layerVisible,
  scoringMode, playMode, setPlayMode,
  initBoard, placeStone, doPass, setGameOver, setLayerVisible,
  isLegal, legalMoves, cfg,
} from './board.js';

import { aiMove } from './ai.js';

import {
  initRenderer, resizeRenderer, startRenderLoop,
  buildGrid, buildDots, clearScene,
  addStoneMesh, removeStonesMesh,
  updateHints, showTerritory, syncLayerVisibility,
  camera,
} from './renderer.js';

import {
  setRadius, updateCamera,
  attachMouseControls, attachTouchControls, pickIntersection,
} from './controls.js';

import {
  buildLayerButtons, updateUI, updateAiBtn,
  showOverlay, hideOverlay, initScoringBtn,
} from './ui.js';

// ─── Canvas & renderer init ──────────────────────────────────────────────────
const canvas = document.getElementById('c');
initRenderer(canvas);

// ─── Helpers that need live module state ─────────────────────────────────────
function isComputerTurn() {
  // Import-live reads from board.js exports
  const pm = playMode, cur = current;
  if (pm === 'cvc') return true;
  if (pm === 'pvc' && cur === 2) return true;
  return false;
}

function refreshHints() {
  // board.js re-exports are live bindings — pass what renderer needs
  updateHints(current, gameOver, isComputerTurn, isLegal, koState);
}

function refreshUI() {
  updateUI(current, captures, isComputerTurn);
  updateAiBtn(gameOver, playMode, current);
}

// ─── Place stone (human or AI) ───────────────────────────────────────────────
function tryPlace(x, y, z) {
  const result = placeStone(x, y, z);  // mutates board.js state
  if (!result.ok) return false;
  if (result.captured.length) removeStonesMesh(result.captured);
  addStoneMesh(x, y, z, result.color);
  refreshUI(); refreshHints();
  return true;
}

// ─── AI move ─────────────────────────────────────────────────────────────────
function doAiMove() {
  if (gameOver) return;
  const move = aiMove(current);
  if (!move) {
    const over = doPass();  // mutates board.js
    if (over) { endGame(); return; }
    refreshUI(); refreshHints();
    return;
  }
  tryPlace(move[0], move[1], move[2]);
}

// ─── End game ────────────────────────────────────────────────────────────────
function endGame() {
  setGameOver(true);
  // clear hints
  updateHints(current, true, isComputerTurn, isLegal, koState);

  let terrResult = { black: 0, white: 0, neutral: 0 };
  if (scoringMode === 'territory' || scoringMode === 'both') {
    terrResult = showTerritory();
  }
  showOverlay(captures[0], captures[1], scoringMode, terrResult);
}

// ─── Setup / reset ───────────────────────────────────────────────────────────
function setupBoard() {
  clearScene();
  initBoard();                    // resets all board.js state
  setRadius(cfg(N).camR);
  updateCamera();
  buildGrid();
  buildDots();
  buildLayerButtons(y => {
    buildGrid();
    syncLayerVisibility(lastPlaced);
    refreshHints();
  });
  refreshUI();
  refreshHints();
  hideOverlay();
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

document.getElementById('aiBtn').onclick = () => {
  if (gameOver) return;
  if (playMode === 'cvc' || (playMode === 'pvc' && current === 2)) doAiMove();
};

document.getElementById('resetBtn').onclick  = setupBoard;
document.getElementById('overlayClose').onclick = setupBoard;

document.querySelectorAll('#sizeButtons button').forEach(btn => {
  btn.onclick = () => {
    const newN = parseInt(btn.dataset.size);
    if (newN === N) return;
    setN(newN);
    document.querySelectorAll('#sizeButtons button').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.size) === N)
    );
    setupBoard();
  };
});

document.querySelectorAll('#modeButtons button').forEach(btn => {
  btn.onclick = () => {
    setPlayMode(btn.dataset.mode);
    document.querySelectorAll('#modeButtons button').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === playMode)
    );
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

// ─── Start ───────────────────────────────────────────────────────────────────
setupBoard();
startRenderLoop();
