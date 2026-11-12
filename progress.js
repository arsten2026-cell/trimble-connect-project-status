// Project status (client view): progress figures from the Pour status records. Read-only, no network here.
// Uses PourStatus (status.js) for the steps and stages. Browser: window.ProjectProgress; Node: require.
(function (root, factory) {
  const S = typeof module === "object" && module.exports ? require("./status.js") : root.PourStatus;
  const lib = factory(S);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.ProjectProgress = lib;
})(typeof self !== "undefined" ? self : this, function (S) {
  "use strict";

  const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));

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

  /**
   * Overall progress per step, by concrete volume and by count. A step marked "without" counts as covered.
   * @param objects [{guid, volume, pour}]; records Map guid -> record (client-safe)
   * @returns {total:{count, volume}, steps:{formwork:{count, volume, pct}, ...}, poursComplete:{formwork: n, ...}, pours}
   */
  function overall(objects, records) {
    const total = { count: objects.length, volume: 0 };
    const steps = {};
    for (const st of S.STEPS) steps[st.id] = { count: 0, volume: 0, pct: 0 };
    const byPour = new Map();
    for (const o of objects) {
      const v = typeof o.volume === "number" && isFinite(o.volume) ? o.volume : 0;
      total.volume += v;
      const rec = records.get(o.guid);
      if (!byPour.has(o.pour)) byPour.set(o.pour, []);
      byPour.get(o.pour).push(rec);
      for (const st of S.STEPS) if (rec && rec[st.id]) { steps[st.id].count++; steps[st.id].volume += v; }
    }
    for (const st of S.STEPS) {
      const s = steps[st.id];
      s.pct = total.volume > 0 ? s.volume / total.volume : total.count ? s.count / total.count : 0;
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
   * What was done when, newest first: one line per date + pour + step, with object count and volume.
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
        if (!ev.has(k)) ev.set(k, { date: d, pour: o.pour, step: st.id, count: 0, volume: 0 });
        const e = ev.get(k);
        e.count++; e.volume += typeof o.volume === "number" && isFinite(o.volume) ? o.volume : 0;
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

  return { recordAsOf, recordsAsOf, overall, perPour, timeline, dateRange };
});
