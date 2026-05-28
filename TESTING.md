# Go 3D — Pre-launch Testing Checklist

Work through these over the next few days. Anything that fails → make a note → tell Claude.

## Status
- ✅ §1 Sign-in & payment — works
- ✅ §2 Online multiplayer — works
- ✅ §3 Single-player & AI — works
- ✅ §4 Offline mode — works
- ✅ §5 Install / PWA — works
- ✅ §6 UI / UX polish — verified 2026-05-26
- ✅ §7 Edge cases — verified 2026-05-26
- ✅ §8 Sounds — works
- 🟡 §9 Browser compatibility — Chrome desktop + Android Chrome OK; iOS Safari: page renders, full flow not tested
- ⏳ §10 Legal / analytics — pending

---

## 1. Sign-in & payment (the money path)

- [ ] **Brand new Google account, brand new device** → sign in → pay €1 → game unlocks within 30 seconds
- [ ] Cancel the Stripe payment halfway → can retry without weird state
- [ ] Pay successfully but close the tab before redirect → reopen go3dgame.com → still unlocked
- [ ] Try Create Game while signed out → sign-in prompt → after sign-in, flow continues
- [ ] Already-paid user comes back next day → straight to game creation, no payment gate
- [ ] Sign out, then back in with different account → that other account asks for payment again
- [ ] On mobile: sign-in redirect comes back to the right place
- [ ] On desktop: sign-in popup completes without weird closes

## 2. Online multiplayer (the social path)

- [ ] Two-device game: host on laptop, guest on phone → both can play, see each other's moves
- [ ] Two-device game on a 7³ or 9³ board → no lag with bigger boards
- [ ] Capture stones online → opponent hears the clatter sound
- [ ] Idle 5 min → game still alive
- [ ] Idle 15+ min while it's the other player's turn → idle banner appears for them
- [ ] One player closes their tab → other player sees "opponent left"
- [ ] One player loses wifi briefly, reconnects → game resumes
- [ ] Undo request → opponent gets prompt → accept → both boards roll back
- [ ] Undo request → opponent declines → requester sees the decline
- [ ] Chat works both ways, mobile + desktop

## 3. Single-player & AI

- [ ] Beat the AI on 3³ → undo a move mid-game → keep playing
- [ ] Watch CvC (computer vs computer) on every board size → no infinite loops, both pass eventually
- [ ] PvC on 7³ and 9³ → AI moves in under 5 seconds even on weaker phones
- [ ] AI passes when no real moves left (doesn't fill own territory)
- [ ] AI builds eyes (you should see groups with empty cells surrounded by its colour)

## 4. Offline mode (service worker)

- [ ] Open go3dgame.com fully → turn on airplane mode → reload → game still works
- [ ] Play full PvC game while offline → all interactions work
- [ ] Re-enable wifi → online mode works again immediately
- [ ] Open online modal while offline → it should fail gracefully (not just spin)

## 5. Install / PWA

- [ ] Desktop Chrome → bottom install banner appears → click Install → installs as app
- [ ] Installed PWA → opens in own window without browser chrome
- [ ] Mobile (Android Chrome) → install banner → install → app icon on home screen
- [ ] iPhone Safari → use Share → Add to Home Screen → opens fullscreen
- [ ] Uninstall the PWA → revisit → install banner reappears

## 6. UI / UX polish

- [ ] Hard refresh after a long session → no leftover state from previous game
- [ ] Open ⚙️ Settings → can scroll to bottom on a small screen → Install + Done buttons visible
- [ ] Open ? help → starts at top, can scroll all the way down
- [ ] Theme toggle works (Dark ↔ Light)
- [ ] Sound toggle works
- [ ] Layer buttons (L1, L2…) hide/show layers correctly on each board size
- [ ] Drag to rotate is smooth on phone
- [ ] Pinch to zoom works on phone
- [ ] Custom dialogs (confirm, payment, install) all look right in dark AND light mode

## 7. Edge cases

- [ ] Try to pay €1 with a declined card → graceful error, can retry
- [ ] Try a room code that doesn't exist → clear error message
- [ ] Try to join a room that's already full → clear error message
- [ ] Try the same room code as both host AND guest → no weird collision
- [ ] Refresh the page mid-game (offline mode) → board state restored
- [ ] Refresh the page mid-game (online mode) → ???  ← test what happens here, may need fix

## 8. Sounds

- [ ] Placement sound plays on every move
- [ ] Capture sound plays when stones are captured
- [ ] Sounds work on phone (iOS audio is finicky — needs user gesture first)
- [ ] Sound on/off toggle in settings persists across reloads
- [ ] Capture sound scales with capture count (more stones = busier clatter)

## 9. Browser compatibility

- [ ] Chrome (desktop + Android)
- [ ] Safari (Mac + iPhone)
- [ ] Firefox (desktop)
- [ ] Edge (desktop)
- [ ] Brave or another privacy-blocker browser → does Firebase auth still work?

## 10. After all of the above

- [ ] Privacy policy + Terms of service + support email — minimum for advertising
- [ ] Firebase Analytics actually tracking → check dashboard after 24h of testing
- [ ] Stripe dashboard shows successful tax handling for your country
- [ ] Trial of error: deliberately try to break things — what does a confused user see?

---

## Bugs found during testing

(Log them here as you find them — Claude can fix in batch)

- 
- 
- 
