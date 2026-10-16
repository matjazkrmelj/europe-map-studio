import './style.css';
import * as d3 from 'd3';
import Papa from 'papaparse';
import { feature } from 'topojson-client';
import topo from './data/europe.topo.json';
import { createMatcher, normalize, parseNumber, euAggregateRank } from './matching.js';
import { PRESETS, presetStops, sortStops, gradientAt, cssGradient, buildScale } from './color.js';
import { makeProjection, EUROPE_FRAME, drawCountries, drawLabels, drawLegend, makeFormatter } from './render.js';
import { buildSvg, download, svgToPng } from './export.js';
import sampleCsv from './data/sample.csv?raw';

// ---------------------------------------------------------------- data
const features = feature(topo, topo.objects.countries).features;
const byId = new Map(features.map((f) => [f.id, f]));
const sortedFeatures = [...features].sort((a, b) => a.properties.name.localeCompare(b.properties.name));
const matcher = createMatcher(features);

// ---------------------------------------------------------------- state
const STORAGE_KEY = 'europe-map-studio-v1';
const defaults = () => ({
  values: {},
  dataset: null, // { fileName, columns, rows, nameCol, valueCol, overrides, applied }
  aliases: {}, // learned manual matches: normalized label -> id
  eu: null, // EU average row found in the dataset: { label, value }; used by the bar chart tab
  stops: presetStops('Blues'),
  scale: { mode: 'continuous', classes: 5, domainAuto: true, nice: false, min: 0, max: 100 },
  legend: { title: '', prefix: '', suffix: '', decimals: 1, position: 'bl', showNoData: true },
  style: { noData: '#d9dde3', border: '#ffffff', sea: '#eef4fa', borderWidth: 0.7 },
  labels: { mode: 'none', size: 10 },
  ex: { width: 1600, height: 1200, view: 'full', background: 'sea', legend: true, file: 'europe-map' },
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return defaults();
    const d = defaults();
    for (const k of Object.keys(d)) {
      if (saved[k] === undefined) continue;
      d[k] = d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) && k !== 'values' && k !== 'aliases' && k !== 'dataset'
        ? { ...d[k], ...saved[k] }
        : saved[k];
    }
    return d;
  } catch {
    return defaults();
  }
}
let state = load();

// Match results are recomputed from the rows, so they are not stored.
const skipDerived = (k, v) => (k === 'matches' || k === 'dupes' || k === 'lastStats' ? undefined : v);
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state, skipDerived));
    } catch {
      // Very large CSVs may not fit in localStorage; keep everything but the raw rows.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, dataset: null }, skipDerived));
      } catch { /* storage unavailable */ }
    }
  }, 250);
}

const $ = (id) => document.getElementById(id);
const UI_STYLE = () => ({
  ...state.style,
  font: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  text: '#1c2430',
  muted: '#5f6b7a',
  labelColor: '#1c2430',
  labelHalo: 'rgba(255,255,255,0.85)',
  legendBg: '#ffffff',
  legendOpacity: 0.92,
});
const fmt = () => makeFormatter(state.legend);
const currentScale = () => buildScale(state.stops, Object.values(state.values), state.scale);

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------------------------------------------------------------- map
const svg = d3.select('#map');
const zoomLayer = svg.append('g').attr('class', 'zoom-layer');
const countriesG = zoomLayer.append('g');
const legendG = svg.append('g').attr('class', 'legend');
let projection = makeProjection();
let size = { width: 800, height: 600 };
let transform = d3.zoomIdentity;
let selectedId = null;

const zoom = d3.zoom()
  .scaleExtent([1, 14])
  .on('zoom', (e) => {
    transform = e.transform;
    zoomLayer.attr('transform', transform);
    closeEditor();
    // Re-lay out labels so they keep a constant size on screen and stay clear of each other while zooming.
    drawLabels(countriesG, labelOpts());
  })
  .on('end', () => renderMap());
svg.call(zoom).on('dblclick.zoom', null);

function fitProjection() {
  const r = $('mapWrap').getBoundingClientRect();
  size = { width: Math.max(200, r.width), height: Math.max(200, r.height) };
  svg.attr('viewBox', `0 0 ${size.width} ${size.height}`);
  projection = makeProjection().fitExtent([[20, 20], [size.width - 20, size.height - 20]], EUROPE_FRAME);
  zoom.extent([[0, 0], [size.width, size.height]]).translateExtent([[-size.width * 0.5, -size.height * 0.5], [size.width * 1.5, size.height * 1.5]]);
}

// Legend rectangle in screen pixels; labels avoid it.
let legendRect = null;

// Label options for the current zoom: visible area and legend, both in un-zoomed map units.
function labelOpts() {
  const t = transform;
  const toMap = (r) => ({ x: (r.x - t.x) / t.k, y: (r.y - t.y) / t.k, w: r.w / t.k, h: r.h / t.k });
  return {
    features, projection, values: state.values, style: UI_STYLE(), fmt: fmt(),
    labelMode: state.labels.mode, labelSize: state.labels.size, zoomK: t.k,
    view: toMap({ x: 4, y: 4, w: size.width - 8, h: size.height - 8 }),
    obstacles: legendRect ? [toMap(legendRect)] : [],
  };
}

function renderMap() {
  const scale = currentScale();
  const f = fmt();
  const style = UI_STYLE();
  svg.style('background', style.sea);

  if (state.legend.position === 'none') {
    legendG.selectAll('*').remove();
    legendRect = null;
  } else {
    const ls = drawLegend(legendG, { scale, stops: state.stops, title: state.legend.title, fmt: f, style, showNoData: state.legend.showNoData, width: 240, uid: 'screen' });
    const m = 14;
    const x = state.legend.position.includes('r') ? size.width - m - ls.width - 44 : m;
    const y = state.legend.position.includes('t') ? m : size.height - m - ls.height;
    legendG.attr('transform', `translate(${x},${y})`);
    legendRect = { x, y, w: ls.width, h: ls.height };
  }

  drawCountries(countriesG, { ...labelOpts(), scale });
  countriesG.selectAll('path.country')
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('stroke-width', style.borderWidth)
    .classed('selected', (d) => d.id === selectedId);
  countriesG.select('path.country.selected').raise();
  countriesG.select('g.labels').raise();
  renderStats(f);
  updateCountrySwatches(scale);
}

function renderStats(f) {
  const vals = Object.values(state.values).filter(Number.isFinite);
  const items = [
    ['Countries', vals.length],
    ['Min', vals.length ? f(d3.min(vals)) : '–'],
    ['Max', vals.length ? f(d3.max(vals)) : '–'],
    ['Mean', vals.length ? f(d3.mean(vals)) : '–'],
  ];
  d3.select('#stats').selectAll('.stat').data(items).join((e) => {
    const s = e.append('div').attr('class', 'stat');
    s.append('b');
    s.append('span');
    return s;
  }).call((s) => {
    s.select('b').text((d) => d[1]);
    s.select('span').text((d) => d[0]);
  });
}

// Tooltip + click-to-edit
const tooltip = $('tooltip');
svg.on('mousemove', (e) => {
  const f = e.target.__data__;
  if (!f || !f.properties || e.target.tagName !== 'path') {
    tooltip.hidden = true;
    return;
  }
  const [x, y] = d3.pointer(e, $('mapWrap'));
  tooltip.innerHTML = `<b></b><span></span>`;
  tooltip.querySelector('b').textContent = f.properties.name;
  tooltip.querySelector('span').textContent = Number.isFinite(state.values[f.id]) ? fmt()(state.values[f.id]) : 'No data · click to add';
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  tooltip.hidden = false;
}).on('mouseleave', () => (tooltip.hidden = true));

svg.on('click', (e) => {
  const f = e.target.__data__;
  if (!f || !f.properties || e.target.tagName !== 'path') {
    closeEditor();
    return;
  }
  const [x, y] = d3.pointer(e, $('mapWrap'));
  openEditor(f.id, x, y);
});

function openEditor(id, x, y) {
  selectedId = id;
  const ed = $('editor');
  $('edName').textContent = byId.get(id).properties.name;
  const v = state.values[id];
  $('edValue').value = Number.isFinite(v) ? String(v) : '';
  ed.hidden = false;
  const w = $('mapWrap').clientWidth, h = $('mapWrap').clientHeight;
  ed.style.left = `${Math.min(Math.max(8, x + 12), w - 232)}px`;
  ed.style.top = `${Math.min(Math.max(8, y + 12), h - 140)}px`;
  $('edValue').focus();
  $('edValue').select();
  tooltip.hidden = true;
  renderMap();
  highlightCountryRow(id);
}
function closeEditor() {
  if ($('editor').hidden && !selectedId) return;
  $('editor').hidden = true;
  if (selectedId) {
    selectedId = null;
    countriesG.selectAll('path.country').classed('selected', false);
    highlightCountryRow(null);
  }
}
$('editor').addEventListener('submit', (e) => {
  e.preventDefault();
  setValue(selectedId, $('edValue').value);
  closeEditor();
});
$('edClear').onclick = () => {
  setValue(selectedId, '');
  closeEditor();
};
$('edClose').onclick = closeEditor;
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeEditor());

function setValue(id, raw) {
  if (!id) return;
  const v = parseNumber(raw);
  if (v == null) delete state.values[id];
  else state.values[id] = v;
  save();
  renderMap();
  syncCountryInput(id);
}

$('zoomIn').onclick = () => svg.transition().duration(300).call(zoom.scaleBy, 1.6);
$('zoomOut').onclick = () => svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.6);
$('zoomReset').onclick = () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);

new ResizeObserver(() => {
  fitProjection();
  renderMap();
}).observe($('mapWrap'));

// ---------------------------------------------------------------- country list (manual entry)
function renderCountryList() {
  const q = normalize($('countrySearch').value);
  const only = $('onlyWithData').checked;
  const rows = sortedFeatures.filter((f) => {
    if (only && !Number.isFinite(state.values[f.id])) return false;
    return !q || f.properties.names.some((n) => normalize(n).includes(q)) || f.id.toLowerCase() === q;
  });
  d3.select('#countryList').selectAll('.crow').data(rows, (f) => f.id).join((enter) => {
    const r = enter.append('div').attr('class', 'crow');
    r.append('div').attr('class', 'sw');
    r.append('span').text((f) => f.properties.name).attr('title', (f) => `${f.properties.name} (${f.properties.iso2 || f.id})`)
      .on('click', (e, f) => focusCountry(f.id));
    r.append('input').attr('type', 'text').attr('inputmode', 'decimal').attr('placeholder', '–')
      .attr('data-id', (f) => f.id)
      .on('change', function (e, f) { setValue(f.id, this.value); })
      .on('focus', (e, f) => highlightOnMap(f.id));
    return r;
  }).order();
  d3.select('#countryList').selectAll('.crow input').each(function (f) {
    if (document.activeElement !== this) this.value = Number.isFinite(state.values[f.id]) ? state.values[f.id] : '';
  });
  updateCountrySwatches(currentScale());
}
function updateCountrySwatches(scale) {
  d3.select('#countryList').selectAll('.crow .sw').style('background', (f) =>
    Number.isFinite(state.values[f.id]) ? scale.color(state.values[f.id]) : state.style.noData);
}
function syncCountryInput(id) {
  const input = document.querySelector(`#countryList input[data-id="${id}"]`);
  if (input && document.activeElement !== input) input.value = Number.isFinite(state.values[id]) ? state.values[id] : '';
}
function highlightCountryRow(id) {
  d3.select('#countryList').selectAll('.crow').classed('sel', (f) => f.id === id);
  if (id) document.querySelector(`#countryList input[data-id="${id}"]`)?.closest('.crow')?.scrollIntoView({ block: 'nearest' });
}
function highlightOnMap(id) {
  countriesG.selectAll('path.country').classed('selected', (d) => d.id === id);
  countriesG.select('path.country.selected').raise();
  countriesG.select('g.labels').raise();
}
function focusCountry(id) {
  const f = byId.get(id);
  const [[x0, y0], [x1, y1]] = d3.geoPath(projection).bounds(f);
  const k = Math.min(8, 0.6 / Math.max((x1 - x0) / size.width, (y1 - y0) / size.height));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const t = d3.zoomIdentity.translate(size.width / 2, size.height / 2).scale(Math.max(1, k)).translate(-cx, -cy);
  svg.transition().duration(600).call(zoom.transform, t).on('end', () => {
    const p = transform.apply([cx, cy]);
    openEditor(id, p[0], p[1]);
  });
}
$('countrySearch').oninput = renderCountryList;
$('onlyWithData').onchange = renderCountryList;

// ---------------------------------------------------------------- CSV import
function importCsv(text, fileName) {
  const parsed = Papa.parse(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  const columns = (parsed.meta.fields || []).filter((c) => c !== '');
  const rows = parsed.data;
  if (!columns.length || !rows.length) {
    toast('Could not read any rows from that file.');
    return;
  }
  // Country column: the one whose cells match the most countries.
  const sample = rows.slice(0, 80);
  const nameScore = (c) => sample.filter((r) => {
    const m = matcher.match(r[c], state.aliases);
    return m.id && m.method !== 'fuzzy';
  }).length;
  const nameCol = [...columns].sort((a, b) => nameScore(b) - nameScore(a))[0];
  // Value column: mostly numeric; with year columns (wide Eurostat tables) take the latest year.
  const numericShare = (c) => sample.filter((r) => parseNumber(r[c]) != null).length / sample.length;
  const numeric = columns.filter((c) => c !== nameCol && numericShare(c) >= 0.5);
  const yearCols = numeric.filter((c) => /\b(19|20)\d{2}\b/.test(c));
  const valueCol = yearCols[yearCols.length - 1] || numeric[0] || columns.find((c) => c !== nameCol);

  // Replace values that came from a previous dataset.
  if (state.dataset) for (const id of state.dataset.applied || []) delete state.values[id];
  state.dataset = { fileName, columns, rows, nameCol, valueCol, overrides: {}, applied: [] };
  applyDataset();
  const m = state.dataset.lastStats;
  toast(`Imported ${fileName}: ${m.matched} matched${m.unmatched ? `, ${m.unmatched} need attention` : ''}.`);
}

function rowMatch(i) {
  const ds = state.dataset;
  const label = ds.rows[i][ds.nameCol];
  const o = ds.overrides[i];
  if (o === '__ignore') return { id: null, method: 'ignored', suggestions: [] };
  if (o) return { id: o, method: 'manual', suggestions: [] };
  const euRank = euAggregateRank(label);
  if (euRank >= 0) return { id: null, method: 'eu', euRank, suggestions: [] };
  return matcher.match(label, state.aliases);
}

function applyDataset() {
  const ds = state.dataset;
  if (!ds) return;
  for (const id of ds.applied || []) delete state.values[id];
  const applied = new Set();
  const seen = new Map();
  ds.matches = ds.rows.map((r, i) => {
    const m = rowMatch(i);
    const value = parseNumber(r[ds.valueCol]);
    if (m.id && value != null) {
      state.values[m.id] = value;
      applied.add(m.id);
    }
    if (m.id) seen.set(m.id, (seen.get(m.id) || 0) + 1);
    return { ...m, value, label: r[ds.nameCol] };
  });
  ds.applied = [...applied];
  const eu = ds.matches.filter((m) => m.method === 'eu' && m.value != null).sort((a, b) => a.euRank - b.euRank)[0];
  state.eu = eu ? { label: String(eu.label).trim(), value: eu.value } : null;
  ds.lastStats = {
    matched: ds.matches.filter((m) => m.id).length,
    fuzzy: ds.matches.filter((m) => m.method === 'fuzzy').length,
    unmatched: ds.matches.filter((m) => !m.id && !['ignored', 'empty', 'eu'].includes(m.method)).length,
    ignored: ds.matches.filter((m) => m.method === 'ignored').length,
    noValue: ds.matches.filter((m) => m.id && m.value == null).length,
  };
  ds.dupes = new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
  save();
  renderDatasetPanel();
  renderMap();
  renderCountryList();
}

let showAllRows = false;
function renderDatasetPanel() {
  const ds = state.dataset;
  $('datasetPanel').hidden = !ds;
  if (!ds) return;
  if (!ds.matches) {
    applyDataset();
    return;
  }
  $('datasetName').textContent = `${ds.fileName} · ${ds.rows.length} rows`;
  for (const [sel, key] of [[$('nameCol'), 'nameCol'], [$('valueCol'), 'valueCol']]) {
    sel.innerHTML = '';
    for (const c of ds.columns) sel.add(new Option(c, c, false, c === ds[key]));
  }
  const s = ds.lastStats;
  $('matchSummary').innerHTML = '';
  const pill = (cls, text) => {
    const p = document.createElement('span');
    p.className = `pill ${cls}`;
    p.textContent = text;
    $('matchSummary').appendChild(p);
  };
  pill('ok', `${s.matched} matched`);
  if (s.fuzzy) pill('warn', `${s.fuzzy} guessed`);
  if (s.unmatched) pill('bad', `${s.unmatched} unmatched`);
  if (s.ignored) pill('', `${s.ignored} ignored`);
  if (state.eu) pill('ok', `EU average ${fmt()(state.eu.value)}`);
  if (s.noValue) pill('warn', `${s.noValue} without value`);
  if (ds.dupes.size) pill('warn', `${ds.dupes.size} duplicate`);
  const toggle = document.createElement('button');
  toggle.className = 'link';
  toggle.textContent = showAllRows ? 'show issues only' : 'review all rows';
  toggle.onclick = () => { showAllRows = !showAllRows; renderDatasetPanel(); };
  $('matchSummary').appendChild(toggle);

  const list = $('matchList');
  list.innerHTML = '';
  const order = { none: 0, fuzzy: 1, ignored: 3 };
  const rows = ds.matches.map((m, i) => ({ ...m, i }))
    .filter((m) => m.method !== 'empty' && (showAllRows || (m.method !== 'eu' && (!m.id || m.method === 'fuzzy' || ds.dupes.has(m.id) || m.value == null))) && (showAllRows || m.method !== 'ignored'))
    .sort((a, b) => (order[a.method] ?? 2) - (order[b.method] ?? 2));
  for (const m of rows) {
    const row = document.createElement('div');
    const issue = !m.id && m.method !== 'ignored' && m.method !== 'eu';
    row.className = `match ${issue ? 'bad' : m.method === 'fuzzy' || ds.dupes.has(m.id) || (m.id && m.value == null) ? 'warn' : ''}`;
    const src = document.createElement('div');
    src.className = 'src';
    src.title = String(m.label);
    src.textContent = m.label;
    const note = document.createElement('small');
    note.textContent = [
      m.value == null ? 'no numeric value' : fmt()(m.value),
      m.method === 'eu' ? 'EU average' : m.method === 'fuzzy' ? 'guessed' : m.method === 'manual' ? 'set by you' : m.method === 'learned' ? 'remembered' : '',
      m.id && ds.dupes.has(m.id) ? 'duplicate country' : '',
    ].filter(Boolean).join(' · ');
    src.appendChild(note);
    row.appendChild(src);
    row.appendChild(countrySelect(m, (val) => {
      ds.overrides[m.i] = val;
      const key = normalize(m.label);
      if (val && val !== '__ignore') state.aliases[key] = val;
      else delete state.aliases[key];
      applyDataset();
    }));
    list.appendChild(row);
  }
}

function countrySelect(m, onChange) {
  const sel = document.createElement('select');
  sel.add(new Option(m.id ? '— unmatch —' : '— pick country —', ''));
  sel.add(new Option('Ignore this row', '__ignore', false, m.method === 'ignored'));
  const sugg = (m.suggestions || []).filter((id) => byId.has(id));
  if (sugg.length) {
    const g = document.createElement('optgroup');
    g.label = 'Suggestions';
    for (const id of sugg) g.appendChild(new Option(byId.get(id).properties.name, id));
    sel.appendChild(g);
  }
  const g = document.createElement('optgroup');
  g.label = 'All countries';
  for (const f of sortedFeatures) g.appendChild(new Option(f.properties.name, f.id));
  sel.appendChild(g);
  sel.value = m.id || (m.method === 'ignored' ? '__ignore' : '');
  sel.onchange = () => onChange(sel.value);
  return sel;
}

$('nameCol').onchange = (e) => { state.dataset.nameCol = e.target.value; state.dataset.overrides = {}; applyDataset(); };
$('valueCol').onchange = (e) => { state.dataset.valueCol = e.target.value; applyDataset(); };
$('removeDataset').onclick = () => {
  for (const id of state.dataset.applied || []) delete state.values[id];
  state.dataset = null;
  state.eu = null;
  save();
  renderDatasetPanel();
  renderMap();
  renderCountryList();
};

function readFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importCsv(String(reader.result), file.name);
  reader.readAsText(file);
}
$('csvFile').onchange = (e) => {
  readFile(e.target.files[0]);
  e.target.value = '';
};
$('loadSample').onclick = () => {
  if (!state.legend.title) {
    state.legend.title = 'GDP per capita (EU27 = 100)';
    state.legend.decimals = 0;
    syncControls();
  }
  importCsv(sampleCsv, 'sample-gdp-pps.csv');
};
$('clearData').onclick = () => {
  if (!confirm('Remove all values from the map?')) return;
  state.values = {};
  state.dataset = null;
  state.eu = null;
  save();
  renderDatasetPanel();
  renderMap();
  renderCountryList();
};

// Drag & drop anywhere
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('dropOverlay').hidden = false; $('drop').classList.add('over'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; $('drop').classList.remove('over'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropOverlay').hidden = true;
  $('drop').classList.remove('over');
  readFile(e.dataTransfer.files[0]);
});

// ---------------------------------------------------------------- gradient editor
let activeStop = 0;
for (const name of Object.keys(PRESETS)) $('preset').add(new Option(name, name));
$('preset').onchange = (e) => {
  if (!e.target.value) return;
  state.stops = presetStops(e.target.value);
  e.target.value = '';
  activeStop = 0;
  stopsChanged();
};

function stopsChanged(rebuildList = true) {
  save();
  $('gradBar').style.background = cssGradient(state.stops);
  renderHandles();
  if (rebuildList) renderStopList();
  renderMap();
}

function renderHandles() {
  const wrap = $('gradHandles');
  wrap.innerHTML = '';
  state.stops.forEach((s, i) => {
    const h = document.createElement('div');
    h.className = `handle${i === activeStop ? ' active' : ''}`;
    h.style.left = `${s.p * 100}%`;
    h.style.background = s.c;
    h.title = `${s.c} at ${Math.round(s.p * 100)}%`;
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activeStop = i;
      h.setPointerCapture(e.pointerId);
      const rect = wrap.getBoundingClientRect();
      const move = (ev) => {
        state.stops[i].p = Math.round(Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * 1000) / 1000;
        h.style.left = `${state.stops[i].p * 100}%`;
        $('gradBar').style.background = cssGradient(state.stops);
        const pos = document.querySelectorAll('.stop .pos input')[i];
        if (pos) pos.value = Math.round(state.stops[i].p * 100);
        renderMap();
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        stopsChanged();
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      wrap.querySelectorAll('.handle').forEach((x, j) => x.classList.toggle('active', j === i));
    });
    wrap.appendChild(h);
  });
}

function renderStopList() {
  const list = $('stopList');
  list.innerHTML = '';
  state.stops.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'stop';
    const color = document.createElement('input');
    color.type = 'color';
    color.value = s.c;
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.value = s.c;
    color.oninput = () => { s.c = color.value; hex.value = color.value; activeStop = i; stopsChanged(false); };
    hex.onchange = () => {
      const c = d3.color(hex.value.trim());
      if (c) { s.c = c.formatHex(); color.value = s.c; hex.value = s.c; stopsChanged(false); } else hex.value = s.c;
    };
    const pos = document.createElement('label');
    pos.className = 'pos';
    const pin = document.createElement('input');
    pin.type = 'number';
    pin.min = 0;
    pin.max = 100;
    pin.value = Math.round(s.p * 100);
    pin.onchange = () => { s.p = Math.max(0, Math.min(100, +pin.value || 0)) / 100; stopsChanged(false); };
    pos.append(pin, '%');
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Remove color';
    del.disabled = state.stops.length <= 2;
    del.onclick = () => { state.stops.splice(i, 1); activeStop = 0; stopsChanged(); };
    row.append(color, hex, pos, del);
    list.appendChild(row);
  });
}

function addStopAt(p) {
  state.stops.push({ c: d3.color(gradientAt(state.stops, p)).formatHex(), p });
  state.stops = sortStops(state.stops);
  activeStop = state.stops.findIndex((s) => s.p === p);
  stopsChanged();
}
$('gradBar').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  addStopAt(Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000);
});
$('addStop').onclick = () => {
  // New color in the middle of the widest gap.
  const s = sortStops(state.stops);
  let best = 0;
  for (let i = 1; i < s.length; i++) if (s[i].p - s[i - 1].p > s[best + 1].p - s[best].p) best = i - 1;
  addStopAt(Math.round(((s[best].p + s[best + 1].p) / 2) * 1000) / 1000);
};
$('reverseStops').onclick = () => {
  state.stops = sortStops(state.stops.map((s) => ({ ...s, p: Math.round((1 - s.p) * 1000) / 1000 })));
  stopsChanged();
};
$('evenStops').onclick = () => {
  state.stops = sortStops(state.stops).map((s, i, a) => ({ ...s, p: Math.round((i / (a.length - 1)) * 1000) / 1000 }));
  stopsChanged();
};

// ---------------------------------------------------------------- simple bound controls
// [element id, state path, kind]
const BINDINGS = [
  ['scaleMode', 'scale.mode'], ['classes', 'scale.classes', 'num'], ['domainAuto', 'scale.domainAuto', 'bool'],
  ['nice', 'scale.nice', 'bool'], ['dMin', 'scale.min', 'num'], ['dMax', 'scale.max', 'num'],
  ['legendTitle', 'legend.title'], ['prefix', 'legend.prefix'], ['suffix', 'legend.suffix'],
  ['decimals', 'legend.decimals', 'num'], ['legendPos', 'legend.position'], ['showNoData', 'legend.showNoData', 'bool'],
  ['noData', 'style.noData'], ['border', 'style.border'], ['sea', 'style.sea'], ['borderWidth', 'style.borderWidth', 'num'],
  ['labelMode', 'labels.mode'], ['labelSize', 'labels.size', 'num'],
  ['exWidth', 'ex.width', 'num'], ['exHeight', 'ex.height', 'num'], ['exView', 'ex.view'], ['exBg', 'ex.background'],
  ['exLegend', 'ex.legend', 'bool'], ['exFile', 'ex.file'],
];
const getPath = (p) => p.split('.').reduce((o, k) => o[k], state);
const setPath = (p, v) => {
  const ks = p.split('.');
  ks.slice(0, -1).reduce((o, k) => o[k], state)[ks[ks.length - 1]] = v;
};

function syncControls() {
  for (const [id, path, kind] of BINDINGS) {
    const el = $(id);
    if (kind === 'bool') el.checked = !!getPath(path);
    else el.value = getPath(path) ?? '';
  }
  // Manual range defaults to the current data range the first time it is shown.
  $('domainManual').hidden = state.scale.domainAuto;
  $('niceWrap').hidden = !state.scale.domainAuto;
  $('classesWrap').style.visibility = state.scale.mode === 'continuous' ? 'hidden' : 'visible';
  $('bwOut').textContent = `${state.style.borderWidth}px`;
}

for (const [id, path, kind] of BINDINGS) {
  const el = $(id);
  const handler = () => {
    let v = kind === 'bool' ? el.checked : el.value;
    if (kind === 'num') {
      v = parseFloat(v);
      if (!Number.isFinite(v)) return;
    }
    setPath(path, v);
    if (id === 'domainAuto' && !v) {
      // Seed the manual range from the data so switching does not jump.
      const s = buildScale(state.stops, Object.values(state.values), { ...state.scale, domainAuto: true });
      state.scale.min = +s.min.toPrecision(6);
      state.scale.max = +s.max.toPrecision(6);
    }
    syncControls();
    save();
    renderMap();
    if (path.startsWith('legend.') && state.dataset) renderDatasetPanel();
  };
  el.addEventListener(el.type === 'text' || el.type === 'range' || el.type === 'color' ? 'input' : 'change', handler);
}

// ---------------------------------------------------------------- export
function exportSvgString() {
  return buildSvg({
    features, values: state.values, scale: currentScale(), stops: state.stops, style: UI_STYLE(), fmt: fmt(),
    legend: state.legend, labels: state.labels, ex: state.ex,
    view: { projection, transform, width: size.width, height: size.height },
  });
}
const fileBase = () => (state.ex.file || 'europe-map').replace(/[\\/:*?"<>|]+/g, '-').replace(/\.(svg|png)$/i, '');
$('dlSvg').onclick = () => {
  download(new Blob([exportSvgString()], { type: 'image/svg+xml;charset=utf-8' }), `${fileBase()}.svg`);
};
$('dlPng').onclick = async () => {
  try {
    const blob = await svgToPng(exportSvgString(), +state.ex.width, +state.ex.height);
    download(blob, `${fileBase()}.png`);
  } catch (err) {
    toast(err.message);
  }
};

$('resetAll').onclick = () => {
  if (!confirm('Reset all data and settings?')) return;
  state = defaults();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  init();
};

// ---------------------------------------------------------------- init
function init() {
  syncControls();
  fitProjection();
  stopsChanged();
  renderDatasetPanel();
  renderCountryList();
  renderMap();
}
init();

// Handy for debugging / automation from the console.
window.mapStudio = { get state() { return state; }, importCsv, exportSvgString };
