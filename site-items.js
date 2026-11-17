// Site works ("Работи на обекта", user 17.11.2026): things done on site that are not in the model, reported weekly,
// e.g. "Additional site toilets delivered", "Existing concrete has been cut and removed from site".
// Entered in Статус by staff (admin, PM, GC). Stored ONCE per project as the file _AM_Docs/Site/site-items.json (same name
// = a new version of the file, so Connect keeps the history). An item: {id, text, date, client, created}:
//   text    what was done (at most TEXT_MAX characters)
//   date    the day it was done, "YYYY-MM-DD"; "" = not done yet (planned; staff see it, the client never does)
//   client  true = goes to the client summary and the weekly / monthly report once it has a date
//   created ISO time it was added (only for ordering)
// No names are kept (Connect's file versions already say who uploaded each version).
// Every save reads the file again first and applies just that one change to the fresh list, so two people adding items at
// about the same time do not lose each other's items (the window between the read and the upload is a few seconds).
// The client summary carries only the client items with a date: {text, date} (forSummary).
// Pure except load / change, which take a Core client {req} (shared/arsten-backup.js) and the browser fetch.
// Browser: window.SiteItems; node: require.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const req2 = (a, b) => { try { return require(a); } catch { return require(b); } };
  const lib = factory(node ? req2("../shared/arsten-backup.js", "./arsten-backup.js") : root.ArstenBackup);
  if (node) module.exports = lib;
  else root.SiteItems = lib;
})(typeof self !== "undefined" ? self : this, function (B) {
  "use strict";

  const TYPE = "arsten-site-items", VERSION = 1;
  const DOCS = "_AM_Docs", DOCS_OLD = "_ArstenDocs";
  const FOLDER = [DOCS, "Site"], FILE = "site-items.json";
  const TEXT_MAX = 200, ITEMS_MAX = 2000;
  // the summary keeps the client items of the last SUMMARY_DAYS days (the monthly report looks 30 days back)
  const SUMMARY_DAYS = 62, SUMMARY_MAX = 300;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const pickFolder = (list, name) => {
    const isF = (x) => !!x && String(x.type || "").toUpperCase() === "FOLDER";
    return (list || []).find((x) => isF(x) && x.name === name) || (name === DOCS ? (list || []).find((x) => isF(x) && x.name === DOCS_OLD) : undefined);
  };
  const itemsOf = (it) => (Array.isArray(it) ? it : (it && it.items) || []);
  const realDay = (d) => {
    if (!DAY_RE.test(String(d || ""))) return false;
    const [y, m, dd] = d.split("-").map(Number), dt = new Date(Date.UTC(y, m - 1, dd));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === dd;
  };
  const cleanText = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function addDays(day, n) {
    const [y, m, d] = day.split("-").map(Number), dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }

  /** One stored item cleaned, or null when it is not usable (no id or no text). */
  function cleanItem(x) {
    if (!x || typeof x !== "object") return null;
    const id = String(x.id || "").slice(0, 40), text = cleanText(x.text);
    if (!id || !text) return null;
    // only true (or no flag at all, as written before a flag existed) is "for the client"; "false", 0, null are not
    return { id, text, date: realDay(x.date) ? x.date : "", client: x.client === true || x.client === undefined, created: String(x.created || "").slice(0, 40) };
  }
  /** Items in the order shown: open (no date) first, by when added; then done, newest day first. */
  function sorted(items) {
    return items.slice().sort((a, b) => {
      if (!a.date !== !b.date) return a.date ? 1 : -1;
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.created < b.created ? 1 : a.created > b.created ? -1 : 0;
    });
  }
  /** Text of the file -> the items (bad ones dropped, at most ITEMS_MAX). An empty file: []. A file that is not a
   *  site-items list (broken JSON, another type, cut short) THROWS (audit: it must never be taken for "empty" and then
   *  overwritten by the next save). A leading BOM (saved in Notepad) is fine. */
  function parse(text) {
    let o;
    if (typeof text === "string") {
      const t = text.replace(/^﻿/, "").trim();
      if (!t) return [];
      try { o = JSON.parse(t); } catch (e) { throw new Error("site-items.json is not valid JSON – fix or restore an earlier version in Connect"); }
    } else o = text;
    if (o == null) return [];
    const list = Array.isArray(o) ? o : o && o.type === TYPE && Array.isArray(o.items) ? o.items : null;
    if (!list) throw new Error("site-items.json is not a site works list – fix or restore an earlier version in Connect");
    const seen = new Set(), out = [];
    for (const x of list) { const c = cleanItem(x); if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } }
    return sorted(out).slice(0, ITEMS_MAX);
  }
  const toJson = (items) => JSON.stringify({ type: TYPE, version: VERSION, items: sorted(items).slice(0, ITEMS_MAX) }, null, 1);

  /**
   * Apply one change to a list (pure). op: {add: {text, date, client}} | {edit: {id, text?, date?, client?}} | {remove: id}.
   * Returns {items, changed, error}: error "text" (empty text), "date" (not a real day or after today), "gone" (the item
   * was deleted meanwhile), "full" (ITEMS_MAX reached). today: "YYYY-MM-DD" (a done date cannot be in the future).
   */
  function apply(items, op, today, now) {
    const list = (items || []).slice();
    const okDate = (d) => d === "" || (realDay(d) && (!today || d <= today));
    if (op && op.add) {
      const text = cleanText(op.add.text), date = String(op.add.date || "");
      if (!text) return { items: list, changed: false, error: "text" };
      if (!okDate(date)) return { items: list, changed: false, error: "date" };
      if (list.length >= ITEMS_MAX) return { items: list, changed: false, error: "full" };
      const item = { id: op.add.id || newId(), text, date, client: op.add.client !== false, created: (now || new Date()).toISOString() };
      return { items: sorted(list.concat([item])), changed: true, item };
    }
    if (op && op.edit) {
      const i = list.findIndex((x) => x.id === op.edit.id);
      if (i < 0) return { items: list, changed: false, error: "gone" };
      const e = op.edit, next = Object.assign({}, list[i]);
      if (e.text !== undefined) { next.text = cleanText(e.text); if (!next.text) return { items: list, changed: false, error: "text" }; }
      if (e.date !== undefined) { if (!okDate(String(e.date))) return { items: list, changed: false, error: "date" }; next.date = String(e.date); }
      if (e.client !== undefined) next.client = !!e.client;
      const same = ["text", "date", "client"].every((k) => next[k] === list[i][k]);
      list[i] = next;
      return { items: sorted(list), changed: !same, item: next };
    }
    if (op && op.remove !== undefined) {
      const i = list.findIndex((x) => x.id === op.remove);
      if (i < 0) return { items: list, changed: false };   // already gone: nothing to do
      list.splice(i, 1);
      return { items: list, changed: true };
    }
    return { items: list, changed: false, error: "op" };
  }

  /** For the client summary of `date`: the client items done on or before that day, in the SUMMARY_DAYS before it,
   *  as [{text, date}] (newest first, at most SUMMARY_MAX). Nothing else of an item goes out. */
  function forSummary(items, date) {
    if (!realDay(date)) return [];
    const from = addDays(date, -SUMMARY_DAYS);
    return sorted((items || []).filter((x) => x && x.client && realDay(x.date) && x.date > from && x.date <= date))
      .slice(0, SUMMARY_MAX).map((x) => ({ text: cleanText(x.text), date: x.date }));
  }
  /** The summary items in a report period (from, to]: oldest first, as a report reads. */
  function inPeriod(site, from, to) {
    return (site || []).filter((x) => x && x.date > from && x.date <= to).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // ---------- the file ----------
  /** The folder id of _AM_Docs/Site without creating it; null when missing. */
  async function findFolder(core, projectId) {
    const p = await core.req(`projects/${encodeURIComponent(projectId)}`);
    let parent = p && p.rootId;
    if (!parent) return null;
    for (const name of FOLDER) {
      const f = pickFolder(itemsOf(await core.req(`folders/${encodeURIComponent(parent)}/items`)), name);
      if (!f) return null;
      parent = f.id;
    }
    return parent;
  }
  async function readFile(core, fileId, fetchImpl) {
    const d = await core.req(`files/fs/${encodeURIComponent(fileId)}/downloadurl`);
    const url = d && (d.url || d.downloadUrl || d.href);
    if (!url) throw new Error("site items: no download URL");
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 30000) : null;
    // the 30 s limit covers the body too (audit: a stalled body kept the buttons disabled)
    try {
      const res = await (fetchImpl || fetch)(url, Object.assign({ cache: "no-store" }, ctl ? { signal: ctl.signal } : {}));
      if (!res.ok) throw new Error("site items download " + res.status);
      return await res.text();
    } finally { if (timer) clearTimeout(timer); }
  }
  /** {items, folderId, fileId}. No folder or no file yet: {items: []}. A read error throws (never taken for "empty"). */
  async function load(core, projectId, fetchImpl, folderId) {
    const fid = folderId || (await findFolder(core, projectId));
    if (!fid) return { items: [], folderId: null, fileId: null };
    const f = itemsOf(await core.req(`folders/${encodeURIComponent(fid)}/items`)).find((x) => x && x.name === FILE && String(x.type || "FILE").toUpperCase() !== "FOLDER");
    if (!f) return { items: [], folderId: fid, fileId: null };
    return { items: parse(await readFile(core, f.id, fetchImpl)), folderId: fid, fileId: f.id };
  }
  /**
   * One change: read the file afresh, apply op, upload when something changed. Returns {items, changed, error?}.
   * o: {core, projectId, op, today, fetch, folderCache}
   */
  async function change(o) {
    const cur = await load(o.core, o.projectId, o.fetch);
    const r = apply(cur.items, o.op, o.today, o.now);
    if (r.error || !r.changed) return { items: cur.items, changed: false, error: r.error };
    // folder missing now: no cached id (it may be a deleted folder, audit); ensureFolder looks it up / creates it afresh
    const folderId = cur.folderId || (await B.ensureFolder(o.core, o.projectId, FOLDER, new Map()));
    await B.uploadJson(o.core, folderId, FILE, toJson(r.items), { fetch: o.fetch });
    return { items: r.items, changed: true, item: r.item };
  }

  return { TYPE, VERSION, FOLDER, FILE, TEXT_MAX, ITEMS_MAX, SUMMARY_DAYS, SUMMARY_MAX, parse, toJson, sorted, apply, forSummary, inPeriod, load, change, realDay };
});
