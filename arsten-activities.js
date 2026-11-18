// Дейности (site activities, user 17.11.2026): things done on site that are not in the model, reported weekly, with
// photos, e.g. "Additional site toilets delivered", "Existing concrete has been cut and removed from site".
// Kept in the Дейности panel (viewer-activities) by staff (admin, PM, GC). Stored ONCE per project as the file
// _AM_Docs/Activities/activities.json (same name = a new version of the file, so Connect keeps the history); the photos
// as JPEG files in _AM_Docs/Activities/Photos/<YYYY-MM-DD>/ (apart, so the list's folder stays small: audit 17.11). An entry: {id, text, date, client, created, photos}:
//   text    what was done (at most TEXT_MAX characters)
//   date    the day it was done, "YYYY-MM-DD"; "" = not done yet (planned; staff see it, the client never does)
//   client  true = goes to the client summary and the weekly / monthly report once it has a date (Статус publishes)
//   created ISO time it was added (only for ordering)
//   photos  [{id, name, thumbId?}]: Connect file ids of the photos (and of their ~25 KB thumbnails <name>_t.jpg, sweep
//           18.11.2026) (at most PHOTOS_MAX); the first CLIENT_PHOTOS of a client entry are copied for the client at publishing
// No names are kept (Connect's file versions already say who uploaded each version).
// Every save reads the file again first and applies just that one change to the fresh list, uploads it, then reads it once
// more and checks the change is there (another person's upload at the same moment can replace it): if not, the change is
// applied again to that newer list (at most SAVE_TRIES times). A file that cannot be read as a list is never overwritten.
// The client summary carries only the client entries with a date: {text, date, photos?} (forSummary; Статус,
// client-summary.js). Photos for the client (user, 17.11.2026): at publishing, the photos of those entries (at most
// CLIENT_PHOTOS each) are COPIED to _AM_Docs/Client/Photos/<YYYY-MM>/act-<source file id>.jpg (copyForClient), so the
// client only ever reads _AM_Docs/Client; a photo copied before is found by its name and not copied again - only when
// that file was uploaded by the current user or a trusted publisher (sweep 18.11.2026: the name is predictable, so a
// file planted under it by anyone else is ignored and the photo is copied afresh under a unique name).
// Every photo PUT / download goes through ArstenBackup.send (timeout + 429/503 retry, sweep 18.11.2026): a stalled
// request on site mobile data ends with "Connect не отговаря…" instead of leaving the panel busy forever.
// Additional works ("Допълнителни работи", ДР; user 18.11.2026, PLAN-ACTIVITIES-ON-DRAWINGS.md phase 1): an entry with
// `extra` is an additional work outside the model and the contract - extra excavation, a cut opening, demolition. It
// keeps everything an activity has, plus extra: {no, status, since, qty, unit, sheet, page, where, link}:
//   no      the register number ДР-<no>, given at save from the freshly read list (largest + 1), never typed and never
//           reused: a numbered entry cannot be deleted (it is rejected instead); two numbers that clash after two
//           saves at the same moment are fixed on read (the later entry gets the next free number, fixNumbers)
//   status  pending / approved / doing / done / rejected; since = the day of the last status change
//   qty     quantity >= 0 (or null) in unit (UNITS keys); sheet / page / where: the drawing, its page, the place in words
//   link    the Connect share link of a marked view (only https on connect.trimble.com) - never goes to the client
//   todo, todoNo  the Connect ToDo with the marked drawing (live test 18.11.2026: a ToDo has NO share link in Connect,
//           so the panel lists the project's ToDos and keeps the chosen one's id and number "1028-11"; Отвори в Connect
//           opens web.connect.trimble.com/projects/<project>/todo/<id>) - never goes to the client
// The client gets a numbered entry only when it is ticked "за клиента", dated and done (review 18.11.2026: the summary
// shows no status, so an approved work with a date read as done), as "ДР-005 · text" (forSummary): no status, quantity,
// drawing or link. File version 2: an older panel refuses to save
// over it ("written by a newer version - reload") instead of dropping the extra fields.
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

  const TYPE = "arsten-activities", VERSION = 3;   // 3 (18.11.2026 night): extra.todo / todoNo (a v2 panel would drop them)
  // additional works (ДР): statuses in their order, units (key -> shown as), the client sees only these statuses
  const STATUSES = ["pending", "approved", "doing", "done", "rejected"];
  const UNITS = { m: "m", m2: "m²", m3: "m³", pcs: "бр.", t: "t", kg: "kg", h: "h", set: "к-т" };
  const CLIENT_STATUSES = ["done"];   // review 18.11.2026: the client summary has no status, so only DONE works go out
  const SHEET_MAX = 60, WHERE_MAX = 120, LINK_MAX = 500, QTY_MAX = 1e9, NO_MAX = 99999;
  const DOCS = "_AM_Docs", DOCS_OLD = "_ArstenDocs";
  const FOLDER = [DOCS, "Activities"], FILE = "activities.json", PHOTOS = "Photos";
  const SAVE_TRIES = 3, LIST_SUSPECT = 100, FRESH_MS = 2000;
  const TEXT_MAX = 200, ITEMS_MAX = 2000, PHOTOS_MAX = 12;
  // the summary keeps the client entries of the last SUMMARY_DAYS days (the monthly report looks 30 days back)
  const SUMMARY_DAYS = 62, SUMMARY_MAX = 300, CLIENT_PHOTOS = 6;
  // the largest source file copied for the client: a prepared photo is ~1-2.5 MB (sweep 18.11.2026, security)
  const SOURCE_MAX = 5 * 1024 * 1024;
  const CLIENT_FOLDER = [DOCS, "Client", "Photos"];
  const COPY_POOL = 3;   // client photo copies at once (speed sweep 18.11.2026)
  /** fn over items, at most limit at once; results in input order (as ArstenPhotos.mapLimit: this file works alone). */
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return out;
  }
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
  /** Photos of an entry cleaned: [{id, name, thumbId?}], unique ids, at most PHOTOS_MAX. thumbId (sweep 18.11.2026):
   *  the ~25 KB thumbnail <name>_t.jpg next to the photo; older photos have none (the list then shows the photo). */
  // A file id as Connect gives it (the client summary's PHOTO_ID rule). Sweep 18.11.2026 (security): was any string up
  // to 80 characters - activities.json is a plain file any 02 member can write, so an id is never trusted as more than
  // a name to check (copyForClient also checks WHERE the file is before copying it for the client).
  const FILE_ID = /^[A-Za-z0-9_-]{1,80}$/;
  function cleanPhotos(a) {
    const seen = new Set(), out = [];
    for (const p of Array.isArray(a) ? a : []) {
      const id = p ? String(p.id || "") : "";
      if (!FILE_ID.test(id) || seen.has(id)) continue;
      const t0 = String((p && p.thumbId) || ""), thumbId = FILE_ID.test(t0) ? t0 : "";
      seen.add(id); out.push(Object.assign({ id, name: String((p && p.name) || "").slice(0, 120) }, thumbId && thumbId !== id ? { thumbId } : {}));
      if (out.length >= PHOTOS_MAX) break;
    }
    return out;
  }

  /** The register number as shown: ДР-007 (three digits at least). */
  const extraNo = (n) => "ДР-" + String(Math.max(0, Math.floor(Number(n) || 0))).padStart(3, "0");
  /** A Connect share link: https on connect.trimble.com or one of its subdomains (web.connect.trimble.com, app21…); else "". */
  function cleanLink(v) {
    const s = String(v == null ? "" : v).trim();
    if (!s || s.length > LINK_MAX || /\s/.test(s)) return "";
    const m = /^https:\/\/([a-z0-9.-]+)(?::443)?(?:[/?#]|$)/i.exec(s);
    return m && /(^|\.)connect\.trimble\.com$/i.test(m[1]) ? s : "";
  }
  /** A quantity: a number >= 0 (a decimal comma is fine), rounded to 3 decimals; null when empty; NaN when not a number. */
  function cleanQty(v) {
    if (v == null || String(v).trim() === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).trim().replace(/\s/g, "").replace(",", "."));
    if (!isFinite(n) || n < 0 || n > QTY_MAX) return NaN;
    return Math.round(n * 1000) / 1000;
  }
  const cleanLine = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max).trim();
  /** The extra part of an additional work, cleaned (a stored one: bad values dropped, never thrown). */
  function cleanExtra(e) {
    const no = Math.floor(Number(e.no));
    const qty = cleanQty(e.qty), page = Math.floor(Number(e.page));
    return { no, status: STATUSES.includes(e.status) ? e.status : "pending", since: realDay(e.since) ? e.since : "",
      qty: qty == null || isNaN(qty) ? null : qty, unit: Object.prototype.hasOwnProperty.call(UNITS, e.unit) ? e.unit : "",
      sheet: cleanLine(e.sheet, SHEET_MAX), page: page >= 1 && page <= 9999 ? page : null, where: cleanLine(e.where, WHERE_MAX), link: cleanLink(e.link),
      todo: FILE_ID.test(String(e.todo || "")) ? String(e.todo) : "", todoNo: FILE_ID.test(String(e.todo || "")) ? cleanLine(e.todoNo, 30) : "" };
  }
  const isExtra = (x) => !!(x && x.extra && x.extra.no >= 1);
  /** The next free register number of a list. */
  const nextNo = (items) => (items || []).reduce((m, x) => (isExtra(x) ? Math.max(m, x.extra.no) : m), 0) + 1;
  /** Two entries with the same number (two saves at the same moment): the earlier added keeps it, the later gets the
   *  next free number. Deterministic, so every reader of the file shows the same numbers. Pure; returns a new list. */
  function fixNumbers(items) {
    const ex = (items || []).filter(isExtra).slice().sort((a, b) => a.extra.no - b.extra.no || (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : 1));
    const seen = new Set(), moved = new Map();
    let top = nextNo(items) - 1;
    for (const x of ex) { if (seen.has(x.extra.no)) moved.set(x.id, ++top); else seen.add(x.extra.no); }
    if (!moved.size) return items;
    return items.map((x) => (moved.has(x.id) ? Object.assign({}, x, { extra: Object.assign({}, x.extra, { no: moved.get(x.id) }) }) : x));
  }
  /** One stored entry cleaned, or null when it is not usable (no id or no text). */
  function cleanItem(x) {
    if (!x || typeof x !== "object") return null;
    const id = String(x.id || "").slice(0, 40), text = cleanText(x.text);
    if (!id || !text) return null;
    // only true is "for the client"; "false", 0, null and NO flag are not (sweep 18.11.2026: "for the client" is opt-in;
    // an entry edited by hand, imported, or written without the flag is never published by accident - toJson always
    // writes the flag, so every entry saved by the panel keeps its choice)
    const out = { id, text, date: realDay(x.date) ? x.date : "", client: x.client === true,
      created: String(x.created || "").slice(0, 40), photos: cleanPhotos(x.photos) };
    const no = x.extra && typeof x.extra === "object" ? Math.floor(Number(x.extra.no)) : 0;
    if (no >= 1 && no <= NO_MAX) out.extra = cleanExtra(x.extra);
    return out;
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
    return fixNumbers(sorted(out).slice(0, ITEMS_MAX));
  }
  const toJson = (items) => JSON.stringify({ type: TYPE, version: VERSION, items: sorted(items).slice(0, ITEMS_MAX) }, null, 1);

  /** The values given for an additional work checked: "" when fine, else the error ("qty", "unit", "link", "status", "page"). */
  function checkExtra(x) {
    if (x.qty !== undefined && x.qty !== null && String(x.qty).trim() !== "" && isNaN(cleanQty(x.qty))) return "qty";
    if (x.unit !== undefined && x.unit !== "" && !Object.prototype.hasOwnProperty.call(UNITS, x.unit)) return "unit";
    if (x.link !== undefined && String(x.link || "").trim() && !cleanLink(x.link)) return "link";
    if (x.status !== undefined && !STATUSES.includes(x.status)) return "status";
    if (x.todo !== undefined && String(x.todo || "") && !FILE_ID.test(String(x.todo))) return "todo";
    if (x.page !== undefined && x.page !== null && String(x.page).trim() !== "" && !/^[1-9]\d{0,3}$/.test(String(x.page).trim())) return "page";
    return "";
  }
  /**
   * Apply one change to a list (pure).
   * op: {add: {text, date, client, photos?, extra?: {qty?, unit?, sheet?, page?, where?, link?, status?}}}
   *     | {edit: {id, text?, date?, client?, addPhotos?: [{id, name}], removePhoto?: id, extra?: {status?, qty?, …}}}
   *     | {remove: id}
   * extra on add makes an additional work with the next number; on edit it changes the given fields (a status change
   * stamps `since`). edit.expect {status?, client?}: the values the user saw; when the list has others: error "stale".
   * More errors: "qty", "unit", "link", "status" (a bad value), "numbered" (a numbered entry is not
   * deleted), "op" (extra on an activity).
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
      const item = { id: op.add.id || newId(), text, date, client: op.add.client === true, created: (now || new Date()).toISOString(), photos: cleanPhotos(op.add.photos) };
      if (op.add.extra) {
        // an additional work: the next number of THIS (fresh) list; a retry on a newer list takes that list's next one
        const x = op.add.extra, chk = checkExtra(x);
        if (chk) return { items: list, changed: false, error: chk };
        const day = today || (now || new Date()).toISOString().slice(0, 10);
        item.extra = cleanExtra(Object.assign({}, x, { no: nextNo(list), status: STATUSES.includes(x.status) ? x.status : "pending", since: day }));
      }
      return { items: sorted(list.concat([item])), changed: true, item };
    }
    if (op && op.edit) {
      const i = list.findIndex((x) => x.id === op.edit.id);
      if (i < 0) return { items: list, changed: false, error: "gone" };
      const e = op.edit, cur = list[i], next = Object.assign({}, cur, { photos: (cur.photos || []).slice() });
      // e.expect: what the user saw ({status?, client?}); the list now says otherwise -> "stale", nothing changed (final
      // review 18.11.2026: a status button on a screen left open re-approved a work a colleague had rejected meanwhile)
      if (e.expect && typeof e.expect === "object") {
        if (e.expect.status !== undefined && (!cur.extra || cur.extra.status !== e.expect.status)) return { items: list, changed: false, error: "stale" };
        if (e.expect.client !== undefined && cur.client !== e.expect.client) return { items: list, changed: false, error: "stale" };
      }
      if (e.text !== undefined) { next.text = cleanText(e.text); if (!next.text) return { items: list, changed: false, error: "text" }; }
      if (e.date !== undefined) { if (!okDate(String(e.date))) return { items: list, changed: false, error: "date" }; next.date = String(e.date); }
      if (e.client !== undefined) next.client = !!e.client;
      if (e.extra && typeof e.extra === "object") {
        if (!isExtra(cur)) return { items: list, changed: false, error: "op" };   // an activity is not turned into an additional work
        const chk = checkExtra(e.extra);
        if (chk) return { items: list, changed: false, error: chk };
        const patch = {};
        for (const k of ["status", "qty", "unit", "sheet", "page", "where", "link", "todo", "todoNo"]) if (e.extra[k] !== undefined) patch[k] = e.extra[k];
        const nx = cleanExtra(Object.assign({}, cur.extra, patch));
        if (nx.status !== cur.extra.status) nx.since = today || (now || new Date()).toISOString().slice(0, 10);
        next.extra = nx;
      }
      if (e.removePhoto !== undefined) next.photos = next.photos.filter((p) => p.id !== e.removePhoto);
      if (Array.isArray(e.addPhotos) && e.addPhotos.length) {
        const add = cleanPhotos(e.addPhotos).filter((p) => !next.photos.some((q) => q.id === p.id));
        if (next.photos.length + add.length > PHOTOS_MAX) return { items: list, changed: false, error: "photos" };
        next.photos = next.photos.concat(add);
      }
      const same = ["text", "date", "client"].every((k) => next[k] === cur[k]) && next.photos.map((p) => p.id).join() === (cur.photos || []).map((p) => p.id).join()
        && JSON.stringify(next.extra || null) === JSON.stringify(cur.extra || null);
      list[i] = next;
      return { items: sorted(list), changed: !same, item: next };
    }
    if (op && op.remove !== undefined) {
      const i = list.findIndex((x) => x.id === op.remove);
      if (i < 0) return { items: list, changed: false };   // already gone: nothing to do
      if (isExtra(list[i])) return { items: list, changed: false, error: "numbered" };   // a register number is never freed: reject it instead
      list.splice(i, 1);
      return { items: list, changed: true };
    }
    return { items: list, changed: false, error: "op" };
  }

  /** For the client summary of `date`: the client entries done on or before that day, in the SUMMARY_DAYS before it,
   *  as [{text, date}] (newest first, at most SUMMARY_MAX). Nothing else of an entry goes out. With opts.photos the
   *  entries keep `src`: their first CLIENT_PHOTOS photos [{id, name}] (SOURCE files: copyForClient replaces them). */
  function forSummary(items, date, opts) {
    if (!realDay(date)) return [];
    const from = addDays(date, -SUMMARY_DAYS);
    return sorted((items || []).filter((x) => x && x.client && realDay(x.date) && x.date > from && x.date <= date
      && (!x.extra || (isExtra(x) && CLIENT_STATUSES.includes(x.extra.status)))))
      .slice(0, SUMMARY_MAX).map((x) => {
        // an additional work: its number and text only (no status, quantity, drawing or link)
        const pre = isExtra(x) ? extraNo(x.extra.no) + " · " : "";
        const out = { text: pre + cleanText(x.text).slice(0, TEXT_MAX - pre.length).trim(), date: x.date };
        if (opts && opts.photos && x.photos && x.photos.length) out.src = cleanPhotos(x.photos).slice(0, CLIENT_PHOTOS);
        return out;
      });
  }
  /** The register of additional works: {items (newest number first), counts {status: n}, done {unit: total qty}}. */
  function register(items) {
    const list = (items || []).filter(isExtra).sort((a, b) => b.extra.no - a.extra.no);
    const counts = Object.fromEntries(STATUSES.map((k) => [k, 0])), done = {};
    for (const x of list) {
      counts[x.extra.status]++;
      if (x.extra.status === "done" && x.extra.qty != null && x.extra.unit) done[x.extra.unit] = Math.round(((done[x.extra.unit] || 0) + x.extra.qty) * 1000) / 1000;
    }
    return { items: list, counts, done };
  }
  /** The register as CSV for Excel (BOM, ";" between fields, a decimal comma for bg), oldest number first. labels:
   *  {head: [13 titles], todoUrl?: (todo id) -> URL, status: {key: text}, unit: {key: text}, yes, no, lang}. Staff only: the link is in it.
   *  A cell starting with = + - @ gets a leading ' (no formula runs when it is opened in Excel). */
  function registerCsv(items, labels) {
    const L = labels || {}, bg = L.lang !== "en";
    const cell = (v) => { const s0 = String(v == null ? "" : v), s = /^[=+\-@\t\r]/.test(s0) ? "'" + s0 : s0; return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const num = (q) => (q == null ? "" : bg ? String(q).replace(".", ",") : String(q));
    const head = L.head || ["No", "Date", "Work", "Status", "Since", "Qty", "Unit", "Drawing", "Page", "Place", "Link", "Client", "ToDo"];
    const rows = register(items).items.slice().reverse().map((x) => [extraNo(x.extra.no), x.date, x.text, (L.status || {})[x.extra.status] || x.extra.status,
      x.extra.since, num(x.extra.qty), (L.unit || UNITS)[x.extra.unit] || x.extra.unit, x.extra.sheet, x.extra.page || "", x.extra.where,
      (x.extra.todo && typeof L.todoUrl === "function" ? L.todoUrl(x.extra.todo) : "") || x.extra.link, x.client ? L.yes || "yes" : L.no || "no", x.extra.todoNo || ""]);
    return "\uFEFF" + [head].concat(rows).map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
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
  /** The folder id of _AM_Docs/Activities without creating it; null when missing. Sweep 18.11.2026: ArstenBackup.findFolder
   *  (the id remembered for the tab, every page of each listing, folders/by_path when a level is not listed, a listing
   *  that may be cut off THROWS instead of "missing") - was one plain page per level, walked on every open and save. */
  const findFolder = (core, projectId, opts) => B.findFolder(core, projectId, FOLDER, opts);
  /** Every item of a folder: {items, complete} (ArstenBackup.listFolder). */
  const listAll = (core, folderId) => B.listFolder(core, folderId);
  async function readFile(core, fileId, fetchImpl, versionId) {
    const d = await core.req(`files/fs/${encodeURIComponent(fileId)}/downloadurl${versionId ? "?versionId=" + encodeURIComponent(versionId) : ""}`);
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
    let fid = folderId || (await findFolder(core, projectId));
    if (!fid) return { items: [], folderId: null, fileId: null };
    let l;
    try { l = await listAll(core, fid); }
    catch (e) {
      // a remembered / passed folder id that is gone (deleted, moved) or closed now: forget it, look the path up once more
      if (!(e && (e.status === 404 || e.status === 403))) throw e;
      B.forgetFolder(core, projectId, FOLDER);
      fid = await findFolder(core, projectId, { fresh: true });
      if (!fid) return { items: [], folderId: null, fileId: null };
      l = await listAll(core, fid);
    }
    const listing = l.items;
    const f = listing.find((x) => x && x.name === FILE && String(x.type || "FILE").toUpperCase() !== "FOLDER");
    // a listing that may be cut off (the file on a later page): never take that for "no list yet" (audit)
    if (!f && (!l.complete || listing.length >= LIST_SUSPECT)) throw new Error(`${FILE} not found in a long listing of ${FOLDER.join("/")} – move other files out of it`);
    if (!f) return { items: [], folderId: fid, fileId: null };
    return { items: parse(await readFile(core, f.id, fetchImpl)), folderId: fid, fileId: f.id, version: versionOf(f), versionId: String(f.versionId || "") };
  }
  /** The version stamp of a file entry / file: versionId, else the modified time; "" when Connect gives neither. */
  const versionOf = (f) => String((f && (f.versionId || f.version || f.modifiedOn || f.modifiedTime || f.lastModified)) || "");
  /** The file's version now (GET files/{id}); "" when it cannot be read (the save then goes on as before). */
  async function versionNow(core, fileId) {
    try { return versionOf(await core.req(`files/${encodeURIComponent(fileId)}`)); }
    catch (e) { console.warn("activities: version check failed", e); return ""; }
  }
  /** After our upload: the version saved by someone else that ours replaced, {lost, ours}, or null.
   *  Sweep 18.11.2026 (fix): "ours" was taken to be the newest version. When someone saved right AFTER our commit
   *  (v1 read, v2 ours, v3 theirs) v2 - our own list - was taken for "lost", and the restore uploaded it over v3:
   *  their entry silently gone. Ours is now found for certain: the versionId the commit answered (o.oursId), else the
   *  version after loadedId whose content is exactly the text we uploaded (o.text). Versions after ours are NEWER
   *  saves, never "lost" (their author checks their own save). Null whenever the history cannot be read or ordered,
   *  or ours is not found (the read-back then re-applies our change to the head; nothing old is ever uploaded). */
  async function versionBetween(core, fileId, loadedId, o) {
    if (!loadedId) return null;
    o = o || {};
    try {
      const list = itemsOf(await core.req(`files/${encodeURIComponent(fileId)}/versions`)).filter((v) => v && v.versionId);
      const at = (v) => Date.parse(v.modifiedOn || v.createdOn || v.uploadedOn || "");
      if (list.length < 2 || list.some((v) => !isFinite(at(v)))) return null;
      list.sort((a, b) => at(a) - at(b));
      const i = list.findIndex((v) => v.versionId === loadedId);
      if (i < 0) return null;
      const after = list.slice(i + 1);
      if (after.length === 1) {
        // only one version follows the one we read. Speed sweep 18.11.2026: when it is certainly OURS (the commit's
        // versionId, else its content is exactly what we uploaded) the history PROVES nobody saved in between and nobody
        // after: {clean, ours} - change() then skips the read-back (3 calls). A later save by someone else is caught by
        // their own check. Not certain -> null (read-back as before).
        const v = after[0];
        let mine = !!o.oursId && v.versionId === o.oursId;
        if (!mine && !o.oursId && o.text != null) {
          try { mine = (await readFile(core, fileId, o.fetch, v.versionId)) === o.text; }
          catch (e) { console.warn("activities: a version could not be read", e); return null; }
        }
        return mine ? { clean: true, ours: v.versionId } : null;
      }
      if (after.length < 2) return null;   // ours not in the history yet: uncertain
      let k = o.oursId ? after.findIndex((v) => v.versionId === o.oursId) : -1;
      if (k < 0 && o.text != null) {
        // newest first: usually ours is the head or right below it (one or two small downloads)
        for (let j = after.length - 1; j >= 0 && k < 0; j--) {
          try { if ((await readFile(core, fileId, o.fetch, after[j].versionId)) === o.text) k = j; }
          catch (e) { console.warn("activities: a version could not be read", e); return null; }
        }
      }
      if (k <= 0) return null;   // ours not found (uncertain), or ours directly follows the one we read (newer saves after it: read-back)
      return { lost: after[k - 1].versionId, ours: after[k].versionId };
    } catch (e) { console.warn("activities: version history not read", e); return null; }
  }
  /** Someone else's change (from -> to: the list they read, the list they saved) replayed onto a newer list `head`, by
   *  entry id: their added entries come back, their removed ones go, and their edits are merged FIELD BY FIELD (review
   *  18.11.2026: a whole-entry rule dropped B's "Одобри" when A had changed the quantity of the same work meanwhile -
   *  both told "saved"). A field (text, date, client, each extra.* key) they changed is taken where the head still has
   *  it as they read it; their added / removed photos are added to / removed from the head's. No renumbering here:
   *  A new work of theirs whose number a new work in the head already has takes the next free number; change() moves
   *  its OWN new work when it clashes with theirs. fixNumbers on read stays the last resort for hand-edited files. */
  function replay(head, from, to) {
    const byId = (l) => new Map((l || []).map((x) => [x.id, x]));
    const F = byId(from), T = byId(to), out = byId(head);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const merge = (h, f, t) => {
      const n = Object.assign({}, h);
      for (const k of ["text", "date", "client"]) if (!same(t[k], f[k]) && same(h[k], f[k])) n[k] = t[k];
      const fIds = new Set((f.photos || []).map((p) => p.id)), tIds = new Set((t.photos || []).map((p) => p.id));
      let ph = (h.photos || []).filter((p) => !(fIds.has(p.id) && !tIds.has(p.id)));
      for (const p of t.photos || []) if (!fIds.has(p.id) && !ph.some((q) => q.id === p.id)) ph = ph.concat([p]);
      n.photos = ph.slice(0, PHOTOS_MAX);
      if (h.extra && t.extra && f.extra) {
        const e = Object.assign({}, h.extra);
        for (const k of Object.keys(t.extra)) if (k !== "no" && k !== "since" && !same(t.extra[k], f.extra[k]) && same(h.extra[k], f.extra[k])) e[k] = t.extra[k];
        if (e.status !== h.extra.status) e.since = t.extra.since;
        n.extra = e;
      }
      return n;
    };
    for (const [id, x] of T) {
      if (!F.has(id)) {
        if (out.has(id)) continue;
        // their new work whose number another new work in the head took meanwhile: theirs moves on. Its author may
        // already have been shown the old number (three saves within about a second); the register then shows the
        // new one - accepted, rare (final review 18.11.2026)
        const clash = isExtra(x) && [...out.values()].some((y) => isExtra(y) && y.extra.no === x.extra.no);
        out.set(id, clash ? Object.assign({}, x, { extra: Object.assign({}, x.extra, { no: nextNo([...out.values()].concat([x])) }) }) : x);
      }
      else if (!same(F.get(id), x) && out.has(id)) out.set(id, merge(out.get(id), F.get(id), x));
    }
    for (const id of F.keys()) if (!T.has(id)) out.delete(id);
    return sorted([...out.values()]);
  }
  /** Is the change op visible in items (after an upload)? */
  function landed(items, op, item) {
    if (op.add) return !!item && items.some((x) => x.id === item.id);
    if (op.remove !== undefined) return !items.some((x) => x.id === op.remove);
    if (op.edit) {
      const x = items.find((i) => i.id === op.edit.id);
      if (!x || !item) return false;
      const ids = new Set((x.photos || []).map((p) => p.id));
      return ["text", "date", "client"].every((k) => x[k] === item[k]) && (item.photos || []).every((p) => ids.has(p.id))
        && (!op.edit.extra || JSON.stringify(Object.assign({}, x.extra, { no: 0, since: "" })) === JSON.stringify(Object.assign({}, item.extra, { no: 0, since: "" })))
        && (op.edit.removePhoto === undefined || !ids.has(op.edit.removePhoto));
    }
    return true;
  }
  /**
   * One change: read the file afresh, apply op, upload when something changed. Returns {items, changed, error?, item?,
   * folderId?, base?}. o: {core, projectId, op, today, fetch, folderId?, base?}.
   * Speed sweep 18.11.2026 (a tap cost ~10 serial Core calls, 3-6 s of "saving" on a phone):
   *  - o.base: what the panel already has, {fileId, folderId, versionId, version, items} (a load() result, or the `base`
   *    of the change before). The file's version is asked once (GET files/{id}); still the same -> that list is used
   *    instead of reading the folder and the file again; changed (or unknown) -> read afresh as before;
   *  - after the upload the version history is read anyway (someone else's save in between). When it shows exactly one
   *    version after the one we read and that version is certainly ours, nobody saved in between and nobody after: the
   *    read-back (3 calls) is skipped. Any doubt -> read-back as before.
   * The result's `base` is what the next change can pass as o.base (absent when the state after the save is not known).
   */
  async function change(o) {
    let op = o.op, changed = false, item = null, base = null, folderHint = o.folderId || null, refound = false;
    const b0 = o.base;
    if (b0 && b0.fileId && b0.version && Array.isArray(b0.items)) {
      const v = await versionNow(o.core, b0.fileId);
      if (v && v === String(b0.version)) {
        base = { items: b0.items.slice(), folderId: b0.folderId || o.folderId || null, fileId: b0.fileId, version: v, versionId: String(b0.versionId || ""), checked: true };
        if (base.folderId) folderHint = base.folderId;
      }
    }
    // theirs: {from, to} = someone else's save that our last upload replaced (the list they read, the list they saved);
    // replayed onto the list read afresh in the next try (sweep 18.11.2026 fix: was uploaded as it was - an OLD list
    // over the current head, which wiped a colleague's entry saved right after ours)
    let theirs = null;
    const clock = o.clock || (() => Date.now());
    for (let n = 0; n < SAVE_TRIES; n++) {
      // sweep 18.11.2026: the folder id the panel already knows (o.folderId) / the one found by the try before is passed
      // on, so a save does not walk project -> root -> _AM_Docs -> Activities again
      const fresh = !base || !!base.checked, loadedAt = clock();
      const cur = base || (await load(o.core, o.projectId, o.fetch, folderHint));
      base = null;
      if (cur.folderId) folderHint = cur.folderId;
      // review 18.11.2026: our new work already in the head (our upload) is set aside while theirs is replayed, then put
      // back; when its number clashes with theirs it moves to the next free number - theirs keeps the number its author
      // was already shown (ours was not confirmed to anyone yet). Only the number changes: what others did to our entry
      // since (an approval, photos) stays (re-review: rebuilding it from op.add wiped that)
      const mine = theirs && op.add && op.add.extra && op.add.id ? cur.items.find((x) => x.id === op.add.id && isExtra(x)) : null;
      let start = theirs ? replay(mine ? cur.items.filter((x) => x !== mine) : cur.items, theirs.from, theirs.to) : cur.items;
      if (mine) {
        const clash = start.some((x) => isExtra(x) && x.extra.no === mine.extra.no);
        start = sorted(start.concat([clash ? Object.assign({}, mine, { extra: Object.assign({}, mine.extra, { no: nextNo(start) }) }) : mine]));
      }
      // their list still has to go back up when it differs from the head (our upload replaced it), even when our change
      // no longer applies to it (they removed the entry, or did the same)
      const restoring = !!theirs && toJson(start) !== toJson(cur.items);
      const r = apply(start, op, o.today, o.now);
      if (r.error && !restoring) return { items: cur.items, changed, error: r.error, item: r.item, folderId: cur.folderId, base: baseOf(cur) };   // the real reason ("gone", "photos"…)
      if (!r.changed && !restoring) return { items: cur.items, changed, item: r.item, folderId: cur.folderId, base: baseOf(cur) };
      const next = r.error || !r.changed ? start : r.items;
      if (r.changed || r.item) item = r.item;
      if (op.add && item) op = { add: Object.assign({}, op.add, { id: item.id }) };   // the same id on a second try
      // sweep 18.11.2026: someone else saved since we read (A reads, B saves, A uploads A's old list + A's change ->
      // B's entry silently gone, and both read-backs look fine, since each only checks its own change).
      //  1. just before uploading the file's version (from the listing we read) is read again; changed -> read afresh
      //     and apply our change on top of theirs instead of uploading;
      //  2. after uploading, the file's version history: a version between the one we read and OURS is someone else's
      //     save that ours replaced -> their change is replayed onto the head read afresh, ours applied, uploaded again.
      // sweep 18.11.2026: a list read in this same try less than FRESH_MS ago is not asked for its version again (one
      // call less per tap); a save landing in that moment is still caught by the version history check below
      if (cur.fileId && cur.version && !(fresh && clock() - loadedAt < FRESH_MS)) {
        const now = await versionNow(o.core, cur.fileId);
        if (now && now !== cur.version) continue;   // theirs (if any) is replayed onto that newer list
      }
      // folder missing now: no cached id (it may be a deleted folder); ensureFolder looks it up / creates it afresh
      const folderId = cur.folderId || (await B.ensureFolder(o.core, o.projectId, FOLDER, new Map()));
      if (!cur.folderId && !refound) {
        // sweep 18.11.2026: the lookup missed a folder that does exist (ensureFolder found it): read the list there
        // first - uploading now would replace the whole list with just this one entry
        refound = true;
        const again = await load(o.core, o.projectId, o.fetch, folderId);
        if (again.fileId) { base = again; folderHint = folderId; n--; continue; }
      }
      const text = toJson(next);
      let oursId = "";
      await B.uploadJson(o.core, folderId, FILE, text, { fetch: o.fetch,
        onCommit: (d) => { oursId = String((d && (d.versionId || (d.file && d.file.versionId) || (d.data && d.data.versionId))) || ""); } });
      changed = true; theirs = null;
      if (r.error) return { items: next, changed, error: r.error, item: r.item, folderId };   // their list is back; ours cannot apply
      const between = cur.fileId ? await versionBetween(o.core, cur.fileId, cur.versionId, { oursId, text, fetch: o.fetch }) : null;
      if (between && between.clean) {
        // the history proves ours is the head right after the list we read: no read-back needed
        return { items: next, changed, item, folderId, base: { items: next, folderId, fileId: cur.fileId, versionId: between.ours, version: between.ours } };
      }
      if (between && n < SAVE_TRIES - 1) {
        try {
          theirs = { from: cur.items, to: parse(await readFile(o.core, cur.fileId, o.fetch, between.lost)) };
          console.warn("activities: another save landed while ours was uploading - replaying it onto the newest list");
          folderHint = folderId;
          continue;
        } catch (e) { theirs = null; console.warn("activities: the other save could not be read", e); }
      }
      // read back: another person's upload at the same moment may have replaced ours
      let back;
      try { back = await load(o.core, o.projectId, o.fetch, folderId); }
      catch (e) { console.warn("activities: read-back failed after a successful upload", e); return { items: next, changed, item, folderId }; }   // saved; just not re-checked
      if (landed(back.items, op, item)) return { items: back.items, changed, item, folderId, base: baseOf(back) };
      folderHint = folderId;
    }
    return { items: (await load(o.core, o.projectId, o.fetch, folderHint)).items, changed, error: "conflict", item, folderId: folderHint };
  }

  /** What change() can start from next time (o.base): a list read with its file and version, else undefined. */
  function baseOf(cur) {
    return cur && cur.fileId && cur.version ? { items: cur.items, folderId: cur.folderId || null, fileId: cur.fileId, versionId: cur.versionId || "", version: cur.version } : undefined;
  }

  // ---------- photos ----------
  const pad = (n) => String(n).padStart(2, "0");
  /** File name of a photo: act-<day>-<HHMMSS>-<4 random>.jpg (unique, sortable, no names of people). */
  function photoName(day, at) {
    const d = at || new Date();
    return `act-${day}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}.jpg`;
  }
  /** Name of a photo's thumbnail: <name>_t.jpg (as ArstenPhotos.thumbName). */
  const thumbName = (name) => String(name || "").replace(/(\.jpe?g)?$/i, "_t.jpg");
  /** initiate -> PUT -> commit of one JPEG into a folder; returns the file id (looked up in the folder, every page, when
   *  the commit answers without one: a one-page look-up reported a photo that did upload as failed, sweep 18.11.2026). */
  async function putFile(o, f, folderId, name, blob) {
    const init = await o.core.req("files/fs/initiate", "POST", { parentId: folderId, parentType: "FOLDER", name });
    if (!init || !init.uploadURL) throw new Error("upload: no upload URL");
    await putPhoto(f, init.uploadURL, blob, o);
    const done = await o.core.req("files/fs/commit", "POST", { uploadId: init.uploadId });
    let id = done && (done.id || done.fileId || (done.file && done.file.id) || (done.data && done.data.id));
    for (let i = 0; !id && i < 10; i++) {   // commit can finish asynchronously: look the file up in its folder
      await new Promise((r) => setTimeout(r, o.lookMs == null ? 800 : o.lookMs));
      const x = (await listAll(o.core, folderId)).items.find((y) => y && y.name === name);
      if (x) id = x.id;
    }
    if (!id) throw new Error("upload: file id not returned");
    return id;
  }
  /**
   * Upload one prepared JPEG (ArstenPhotos.prepareImage) to _AM_Docs/Activities/Photos/<day>/. Returns {id, name,
   * thumbId?}. With o.thumb (prepareImage's ~25 KB img.thumb) the thumbnail goes next to it as <name>_t.jpg (sweep
   * 18.11.2026: the list and the client's Статус loaded the ~1 MB 2560 px photo for every tile). Best effort: a photo
   * whose thumbnail fails is still returned without thumbId (the list then shows the photo itself).
   * o: {core, projectId, blob, thumb?, day, fetch, folderCache (Map, optional), at}
   */
  async function uploadPhoto(o) {
    const day = realDay(o.day) ? o.day : null;
    if (!day) throw new Error("photo: day YYYY-MM-DD required");
    // the day folder's lookup / create is shared as a promise in o.folderCache, so photos uploaded side by side (speed
    // sweep 18.11.2026) never create the same <day> folder twice
    const cache = o.folderCache || new Map(), jobKey = "job:" + day;
    if (!cache.has(jobKey)) cache.set(jobKey, B.ensureFolder(o.core, o.projectId, FOLDER.concat([PHOTOS, day]), cache).catch((e) => { cache.delete(jobKey); throw e; }));
    const folderId = await cache.get(jobKey);
    const name = photoName(day, o.at);
    const f = o.fetch || ((...a) => fetch(...a));
    // speed sweep 18.11.2026: the photo and its thumbnail go up side by side (were one after the other: 6 calls in a
    // row). A thumbnail left behind by a photo that failed is a ~25 KB file nothing points to (harmless).
    const [id, thumbId] = await Promise.all([putFile(o, f, folderId, name, o.blob),
      o.thumb ? putFile(o, f, folderId, thumbName(name), o.thumb).catch((e) => { console.warn("activities: thumbnail not uploaded", e); return null; }) : null]);
    const out = { id, name };
    if (thumbId) out.thumbId = thumbId;
    return out;
  }
  // ---------- photo transfers with a timeout (sweep 18.11.2026) ----------
  const UPLOAD_MS = (B && B.UPLOAD_TIMEOUT_MS) || 120000, DOWNLOAD_MS = 60000;
  const timeoutText = (B && B.TIMEOUT_TEXT) || "Connect не отговаря (време за изчакване)";
  /** fetch with a time limit (body included): ArstenBackup.send when loaded, else an AbortController race. */
  async function timed(f, url, init, o) {
    if (B && typeof B.send === "function") return B.send(f, url, init, o);
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    let timer = null;
    const late = new Promise((_, reject) => { timer = setTimeout(() => { try { if (ac) ac.abort(); } catch {} reject(Object.assign(new Error(`${timeoutText} – ${o.what}`), { status: 0, timeout: true })); }, o.ms); });
    try {
      return await Promise.race([(async () => {
        const res = await f(url, ac ? Object.assign({}, init, { signal: ac.signal }) : init);
        if (o.read === "blob") return { res, blob: res.ok ? (typeof res.blob === "function" ? await res.blob() : await res.text()) : null };
        return { res };
      })(), late]);
    } finally { clearTimeout(timer); }
  }
  /** PUT a JPEG to a presigned upload URL (UPLOAD_MS, o.timeoutMs in tests). Throws on a failed or stalled PUT. */
  async function putPhoto(f, url, blob, o) {
    const got = await timed(f, url, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" } },
      { path: "upload", what: "upload PUT", ms: (o && o.timeoutMs) || UPLOAD_MS, sleep: o && o.sleep });
    const put = got && got.res;
    if (!put || !put.ok) throw new Error(`upload PUT ${put ? put.status : "?"}`);
    return put;
  }
  /** Download a photo's bytes (DOWNLOAD_MS, o.downloadMs in tests): one stalled photo fails alone, the publish goes on. */
  async function getPhoto(f, url, o) {
    const got = await timed(f, url, { method: "GET" }, { path: "download", what: "photo download", ms: (o && o.downloadMs) || DOWNLOAD_MS, read: "blob", sleep: o && o.sleep });
    const res = got && got.res;
    if (!res || !res.ok) throw new Error("photo download " + (res ? res.status : "?"));
    return got.blob;
  }

  /** Name of the client copy of a source photo: act-<source id>.jpg; a fresh copy made because a file of that name was
   *  not trusted gets act-<source id>.<random>.jpg (a "." never occurs in the cleaned id) (sweep 18.11.2026). */
  const clientName = (srcId, unique) => `act-${String(srcId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80)}${unique ? "." + unique : ""}.jpg`;
  const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
  /** The uploader of a listing entry's CURRENT version ({id, email, tiduuid}), as client-summary.js uploaderOf: a new
   *  version uploaded over a trusted copy by someone else is that someone's. */
  function uploaderOf(it) {
    const u = (it && (it.modifiedBy || it.createdBy)) || null;
    if (!u || typeof u !== "object") return null;
    const r = { id: u.id || u.userId || "", email: u.email || "", tiduuid: u.tiduuid || u.tidUuid || "" };
    return r.id || r.email || r.tiduuid ? r : null;
  }
  // The users allowed to publish for the client: Connect project ADMINs + members of the groups ADMIN and EXECUTION
  // PROJECT MANAGER - the same rule as trustedUploaders in viewer-project-status/client-summary.js (change together).
  const TRUSTED_GROUPS = ["admin", "execution project manager"];
  const groupKey = (n) => {
    const g = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : {};
    return g.ArstenAccess && g.ArstenAccess.groupKey ? norm(g.ArstenAccess.groupKey(n)) : norm(n).replace(/^\d+(?:[.,]\d+)*\s*[.)\-_:]?\s*/, "").trim();
  };
  async function trustedPublishers(core, projectId) {
    const pid = encodeURIComponent(projectId);
    const [users, groups] = await Promise.all([core.req(`projects/${pid}/users`), core.req(`groups?projectId=${pid}`)]);
    const mine = itemsOf(groups).filter((g) => g && g.id && TRUSTED_GROUPS.includes(groupKey(g.name)));
    const members = await Promise.all(mine.map((g) => core.req(`groups/${encodeURIComponent(g.id)}/users`)));
    return [...itemsOf(users).filter((u) => u && norm(u.role) === "admin"), ...members.flatMap(itemsOf)].filter(Boolean)
      .map((u) => ({ id: u.id || "", email: u.email || "", tiduuid: u.tiduuid || "" }));
  }
  const sameUser = (a, b) => !!a && !!b && ((a.id && b.id && a.id === b.id) || (a.email && b.email && norm(a.email) === norm(b.email))
    || (a.tiduuid && b.tiduuid && a.tiduuid === b.tiduuid));
  /**
   * Copy the photos of the summary entries (forSummary(..., {photos: true}): `src`) to _AM_Docs/Client/Photos/<YYYY-MM>/
   * and return the entries with `photos: [client file id]` (and `thumbs: [client thumbnail id or ""]`, same order, when a
   * source photo has a thumbnail - sweep 18.11.2026) instead of `src`. A photo already copied (act-<source id>.jpg
   * or act-<source id>.<x>.jpg in that folder) is reused ONLY when its current version was uploaded by the current user
   * (o.me) or a trusted publisher (o.trusted: [{id, email, tiduuid}]; when not given, read once from the project's
   * users and groups as client-summary.js trustedUploaders does); any other file of that name is ignored and the photo copied afresh under a unique name.
   * A photo that cannot be copied (or stalls: 60 s download, 120 s upload) is left out (counted in `failed`); the entry
   * still goes out.
   * o: {core, projectId, site, fetch, trusted?, me?, thumbs? (false: thumbnails not copied - the summary will not carry
   * them), pool? (COPY_POOL), onProgress(done, total)} -> {site, copied, reused, failed, ignored}
   * Speed sweep 18.11.2026: was one photo after another (~12 calls and a 1-2.5 MB download + upload each, in a row:
   * minutes for 20 photos on site). The photos are now jobs run COPY_POOL at once; the month folder and its listing
   * are looked up once (shared promises), and the result is put back in entry and photo order.
   */
  async function copyForClient(o) {
    const f = o.fetch || ((...a) => fetch(...a));
    const cache = new Map(), listings = new Map(), folders = new Map(), copies = new Map();
    const total = (o.site || []).reduce((n, x) => n + ((x && x.src) || []).length, 0);
    let copied = 0, reused = 0, failed = 0, done = 0, ignored = 0;
    const me = o.me || null;
    // the trusted publishers: o.trusted, else read once - only when a file under a copy's name is actually found
    // (one shared promise: parallel jobs do not each read the project's users and groups)
    let trustedP = o.trusted ? Promise.resolve(o.trusted.slice()) : null;
    const trust = async () => {
      if (!trustedP) trustedP = trustedPublishers(o.core, o.projectId).catch((e) => { console.warn("client photos: publishers not read - nothing is reused", e); return []; });
      const trusted = await trustedP;
      return me ? trusted.concat([me]) : trusted;
    };
    /** The month folder, looked up / created once per month (a failed lookup is tried again by the next job). */
    const folderOf = (month) => {
      if (!folders.has(month)) folders.set(month, B.ensureFolder(o.core, o.projectId, CLIENT_FOLDER.concat([month]), cache).catch((e) => { folders.delete(month); throw e; }));
      return folders.get(month);
    };
    /** The month folder's listing, read once and shared (copies made in this run are added to it). */
    const listingOf = (folderId) => {
      if (!listings.has(folderId)) listings.set(folderId, listAll(o.core, folderId).then((l) => l.items.slice()).catch((e) => { listings.delete(folderId); throw e; }));
      return listings.get(folderId);
    };
    // ---- the source must be a Дейности photo (sweep 18.11.2026, security) ----
    // activities.json is a plain file any 02.GENERAL CONTRACTOR member can write: an entry could name ANY project file
    // (a backup with names and notes, a contract, a Монолитен бетон photo) and the PM's own token would copy it into the
    // client's folder. So a source is copied (or an earlier copy reused) only when Connect says it is a .jpg of at most
    // SOURCE_MAX bytes inside _AM_Docs/Activities/Photos/<day>/; anything else is left out (counted in `failed`).
    let photosP = null;   // {root, days: Set of day folder ids, complete}, read once per publish
    const photoDays = () => {
      if (!photosP) photosP = (async () => {
        const root = await B.findFolder(o.core, o.projectId, FOLDER.concat([PHOTOS]));
        if (!root) return { root: null, days: new Set(), complete: true };
        const l = await listAll(o.core, root);
        return { root, complete: l.complete, days: new Set(l.items.filter((y) => y && y.id && String(y.type || "").toUpperCase() === "FOLDER" && realDay(String(y.name || ""))).map((y) => y.id)) };
      })().catch((e) => { photosP = null; throw e; });
      return photosP;
    };
    const dayChecks = new Map();   // parent folder id -> Promise<boolean>
    const inPhotos = (parent) => {
      if (!dayChecks.has(parent)) dayChecks.set(parent, (async () => {
        const d = await photoDays();
        if (!d.root) return false;
        if (d.days.has(parent)) return true;
        if (d.complete) return false;
        // the Photos listing may be cut off (a long project): ask Connect about this folder itself
        const fo = await o.core.req(`folders/${encodeURIComponent(parent)}`);
        return !!fo && (fo.parentId || (fo.parent && fo.parent.id)) === d.root && realDay(String(fo.name || ""));
      })().catch((e) => { dayChecks.delete(parent); throw e; }));
      return dayChecks.get(parent);
    };
    const sourceChecks = new Map();   // source id -> Promise (rejects when the file must not go to the client)
    const checkSource = (srcId) => {
      if (!sourceChecks.has(srcId)) sourceChecks.set(srcId, (async () => {
        const x = await o.core.req(`files/${encodeURIComponent(srcId)}`);
        const name = String((x && x.name) || ""), parent = (x && (x.parentId || (x.parent && x.parent.id))) || "", size = Number(x && x.size);
        const why = !/\.jpe?g$/i.test(name) ? "not a .jpg" : isFinite(size) && size > SOURCE_MAX ? "too big" : !parent || !(await inPhotos(parent)) ? "not in _AM_Docs/Activities/Photos" : "";
        if (why) { console.warn("client photo refused: " + why, srcId, name); throw Object.assign(new Error("client photo refused: " + why), { refused: true }); }
      })().catch((e) => { if (!(e && e.refused)) sourceChecks.delete(srcId); throw e; }));   // a network error is asked again
      return sourceChecks.get(srcId);
    };
    const ok = (it, list) => { const by = uploaderOf(it); return !!by && list.some((u) => sameUser(u, by)); };
    const isCopyOf = (name, srcName) => name === srcName || (name.startsWith(srcName.slice(0, -4) + ".") && /^\.[a-z0-9]+\.jpg$/.test(name.slice(srcName.length - 4)));
    /** The client copy of one source file in the month folder: {id, reused}. Throws when it cannot be copied. */
    async function copyOne(folderId, srcId) {
      // checked before a reuse too: a copy made before this check existed is never shown again for a foreign source
      const [listing] = await Promise.all([listingOf(folderId), checkSource(srcId)]);
      const base = clientName(srcId);
      const same = listing.filter((y) => y && y.id && isCopyOf(String(y.name || ""), base) && String(y.type || "FILE").toUpperCase() !== "FOLDER");
      const have = same.find((y) => y.mine) || (same.length ? same.find(((list) => (y) => ok(y, list))(await trust())) : null);
      if (have) return { id: have.id, reused: true };
      // a file under the plain name not uploaded by us / a publisher: never shown to the client, copy afresh
      if (same.length) { ignored += same.length; console.warn("client photo: untrusted file(s) under the copy's name ignored", same.map((y) => y.name)); }
      const name = same.some((y) => y.name === base) ? clientName(srcId, Math.random().toString(36).slice(2, 8)) : base;
      const url = await photoUrl(o.core, srcId);
      if (!url) throw new Error("no download URL");
      const blob = await getPhoto(f, url, o);
      const bytes = blob == null ? 0 : typeof blob.size === "number" ? blob.size : String(blob).length;
      if (bytes > SOURCE_MAX) throw new Error("client photo refused: too big (" + bytes + " bytes)");   // Connect gave no size
      const id = await putFile(o, f, folderId, name, blob);
      listing.push({ id, name, type: "FILE", mine: true });   // copied in this run: ours
      return { id, reused: false };
    }
    /** copyOne once per month folder + source file: the same photo in two entries is copied once (reused after). */
    const copyOnce = (folderId, srcId) => {
      const k = folderId + "|" + srcId;
      if (copies.has(k)) return copies.get(k).then((c) => Object.assign({}, c, { reused: true }));
      const p = copyOne(folderId, srcId);
      copies.set(k, p);
      p.catch(() => { copies.delete(k); });
      return p;
    };
    const withThumbs = o.thumbs !== false;
    const jobs = [];
    (o.site || []).forEach((x, ei) => ((x && x.src) || []).forEach((p) => jobs.push({ ei, p, month: String((x && x.date) || "").slice(0, 7) })));
    const results = await mapLimit(jobs, o.pool || COPY_POOL, async ({ p, month }) => {
      let r = null;
      try {
        const folderId = await folderOf(month);
        const c = await copyOnce(folderId, p.id);
        if (c.reused) reused++; else copied++;
        // sweep 18.11.2026: the thumbnail is copied too (act-<thumb source id>.jpg, the same trust rules), so the
        // client's phone shows ~25 KB tiles instead of the 2560 px photo; best effort, "" = none (the photo is shown)
        let t = "";
        if (withThumbs && p.thumbId) {
          try { t = (await copyOnce(folderId, p.thumbId)).id; }
          catch (err) { console.warn("client photo thumbnail not copied", p.thumbId, err); }
        }
        r = { id: c.id, thumb: t };
      } catch (err) { console.warn("client photo not copied", p && p.id, err); failed++; }
      done++;
      if (o.onProgress) o.onProgress(done, total);
      return r;
    });
    // back in entry and photo order
    const got = (o.site || []).map(() => ({ ids: [], thumbs: [] }));
    jobs.forEach((j, i) => { const r = results[i]; if (r) { got[j.ei].ids.push(r.id); got[j.ei].thumbs.push(r.thumb); } });
    const site = (o.site || []).map((x, i) => {
      const e = { text: x.text, date: x.date };
      if (got[i].ids.length) e.photos = got[i].ids;
      // thumbs[i] is the thumbnail of photos[i]; only written when there is at least one (older summaries have none)
      if (got[i].thumbs.some(Boolean)) e.thumbs = got[i].thumbs;
      return e;
    });
    return { site, copied, reused, failed, ignored };
  }
  /** Download URL of a photo (for the thumbnail / full view); "" when Connect gives none. */
  async function photoUrl(core, fileId) {
    const d = await core.req(`files/fs/${encodeURIComponent(fileId)}/downloadurl`);
    return (d && (d.url || d.downloadUrl || d.href)) || "";
  }

  return { STATUSES, UNITS, CLIENT_STATUSES, extraNo, isExtra, nextNo, fixNumbers, cleanLink, cleanQty, register, registerCsv, COPY_POOL, CLIENT_PHOTOS, SOURCE_MAX, CLIENT_FOLDER, clientName, copyForClient, TYPE, VERSION, FOLDER, FILE, PHOTOS, TEXT_MAX, ITEMS_MAX, PHOTOS_MAX, SUMMARY_DAYS, SUMMARY_MAX, parse, toJson, sorted, apply,
    forSummary, byWeek, weekOf, addDays, load, change, replay, uploadPhoto, photoUrl, photoName, thumbName, realDay, findFolder };
});
