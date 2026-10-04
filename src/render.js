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
export function drawCountries(g, { features, projection, values, scale, style, fmt, labelMode, labelSize, zoomK = 1 }) {
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

  const labels = labelMode === 'none' ? [] : features.filter((f) => {
    if (labelMode !== 'name' && !Number.isFinite(values[f.id])) return false;
    // Skip labels for countries too small to hold one at this zoom.
    return path.area(f) * zoomK * zoomK > 900 * (labelSize / 10) ** 2;
  });

  const text = (f) => {
    const name = f.properties.name;
    const v = fmt(values[f.id]);
    if (labelMode === 'name') return [name];
    if (labelMode === 'value') return [v];
    return Number.isFinite(values[f.id]) ? [name, v] : [name];
  };

  const lg = g.selectAll('g.labels').data([0]).join('g').attr('class', 'labels').attr('pointer-events', 'none');
  lg.selectAll('text')
    .data(labels, (f) => f.id)
    .join('text')
    .attr('transform', (f) => {
      const p = projection([f.properties.lx, f.properties.ly]) || path.centroid(f);
      return `translate(${p[0]},${p[1]})`;
    })
    .attr('text-anchor', 'middle')
    .attr('font-size', labelSize / zoomK)
    .attr('font-family', style.font)
    .attr('fill', style.labelColor)
    .attr('stroke', style.labelHalo)
    .attr('stroke-width', 2.5 / zoomK)
    .attr('paint-order', 'stroke')
    .attr('stroke-linejoin', 'round')
    .selectAll('tspan')
    .data((f) => text(f).map((t, i, a) => ({ t, i, n: a.length })))
    .join('tspan')
    .attr('x', 0)
    .attr('dy', (d) => (d.i === 0 ? `${0.35 - (d.n - 1) * 0.55}em` : '1.1em'))
    .attr('font-weight', (d) => (d.n > 1 && d.i === 1 ? 600 : null))
    .text((d) => d.t);
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
