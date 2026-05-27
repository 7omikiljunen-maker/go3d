# Go 3D — To-Do List

Last updated: 2026-05-27

---

## 🔴 Launch / Pre-release

- [ ] **Post TikTok video** — video is shot & edited, just needs posting
- [ ] **Verify Google OAuth consent screen shows "Go 3D"** — saved in Cloud Console, check tomorrow if propagated
- [x] **Complete TESTING.md §6** — UI/UX polish — verified 2026-05-26
- [x] **Complete TESTING.md §7** — edge cases — verified 2026-05-26 (found & fixed refresh rejoin bug + undo overlay bug)
- [ ] **Complete TESTING.md §10** — confirm Firebase Analytics funnel events firing after 24h of real traffic
- [ ] **iPhone friend test** — full payment + online flow on iOS Safari (incl. Private Browsing where applicable)
- [ ] **Test 15-min idle banner** — host a game, go idle for 15+ min, verify banner shows on the other player's screen
- [ ] **Smoke test new security changes** — (a) create game while signed in, (b) join from incognito on phone — should silently anonymous-auth, (c) Stripe TEST refund → verify `users/{uid}/paid` flips false

---

## 🟡 Features being considered

- [ ] **19×19 board** — adds "real Go" size; AI would need to be limited to 1-ply or random to stay fast; 3D 19³ is massive so might be 2D-only layer view
- [x] **Difficulty levels** — Easy / Medium / Hard; shipped & verified 2026-05-26
- [ ] **Scoring detail panel** — after game ends, show territory breakdown per layer or a table (Black territory, White territory, Komi, Captures → final score); currently just totals in overlay

---

## 🟢 Nice to have (low priority)

- [ ] **Firefox / Edge / Brave testing** — §9 of TESTING.md
- [ ] **STATS.md first entry** — fill in week-1 numbers once TikTok is posted
- [ ] **Stripe dashboard** — check tax handling for Finland after first real purchase
- [ ] **Firebase Analytics** — verify custom events in dashboard after 24h of traffic
- [ ] **Server-side Stripe checkout session** — eliminate `client_reference_id` tampering vector; ~2 h work, low practical risk
- [ ] **Content-Security-Policy meta tag** — defense in depth, ~30 min
- [ ] **Upgrade `firebase-functions` v6 → v7** — current Cloud Function deploy warns about outdated SDK; breaking changes so requires testing
- [ ] **Room-code collision check** in `createRoom` — vanishingly rare (~10⁻⁹) but defensive

---

## ✅ Done (recent — 2026-05-27 session)

### Polish + features
- [x] Scrollable chat history with thin aesthetic scrollbar + Android touch-scroll fix
- [x] Immediate opponent-leave detection when room is deleted (was 15 min)
- [x] Hide Undo button on opponent-left overlay (overlay is reused from game-end)
- [x] Beacon stars (10 largest) twinkle dramatically with multi-frequency shimmer (opacity + size)
- [x] Satellite dot drifts across the dark-mode background occasionally
- [x] Auto-rotate camera mode — Settings → AUTOROTATE; ~63s per orbit; default ON; pauses on input + while overlays open

### Code review bugs fixed (8 of 10 findings shipped)
- [x] Auto-rotate cooldown bumped on every camera-modifying input (was timed from drag start)
- [x] `window.blur` resets `dragging` flag (was stuck-true on alt-tab during drag)
- [x] `setupBoard()` grants 1-second grace period before auto-rotate kicks in
- [x] `setOnFrame` converted to composable `addFrameHook` list pattern
- [x] Satellite rejects near-antipodal start/end pairs (no more teleport-to-origin glitch)
- [x] Reverted `resolveRedirect` gating that broke iOS Private Browsing sign-in
- [x] Overlay-aware autoRotate (pauses while any modal is visible)
- [x] Pinch-zoom and wheel-zoom both pause auto-rotate too

### Security hardening (all live)
- [x] Firebase write rule tightened — existing rooms require auth (closes "anyone can deface any room" hole)
- [x] Anonymous auth for guests in join flow (silent, no popup)
- [x] Remote room state validated before applied (blocks N=1000000 DoS attacks)
- [x] Chat message length capped at 500 (client send + receive + Firebase rule)
- [x] Stripe webhook handles refunds + lost disputes — auto-revokes `paid: true`
- [x] Reverse-lookup `/payments/{paymentIntentId}` table written on checkout completion
- [x] Explicit deny on `/payments` node — admin SDK only

### Earlier (Done before this session)
- [x] Stripe €1 payment gate — live end-to-end
- [x] Firebase Auth (Google sign-in, popup + redirect fallback)
- [x] Firebase Webhook → paid flag (Node 22 Cloud Function)
- [x] Service worker / offline play (vite-plugin-pwa)
- [x] PWA install banner + settings button
- [x] Capture sound (Web Audio synth)
- [x] Opponent move sound in online games
- [x] Idle detection (15-min banner, 24-h auto-end)
- [x] Presence fix v2 — 15-min grace period for mobile screen sleep
- [x] Firebase Analytics (12 custom funnel events)
- [x] Privacy policy + Terms of service (/privacy.html, /terms.html)
- [x] Support email (support@go3dgame.com → Gmail)
- [x] Stripe + app rebrand to "Go 3D"
- [x] Starfield + nebula background (dark mode)
- [x] Custom domain go3dgame.com (Cloudflare, HTTPS)
- [x] GitHub Pages auto-deploy (GitHub Actions)
- [x] SEO meta tags + Open Graph / Twitter card tags
- [x] Google Search Console — domain verified, indexing requested
- [x] Room deletion on leave (GDPR data retention fix)
- [x] Online rejoin after page refresh
- [x] Fix undo overlay bug (responder side stays stuck on game-over)
- [x] Default theme dark mode
- [x] AI difficulty levels (Easy / Medium / Hard)
- [x] 11×11×11 board (PvP only)
- [x] MCTS AI for Hard difficulty on 3³/5³
