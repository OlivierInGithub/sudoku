import {
  ROW, COL, PEERS, bit, candidatesMask, conflicts, digitsOf, findHint, parseGrid, popcount, solve,
} from './sudoku.js';
import { isScannerOpen, openScanner } from './scan-ui.js';

const STORAGE_KEY = 'sudoku-state-v1';
const HISTORY_LIMIT = 200;

const EXAMPLES = [
  '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
  '003020600900305001001806400008102900700000008006708200002609500800203009005010300',
  '200080300060070084030500209000105408000000000402706000301007040720040060004010003',
];

const $ = (sel) => document.querySelector(sel);
const gridEl = $('#grid');
const digitsEl = $('#digits');
const messageText = $('#message-text');
const messageAction = $('#message-action');

const emptyGrid = () => new Array(81).fill(0);
const freshState = () => ({
  mode: 'edit', // 'edit' : saisie de l'énoncé ; 'play' : résolution
  givens: emptyGrid(),
  values: emptyGrid(),
  notes: emptyGrid(), // masque de bits par case
  solution: null,
  notesMode: false,
  autoCandidates: false,
});

let state = load() ?? freshState();
let selected = null;
let hint = null;
let wrong = new Set();
let uncertain = new Set(); // cases mal reconnues au scan
let history = [];
let messageCallback = null;

// ---------- Persistance ----------

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.values?.length === 81) return { ...freshState(), ...saved };
  } catch {
    // stockage indisponible ou corrompu : on repart de zéro
  }
  return null;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // navigation privée : pas de sauvegarde
  }
}

function pushHistory() {
  history.push(JSON.stringify({ values: state.values, notes: state.notes, givens: state.givens }));
  if (history.length > HISTORY_LIMIT) history.shift();
}

function commit() {
  save();
  render();
}

// ---------- Construction de la grille ----------

const cells = [];
for (let i = 0; i < 81; i++) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'cell';
  el.classList.toggle('br', COL[i] % 3 === 2 && COL[i] < 8);
  el.classList.toggle('bb', ROW[i] % 3 === 2 && ROW[i] < 8);
  el.dataset.i = i;
  gridEl.append(el);
  cells.push(el);
}

const digitButtons = [];
for (let d = 1; d <= 9; d++) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'digit';
  btn.innerHTML = `<span class="digit-value">${d}</span><span class="digit-left"></span>`;
  btn.addEventListener('click', () => input(d));
  digitsEl.append(btn);
  digitButtons.push(btn);
}

// ---------- Rendu ----------

function render() {
  const play = state.mode === 'play';
  const conf = conflicts(state.values);
  const selValue = selected === null ? 0 : state.values[selected];
  const peers = selected === null ? new Set() : new Set(PEERS[selected]);
  const hintUnit = new Set(hint?.unit ?? []);

  cells.forEach((el, i) => {
    const v = state.values[i];
    el.classList.toggle('given', !play || state.givens[i] !== 0);
    el.classList.toggle('selected', i === selected);
    el.classList.toggle('peer', peers.has(i));
    el.classList.toggle('same', v !== 0 && v === selValue);
    el.classList.toggle('conflict', conf.has(i));
    el.classList.toggle('wrong', wrong.has(i));
    el.classList.toggle('uncertain', !play && uncertain.has(i));
    el.classList.toggle('hint', hint?.cell === i);
    el.classList.toggle('hint-unit', hintUnit.has(i));

    let label = `Ligne ${ROW[i] + 1}, colonne ${COL[i] + 1}`;
    if (v) {
      el.textContent = v;
      label += `, ${v}`;
    } else {
      const mask = play && state.autoCandidates ? candidatesMask(state.values, i) : state.notes[i];
      el.innerHTML = mask ? renderNotes(mask, selValue) : '';
      label += ', vide';
    }
    el.setAttribute('aria-label', label);
  });

  digitButtons.forEach((btn, k) => {
    const d = k + 1;
    const left = 9 - state.values.filter((v) => v === d).length;
    btn.querySelector('.digit-left').textContent = left > 0 ? left : '';
    btn.classList.toggle('done', left <= 0);
    btn.classList.toggle('active', d === selValue);
  });

  document.body.dataset.mode = state.mode;
  $('#mode-label').textContent = play ? 'Résolution' : 'Saisie de la grille';
  $('#btn-notes').setAttribute('aria-pressed', state.notesMode);
  $('#btn-candidates').setAttribute('aria-pressed', state.autoCandidates);
  $('#btn-undo').disabled = history.length === 0;
}

function renderNotes(mask, highlight) {
  let html = '<span class="notes">';
  for (let d = 1; d <= 9; d++) {
    const cls = d === highlight ? ' class="hl"' : '';
    html += `<span${cls}>${mask & bit(d) ? d : ''}</span>`;
  }
  return `${html}</span>`;
}

function showMessage(text, action = null) {
  messageText.textContent = text;
  messageCallback = action?.run ?? null;
  messageAction.hidden = !action;
  if (action) messageAction.textContent = action.label;
}

// ---------- Actions ----------

function select(i) {
  selected = i;
  render();
}

function input(d) {
  if (selected === null) {
    showMessage('Touchez d’abord une case.');
    return;
  }
  const i = selected;
  const play = state.mode === 'play';
  if (play && state.givens[i]) return;

  if (play && state.notesMode && d !== 0) {
    if (state.values[i]) return;
    pushHistory();
    state.notes[i] ^= bit(d);
  } else {
    if (state.values[i] === d && (d !== 0 || state.notes[i] === 0)) return;
    pushHistory();
    state.values[i] = d;
    state.notes[i] = 0;
    if (!play) state.givens[i] = d;
    // Un chiffre posé disparaît des notes de ses voisines.
    if (d) for (const p of PEERS[i]) state.notes[p] &= ~bit(d);
  }

  wrong.delete(i);
  uncertain.delete(i);
  hint = null;
  commit();
  if (play) checkComplete();
}

function undo() {
  const previous = history.pop();
  if (!previous) return;
  Object.assign(state, JSON.parse(previous));
  hint = null;
  wrong.clear();
  commit();
}

function moveSelection(dr, dc) {
  if (selected === null) {
    select(0);
    return;
  }
  const r = (ROW[selected] + dr + 9) % 9;
  const c = (COL[selected] + dc + 9) % 9;
  select(r * 9 + c);
}

function loadExample() {
  if (state.givens.some(Boolean) && !confirm('Remplacer la grille saisie par un exemple ?')) return;
  const others = EXAMPLES.filter((e) => parseGrid(e).join('') !== state.givens.join(''));
  const grid = parseGrid(others[Math.floor(Math.random() * others.length)]);
  pushHistory();
  state.givens = grid.slice();
  state.values = grid.slice();
  state.notes = emptyGrid();
  uncertain.clear();
  showMessage('Exemple chargé. Appuyez sur « Commencer » pour le résoudre.');
  commit();
}

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function applyScan(result) {
  pushHistory();
  state.givens = result.grid.slice();
  state.values = result.grid.slice();
  state.notes = emptyGrid();
  uncertain = new Set(result.uncertain);
  wrong.clear();
  hint = null;
  selected = null;
  const count = result.grid.filter(Boolean).length;
  if (count < 17) {
    showMessage(`Seulement ${plural(count, 'chiffre')} reconnu${count > 1 ? 's' : ''} : reprenez la photo plus près et bien à plat, ou complétez à la main.`);
  } else if (uncertain.size) {
    showMessage(`${count} chiffres reconnus. Vérifiez surtout ${uncertain.size > 1 ? 'les' : 'la'} ${plural(uncertain.size, 'case')} en orange, puis appuyez sur « Commencer ».`);
  } else {
    showMessage(`${count} chiffres reconnus. Comparez avec votre grille, puis appuyez sur « Commencer ».`);
  }
  commit();
}

function clearGrid() {
  if (state.values.some(Boolean) && !confirm('Effacer toute la grille ?')) return;
  pushHistory();
  state.givens = emptyGrid();
  state.values = emptyGrid();
  state.notes = emptyGrid();
  wrong.clear();
  uncertain.clear();
  hint = null;
  showMessage('Grille vide. Touchez une case puis un chiffre pour saisir l’énoncé.');
  commit();
}

function startGame() {
  if (!state.givens.some(Boolean)) {
    showMessage('Saisissez d’abord les chiffres de la grille (ou chargez un exemple).');
    return;
  }
  if (conflicts(state.givens).size) {
    showMessage('La grille contient des doublons (en rouge). Corrigez-les avant de commencer.');
    return;
  }
  const { count, solution } = solve(state.givens, 2);
  if (count === 0) {
    showMessage('Cette grille n’a pas de solution : vérifiez la saisie.');
    return;
  }
  if (count > 1 && !confirm('Cette grille a plusieurs solutions : il manque sans doute des chiffres. Commencer quand même ?')) {
    return;
  }
  state.mode = 'play';
  state.solution = solution;
  state.values = state.givens.slice();
  state.notes = emptyGrid();
  history = [];
  wrong.clear();
  uncertain.clear();
  hint = null;
  showMessage(count > 1
    ? 'Grille à plusieurs solutions : « Vérifier » et « Indice » se basent sur l’une d’elles.'
    : 'C’est parti ! Touchez une case puis un chiffre.');
  commit();
}

function editGrid() {
  const progress = state.values.some((v, i) => v && !state.givens[i]) || state.notes.some(Boolean);
  if (progress && !confirm('Revenir à la saisie effacera les chiffres que vous avez placés. Continuer ?')) return;
  state.mode = 'edit';
  state.values = state.givens.slice();
  state.notes = emptyGrid();
  state.solution = null;
  history = [];
  wrong.clear();
  hint = null;
  showMessage('Modifiez l’énoncé, puis appuyez sur « Commencer ».');
  commit();
}

function findErrors() {
  return state.values.flatMap((v, i) => (v && v !== state.solution[i] ? [i] : []));
}

function check() {
  const errors = findErrors();
  wrong = new Set(errors);
  hint = null;
  const empty = state.values.filter((v) => !v).length;
  if (errors.length) {
    showMessage(errors.length === 1 ? '1 case est incorrecte (en rouge).' : `${errors.length} cases sont incorrectes (en rouge).`);
  } else {
    showMessage(empty ? `Aucune erreur pour l’instant. Encore ${empty} case(s) à remplir.` : 'Grille terminée sans erreur !');
  }
  render();
}

function giveHint() {
  const errors = findErrors();
  if (errors.length) {
    wrong = new Set(errors);
    hint = null;
    showMessage(`Il y a d’abord ${errors.length === 1 ? 'une erreur' : `${errors.length} erreurs`} à corriger (en rouge).`);
    render();
    return;
  }

  hint = findHint(state.values);
  if (!hint) {
    // Aucune technique simple : on révèle la case la plus contrainte.
    const empty = state.values.flatMap((v, i) => (v ? [] : [i]));
    if (!empty.length) return;
    const cell = empty.reduce((a, b) =>
      popcount(candidatesMask(state.values, b)) < popcount(candidatesMask(state.values, a)) ? b : a);
    const options = digitsOf(candidatesMask(state.values, cell)).join(', ');
    hint = {
      cell,
      digit: state.solution[cell],
      unit: [],
      text: `Pas de déduction simple ici. Cette case peut contenir ${options}.`,
    };
  }

  selected = hint.cell;
  const { cell, digit } = hint;
  showMessage(hint.text, {
    label: `Placer le ${digit}`,
    run: () => {
      selected = cell;
      state.notesMode = false;
      input(digit);
    },
  });
  render();
}

function checkComplete() {
  if (state.values.some((v) => !v)) return;
  if (findErrors().length) {
    showMessage('La grille est pleine mais il reste des erreurs. Appuyez sur « Vérifier ».');
  } else {
    showMessage('Bravo, grille terminée ! 🎉');
    selected = null;
    render();
  }
}

// ---------- Événements ----------

gridEl.addEventListener('click', (e) => {
  const el = e.target.closest('.cell');
  if (el) select(Number(el.dataset.i));
});

$('#btn-erase').addEventListener('click', () => input(0));
$('#btn-undo').addEventListener('click', undo);
$('#btn-notes').addEventListener('click', () => {
  state.notesMode = !state.notesMode;
  commit();
});
$('#btn-scan').addEventListener('click', () => {
  if (state.values.some(Boolean) && !confirm('Le scan remplacera la grille saisie. Continuer ?')) return;
  openScanner(applyScan);
});
$('#btn-example').addEventListener('click', loadExample);
$('#btn-clear').addEventListener('click', clearGrid);
$('#btn-start').addEventListener('click', startGame);
$('#btn-hint').addEventListener('click', giveHint);
$('#btn-check').addEventListener('click', check);
$('#btn-candidates').addEventListener('click', () => {
  state.autoCandidates = !state.autoCandidates;
  commit();
});
$('#btn-edit').addEventListener('click', editGrid);
messageAction.addEventListener('click', () => messageCallback?.());

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

document.addEventListener('keydown', (e) => {
  if (isScannerOpen()) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
    return;
  }
  if (/^[1-9]$/.test(e.key)) input(Number(e.key));
  else if (['Backspace', 'Delete', '0'].includes(e.key)) input(0);
  else if (e.key.toLowerCase() === 'n' && state.mode === 'play') {
    state.notesMode = !state.notesMode;
    commit();
  } else if (ARROWS[e.key]) {
    e.preventDefault();
    moveSelection(...ARROWS[e.key]);
  }
});

showMessage(state.mode === 'play'
  ? 'Partie reprise là où vous l’aviez laissée.'
  : 'Touchez une case puis un chiffre pour saisir l’énoncé, ou chargez un exemple.');
render();
