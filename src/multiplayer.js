// ─── multiplayer.js — Firebase room management, state sync, chat ──────────────
import { db } from './firebase.js';
import {
  ref, set, get, update,
  onValue, onChildAdded, push, onDisconnect,
} from 'firebase/database';

// ─── Module state ─────────────────────────────────────────────────────────────
export let roomCode = null;
export let myPlayer = null;   // 1 = Black (host)  |  2 = White (guest)
export let isOnline = false;

let roomRef              = null;
let chatRef              = null;
let unsubRoom            = null;
let unsubChat            = null;
let unsubConnected       = null;
let localSeq             = 0;
let guestSeenOnce        = false;
let gameStarted          = false;
let opponentLeftNotified = false;
let opponentLeftTimer    = null; // grace-period timer before declaring opponent left
let lastSeenUndoReq      = 0;   // last undoReq.seq handled as the responder
let pendingMyUndoSeq     = 0;   // seq of our outgoing request (0 = none)

const OPPONENT_LEFT_GRACE_MS = 15 * 60 * 1000; // wait 15 min — tolerates mobile sleep, matches inactive-banner threshold

// Re-mark our online flag every time Firebase reconnects.
// Without this, Firebase drops the connection after a few idle minutes,
// fires the onDisconnect handler, and the opponent thinks we left.
function watchPresence(code) {
  const myField = myPlayer === 1 ? 'hostOnline' : 'guestOnline';
  const myRef   = ref(db, `rooms/${code}/${myField}`);
  const connRef = ref(db, '.info/connected');
  unsubConnected = onValue(connRef, snap => {
    if (snap.val() !== true) return;            // currently offline — wait for reconnect
    onDisconnect(myRef).set(false);             // re-arm the disconnect cleanup
    set(myRef, true).catch(() => {});           // mark ourselves online again
  });
}

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
    guestEverJoined:   false,   // set permanently true when guest joins
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
    lastMoveAt:        Date.now(),    // for idle detection
  });

  roomCode             = code;
  myPlayer             = 1;
  isOnline             = true;
  localSeq             = 0;
  guestSeenOnce        = false;
  gameStarted          = false;
  opponentLeftNotified = false;

  // Mark online + re-arm onDisconnect on every reconnect (handles Firebase idle drops)
  watchPresence(code);
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

  await update(r, { guestOnline: true, guestEverJoined: true });

  roomRef              = r;
  chatRef              = ref(db, `rooms/${code}/chat`);
  roomCode             = code;
  myPlayer             = 2;
  isOnline             = true;
  localSeq             = d.seq ?? 0;
  guestSeenOnce        = false;
  gameStarted          = true;  // guest is immediately in-game
  opponentLeftNotified = false;

  // Mark online + re-arm onDisconnect on every reconnect (handles Firebase idle drops)
  watchPresence(code);
  return { ok: true, N: d.N, data: d };
}

// ─── Subscribe to room changes ────────────────────────────────────────────────
/**
 * onStateChange(remoteData)  — opponent pushed a new move.
 * onOpponentJoined()         — guest connected (host side only).
 * onOpponentLeft()           — opponent disconnected or clicked Leave.
 * onUndoRequest(reqSeq)      — opponent is requesting an undo (optional).
 * onUndoResponse(accepted)   — our undo request was accepted/declined (optional).
 */
export function subscribeRoom(onStateChange, onOpponentJoined, onOpponentLeft,
                               onUndoRequest, onUndoResponse) {
  if (!roomRef) return;
  unsubRoom = onValue(roomRef, snap => {
    if (!snap.exists()) return;
    const d = snap.val();

    // Host: notify once when guest arrives
    if (myPlayer === 1 && d.guestOnline && !guestSeenOnce && onOpponentJoined) {
      guestSeenOnce = true;
      gameStarted   = true;
      onOpponentJoined();
    }

    // Detect opponent offline (host watches guest; guest watches host)
    const opponentOnline =
      myPlayer === 1 ? d.guestOnline
                     : d.hostOnline !== false;
    const opponentEverJoined =
      myPlayer === 1 ? !!d.guestEverJoined
                     : true; // host was already there when guest joined

    if (!opponentOnline && opponentEverJoined && !opponentLeftNotified && onOpponentLeft) {
      // Don't fire immediately — opponent may just have a momentary
      // Firebase reconnect blip. Wait OPPONENT_LEFT_GRACE_MS before declaring them gone.
      if (!opponentLeftTimer) {
        opponentLeftTimer = setTimeout(() => {
          opponentLeftTimer    = null;
          opponentLeftNotified = true;
          onOpponentLeft(gameStarted || myPlayer === 2);
        }, OPPONENT_LEFT_GRACE_MS);
      }
    } else if (opponentOnline && opponentLeftTimer) {
      // Opponent came back before grace period expired — cancel
      clearTimeout(opponentLeftTimer);
      opponentLeftTimer = null;
    }

    // Apply state if it came from the other player
    if (d.seq > localSeq) {
      localSeq = d.seq;
      onStateChange(d);
    }

    // ── Undo request from opponent ─────────────────────────────────────────
    const undoReq = d.undoReq;
    if (undoReq && undoReq.from !== myPlayer && undoReq.seq > lastSeenUndoReq) {
      lastSeenUndoReq = undoReq.seq;
      if (onUndoRequest) onUndoRequest(undoReq.seq);
    }

    // ── Undo response for our pending request ──────────────────────────────
    const undoResp = d.undoResp;
    if (undoResp && undoResp.forSeq === pendingMyUndoSeq && pendingMyUndoSeq > 0) {
      const accepted = undoResp.accepted;
      pendingMyUndoSeq = 0;
      if (onUndoResponse) onUndoResponse(accepted);
    }
  });
}

// ─── Undo request / response ──────────────────────────────────────────────────
/** Requester: broadcast an undo request. Returns the seq number. */
export async function sendUndoRequest() {
  if (!roomRef) return 0;
  pendingMyUndoSeq++;
  await update(roomRef, {
    undoReq:  { from: myPlayer, seq: pendingMyUndoSeq },
    undoResp: null,
  });
  return pendingMyUndoSeq;
}

/** Responder: reply to an undo request. */
export async function sendUndoResponse(reqSeq, accepted) {
  if (!roomRef) return;
  await update(roomRef, { undoResp: { forSeq: reqSeq, accepted } });
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
    lastMoveAt:        Date.now(),
  });
}

// ─── Signal leave (write to Firebase before disconnecting) ────────────────────
/** Call this before leaveRoom() so the opponent is notified. */
export async function signalLeave() {
  if (!roomRef || !myPlayer) return;
  const field = myPlayer === 1 ? 'hostOnline' : 'guestOnline';
  try { await update(roomRef, { [field]: false }); } catch (_) {}
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
  if (unsubRoom)         { unsubRoom(); unsubRoom = null; }
  if (unsubChat)         { unsubChat(); unsubChat = null; }
  if (unsubConnected)    { unsubConnected(); unsubConnected = null; }
  if (opponentLeftTimer) { clearTimeout(opponentLeftTimer); opponentLeftTimer = null; }
  roomRef              = null;
  chatRef              = null;
  roomCode             = null;
  myPlayer             = null;
  isOnline             = false;
  localSeq             = 0;
  guestSeenOnce        = false;
  gameStarted          = false;
  opponentLeftNotified = false;
  lastSeenUndoReq      = 0;
  pendingMyUndoSeq     = 0;
}
