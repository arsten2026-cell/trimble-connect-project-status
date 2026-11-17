// Steel progress for the client summary (week 4, B-Client 2; owner decision 3: the client never reads the steel library,
// only the published summary). When admin / the PM publish (and in the staff live view), the panel reads the library
// "STEEL/Монтаж" read-only - asmstatus (erected), fabstatus (FabDate / DelivDate, the fabricator's Excel) and the
// delivery notes - and reduces them here to TOTALS ONLY: counts and kg fabricated / delivered / erected. No marks, GUIDs,
// names, notes or dates leave this file.
// Same rules as Стомана (viewer-assembly-status):
//   - delivered per mark = max(typed deliveries, instances with a DelivDate <= today), records.js deliveredByMark
//     (the figure availabilityWithFab hands to steel.js availability), capped at the mark's instances in the model;
//   - weight = the model's Assembly_Weight/Маса_Елемент (kg); delivered kg = delivered x the mark's average weight,
//     fabricated kg = sum over instances with a FabDate, erected kg = sum over erected instances (steel.js markExportRows);
//   - wrong / on hold count only as "not yet erected".
// Without a loaded steel model (no instances): counts only, from the records (no %), and the summary says so; total is
// then the pieces known from the records and delivered is capped per mark at those (round 15 L6).
// Pure: no network, no DOM. Browser: window.SteelProgress; node: require (records.js is passed in or required).
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const req2 = (a, b) => { try { return require(a); } catch { return require(b); } };
  const lib = factory(node ? req2("./records.js", "../viewer-assembly-status/records.js") : root.SteelRecords);
  if (node) module.exports = lib;
  else root.SteelProgress = lib;
})(typeof self !== "undefined" ? self : this, function (R) {
  "use strict";

  const num = (v) => { const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : null; };
  const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
  const normMark = (m) => String(m == null ? "" : m).normalize("NFC").replace(/\s+/g, "").toUpperCase();
  const KEYS = ["total", "fabricated", "delivered", "erected"];

  /** pset-api records (Map or [[link, props]]) keyed by link -> Map IFC GUID -> props. A GUID with both the encoded and
   *  the old raw-"$" link: the encoded record wins (as Стомана and Статус read them, F4). */
  function byGuid(records) {
    const out = new Map(), fromEncoded = new Set();
    for (const [link, props] of records instanceof Map ? records : records || []) {
      const raw = String(link || "").replace(/^frn:entity:/, "");
      let guid = raw;
      try { guid = decodeURIComponent(raw); } catch {}
      if (!guid || !props) continue;
      const encoded = raw === encodeURIComponent(guid);
      if (fromEncoded.has(guid) && !encoded) continue;
      out.set(guid, props);
      if (encoded) fromEncoded.add(guid);
    }
    return out;
  }

  /** Steel assemblies of the loaded models from viewer properties: [{guid, mark, weight}]. ps: the object's
   *  "Assembly/Сглобка" pset as {name: value} (any pset whose name starts with "Assembly"). */
  function assemblyOf(guid, ps) {
    const val = (re) => { const k = Object.keys(ps || {}).find((x) => re.test(x)); return k ? ps[k] : undefined; };
    return { guid, mark: String(val(/Assembly_Pos/i) == null ? "" : val(/Assembly_Pos/i)).trim(), weight: num(val(/Assembly_Weight/i)) };
  }

  /**
   * The steel section of a client summary.
   * @param o {instances: [{guid, mark, weight}] from the loaded steel model, or null / [] when none is loaded,
   *           status: Map guid -> asmstatus, fab: Map guid -> fabstatus, deliveries: [{lines, cancelled}]} (DelivDate counts up to today, records.js)
   * @returns {model, byWeight, count: {total, fabricated, delivered, erected}, kg: {...}} (totals only)
   */
  function build(o) {
    o = o || {};
    const status = o.status instanceof Map ? o.status : new Map();
    const fab = o.fab instanceof Map ? o.fab : new Map();
    const get = (m, g) => m.get(g) || {};
    const seen = new Set();
    const list = (o.instances || []).filter((a) => a && a.guid && !seen.has(a.guid) && seen.add(a.guid));
    const count = { total: 0, fabricated: 0, delivered: 0, erected: 0 }, kg = { total: 0, fabricated: 0, delivered: 0, erected: 0 };
    if (!list.length) {
      // no steel model: counts from the records only (pieces known from the erection and fabrication records).
      // total = the pieces known from those records (the real total is unknown, so no %). Delivered per mark is capped at
      // the pieces known for that mark, and a typed mark no record knows is left out, so delivered never exceeds the
      // pieces that exist (round 15 L6; before, "RF22=500" gave "доставени 730" of 295).
      const guids = new Set([...status.keys(), ...fab.keys()]);
      const inst = [...guids].map((g) => ({ guid: g, mark: get(status, g).mark || "#" + g }));
      const known = new Map();
      for (const a of inst) { const m = normMark(a.mark); known.set(m, (known.get(m) || 0) + 1); }
      for (const g of guids) {
        if (get(fab, g).FabDate) count.fabricated++;
        if (get(status, g).erected) count.erected++;
      }
      count.total = guids.size;
      for (const [m, x] of R.deliveredByMark(o.deliveries, fab, inst, status)) count.delivered += Math.min(x.count, known.get(normMark(m)) || 0);
      return { model: false, byWeight: false, count, kg };
    }
    const byMark = new Map();
    for (const a of list) { const m = normMark(a.mark); if (!byMark.has(m)) byMark.set(m, []); byMark.get(m).push(a); }
    const delivered = R.deliveredByMark(o.deliveries, fab, list, status);
    let anyWeight = false;
    for (const [m, as] of byMark) {
      const w = (a) => num(a.weight) || 0;
      if (as.some((a) => num(a.weight) != null)) anyWeight = true;
      const wTotal = as.reduce((t, a) => t + w(a), 0), wUnit = wTotal / as.length;
      const made = as.filter((a) => get(fab, a.guid).FabDate), up = as.filter((a) => get(status, a.guid).erected);
      const del = Math.min((delivered.get(m) || {}).count || 0, as.length);
      count.total += as.length; count.fabricated += made.length; count.delivered += del; count.erected += up.length;
      kg.total += wTotal; kg.fabricated += made.reduce((t, a) => t + w(a), 0); kg.delivered += del * wUnit; kg.erected += up.reduce((t, a) => t + w(a), 0);
    }
    for (const k of KEYS) kg[k] = r1(kg[k]);
    const byWeight = anyWeight && kg.total > 0;
    if (!byWeight) for (const k of KEYS) kg[k] = 0;
    return { model: true, byWeight, count, kg };
  }

  /** Shares 0..1 for the card / report: by weight when the model has weights, else by count; null without totals. */
  function shares(st) {
    if (!st) return null;
    const base = st.byWeight ? st.kg : st.count;
    if (!st.model || !(base.total > 0)) return null;
    const p = (k) => Math.min(1, Math.max(0, base[k] / base.total));
    return { fabricated: p("fabricated"), delivered: p("delivered"), erected: p("erected") };
  }

  /** A copy with only the whitelisted keys (a summary must never carry anything else). */
  function clean(st) {
    if (!st || typeof st !== "object") return null;
    const ints = (x) => Object.fromEntries(KEYS.map((k) => [k, Math.max(0, Math.round(Number((x || {})[k]) || 0))]));
    const kgs = (x) => Object.fromEntries(KEYS.map((k) => [k, Math.max(0, r1((x || {})[k]))]));
    return { model: !!st.model, byWeight: !!st.byWeight, count: ints(st.count), kg: kgs(st.kg) };
  }

  return { byGuid, assemblyOf, build, shares, clean, KEYS };
});
