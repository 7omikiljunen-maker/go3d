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

/**
 * Signs in with Google. On mobile/browsers that block popups,
 * falls back to redirect automatically.
 */
export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (err) {
    // popup blocked or cancelled — fall back to redirect
    if (err.code === 'auth/popup-blocked' ||
        err.code === 'auth/popup-cancelled-by-user' ||
        err.code === 'auth/cancelled-popup-request') {
      sessionStorage.setItem('pendingCreateGame', '1');
      await signInWithRedirect(auth, provider);
      return null; // page will reload
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
