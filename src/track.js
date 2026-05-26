// ─── track.js — Firebase Analytics event helper ──────────────────────────────
// Centralised wrapper so we never crash the game if analytics fails.
import { logEvent } from 'firebase/analytics';
import { analytics } from './firebase.js';

/** Log a custom event to Firebase Analytics. Silently no-ops on error. */
export function track(eventName, params = {}) {
  try { logEvent(analytics, eventName, params); }
  catch (_) {}
}
