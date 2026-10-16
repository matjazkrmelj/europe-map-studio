// Drawing shared by the on-screen map and the SVG/PNG export.
import * as d3 from 'd3';

// Lambert azimuthal equal-area centred on Europe (the projection Eurostat uses, EPSG:3035).
export const makeProjection = () => d3.geoAzimuthalEqualArea().rotate([-10, -52]).clipAngle(120);

// The area every "full view" is fitted to: roughly Iceland to the Caucasus, Crete/Cyprus to North Cape.
const EXTENT = { w: -24, e: 42, s: 34, n: 71.5 };
export const EUROPE_FRAME = {
  type: 'MultiPoint',
  coordinates: [
    ...d3.range(EXTENT.w, EXTENT.e + 0.1, 2).flatMap((x) => [[x, EXTENT.s], [x, EXTENT.n]]),
    ...d3.range(EXTENT.s, EXTENT.n + 0.1, 2).flatMap((y) => [[EXTENT.w, y], [EXTENT.e, y]]),
  ],
};

export function makeFormatter({ decimals = 1, prefix = '', suffix = '', thousands = true }) {
  const f = d3.format(`${thousands ? ',' : ''}.${Math.max(0, Math.min(6, decimals | 0))}f`);
  return (v) => (v == null || !Number.isFinite(v) ? '–' : `${prefix}${f(v)}${suffix}`);
}

/** Draws country paths and optional labels into `g`. */
export function drawCountries(g, { features, projection, values, scale, style, fmt, labelMode, labelSize, zoomK = 1, view, obstacles }) {
  const path = d3.geoPath(projection);
  const fill = (f) => {
    const v = values[f.id];
    return Number.isFinite(v) ? scale.color(v) : style.noData;
  };

  g.selectAll('path.country')
    .data(features, (f) => f.id)
    .join('path')
    .attr('class', 'country')
    .attr('d', path)
    .attr('fill', fill)
    .attr('stroke', style.border)
    .attr('stroke-width', style.borderWidth / zoomK)
    .attr('stroke-linejoin', 'round')
    .attr('data-id', (f) => f.id);

  drawLabels(g, { features, projection, values, style, fmt, labelMode, labelSize, zoomK, view, obstacles });
}

// Countries that always get a label (with a leader arrow when too small), even without data.
const ALWAYS_LABEL = new Set(['AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC',
  'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE']);
// Below this area (steradians, ≈ Luxembourg) a country without data is not worth a callout.
const MIN_CALLOUT_AREA = 6e-5;

// Projected outer rings per feature, cached per projection (they don't depend on zoom).
const ringCache = new WeakMap();
function projectedRings(projection, f) {
  let m = ringCache.get(projection);
  if (!m) ringCache.set(projection, (m = new Map()));
  let rings = m.get(f.id);
  if (!rings) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    rings = polys.map((poly) => poly[0].map((c) => projection(c)).filter(Boolean)).filter((r) => r.length > 2);
    m.set(f.id, rings);
  }
  return rings;
}

let measureCtx = null;
function textWidth(t, px, font, bold) {
  if (typeof document !== 'undefined') {
    measureCtx ||= document.createElement('canvas').getContext('2d');
    measureCtx.font = `${bold ? 600 : 400} 100px ${font}`;
    return (measureCtx.measureText(t).width / 100) * px;
  }
  return t.length * px * (bold ? 0.6 : 0.56);
}

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inBox = (p, b) => p[0] > b.x && p[0] < b.x + b.w && p[1] > b.y && p[1] < b.y + b.h;
function segHitsBox(p, q, b) {
  // Sample the segment; good enough at label scale.
  for (let t = 0.1; t <= 0.9; t += 0.1) if (inBox([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], b)) return true;
  return false;
}
function segsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
// Point where the ray from the box centre towards `p` leaves the box.
function boxExit(b, p) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = p[0] - cx, dy = p[1] - cy;
  const t = Math.min(dx ? (b.w / 2) / Math.abs(dx) : Infinity, dy ? (b.h / 2) / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

/**
 * Lays out and draws labels. A label sits inside its country when it fits there;
 * otherwise it floats nearby, clear of other labels, with an arrow pointing at the country.
 * All geometry is in projected (un-zoomed) units; `view` is the visible rectangle in those units.
 */
export function drawLabels(g, { features, projection, values, style, fmt, labelMode, labelSize, zoomK = 1, view, obstacles = [] }) {
  const path = d3.geoPath(projection);
  const fs = labelSize / zoomK;
  const lineH = 1.1 * fs;
  const pad = 0.15 * fs;

  const text = (f) => {
    const name = f.properties.name;
    const v = fmt(values[f.id]);
    if (labelMode === 'name') return [name];
    if (labelMode === 'value') return [v];
    return Number.isFinite(values[f.id]) ? [name, v] : [name];
  };

  const items = [];
  if (labelMode !== 'none') {
    for (const f of features) {
      const has = Number.isFinite(values[f.id]);
      if (labelMode !== 'name' && !has) continue;
      const a = projection([f.properties.lx, f.properties.ly]) || path.centroid(f);
      if (!a || !Number.isFinite(a[0])) continue;
      if (view && (a[0] < view.x || a[0] > view.x + view.w || a[1] < view.y || a[1] > view.y + view.h)) continue;
      const lines = text(f);
      const w = Math.max(...lines.map((t, i) => textWidth(t, fs, style.font, lines.length > 1 && i === 1))) + 2 * pad;
      const h = lines.length * lineH + pad;
      const canCallout = has || ALWAYS_LABEL.has(f.id) || d3.geoArea(f) >= MIN_CALLOUT_AREA;
      const [[x0, y0], [x1, y1]] = path.bounds(f);
      items.push({ f, a, lines, w, h, canCallout, area: path.area(f), radius: Math.hypot(x1 - x0, y1 - y0) / 2 });
    }
  }

  const placed = []; // boxes
  const blocked = obstacles.slice();
  // Area of `b` outside the visible map (rounded, so float noise doesn't count).
  const outside = (b) => (view ? Math.max(0, Math.round(b.w * b.h - overlap(b, view))) : 0);

  // 1. Labels that fit inside their country, biggest countries first. The halo lets a label
  //    overhang the border a little, so only the inner part of its box has to be on land.
  const fits = (it, b) => {
    const rings = projectedRings(projection, it.f);
    const ix = b.w * 0.12, iy = b.h * 0.15;
    const pts = [];
    for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) pts.push([b.x + ix + (b.w - 2 * ix) * fx, b.y + iy + (b.h - 2 * iy) * fy]);
    return rings.some((r) => pts.every((p) => d3.polygonContains(r, p)));
  };
  // Nudges tried around the label point before giving up on an inside label (fractions of the box).
  const nudges = [[0, 0], [0, -0.6], [0, 0.6], [-0.35, 0], [0.35, 0], [-0.35, -0.6], [0.35, -0.6], [-0.35, 0.6], [0.35, 0.6], [0, -1.2], [0, 1.2]];
  const floating = [];
  for (const it of [...items].sort((p, q) => q.area - p.area)) {
    let box = null;
    if (it.area > it.w * it.h * 0.6) {
      for (const [nx, ny] of nudges) {
        const b = { x: it.a[0] - it.w / 2 + nx * it.w, y: it.a[1] - it.h / 2 + ny * it.h, w: it.w, h: it.h };
        const clash = placed.some((o) => overlap(o, b) > 0) || blocked.some((o) => overlap(o, b) > 0) || outside(b) > 0;
        if (!clash && fits(it, b)) { box = b; break; }
      }
    }
    if (box) {
      it.box = box;
      placed.push(box);
    } else if (it.canCallout) {
      floating.push(it);
    }
  }

  // 2. Floating labels: try positions around the country and keep the least cluttered one.
  //    A greedy pass, then a couple of passes that re-place each label against all the others.
  const anchors = items.map((it) => it.a);
  const dirs = d3.range(24).map((i) => (i / 24) * 2 * Math.PI);
  const spot = (it) => {
    const boxes = placed.concat(floating.filter((o) => o !== it && o.box).map((o) => o.box));
    const lines = floating.filter((o) => o !== it && o.leader).map((o) => o.leader);
    const base = Math.min(it.radius, 1.5 * fs) + 0.7 * fs;
    let best = null;
    for (const step of [0, 1, 2, 3.2, 4.6]) {
      const d = base + step * fs;
      for (const ang of dirs) {
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const cx = it.a[0] + ux * (d + it.w / 2 * Math.abs(ux)), cy = it.a[1] + uy * (d + it.h / 2 * Math.abs(uy));
        const b = { x: cx - it.w / 2, y: cy - it.h / 2, w: it.w, h: it.h };
        const from = boxExit(b, it.a);
        let score = step * step * 4; // short leaders read best: drifting away costs more and more
        for (const o of boxes) score += overlap(o, b) / (fs * fs) * 100 + (segHitsBox(from, it.a, o) ? 30 : 0);
        for (const o of blocked) score += overlap(o, b) / (fs * fs) * 100;
        score += outside(b) / (fs * fs) * 100;
        for (const p of anchors) if (inBox(p, b)) score += 25;
        for (const [p, q] of lines) if (segsCross(from, it.a, p, q)) score += 40;
        if (!best || score < best.score) best = { score, box: b, leader: [from, it.a] };
      }
      if (best.score < step * step * 4 + 1) break; // clean spot found; don't drift further out
    }
    return best;
  };
  floating.sort((p, q) => p.area - q.area);
  for (let pass = 0; pass < 3; pass++) {
    // The current spot is among the candidates, so a later pass never makes a label worse off.
    for (const it of floating) Object.assign(it, spot(it));
  }

  const shown = items.filter((it) => it.box);
  const lg = g.selectAll('g.labels').data([0]).join('g').attr('class', 'labels').attr('pointer-events', 'none');

  // Leader lines with arrowheads, drawn beneath the text.
  const sw = Math.max(0.8, labelSize / 12) / zoomK;
  const head = Math.max(4, labelSize * 0.5) / zoomK;
  const leaderPath = (it) => {
    const [p, q] = it.leader;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
    const gap = Math.min(len * 0.3, 1.5 / zoomK);
    const s = [p[0] + ux * gap, p[1] + uy * gap];
    const tip = [q[0] - ux * gap * 0.5, q[1] - uy * gap * 0.5];
    const bx = tip[0] - ux * head, by = tip[1] - uy * head;
    const nx = -uy * head * 0.45, ny = ux * head * 0.45;
    return { line: `M${s[0]},${s[1]}L${bx},${by}`, head: `M${tip[0]},${tip[1]}L${bx + nx},${by + ny}L${bx - nx},${by - ny}Z` };
  };
  const callouts = shown.filter((it) => it.leader);
  const leg = lg.selectAll('g.leader').data(callouts, (it) => it.f.id).join((e) => {
    const n = e.append('g').attr('class', 'leader');
    n.append('path').attr('class', 'halo');
    n.append('path').attr('class', 'line');
    n.append('path').attr('class', 'head');
    return n;
  });
  leg.each(function (it) {
    const d = leaderPath(it);
    const n = d3.select(this);
    n.select('.halo').attr('d', d.line + d.head).attr('fill', style.labelHalo).attr('stroke', style.labelHalo)
      .attr('stroke-width', sw + 2.5 / zoomK).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    n.select('.line').attr('d', d.line).attr('fill', 'none').attr('stroke', style.labelColor).attr('stroke-width', sw).attr('stroke-linecap', 'round');
    n.select('.head').attr('d', d.head).attr('fill', style.labelColor).attr('stroke', 'none');
  });

  lg.selectAll('text')
    .data(shown, (it) => it.f.id)
    .join('text')
    .attr('transform', (it) => `translate(${it.box.x + it.box.w / 2},${it.box.y + it.box.h / 2})`)
    .attr('text-anchor', 'middle')
    .attr('font-size', fs)
    .attr('font-family', style.font)
    .attr('fill', style.labelColor)
    .attr('stroke', style.labelHalo)
    .attr('stroke-width', 2.5 / zoomK)
    .attr('paint-order', 'stroke')
    .attr('stroke-linejoin', 'round')
    .selectAll('tspan')
    .data((it) => it.lines.map((t, i, a) => ({ t, i, n: a.length })))
    .join('tspan')
    .attr('x', 0)
    .attr('dy', (d) => (d.i === 0 ? `${0.35 - (d.n - 1) * 0.55}em` : '1.1em'))
    .attr('font-weight', (d) => (d.n > 1 && d.i === 1 ? 600 : null))
    .text((d) => d.t);
  lg.selectAll('g.leader').lower();
}

/**
 * Draws the legend at the origin of `g`; returns its size.
 * `uid` keeps gradient ids unique when several legends share a document.
 */
export function drawLegend(g, { scale, stops, title, fmt, style, showNoData, width = 260, uid = 'lg' }) {
  g.selectAll('*').remove();
  const font = style.font;
  const pad = 12;
  const inner = g.append('g').attr('transform', `translate(${pad},${pad})`);
  let y = 0;

  if (title) {
    inner.append('text').attr('y', 12).attr('font-size', 13).attr('font-weight', 600)
      .attr('font-family', font).attr('fill', style.text).text(title);
    y += 22;
  }

  if (scale.kind === 'continuous') {
    const id = `${uid}-grad`;
    const grad = g.append('defs').append('linearGradient').attr('id', id);
    const sorted = [...stops].sort((a, b) => a.p - b.p);
    grad.selectAll('stop').data(sorted).join('stop')
      .attr('offset', (s) => `${s.p * 100}%`).attr('stop-color', (s) => s.c);
    inner.append('rect').attr('y', y).attr('width', width).attr('height', 12).attr('rx', 2)
      .attr('fill', `url(#${id})`).attr('stroke', 'rgba(0,0,0,.15)');
    const x = d3.scaleLinear().domain([scale.min, scale.max]).range([0, width]);
    const ticks = x.ticks(width > 220 ? 5 : 3).filter((t) => t > scale.min && t < scale.max);
    const all = [scale.min, ...ticks, scale.max];
    const tg = inner.append('g').attr('transform', `translate(0,${y + 12})`);
    tg.selectAll('line').data(all).join('line').attr('x1', x).attr('x2', x).attr('y2', 4).attr('stroke', style.text).attr('opacity', 0.5);
    // Always label both ends, then add inner ticks that do not collide with labels already placed.
    const halfW = (t) => (fmt(t).length * 6.3) / 2;
    const spans = [[0, halfW(scale.min) * 2], [width - halfW(scale.max) * 2, width]];
    const innerTicks = ticks.filter((t) => {
      const a = x(t) - halfW(t) - 6, b = x(t) + halfW(t) + 6;
      if (spans.some(([l, r]) => a < r && b > l)) return false;
      spans.push([a, b]);
      return true;
    });
    const labelled = [scale.min, ...innerTicks, scale.max];
    tg.selectAll('text').data(labelled).join('text')
      .attr('x', x).attr('y', 16).attr('font-size', 11).attr('font-family', font).attr('fill', style.text)
      .attr('text-anchor', (t, i) => (i === 0 ? 'start' : i === labelled.length - 1 ? 'end' : 'middle'))
      .text(fmt);
    y += 12 + 22;
  } else {
    const rows = inner.append('g').attr('transform', `translate(0,${y})`);
    scale.bins.forEach((b, i) => {
      const r = rows.append('g').attr('transform', `translate(0,${i * 20})`);
      r.append('rect').attr('width', 22).attr('height', 14).attr('rx', 2).attr('fill', b.color).attr('stroke', 'rgba(0,0,0,.15)');
      r.append('text').attr('x', 30).attr('y', 11).attr('font-size', 11).attr('font-family', font).attr('fill', style.text)
        .text(`${fmt(b.from)} – ${fmt(b.to)}`);
    });
    y += scale.bins.length * 20;
  }

  if (showNoData) {
    const r = inner.append('g').attr('transform', `translate(0,${y + 2})`);
    r.append('rect').attr('width', 22).attr('height', 14).attr('rx', 2).attr('fill', style.noData).attr('stroke', 'rgba(0,0,0,.15)');
    r.append('text').attr('x', 30).attr('y', 11).attr('font-size', 11).attr('font-family', font).attr('fill', style.text).text('No data');
    y += 20;
  }

  const longest = scale.kind === 'continuous' ? 0 : d3.max(scale.bins, (b) => `${fmt(b.from)} – ${fmt(b.to)}`.length);
  const bodyW = scale.kind === 'continuous' ? width : 30 + longest * 6.4;
  const titleW = title ? title.length * 7.9 : 0;
  const w = Math.max(bodyW, titleW, 90) + pad * 2;
  const h = y + pad * 2 - 4;
  g.insert('rect', ':first-child').attr('width', w).attr('height', h).attr('rx', 6)
    .attr('fill', style.legendBg).attr('fill-opacity', style.legendOpacity).attr('stroke', 'rgba(0,0,0,.08)');
  return { width: w, height: h };
}
