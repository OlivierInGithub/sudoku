// Écran de scan : choix de la photo, ajustement des 4 coins, puis lecture.

import { UNIT_SQUARE, detectGrid, homography, prepareImage, project, readGrid } from './scan.js';

const HANDLE_HIT = 40; // rayon de prise d'un coin, en pixels écran
const HANDLE_RADIUS = 12;
const LOUPE_RADIUS = 56;
const LOUPE_ZOOM = 3;

const $ = (sel) => document.querySelector(sel);
const overlay = $('#scanner');
const pickStep = $('#scan-pick');
const adjustStep = $('#scan-adjust');
const canvas = $('#scan-canvas');
const statusEl = $('#scan-status');
const readButton = $('#scan-read');
const fileInputs = [$('#scan-camera'), $('#scan-file')];
const ctx = canvas.getContext('2d');

let image = null;
let corners = null;
let view = null;
let drag = null;
let onResult = null;

export function openScanner(callback) {
  onResult = callback;
  showStep('pick');
  overlay.hidden = false;
  document.body.classList.add('scanning');
}

export const isScannerOpen = () => !overlay.hidden;

function closeScanner() {
  overlay.hidden = true;
  document.body.classList.remove('scanning');
  image = null;
  corners = null;
  drag = null;
  for (const input of fileInputs) input.value = '';
}

function showStep(step) {
  pickStep.hidden = step !== 'pick';
  adjustStep.hidden = step !== 'adjust';
  statusEl.textContent = '';
}

async function loadFile(file) {
  if (!file) return;
  statusEl.textContent = 'Chargement de la photo…';
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    image = prepareImage(img);
  } catch {
    statusEl.textContent = 'Impossible de lire cette image.';
    return;
  } finally {
    URL.revokeObjectURL(url);
  }

  corners = detectGrid(image) ?? defaultCorners();
  showStep('adjust');
  layout();
  draw();
}

function defaultCorners() {
  const { width: w, height: h } = image;
  const s = Math.min(w, h) * 0.8;
  const x = (w - s) / 2;
  const y = (h - s) / 2;
  return [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
}

// ---------- Dessin ----------

function layout() {
  if (!image) return;
  const maxW = Math.max(200, Math.min(adjustStep.clientWidth || window.innerWidth - 32, 560));
  const maxH = Math.max(200, window.innerHeight * 0.62);
  const k = Math.min(maxW / image.width, maxH / image.height);
  const w = Math.round(image.width * k);
  const h = Math.round(image.height * k);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  view = { k, w, h, dpr };
}

function tracePolygon(points) {
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}

/** Quadrillage 9×9 vu en perspective, `px` = taille d'un pixel écran dans le repère courant. */
function drawGuides(px) {
  const H = homography(UNIT_SQUARE, corners);
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    ctx.beginPath();
    for (const [a, b] of [[project(H, t, 0), project(H, t, 1)], [project(H, 0, t), project(H, 1, t)]]) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.lineWidth = px * (i % 3 === 0 ? 2.5 : 1);
    ctx.strokeStyle = 'rgba(76, 141, 255, 0.9)';
    ctx.stroke();
  }
}

function draw() {
  const { k, w, h, dpr } = view;
  ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  ctx.drawImage(image.canvas, 0, 0);

  // Assombrit tout ce qui est hors de la grille.
  ctx.beginPath();
  ctx.rect(0, 0, image.width, image.height);
  tracePolygon(corners);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fill('evenodd');
  drawGuides(1 / k);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  corners.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x * k, p.y * k, HANDLE_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = drag?.index === i ? 'rgba(76, 141, 255, 0.55)' : 'rgba(76, 141, 255, 0.25)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });

  if (drag) drawLoupe(corners[drag.index], w, h);
}

/** Loupe sur le coin déplacé, pour viser précisément sous le doigt. */
function drawLoupe(p, w) {
  const { k, dpr } = view;
  const R = LOUPE_RADIUS;
  const cx = p.x * k < w / 2 ? w - R - 8 : R + 8;
  const cy = R + 8;
  const z = k * LOUPE_ZOOM;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.fillStyle = '#222';
  ctx.fill();
  ctx.clip();
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (cx - p.x * z), dpr * (cy - p.y * z));
  ctx.drawImage(image.canvas, 0, 0);
  drawGuides(1 / z);
  ctx.restore();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx, cy + 10);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ff3b30';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

// ---------- Déplacement des coins ----------

function toImage(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / view.k, y: (e.clientY - rect.top) / view.k };
}

canvas.addEventListener('pointerdown', (e) => {
  const p = toImage(e);
  let index = -1;
  let bestDistance = HANDLE_HIT / view.k;
  corners.forEach((c, i) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestDistance) {
      index = i;
      bestDistance = d;
    }
  });
  if (index < 0) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  // On garde l'écart doigt/coin pour que le coin ne saute pas sous le doigt.
  drag = { index, dx: corners[index].x - p.x, dy: corners[index].y - p.y };
  draw();
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toImage(e);
  corners[drag.index] = {
    x: Math.min(image.width - 1, Math.max(0, p.x + drag.dx)),
    y: Math.min(image.height - 1, Math.max(0, p.y + drag.dy)),
  };
  draw();
});

for (const type of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(type, () => {
    if (!drag) return;
    drag = null;
    draw();
  });
}

// ---------- Boutons ----------

for (const input of fileInputs) {
  input.addEventListener('change', () => loadFile(input.files[0]));
}

$('#scan-cancel').addEventListener('click', closeScanner);

$('#scan-retake').addEventListener('click', () => {
  for (const input of fileInputs) input.value = '';
  showStep('pick');
});

readButton.addEventListener('click', async () => {
  readButton.disabled = true;
  statusEl.textContent = 'Lecture de la grille…';
  // Laisse le navigateur afficher le message avant le calcul.
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  try {
    const result = readGrid(image, corners);
    const callback = onResult;
    closeScanner();
    callback(result);
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'La lecture a échoué. Ajustez les coins et réessayez.';
  } finally {
    readButton.disabled = false;
  }
});

window.addEventListener('resize', () => {
  if (image && !adjustStep.hidden) {
    layout();
    draw();
  }
});
