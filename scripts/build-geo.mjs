// Builds src/data/europe.topo.json (the whole world, used by the EU map) from Natural Earth 1:10m admin-0 countries
// (German point-of-view edition, which follows EU-recognised borders:
// Crimea as part of Ukraine, Kosovo shown separately, Cyprus undivided).
//
// Source: https://github.com/nvkelso/natural-earth-vector (geojson/ne_10m_admin_0_countries_deu.geojson)
// Usage: node scripts/build-geo.mjs [path/to/ne_10m_admin_0_countries_deu.geojson]
import fs from 'node:fs';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';

const src = process.argv[2] || 'raw/ne_10m_admin_0_countries_deu.geojson';
const world = JSON.parse(fs.readFileSync(src, 'utf8'));

// Every country in the world is kept, so the map can be zoomed out to the whole globe.
// Display-name overrides for current official short names.
const RENAME = { CZE: 'Czechia', TUR: 'Türkiye', MKD: 'North Macedonia', VAT: 'Vatican City' };
const LANGS = ['DE', 'FR', 'IT', 'ES', 'PT', 'NL', 'PL', 'SV', 'HU', 'EL', 'RU', 'UK', 'TR'];

const keep = world.features;

const iso = (p, k) => (p[k] && !String(p[k]).startsWith('-99') ? p[k] : null);
const isoOf = (p) => iso(p, 'ISO_A3_EH') || iso(p, 'ISO_A3');
const isoCount = new Map();
for (const f of keep) isoCount.set(isoOf(f.properties), (isoCount.get(isoOf(f.properties)) || 0) + 1);

const features = keep.map((f) => {
  const p = f.properties;
  const isoId = isoOf(p);
  // Outlying territories share their country's ISO code (Clipperton Island is FRA): give them their own id,
  // so they don't take the country's value or name.
  const outlying = isoId && isoCount.get(isoId) > 1 && p.HOMEPART !== 1;
  const id = outlying ? p.ADM0_A3 : isoId || p.ADM0_A3;
  const names = new Set([RENAME[id], p.NAME_EN, p.NAME, p.ADMIN, p.NAME_LONG, p.FORMAL_EN, p.NAME_SORT, p.NAME_CIAWF, p.GEOUNIT, p.BRK_NAME]);
  if (p.NAME_ALT) String(p.NAME_ALT).split('|').forEach((n) => names.add(n));
  for (const l of LANGS) names.add(p['NAME_' + l]);
  return {
    type: 'Feature',
    id,
    properties: {
      name: RENAME[id] || p.NAME_EN || p.NAME,
      iso2: outlying ? null : iso(p, 'ISO_A2_EH') || iso(p, 'ISO_A2'),
      iso3: outlying ? null : id,
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
const minWeight = quantile(topo, 0.1);
// Keep full 1:10m detail in and around Europe; simplify the rest of the world much harder to keep the file small.
const BOX = { w: -32, s: 30, e: 50, n: 82 };
for (const arc of topo.arcs) {
  for (const p of arc) {
    const [lon, lat] = p; // presimplify leaves arcs in lon/lat with the weight as p[2]
    if (lon < BOX.w || lon > BOX.e || lat < BOX.s || lat > BOX.n) p[2] *= 0.02;
  }
}
topo = simplify(topo, minWeight);

fs.writeFileSync('src/data/europe.topo.json', JSON.stringify(topo));
console.log(`${features.length} countries, ${(fs.statSync('src/data/europe.topo.json').size / 1024).toFixed(0)} KB`);
console.log(features.map((f) => `${f.id}:${f.properties.name}`).join(', '));
