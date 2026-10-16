import * as d3 from 'd3';
import { makeProjection, EUROPE_FRAME, drawCountries, drawLegend } from './render.js';

/**
 * Builds a standalone SVG document string.
 * `view` (optional) = { projection, transform, width, height } of the on-screen map,
 * used when exporting the current zoom instead of the whole of Europe.
 */
export function buildSvg({ features, values, scale, stops, style, fmt, legend, labels, ex, view }) {
  const W = Math.max(300, +ex.width || 1600);
  const H = Math.max(300, +ex.height || 1200);
  const margin = Math.round(W * 0.025);
  const font = style.font;
  const s = W / 1600; // type scale relative to a 1600px-wide export

  const svg = d3.create('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', W).attr('height', H)
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('font-family', font);

  const bg = ex.background === 'white' ? '#ffffff' : ex.background === 'none' ? null : style.sea;
  if (bg) svg.append('rect').attr('width', W).attr('height', H).attr('fill', bg);

  // Map area
  const mx = 0, my = 0, mw = W, mh = H;
  let projection = makeProjection();
  if (view && ex.view === 'current') {
    // Visible rectangle of the on-screen map in un-zoomed projected coordinates, fitted into the export area.
    const t = view.transform;
    const rx = -t.x / t.k, ry = -t.y / t.k, rw = view.width / t.k, rh = view.height / t.k;
    const k = Math.max(mw / rw, mh / rh); // cover, so the export shows no blank margins
    const ox = mx + (mw - rw * k) / 2, oy = my + (mh - rh * k) / 2;
    const [tx, ty] = view.projection.translate();
    projection.scale(view.projection.scale() * k).translate([(tx - rx) * k + ox, (ty - ry) * k + oy]);
  } else {
    projection.fitExtent([[mx + margin, my + margin * 0.5], [mx + mw - margin, my + mh - margin * 0.5]], EUROPE_FRAME);
  }

  const defs = svg.append('defs');
  defs.append('clipPath').attr('id', 'map-clip').append('rect').attr('x', mx).attr('y', my).attr('width', mw).attr('height', mh);
  const mapG = svg.append('g').attr('id', 'countries').attr('clip-path', 'url(#map-clip)');

  // Legend first, so floating labels can keep clear of it.
  const obstacles = [];
  if (ex.legend && legend.position !== 'none') {
    const lg = svg.append('g').attr('id', 'legend');
    const size = drawLegend(lg, { scale, stops, title: legend.title, fmt, style, showNoData: legend.showNoData, width: 300, uid: 'export' });
    const sc = Math.max(1, s * 1.15);
    const lw = size.width * sc, lh = size.height * sc;
    const x = legend.position.includes('r') ? W - margin - lw : margin;
    const y = legend.position.includes('t') ? my + margin : my + mh - margin * 0.6 - lh;
    lg.attr('transform', `translate(${x},${y}) scale(${sc})`);
    obstacles.push({ x, y, w: lw, h: lh });
  }

  drawCountries(mapG, {
    features, projection, values, scale, style, fmt,
    labelMode: labels.mode, labelSize: labels.size * Math.max(1, s) * 1.25,
    view: { x: mx + 4, y: my + 4, w: mw - 8, h: mh - 8 }, obstacles,
  });
  mapG.selectAll('path.country').each(function (f) {
    d3.select(this).attr('id', f.id).append('title').text(`${f.properties.name}: ${fmt(values[f.id])}`);
  });
  mapG.selectAll('path.country').attr('data-id', null).attr('class', null);

  const node = svg.node();
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(node);
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function svgToPng(svgString, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not render SVG'));
    img.src = url;
  });
}
