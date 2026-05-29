// ─── multiplayer.js — Firebase room management, state sync, chat ──────────────
import { db, databaseURL } from './firebase.js';
import { getCachedIdToken } from './auth.js';
import {
  ref, set, get, update, remove,
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
let explicitTimerActive  = false; // true when the pending timer is the short explicit-leave one
let lastSeenUndoReq      = 0;   // last undoReq.seq handled as the responder
let pendingMyUndoSeq     = 0;   // seq of our outgoing request (0 = none)
let lastSeenRematchReq   = 0;   // last rematchReq.seq handled as the responder
let pendingMyRematchSeq  = 0;   // seq of our outgoing rematch request (0 = none)
let lastOpponentOnline   = null; // last opponent presence value reported to the UI

const OPPONENT_LEFT_GRACE_MS = 15 * 60 * 1000; // silent drop (sleep/blip): wait 15 min before declaring left
const LEFT_CONFIRM_MS        = 8 * 1000;        // explicit close/leave: react in 8 s (long enough that a refresh can rejoin first)

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

// ─── Rejoin room after a page refresh ────────────────────────────────────────
export async function rejoinRoom(code, player) {
  code = code.trim().toUpperCase();
  const r    = ref(db, `rooms/${code}`);
  const snap = await get(r);
  if (!snap.exists()) return { ok: false, error: 'Room no longer exists' };
  const d = snap.val();
  if (d.gameOver)     return { ok: false, error: 'Game already ended' };

  // Re-mark ourselves as online. If we'd previously set our own leftBy marker
  // (e.g. beforeunload fired on this refresh), clear it so the opponent doesn't
  // mistake the refresh for an intentional leave.
  const myField = player === 1 ? 'hostOnline' : 'guestOnline';
  const reUpd = { [myField]: true };
  if (d.leftBy === player) reUpd.leftBy = null;
  await update(r, reUpd);

  roomRef              = r;
  chatRef              = ref(db, `rooms/${code}/chat`);
  roomCode             = code;
  myPlayer             = player;
  isOnline             = true;
  localSeq             = d.seq ?? 0;
  guestSeenOnce        = !!d.guestEverJoined;
  gameStarted          = !!d.guestEverJoined;
  opponentLeftNotified = false;

  watchPresence(code);
  return { ok: true, N: d.N, data: d, guestEverJoined: !!d.guestEverJoined };
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
                               onUndoRequest, onUndoResponse,
                               onRematchRequest, onRematchResponse,
                               onOpponentPresence) {
  if (!roomRef) return;
  unsubRoom = onValue(roomRef, snap => {
    if (!snap.exists()) {
      // Room was deleted — opponent intentionally left (signalLeave deletes after 3 s)
      if (onOpponentLeft && !opponentLeftNotified) {
        opponentLeftNotified = true;
        if (opponentLeftTimer) { clearTimeout(opponentLeftTimer); opponentLeftTimer = null; }
        onOpponentLeft(gameStarted || myPlayer === 2);
      }
      return;
    }
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

    // Live presence banner — reflects the opponent's connection within seconds
    // of any disconnect (Firebase onDisconnect flips the flag server-side). This
    // is the reliable, immediate "something happened" signal; the destructive
    // "opponent left" overlay below is the slower, definitive backstop.
    if (opponentEverJoined && onOpponentPresence && opponentOnline !== lastOpponentOnline) {
      lastOpponentOnline = opponentOnline;
      onOpponentPresence(opponentOnline);
    }

    // Explicit leave: opponent closed the tab or clicked Leave (wrote leftBy).
    const opponentLeftExplicitly = d.leftBy != null && d.leftBy !== myPlayer;
    const shouldDeclareLeft = (!opponentOnline || opponentLeftExplicitly) && opponentEverJoined;

    if (shouldDeclareLeft && !opponentLeftNotified && onOpponentLeft) {
      // Explicit close → react fast (8 s). Silent drop → long grace (tolerates
      // phone sleep / reconnect blips). If a long timer is already pending and an
      // explicit leave then arrives, swap it for the short one.
      if (opponentLeftExplicitly && opponentLeftTimer && !explicitTimerActive) {
        clearTimeout(opponentLeftTimer);
        opponentLeftTimer = null;
      }
      if (!opponentLeftTimer) {
        explicitTimerActive = opponentLeftExplicitly;
        const grace = opponentLeftExplicitly ? LEFT_CONFIRM_MS : OPPONENT_LEFT_GRACE_MS;
        opponentLeftTimer = setTimeout(() => {
          opponentLeftTimer    = null;
          explicitTimerActive  = false;
          opponentLeftNotified = true;
          onOpponentLeft(gameStarted || myPlayer === 2);
        }, grace);
      }
    } else if (!shouldDeclareLeft && opponentLeftTimer) {
      // Opponent came back (online again, and any leftBy marker cleared) before
      // the timer fired — e.g. a reconnect blip or a page refresh that rejoined.
      clearTimeout(opponentLeftTimer);
      opponentLeftTimer   = null;
      explicitTimerActive = false;
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

    // ── Rematch request from opponent ──────────────────────────────────────
    const rematchReq = d.rematchReq;
    if (rematchReq && rematchReq.from !== myPlayer && rematchReq.seq > lastSeenRematchReq) {
      lastSeenRematchReq = rematchReq.seq;
      if (onRematchRequest) onRematchRequest(rematchReq.seq);
    }

    // ── Rematch response for our pending request ──────────────────────────
    const rematchResp = d.rematchResp;
    if (rematchResp && rematchResp.forSeq === pendingMyRematchSeq && pendingMyRematchSeq > 0) {
      const accepted = rematchResp.accepted;
      pendingMyRematchSeq = 0;
      if (onRematchResponse) onRematchResponse(accepted);
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

// ─── Rematch request / response ───────────────────────────────────────────────
/** Requester: broadcast a rematch request. Returns the seq number. */
export async function sendRematchRequest() {
  if (!roomRef) return 0;
  pendingMyRematchSeq++;
  await update(roomRef, {
    rematchReq:  { from: myPlayer, seq: pendingMyRematchSeq },
    rematchResp: null,
  });
  return pendingMyRematchSeq;
}

/** Responder: reply to a rematch request. */
export async function sendRematchResponse(reqSeq, accepted) {
  if (!roomRef) return;
  await update(roomRef, { rematchResp: { forSeq: reqSeq, accepted } });
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
  // leftBy = explicit "I closed/left" marker. The opponent reacts to this within
  // a short confirm window (LEFT_CONFIRM_MS) instead of the long presence grace.
  // A page refresh clears its own marker on rejoin, so it won't false-fire.
  try { await update(roomRef, { [field]: false, leftBy: myPlayer }); } catch (_) {}
  // Delete the room after a short delay — gives the other player's listener
  // time to receive the online-flag change and show "opponent left" before
  // the room disappears.
  const refToDelete = roomRef;
  setTimeout(() => remove(refToDelete).catch(() => {}), 3000);
}

/** Delete the room immediately — use when no opponent needs to be notified
 *  (e.g. host cancels while still waiting for a guest). */
export function deleteRoom() {
  if (roomRef) remove(roomRef).catch(() => {});
}

/**
 * Tab-close notification. The Firebase SDK's async write does NOT flush before
 * the page is torn down, so on pagehide/beforeunload we use a keepalive fetch
 * straight to the RTDB REST API — that request is guaranteed to be sent even as
 * the page dies. Writes the same leftBy marker signalLeave() does, so the
 * opponent reacts within the short LEFT_CONFIRM_MS window.
 */
export function leaveBeacon() {
  if (!roomCode || !myPlayer) return;
  const field = myPlayer === 1 ? 'hostOnline' : 'guestOnline';
  const token = getCachedIdToken();
  if (!token) return; // can't satisfy the auth-required write rule without it
  const url  = `${databaseURL}/rooms/${roomCode}.json?auth=${token}`;
  const body = JSON.stringify({ [field]: false, leftBy: myPlayer });
  try {
    fetch(url, {
      method:    'PATCH',
      body,
      headers:   { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
export const CHAT_MAX_LEN = 500;

export async function sendChat(text) {
  if (!chatRef) return;
  const clean = String(text || '').trim().slice(0, CHAT_MAX_LEN);
  if (!clean) return;
  await push(chatRef, { player: myPlayer, text: clean, ts: Date.now() });
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
  explicitTimerActive  = false;
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
  lastSeenRematchReq   = 0;
  pendingMyRematchSeq  = 0;
  lastOpponentOnline   = null;
}
