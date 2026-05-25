// ─── payment.js — Firebase payment-status helpers ─────────────────────────────
import { db } from './firebase.js';
import { ref, get, onValue } from 'firebase/database';

/** Returns true if users/{uid}/paid === true in Firebase. */
export async function checkPaid(uid) {
  const snap = await get(ref(db, `users/${uid}/paid`));
  return snap.val() === true;
}

/**
 * Calls onPaid() as soon as users/{uid}/paid becomes true in Firebase.
 * Returns an unsubscribe function — call it to stop listening.
 */
export function watchPaid(uid, onPaid) {
  return onValue(ref(db, `users/${uid}/paid`), snap => {
    if (snap.val() === true) onPaid();
  });
}
