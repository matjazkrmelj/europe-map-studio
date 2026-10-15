import '../style.css';
import '../votes/votes.css';
import './bars.css';
import * as d3 from 'd3';
import { parseNumber } from '../matching.js';
import { buildScale, presetStops } from '../color.js';
import { makeFormatter } from '../render.js';
import { download, svgToPng } from '../export.js';

// The 27 EU member states: map feature id (ISO alpha-3), flag / code (ISO alpha-2), name.
const EU27 = [
  ['AUT', 'at', 'Austria'], ['BEL', 'be', 'Belgium'], ['BGR', 'bg', 'Bulgaria'], ['HRV', 'hr', 'Croatia'],
  ['CYP', 'cy', 'Cyprus'], ['CZE', 'cz', 'Czechia'], ['DNK', 'dk', 'Denmark'], ['EST', 'ee', 'Estonia'],
  ['FIN', 'fi', 'Finland'], ['FRA', 'fr', 'France'], ['DEU', 'de', 'Germany'], ['GRC', 'gr', 'Greece'],
  ['HUN', 'hu', 'Hungary'], ['IRL', 'ie', 'Ireland'], ['ITA', 'it', 'Italy'], ['LVA', 'lv', 'Latvia'],
  ['LTU', 'lt', 'Lithuania'], ['LUX', 'lu', 'Luxembourg'], ['MLT', 'mt', 'Malta'], ['NLD', 'nl', 'Netherlands'],
  ['POL', 'pl', 'Poland'], ['PRT', 'pt', 'Portugal'], ['ROU', 'ro', 'Romania'], ['SVK', 'sk', 'Slovakia'],
  ['SVN', 'si', 'Slovenia'], ['ESP', 'es', 'Spain'], ['SWE', 'se', 'Sweden'],
];

// Flags (flag-icons, MIT) are bundled and embedded as data URIs, so exports work offline
// and the flags' internal ids can't clash with each other.
const flagFiles = import.meta.glob('./flags/*.svg', { query: '?raw', import: 'default', eager: true });
const FLAGS = {};
for (const [path, svg] of Object.entries(flagFiles)) {
  const code = path.match(/(\w+)\.svg$/)[1];
  FLAGS[code] = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

const MAP_KEY = 'europe-map-studio-v1';
const LS_KEY = 'europe-map-studio-bars-v1';
const $ = (id) => document.getElementById(id);

const defaults = () => ({
  missing: 'show',
  euShow: true, euValue: null, euLabel: 'EU', euPos: 'first', avgLine: false,
  orient: 'v', sort: 'desc', flags: true, nameStyle: 'name', valueLabels: true, grid: false,
  colorMode: 'single', barColor: '#2563eb', euColor: '#f59e0b', hiColor: '#0f172a', textColor: '#1c2430', font: 'inter',
  title: null, subtitle: '', source: '',
  highlight: [],
  ex: { width: 1600, height: 900, background: 'white', file: 'eu-bar-chart' },
});

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY));
    const d = defaults();
    return saved ? { ...d, ...saved, ex: { ...d.ex, ...saved.ex } } : d;
  } catch {
    return defaults();
  }
}
let settings = loadSettings();
const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ } };

// Map tab state: values, the EU average row, legend number format and colours.
function readMap() {
  try {
    const m = JSON.parse(localStorage.getItem(MAP_KEY)) || {};
    return {
      values: m.values || {},
      eu: m.eu || null,
      fileName: m.dataset?.fileName || null,
      legend: { decimals: 1, prefix: '', suffix: '', title: '', ...m.legend },
      stops: m.stops || presetStops('Blues'),
      scale: { mode: 'continuous', classes: 5, domainAuto: true, nice: false, min: 0, max: 100, ...m.scale },
    };
  } catch {
    return readMap.empty;
  }
}
readMap.empty = { values: {}, eu: null, fileName: null, legend: { decimals: 1, prefix: '', suffix: '', title: '' }, stops: presetStops('Blues'), scale: { mode: 'continuous', classes: 5, domainAuto: true } };
let map = readMap();

const euValue = () => (settings.euValue != null ? settings.euValue : map.eu?.value ?? null);
const chartTitle = () => (settings.title ?? map.legend.title ?? '');

// ---------------------------------------------------------------- chart
const FONTS = {
  inter: {
    title: ["Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", 700],
    value: ["Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", 700],
    label: ["Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", 400],
  },
  // Same faces as the voting results tab; the SVG names them so design tools use the installed Gilroy.
  gilroy: {
    title: ["Gilroy-ExtraBold, 'Gilroy ExtraBold', 'Arial Black', Arial, sans-serif", 800],
    value: ["Gilroy-ExtraBold, 'Gilroy ExtraBold', 'Arial Black', Arial, sans-serif", 800],
    label: ["Gilroy-Light, 'Gilroy Light', Arial, sans-serif", 300],
  },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textW = (s, fs) => String(s).length * fs * 0.56; // rough width of a label, good enough for layout

function items() {
  const out = EU27.map(([id, iso2, name]) => ({ id, iso2, name, code: iso2.toUpperCase(), value: Number.isFinite(map.values[id]) ? map.values[id] : null }))
    .filter((d) => settings.missing === 'show' || d.value != null);
  const cmp = settings.sort === 'name'
    ? (a, b) => a.name.localeCompare(b.name)
    : (a, b) => (a.value == null) - (b.value == null) || (settings.sort === 'asc' ? a.value - b.value : b.value - a.value) || a.name.localeCompare(b.name);
  out.sort(cmp);
  const ev = euValue();
  if (settings.euShow && ev != null) {
    const eu = { id: 'EU', iso2: 'eu', name: settings.euLabel || 'EU', code: 'EU', value: ev, isEu: true };
    if (settings.euPos === 'first') out.unshift(eu, { gap: true });
    else if (settings.euPos === 'last') out.push({ gap: true }, eu);
    else {
      const i = settings.sort === 'name' ? out.length : out.findIndex((d) => d.value == null || (settings.sort === 'asc' ? d.value > ev : d.value < ev));
      out.splice(i < 0 ? out.length : i, 0, eu);
    }
  }
  return out.map((d, i) => ({ ...d, key: d.gap ? `gap${i}` : d.id }));
}

function barFill(d, mapScale) {
  if (d.isEu) return settings.euColor;
  if (settings.highlight.includes(d.id)) return settings.hiColor;
  if (settings.colorMode === 'map' && mapScale) return mapScale.color(d.value);
  return settings.barColor;
}

function buildSVG() {
  const W = Math.max(300, +settings.ex.width || 1600);
  const H = Math.max(300, +settings.ex.height || 900);
  const s = W / 1600;
  const pad = Math.round(W * 0.035);
  const fonts = FONTS[settings.font] || FONTS.inter;
  const ink = settings.textColor;
  const muted = d3.interpolateRgb(ink, '#ffffff')(0.45);
  const gridColor = d3.interpolateRgb(ink, '#ffffff')(0.85);
  const fmt = makeFormatter(map.legend);
  const data = items();
  const bars = data.filter((d) => !d.gap);
  const vals = bars.map((d) => d.value).filter((v) => v != null);
  const mapScale = settings.colorMode === 'map' ? buildScale(map.stops, Object.values(map.values), map.scale) : null;
  const out = [];
  const defs = [];
  const font = (k) => `font-family="${esc(fonts[k][0])}" font-weight="${fonts[k][1]}"`;

  if (settings.ex.background === 'white') out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

  // Title block and source note
  let top = pad;
  const title = chartTitle();
  if (title) {
    const fs = 40 * s;
    out.push(`<text x="${pad}" y="${top + fs * 0.8}" font-size="${fs}" ${font('title')} fill="${ink}">${esc(title)}</text>`);
    top += fs * 1.25;
  }
  if (settings.subtitle) {
    const fs = 22 * s;
    out.push(`<text x="${pad}" y="${top + fs * 0.85}" font-size="${fs}" ${font('label')} fill="${muted}">${esc(settings.subtitle)}</text>`);
    top += fs * 1.5;
  }
  if (title || settings.subtitle) top += 24 * s;
  let bottom = H - pad;
  if (settings.source) {
    const fs = 16 * s;
    out.push(`<text x="${pad}" y="${bottom}" font-size="${fs}" ${font('label')} fill="${muted}">${esc(settings.source)}</text>`);
    bottom -= fs * 2.2;
  }

  if (!bars.length) {
    out.push(`<text x="${W / 2}" y="${(top + bottom) / 2}" font-size="${24 * s}" ${font('label')} fill="${muted}" text-anchor="middle">No values for EU countries yet</text>`);
    return wrap(W, H, defs, out);
  }

  let [lo, hi] = [Math.min(0, d3.min(vals) ?? 0), Math.max(0, d3.max(vals) ?? 1)];
  if (lo === hi) hi = lo + 1;
  const value = d3.scaleLinear().domain([lo, hi]).nice();
  const ticks = value.ticks(5);
  const tickFmt = makeFormatter({ ...map.legend, decimals: d3.precisionFixed(ticks[1] - ticks[0] || 1) });
  const flag = (d, x, y, w, h) => {
    const cid = `flag-${d.key}`;
    const r = Math.max(1, Math.min(w, h) * 0.08);
    defs.push(`<clipPath id="${cid}"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r.toFixed(1)}"/></clipPath>`);
    return `<g data-id="${d.id}"><title>${esc(d.name)}</title><image xlink:href="${FLAGS[d.iso2]}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="none" clip-path="url(#${cid})"/>`
      + `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r.toFixed(1)}" fill="none" stroke="#000000" stroke-opacity="0.15" stroke-width="${Math.max(0.5, s)}"/></g>`;
  };
  const label = (d) => (settings.nameStyle === 'code' && !d.isEu ? d.code : d.name);
  const longestValue = d3.max(bars, (d) => textW(fmt(d.value ?? 0), 1)) || 1;
  const ev = euValue();
  const avg = settings.avgLine && ev != null;

  if (settings.orient === 'v') {
    const axisW = settings.grid ? d3.max(ticks, (t) => textW(tickFmt(t), 16 * s)) + 12 * s : 0;
    const band = d3.scaleBand().domain(data.map((d) => d.key)).range([pad + axisW, W - pad]).paddingInner(0.22).paddingOuter(0.05);
    const bw = band.bandwidth();
    // Value labels: as large as fits above the bar, turned upright when the column is too narrow.
    const vfs = Math.min(20 * s, bw * 0.55);
    const vertical = longestValue * vfs > bw * 1.15;
    const valueH = settings.valueLabels ? (vertical ? longestValue * vfs + 8 * s : vfs * 1.5) : 4 * s;
    // Country labels under the axis.
    let lfs = Math.min(18 * s, bw * 0.6);
    let labelH;
    let flagW;
    if (settings.flags) {
      flagW = Math.min(bw, 64 * s);
      labelH = flagW * 0.75 + 12 * s;
    } else if (settings.nameStyle === 'code') {
      lfs = Math.min(18 * s, bw * 0.55);
      labelH = lfs * 1.8;
    } else {
      labelH = d3.max(bars, (d) => textW(label(d), lfs)) * Math.SQRT1_2 + lfs + 12 * s;
    }
    const y = value.range([bottom - labelH - (lo < 0 && settings.valueLabels ? valueH : 0), top + valueH]);
    const y0 = y(0);
    if (settings.grid) {
      for (const t of ticks) {
        out.push(`<line x1="${pad + axisW}" x2="${W - pad}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${gridColor}" stroke-width="${s}"/>`);
        out.push(`<text x="${pad + axisW - 10 * s}" y="${(y(t) + 5.5 * s).toFixed(1)}" font-size="${16 * s}" ${font('label')} fill="${muted}" text-anchor="end">${esc(tickFmt(t))}</text>`);
      }
    }
    // Drawn first so bars and value labels sit on top of the line.
    if (avg) {
      const ya = y(ev).toFixed(1);
      out.push(`<line x1="${pad + axisW}" x2="${W - pad}" y1="${ya}" y2="${ya}" stroke="${settings.euColor}" stroke-width="${2 * s}" stroke-dasharray="${8 * s} ${6 * s}"/>`);
    }
    for (const d of bars) {
      const x = band(d.key);
      const cx = x + bw / 2;
      if (d.value == null) {
        out.push(`<text x="${cx.toFixed(1)}" y="${(y0 - 8 * s).toFixed(1)}" font-size="${Math.min(14 * s, bw * 0.45)}" ${font('label')} fill="${muted}" text-anchor="middle">n/a</text>`);
      } else {
        const yv = y(d.value);
        out.push(`<rect data-id="${d.id}" x="${x.toFixed(1)}" y="${Math.min(yv, y0).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(y0 - yv).toFixed(1)}" fill="${barFill(d, mapScale)}"><title>${esc(d.name)}: ${esc(fmt(d.value))}</title></rect>`);
        if (settings.valueLabels) {
          const neg = d.value < 0;
          const ty = neg ? yv + 6 * s : yv - 6 * s;
          out.push(vertical
            ? `<text transform="translate(${(cx + vfs * 0.36).toFixed(1)},${ty.toFixed(1)}) rotate(-90)" font-size="${vfs.toFixed(1)}" ${font('value')} fill="${ink}" text-anchor="${neg ? 'end' : 'start'}">${esc(fmt(d.value))}</text>`
            : `<text x="${cx.toFixed(1)}" y="${(neg ? ty + vfs * 0.8 : ty).toFixed(1)}" font-size="${vfs.toFixed(1)}" ${font('value')} fill="${ink}" text-anchor="middle">${esc(fmt(d.value))}</text>`);
        }
      }
      const ly = y.range()[0] + (lo < 0 && settings.valueLabels ? valueH : 0) + 10 * s;
      if (settings.flags) out.push(flag(d, cx - flagW / 2, ly, flagW, flagW * 0.75));
      else if (settings.nameStyle === 'code' || d.isEu && !settings.flags && textW(label(d), lfs) < bw) {
        out.push(`<text x="${cx.toFixed(1)}" y="${(ly + lfs * 0.9).toFixed(1)}" font-size="${lfs.toFixed(1)}" ${font(d.isEu ? 'value' : 'label')} fill="${ink}" text-anchor="middle">${esc(label(d))}</text>`);
      } else {
        out.push(`<text transform="translate(${(cx + lfs * 0.3).toFixed(1)},${(ly + 2 * s).toFixed(1)}) rotate(-45)" font-size="${lfs.toFixed(1)}" ${font(d.isEu ? 'value' : 'label')} fill="${ink}" text-anchor="end">${esc(label(d))}</text>`);
      }
    }
    out.push(`<line x1="${pad + axisW}" x2="${W - pad}" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}" stroke="${ink}" stroke-width="${1.5 * s}"/>`);
  } else {
    const band = d3.scaleBand().domain(data.map((d) => d.key)).range([top, bottom - (settings.grid ? 28 * s : 0)]).paddingInner(0.22).paddingOuter(0.05);
    const bh = band.bandwidth();
    const vfs = Math.min(20 * s, bh * 0.7);
    const lfs = Math.min(18 * s, bh * 0.7);
    let labelW;
    let flagH;
    if (settings.flags) {
      flagH = Math.min(bh, 40 * s);
      labelW = flagH * 4 / 3 + 14 * s;
    } else {
      labelW = d3.max(bars, (d) => textW(label(d), lfs)) + 14 * s;
    }
    const valueW = settings.valueLabels ? longestValue * vfs + 12 * s : 4 * s;
    const x = value.range([pad + labelW + (lo < 0 ? valueW : 0), W - pad - valueW]);
    const x0 = x(0);
    if (settings.grid) {
      for (const t of ticks) {
        out.push(`<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${top}" y2="${band.range()[1]}" stroke="${gridColor}" stroke-width="${s}"/>`);
        out.push(`<text x="${x(t).toFixed(1)}" y="${(band.range()[1] + 22 * s).toFixed(1)}" font-size="${16 * s}" ${font('label')} fill="${muted}" text-anchor="middle">${esc(tickFmt(t))}</text>`);
      }
    }
    // Drawn first so bars and value labels sit on top of the line.
    if (avg) {
      const xa = x(ev).toFixed(1);
      out.push(`<line x1="${xa}" x2="${xa}" y1="${top}" y2="${band.range()[1]}" stroke="${settings.euColor}" stroke-width="${2 * s}" stroke-dasharray="${8 * s} ${6 * s}"/>`);
    }
    for (const d of bars) {
      const yb = band(d.key);
      const cy = yb + bh / 2;
      // Labels sit left of the plot (left of the negative value labels too).
      const lx = pad + labelW - 14 * s;
      if (settings.flags) out.push(flag(d, lx + 14 * s - labelW, cy - flagH / 2, flagH * 4 / 3, flagH));
      else out.push(`<text x="${lx.toFixed(1)}" y="${(cy + lfs * 0.35).toFixed(1)}" font-size="${lfs.toFixed(1)}" ${font(d.isEu ? 'value' : 'label')} fill="${ink}" text-anchor="end">${esc(label(d))}</text>`);
      if (d.value == null) {
        out.push(`<text x="${(x0 + 8 * s).toFixed(1)}" y="${(cy + 5 * s).toFixed(1)}" font-size="${Math.min(14 * s, bh * 0.6)}" ${font('label')} fill="${muted}">n/a</text>`);
        continue;
      }
      const xv = x(d.value);
      out.push(`<rect data-id="${d.id}" x="${Math.min(xv, x0).toFixed(1)}" y="${yb.toFixed(1)}" width="${Math.abs(xv - x0).toFixed(1)}" height="${bh.toFixed(1)}" fill="${barFill(d, mapScale)}"><title>${esc(d.name)}: ${esc(fmt(d.value))}</title></rect>`);
      if (settings.valueLabels) {
        const neg = d.value < 0;
        out.push(`<text x="${(neg ? xv - 8 * s : xv + 8 * s).toFixed(1)}" y="${(cy + vfs * 0.35).toFixed(1)}" font-size="${vfs.toFixed(1)}" ${font('value')} fill="${ink}" text-anchor="${neg ? 'end' : 'start'}">${esc(fmt(d.value))}</text>`);
      }
    }
    out.push(`<line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="${top}" y2="${band.range()[1]}" stroke="${ink}" stroke-width="${1.5 * s}"/>`);
  }
  return wrap(W, H, defs, out);
}

function wrap(W, H, defs, out) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + out.join('') + '</svg>';
}

// ---------------------------------------------------------------- UI
let currentSVG = '';
function render() {
  currentSVG = buildSVG();
  $('stage').innerHTML = currentSVG;
  $('stage').style.setProperty('--ratio', `${settings.ex.width} / ${settings.ex.height}`);

  const have = EU27.filter(([id]) => Number.isFinite(map.values[id]));
  const missing = EU27.filter(([id]) => !Number.isFinite(map.values[id])).map((c) => c[2]);
  $('dataStatus').innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = `${have.length} of 27 EU countries have a value`;
  $('dataStatus').append(strong, map.fileName ? ` · ${map.fileName}` : '');
  if (missing.length && missing.length < 27) $('dataStatus').append(document.createElement('br'), `Missing: ${missing.join(', ')}`);
  if (!have.length) $('dataStatus').append(document.createElement('br'), 'Open the EU map tab to import a CSV or load the sample data.');

  const fmt = makeFormatter(map.legend);
  $('euValue').placeholder = map.eu ? String(map.eu.value) : 'none';
  $('euNote').textContent = settings.euValue != null
    ? `Typed by you${map.eu ? `; the data has ${fmt(map.eu.value)} (“${map.eu.label}”). Clear the box to use it.` : '.'}`
    : map.eu
      ? `From the data row “${map.eu.label}”.`
      : 'No EU row (EU, EU27, EU27_2020…) in the data. Type a value to add the bar.';
  $('stageNote').textContent = `${settings.ex.width} × ${settings.ex.height} px · ${settings.ex.background === 'none' ? 'transparent' : 'white'} background`;
  $('nameStyleWrap').hidden = settings.flags;
  $('barColorWrap').style.visibility = settings.colorMode === 'map' ? 'hidden' : '';
}

const BIND = {
  missing: 'value', euShow: 'checked', euLabel: 'value', euPos: 'value', avgLine: 'checked',
  orient: 'value', sort: 'value', flags: 'checked', nameStyle: 'value', valueLabels: 'checked', grid: 'checked',
  colorMode: 'value', barColor: 'value', euColor: 'value', hiColor: 'value', textColor: 'value', font: 'value',
  subtitle: 'value', source: 'value',
};
function syncControls() {
  for (const [k, prop] of Object.entries(BIND)) $(k)[prop] = settings[k];
  $('euValue').value = settings.euValue ?? '';
  $('title').value = chartTitle();
  $('exWidth').value = settings.ex.width;
  $('exHeight').value = settings.ex.height;
  $('exBg').value = settings.ex.background;
  $('exFile').value = settings.ex.file;
}
const update = () => { save(); render(); };
for (const [k, prop] of Object.entries(BIND)) {
  $(k).addEventListener(prop === 'checked' ? 'change' : 'input', (e) => { settings[k] = e.target[prop]; update(); });
}
$('title').oninput = (e) => { settings.title = e.target.value; update(); };
$('euValue').oninput = (e) => {
  const raw = e.target.value.trim();
  settings.euValue = raw ? parseNumber(raw) : null;
  update();
};
$('exWidth').onchange = (e) => { settings.ex.width = Math.max(300, Math.min(8000, +e.target.value || 1600)); syncControls(); update(); };
$('exHeight').onchange = (e) => { settings.ex.height = Math.max(300, Math.min(8000, +e.target.value || 900)); syncControls(); update(); };
$('exBg').onchange = (e) => { settings.ex.background = e.target.value; update(); };
$('exFile').oninput = (e) => { settings.ex.file = e.target.value; save(); };
$('highlightClear').onclick = () => { settings.highlight = []; update(); };
$('resetAll').onclick = () => {
  if (!confirm('Reset the bar chart settings? Your data on the EU map tab stays.')) return;
  settings = defaults();
  syncControls();
  update();
};

// Click a bar or flag to toggle its highlight.
$('stage').addEventListener('click', (e) => {
  const id = e.target.closest('[data-id]')?.getAttribute('data-id');
  if (!id || id === 'EU') return;
  const set = new Set(settings.highlight);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  settings.highlight = [...set];
  update();
});

// Exports
const fileName = (ext) => `${(settings.ex.file || 'eu-bar-chart').replace(/[^\w.-]+/g, '-')}.${ext}`;
const svgDoc = () => `<?xml version="1.0" encoding="UTF-8"?>\n${currentSVG}`;
function toast(msg) {
  $('toast').textContent = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($('toast').textContent = ''), 3000);
}
const dlSvg = () => download(new Blob([svgDoc()], { type: 'image/svg+xml;charset=utf-8' }), fileName('svg'));
$('dlSvg').onclick = dlSvg;
$('download').onclick = dlSvg;
$('dlPng').onclick = async () => {
  try {
    download(await svgToPng(svgDoc(), settings.ex.width, settings.ex.height), fileName('png'));
  } catch (err) {
    toast(`PNG export failed: ${err.message}`);
  }
};
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(svgDoc());
    toast('SVG code copied.');
  } catch {
    toast('Copying is blocked in this browser; use Download SVG.');
  }
};

// Data changes on the map tab (open in another browser tab) show up here right away.
window.addEventListener('storage', (e) => {
  if (e.key !== MAP_KEY) return;
  map = readMap();
  syncControls();
  render();
});

syncControls();
render();
if (document.fonts) document.fonts.ready.then(render);
