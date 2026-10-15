// Country name matching: CSV labels -> map feature ids (ISO 3166 alpha-3, KOS for Kosovo).

// Extra aliases on top of the multilingual names baked into the map data.
const ALIASES = {
  GBR: ['UK', 'U.K.', 'Great Britain', 'Britain', 'GB'],
  GRC: ['EL', 'Hellas', 'Ellada', 'Hellenic Republic'],
  KOS: ['XK', 'XKX', 'Kosovo under UNSCR 1244', 'Kosovo under UNSCR 1244/99', 'Kosova'],
  CZE: ['Czech Republic', 'Czech Rep', 'Cesko', 'Ceska republika'],
  NLD: ['Holland', 'The Netherlands', 'Nederland'],
  MKD: ['Macedonia', 'FYROM', 'FYR Macedonia', 'Former Yugoslav Republic of Macedonia', 'Republic of North Macedonia', 'Makedonija', 'Severna Makedonija'],
  TUR: ['Turkey', 'Turkiye', 'Türkiye', 'Republic of Turkey'],
  RUS: ['Russian Federation', 'Rossiya'],
  MDA: ['Republic of Moldova', 'Moldova Republic of', 'Moldavia'],
  BIH: ['Bosnia', 'Bosnia Herzegovina', 'Bosnia-Herzegovina', 'BiH', 'Bosna i Hercegovina'],
  VAT: ['Holy See', 'Vatican', 'Vatican City State'],
  BLR: ['Byelorussia', 'Belorussia', 'Belarus Republic'],
  SVK: ['Slovak Republic', 'Slovensko'],
  IRL: ['Republic of Ireland', 'Eire', 'Éire'],
  DEU: ['Deutschland', 'Federal Republic of Germany', 'Germany including former GDR'],
  AUT: ['Österreich'],
  CHE: ['Schweiz', 'Suisse', 'Svizzera', 'Swiss Confederation'],
  HRV: ['Hrvatska'],
  SRB: ['Srbija', 'Serbia Republic'],
  SVN: ['Slovenija'],
  POL: ['Polska'],
  HUN: ['Magyarország'],
  ROU: ['România', 'Rumania', 'Roumania'],
  BGR: ['Bulgaria', 'Balgariya'],
  ALB: ['Shqipëria', 'Shqiperia'],
  MNE: ['Crna Gora'],
  FIN: ['Suomi'],
  SWE: ['Sverige'],
  NOR: ['Norge', 'Noreg'],
  DNK: ['Danmark'],
  ISL: ['Ísland'],
  LTU: ['Lietuva'],
  LVA: ['Latvija'],
  EST: ['Eesti'],
  GEO: ['Sakartvelo'],
  ARM: ['Hayastan'],
  AZE: ['Azərbaycan'],
  BEL: ['Belgique', 'België', 'Belgien'],
  LUX: ['Lëtzebuerg', 'Luxemburg'],
  ITA: ['Italia'],
  ESP: ['España'],
  CYP: ['Kypros', 'Kıbrıs'],
  UKR: ['Ukraina'],
  LIE: ['Liechtenstein'],
  MCO: ['Monaco'],
  SMR: ['San Marino'],
  AND: ['Andorra'],
};

// Generic words removed when building the "core" key ("Republic of Moldova" -> "moldova").
const STOP = new Set(['the', 'republic', 'of', 'federation', 'kingdom', 'grand', 'duchy', 'principality', 'state', 'democratic', 'federal', 'islamic', 'arab', 'and', 'rep']);

export function normalize(s) {
  return String(s ?? '')
    .replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/[œŒ]/g, 'oe')
    .replace(/[łŁ]/g, 'l').replace(/[đĐ]/g, 'd').replace(/ı/g, 'i').replace(/[þÞ]/g, 'th')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const core = (n) => n.split(' ').filter((w) => !STOP.has(w)).join(' ');

// "Germany (until 1990 former territory of the FRG)" / "Kosovo*" / "Moldova, Republic of" variants.
function variants(raw) {
  const s = String(raw ?? '').trim();
  const out = new Set([s]);
  const noParen = s.replace(/\(.*?\)|\[.*?\]/g, '').replace(/[*†‡¹²³]+/g, '').trim();
  out.add(noParen);
  const m = noParen.match(/^(.+?),\s*(.+)$/);
  if (m) {
    out.add(`${m[2]} ${m[1]}`);
    out.add(m[1]);
  }
  return [...out].filter(Boolean);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const similarity = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

export function createMatcher(features) {
  const full = new Map(); // normalized name -> Set(id)
  const cores = new Map();
  const codes = new Map(); // upper-case ISO code -> id
  const all = []; // [normalized, id] for fuzzy search

  const add = (map, key, id) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };

  for (const f of features) {
    const id = f.id;
    const p = f.properties;
    const names = [...p.names, ...(ALIASES[id] || [])];
    for (const name of names) {
      const n = normalize(name);
      add(full, n, id);
      add(cores, core(n), id);
      all.push([n, id]);
    }
    for (const c of [p.iso2, p.iso3, id, ...(ALIASES[id] || []).filter((a) => /^[A-Z]{2,3}$/.test(a))]) {
      if (c) codes.set(String(c).toUpperCase(), id);
    }
  }

  const unique = (set) => (set && set.size === 1 ? [...set][0] : null);

  /**
   * @param {string} label   value from the CSV
   * @param {object} learned normalized label -> id, from earlier manual choices
   * @returns {{id: string|null, method: string, score: number, suggestions: string[]}}
   */
  function match(label, learned = {}) {
    const raw = String(label ?? '').trim();
    if (!raw) return { id: null, method: 'empty', score: 0, suggestions: [] };

    const n0 = normalize(raw);
    if (learned[n0]) return { id: learned[n0], method: 'learned', score: 1, suggestions: [] };

    if (/^[A-Za-z]{2,3}$/.test(raw) && codes.has(raw.toUpperCase())) {
      return { id: codes.get(raw.toUpperCase()), method: 'code', score: 1, suggestions: [] };
    }

    for (const v of variants(raw)) {
      const n = normalize(v);
      const id = unique(full.get(n)) || unique(cores.get(core(n)));
      if (id) return { id, method: 'name', score: 1, suggestions: [] };
    }

    // Fuzzy: best similarity across every known name.
    const n = normalize(variants(raw)[1] || raw);
    const best = new Map();
    for (const [name, id] of all) {
      const s = Math.max(similarity(n, name), similarity(core(n), core(name)));
      if (s > (best.get(id) ?? 0)) best.set(id, s);
    }
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
    const [topId, topScore] = ranked[0] || [null, 0];
    const secondScore = ranked[1]?.[1] ?? 0;
    const suggestions = ranked.slice(0, 5).filter(([, s]) => s >= 0.5).map(([id]) => id);
    if (topScore >= 0.8 && topScore - secondScore >= 0.1) {
      return { id: topId, method: 'fuzzy', score: topScore, suggestions };
    }
    return { id: null, method: 'none', score: topScore, suggestions };
  }

  return { match };
}

/** Parses "1 234,5", "1,234.5", "12,5 %", "€ 3.2", "45.1 p" (Eurostat flag), ":" (missing). */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim();
  if (!s || /^[:\-–—.]+$/.test(s) || /^(n\/?a|na|null|nan|none)$/i.test(s)) return null;
  s = s.replace(/[\s  ']/g, '').replace(/[%€$£¥]/g, '').replace(/[a-z]+$/i, '');
  if (!/\d/.test(s)) return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const x = Number(s);
  if (!Number.isFinite(x)) return null;
  return neg ? -x : x;
}

/**
 * EU aggregate rows ("EU", "EU27", "EU27_2020", "European Union - 27 countries (from 2020)", "EU-28").
 * Returns a rank (lower = preferred: EU27 first) or -1 when the label is not an EU total.
 */
export function euAggregateRank(label) {
  const n = normalize(label);
  if (!/^(eu|european union)( |$|2)/.test(n) || /euro area|eurozone/.test(n)) return -1;
  if (/\b(eu ?)?27\b|eu27/.test(n)) return 0;
  if (/\b(eu ?)?28\b|eu28/.test(n)) return 2;
  return /^(eu|european union)$/.test(n) || /average|total|countries/.test(n) ? 1 : -1;
}
