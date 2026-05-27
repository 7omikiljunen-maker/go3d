// ─── ui.js — buttons, panels, overlay ────────────────────────────────────────
import { N, layerVisible, setLayerVisible, setScoringMode, scoringMode } from './board.js';

// ─── Layer buttons ────────────────────────────────────────────────────────────
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

// ─── Turn / score display ─────────────────────────────────────────────────────
export function updateUI(current, captures, isComputerTurn) {
  const name   = current === 1 ? '⚫ Black' : '⚪ White';
  const suffix = isComputerTurn() ? ' (computer)' : "'s turn";
  document.getElementById('turn').textContent = name + suffix;
  document.getElementById('score').innerHTML  = `Black: ${captures[0]} | White: ${captures[1]}`;
}

// ─── Button visibility ────────────────────────────────────────────────────────
// automoveStatus: 'idle' | 'pending' | 'paused'
//   pending → an AI auto-move is queued — clicking will pause it
//   paused  → user has paused the auto-chain for this game — clicking resumes
//   idle    → automove is off (or N/A) — clicking triggers a single AI move
export function updateAiBtn(gameOver, playMode, current, automoveStatus = 'idle') {
  const btn = document.getElementById('aiBtn');
  if (gameOver) { btn.style.display = 'none'; return; }
  const visible =
    playMode === 'cvc' ||
    (playMode === 'pvc' && current === 2);
  btn.style.display = visible ? 'inline-block' : 'none';
  if (!visible) return;
  // Reset disabled state when not actively computing (doAiMove handles 'Thinking…')
  if (btn.textContent !== 'Thinking…') {
    btn.textContent =
      automoveStatus === 'pending' ? '⏸ Pause auto' :
      automoveStatus === 'paused'  ? '▶ Resume auto' :
                                     'Computer move ▶';
    btn.disabled = false;
  }
}

export function updateUndoBtn(historyLen, forceDisabled) {
  const btn = document.getElementById('undoBtn');
  btn.disabled = historyLen === 0 || forceDisabled;
  btn.style.opacity = btn.disabled ? '0.35' : '1';
}

// ─── End-game overlay ─────────────────────────────────────────────────────────
export function showOverlay(capB, capW, scoringMode, terrResult, komi) {
  const terrB = terrResult?.black ?? 0;
  const terrW = terrResult?.white ?? 0;

  const rawB = scoringMode === 'captures' ? capB : scoringMode === 'territory' ? terrB : capB + terrB;
  const rawW = scoringMode === 'captures' ? capW : scoringMode === 'territory' ? terrW : capW + terrW;

  const totalB = rawB;
  const totalW = rawW + komi;

  const winner = totalB > totalW ? '⚫ Black wins!'
               : totalW > totalB ? '⚪ White wins!'
               : "It's a tie!";

  document.getElementById('overlayTitle').textContent = winner;

  let body = `<b>Captures</b><br>Black: ${capB} &nbsp;|&nbsp; White: ${capW}`;
  if (scoringMode === 'territory' || scoringMode === 'both')
    body += `<br><br><b>Territory</b><br>Black: ${terrB} &nbsp;|&nbsp; White: ${terrW}<br>Neutral: ${terrResult?.neutral ?? 0}`;
  body += `<br><br><b>Komi</b>: +${komi} for White`;
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

export function initScoringBtn() {
  syncScoringBtn();
  document.getElementById('scoringBtn').onclick = () => {
    const idx = (scoringModes.indexOf(scoringMode) + 1) % 3;
    setScoringMode(scoringModes[idx]);
    syncScoringBtn();
  };
}

export function syncScoringBtn() {
  const idx = scoringModes.indexOf(scoringMode);
  document.getElementById('scoringBtn').textContent = scoringLabels[idx >= 0 ? idx : 2];
}
