// ─── audio.js — Web Audio API stone-clack synthesis ──────────────────────────

let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// ─── Sound enabled state (persisted) ─────────────────────────────────────────
export let soundEnabled = localStorage.getItem('go3d-sound') !== 'off';

export function setSoundEnabled(v) {
  soundEnabled = v;
  localStorage.setItem('go3d-sound', v ? 'on' : 'off');
}

// ─── Stone-placement clack ────────────────────────────────────────────────────
// Two layers: shaped noise burst (the hard "click") + short tonal tail
// (the wooden board resonating). Together they sound like a Go stone.
export function playStoneSound() {
  if (!soundEnabled) return;
  try {
    const ac = getCtx();
    // iOS requires resume after a user-gesture
    if (ac.state === 'suspended') ac.resume();
    const now = ac.currentTime;

    // — Noise click —
    const sr  = ac.sampleRate;
    const len = Math.ceil(sr * 0.05);          // 50 ms
    const buf = ac.createBuffer(1, len, sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 5);

    const src = ac.createBufferSource();
    src.buffer = buf;

    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.8;

    const gN = ac.createGain();
    gN.gain.setValueAtTime(0.6, now);
    gN.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    src.connect(bp); bp.connect(gN); gN.connect(ac.destination);
    src.start(now); src.stop(now + 0.05);

    // — Tonal body (board resonance) —
    const osc = ac.createOscillator();
    const gO  = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.15);
    gO.gain.setValueAtTime(0.14, now);
    gO.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gO); gO.connect(ac.destination);
    osc.start(now); osc.stop(now + 0.22);
  } catch (_) {}
}
