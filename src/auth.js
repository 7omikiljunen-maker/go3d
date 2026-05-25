// ─── auth.js — Google sign-in helpers ─────────────────────────────────────────
import { auth } from './firebase.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth';

const provider = new GoogleAuthProvider();

/** True on phones/tablets where popups are unreliable. */
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/**
 * Signs in with Google.
 * Mobile → always uses redirect (popup unreliable).
 * Desktop → tries popup, falls back to redirect if blocked.
 */
export async function signInWithGoogle() {
  if (isMobile) {
    sessionStorage.setItem('pendingCreateGame', '1');
    await signInWithRedirect(auth, provider);
    return null; // page will reload after redirect
  }
  try {
    return await signInWithPopup(auth, provider);
  } catch (err) {
    // popup blocked or closed — fall back to redirect
    if (err.code === 'auth/popup-blocked' ||
        err.code === 'auth/popup-cancelled-by-user' ||
        err.code === 'auth/cancelled-popup-request' ||
        err.code === 'auth/popup-closed-by-user') {
      sessionStorage.setItem('pendingCreateGame', '1');
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

/** Call once on page load; resolves any pending redirect sign-in. */
export const resolveRedirect = () => getRedirectResult(auth);

/** Signs the current user out. */
export const signOut = () => fbSignOut(auth);

/** Calls cb(user) whenever auth state changes (on load + on sign-in/out). */
export const onAuthChange = cb => onAuthStateChanged(auth, cb);
