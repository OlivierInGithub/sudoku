// Logique de Sudoku : grille = tableau de 81 entiers (0 = case vide), index = ligne * 9 + colonne.

export const ROW = Array.from({ length: 81 }, (_, i) => Math.floor(i / 9));
export const COL = Array.from({ length: 81 }, (_, i) => i % 9);
export const BOX = Array.from({ length: 81 }, (_, i) => Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3));

const range9 = Array.from({ length: 9 }, (_, k) => k);
const cellsWhere = (pred) => range9.flatMap((r) => range9.map((c) => r * 9 + c)).filter(pred);

export const ROW_UNITS = range9.map((k) => ({ name: `la ligne ${k + 1}`, cells: cellsWhere((i) => ROW[i] === k) }));
export const COL_UNITS = range9.map((k) => ({ name: `la colonne ${k + 1}`, cells: cellsWhere((i) => COL[i] === k) }));
export const BOX_UNITS = range9.map((k) => ({ name: 'le carré en surbrillance', cells: cellsWhere((i) => BOX[i] === k) }));

export const PEERS = Array.from({ length: 81 }, (_, i) =>
  cellsWhere((j) => j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])),
);

const ALL_DIGITS = 0b1111111110; // bits 1 à 9

export const bit = (d) => 1 << d;

export function popcount(mask) {
  let n = 0;
  for (; mask; mask &= mask - 1) n++;
  return n;
}

export function digitsOf(mask) {
  return range9.map((k) => k + 1).filter((d) => mask & bit(d));
}

/** Masque des chiffres encore possibles dans la case i (0 si la case est remplie). */
export function candidatesMask(grid, i) {
  if (grid[i]) return 0;
  let used = 0;
  for (const p of PEERS[i]) used |= bit(grid[p]);
  return ALL_DIGITS & ~used;
}

/** Index des cases qui ont le même chiffre qu'une case voisine. */
export function conflicts(grid) {
  const bad = new Set();
  for (let i = 0; i < 81; i++) {
    if (!grid[i]) continue;
    for (const p of PEERS[i]) if (grid[p] === grid[i]) bad.add(i);
  }
  return bad;
}

/** Résout par backtracking ; s'arrête dès `limit` solutions trouvées. */
export function solve(grid, limit = 2) {
  if (conflicts(grid).size) return { count: 0, solution: null };

  const g = grid.slice();
  const rows = new Array(9).fill(0);
  const cols = new Array(9).fill(0);
  const boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!g[i]) continue;
    rows[ROW[i]] |= bit(g[i]);
    cols[COL[i]] |= bit(g[i]);
    boxes[BOX[i]] |= bit(g[i]);
  }

  let count = 0;
  let solution = null;

  const search = () => {
    // On choisit la case vide qui a le moins de candidats.
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const mask = ALL_DIGITS & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
      const n = popcount(mask);
      if (n === 0) return false;
      if (n < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = n;
      }
    }
    if (best === -1) {
      count++;
      solution ??= g.slice();
      return count >= limit;
    }
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & bit(d))) continue;
      g[best] = d;
      rows[ROW[best]] |= bit(d);
      cols[COL[best]] |= bit(d);
      boxes[BOX[best]] |= bit(d);
      const done = search();
      rows[ROW[best]] &= ~bit(d);
      cols[COL[best]] &= ~bit(d);
      boxes[BOX[best]] &= ~bit(d);
      g[best] = 0;
      if (done) return true;
    }
    return false;
  };

  search();
  return { count, solution };
}

/**
 * Cherche une case déductible par une technique simple.
 * Renvoie { cell, digit, unit, text } ou null.
 */
export function findHint(grid) {
  const cand = grid.map((_, i) => candidatesMask(grid, i));

  const hiddenSingle = (units) => {
    for (const unit of units) {
      for (let d = 1; d <= 9; d++) {
        if (unit.cells.some((i) => grid[i] === d)) continue;
        const spots = unit.cells.filter((i) => cand[i] & bit(d));
        if (spots.length === 1) {
          return {
            cell: spots[0],
            digit: d,
            unit: unit.cells,
            text: `Dans ${unit.name}, le ${d} ne peut aller que dans une seule case.`,
          };
        }
      }
    }
    return null;
  };

  const nakedSingle = () => {
    for (let i = 0; i < 81; i++) {
      if (grid[i] || popcount(cand[i]) !== 1) continue;
      const [d] = digitsOf(cand[i]);
      return {
        cell: i,
        digit: d,
        unit: PEERS[i],
        text: `Ligne ${ROW[i] + 1}, colonne ${COL[i] + 1} : sa ligne, sa colonne et son carré contiennent déjà tous les chiffres sauf le ${d}.`,
      };
    }
    return null;
  };

  return hiddenSingle(BOX_UNITS) ?? nakedSingle() ?? hiddenSingle([...ROW_UNITS, ...COL_UNITS]);
}

/** "53..7...." (81 caractères, . ou 0 pour vide) -> tableau de 81 entiers. */
export function parseGrid(text) {
  const digits = text.replace(/[^0-9.]/g, '');
  if (digits.length !== 81) throw new Error('Une grille doit contenir 81 cases.');
  return [...digits].map((ch) => (ch === '.' ? 0 : Number(ch)));
}
