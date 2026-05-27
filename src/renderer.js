// ─── renderer.js — Three.js scene, meshes, animation ─────────────────────────
import * as THREE from 'three';
import { N, C, SP, OFF, layerVisible, board, computeTerritory } from './board.js';

// ─── Core Three.js objects ────────────────────────────────────────────────────
export let renderer, camera, scene;

// ─── Theme flag (updated by setSceneBg) ──────────────────────────────────────
let lightTheme = false;

// Groups
export let gridGroup, dotsGroup, hintsGroup, stonesGroup, terrGroup, markerGroup;
let starfieldGroup; // stars + nebula, dark-mode only

// Mesh state
export let stoneMeshMap = {};
export let lastMarker   = null;
export let dotMeshList  = [];
export let intersectionPoints = [];

// Animation queues
const dropAnimating  = [];  // stones dropping in
const exitAnimating  = [];  // captured stones flying out

// Per-frame callback list (used for auto-rotate; supports multiple hooks
// so future features won't silently clobber existing ones).
const _frameHooks = [];
/** Register a per-frame hook. Returns an unhook function. */
export function addFrameHook(fn) {
  _frameHooks.push(fn);
  return () => {
    const i = _frameHooks.indexOf(fn);
    if (i >= 0) _frameHooks.splice(i, 1);
  };
}
// Legacy single-slot setter retained for any callers still using it.
export function setOnFrame(fn) { addFrameHook(fn); }

// ─── Hint materials ───────────────────────────────────────────────────────────
const hintMats = [
  new THREE.MeshPhongMaterial({ color: 0x2255ff, opacity: 0.16, transparent: true, depthWrite: false }),
  new THREE.MeshPhongMaterial({ color: 0x22ddff, opacity: 0.16, transparent: true, depthWrite: false }),
];

// Ring scales with stone size so it's always visible outside the stone
function makeMarkerGeo() {
  return new THREE.RingGeometry(C.stoneR * 1.08, C.stoneR * 1.5, 24);
}

// ─── Init ────────────────────────────────────────────────────────────────────
export function initRenderer(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(0x1a1a2e, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a1a2e, 0.032);

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0x8888cc, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(6, 12, 8); sun.castShadow = true; scene.add(sun);
  const fill = new THREE.DirectionalLight(0x4466ff, 0.3);
  fill.position.set(-5, -3, -6); scene.add(fill);
  const rim = new THREE.PointLight(0xffffff, 0.4, 60);
  rim.position.set(-6, 6, -6); scene.add(rim);

  gridGroup   = new THREE.Group(); scene.add(gridGroup);
  dotsGroup   = new THREE.Group(); scene.add(dotsGroup);
  hintsGroup  = new THREE.Group(); scene.add(hintsGroup);
  stonesGroup = new THREE.Group(); scene.add(stonesGroup);
  terrGroup   = new THREE.Group(); scene.add(terrGroup);
  markerGroup = new THREE.Group(); scene.add(markerGroup);

  starfieldGroup = buildStarfield();
  scene.add(starfieldGroup);
}

// ─── Starfield + nebula — procedural, no textures ────────────────────────────
function buildStarfield() {
  const group = new THREE.Group();

  // ── STARS — five layers, with a few real "beacon" stars ────────────────────
  const layers = [
    { count: 800, size: 0.06,  baseOpacity: 0.70, twinkles: false },
    { count: 350, size: 0.11,  baseOpacity: 0.90, twinkles: false },
    { count: 120, size: 0.28,  baseOpacity: 1.00, twinkles: true  },
    { count:  40, size: 0.50,  baseOpacity: 1.00, twinkles: true  },
    { count:  10, size: 0.85,  baseOpacity: 1.00, twinkles: 'beacon' },
  ];

  // Mostly white, occasionally tinted blue/yellow/red — like real stars
  const starColors = [
    [1.00, 1.00, 1.00],   // white            ×70%
    [1.00, 1.00, 1.00],
    [1.00, 1.00, 1.00],
    [1.00, 1.00, 1.00],
    [1.00, 1.00, 1.00],
    [1.00, 1.00, 1.00],
    [1.00, 1.00, 1.00],
    [0.75, 0.85, 1.00],   // blue-white       ×10%
    [1.00, 0.95, 0.78],   // yellow-white     ×10%
    [1.00, 0.78, 0.65],   // amber-red        ×10%
  ];

  for (const cfg of layers) {
    const positions = new Float32Array(cfg.count * 3);
    const colors    = new Float32Array(cfg.count * 3);
    for (let i = 0; i < cfg.count; i++) {
      const radius = 80 + Math.random() * 50;
      const theta  = Math.random() * Math.PI * 2;
      const phi    = Math.acos(2 * Math.random() - 1);
      positions[i*3]   = radius * Math.sin(phi) * Math.cos(theta);
      positions[i*3+1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i*3+2] = radius * Math.cos(phi);

      const c = starColors[Math.floor(Math.random() * starColors.length)];
      colors[i*3]   = c[0];
      colors[i*3+1] = c[1];
      colors[i*3+2] = c[2];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color',    new THREE.BufferAttribute(colors,    3));

    const mat = new THREE.PointsMaterial({
      size: cfg.size,
      opacity: cfg.baseOpacity,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexColors: true,
    });
    mat.userData.baseOpacity  = cfg.baseOpacity;
    mat.userData.baseSize     = cfg.size;
    mat.userData.twinklePhase = Math.random() * Math.PI * 2;
    mat.userData.twinkles     = cfg.twinkles;

    group.add(new THREE.Points(geom, mat));
  }

  // ── NEBULA SPRITES — patchy procedural gas clouds ─────────────────────────
  const nebulaPalette = [
    [110,  40, 180],   // purple
    [ 40,  70, 200],   // blue
    [170,  40, 130],   // magenta
    [ 60, 120, 200],   // teal-blue
  ];

  function makeNebulaTexture(rgb) {
    const size = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');

    // Layer ~15 overlapping coloured blobs with additive compositing
    ctx.globalCompositeOperation = 'lighter';
    const [r0, g0, b0] = rgb;
    for (let i = 0; i < 15; i++) {
      const cx = size/2 + (Math.random() - 0.5) * size * 0.7;
      const cy = size/2 + (Math.random() - 0.5) * size * 0.7;
      const rad = size * (0.08 + Math.random() * 0.28);
      const r = Math.max(0, Math.min(255, r0 + (Math.random() - 0.5) * 70)) | 0;
      const g = Math.max(0, Math.min(255, g0 + (Math.random() - 0.5) * 70)) | 0;
      const b = Math.max(0, Math.min(255, b0 + (Math.random() - 0.5) * 70)) | 0;
      const alpha = 0.18 + Math.random() * 0.22;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grad.addColorStop(0,   `rgba(${r},${g},${b},${alpha})`);
      grad.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.3})`);
      grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }

    // Soft circular falloff so the sprite has no hard edges
    ctx.globalCompositeOperation = 'destination-in';
    const fade = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    fade.addColorStop(0.0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.6, 'rgba(0,0,0,0.5)');
    fade.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // 5 nebula sprites at varying distances and sizes
  for (let i = 0; i < 5; i++) {
    const rgb  = nebulaPalette[i % nebulaPalette.length];
    const tex  = makeNebulaTexture(rgb);
    const mat  = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.55,
    });
    const sprite = new THREE.Sprite(mat);
    const scale = 80 + Math.random() * 60;
    sprite.scale.set(scale, scale, 1);
    const a = (i / 5) * Math.PI * 2 + Math.random() * 0.8;
    const d = 130 + Math.random() * 50;
    sprite.position.set(
      Math.cos(a) * d,
      (Math.random() - 0.5) * 80,
      Math.sin(a) * d,
    );
    group.add(sprite);
  }

  // ── SATELLITE — glowing dot crossing the sky occasionally ───────────────────
  // Use a soft radial-gradient sprite so it reads as a point of light, not a
  // solid disc. Sprite always faces the camera, so it stays bright at any angle.
  function makeSatelliteTexture() {
    const size = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    grad.addColorStop(0,    'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.25, 'rgba(220, 235, 255, 0.7)');
    grad.addColorStop(0.55, 'rgba(180, 210, 255, 0.18)');
    grad.addColorStop(1,    'rgba(180, 210, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(cv);
  }
  const satMat = new THREE.SpriteMaterial({
    map: makeSatelliteTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,   // brightens the background — glows
  });
  const satDot = new THREE.Sprite(satMat);
  satDot.scale.set(2.5, 2.5, 1);        // visible size in world units

  group.add(satDot);
  group.userData.sat = {
    dot: satDot,
    tmp: new THREE.Vector3(),
    active: false, progress: 0, duration: 0,
    start: new THREE.Vector3(), end: new THREE.Vector3(),
    nextSpawn: 15 + Math.random() * 30,  // first pass 15–45 s after load
  };

  return group;
}

// ─── Resize ──────────────────────────────────────────────────────────────────
export function resizeRenderer(canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ─── Scene builders ──────────────────────────────────────────────────────────
export function buildGrid() {
  while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
  const mat = new THREE.LineBasicMaterial({
    color:       lightTheme ? 0x1a2a4a : 0x4466aa,
    opacity:     lightTheme ? 0.45     : 0.22,
    transparent: true,
  });
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    if (!layerVisible[b]) continue;
    const mk = (p1, p2) => {
      const g = new THREE.BufferGeometry().setFromPoints(
        [p1, p2].map(([x, y, z]) => new THREE.Vector3(OFF + x*SP, OFF + y*SP, OFF + z*SP))
      );
      gridGroup.add(new THREE.Line(g, mat));
    };
    mk([a, b, 0], [a, b, N-1]);
    mk([a, 0, b], [a, N-1, b]);
    mk([0, a, b], [N-1, a, b]);
  }
}

export function buildDots() {
  while (dotsGroup.children.length) dotsGroup.remove(dotsGroup.children[0]);
  dotMeshList = []; intersectionPoints = [];
  const geo = new THREE.SphereGeometry(C.dotR, 8, 8);
  const mat = new THREE.MeshBasicMaterial({
    color:       lightTheme ? 0x223366 : 0x8899cc,
    opacity:     lightTheme ? 0.65     : 0.45,
    transparent: true,
  });
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(OFF + x*SP, OFF + y*SP, OFF + z*SP);
    m.userData = { x, y, z };
    m.visible = layerVisible[y];
    dotsGroup.add(m); dotMeshList.push(m);
    intersectionPoints.push({ x, y, z, pos: new THREE.Vector3(OFF + x*SP, OFF + y*SP, OFF + z*SP) });
  }
}

export function clearScene() {
  [gridGroup, dotsGroup, hintsGroup, stonesGroup, terrGroup, markerGroup].forEach(g => {
    while (g.children.length) g.remove(g.children[0]);
  });
  stoneMeshMap = {}; lastMarker = null;
  dropAnimating.length = 0; exitAnimating.length = 0;
  dotMeshList = []; intersectionPoints = [];
}

// ─── Hints ───────────────────────────────────────────────────────────────────
export function updateHints(current, gameOver, isComputerTurn, isLegal, koState) {
  while (hintsGroup.children.length) hintsGroup.remove(hintsGroup.children[0]);
  if (gameOver || isComputerTurn()) return;
  const geo = new THREE.SphereGeometry(C.hintR, 12, 12);
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) {
    if (!layerVisible[y]) continue;
    if (board[x][y][z] === 0 && isLegal(x, y, z, current, board, koState)) {
      const h = new THREE.Mesh(geo, hintMats[current - 1]);
      h.position.set(OFF + x*SP, OFF + y*SP, OFF + z*SP);
      hintsGroup.add(h);
    }
  }
}

// ─── Stone materials ──────────────────────────────────────────────────────────
function makeStoneMat(color) {
  return color === 1
    ? new THREE.MeshPhongMaterial({ color: 0x111111, specular: 0x555555, shininess: 120 })
    : new THREE.MeshPhongMaterial({ color: 0xf0ede0, specular: 0x999999, shininess: 160 });
}

// ─── Add stone with drop animation ───────────────────────────────────────────
export function addStoneMesh(x, y, z, color) {
  const key = `${x},${y},${z}`;
  const geo = new THREE.SphereGeometry(C.stoneR, 24, 24);
  const m = new THREE.Mesh(geo, makeStoneMat(color));
  const targetY = OFF + y * SP;
  m.position.set(OFF + x*SP, targetY + 4, OFF + z*SP);
  m.scale.set(0.1, 0.1, 0.1); m.castShadow = true;
  m.visible = layerVisible[y];   // respect any user-hidden layers
  stonesGroup.add(m); stoneMeshMap[key] = m;
  dropAnimating.push({ mesh: m, targetPos: new THREE.Vector3(OFF + x*SP, targetY, OFF + z*SP), t: 0 });

  // Last-move ring
  while (markerGroup.children.length) markerGroup.remove(markerGroup.children[0]);
  lastMarker = null;
  const ringMat = new THREE.MeshBasicMaterial({
    color: color === 1 ? 0x44aaff : 0xff7744,
    side: THREE.DoubleSide, opacity: 0.9, transparent: true,
  });
  const ring = new THREE.Mesh(makeMarkerGeo(), ringMat);
  ring.position.set(OFF + x*SP, targetY + 0.01, OFF + z*SP);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = layerVisible[y];
  markerGroup.add(ring); lastMarker = ring;
}

// ─── Add stone instantly (used by undo rebuild) ───────────────────────────────
function addStoneMeshImmediate(x, y, z, color) {
  const key = `${x},${y},${z}`;
  const geo = new THREE.SphereGeometry(C.stoneR, 24, 24);
  const m = new THREE.Mesh(geo, makeStoneMat(color));
  m.position.set(OFF + x*SP, OFF + y*SP, OFF + z*SP);
  m.visible = layerVisible[y];
  m.castShadow = true;
  stonesGroup.add(m); stoneMeshMap[key] = m;
}

// ─── Rebuild all stones from board state (used by undo) ───────────────────────
export function rebuildStoneMeshes(lastPlacedPos) {
  while (stonesGroup.children.length) stonesGroup.remove(stonesGroup.children[0]);
  while (markerGroup.children.length) markerGroup.remove(markerGroup.children[0]);
  stoneMeshMap = {}; lastMarker = null;
  dropAnimating.length = 0; exitAnimating.length = 0;

  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) {
    if (board[x][y][z] !== 0) addStoneMeshImmediate(x, y, z, board[x][y][z]);
  }

  if (lastPlacedPos) {
    const { x, y, z } = lastPlacedPos;
    const color = board[x]?.[y]?.[z];
    if (color) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: color === 1 ? 0x44aaff : 0xff7744,
        side: THREE.DoubleSide, opacity: 0.9, transparent: true,
      });
      const ring = new THREE.Mesh(makeMarkerGeo(), ringMat);
      ring.position.set(OFF + x*SP, OFF + y*SP + 0.01, OFF + z*SP);
      ring.rotation.x = -Math.PI / 2;
      markerGroup.add(ring); lastMarker = ring;
    }
  }
}

// ─── Remove stones with fly-out animation ─────────────────────────────────────
export function removeStonesMesh(coords) {
  for (const [x, y, z] of coords) {
    const k = `${x},${y},${z}`;
    const mesh = stoneMeshMap[k];
    if (mesh) {
      delete stoneMeshMap[k];
      // Clone material so we can animate opacity independently
      mesh.material = mesh.material.clone();
      mesh.material.transparent = true;
      // Random outward velocity
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        2 + Math.random() * 1.5,
        (Math.random() - 0.5) * 3
      );
      exitAnimating.push({ mesh, vel, t: 0 });
    }
  }
}

// ─── Layer visibility sync ───────────────────────────────────────────────────
export function syncLayerVisibility(lastPlaced) {
  dotMeshList.forEach(d => { d.visible = layerVisible[d.userData.y]; });
  Object.entries(stoneMeshMap).forEach(([k, m]) => {
    const [, yy] = k.split(',').map(Number); m.visible = layerVisible[yy];
  });
  if (lastMarker && lastPlaced) lastMarker.visible = layerVisible[lastPlaced.y];
  terrGroup.children.forEach(m => {
    const ly = Math.round((m.position.y - OFF) / SP);
    m.visible = !!layerVisible[ly];
  });
}

// ─── Territory display ───────────────────────────────────────────────────────
export function showTerritory() {
  while (terrGroup.children.length) terrGroup.remove(terrGroup.children[0]);
  const { black, white, neutral, ownership } = computeTerritory(board);
  const geoT = new THREE.SphereGeometry(C.stoneR * 0.36, 8, 8);
  const matB = new THREE.MeshBasicMaterial({ color: 0x3366ff, opacity: 0.4, transparent: true, depthWrite: false });
  const matW = new THREE.MeshBasicMaterial({ color: 0xdddddd, opacity: 0.4, transparent: true, depthWrite: false });
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) {
    const o = ownership[x][y][z];
    if (o === 0 || board[x][y][z] !== 0) continue;
    const m = new THREE.Mesh(geoT, o === 1 ? matB : matW);
    m.position.set(OFF + x*SP, OFF + y*SP, OFF + z*SP);
    m.visible = layerVisible[y];
    terrGroup.add(m);
  }
  return { black, white, neutral };
}

// ─── Render loop ─────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

export function startRenderLoop() {
  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    for (const fn of _frameHooks) fn(dt);

    // Stone drop animation
    for (let i = dropAnimating.length - 1; i >= 0; i--) {
      const a = dropAnimating[i];
      a.t = Math.min(1, a.t + dt * 5);
      const ease = 1 - Math.pow(1 - a.t, 3);
      a.mesh.position.lerpVectors(
        new THREE.Vector3(a.targetPos.x, a.targetPos.y + 4, a.targetPos.z),
        a.targetPos, ease
      );
      const s = 0.1 + 0.9 * ease; a.mesh.scale.set(s, s, s);
      if (a.t >= 1) dropAnimating.splice(i, 1);
    }

    // Capture fly-out animation
    for (let i = exitAnimating.length - 1; i >= 0; i--) {
      const a = exitAnimating[i];
      a.t = Math.min(1, a.t + dt * 2.5);
      a.mesh.position.addScaledVector(a.vel, dt);
      const s = Math.max(0, 1 - a.t * 1.4);
      a.mesh.scale.set(s, s, s);
      a.mesh.material.opacity = Math.max(0, 1 - a.t * 2);
      if (a.t >= 1) {
        stonesGroup.remove(a.mesh);
        exitAnimating.splice(i, 1);
      }
    }

    // Starfield twinkle — beacon stars flicker dramatically; mid-size shimmer gently
    if (starfieldGroup && starfieldGroup.visible) {
      const t = clock.elapsedTime;
      for (const child of starfieldGroup.children) {
        if (!child.isPoints) continue;
        const mat   = child.material;
        const phase = mat.userData.twinklePhase ?? 0;

        if (mat.userData.twinkles === 'beacon') {
          // Multi-frequency shimmer: gentle flutter + medium pulse + slow breathe
          const shimmer = 0.45 * Math.sin(t * 0.7 + phase)
                        + 0.35 * Math.sin(t * 1.9 + phase * 1.3)
                        + 0.20 * Math.sin(t * 0.15 + phase * 0.5);
          const norm  = (shimmer + 1) * 0.5;          // 0 … 1
          mat.opacity = 0.25 + norm * 0.75;            // 0.25 → 1.0
          mat.size    = mat.userData.baseSize * (0.65 + norm * 0.70); // ×0.65 → ×1.35
        } else if (mat.userData.twinkles === true) {
          // Subtle ±15% opacity shimmer for the two mid-size bright layers
          const base = mat.userData.baseOpacity ?? mat.opacity;
          mat.opacity = base * (0.85 + 0.15 * Math.sin(t * 0.9 + phase));
        }
      }

      // ── Satellite crossing ──────────────────────────────────────────────────
      const sat = starfieldGroup.userData.sat;
      if (sat) {
        if (!sat.active) {
          sat.nextSpawn -= dt;
          if (sat.nextSpawn <= 0) {
            // Pick two random points on the background sphere
            const r  = 92;
            const rp = () => {
              const th = Math.random() * Math.PI * 2;
              const ph = Math.acos(2 * Math.random() - 1);
              return new THREE.Vector3(r * Math.sin(ph) * Math.cos(th),
                                      r * Math.sin(ph) * Math.sin(th),
                                      r * Math.cos(ph));
            };
            sat.start.copy(rp());
            sat.end.copy(rp());
            // Reject near-antipodal pairs: when start and end are nearly opposite,
            // the lerped midpoint passes through the origin, and normalize() of a
            // zero vector returns zero — the dot would teleport to the board centre.
            let safety = 5;
            while (sat.start.dot(sat.end) / (r * r) < -0.9 && safety-- > 0) {
              sat.end.copy(rp());
            }
            sat.duration = 20 + Math.random() * 15;  // 20–35 seconds
            sat.progress = 0;
            sat.active   = true;
          }
        } else {
          sat.progress += dt / sat.duration;
          if (sat.progress >= 1) {
            // Crossing done — hide dot, wait before next pass
            sat.active             = false;
            sat.dot.material.opacity = 0;
            sat.nextSpawn = 45 + Math.random() * 75;  // reappear in 45–120 s
          } else {
            // Current position — lerp then project onto sphere surface
            sat.tmp.lerpVectors(sat.start, sat.end, sat.progress).normalize().multiplyScalar(92);
            sat.dot.position.copy(sat.tmp);

            // Fade in first 8%, fade out last 8%
            const fade = sat.progress < 0.08 ? sat.progress / 0.08
                       : sat.progress > 0.92 ? (1 - sat.progress) / 0.08 : 1;
            sat.dot.material.opacity = fade;
          }
        }
      }
    }

    renderer.render(scene, camera);
  }
  animate();
}

// ─── Theme: update Three.js background & fog color, rebuild grid/dots ────────
export function setSceneBg(hex, isLight = false) {
  lightTheme = isLight;
  renderer.setClearColor(hex, 1);
  if (scene.fog) scene.fog.color.setHex(hex);
  if (starfieldGroup) starfieldGroup.visible = !isLight;   // dark-mode only
  // Only rebuild if initBoard() has already run (layerVisible is an Array).
  // On first load this is called before setupBoard(), so we skip here and
  // let setupBoard()/restoreFromSave() call buildGrid()+buildDots() instead.
  if (Array.isArray(layerVisible)) {
    buildGrid();
    buildDots();
  }
}
