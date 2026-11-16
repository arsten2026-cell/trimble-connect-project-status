// Project status (client view): progress figures from the Pour status records. Read-only, no network here.
// Uses PourStatus (status.js) for the steps and stages. Browser: window.ProjectProgress; Node: require.
// Pset links: shared/arsten-links.js (window.ArstenLinks), copied next to this file on publish.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const linksNode = () => { try { return require("../shared/arsten-links.js"); } catch { return require("./arsten-links.js"); } };
  const lib = factory(node ? require("./status.js") : root.PourStatus, node ? linksNode() : root.ArstenLinks);
  if (node) module.exports = lib;
  else root.ProjectProgress = lib;
})(typeof self !== "undefined" ? self : this, function (S, LK) {
  "use strict";

  const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));

  /**
   * Status records keyed by GUID from the two reads of Pour status records ("$" links, F4): enc = Map link -> props
   * read under the URL-encoded link, raw = the same under the old raw-"$" link. The encoded record wins (a raw one
   * newer than it is merged, as Pour status shows it), so no pour drops out while records are not yet moved.
   * Read-only: nothing is moved here.
   */
  const fromPsets = (enc, raw) => LK.resolve(enc, raw).records;

  /**
   * A record as it was at the end of a date (YYYY-MM-DD): steps dated later are not done yet. No date: as now.
   * Only the step flags, "without" flags and dates are kept (no notes, no names) - this is what clients see.
   */
  function recordAsOf(rec, asOf) {
    if (!rec) return null;
    const r = {};
    for (const st of S.STEPS) {
      if (!rec[st.id]) continue;
      const d = rec[`${st.id}_date`];
      if (asOf && dateOk(d) && d > asOf) continue;
      r[st.id] = true;
      if (rec[`${st.id}_na`]) r[`${st.id}_na`] = true;
      if (dateOk(d)) r[`${st.id}_date`] = d;
    }
    return Object.keys(r).length ? r : null;
  }
  /** All records as of a date (Map guid -> client-safe record). */
  function recordsAsOf(records, asOf) {
    const out = new Map();
    for (const [g, rec] of records) { const r = recordAsOf(rec, asOf); if (r) out.set(g, r); }
    return out;
  }

  // Each step is measured in its own quantity (user 16.11.2026: formwork was shown in m³): formwork and stripping by
  // formwork area (sides + bottom, m²), rebar by weight (kg), poured by concrete volume (m³) - as in S.STEP_QTY.
  // A model without that quantity (older pour export) falls back to concrete volume, then to the object count.
  const UNIT = { volume: "m³", formwork: "m²", rebar: "kg" };
  const qtyOf = (o, key) => (typeof o[key] === "number" && isFinite(o[key]) ? o[key] : 0);

  /**
   * Overall progress per step, each in its own quantity, and by count. A step marked "without" counts as covered.
   * @param objects [{guid, pour, volume, formwork, rebar}]; records Map guid -> record (client-safe)
   * @returns {total:{count, volume}, steps:{formwork:{count, qty, total, unit, pct}, ...}, poursComplete:{formwork: n, ...}, pours}
   */
  function overall(objects, records) {
    const total = { count: objects.length, volume: 0 };
    const sums = { volume: 0, formwork: 0, rebar: 0 };
    for (const o of objects) for (const k of Object.keys(sums)) sums[k] += qtyOf(o, k);
    total.volume = sums.volume;
    const steps = {}, keyOf = {};
    for (const st of S.STEPS) {
      const want = S.STEP_QTY[st.id] || "volume";
      const key = sums[want] > 0 ? want : sums.volume > 0 ? "volume" : null;
      keyOf[st.id] = key;
      steps[st.id] = { count: 0, qty: 0, total: key ? sums[key] : 0, unit: key ? UNIT[key] : "", pct: 0 };
    }
    const byPour = new Map();
    for (const o of objects) {
      const rec = records.get(o.guid);
      if (!byPour.has(o.pour)) byPour.set(o.pour, []);
      byPour.get(o.pour).push(rec);
      for (const st of S.STEPS) if (rec && rec[st.id]) { steps[st.id].count++; if (keyOf[st.id]) steps[st.id].qty += qtyOf(o, keyOf[st.id]); }
    }
    for (const st of S.STEPS) {
      const s = steps[st.id];
      s.pct = s.total > 0 ? s.qty / s.total : total.count ? s.count / total.count : 0;
    }
    const poursComplete = {};
    for (const st of S.STEPS) poursComplete[st.id] = [...byPour.values()].filter((recs) => recs.every((r) => r && r[st.id])).length;
    return { total, steps, poursComplete, pours: byPour.size };
  }

  /**
   * Per pour number, per step: how many objects are done and the date the step was completed for the whole pour
   * (latest date, only when all objects have it), else the latest date so far.
   * @param pours [{label, objects:[{guid}]}] in display order
   */
  function perPour(pours, records) {
    return pours.map((g) => {
      const row = { label: g.label, total: g.objects.length, steps: {} };
      for (const st of S.STEPS) {
        let n = 0, last = "";
        for (const o of g.objects) {
          const r = records.get(o.guid);
          if (!r || !r[st.id]) continue;
          n++;
          const d = r[`${st.id}_date`];
          if (dateOk(d) && d > last) last = d;
        }
        row.steps[st.id] = { done: n, complete: n === g.objects.length && n > 0, date: last || null };
      }
      return row;
    });
  }

  /**
   * What was done when, newest first: one line per date + pour + step, with object count and the step's quantity
   * (formwork/stripping m², rebar kg, poured m³; qty 0 when the model has no such quantity).
   * "Without" steps are not events (nothing was built).
   */
  function timeline(objects, records) {
    const ev = new Map();
    for (const o of objects) {
      const r = records.get(o.guid);
      if (!r) continue;
      for (const st of S.STEPS) {
        if (!r[st.id] || r[`${st.id}_na`]) continue;
        const d = r[`${st.id}_date`];
        if (!dateOk(d)) continue;
        const k = `${d}|${o.pour}|${st.id}`;
        const key = S.STEP_QTY[st.id] || "volume";
        if (!ev.has(k)) ev.set(k, { date: d, pour: o.pour, step: st.id, count: 0, qty: 0, unit: UNIT[key], key });
        const e = ev.get(k);
        e.count++; e.qty += qtyOf(o, key);
      }
    }
    const order = S.STEPS.map((s) => s.id);
    return [...ev.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
      || String(a.pour).localeCompare(String(b.pour), undefined, { numeric: true }) || order.indexOf(b.step) - order.indexOf(a.step));
  }

  /** First and last step date in the records (for the "as of" slider). */
  function dateRange(records) {
    let min = "", max = "";
    for (const r of records.values()) for (const st of S.STEPS) {
      const d = r && r[`${st.id}_date`];
      if (!dateOk(d)) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    return min ? { min, max } : null;
  }

  return { UNIT, fromPsets, recordAsOf, recordsAsOf, overall, perPour, timeline, dateRange };
});
