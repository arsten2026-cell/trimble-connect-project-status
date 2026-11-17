// Дейности (site activities, user 17.11.2026): things done on site that are not in the model, reported weekly, with
// photos, e.g. "Additional site toilets delivered", "Existing concrete has been cut and removed from site".
// Kept in the Дейности panel (viewer-activities) by staff (admin, PM, GC). Stored ONCE per project as the file
// _AM_Docs/Activities/activities.json (same name = a new version of the file, so Connect keeps the history); the photos
// as JPEG files in _AM_Docs/Activities/Photos/<YYYY-MM-DD>/ (apart, so the list's folder stays small: audit 17.11). An entry: {id, text, date, client, created, photos}:
//   text    what was done (at most TEXT_MAX characters)
//   date    the day it was done, "YYYY-MM-DD"; "" = not done yet (planned; staff see it, the client never does)
//   client  true = goes to the client summary and the weekly / monthly report once it has a date (Статус publishes)
//   created ISO time it was added (only for ordering)
//   photos  [{id, name}]: Connect file ids of the photos (at most PHOTOS_MAX); staff only, never in the client summary
// No names are kept (Connect's file versions already say who uploaded each version).
// Every save reads the file again first and applies just that one change to the fresh list, uploads it, then reads it once
// more and checks the change is there (another person's upload at the same moment can replace it): if not, the change is
// applied again to that newer list (at most SAVE_TRIES times). A file that cannot be read as a list is never overwritten.
// The client summary carries only the client entries with a date: {text, date} (forSummary; Статус, client-summary.js).
// Pure except load / change / uploadPhoto, which take a Core client {req} (shared/arsten-backup.js) and the browser fetch.
// Browser: window.ArstenActivities; node: require.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const req2 = (a, b) => { try { return require(a); } catch { return require(b); } };
  const lib = factory(node ? req2("../shared/arsten-backup.js", "./arsten-backup.js") : root.ArstenBackup);
  if (node) module.exports = lib;
  else root.ArstenActivities = lib;
})(typeof self !== "undefined" ? self : this, function (B) {
  "use strict";

  const TYPE = "arsten-activities", VERSION = 1;
  const DOCS = "_AM_Docs", DOCS_OLD = "_ArstenDocs";
  const FOLDER = [DOCS, "Activities"], FILE = "activities.json", PHOTOS = "Photos";
  const SAVE_TRIES = 3, LIST_SUSPECT = 100;
  const TEXT_MAX = 200, ITEMS_MAX = 2000, PHOTOS_MAX = 12;
  // the summary keeps the client entries of the last SUMMARY_DAYS days (the monthly report looks 30 days back)
  const SUMMARY_DAYS = 62, SUMMARY_MAX = 300;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const pickFolder = (list, name) => {
    const isF = (x) => !!x && String(x.type || "").toUpperCase() === "FOLDER";
    return (list || []).find((x) => isF(x) && x.name === name) || (name === DOCS ? (list || []).find((x) => isF(x) && x.name === DOCS_OLD) : undefined);
  };
  const itemsOf = (it) => (Array.isArray(it) ? it : (it && (it.items || it.data)) || []);
  const realDay = (d) => {
    if (!DAY_RE.test(String(d || ""))) return false;
    const [y, m, dd] = d.split("-").map(Number), dt = new Date(Date.UTC(y, m - 1, dd));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === dd;
  };
  const cleanText = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, TEXT_MAX).trim();
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function addDays(day, n) {
    const [y, m, d] = day.split("-").map(Number), dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }
  /** Monday of the week of a day (weeks Monday–Sunday, as on site). */
  function weekOf(day) {
    const [y, m, d] = day.split("-").map(Number), dt = new Date(Date.UTC(y, m - 1, d));
    return addDays(day, -((dt.getUTCDay() + 6) % 7));
  }
  /** Photos of an entry cleaned: [{id, name}], unique ids, at most PHOTOS_MAX. */
  function cleanPhotos(a) {
    const seen = new Set(), out = [];
    for (const p of Array.isArray(a) ? a : []) {
      const id = p && String(p.id || "").slice(0, 80);
      if (!id || seen.has(id)) continue;
      seen.add(id); out.push({ id, name: String((p && p.name) || "").slice(0, 120) });
      if (out.length >= PHOTOS_MAX) break;
    }
    return out;
  }

  /** One stored entry cleaned, or null when it is not usable (no id or no text). */
  function cleanItem(x) {
    if (!x || typeof x !== "object") return null;
    const id = String(x.id || "").slice(0, 40), text = cleanText(x.text);
    if (!id || !text) return null;
    // only true (or no flag at all) is "for the client"; "false", 0, null are not
    return { id, text, date: realDay(x.date) ? x.date : "", client: x.client === true || x.client === undefined,
      created: String(x.created || "").slice(0, 40), photos: cleanPhotos(x.photos) };
  }
  /** Entries in the order shown: open (no date) first, by when added; then done, newest day first. */
  function sorted(items) {
    return items.slice().sort((a, b) => {
      if (!a.date !== !b.date) return a.date ? 1 : -1;
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.created < b.created ? 1 : a.created > b.created ? -1 : 0;
    });
  }
  /** Text of the file -> the entries (bad ones dropped, at most ITEMS_MAX). An empty file: []. A file that is not an
   *  activities list (broken JSON, another type, cut short) THROWS: it must never be taken for "empty" and then
   *  overwritten by the next save. A leading BOM (saved in Notepad) is fine. */
  function parse(text) {
    let o;
    if (typeof text === "string") {
      const t = text.replace(/^﻿/, "").trim();
      if (!t) return [];
      try { o = JSON.parse(t); } catch (e) { throw new Error(FILE + " is not valid JSON – fix it or restore an earlier version in Connect"); }
    } else o = text;
    if (o == null) throw new Error(FILE + " is empty (null) – fix it or restore an earlier version in Connect");
    if (o && !Array.isArray(o) && o.type === TYPE && Number(o.version) > VERSION) throw new Error(FILE + " was written by a newer version of Дейности – reload the panel");
    const list = Array.isArray(o) ? o : o && o.type === TYPE && Array.isArray(o.items) ? o.items : null;
    if (!list) throw new Error(FILE + " is not an activities list – fix it or restore an earlier version in Connect");
    const seen = new Set(), out = [];
    for (const x of list) { const c = cleanItem(x); if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } }
    return sorted(out).slice(0, ITEMS_MAX);
  }
  const toJson = (items) => JSON.stringify({ type: TYPE, version: VERSION, items: sorted(items).slice(0, ITEMS_MAX) }, null, 1);

  /**
   * Apply one change to a list (pure).
   * op: {add: {text, date, client, photos?}} | {edit: {id, text?, date?, client?, addPhotos?: [{id, name}], removePhoto?: id}}
   *     | {remove: id}
   * Returns {items, changed, error, item}: error "text" (empty text), "date" (not a real day or after today), "gone" (the
   * entry was deleted meanwhile), "full" (ITEMS_MAX reached), "photos" (PHOTOS_MAX reached). today: "YYYY-MM-DD".
   * Photos are added to / removed from the FRESH list, so two people adding photos keep both.
   */
  function apply(items, op, today, now) {
    const list = (items || []).slice();
    const okDate = (d) => d === "" || (realDay(d) && (!today || d <= today));
    if (op && op.add) {
      const text = cleanText(op.add.text), date = String(op.add.date || "");
      if (!text) return { items: list, changed: false, error: "text" };
      if (!okDate(date)) return { items: list, changed: false, error: "date" };
      if (op.add.id && list.some((x) => x.id === op.add.id)) return { items: list, changed: false, item: list.find((x) => x.id === op.add.id) };   // already added (a retry)
      if (list.length >= ITEMS_MAX) return { items: list, changed: false, error: "full" };
      const item = { id: op.add.id || newId(), text, date, client: op.add.client !== false, created: (now || new Date()).toISOString(), photos: cleanPhotos(op.add.photos) };
      return { items: sorted(list.concat([item])), changed: true, item };
    }
    if (op && op.edit) {
      const i = list.findIndex((x) => x.id === op.edit.id);
      if (i < 0) return { items: list, changed: false, error: "gone" };
      const e = op.edit, cur = list[i], next = Object.assign({}, cur, { photos: (cur.photos || []).slice() });
      if (e.text !== undefined) { next.text = cleanText(e.text); if (!next.text) return { items: list, changed: false, error: "text" }; }
      if (e.date !== undefined) { if (!okDate(String(e.date))) return { items: list, changed: false, error: "date" }; next.date = String(e.date); }
      if (e.client !== undefined) next.client = !!e.client;
      if (e.removePhoto !== undefined) next.photos = next.photos.filter((p) => p.id !== e.removePhoto);
      if (Array.isArray(e.addPhotos) && e.addPhotos.length) {
        const add = cleanPhotos(e.addPhotos).filter((p) => !next.photos.some((q) => q.id === p.id));
        if (next.photos.length + add.length > PHOTOS_MAX) return { items: list, changed: false, error: "photos" };
        next.photos = next.photos.concat(add);
      }
      const same = ["text", "date", "client"].every((k) => next[k] === cur[k]) && next.photos.map((p) => p.id).join() === (cur.photos || []).map((p) => p.id).join();
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

  /** For the client summary of `date`: the client entries done on or before that day, in the SUMMARY_DAYS before it,
   *  as [{text, date}] (newest first, at most SUMMARY_MAX). Nothing else of an entry goes out (no photos, no ids). */
  function forSummary(items, date) {
    if (!realDay(date)) return [];
    const from = addDays(date, -SUMMARY_DAYS);
    return sorted((items || []).filter((x) => x && x.client && realDay(x.date) && x.date > from && x.date <= date))
      .slice(0, SUMMARY_MAX).map((x) => ({ text: cleanText(x.text), date: x.date }));
  }
  /** Entries grouped by week (Monday first): [{week: "YYYY-MM-DD" (Monday), items}], newest week first; planned
   *  entries (no date) in a first group with week "". */
  function byWeek(items) {
    const groups = new Map();
    for (const x of sorted(items || [])) {
      const k = x.date ? weekOf(x.date) : "";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    return [...groups].map(([week, list]) => ({ week, items: list }));
  }

  // ---------- the file ----------
  /** The folder id of _AM_Docs/Activities without creating it; null when missing. */
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
    if (!url) throw new Error("activities: no download URL");
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 30000) : null;
    // the 30 s limit covers the body too
    try {
      const res = await (fetchImpl || fetch)(url, Object.assign({ cache: "no-store" }, ctl ? { signal: ctl.signal } : {}));
      if (!res.ok) throw new Error("activities download " + res.status);
      return await res.text();
    } finally { if (timer) clearTimeout(timer); }
  }
  /** {items, folderId, fileId}. No folder or no file yet: {items: []}. A read error throws (never taken for "empty"). */
  async function load(core, projectId, fetchImpl, folderId) {
    const fid = folderId || (await findFolder(core, projectId));
    if (!fid) return { items: [], folderId: null, fileId: null };
    const listing = itemsOf(await core.req(`folders/${encodeURIComponent(fid)}/items`));
    const f = listing.find((x) => x && x.name === FILE && String(x.type || "FILE").toUpperCase() !== "FOLDER");
    // a long listing may be one page of several (the file on a later page): never take that for "no list yet" (audit)
    if (!f && listing.length >= LIST_SUSPECT) throw new Error(`${FILE} not found in a long listing of ${FOLDER.join("/")} – move other files out of it`);
    if (!f) return { items: [], folderId: fid, fileId: null };
    return { items: parse(await readFile(core, f.id, fetchImpl)), folderId: fid, fileId: f.id };
  }
  /**
   * One change: read the file afresh, apply op, upload when something changed. Returns {items, changed, error?, item?}.
   * o: {core, projectId, op, today, fetch}
   */
  /** Is the change op visible in items (after an upload)? */
  function landed(items, op, item) {
    if (op.add) return !!item && items.some((x) => x.id === item.id);
    if (op.remove !== undefined) return !items.some((x) => x.id === op.remove);
    if (op.edit) {
      const x = items.find((i) => i.id === op.edit.id);
      if (!x || !item) return false;
      const ids = new Set((x.photos || []).map((p) => p.id));
      return ["text", "date", "client"].every((k) => x[k] === item[k]) && (item.photos || []).every((p) => ids.has(p.id))
        && (op.edit.removePhoto === undefined || !ids.has(op.edit.removePhoto));
    }
    return true;
  }
  async function change(o) {
    let op = o.op, changed = false, item = null;
    for (let n = 0; n < SAVE_TRIES; n++) {
      const cur = await load(o.core, o.projectId, o.fetch);
      const r = apply(cur.items, op, o.today, o.now);
      if (r.error) return { items: cur.items, changed, error: r.error, item: r.item };   // the real reason ("gone", "photos"…)
      if (!r.changed) return { items: cur.items, changed, item: r.item };
      item = r.item;
      if (op.add && item) op = { add: Object.assign({}, op.add, { id: item.id }) };   // the same id on a second try
      // folder missing now: no cached id (it may be a deleted folder); ensureFolder looks it up / creates it afresh
      const folderId = cur.folderId || (await B.ensureFolder(o.core, o.projectId, FOLDER, new Map()));
      await B.uploadJson(o.core, folderId, FILE, toJson(r.items), { fetch: o.fetch });
      changed = true;
      // read back: another person's upload at the same moment may have replaced ours
      let back;
      try { back = await load(o.core, o.projectId, o.fetch, folderId); }
      catch (e) { console.warn("activities: read-back failed after a successful upload", e); return { items: r.items, changed, item }; }   // saved; just not re-checked
      if (landed(back.items, op, item)) return { items: back.items, changed, item };
    }
    return { items: (await load(o.core, o.projectId, o.fetch)).items, changed, error: "conflict", item };
  }

  // ---------- photos ----------
  const pad = (n) => String(n).padStart(2, "0");
  /** File name of a photo: act-<day>-<HHMMSS>-<4 random>.jpg (unique, sortable, no names of people). */
  function photoName(day, at) {
    const d = at || new Date();
    return `act-${day}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}.jpg`;
  }
  /**
   * Upload one prepared JPEG (ArstenPhotos.prepareImage) to _AM_Docs/Activities/Photos/<day>/. Returns {id, name}.
   * o: {core, projectId, blob, day, fetch, folderCache (Map, optional), at}
   */
  async function uploadPhoto(o) {
    const day = realDay(o.day) ? o.day : null;
    if (!day) throw new Error("photo: day YYYY-MM-DD required");
    const folderId = await B.ensureFolder(o.core, o.projectId, FOLDER.concat([PHOTOS, day]), o.folderCache || new Map());
    const name = photoName(day, o.at);
    const f = o.fetch || ((...a) => fetch(...a));
    const init = await o.core.req("files/fs/initiate", "POST", { parentId: folderId, parentType: "FOLDER", name });
    if (!init || !init.uploadURL) throw new Error("upload: no upload URL");
    const put = await f(init.uploadURL, { method: "PUT", body: o.blob, headers: { "Content-Type": "image/jpeg" } });
    if (!put || !put.ok) throw new Error(`upload PUT ${put ? put.status : "?"}`);
    const done = await o.core.req("files/fs/commit", "POST", { uploadId: init.uploadId });
    let id = done && (done.id || done.fileId || (done.file && done.file.id) || (done.data && done.data.id));
    for (let i = 0; !id && i < 10; i++) {   // commit can finish asynchronously: look the file up in its folder
      await new Promise((r) => setTimeout(r, o.lookMs == null ? 800 : o.lookMs));
      const x = itemsOf(await o.core.req(`folders/${encodeURIComponent(folderId)}/items`)).find((y) => y.name === name);
      if (x) id = x.id;
    }
    if (!id) throw new Error("upload: file id not returned");
    return { id, name };
  }
  /** Download URL of a photo (for the thumbnail / full view); "" when Connect gives none. */
  async function photoUrl(core, fileId) {
    const d = await core.req(`files/fs/${encodeURIComponent(fileId)}/downloadurl`);
    return (d && (d.url || d.downloadUrl || d.href)) || "";
  }

  return { TYPE, VERSION, FOLDER, FILE, PHOTOS, TEXT_MAX, ITEMS_MAX, PHOTOS_MAX, SUMMARY_DAYS, SUMMARY_MAX, parse, toJson, sorted, apply,
    forSummary, byWeek, weekOf, addDays, load, change, uploadPhoto, photoUrl, photoName, realDay };
});
