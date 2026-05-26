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

// ─── Capture clatter ──────────────────────────────────────────────────────────
// Several quick stone-clacks at varied pitches, staggered like stones being
// scooped up and dropped into a pile. Count scales with captured stones (capped).
export function playCaptureSound(captureCount = 1) {
  if (!soundEnabled) return;
  try {
    const ac = getCtx();
    if (ac.state === 'suspended') ac.resume();
    const now = ac.currentTime;

    // 1 captured stone → 3 clacks; more captures → up to 8 clacks
    const clacks = Math.min(3 + captureCount, 8);
    const sr = ac.sampleRate;

    for (let i = 0; i < clacks; i++) {
      // Stagger each clack 20–70 ms apart with some randomness
      const delay = i * (0.025 + Math.random() * 0.045);
      const t0    = now + delay;
      // Later clacks slightly quieter — pile settling
      const fade  = 1 - i / (clacks + 2);

      // — Noise burst (the click of stone-on-stone) —
      const len = Math.ceil(sr * 0.04);
      const buf = ac.createBuffer(1, len, sr);
      const d   = buf.getChannelData(0);
      for (let j = 0; j < len; j++)
        d[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, 4);

      const src = ac.createBufferSource();
      src.buffer = buf;

      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      // Random pitch per clack so stones sound distinct
      bp.frequency.value = 1700 + Math.random() * 1400;
      bp.Q.value = 0.7;

      const gN = ac.createGain();
      gN.gain.setValueAtTime(0.45 * fade, t0);
      gN.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);

      src.connect(bp); bp.connect(gN); gN.connect(ac.destination);
      src.start(t0); src.stop(t0 + 0.04);

      // — Short tonal body (lower than placement — "stone in pile") —
      const osc = ac.createOscillator();
      const gO  = ac.createGain();
      osc.type  = 'sine';
      const f0  = 180 + Math.random() * 160;
      osc.frequency.setValueAtTime(f0, t0);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t0 + 0.12);
      gO.gain.setValueAtTime(0.10 * fade, t0);
      gO.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);

      osc.connect(gO); gO.connect(ac.destination);
      osc.start(t0); osc.stop(t0 + 0.15);
    }
  } catch (_) {}
}
