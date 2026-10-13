import '../style.css';
import './votes.css';
import { download } from '../export.js';

// ---------- Groups, in the order of the reference graphic ----------
const GROUPS = [
  { id: "Renew",     abbr: "Renew",  color: "#12B3E8", label: "LIBERALS" },
  { id: "S&D",       abbr: "S&D",    color: "#E3242B", label: "SOCIALISTS & DEMOCRATS" },
  { id: "Verts/ALE", abbr: "Greens", color: "#1E9A3B", label: "GREENS" },
  { id: "The Left",  abbr: "Left",   color: "#5B6878", label: "FAR-LEFT" },
  { id: "PPE",       abbr: "EPP",    color: "#24589B", label: "CONSERVATIVES" },
  { id: "ECR",       abbr: "ECR",    color: "#1F6FB5", label: "FAR-RIGHT" },
  { id: "PfE",       abbr: "PfE",    color: "#2B2C72", label: "FAR-RIGHT" },
  { id: "ESN",       abbr: "ESN",    color: "#1C2E4D", label: "FAR-RIGHT" },
];
const GROUP_BY_ID = Object.fromEntries(GROUPS.map(g => [g.id, g]));
const EXCLUDED = new Set(["NI"]);
const LS_KEY = "votebars.settings.v2";
const DEFAULT_COLORS = { yes: "#00ADEE", no: "#222222", ink: "#2A2A2A" };
const COLOR_FIELDS = [["yes", "For bars"], ["no", "Against bars"], ["ink", "Labels under bars"]];
const PRESETS = [
  { name: "Renew", yes: "#00ADEE", no: "#222222" },
  { name: "Green / red", yes: "#1E9A5A", no: "#D7263D" },
  { name: "Blue / orange", yes: "#2563EB", no: "#F08A24" },
  { name: "Purple / grey", yes: "#7B2FF7", no: "#5B6470" },
];

// Sample: counts from PV-10-2026-10-05-RCV_EN.xml, shown until a file is loaded.
const SAMPLE = {
  fileName: "PV-10-2026-10-05-RCV_EN.xml (example)",
  votes: [{
    id: "197673", date: "2026-10-05 17:14:59",
    title: "Monday’s agenda – Request by the ECR Group – Escalating student riots in France",
    totals: { for: 217, against: 198, abst: 4 },
    counted: { for: 217, against: 198, abst: 4 },
    for: { ECR: 41, ESN: 9, NI: 8, PPE: 101, PfE: 56, Renew: 2 },
    against: { NI: 7, Renew: 41, "S&D": 73, "The Left": 31, "Verts/ALE": 46 },
    abst: { NI: 2, Renew: 2 },
  }],
};

// ---------- State ----------
let data = SAMPLE;
let current = 0;
const defaults = () => ({
  order: GROUPS.map(g => g.id),
  labels: Object.fromEntries(GROUPS.map(g => [g.id, g.label])),
  abbr: Object.fromEntries(GROUPS.map(g => [g.id, g.abbr])),
  colors: { ...DEFAULT_COLORS },
});
let settings = loadSettings();
let labels = settings.labels;
let extraGroups = [];   // group ids found in a file but not in GROUPS

function loadSettings() {
  const d = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    const order = Array.isArray(s.order) ? s.order.filter(id => GROUP_BY_ID[id]) : [];
    d.order.forEach(id => { if (!order.includes(id)) order.push(id); });
    return { order, labels: Object.assign(d.labels, s.labels), abbr: Object.assign(d.abbr, s.abbr), colors: Object.assign(d.colors, s.colors) };
  } catch { return d; }
}
function saveLabels() { try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch {} }

// ---------- XML parsing ----------
function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("This file isn't valid XML.");
  const results = [...doc.getElementsByTagName("RollCallVote.Result")];
  if (!results.length) throw new Error("No roll-call votes found. Use the European Parliament RCV XML (PV-…-RCV_EN.xml).");
  const kid = (el, tag) => [...el.children].find(c => c.tagName === tag);
  return results.map(r => {
    const side = tag => {
      const el = kid(r, tag); const groups = {}; let n = 0;
      if (el) for (const g of el.children) {
        if (g.tagName !== "Result.PoliticalGroup.List") continue;
        const c = [...g.children].filter(m => m.tagName === "PoliticalGroup.Member.Name").length;
        groups[g.getAttribute("Identifier")] = c; n += c;
      }
      return { groups, n, declared: el ? Number(el.getAttribute("Number")) : 0 };
    };
    const f = side("Result.For"), a = side("Result.Against"), o = side("Result.Abstention");
    const desc = kid(r, "RollCallVote.Description.Text");
    return {
      id: r.getAttribute("Identifier"), date: r.getAttribute("Date") || "",
      title: (desc ? desc.textContent : "").replace(/\s+/g, " ").trim() || "Untitled vote",
      totals: { for: f.declared, against: a.declared, abst: o.declared },
      counted: { for: f.n, against: a.n, abst: o.n },
      for: f.groups, against: a.groups, abst: o.groups,
    };
  });
}

// ---------- Fonts ----------
// Gilroy is a licensed font, so it is not bundled: the page uses the copy installed on this
// computer, or font files the user loads (kept in this browser only). The exported SVG names the
// fonts, so design tools render them wherever Gilroy is installed.
const LABEL_FONT = "Gilroy-Light, 'Gilroy Light', Arial, sans-serif";
const NUM_FONT = "Gilroy-ExtraBold, 'Gilroy ExtraBold', 'Arial Black', Arial, sans-serif";
const FONTS = [
  { key: "light", family: "Gilroy-Light", label: "Gilroy Light", use: "labels", local: ["Gilroy-Light", "Gilroy Light"], match: /light/i },
  { key: "xbold", family: "Gilroy-ExtraBold", label: "Gilroy ExtraBold", use: "numbers", local: ["Gilroy-ExtraBold", "Gilroy ExtraBold", "Gilroy Extra Bold"], match: /extra.?bold|xbold|black|heavy/i },
];
const fontState = {};   // key -> "installed" | "loaded" | "missing"

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("infographic-fonts", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("fonts");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("fonts", mode); const req = fn(tx.objectStore("fonts"));
    tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error);
  });
}
async function addFace(f, source) {
  const face = new FontFace(f.family, source);
  await face.load();
  document.fonts.add(face);
}
async function initFonts() {
  for (const f of FONTS) {
    try { await addFace(f, f.local.map(n => `local("${n}")`).join(", ")); fontState[f.key] = "installed"; continue; } catch {}
    try {
      const buf = await idbOp("readonly", st => st.get(f.key));
      if (buf) { await addFace(f, buf); fontState[f.key] = "loaded"; continue; }
    } catch {}
    fontState[f.key] = "missing";
  }
  renderFontStatus(); renderChart();
}
async function loadFontFiles(files) {
  const done = [];
  for (const file of files) {
    const f = FONTS.find(x => x.match.test(file.name));
    if (!f) { setToast(`Couldn't tell which font ${file.name} is. Use files named like Gilroy-Light.ttf and Gilroy-ExtraBold.ttf.`, true); continue; }
    const buf = await file.arrayBuffer();
    try { await addFace(f, buf.slice(0)); } catch { setToast(`${file.name} isn't a font file this browser can read.`, true); continue; }
    try { await idbOp("readwrite", st => st.put(buf, f.key)); } catch {}
    fontState[f.key] = "loaded"; done.push(f.label);
  }
  renderFontStatus(); renderChart();
  if (done.length) setToast(`Loaded ${done.join(" and ")} for this browser.`);
}
function renderFontStatus() {
  const box = $("fontStatus"); if (!box) return;
  box.innerHTML = "";
  FONTS.forEach(f => {
    const st = fontState[f.key];
    const row = document.createElement("div"); row.className = "font-row";
    const name = document.createElement("span"); name.textContent = `${f.label} · ${f.use}`;
    const pill = document.createElement("span");
    pill.className = "pill " + (st === "missing" ? "warn" : "ok");
    pill.textContent = st === "installed" ? "installed" : st === "loaded" ? "loaded" : st === "missing" ? "not found" : "checking…";
    row.append(name, pill); box.appendChild(row);
  });
}

// ---------- Chart geometry (px, matches the 1080-wide reference) ----------
const W = 1080, ROW = 92, BAR_H = 42, R = 10, MAX_LEN = 417, LABEL_DY = 70;
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const numW = n => String(n).length * 12.5;
const allGroupIds = () => [...settings.order, ...extraGroups.filter(id => !settings.order.includes(id))];

function rowsFor(v) {
  return allGroupIds()
    .filter(id => !EXCLUDED.has(id))
    .map(id => ({ id, yes: v.for[id] || 0, no: v.against[id] || 0 }))
    .filter(r => r.yes || r.no);
}

function buildSVG(v, withGap) {
  const rows = rowsFor(v);
  const gap = withGap ? 136 : 28;
  const yesRight = W / 2 - 3 - gap / 2, noLeft = W / 2 - 3 + gap / 2;   // 469 / 605 with the logo gap
  const max = Math.max(1, ...rows.flatMap(r => [r.yes, r.no]));
  const k = MAX_LEN / max;
  const PAD = withGap ? 20 : 0;   // room for the circle above the first bar
  const H = rows.length * ROW + 8 + PAD;
  const yesC = settings.colors.yes, noC = settings.colors.no, ink = settings.colors.ink;
  const onYes = textOn(yesC), onNo = textOn(noC);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" >`);
  rows.forEach((r, i) => {
    const top = PAD + i * ROW, cy = top + BAR_H / 2 + 7, ly = top + LABEL_DY;
    const label = esc(labels[r.id] ?? r.id);
    out.push(`<g id="${esc(r.id.replace(/[^A-Za-z0-9]+/g, "-"))}">`);
    if (withGap) {
      const ab = String(settings.abbr[r.id] ?? r.id);
      const fs = ab.length <= 3 ? 26 : ab.length <= 5 ? 20 : ab.length <= 7 ? 15 : 12;
      out.push(`<circle cx="${W / 2 - 3}" cy="${top + BAR_H / 2}" r="40" fill="${(GROUP_BY_ID[r.id] || {}).color || "#5B6878"}"/>`);
      out.push(`<text x="${W / 2 - 3}" y="${top + BAR_H / 2 + fs * 0.36}" font-size="${fs}" font-family="${NUM_FONT}" fill="#FFFFFF" text-anchor="middle">${esc(ab)}</text>`);
    }
    if (r.yes) {
      const w = Math.max(6, r.yes * k), x = yesRight - w;
      out.push(`<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${BAR_H}" rx="${Math.min(R, w / 2).toFixed(1)}" fill="${yesC}"/>`);
      const inside = w >= numW(r.yes) + 30;
      out.push(inside
        ? `<text x="${(x + 12).toFixed(1)}" y="${cy}" font-size="20" font-family="${NUM_FONT}" fill="${onYes}">${r.yes}</text>`
        : `<text x="${(x - 10).toFixed(1)}" y="${cy}" font-size="20" font-family="${NUM_FONT}" fill="${ink}" text-anchor="end">${r.yes}</text>`);
      out.push(`<text x="${yesRight}" y="${ly}" font-size="20" font-family="${LABEL_FONT}" fill="${ink}" text-anchor="end">${label}</text>`);
    }
    if (r.no) {
      const w = Math.max(6, r.no * k);
      out.push(`<rect x="${noLeft}" y="${top}" width="${w.toFixed(1)}" height="${BAR_H}" rx="${Math.min(R, w / 2).toFixed(1)}" fill="${noC}"/>`);
      const inside = w >= numW(r.no) + 30;
      out.push(inside
        ? `<text x="${(noLeft + w - 12).toFixed(1)}" y="${cy}" font-size="20" font-family="${NUM_FONT}" fill="${onNo}" text-anchor="end">${r.no}</text>`
        : `<text x="${(noLeft + w + 10).toFixed(1)}" y="${cy}" font-size="20" font-family="${NUM_FONT}" fill="${ink}">${r.no}</text>`);
      out.push(`<text x="${noLeft}" y="${ly}" font-size="20" font-family="${LABEL_FONT}" fill="${ink}">${label}</text>`);
    }
    out.push(`</g>`);
  });
  out.push(`</svg>`);
  return out.join("\n");
}
// Black or white text, whichever reads better on the given bar colour (WCAG relative luminance).
function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#000000";
  const c = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(u => u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#000000" : "#FFFFFF";
}

// ---------- Rendering ----------
const $ = id => document.getElementById(id);
let currentSVG = "";

function renderVoteList() {
  const sel = $("vote");
  sel.innerHTML = "";
  data.votes.forEach((v, i) => {
    const o = document.createElement("option");
    o.value = i;
    const t = v.title.length > 70 ? v.title.slice(0, 68) + "…" : v.title;
    o.textContent = `${i + 1}. ${t}`;
    sel.appendChild(o);
  });
  sel.value = current;
  sel.disabled = data.votes.length < 2;
  $("fileName").textContent = data.fileName + (data.votes.length > 1 ? ` · ${data.votes.length} votes` : " · 1 vote");
}

let dragId = null;
function moveGroup(id, toIndex) {
  const ids = allGroupIds();
  const from = ids.indexOf(id);
  if (from < 0) return;
  ids.splice(from, 1);
  ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, id);
  settings.order = ids;
  saveLabels(); renderLabels(); renderChart();
}
function renderLabels() {
  const box = $("labels");
  box.innerHTML = "";
  const ids = allGroupIds();
  ids.forEach((id, idx) => {
    const slug = id.replace(/[^A-Za-z0-9]+/g, "-");
    const row = document.createElement("div");
    row.className = "lrow"; row.draggable = true; row.dataset.id = id;
    const grip = document.createElement("span"); grip.className = "grip"; grip.title = "Drag to reorder";
    grip.innerHTML = '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/></g></svg>';
    const ab = document.createElement("input");
    ab.type = "text"; ab.className = "abbr"; ab.id = "abbr-" + slug; ab.value = settings.abbr[id] ?? id;
    ab.setAttribute("aria-label", id + " abbreviation");
    ab.addEventListener("input", () => { settings.abbr[id] = ab.value; saveLabels(); renderChart(); });
    const inp = document.createElement("input");
    inp.type = "text"; inp.className = "lab"; inp.id = "lab-" + slug; inp.value = labels[id] ?? id;
    inp.setAttribute("aria-label", id + " label");
    inp.addEventListener("input", () => { labels[id] = inp.value; saveLabels(); renderChart(); });
    const mv = document.createElement("div"); mv.className = "mv";
    const up = document.createElement("button"); up.type = "button"; up.textContent = "▲"; up.title = "Move up"; up.disabled = idx === 0;
    const dn = document.createElement("button"); dn.type = "button"; dn.textContent = "▼"; dn.title = "Move down"; dn.disabled = idx === ids.length - 1;
    up.addEventListener("click", () => moveGroup(id, idx - 1));
    dn.addEventListener("click", () => moveGroup(id, idx + 1));
    mv.append(up, dn);
    row.title = id;
    row.append(grip, ab, inp, mv);

    // Inputs inside a draggable row: only start a drag from the handle.
    row.addEventListener("mousedown", e => { row.draggable = !!e.target.closest(".grip"); });
    row.addEventListener("dragstart", e => { dragId = id; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", id); } catch {} });
    row.addEventListener("dragend", () => { dragId = null; row.draggable = true; box.querySelectorAll(".lrow").forEach(r => r.classList.remove("dragging", "over-top", "over-bottom")); });
    row.addEventListener("dragover", e => {
      if (!dragId || dragId === id) return;
      e.preventDefault();
      const after = e.offsetY > row.offsetHeight / 2 || e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      row.classList.toggle("over-bottom", after); row.classList.toggle("over-top", !after);
    });
    row.addEventListener("dragleave", () => row.classList.remove("over-top", "over-bottom"));
    row.addEventListener("drop", e => {
      e.preventDefault();
      if (!dragId || dragId === id) return;
      const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      const order = allGroupIds().filter(x => x !== dragId);
      let to = order.indexOf(id) + (after ? 1 : 0);
      const moving = dragId; dragId = null;
      moveGroup(moving, to);
    });
    box.appendChild(row);
  });
}

function badge(text, cls) { const b = document.createElement("span"); b.className = "badge " + cls; b.textContent = text; return b; }

const SIDES = [["for", "For"], ["against", "Against"], ["abst", "Abstained"]];
function splitHTML(v, id) {
  const f = v.for[id] || 0, a = v.against[id] || 0, o = v.abst[id] || 0, t = f + a + o || 1;
  return `<div class="split" title="${f} for · ${a} against · ${o} abstained"><i style="width:${f / t * 100}%;background:${settings.colors.yes}"></i><i style="width:${a / t * 100}%;background:${settings.colors.no}"></i><i style="width:${o / t * 100}%;background:var(--warn)"></i></div>`;
}
function recomputeTotals(v) {
  for (const [k] of SIDES) v.totals[k] = Object.values(v[k]).reduce((s, n) => s + (n || 0), 0);
}
function renderTable(v) {
  const tb = $("tbody");
  tb.innerHTML = "";
  [...allGroupIds(), "NI"].forEach(id => {
    const tr = document.createElement("tr");
    if (EXCLUDED.has(id)) tr.className = "dim";
    const name = document.createElement("td"); name.className = "gname";
    const b = document.createElement("b"); b.textContent = id; name.appendChild(b);
    const sm = document.createElement("small"); sm.textContent = EXCLUDED.has(id) ? "not drawn" : (labels[id] ?? ""); name.appendChild(sm);
    tr.appendChild(name);
    const sp = document.createElement("td");
    SIDES.forEach(([k, lbl]) => {
      const td = document.createElement("td");
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.className = "num";
      inp.id = `n-${k}-${id.replace(/[^A-Za-z0-9]+/g, "-")}`;
      inp.setAttribute("aria-label", `${id} ${lbl}`);
      inp.value = v[k][id] || 0;
      const orig = v.original ? (v.original[k][id] || 0) : (v[k][id] || 0);
      inp.classList.toggle("changed", (v[k][id] || 0) !== orig);
      inp.addEventListener("input", () => {
        const n = Math.max(0, Math.floor(Number(inp.value) || 0));
        if (!v.original) v.original = { for: { ...v.for }, against: { ...v.against }, abst: { ...v.abst }, totals: { ...v.totals } };
        v[k][id] = n; v.edited = true;
        recomputeTotals(v);
        inp.classList.toggle("changed", n !== (v.original[k][id] || 0));
        sp.innerHTML = splitHTML(v, id);
        renderChart(false);
      });
      td.appendChild(inp); tr.appendChild(td);
    });
    sp.innerHTML = splitHTML(v, id);
    tr.appendChild(sp);
    tb.appendChild(tr);
  });
}

function renderColors() {
  const box = $("colors"); box.innerHTML = "";
  COLOR_FIELDS.forEach(([k, lbl]) => {
    const row = document.createElement("div"); row.className = "crow2";
    const name = document.createElement("span"); name.textContent = lbl;
    const pick = document.createElement("input"); pick.type = "color"; pick.id = "c-" + k; pick.value = settings.colors[k];
    pick.setAttribute("aria-label", lbl + " colour");
    const hex = document.createElement("input"); hex.type = "text"; hex.id = "h-" + k; hex.value = settings.colors[k].toUpperCase();
    hex.setAttribute("aria-label", lbl + " hex code");
    const apply = val => { settings.colors[k] = val; saveLabels(); renderChart(); };
    pick.addEventListener("input", () => { hex.value = pick.value.toUpperCase(); apply(pick.value); });
    hex.addEventListener("input", () => {
      const v = hex.value.trim().replace(/^([^#])/, "#$1");
      if (/^#[0-9a-f]{6}$/i.test(v)) { pick.value = v.toLowerCase(); apply(v); }
    });
    row.append(name, pick, hex); box.appendChild(row);
  });
  const pr = $("presets"); pr.innerHTML = "";
  PRESETS.forEach(p => {
    const btn = document.createElement("button"); btn.type = "button";
    btn.innerHTML = `<i style="background:${p.yes}"></i><i style="background:${p.no}"></i>`;
    btn.append(p.name);
    btn.addEventListener("click", () => { settings.colors.yes = p.yes; settings.colors.no = p.no; saveLabels(); renderColors(); renderChart(); });
    pr.appendChild(btn);
  });
}

function renderChart(withTable = true) {
  const v = data.votes[current];
  $("voteTitle").textContent = v.title;
  $("crumbs").textContent = [data.fileName.replace(/ \(example\)$/, ""), v.date ? v.date.slice(0, 16) : "", v.id ? "Vote " + v.id : ""].filter(Boolean).join(" · ");
  const voted = v.totals.for + v.totals.against + v.totals.abst;
  const pct = n => voted ? ` <small>${Math.round(n / voted * 100)}%</small>` : "";
  $("kFor").innerHTML = v.totals.for + pct(v.totals.for);
  $("kAgainst").innerHTML = v.totals.against + pct(v.totals.against);
  $("kAbs").innerHTML = v.totals.abst + pct(v.totals.abst);
  $("kGroups").textContent = rowsFor(v).length;

  const bd = $("badges"); bd.innerHTML = "";
  bd.appendChild(v.totals.for > v.totals.against ? badge("More For than Against", "info") : badge("More Against than For", "info"));
  const ok = v.counted.for === v.totals.for && v.counted.against === v.totals.against;
  $("restore").hidden = !v.original;
  if (v.manual) bd.appendChild(badge("Entered by hand", "warn"));
  else if (v.edited) bd.appendChild(badge("Numbers edited by hand", "warn"));
  else bd.appendChild(ok
    ? badge("✓ Names match official totals", "ok")
    : badge(`Names give ${v.counted.for}/${v.counted.against}, file states ${v.totals.for}/${v.totals.against}`, "warn"));

  currentSVG = buildSVG(v, $("gap").checked);
  $("stage").innerHTML = currentSVG;
  if (withTable) renderTable(v);
}

function setToast(msg, isErr) { const t = $("toast"); t.textContent = msg; t.classList.toggle("err", !!isErr); }

function fileSlug() {
  const v = data.votes[current];
  const d = (v.date || "").slice(0, 10) || "vote";
  return `vote-bars-${d}-${v.id || current + 1}.svg`;
}

// ---------- Events ----------
async function handleFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const votes = parseXML(text);
    data = { fileName: file.name, votes };
    const known = new Set(GROUPS.map(g => g.id));
    extraGroups = [...new Set(votes.flatMap(v => [...Object.keys(v.for), ...Object.keys(v.against)]))]
      .filter(id => !known.has(id) && !EXCLUDED.has(id));
    current = 0;
    renderVoteList(); renderLabels(); renderChart();
    setToast(`Loaded ${votes.length} vote${votes.length > 1 ? "s" : ""} from ${file.name}.`);
  } catch (e) { setToast(e.message || "Couldn't read that file.", true); }
}

$("file").addEventListener("change", e => handleFile(e.target.files[0]));
const drop = $("drop");
drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));
$("vote").addEventListener("change", e => { current = Number(e.target.value); renderChart(); setToast(""); });
$("gap").addEventListener("change", () => renderChart());
$("restore").addEventListener("click", () => {
  const v = data.votes[current];
  if (!v.original) return;
  v.for = v.original.for; v.against = v.original.against; v.abst = v.original.abst; v.totals = v.original.totals;
  delete v.original; v.edited = false;
  renderChart(); setToast("File numbers restored.");
});
$("blank").addEventListener("click", () => {
  const zero = () => Object.fromEntries([...allGroupIds(), "NI"].map(id => [id, 0]));
  data.votes.push({ id: "", date: new Date().toISOString().slice(0, 10), title: "Manual entry " + (data.votes.filter(v => v.manual).length + 1),
    manual: true, totals: { for: 0, against: 0, abst: 0 }, counted: { for: 0, against: 0, abst: 0 }, for: zero(), against: zero(), abst: zero() });
  current = data.votes.length - 1;
  renderVoteList(); renderChart(); setToast("Blank vote added. Type the numbers in the table.");
  document.querySelector("#tbody input")?.focus();
});
$("resetLabels").addEventListener("click", () => {
  settings = defaults(); labels = settings.labels;
  saveLabels(); renderLabels(); renderChart(); setToast("Order and labels reset.");
});

$("copy").addEventListener("click", () => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` + currentSVG;
  navigator.clipboard.writeText(svg).then(
    () => setToast("SVG code copied. Paste it into Figma or a text file saved as .svg."),
    () => setToast("Copy was blocked here. Use Download SVG instead.", true));
});

$("download").addEventListener("click", () => {
  download(new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n` + currentSVG], { type: "image/svg+xml;charset=utf-8" }), fileSlug());
  setToast("Downloaded " + fileSlug() + ".");
});

$("fontFiles").addEventListener("change", e => { loadFontFiles([...e.target.files]); e.target.value = ""; });

renderVoteList(); renderLabels(); renderColors(); renderChart();
renderFontStatus(); initFonts();
if (document.fonts) document.fonts.ready.then(() => renderChart());
