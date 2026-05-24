// ─── controls.js — orbit, zoom, raycasting ───────────────────────────────────
import * as THREE from 'three';
import { camera, intersectionPoints } from './renderer.js';
import { C, layerVisible } from './board.js';

let theta = Math.PI / 4, phi = Math.PI / 4;
export let radius = 16;

let dragging = false, lastX = 0, lastY = 0, dragDist = 0;

export function setRadius(r) { radius = r; }

export function updateCamera() {
  camera.position.set(
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.cos(theta)
  );
  camera.lookAt(0, 0, 0);
}

// ─── Mouse ───────────────────────────────────────────────────────────────────
export function attachMouseControls(canvas, onClickAt) {
  canvas.addEventListener('mousedown', e => {
    dragging = true; lastX = e.clientX; lastY = e.clientY; dragDist = 0;
  });
  window.addEventListener('mouseup', e => {
    if (dragging && dragDist < 6) onClickAt(e.clientX, e.clientY);
    dragging = false;
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    dragDist += Math.sqrt(dx*dx + dy*dy);
    theta -= dx * 0.007;
    phi = Math.max(0.12, Math.min(Math.PI - 0.12, phi - dy * 0.007));
    lastX = e.clientX; lastY = e.clientY;
    updateCamera();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    radius = Math.max(3, Math.min(40, radius + e.deltaY * 0.025));
    updateCamera();
  }, { passive: false });
}

// ─── Touch ───────────────────────────────────────────────────────────────────
export function attachTouchControls(canvas, onClickAt) {
  let wasMultiTouch = false;

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; dragDist = 0;
      wasMultiTouch = false;
    } else {
      // Second (or more) finger added — this is never a tap
      wasMultiTouch = true;
      dragDist = Infinity;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (!dragging || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - lastX, dy = e.touches[0].clientY - lastY;
    dragDist += Math.sqrt(dx*dx + dy*dy);
    theta -= dx * 0.007;
    phi = Math.max(0.12, Math.min(Math.PI - 0.12, phi - dy * 0.007));
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    updateCamera();
  }, { passive: true });

  canvas.addEventListener('touchend', e => {
    // Tap = single finger lifted, ALL fingers now off screen, no multi-touch occurred
    if (!wasMultiTouch && e.touches.length === 0 && dragDist < 14 && e.changedTouches.length === 1)
      onClickAt(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    if (e.touches.length === 0) {
      dragging = false;
      wasMultiTouch = false;
    }
  });
}

// ─── Raycasting ──────────────────────────────────────────────────────────────
const raycaster  = new THREE.Raycaster();
const _closest   = new THREE.Vector3();

export function pickIntersection(cx, cy, canvas) {
  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((cx - rect.left) / rect.width) * 2 - 1,
    -((cy - rect.top)  / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(mouse, camera);

  let best = null, bestScore = Infinity;
  const threshold = C.stoneR * 1.3; // slightly generous for touch

  for (const { x, y, z, pos } of intersectionPoints) {
    if (!layerVisible[y]) continue;

    const perpDist = raycaster.ray.distanceToPoint(pos);
    if (perpDist >= threshold) continue;

    // Among equally-close intersections prefer the one nearer to the camera
    // so tapping picks the front-facing stone, not one hidden behind it.
    raycaster.ray.closestPointToPoint(pos, _closest);
    const depth = raycaster.ray.origin.distanceTo(_closest);

    // Score: perpendicular distance matters most, depth breaks ties
    const score = perpDist + depth * 0.01;
    if (score < bestScore) { bestScore = score; best = { x, y, z }; }
  }

  return best;
}
