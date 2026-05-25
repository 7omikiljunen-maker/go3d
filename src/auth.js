// ─── auth.js — Google sign-in helpers ─────────────────────────────────────────
import { auth } from './firebase.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth';

const provider = new GoogleAuthProvider();

/** Opens the Google sign-in popup. Returns the UserCredential. */
export const signInWithGoogle = () => signInWithPopup(auth, provider);

/** Signs the current user out. */
export const signOut = () => fbSignOut(auth);

/** Calls cb(user) whenever auth state changes (on load + on sign-in/out). */
export const onAuthChange = cb => onAuthStateChanged(auth, cb);
