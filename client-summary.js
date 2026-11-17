// Client summary ("Публикувай за клиента", B-Client 1, week 3): ONE client-safe JSON per project per day, published by
// admin / GC to the project folder _ArstenDocs/Client/summary-<YYYY-MM-DD>.json (Core 2.0 upload, same name the same day
// = a new version of that file). The client view reads ONLY these files when any exist (owner decision 2 pending).
//
// What a summary holds: totals per stage in the stage's own unit (m², kg, m³), per pour: label, type, object count, per
// stage the date it was completed (or null), how many objects are done and how many of those are "without" (na: the step
// does not apply, e.g. "Без кофраж"; version 2, round 10 H1), "rebar accepted" yes / pending / none; counts;
// the PM's free-text note for the client; "based on" (stage name, model names + versions, the date).
// What it NEVER holds: names (who marked / decided / requested), internal notes, history logs, rejection texts, ToDo ids.
// build() takes only the fields listed above; validate() rejects any key outside the whitelist (and names the forbidden
// ones), so a summary that would leak cannot be published or shown.
// Pure, no network except findFolder/listSummaries/readSummary, which take a Core client {req} (shared/arsten-backup.js).
// Browser: window.ClientSummary; node: require.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const req2 = (a, b) => { try { return require(a); } catch { return require(b); } };
  const lib = factory(node ? require("./progress.js") : root.ProjectProgress, node ? require("./status.js") : root.PourStatus,
    node ? req2("../shared/arsten-acceptance.js", "./arsten-acceptance.js") : root.ArstenAcceptance,
    node ? req2("../shared/arsten-access.js", "./arsten-access.js") : root.ArstenAccess);
  if (node) module.exports = lib;
  else root.ClientSummary = lib;
})(typeof self !== "undefined" ? self : this, function (P, S, ACC, AX) {
  "use strict";

  const TYPE = "arsten-client-summary", VERSION = 2;   // 2: per pour step "na" (round 10 H1); version 1 files are still read
  const FOLDER = ["_ArstenDocs", "Client"];
  const NOTE_MAX = 2000;
  const STEP_IDS = S.STEPS.map((s) => s.id);
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const NAME_RE = /^summary-(\d{4}-\d{2}-\d{2})\.json$/;

  const fileName = (day) => `summary-${day}.json`;
  /** The day of a summary file name, only for exactly "summary-YYYY-MM-DD.json" with a real calendar day (round 11 M2). */
  const dayOfName = (name) => {
    const m = NAME_RE.exec(typeof name === "string" ? name : "");
    if (!m) return null;
    const [y, mo, d] = m[1].split("-").map(Number), dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? m[1] : null;
  };
  const pad = (n) => String(n).padStart(2, "0");
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function addDays(day, n) { const d = new Date(day + "T00:00:00"); d.setDate(d.getDate() + n); return dayOf(d); }
  const round = (v, dec) => { const f = Math.pow(10, dec); return Math.round((Number(v) || 0) * f) / f; };
  const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

  /** Rebar acceptance of a pour from merged acceptance records (ArstenAcceptance.merge): "yes" (approved, also with
   *  remarks), "pending" (asked, not decided, or rejected – the rejection itself is never shown), "none" (never asked).
   *  accepted null/undefined (not read, e.g. the client's live view): null. */
  function rebarState(accepted, label, index) {
    if (!accepted) return null;
    const r = index ? index.get(label) || null : ACC.latestCovering(accepted, label, "rebar");
    if (!r) return "none";
    return r.status === "approved" || r.status === "remarks" ? "yes" : "pending";
  }
  /** Round 12 M5: the latest request covering the rebar of each pour, from ONE pass over the requests (was: every pour
   *  filtered and sorted all of them, O(pours x requests)). Each pour's requests keep their original order, so
   *  ACC.latestCovering picks exactly the record it picked from the whole list. Map pour label -> record; kept per
   *  `accepted` array (a new read is a new array), so re-renders of the same data do not group again. */
  const rebarIndexes = new WeakMap();
  function rebarIndex(accepted) {
    if (!accepted) return null;
    const hit = rebarIndexes.get(accepted);
    if (hit) return hit;
    const byPour = new Map();
    for (const r of accepted) {
      if (!r || !ACC.valid(r)) continue;
      const l = byPour.get(r.pour);
      if (l) l.push(r); else byPour.set(r.pour, [r]);
    }
    const index = new Map();
    for (const [pour, rs] of byPour) { const r = ACC.latestCovering(rs, pour, "rebar"); if (r) index.set(pour, r); }
    rebarIndexes.set(accepted, index);
    return index;
  }
  // Pour/Такт property names as the Arsten_PourExport macro writes them (common.js P.type / P.volume)
  const PT_TYPE = "Pour_Type/Тип_Такт", PT_VOLUME = "Concrete_Volume/Обем_Бетон";
  /** The pour's type for the client: the type with the most concrete in the pour (a footing pour with a few pedestals
   *  is "Footing"), so "По тип" groups make sense; without object properties all types joined with " + ". */
  function pourType(g) {
    const byType = new Map();
    for (const o of (g && g.objects) || []) {
      const pr = o && o.props;
      const ty = pr && String(pr[PT_TYPE] == null ? "" : pr[PT_TYPE]).trim();
      if (!ty) continue;
      const v = parseFloat(String(pr[PT_VOLUME] == null ? "" : pr[PT_VOLUME]).replace(",", "."));
      byType.set(ty, (byType.get(ty) || 0) + (isFinite(v) ? v : 0));
    }
    if (byType.size) return [...byType].sort((a, b) => b[1] - a[1])[0][0];
    return (Array.isArray(g && g.types) ? g.types : g && g.types ? [...g.types] : []).filter(Boolean).join(" + ");
  }

  /**
   * The client summary for one day. Only whitelisted fields are copied, whatever the inputs carry.
   * @param o {date: "YYYY-MM-DD", now?: Date, project?: {id, name}, objects: [{guid, pour, volume, formwork, rebar}],
   *           pours: [{label, types, objects: [{guid}]}], records: Map guid -> status record (any; reduced to steps/dates here),
   *           accepted?: merged acceptance records or null, note?: string, basedOn?: {stage, models: [{name, version, date}]}}
   */
  function build(o) {
    const date = o.date;
    if (!DAY_RE.test(String(date || ""))) throw new Error("summary: date YYYY-MM-DD required");
    const now = o.now instanceof Date ? o.now : new Date(o.now == null ? Date.now() : o.now);
    const recs = P.recordsAsOf(o.records || new Map(), date);
    const from = addDays(date, -7);
    const prev = P.recordsAsOf(o.records || new Map(), from);
    const ov = P.overall(o.objects || [], recs), ovPrev = P.overall(o.objects || [], prev);
    const totals = {};
    for (const id of STEP_IDS) {
      const s = ov.steps[id];
      totals[id] = { qty: round(s.qty, 2), total: round(s.total, 2), unit: str(s.unit, 8), pct: round(s.pct, 4),
        pours: ov.poursComplete[id] || 0, weekQty: round(s.qty - ovPrev.steps[id].qty, 2) };
    }
    const rows = P.perPour(o.pours || [], recs);
    const accIndex = rebarIndex(o.accepted);
    const pours = rows.map((r, i) => {
      const steps = {};
      for (const id of STEP_IDS) { const c = r.steps[id]; steps[id] = { date: c.complete && c.date ? c.date : null, done: c.done, na: c.na || 0 }; }
      return { label: str(r.label, 100), type: str(pourType(o.pours[i]), 200), objects: r.total, steps, rebar: rebarState(o.accepted, r.label, accIndex) };
    });
    const complete = (p, id) => p.objects > 0 && p.steps[id].done === p.objects;
    const pouredPours = pours.filter((p) => complete(p, "poured"));
    const counts = {
      pours: pours.length, objects: (o.objects || []).length,
      rebarAccepted: pours.filter((p) => p.rebar === "yes").length,
      rebarPending: pours.filter((p) => p.rebar === "pending").length,
      poured: pouredPours.length,
      pouredWithAcceptedRebar: pouredPours.filter((p) => p.rebar === "yes").length,
    };
    const b = o.basedOn || {};
    return {
      type: TYPE, version: VERSION, date, published: now.toISOString(),
      project: { id: str(o.project && o.project.id, 100), name: str(o.project && o.project.name, 200) },
      clientNote: str(o.note, NOTE_MAX),
      basedOn: { stage: str(b.stage, 200), date,
        models: (b.models || []).slice(0, 50).map((m) => ({ name: str(m && m.name, 200), version: str(m && m.version, 100), date: DAY_RE.test(String(m && m.date)) ? m.date : "" })) },
      acceptance: !!o.accepted,
      counts, totals, week: { from }, pours,
    };
  }

  /** Round 12 M5: build() for the live view, remembered for the last inputs. A re-render with the same day, records,
   *  acceptance, objects, pours, project and "based on" (language, "По тип", the slider back on the same day) reuses the
   *  last summary instead of building it again. The arrays / maps are compared by identity: every read replaces them. */
  function liveBuilder(buildFn) {
    const fn = buildFn || build;
    let lastKey = null, last = null;
    const keyOf = (o) => {
      const b = o.basedOn || {};
      return [o.date, o.objects, o.pours, o.records, o.accepted, o.project, o.note || "", b.stage || "", b.models];
    };
    const same = (a, b) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
    return function liveBuild(o) {
      const key = keyOf(o);
      if (same(lastKey, key)) return last;
      last = fn(o);
      lastKey = key;
      return last;
    };
  }

  // ---------- validation: a strict whitelist ----------
  const T = {
    s: (max, re) => ({ t: "string", max, re }), n: { t: "number" }, i: { t: "int" }, b: { t: "boolean" }, iOpt: { t: "int", optional: true },
    day: { t: "string", max: 10, re: DAY_RE }, dayOrEmpty: { t: "string", max: 10, re: /^(\d{4}-\d{2}-\d{2})?$/ },
  };
  const obj = (keys) => ({ t: "object", keys });
  const steps = (inner) => obj(Object.fromEntries(STEP_IDS.map((k) => [k, inner])));
  const SCHEMA = obj({
    type: { t: "const", v: TYPE }, version: T.i, date: T.day, published: T.s(40),
    project: obj({ id: T.s(100), name: T.s(200) }),
    clientNote: T.s(NOTE_MAX),
    basedOn: obj({ stage: T.s(200), date: T.day, models: { t: "array", max: 50, of: obj({ name: T.s(200), version: T.s(100), date: T.dayOrEmpty }) } }),
    acceptance: T.b,
    counts: obj({ pours: T.i, objects: T.i, rebarAccepted: T.i, rebarPending: T.i, poured: T.i, pouredWithAcceptedRebar: T.i }),
    totals: steps(obj({ qty: T.n, total: T.n, unit: T.s(8), pct: T.n, pours: T.i, weekQty: T.n })),
    week: obj({ from: T.day }),
    pours: { t: "array", max: 5000, of: obj({ label: T.s(100), type: T.s(200), objects: T.i,
      rebar: { t: "enum", v: ["yes", "pending", "none", null] }, steps: steps(obj({ date: { t: "string", max: 10, re: DAY_RE, nullable: true }, done: T.i, na: T.iOpt })) }) },
  });
  // keys that must never appear anywhere (defence in depth: the whitelist already refuses them; this names them)
  const FORBIDDEN = /(^|_)(by|note|notes|log|history|comment|comments|email|user|users|decided|requested|reason|todo|todo_id|declog|wrong|hold)$/i;
  const ALLOWED_NOTE_PATH = "clientNote";

  /** {ok, errors: [string]} – every key must be in the whitelist, every value of the right type and size. */
  function validate(sum) {
    const errors = [];
    const walk = (v, sc, path) => {
      if (errors.length > 50) return;
      if (sc.nullable && v === null) return;
      switch (sc.t) {
        case "const": if (v !== sc.v) errors.push(`${path}: must be ${sc.v}`); return;
        case "enum": if (!sc.v.includes(v)) errors.push(`${path}: not allowed value`); return;
        case "boolean": if (typeof v !== "boolean") errors.push(`${path}: boolean expected`); return;
        case "number": if (typeof v !== "number" || !isFinite(v)) errors.push(`${path}: number expected`); return;
        case "int": if (!Number.isInteger(v) || v < 0) errors.push(`${path}: whole number expected`); return;
        case "string":
          if (typeof v !== "string") { errors.push(`${path}: text expected`); return; }
          if (v.length > sc.max) errors.push(`${path}: too long`);
          if (sc.re && !sc.re.test(v)) errors.push(`${path}: wrong format`);
          return;
        case "array":
          if (!Array.isArray(v)) { errors.push(`${path}: list expected`); return; }
          if (v.length > sc.max) errors.push(`${path}: too many`);
          v.forEach((x, i) => walk(x, sc.of, `${path}[${i}]`));
          return;
        case "object": {
          if (!v || typeof v !== "object" || Array.isArray(v)) { errors.push(`${path || "summary"}: object expected`); return; }
          for (const k of Object.keys(v)) {
            const p = path ? path + "." + k : k;
            if (FORBIDDEN.test(k) && p !== ALLOWED_NOTE_PATH) errors.push(`${p}: forbidden key (names, notes, logs, comments)`);
            else if (!Object.prototype.hasOwnProperty.call(sc.keys, k)) errors.push(`${p}: unknown key`);
          }
          for (const k of Object.keys(sc.keys)) {
            const p = path ? path + "." + k : k;
            if (!Object.prototype.hasOwnProperty.call(v, k)) { if (!sc.keys[k].optional) errors.push(`${p}: missing`); continue; }
            walk(v[k], sc.keys[k], p);
          }
          return;
        }
        default: errors.push(`${path}: schema`);
      }
    };
    walk(sum, SCHEMA, "");
    return { ok: !errors.length, errors };
  }
  const toJson = (sum) => JSON.stringify(sum, null, 1);
  /** Text of a summary file -> {ok, summary} or {ok: false, errors}. A file that fails validation is never shown. */
  function parse(text) {
    let sum;
    try { sum = typeof text === "string" ? JSON.parse(text) : text; } catch (e) { return { ok: false, errors: ["not JSON"] }; }
    const v = validate(sum);
    return v.ok ? { ok: true, summary: sum } : { ok: false, errors: v.errors };
  }

  // ---------- reading the summaries in the view ----------
  // Who may publish (round 11 M2): a summary file counts only when the uploader of its current version (modifiedBy, else
  // createdBy) is a member of 00_ADMIN, 02.GENERAL CONTRACTOR or 02.1-EXECUTION PROJECT MANAGER, or a Connect project
  // ADMIN (who can change folder rights anyway). Anyone else's file is dropped before the one-per-day choice, so a forged
  // newer file cannot hide the real one. If the members cannot be read, nothing is dropped and the files are "unverified".
  const TRUSTED_GROUPS = ["ADMIN", "GENERAL CONTRACTOR", "EXECUTION PROJECT MANAGER"];   // group keys (number prefix removed)
  const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
  const groupKey = (n) => (AX && AX.groupKey ? AX.groupKey(n) : norm(n).replace(/^\d+(?:[.,]\d+)*\s*[.)\-_:]?\s*/, "").trim());
  const sameUser = (a, b) => !!a && !!b && ((a.id && b.id && a.id === b.id) || (a.email && b.email && norm(a.email) === norm(b.email))
    || (a.tiduuid && b.tiduuid && a.tiduuid === b.tiduuid));
  /** The uploader of a listing entry's current version: {id, email, tiduuid} (no names kept), or null. */
  function uploaderOf(it) {
    const u = (it && (it.modifiedBy || it.createdBy)) || null;
    if (!u || typeof u !== "object") return null;
    const r = { id: u.id || u.userId || "", email: u.email || "", tiduuid: u.tiduuid || u.tidUuid || "" };
    return r.id || r.email || r.tiduuid ? r : null;
  }
  /** Users allowed to publish: Connect project ADMINs + members of the trusted groups. Throws when any read fails. */
  async function trustedUploaders(core, projectId) {
    const pid = encodeURIComponent(projectId);
    const [users, groups] = await Promise.all([core.req(`projects/${pid}/users`), core.req(`groups?projectId=${pid}`)]);
    const want = new Set(TRUSTED_GROUPS.map(groupKey));
    const mine = itemsOf(groups).filter((g) => g && g.id && want.has(groupKey(g.name)));
    const members = await Promise.all(mine.map((g) => core.req(`groups/${encodeURIComponent(g.id)}/users`)));
    return [...itemsOf(users).filter((u) => u && norm(u.role) === "admin"), ...members.flatMap(itemsOf)].filter(Boolean)
      .map((u) => ({ id: u.id || "", email: u.email || "", tiduuid: u.tiduuid || "" }));
  }
  /** Round 12 L1: the trusted uploaders kept for a while (10 min) per project, in memory and in sessionStorage (as the
   *  access check keeps the role), so a reload or a model event does not read users, groups and members again. Only a
   *  successful read is kept. listSummaries reads afresh before dropping a file whose uploader is not in a kept list,
   *  once per uploader (noteUntrusted: the uploaders a fresh read did not trust; set() forgets them). */
  function trustCache(opts) {
    const o = opts || {};
    const ttl = o.ttlMs == null ? 10 * 60000 : o.ttlMs;
    const now = o.now || (() => Date.now());
    const mem = new Map();
    const key = (pid) => `arsten.trusted.v1.${pid}`;
    const st = () => { try { return o.storage === undefined ? (typeof sessionStorage !== "undefined" ? sessionStorage : null) : o.storage; } catch { return null; } };
    const save = (pid, c) => { const s = st(); try { if (s) s.setItem(key(pid), JSON.stringify(c)); } catch {} };
    const fresh = (c) => !!c && Array.isArray(c.list) && typeof c.at === "number" && now() - c.at >= 0 && now() - c.at < ttl;
    return {
      get(pid) {
        if (!pid) return null;
        let c = mem.get(pid);
        if (!fresh(c)) {
          c = null;
          const s = st();
          try { const v = s ? JSON.parse(s.getItem(key(pid)) || "null") : null; if (fresh(v)) { c = v; mem.set(pid, v); } } catch {}
        }
        return c ? c.list : null;
      },
      set(pid, list) {
        if (!pid || !Array.isArray(list)) return;
        const c = { at: now(), list: list.map((u) => ({ id: (u && u.id) || "", email: (u && u.email) || "", tiduuid: (u && u.tiduuid) || "" })), untrusted: [] };
        mem.set(pid, c);
        save(pid, c);
      },
      /** Uploader keys already checked against a fresh read and not trusted (for the kept list's lifetime). */
      untrusted(pid) { const c = mem.get(pid); return fresh(c) && Array.isArray(c.untrusted) ? c.untrusted : []; },
      noteUntrusted(pid, keys) {
        const c = mem.get(pid);
        if (!fresh(c) || !keys || !keys.length) return;
        c.untrusted = [...new Set((c.untrusted || []).concat(keys))];
        save(pid, c);
      },
      drop(pid) { mem.delete(pid); const s = st(); try { if (s) s.removeItem(key(pid)); } catch {} },
    };
  }
  const userKey = (u) => [u.id || "", norm(u.email), u.tiduuid || ""].join("|");
  /** Keys of the uploaders of summary files in a listing who are not in `trusted` (files without an uploader: none). */
  function untrustedKeys(items, trusted) {
    const out = new Set();
    for (const it of itemsOf(items)) {
      if (!it || String(it.type || "FILE").toUpperCase() === "FOLDER" || !dayOfName(it.name)) continue;
      const by = uploaderOf(it);
      if (by && !(trusted || []).some((u) => sameUser(u, by))) out.add(userKey(by));
    }
    return [...out];
  }
  /** Split a folder listing by uploader: {kept, dropped: [names]}. trusted null (not verifiable): everything kept. */
  function filterTrusted(items, trusted) {
    const all = itemsOf(items);
    if (!trusted) return { kept: all, dropped: [] };
    // a listing that carries no uploader on ANY summary file cannot be checked: keep everything (unverified) rather
    // than drop every summary and leave the client with "no report" (Connect's item shape is not verified live yet)
    if (!all.some((it) => it && dayOfName(it.name) && uploaderOf(it))) return { kept: all, dropped: [], unverified: true };
    const kept = [], dropped = [];
    for (const it of all) {
      if (!it || String(it.type || "FILE").toUpperCase() === "FOLDER" || !dayOfName(it.name)) { kept.push(it); continue; }
      const by = uploaderOf(it);
      if (by && trusted.some((u) => sameUser(u, by))) kept.push(it); else dropped.push(String(it.name));
    }
    return { kept, dropped };
  }
  /** Summary files in a folder listing, newest day first: [{day, id, name, modifiedOn, stamp}]. One per day (the newest
   *  entry wins). stamp = id + version + modifiedOn: it changes on a same-day re-publish (new version or a second file),
   *  so the view can drop a cached copy (round 10 M1). Names other than exactly summary-YYYY-MM-DD.json are ignored. */
  function listFiles(items) {
    const byDay = new Map();
    for (const it of itemsOf(items)) {
      if (!it || String(it.type || "FILE").toUpperCase() === "FOLDER") continue;
      const day = dayOfName(it.name);
      if (!day || !it.id) continue;
      const cur = byDay.get(day);
      if (!cur || String(it.modifiedOn || "") > String(cur.modifiedOn || "")) {
        const ver = it.versionId || it.revision || it.versionNumber || it.versions || "";
        byDay.set(day, { day, id: it.id, name: it.name, modifiedOn: String(it.modifiedOn || ""), stamp: [it.id, ver, it.modifiedOn || ""].join("|") });
      }
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  }
  function itemsOf(it) { return Array.isArray(it) ? it : (it && it.items) || []; }
  /** Folder id of a path under the project root WITHOUT creating anything (the client view only reads); null if missing. */
  async function findFolder(core, projectId, names) {
    const p = await core.req(`projects/${encodeURIComponent(projectId)}`);
    let parent = p && p.rootId;
    if (!parent) return null;
    for (const name of names) {
      const f = itemsOf(await core.req(`folders/${encodeURIComponent(parent)}/items`)).find((x) => String(x.type).toUpperCase() === "FOLDER" && x.name === name);
      if (!f) return null;
      parent = f.id;
    }
    return parent;
  }
  /** {folderId, files: [{day, id, name, verified}], verified, dropped: [names], trustError}; no folder: {folderId: null, files: []}.
   *  verified false: the group members could not be read, so no file was checked (round 11 M2). */
  // opts.trustCache (round 12, L1 / M4): a trustCache(); the uploader check then comes from it, or runs at the same time
  // as the folder lookup instead of after it. Without it, the members are read after the listing, as before.
  async function listSummaries(core, projectId, opts) {
    const cache = opts && opts.trustCache;
    const readTrust = () => trustedUploaders(core, projectId).then(
      (list) => { if (cache) cache.set(projectId, list); return { list }; },
      (e) => ({ list: null, error: String((e && e.message) || e) }));
    const hit = cache ? cache.get(projectId) : null;
    const early = cache && !hit ? readTrust() : null;   // never rejects
    const folderId = await findFolder(core, projectId, FOLDER);
    if (!folderId) return { folderId: null, files: [] };
    const items = await core.req(`folders/${encodeURIComponent(folderId)}/items`);
    let trusted = null, trustError = "";
    if (itemsOf(items).some((it) => it && dayOfName(it.name))) {
      const r = hit ? { list: hit } : await (early || readTrust());
      trusted = r.list; trustError = r.error || "";
    }
    let { kept, dropped, unverified } = filterTrusted(items, trusted);
    if (cache && hit && dropped.length) {
      // an uploader not in the kept list (just added to a group?): read again before dropping, once per uploader
      const seen = cache.untrusted(projectId);
      if (untrustedKeys(items, hit).some((k) => !seen.includes(k))) {
        const r = await readTrust();
        trusted = r.list; trustError = r.error || "";
        ({ kept, dropped, unverified } = filterTrusted(items, trusted));
        if (trusted) cache.noteUntrusted(projectId, untrustedKeys(items, trusted));
      }
    } else if (cache && !hit && trusted) cache.noteUntrusted(projectId, untrustedKeys(items, trusted));
    const verified = !!trusted && !unverified;
    return { folderId, files: listFiles(kept).map((f) => Object.assign(f, { verified })), verified, dropped, trustError };
  }
  /** Download and validate one summary file. fetchImpl: the browser fetch (download URL from Core). */
  async function readSummary(core, fileId, fetchImpl) {
    const d = await core.req(`files/fs/${encodeURIComponent(fileId)}/downloadurl`);
    const url = d && (d.url || d.downloadUrl || d.href);
    if (!url) throw new Error("summary: no download URL");
    // 30 s limit (round 12 M1): a download that never answers must not leave the client view loading forever
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 30000) : null;
    let res;
    try { res = await (fetchImpl || fetch)(url, ctl ? { signal: ctl.signal } : undefined); } finally { if (timer) clearTimeout(timer); }
    if (!res.ok) throw new Error("summary download " + res.status);
    const r = parse(await res.text());
    if (!r.ok) throw new Error("summary file refused: " + r.errors.slice(0, 3).join("; "));
    return r.summary;
  }

  // ---------- view helpers (both the published summary and the live view use these) ----------
  /** Step completed for the whole pour. Version 1 files have no "na" and counted a "without" step as done even before the
   *  step before it (round 10 H1: "Без кофраж" also sets stripped "without"): there, stripped counts only once poured. */
  function isComplete(p, id) {
    const c = p && p.objects > 0 && p.steps && p.steps[id];
    if (!c || c.done !== p.objects) return false;
    if (id === "stripped" && c.na == null && !isComplete(p, "poured")) return false;
    return true;
  }
  /** Every object of the pour is "without" for this step (nothing was built: no timeline event, "without" colour rule). */
  const allNa = (p, id) => isComplete(p, id) && p.steps[id].na > 0 && p.steps[id].na === p.steps[id].done;
  /** Headline (A18): poured % of concrete volume, +this week, pours poured / all. */
  function headline(sum) {
    const t = sum.totals.poured;
    return { pct: t.pct, qty: t.qty, total: t.total, unit: t.unit, weekQty: t.weekQty, poured: sum.counts.poured, pours: sum.counts.pours };
  }
  /** A status record per pour from the summary (for colours): every stage completed for the whole pour, with its date,
   *  and "<step>_na" when the whole pour is "without" for it, so S.stageOf applies the same rule as the live view. */
  function pourRecord(p) {
    const r = {};
    for (const id of STEP_IDS) if (isComplete(p, id)) { r[id] = true; if (allNa(p, id)) r[`${id}_na`] = true; if (p.steps[id].date) r[`${id}_date`] = p.steps[id].date; }
    return Object.keys(r).length ? r : null;
  }
  /** Timeline from a summary: one line per pour + stage completed, newest first (no quantities, no names).
   *  A stage the whole pour is "without" is not an event (nothing was built), as in the live P.timeline. */
  function timelineOf(sum) {
    const ev = [];
    for (const p of sum.pours) for (const id of STEP_IDS) { const d = p.steps[id] && p.steps[id].date; if (d && isComplete(p, id) && !allNa(p, id)) ev.push({ date: d, pour: p.label, step: id }); }
    return ev.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || String(a.pour).localeCompare(String(b.pour), undefined, { numeric: true }) || STEP_IDS.indexOf(b.step) - STEP_IDS.indexOf(a.step));
  }
  /** Type names are "English/Български" in the pour export: the part for the language (the whole name when no "/"). */
  function typeName(t, lang) {
    return String(t || "").split(" + ").map((x) => { const i = x.indexOf("/"); return i < 0 ? x.trim() : (lang === "bg" ? x.slice(i + 1) : x.slice(0, i)).trim() || x.trim(); }).join(" + ");
  }
  /** B-Client 7: pours grouped by type, in the order the types first appear; per group: pours, poured, stripped. */
  function groupByType(pours) {
    const groups = new Map();
    for (const p of pours) {
      const k = p.type || "";
      if (!groups.has(k)) groups.set(k, { type: k, pours: [] });
      groups.get(k).pours.push(p);
    }
    return [...groups.values()].map((g) => Object.assign(g, { poured: g.pours.filter((p) => isComplete(p, "poured")).length, stripped: g.pours.filter((p) => isComplete(p, "stripped")).length }));
  }

  /** "Based on" stage name: the stage (viewer-arsten/stages.js record, JSON text or list) whose models are exactly the
   *  loaded ones; a stage of the Статус tool ("progress") first. "" when none matches (the PM can type it). */
  function matchStage(stages, loadedIds) {
    let list = stages;
    if (typeof list === "string") { try { list = JSON.parse(list || "[]"); } catch { list = []; } }
    if (!Array.isArray(list)) return "";
    const want = new Set(loadedIds || []);
    if (!want.size) return "";
    const tools = (s) => (Array.isArray(s.tools) ? s.tools : s.tool ? [s.tool] : []);
    const fits = list.filter((s) => s && s.name && s.kind !== "view" && Array.isArray(s.models) && s.models.length === want.size && s.models.every((m) => m && want.has(m.id)));
    const best = fits.find((s) => tools(s).includes("progress")) || fits[0];
    return best ? String(best.name) : "";
  }

  return { TYPE, VERSION, FOLDER, NOTE_MAX, FORBIDDEN, matchStage, fileName, dayOfName, addDays, rebarState, rebarIndex, liveBuilder, trustCache, build, validate, toJson, parse,
    listFiles, findFolder, listSummaries, readSummary, TRUSTED_GROUPS, uploaderOf, trustedUploaders, filterTrusted, pourType, headline, pourRecord, timelineOf, typeName, groupByType, isComplete, allNa };
});
