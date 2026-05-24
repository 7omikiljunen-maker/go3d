// ─── multiplayer.js — Firebase room management, state sync, chat ──────────────
import { db } from './firebase.js';
import {
  ref, set, get, update,
  onValue, onChildAdded, push,
} from 'firebase/database';

// ─── Module state ─────────────────────────────────────────────────────────────
export let roomCode = null;
export let myPlayer = null;   // 1 = Black (host)  |  2 = White (guest)
export let isOnline = false;

let roomRef       = null;
let chatRef       = null;
let unsubRoom     = null;
let unsubChat     = null;
let localSeq      = 0;
let guestSeenOnce = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a 6-character room code — no ambiguous characters (0/O, 1/I). */
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** Flatten a 3-D board array → 1-D for Firebase storage. */
function flattenBoard(board, n) {
  const flat = new Array(n * n * n);
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++)
      for (let z = 0; z < n; z++)
        flat[x * n * n + y * n + z] = board[x][y][z];
  return flat;
}

/** Unflatten a 1-D Firebase board back to a 3-D array. */
export function unflattenBoard(flat, n) {
  const board = Array(n).fill(null).map(() =>
    Array(n).fill(null).map(() => Array(n).fill(0))
  );
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++)
      for (let z = 0; z < n; z++)
        board[x][y][z] = flat[x * n * n + y * n + z] ?? 0;
  return board;
}

// ─── Create room (host) ───────────────────────────────────────────────────────
export async function createRoom(n, board) {
  const code = genCode();
  roomRef = ref(db, `rooms/${code}`);
  chatRef = ref(db, `rooms/${code}/chat`);

  await set(roomRef, {
    N:                 n,
    hostOnline:        true,
    guestOnline:       false,
    seq:               0,
    board:             JSON.stringify(flattenBoard(board, n)),
    current:           1,
    capturesBlack:     0,
    capturesWhite:     0,
    consecutivePasses: 0,
    gameOver:          false,
    koState:           null,
    lastX:             null,
    lastY:             null,
    lastZ:             null,
  });

  roomCode      = code;
  myPlayer      = 1;
  isOnline      = true;
  localSeq      = 0;
  guestSeenOnce = false;
  return code;
}

// ─── Join room (guest) ────────────────────────────────────────────────────────
export async function joinRoom(code) {
  code = code.trim().toUpperCase();
  const r = ref(db, `rooms/${code}`);
  const snap = await get(r);

  if (!snap.exists())       return { ok: false, error: 'Room not found' };
  const d = snap.val();
  if (d.guestOnline)        return { ok: false, error: 'Room is full' };
  if (d.gameOver)           return { ok: false, error: 'Game already ended' };

  await update(r, { guestOnline: true });

  roomRef       = r;
  chatRef       = ref(db, `rooms/${code}/chat`);
  roomCode      = code;
  myPlayer      = 2;
  isOnline      = true;
  localSeq      = d.seq ?? 0;
  guestSeenOnce = false;

  return { ok: true, N: d.N, data: d };
}

// ─── Subscribe to room changes ────────────────────────────────────────────────
/**
 * onStateChange(remoteData)  — called whenever the opponent pushes a new move.
 * onOpponentJoined()         — called once when the guest first connects (host side).
 */
export function subscribeRoom(onStateChange, onOpponentJoined) {
  if (!roomRef) return;
  unsubRoom = onValue(roomRef, snap => {
    if (!snap.exists()) return;
    const d = snap.val();

    // Notify host once when guest arrives
    if (myPlayer === 1 && d.guestOnline && !guestSeenOnce && onOpponentJoined) {
      guestSeenOnce = true;
      onOpponentJoined();
    }

    // Only apply state if it came from the other player (seq advanced past ours)
    if (d.seq > localSeq) {
      localSeq = d.seq;
      onStateChange(d);
    }
  });
}

// ─── Push game state (after your move/pass) ───────────────────────────────────
export async function pushGameState({ board, N: n, current, captures,
                                      consecutivePasses, gameOver, koState, lastPlaced }) {
  if (!roomRef) return;
  localSeq++;
  await update(roomRef, {
    seq:               localSeq,
    board:             JSON.stringify(flattenBoard(board, n)),
    current,
    capturesBlack:     captures[0],
    capturesWhite:     captures[1],
    consecutivePasses,
    gameOver:          gameOver ?? false,
    koState:           koState  ?? null,
    lastX:             lastPlaced?.x ?? null,
    lastY:             lastPlaced?.y ?? null,
    lastZ:             lastPlaced?.z ?? null,
  });
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
export async function sendChat(text) {
  if (!chatRef || !text.trim()) return;
  await push(chatRef, { player: myPlayer, text: text.trim(), ts: Date.now() });
}

/** onNewMessage({ key, player, text, ts }) called for each new chat message. */
export function subscribeChat(onNewMessage) {
  if (!chatRef) return;
  unsubChat = onChildAdded(chatRef, snap => {
    onNewMessage({ key: snap.key, ...snap.val() });
  });
}

// ─── Leave room ───────────────────────────────────────────────────────────────
export function leaveRoom() {
  if (unsubRoom) { unsubRoom(); unsubRoom = null; }
  if (unsubChat) { unsubChat(); unsubChat = null; }
  roomRef       = null;
  chatRef       = null;
  roomCode      = null;
  myPlayer      = null;
  isOnline      = false;
  localSeq      = 0;
  guestSeenOnce = false;
}
