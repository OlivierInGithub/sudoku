// Lecture d'une grille de Sudoku sur une photo : détection du cadre, redressement,
// puis reconnaissance des chiffres par comparaison avec des modèles. Tout tourne dans le navigateur.

import { conflicts, solve } from './sudoku.js';

const WORK_SIZE = 1000; // plus grand côté de l'image où l'on cherche la grille, en pixels
const DETAIL_SIZE = 2400; // plus grand côté de l'image où l'on lit les chiffres
const CELL = 60; // taille d'une case une fois la grille redressée
const SIZE = CELL * 9;
const MARGIN = Math.round(CELL * 0.1); // bord de case ignoré (traits de la grille)
const INNER = CELL - 2 * MARGIN;
const FEAT = 32; // côté de l'image normalisée d'un chiffre
const MIN_CONTRAST = 40; // écart de gris minimal entre papier et encre pour qu'une case soit remplie
const INK_LEVEL = 0.4; // part du contraste à partir de laquelle un pixel compte comme de l'encre

// Une case est douteuse si son chiffre ressemble peu au modèle (score = corrélation entre -1 et 1),
// ou si le 2e chiffre le plus proche n'est pas beaucoup plus loin que le 1er (rapport des distances).
const UNCERTAIN_SCORE = 0.7;
const UNCERTAIN_RATIO = 0.6;
const REFINE_PASSES = 2;

const TEMPLATE_FONTS = [
  'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Georgia',
  'Courier New', 'sans-serif', 'serif', 'system-ui',
];

export const UNIT_SQUARE = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Image réduite à `maxSide` pixels au plus, en couleur (canvas) et en niveaux de gris. */
function grayImage(source, maxSide) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    gray[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return { canvas, gray, width, height };
}

/** Prépare une photo : version réduite pour l'affichage et la détection, et l'original pour la lecture. */
export function prepareImage(source) {
  return { ...grayImage(source, WORK_SIZE), source };
}

// ---------- Traitement d'image ----------

/** 1 = pixel nettement plus sombre que son voisinage. */
function adaptiveThreshold(gray, w, h, radius, offset) {
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      mask[y * w + x] = gray[y * w + x] < mean - offset ? 1 : 0;
    }
  }
  return mask;
}

function dilate(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

/** Composantes connexes (4-voisinage) avec boîte englobante et points extrêmes. */
function components(mask, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const comps = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    const comp = {
      id: comps.length + 1, count: 0, minX: w, minY: h, maxX: -1, maxY: -1,
      sumMin: Infinity, sumMax: -Infinity, diffMin: Infinity, diffMax: -Infinity,
      tl: null, tr: null, br: null, bl: null,
    };
    let sp = 0;
    stack[sp++] = start;
    labels[start] = comp.id;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      comp.count++;
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      const s = x + y;
      const d = x - y;
      if (s < comp.sumMin) { comp.sumMin = s; comp.tl = { x, y }; }
      if (s > comp.sumMax) { comp.sumMax = s; comp.br = { x, y }; }
      if (d > comp.diffMax) { comp.diffMax = d; comp.tr = { x, y }; }
      if (d < comp.diffMin) { comp.diffMin = d; comp.bl = { x, y }; }
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = comp.id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = comp.id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = comp.id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = comp.id; stack[sp++] = p + w; }
    }
    comps.push(comp);
  }
  return { labels, comps };
}

// ---------- Géométrie ----------

/** Homographie qui envoie les 4 points `from` sur les 4 points `to`. */
export function homography(from, to) {
  const A = [];
  for (let k = 0; k < 4; k++) {
    const { x, y } = from[k];
    const { x: X, y: Y } = to[k];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 9; k++) A[r][k] -= f * A[col][k];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}

export function project(h, x, y) {
  const d = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
}

/**
 * Échantillonne le quadrilatère `corners` dans un carré de `size` pixels,
 * en moyennant `sub`×`sub` points par pixel quand la source est plus fine que la sortie.
 */
export function warp(gray, w, h, corners, size, sub = 1) {
  const square = UNIT_SQUARE.map((p) => ({ x: p.x * size, y: p.y * size }));
  const H = homography(square, corners);
  const out = new Uint8ClampedArray(size * size);
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      let sum = 0;
      for (let sv = 0; sv < sub; sv++) {
        for (let su = 0; su < sub; su++) {
          const pu = u + (su + 0.5) / sub;
          const pv = v + (sv + 0.5) / sub;
          const d = H[6] * pu + H[7] * pv + 1;
          const x = (H[0] * pu + H[1] * pv + H[2]) / d - 0.5;
          const y = (H[3] * pu + H[4] * pv + H[5]) / d - 0.5;
          const x0 = Math.floor(x);
          const y0 = Math.floor(y);
          if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
            sum += 255;
            continue;
          }
          const fx = x - x0;
          const fy = y - y0;
          const i = y0 * w + x0;
          sum += gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy)
            + gray[i + w] * (1 - fx) * fy + gray[i + w + 1] * fx * fy;
        }
      }
      out[v * size + u] = sum / (sub * sub);
    }
  }
  return out;
}

/** Part des points du quadrillage 10×10 attendu qui tombent sur de l'encre. */
function gridScore(mask, w, h, corners) {
  const H = homography(UNIT_SQUARE, corners);
  const STEPS = 60;
  let hit = 0;
  let total = 0;
  for (let k = 0; k <= 9; k++) {
    for (let s = 0; s <= STEPS; s++) {
      for (const p of [project(H, k / 9, s / STEPS), project(H, s / STEPS, k / 9)]) {
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        total++;
        if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]) hit++;
      }
    }
  }
  return hit / total;
}

/** Cherche le cadre de la grille : le réseau de traits connectés qui ressemble le plus à un quadrillage. */
export function detectGrid({ gray, width: w, height: h }) {
  const radius = Math.max(7, Math.round(Math.min(w, h) / 50));
  const mask = dilate(adaptiveThreshold(gray, w, h, radius, 7), w, h);
  const candidates = components(mask, w, h).comps
    .filter((c) => {
      const bw = c.maxX - c.minX + 1;
      const bh = c.maxY - c.minY + 1;
      return bw * bh >= 0.05 * w * h && bw / bh >= 0.4 && bw / bh <= 2.5;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  let best = null;
  let bestScore = 0.35; // en dessous, ce n'est probablement pas une grille
  for (const c of candidates) {
    const corners = [c.tl, c.tr, c.br, c.bl];
    const score = gridScore(mask, w, h, corners);
    if (score > bestScore) {
      best = corners;
      bestScore = score;
    }
  }
  if (!best) return null;

  // Les points extrêmes sont au bord extérieur du gros trait (élargi par la dilatation) :
  // on les rentre d'environ un demi-trait vers le centre.
  const cx = best.reduce((s, p) => s + p.x, 0) / 4;
  const cy = best.reduce((s, p) => s + p.y, 0) / 4;
  const inset = Math.max(2, Math.min(w, h) / 300);
  return best.map((p) => {
    const d = Math.hypot(cx - p.x, cy - p.y) || 1;
    return { x: p.x + ((cx - p.x) / d) * inset * Math.SQRT2, y: p.y + ((cy - p.y) / d) * inset * Math.SQRT2 };
  });
}

// ---------- Chiffres ----------

function blur(f) {
  const out = new Float32Array(FEAT * FEAT);
  for (let y = 0; y < FEAT; y++) {
    for (let x = 0; x < FEAT; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= FEAT || yy >= FEAT) continue;
          sum += f[yy * FEAT + xx];
          n++;
        }
      }
      out[y * FEAT + x] = sum / n;
    }
  }
  return out;
}

/** Centre et normalise (moyenne 0, norme 1) pour comparer par simple produit scalaire. */
function standardize(f) {
  let mean = 0;
  for (const v of f) mean += v;
  mean /= f.length;
  let norm = 0;
  for (let i = 0; i < f.length; i++) {
    f[i] -= mean;
    norm += f[i] * f[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < f.length; i++) f[i] /= norm;
  return f;
}

/**
 * Remet la boîte englobante d'un chiffre à une taille fixe, proportions conservées.
 * `inkAt(x, y)` donne la quantité d'encre d'un pixel, entre 0 (papier) et 1 (encre).
 */
function normalize(inkAt, x0, y0, w, h) {
  const box = FEAT - 6;
  const scale = Math.min(box / h, box / w);
  const ox = (FEAT - w * scale) / 2;
  const oy = (FEAT - h * scale) / 2;
  const S = 3; // sur-échantillonnage
  const f = new Float32Array(FEAT * FEAT);
  for (let dy = 0; dy < FEAT; dy++) {
    for (let dx = 0; dx < FEAT; dx++) {
      let sum = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = (dx + (sx + 0.5) / S - ox) / scale;
          const py = (dy + (sy + 0.5) / S - oy) / scale;
          if (px >= 0 && py >= 0 && px < w && py < h) sum += inkAt(x0 + Math.floor(px), y0 + Math.floor(py));
        }
      }
      f[dy * FEAT + dx] = sum / (S * S);
    }
  }
  return standardize(blur(f));
}

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

let fontTemplates = null;

/** Modèles de chiffres dessinés avec les polices du système. */
function getFontTemplates() {
  if (fontTemplates) return fontTemplates;
  const N = 120;
  const canvas = makeCanvas(N, N);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  fontTemplates = [];
  for (const family of TEMPLATE_FONTS) {
    for (const weight of ['normal', 'bold']) {
      for (let d = 1; d <= 9; d++) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, N, N);
        ctx.fillStyle = '#000';
        ctx.font = `${weight} 90px "${family}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(d), N / 2, N / 2);
        const { data } = ctx.getImageData(0, 0, N, N);
        const inkAt = (x, y) => 1 - data[(y * N + x) * 4] / 255;
        let minX = N;
        let minY = N;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            if (inkAt(x, y) < 0.5) continue;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
        if (maxX < 0) continue;
        fontTemplates.push({ digit: d, feature: normalize(inkAt, minX, minY, maxX - minX + 1, maxY - minY + 1) });
      }
    }
  }
  return fontTemplates;
}

/** Niveau de gris au rang `p` (entre 0 et 1) d'un histogramme. */
function percentile(hist, total, p) {
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= p * total) return v;
  }
  return 255;
}

/**
 * Image normalisée du chiffre d'une case, ou null si la case est vide.
 * Tout est relatif au contraste de la case (papier contre encre la plus sombre),
 * ce qui tolère l'ombre, le flou et les traits fins ; la forme est lue en niveaux de gris.
 */
function readCell(warped, r, c) {
  const x0 = c * CELL + MARGIN;
  const y0 = r * CELL + MARGIN;
  const hist = new Uint32Array(256);
  for (let y = 0; y < INNER; y++) {
    for (let x = 0; x < INNER; x++) hist[warped[(y0 + y) * SIZE + x0 + x]]++;
  }
  const paper = percentile(hist, INNER * INNER, 0.85);
  const darkest = percentile(hist, INNER * INNER, 0.02);
  if (paper - darkest < MIN_CONTRAST) return null; // rien de sombre dans la case
  const level = (x, y) => (paper - warped[(y0 + y) * SIZE + x0 + x]) / (paper - darkest);

  const mask = new Uint8Array(INNER * INNER);
  for (let y = 0; y < INNER; y++) {
    for (let x = 0; x < INNER; x++) mask[y * INNER + x] = level(x, y) >= INK_LEVEL ? 1 : 0;
  }

  const last = INNER - 1;
  const lo = INNER * 0.2;
  const hi = INNER * 0.8;
  const parts = components(mask, INNER, INNER).comps.filter((k) => {
    if (k.count < 12) return false; // bruit
    if ((k.minX === 0 && k.maxX === last) || (k.minY === 0 && k.maxY === last)) return false; // trait de grille
    const cx = (k.minX + k.maxX) / 2;
    const cy = (k.minY + k.maxY) / 2;
    return cx >= lo && cx <= hi && cy >= lo && cy <= hi;
  });
  if (!parts.length) return null;

  // Le chiffre = la plus grosse tache vers le centre de la case,
  // plus les morceaux proches (un trait fin ou flou se casse).
  const main = parts.reduce((a, b) => (b.count > a.count ? b : a));
  const reach = Math.round(INNER * 0.12);
  const near = parts.filter((k) => k.minX <= main.maxX + reach && k.maxX >= main.minX - reach
    && k.minY <= main.maxY + reach && k.maxY >= main.minY - reach);
  const minX = Math.min(...near.map((k) => k.minX));
  const minY = Math.min(...near.map((k) => k.minY));
  const maxX = Math.max(...near.map((k) => k.maxX));
  const maxY = Math.max(...near.map((k) => k.maxY));
  const inkCount = near.reduce((s, k) => s + k.count, 0);
  if (maxY - minY + 1 < INNER * 0.35 || inkCount < INNER * INNER * 0.02) return null;

  const inkAt = (x, y) => Math.min(1, Math.max(0, level(x, y)));
  return normalize(inkAt, minX, minY, maxX - minX + 1, maxY - minY + 1);
}

/** Chiffres classés du plus au moins ressemblant. */
function rank(feature, templates) {
  const best = new Array(10).fill(-1);
  for (const t of templates) {
    const s = dot(feature, t.feature);
    if (s > best[t.digit]) best[t.digit] = s;
  }
  return best.slice(1).map((score, k) => ({ digit: k + 1, score })).sort((a, b) => b.score - a.score);
}

/**
 * Reclasse chaque case avec des modèles appris sur la grille elle-même (même police) :
 * la moyenne des autres cases lues comme le même chiffre. La case est exclue de son propre
 * modèle, sinon un chiffre présent une seule fois se reconnaîtrait toujours parfaitement.
 * Les chiffres absents de la grille gardent les modèles des polices.
 */
function refine(features, ranked, fonts) {
  const labels = ranked.map((r) => r && r[0].digit);
  const sums = new Map();
  const counts = new Map();
  features.forEach((f, i) => {
    if (!f) return;
    const acc = sums.get(labels[i]) ?? new Float32Array(FEAT * FEAT);
    for (let k = 0; k < acc.length; k++) acc[k] += f[k];
    sums.set(labels[i], acc);
    counts.set(labels[i], (counts.get(labels[i]) ?? 0) + 1);
  });

  return features.map((f, i) => {
    if (!f) return null;
    const own = [];
    for (const [digit, sum] of sums) {
      const self = digit === labels[i];
      if (counts.get(digit) - (self ? 1 : 0) === 0) continue;
      const t = sum.slice();
      if (self) for (let k = 0; k < t.length; k++) t[k] -= f[k];
      own.push({ digit, feature: standardize(t) });
    }
    const learnt = new Set(own.map((t) => t.digit));
    return rank(f, [...own, ...fonts.filter((t) => !learnt.has(t.digit))]);
  });
}

const isUncertain = (r) => r[0].score < UNCERTAIN_SCORE || (1 - r[0].score) / (1 - r[1].score) > UNCERTAIN_RATIO;

/** Si la grille lue est incohérente, essaie de corriger une case douteuse. */
function repair(grid, ranked) {
  const valid = (g) => conflicts(g).size === 0 && solve(g, 1).count === 1;
  if (valid(grid)) return { grid, changed: null };
  const suspects = grid
    .map((d, i) => ({ i, margin: d ? ranked[i][0].score - ranked[i][1].score : Infinity }))
    .filter((s) => s.margin < Infinity)
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 12);
  for (const { i } of suspects) {
    for (const alt of [ranked[i][1].digit, ranked[i][2].digit, 0]) {
      const g = grid.slice();
      g[i] = alt;
      if (valid(g)) return { grid: g, changed: i };
    }
  }
  return { grid, changed: null };
}

/** Redresse la grille et extrait l'image normalisée de chaque case (null = vide). */
export function extractCells(image, corners) {
  // On relit la photo en meilleure résolution que l'image de détection.
  const detail = image.source ? grayImage(image.source, DETAIL_SIZE) : image;
  const ratio = detail.width / image.width;
  const quad = corners.map((p) => ({ x: p.x * ratio, y: p.y * ratio }));
  const side = Math.max(...quad.map((p, k) => Math.hypot(p.x - quad[(k + 1) % 4].x, p.y - quad[(k + 1) % 4].y)));
  const sub = Math.min(4, Math.max(1, Math.round(side / SIZE)));

  const warped = warp(detail.gray, detail.width, detail.height, quad, SIZE, sub);
  const features = Array.from({ length: 81 }, (_, i) => readCell(warped, Math.floor(i / 9), i % 9));
  return { warped, features };
}

/**
 * Lit la grille délimitée par `corners` (haut-gauche, haut-droite, bas-droite, bas-gauche).
 * Renvoie { grid, uncertain } : 81 chiffres (0 = vide) et les index des cases douteuses.
 */
export function readGrid(image, corners) {
  const { features } = extractCells(image, corners);

  const fonts = getFontTemplates();
  let ranked = features.map((f) => f && rank(f, fonts));
  for (let pass = 0; pass < REFINE_PASSES; pass++) ranked = refine(features, ranked, fonts);

  const read = ranked.map((r) => (r ? r[0].digit : 0));
  const uncertain = new Set(ranked.flatMap((r, i) => (r && isUncertain(r) ? [i] : [])));
  for (const i of conflicts(read)) uncertain.add(i);

  const { grid, changed } = repair(read, ranked);
  if (changed !== null) uncertain.add(changed);
  return { grid, uncertain: [...uncertain] };
}
