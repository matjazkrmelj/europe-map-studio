// Builds src/data/europe.topo.json from Natural Earth 1:10m admin-0 countries
// (German point-of-view edition, which follows EU-recognised borders:
// Crimea as part of Ukraine, Kosovo shown separately, Cyprus undivided).
//
// Source: https://github.com/nvkelso/natural-earth-vector (geojson/ne_10m_admin_0_countries_deu.geojson)
// Usage: node scripts/build-geo.mjs [path/to/ne_10m_admin_0_countries_deu.geojson]
import fs from 'node:fs';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { geoBounds } from 'd3';

const src = process.argv[2] || 'raw/ne_10m_admin_0_countries_deu.geojson';
const world = JSON.parse(fs.readFileSync(src, 'utf8'));

// Anything touching this lon/lat window is kept (Europe plus surrounding context).
const BOX = { w: -32, s: 30, e: 50, n: 82 };
// Display-name overrides for current official short names.
const RENAME = { CZE: 'Czechia', TUR: 'Türkiye', MKD: 'North Macedonia', VAT: 'Vatican City' };
const LANGS = ['DE', 'FR', 'IT', 'ES', 'PT', 'NL', 'PL', 'SV', 'HU', 'EL', 'RU', 'UK', 'TR'];

const EXCLUDE = new Set(['USA']); // Alaska crosses the antimeridian but is not wanted
const keep = world.features.filter((f) => {
  if (EXCLUDE.has(f.properties.ADM0_A3)) return false;
  let [[w, s], [e, n]] = geoBounds(f);
  if (w > e) [w, e] = [-180, 180]; // crosses the antimeridian (Russia)
  return !(e < BOX.w || w > BOX.e || n < BOX.s || s > BOX.n);
});

const iso = (p, k) => (p[k] && !String(p[k]).startsWith('-99') ? p[k] : null);

const features = keep.map((f) => {
  const p = f.properties;
  const id = iso(p, 'ISO_A3_EH') || iso(p, 'ISO_A3') || p.ADM0_A3;
  const names = new Set([RENAME[id], p.NAME_EN, p.NAME, p.ADMIN, p.NAME_LONG, p.FORMAL_EN, p.NAME_SORT, p.NAME_CIAWF, p.GEOUNIT, p.BRK_NAME]);
  if (p.NAME_ALT) String(p.NAME_ALT).split('|').forEach((n) => names.add(n));
  for (const l of LANGS) names.add(p['NAME_' + l]);
  return {
    type: 'Feature',
    id,
    properties: {
      name: RENAME[id] || p.NAME_EN || p.NAME,
      iso2: iso(p, 'ISO_A2_EH') || iso(p, 'ISO_A2'),
      iso3: id,
      continent: p.CONTINENT,
      region: p.SUBREGION,
      lx: p.LABEL_X,
      ly: p.LABEL_Y,
      names: [...names].filter(Boolean),
    },
    geometry: f.geometry,
  };
});

let topo = topology({ countries: { type: 'FeatureCollection', features } }, 1e6);
topo = presimplify(topo);
topo = simplify(topo, quantile(topo, 0.1));

fs.writeFileSync('src/data/europe.topo.json', JSON.stringify(topo));
console.log(`${features.length} countries, ${(fs.statSync('src/data/europe.topo.json').size / 1024).toFixed(0)} KB`);
console.log(features.map((f) => `${f.id}:${f.properties.name}`).join(', '));
