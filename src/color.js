import * as d3 from 'd3';

export const PRESETS = {
  Blues: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
  Greens: ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'],
  Reds: ['#fff5f0', '#fcbba1', '#fb6a4a', '#cb181d', '#67000d'],
  Purples: ['#fcfbfd', '#dadaeb', '#9e9ac8', '#6a51a3', '#3f007d'],
  'Yellow–Orange–Red': ['#ffffcc', '#fed976', '#fd8d3c', '#e31a1c', '#800026'],
  Viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  Magma: ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
  'Red–Yellow–Green': ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#91cf60', '#1a9850'],
  'Red–Blue (diverging)': ['#b2182b', '#ef8a62', '#f7f7f7', '#67a9cf', '#2166ac'],
  Spectral: ['#9e0142', '#f46d43', '#fee08b', '#e6f598', '#66c2a5', '#5e4fa2'],
};

export const presetStops = (name) => {
  const cs = PRESETS[name];
  return cs.map((c, i) => ({ c, p: i / (cs.length - 1) }));
};

export const sortStops = (stops) => [...stops].sort((a, b) => a.p - b.p);

/** Color of the gradient at t in [0, 1]. */
export function gradientAt(stops, t) {
  const s = sortStops(stops);
  if (t <= s[0].p) return s[0].c;
  if (t >= s[s.length - 1].p) return s[s.length - 1].c;
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].p) {
      const span = s[i].p - s[i - 1].p || 1;
      return d3.interpolateLab(s[i - 1].c, s[i].c)((t - s[i - 1].p) / span);
    }
  }
  return s[s.length - 1].c;
}

export const cssGradient = (stops) =>
  `linear-gradient(90deg, ${sortStops(stops).map((s) => `${s.c} ${(s.p * 100).toFixed(1)}%`).join(', ')})`;

/**
 * @param {number[]} values data values
 * @param {object} cfg  { mode: 'continuous'|'equal'|'quantile', classes, domainAuto, min, max, nice }
 */
export function buildScale(stops, values, cfg) {
  const vals = values.filter(Number.isFinite).sort(d3.ascending);
  let min = cfg.domainAuto ? (vals[0] ?? 0) : +cfg.min;
  let max = cfg.domainAuto ? (vals[vals.length - 1] ?? 1) : +cfg.max;
  if (cfg.domainAuto && cfg.nice && vals.length) [min, max] = d3.scaleLinear().domain([min, max]).nice().domain();
  if (min === max) max = min + 1;
  const norm = (v) => Math.max(0, Math.min(1, (v - min) / (max - min)));

  if (cfg.mode === 'continuous') {
    return { kind: 'continuous', min, max, color: (v) => gradientAt(stops, norm(v)) };
  }

  const n = Math.max(2, Math.min(12, cfg.classes | 0));
  let breaks;
  if (cfg.mode === 'quantile' && vals.length) {
    breaks = d3.range(1, n).map((i) => d3.quantileSorted(vals, i / n));
  } else {
    breaks = d3.range(1, n).map((i) => min + ((max - min) * i) / n);
  }
  const colors = d3.range(n).map((i) => gradientAt(stops, i / (n - 1)));
  const bins = colors.map((color, i) => ({
    color,
    from: i === 0 ? min : breaks[i - 1],
    to: i === n - 1 ? max : breaks[i],
  }));
  const color = (v) => {
    const i = d3.bisectRight(breaks, v);
    return colors[i];
  };
  return { kind: 'classes', min, max, bins, color };
}
