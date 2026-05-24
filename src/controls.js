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
    if (dragging && dragDist < 5) onClickAt(e.clientX, e.clientY);
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
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; dragDist = 0;
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
    if (dragDist < 5 && e.changedTouches.length === 1)
      onClickAt(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    dragging = false;
  });
}

// ─── Raycasting ──────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();

export function pickIntersection(cx, cy, canvas) {
  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((cx - rect.left) / rect.width) * 2 - 1,
    -((cy - rect.top)  / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(mouse, camera);
  let best = null, bestDist = Infinity;
  const threshold = C.stoneR * 1.15;
  for (const { x, y, z, pos } of intersectionPoints) {
    if (!layerVisible[y]) continue;
    const d = raycaster.ray.distanceToPoint(pos);
    if (d < threshold && d < bestDist) { bestDist = d; best = { x, y, z }; }
  }
  return best;
}
