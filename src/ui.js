// ─── ui.js — buttons, panels, overlay ────────────────────────────────────────
import { N, layerVisible, setLayerVisible, scoringMode, setScoringMode } from './board.js';
import { buildGrid, dotMeshList, stoneMeshMap, lastMarker, terrGroup, syncLayerVisibility } from './renderer.js';
import { updateHints } from './renderer.js';

// ─── Layer buttons ───────────────────────────────────────────────────────────
export function buildLayerButtons(onLayerToggle) {
  const el = document.getElementById('layers'); el.innerHTML = '';
  for (let y = 0; y < N; y++) {
    const btn = document.createElement('button');
    btn.textContent = `L${y + 1}`;
    btn.className = 'ctrl-btn';
    btn.style.borderRadius = '10px';
    btn.style.padding = '3px 9px';
    btn.onclick = () => {
      setLayerVisible(y, !layerVisible[y]);
      btn.style.opacity    = layerVisible[y] ? '1' : '0.35';
      btn.style.background = layerVisible[y] ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)';
      onLayerToggle(y);
    };
    el.appendChild(btn);
  }
}

// ─── Turn / score display ────────────────────────────────────────────────────
export function updateUI(current, captures, isComputerTurn) {
  const name   = current === 1 ? '⚫ Black' : '⚪ White';
  const suffix = isComputerTurn() ? ' (computer)' : "'s turn";
  document.getElementById('turn').textContent  = name + suffix;
  document.getElementById('score').innerHTML   = `Black: ${captures[0]} | White: ${captures[1]}`;
}

// ─── AI button ───────────────────────────────────────────────────────────────
export function updateAiBtn(gameOver, playMode, current) {
  const btn = document.getElementById('aiBtn');
  if (gameOver) { btn.style.display = 'none'; return; }
  if (playMode === 'cvc') { btn.style.display = 'inline-block'; return; }
  if (playMode === 'pvc' && current === 2) { btn.style.display = 'inline-block'; return; }
  btn.style.display = 'none';
}

// ─── End-game overlay ────────────────────────────────────────────────────────
export function showOverlay(capB, capW, scoringMode, terrResult) {
  const totalB = scoringMode === 'captures' ? capB
               : scoringMode === 'territory' ? terrResult.black
               : capB + terrResult.black;
  const totalW = scoringMode === 'captures' ? capW
               : scoringMode === 'territory' ? terrResult.white
               : capW + terrResult.white;

  const winner = totalB > totalW ? '⚫ Black wins!'
               : totalW > totalB ? '⚪ White wins!'
               : "It's a tie!";

  document.getElementById('overlayTitle').textContent = winner;

  let body = `<b>Captures</b><br>Black: ${capB} &nbsp;|&nbsp; White: ${capW}`;
  if (scoringMode === 'territory' || scoringMode === 'both')
    body += `<br><br><b>Territory</b><br>Black: ${terrResult.black} &nbsp;|&nbsp; White: ${terrResult.white}<br>Neutral: ${terrResult.neutral}`;
  if (scoringMode === 'both')
    body += `<br><br><b>Total</b><br>Black: ${totalB} &nbsp;|&nbsp; White: ${totalW}`;

  document.getElementById('overlayBody').innerHTML = body;
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('aiBtn').style.display   = 'none';
}

export function hideOverlay() {
  document.getElementById('overlay').style.display = 'none';
}

// ─── Scoring button cycle ─────────────────────────────────────────────────────
const scoringModes  = ['captures', 'territory', 'both'];
const scoringLabels = ['Captures only', 'Territory only', 'Captures + territory'];
let scoringIdx = 2; // start on 'both' to match index.html default label

export function initScoringBtn() {
  const btn = document.getElementById('scoringBtn');
  // sync label to initial state
  btn.textContent = scoringLabels[scoringIdx];
  btn.onclick = () => {
    scoringIdx = (scoringIdx + 1) % 3;
    setScoringMode(scoringModes[scoringIdx]);
    btn.textContent = scoringLabels[scoringIdx];
  };
}
