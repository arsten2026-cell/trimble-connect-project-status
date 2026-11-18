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

  /**
   * Whether step i of a record counts as done (H1, round 10). Same rule as S.stageIndex: a step marked "without" (does not
   * apply) counts as covered only once the step before it is covered, so formwork "without" = ready for rebar, but the
   * automatic stripped "without" (set with "Без кофраж") counts only after the pour. A real (not "without") step always counts.
   */
  function covered(rec, i) {
    const st = S.STEPS[i];
    if (!rec || !st || !rec[st.id]) return false;
    return !rec[`${st.id}_na`] || i === 0 || covered(rec, i - 1);
  }
  /** Step i covered as "without" (no work done, nothing built). */
  const coveredNa = (rec, i) => covered(rec, i) && !!rec[`${S.STEPS[i].id}_na`];
  /** Date a covered step counts from: its own date; a "without" step not before the step before it (stripped "without"
   *  marked 10.11 on a pour poured 15.11 is covered from 15.11). "" when undated. */
  function coveredDate(rec, i) {
    const st = S.STEPS[i];
    let d = dateOk(rec[`${st.id}_date`]) ? rec[`${st.id}_date`] : "";
    if (i > 0 && rec[`${st.id}_na`]) { const p = coveredDate(rec, i - 1); if (p > d) d = p; }
    return d;
  }

  // Each step is measured in its own quantity (user 16.11.2026: formwork was shown in m³): formwork and stripping by
  // formwork area (sides + bottom, m²), rebar by weight (kg), poured by concrete volume (m³) - as in S.STEP_QTY.
  // A model without that quantity (older pour export) falls back to concrete volume, then to the object count.
  const UNIT = { volume: "m³", formwork: "m²", rebar: "kg" };
  const qtyOf = (o, key) => (typeof o[key] === "number" && isFinite(o[key]) ? o[key] : 0);

  /**
   * Overall progress per step, each in its own quantity, and by count. A step marked "without" counts as covered once the
   * step before it is covered (covered(); an unpoured pour with stripped "without" is not stripped). Totals are unchanged.
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
      S.STEPS.forEach((st, i) => { if (covered(rec, i)) { steps[st.id].count++; if (keyOf[st.id]) steps[st.id].qty += qtyOf(o, keyOf[st.id]); } });
    }
    for (const st of S.STEPS) {
      const s = steps[st.id];
      s.pct = s.total > 0 ? s.qty / s.total : total.count ? s.count / total.count : 0;
    }
    const poursComplete = {};
    S.STEPS.forEach((st, i) => { poursComplete[st.id] = [...byPour.values()].filter((recs) => recs.every((r) => covered(r, i))).length; });
    return { total, steps, poursComplete, pours: byPour.size };
  }

  /**
   * Per pour number, per step: how many objects are done (covered(): "without" only after the step before it), how many
   * of those are "without" (na), and the date the step was completed for the whole pour (latest date, only when all
   * objects have it), else the latest date so far. A "without" step's date is not before the step before it.
   * @param pours [{label, objects:[{guid}]}] in display order
   */
  function perPour(pours, records) {
    return pours.map((g) => {
      const row = { label: g.label, total: g.objects.length, steps: {} };
      S.STEPS.forEach((st, i) => {
        let n = 0, na = 0, last = "";
        for (const o of g.objects) {
          const r = records.get(o.guid);
          if (!covered(r, i)) continue;
          n++;
          if (r[`${st.id}_na`]) na++;
          const d = coveredDate(r, i);
          if (d && d > last) last = d;
        }
        row.steps[st.id] = { done: n, na, complete: n === g.objects.length && n > 0, date: last || null };
      });
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

  // ---------- reading the pour objects (sweep 18.11.2026) ----------
  // Статус read every 200-object chunk one after the other; with only the architecture or steel model loaded (the proxy
  // class filter finds nothing, so every object is read) that was ~150 serial viewer round trips (~9 s) before the live
  // view, on every open and every model change. Same rules as Монолитен бетон's U.scanPours (viewer-pour-status/app.js);
  // kept here because the synced common.js is Монолитен бетон's file - move both into common.js when that area is next
  // touched. The sessionStorage key is the same one, so a model version found without pours by either panel is skipped.
  /** sessionStorage key of "this model version has no Pour/Такт objects" (full-model scan skipped next time). */
  const noPourKey = (projectId, modelId, ver) => `arsten.pourScan.v1.${projectId || "?"}.${modelId}@${ver}`;
  /** items mapped n at a time; the results keep the order of items. */
  async function poolMap(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); } }));
    return out;
  }
  /**
   * Pour objects of the loaded models [{modelId, id, props, guid, bbox?}]: properties read `batch` at a time, `limit`
   * chunks at once; per chunk the GUIDs (and, unless o.noBoxes, the boxes) side by side. Model / chunk order is kept.
   * o.full (the class filter found nothing, every object is read): a model version known to have no pour objects
   * (o.cache, by o.versions modelId -> versionId and the object count) is skipped; one scanned without pours is remembered.
   * o: {batch, limit, mapLimit, full, versions: Map, cache: {get, set, drop}, projectId, noBoxes, onProgress(done, total)}
   */
  async function scanPours(api, modelObjs, readPset, o) {
    o = o || {};
    const batch = o.batch || 200, limit = o.limit || 4, mapLimit = o.mapLimit || poolMap;
    const items = [];
    let skipped = 0;
    for (const m of modelObjs || []) {
      const ids = (m.objects || []).map((x) => x.id);
      if (!ids.length) continue;
      const ver = o.versions && o.versions.get(m.modelId);
      const key = o.full && ver && o.cache ? noPourKey(o.projectId, m.modelId, ver) : null;
      if (key) { const c = o.cache.get(key); if (c && c.hasPours === false && c.n === ids.length) { skipped++; continue; } }
      const chunks = [];
      for (let i = 0; i < ids.length; i += batch) chunks.push(ids.slice(i, i + batch));
      let read = 0;
      const per = await mapLimit(chunks, limit, async (chunk) => {
        const props = (await api.viewer.getObjectProperties(m.modelId, chunk)) || [];
        const found = [];
        for (const p of props) { const ps = p && readPset(p); if (ps) found.push({ modelId: m.modelId, id: p.id, props: ps }); }
        if (found.length) {
          const fid = found.map((f) => f.id);
          const [boxes, guids] = await Promise.all([
            o.noBoxes ? null : Promise.resolve().then(() => api.viewer.getObjectBoundingBoxes(m.modelId, fid)).catch(() => null),   // boxes are optional
            api.viewer.convertToObjectIds(m.modelId, fid)]);
          const byId = boxes ? new Map(boxes.map((b) => [b.id, b.boundingBox])) : null;
          found.forEach((f, k) => { if (byId) f.bbox = byId.get(f.id) || null; f.guid = (guids || [])[k] || null; });
        }
        read += chunk.length;
        if (o.onProgress) o.onProgress(read, ids.length);
        return found.filter((f) => f.guid);
      });
      const got = [].concat(...per);
      items.push(...got);
      if (key) { if (got.length) o.cache.drop(key); else o.cache.set(key, { n: ids.length, hasPours: false }); }
    }
    items.skipped = skipped;
    return items;
  }

  return { UNIT, fromPsets, recordAsOf, recordsAsOf, covered, coveredNa, coveredDate, overall, perPour, timeline, dateRange, noPourKey, poolMap, scanPours };
});
