import { detectGrid, homography, prepareImage, project, readGrid } from '../scan.js';
import { parseGrid } from '../sudoku.js';

const PUZZLES = [
  '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
  '003020600900305001001806400008102900700000008006708200002609500800203009005010300',
  '200080300060070084030500209000105408000000000402706000301007040720040060004010003',
  '800000000003600000070090200050007000000045700000100030001000068008500010090000400',
].map(parseGrid);

const FONTS = [
  ['Arial', 'normal'], ['Arial', 'bold'], ['Georgia', 'normal'], ['Times New Roman', 'normal'],
  ['Verdana', 'normal'], ['Courier New', 'bold'], ['Trebuchet MS', 'normal'], ['Tahoma', 'bold'],
];

let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

const PAPER = 600;
const GRID = 504;
const OFFSET = (PAPER - GRID) / 2;

/** Une feuille blanche avec la grille imprimée. */
function renderPaper(grid, [family, weight]) {
  const canvas = Object.assign(document.createElement('canvas'), { width: PAPER, height: PAPER });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, PAPER, PAPER);
  const cell = GRID / 9;
  ctx.fillStyle = '#1a1a1a';
  ctx.font = `${weight} ${Math.round(cell * 0.62)}px "${family}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  grid.forEach((d, i) => {
    if (d) ctx.fillText(String(d), OFFSET + (i % 9 + 0.5) * cell, OFFSET + (Math.floor(i / 9) + 0.55) * cell);
  });
  for (let k = 0; k <= 9; k++) {
    ctx.lineWidth = k % 3 === 0 ? 3.5 : 1.2;
    ctx.strokeStyle = k % 3 === 0 ? '#111' : '#555';
    ctx.beginPath();
    ctx.moveTo(OFFSET + k * cell, OFFSET);
    ctx.lineTo(OFFSET + k * cell, OFFSET + GRID);
    ctx.moveTo(OFFSET, OFFSET + k * cell);
    ctx.lineTo(OFFSET + GRID, OFFSET + k * cell);
    ctx.stroke();
  }
  // Un peu de texte autour, comme dans un magazine.
  ctx.font = '16px Georgia';
  ctx.textAlign = 'left';
  ctx.fillText('SUDOKU n° 42 — niveau moyen', OFFSET, OFFSET / 2);
  return canvas;
}

/** « Photographie » la feuille : perspective, fond, ombre, bruit, flou, JPEG. */
async function photograph(paper, strength, zoom) {
  const S = 1.6; // photo plus grande que l'image de détection, comme sur un téléphone
  const W = 1000 * S;
  const H = 780 * S;
  const bg = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const bctx = bg.getContext('2d');
  bctx.fillStyle = '#7d6247';
  bctx.fillRect(0, 0, W, H);
  bctx.strokeStyle = '#4e3b29';
  for (let k = 0; k < 25; k++) {
    bctx.lineWidth = 1 + rand() * 3;
    bctx.beginPath();
    bctx.moveTo(0, rand() * H);
    bctx.lineTo(W, rand() * H);
    bctx.stroke();
  }

  const j = () => (rand() - 0.5) * 120 * strength;
  const quad = [
    { x: 200 + j(), y: 40 + j() / 2 }, { x: 830 + j(), y: 60 + j() / 2 },
    { x: 860 + j(), y: 740 + j() / 2 }, { x: 160 + j(), y: 720 + j() / 2 },
  ].map(({ x, y }) => ({ x: W / 2 + (x * S - W / 2) * zoom, y: H / 2 + (y * S - H / 2) * zoom }));
  const paperSquare = [{ x: 0, y: 0 }, { x: PAPER, y: 0 }, { x: PAPER, y: PAPER }, { x: 0, y: PAPER }];
  const toPaper = homography(quad, paperSquare);
  const toPhoto = homography(paperSquare, quad);
  const gridCorners = [[OFFSET, OFFSET], [OFFSET + GRID, OFFSET], [OFFSET + GRID, OFFSET + GRID], [OFFSET, OFFSET + GRID]]
    .map(([x, y]) => project(toPhoto, x, y));

  const paperData = paper.getContext('2d').getImageData(0, 0, PAPER, PAPER).data;
  const out = bctx.getImageData(0, 0, W, H);
  const shadow = 0.45 * strength;
  // Chaque pixel moyenne 2×2 points, comme un capteur qui intègre la lumière.
  const SUB = 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const light = 1 - shadow * (x / W) * (y / H);
      const noise = (rand() - 0.5) * 30 * strength;
      const rgb = [0, 0, 0];
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const p = project(toPaper, x + (sx + 0.5) / SUB, y + (sy + 0.5) / SUB);
          const inside = p.x >= 0 && p.y >= 0 && p.x < PAPER && p.y < PAPER;
          const s = (Math.floor(p.y) * PAPER + Math.floor(p.x)) * 4;
          for (let c = 0; c < 3; c++) rgb[c] += inside ? paperData[s + c] : out.data[o + c];
        }
      }
      for (let c = 0; c < 3; c++) out.data[o + c] = (rgb[c] / (SUB * SUB)) * light + noise;
    }
  }
  bctx.putImageData(out, 0, 0);

  const blurred = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = blurred.getContext('2d');
  ctx.filter = `blur(${(0.6 + strength) * S}px)`;
  ctx.drawImage(bg, 0, 0);

  // Compression JPEG si le navigateur décode l'image ; sinon on garde le canvas.
  const img = new Image();
  img.src = blurred.toDataURL('image/jpeg', 0.7);
  const decoded = await Promise.race([
    new Promise((resolve) => { img.onload = () => resolve(true); img.onerror = () => resolve(false); }),
    new Promise((resolve) => { setTimeout(() => resolve(false), 1000); }),
  ]);
  // Coins exprimés dans l'image de détection (1000 px de large).
  return { img: decoded ? img : blurred, gridCorners: gridCorners.map(({ x, y }) => ({ x: x / S, y: y / S })) };
}

function score(truth, result) {
  let wrong = 0;
  let missed = 0;
  let extra = 0;
  let unflagged = 0;
  const flagged = new Set(result.uncertain);
  const confusions = [];
  truth.forEach((t, i) => {
    const r = result.grid[i];
    if (t !== r) confusions.push(`${t || '·'}→${r || '·'}`);
    if (t && r && t !== r) wrong++;
    if (t && !r) missed++;
    if (!t && r) extra++;
    if (t !== r && !flagged.has(i)) unflagged++;
  });
  return { wrong, missed, extra, flagged: flagged.size, unflagged, exact: wrong + missed + extra === 0, confusions: confusions.join(' ') };
}

const rows = [];
const table = document.querySelector('#results');
table.innerHTML = '<tr><th>Cas</th><th>Cadre trouvé</th><th>Écart coins (px)</th><th>Faux</th><th>Manqués</th><th>En trop</th><th>Douteux</th><th>Erreurs non signalées</th><th>Exact</th><th>ms</th><th>Confusions</th></tr>';

let n = 0;
for (const [p, puzzle] of PUZZLES.entries()) {
  for (const [f, font] of FONTS.entries()) {
    const strength = 0.3 + 0.9 * ((n % 4) / 3); // au-delà de 1.2, même un humain ne lit plus les chiffres
    const zoom = [1, 0.75, 0.55][n++ % 3]; // part de la photo occupée par la feuille
    const { img, gridCorners } = await photograph(renderPaper(puzzle, font), strength, zoom);
    const image = prepareImage(img);
    const t0 = performance.now();
    const detected = detectGrid(image);
    const cornerError = detected
      ? Math.max(...detected.map((c, k) => Math.hypot(c.x - gridCorners[k].x, c.y - gridCorners[k].y)))
      : Infinity;
    const result = readGrid(image, detected ?? gridCorners);
    const ms = Math.round(performance.now() - t0);
    const s = score(puzzle, result);
    if (!s.exact) (window.failures ??= []).push({ image, corners: detected ?? gridCorners, puzzle, result });
    // Même lecture avec les vrais coins, pour séparer détection et reconnaissance.
    const ideal = score(puzzle, readGrid(image, gridCorners));
    const row = {
      name: `grille ${p + 1}, ${font.join(' ')}, force ${strength.toFixed(2)}, zoom ${zoom}`,
      detected: !!detected, cornerError: Math.round(cornerError), ...s, ms,
      ideal: `${ideal.wrong}/${ideal.missed}/${ideal.extra}/${ideal.unflagged}`,
    };
    rows.push(row);
    const tr = document.createElement('tr');
    tr.className = s.exact && row.cornerError < 15 ? '' : 'bad';
    tr.innerHTML = [row.name, row.detected ? 'oui' : 'non', row.cornerError, s.wrong, s.missed, s.extra, s.flagged, s.unflagged, s.exact ? 'oui' : 'non', ms, s.confusions]
      .map((v) => `<td>${v}</td>`).join('');
    table.append(tr);
    if (rows.length <= 4) document.querySelector('#images').append(img);
  }
}

const exact = rows.filter((r) => r.exact).length;
document.querySelector('#summary').textContent = `${exact} / ${rows.length} grilles lues sans erreur ; `
  + `${rows.filter((r) => r.unflagged).length} grille(s) avec une erreur non signalée en orange.`;
window.scanResults = rows;
