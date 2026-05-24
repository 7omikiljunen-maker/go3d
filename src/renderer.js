// ─── renderer.js — Three.js scene, meshes, animation ─────────────────────────
import * as THREE from 'three';
import { N, C, SP, OFF, layerVisible, board, computeTerritory } from './board.js';

// ─── Core Three.js objects (exported so controls.js can use camera/renderer) ─
export let renderer, camera, scene;

// Groups
export let gridGroup, dotsGroup, hintsGroup, stonesGroup, terrGroup, markerGroup;

// Mesh state
export let stoneMeshMap = {};
export let lastMarker   = null;
export let dotMeshList  = [];
export let intersectionPoints = [];

const animating = [];

// ─── Hint materials (one per player colour) ──────────────────────────────────
const hintMats = [
  new THREE.MeshPhongMaterial({ color: 0x2255ff, opacity: 0.16, transparent: true, depthWrite: false }),
  new THREE.MeshPhongMaterial({ color: 0x22ddff, opacity: 0.16, transparent: true, depthWrite: false }),
];

const markerGeo = new THREE.RingGeometry(0.22, 0.32, 20);

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

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.lookAt(0, 0, 0);

  // Lighting
  scene.add(new THREE.AmbientLight(0x8888cc, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(6, 12, 8); sun.castShadow = true; scene.add(sun);
  const fill = new THREE.DirectionalLight(0x4466ff, 0.3);
  fill.position.set(-5, -3, -6); scene.add(fill);
  const rim = new THREE.PointLight(0xffffff, 0.4, 60);
  rim.position.set(-6, 6, -6); scene.add(rim);

  // Groups
  gridGroup   = new THREE.Group(); scene.add(gridGroup);
  dotsGroup   = new THREE.Group(); scene.add(dotsGroup);
  hintsGroup  = new THREE.Group(); scene.add(hintsGroup);
  stonesGroup = new THREE.Group(); scene.add(stonesGroup);
  terrGroup   = new THREE.Group(); scene.add(terrGroup);
  markerGroup = new THREE.Group(); scene.add(markerGroup);
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
  const mat = new THREE.LineBasicMaterial({ color: 0x4466aa, opacity: 0.22, transparent: true });
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
  const mat = new THREE.MeshBasicMaterial({ color: 0x8899cc, opacity: 0.45, transparent: true });
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
  stoneMeshMap = {}; lastMarker = null; animating.length = 0;
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

// ─── Stones ──────────────────────────────────────────────────────────────────
function makeStoneMat(color) {
  return color === 1
    ? new THREE.MeshPhongMaterial({ color: 0x111111, specular: 0x555555, shininess: 120 })
    : new THREE.MeshPhongMaterial({ color: 0xf0ede0, specular: 0x999999, shininess: 160 });
}

export function addStoneMesh(x, y, z, color) {
  const key = `${x},${y},${z}`;
  const geo = new THREE.SphereGeometry(C.stoneR, 24, 24);
  const m = new THREE.Mesh(geo, makeStoneMat(color));
  const targetY = OFF + y * SP;
  m.position.set(OFF + x*SP, targetY + 4, OFF + z*SP);
  m.scale.set(0.1, 0.1, 0.1); m.castShadow = true;
  stonesGroup.add(m); stoneMeshMap[key] = m;
  animating.push({ mesh: m, targetPos: new THREE.Vector3(OFF + x*SP, targetY, OFF + z*SP), t: 0 });

  // Last-move ring marker
  while (markerGroup.children.length) markerGroup.remove(markerGroup.children[0]);
  lastMarker = null;
  const ringMat = new THREE.MeshBasicMaterial({
    color: color === 1 ? 0x44aaff : 0xff7744,
    side: THREE.DoubleSide, opacity: 0.9, transparent: true,
  });
  const ring = new THREE.Mesh(markerGeo, ringMat);
  ring.position.set(OFF + x*SP, targetY + 0.01, OFF + z*SP);
  ring.rotation.x = -Math.PI / 2;
  markerGroup.add(ring); lastMarker = ring;
}

export function removeStonesMesh(coords) {
  for (const [x, y, z] of coords) {
    const k = `${x},${y},${z}`;
    if (stoneMeshMap[k]) { stonesGroup.remove(stoneMeshMap[k]); delete stoneMeshMap[k]; }
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
    for (let i = animating.length - 1; i >= 0; i--) {
      const a = animating[i];
      a.t = Math.min(1, a.t + dt * 5);
      const ease = 1 - Math.pow(1 - a.t, 3);
      a.mesh.position.lerpVectors(
        new THREE.Vector3(a.targetPos.x, a.targetPos.y + 4, a.targetPos.z),
        a.targetPos, ease
      );
      const s = 0.1 + 0.9 * ease; a.mesh.scale.set(s, s, s);
      if (a.t >= 1) animating.splice(i, 1);
    }
    renderer.render(scene, camera);
  }
  animate();
}
