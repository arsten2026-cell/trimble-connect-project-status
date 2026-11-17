// Project status: client view of construction progress in the Trimble Connect 3D viewer.
// Live view: reads the statuses that Pour status (Arsten) stores in the project library "CIP/Монолитно" and the pour
// objects of the Tekla model (property set Pour/Такт). Shows stages and dates only: no notes, no names.
// Client summary (week 3, B-Client 1): admin / GC publish ONE client-safe JSON per day to _AM_Docs/Client
// (client-summary.js; upload with shared/arsten-backup.js). The CLIENT role reads ONLY those files ("as published on
// 14.11", picker over the files). Round 11 M1: with none published (or none readable) the client gets "Все още няма
// публикуван отчет" and the panel never reads the library (no pset call at all for the client). Round 11 M2 / round 16 M2:
// only files uploaded by 00_ADMIN / 02.1 members or a Connect project ADMIN count (client-summary.js listSummaries).
// Admin / GC keep the live view with "Виж като клиент" (the latest summary). Connect access rights are not changed here.
// Writes: only the summary file (admin or the PM = "stages" cap, round 11 L8, on "Публикувай за клиента") and
// "Save view" (a Connect view, not for clients).
// Access: project ADMIN, groups CLIENT and GENERAL CONTRACTOR (shared/arsten-access.js, app "projectStatus").
// Week 4: steel totals in the summary (B-Client 2; staff read STEEL/Монтаж read-only, the client never does), the
// printable report "Печат / PDF" of a published summary (B-Client 4, report.js), and objects without a pour number are
// no takt (round 14: kept apart in state.loose, "Без номер на такт: N елемента" for staff, left out of the summary).
// Дейности (17.11.2026, shared/arsten-activities.js): things done on site that are not in the model ("Additional site
// toilets delivered"), kept in the Дейности panel. At "Публикувай за клиента" the dated entries ticked "за клиента" are
// read afresh and go into the summary (version 4, text + date only) and the weekly / monthly report; the client sees them
// from the summary only and never reads the list file. Nothing about Дейности is edited here.
(() => {
  "use strict";
  const C = window.PourLogic, S = window.PourStatus, A = window.PsetApi, P = window.ProjectProgress, CS = window.ClientSummary;
  const ACC = window.ArstenAcceptance, B = window.ArstenBackup;
  const R = window.SteelRecords, F = window.SteelFab, SP = window.SteelProgress, RP = window.ClientReport, AV = window.ArstenActivities;
  const ASSEMBLY = "IfcElementAssembly";
  const $ = (id) => document.getElementById(id);
  const PROXY = "IfcBuildingElementProxy";
  const BATCH = 200;
  // round 17 M1: steel assembly chunks read 4 at a time; the live steel card is read again only after this long (or when the
  // loaded models change). Publishing always reads the steel afresh.
  const STEEL_POOL = 4, STEEL_MAX_AGE_MS = 5 * 60 * 1000;
  const GHOST = "#D9D5CC", GHOST_OPACITY = 0.12, NOT_STARTED_OPACITY = 0.45;
  const LANG_KEY = "arsten.projectStatus.lang", GROUP_KEY = "arsten.projectStatus.group";

  const T = {
    title: ["Статус", "Status"],
    colour: ["Оцвети по статус", "Colour by status"], view: ["Запази изглед", "Save view"],
    asOf: ["Към дата", "As of date"], asOfLbl: ["Състояние към", "Status as of"], today: ["Днес", "Today"],
    steelToday: ["към днес – стоманата няма история по дни", "as of today – the steel has no history per day"],
    overall: ["Общ напредък", "Overall progress"], details: ["Подробности", "Details"], pours: ["По тактове", "By pour"], timeline: ["Хронология", "Timeline"],
    more: ["Покажи всички", "Show all"], pour: ["Такт", "Pour"], other: ["Друго в модела (прозрачно)", "Rest of the model (ghosted)"],
    byVolume: ["кофраж и декофриране по m², армировка по kg, бетон по m³", "formwork and stripping by m², rebar by kg, concrete by m³"], poursDone: ["такта завършени", "pours complete"], poursDone1: ["такт завършен", "pour complete"],
    noEvents: ["Още няма отбелязани етапи.", "No stages recorded yet."],
    noLib: ["Статусите на тактовете още не са настроени в този проект.", "Pour statuses are not set up in this project yet."],
    noPours: ["В заредените модели няма тактове (Tekla IFC с Pour/Такт).", "No pours in the loaded models (Tekla IFC with Pour/Такт)."],
    objects: ["обекта", "objects"], objects1: ["обект", "object"], poursWord1: ["такт", "pour"],
    poured: ["излято", "poured"], thisWeek: ["тази седмица", "this week"], poursWord: ["такта", "pours"],
    basedOn: ["Въз основа на", "Based on"], loadedModels: ["заредените модели", "the loaded models"], dataAsOf: ["данни към", "data as of"],
    clientNote: ["Бележка", "Note"],
    forClient: ["За клиента", "For the client"], asClient: ["Виж като клиент", "View as client"],
    stageLbl: ["Етап (за „Въз основа на“)", "Stage (for \"Based on\")"], noteLbl: ["Бележка към клиента (закъснения, нови дати)", "Note to the client (delays, new dates)"],
    publish: ["Публикувай за клиента", "Publish for the client"], republish: ["Публикувай отново (днес)", "Publish again (today)"],
    lastPub: ["Последно публикувано", "Last published"], notPub: ["Още няма публикувано резюме.", "Nothing published yet."],
    noReport: ["Все още няма публикуван отчет.", "No report has been published yet."],
    unverified: ["непроверен източник", "unverified source"],
    pubWho: ["Публикува само администратор или ръководител изпълнение (02.1).", "Only an admin or the execution PM (02.1) publishes."],
    dropped: ["пропуснати резюмета от лица извън 00_ADMIN / 02.1", "summaries skipped (uploaded by someone outside 00_ADMIN / 02.1)"],
    published: ["Както е публикувано на", "As published on"], latest: ["последно", "latest"],
    rebarAcc: ["Арм. приета", "Rebar accepted"], pending: ["чака", "pending"],
    byType: ["По тип", "By type"], list: ["Списък", "List"], noType: ["Без тип", "No type"],
    groupPoured: ["излети", "poured"], without: ["без", "n/a"],
    pubHint: ["Публикува се само: количества по етапи, дати по тактове, „армировка приета“ да/не, общо за стоманата (изработено / доставено / монтирано), дейностите „за клиента“ (с до 6 снимки на запис), бележката и „въз основа на“. Без имена, марки, вътрешни бележки и история.",
      "Published: quantities per stage, dates per pour, \"rebar accepted\" yes/no, steel totals (fabricated / delivered / erected), the activities marked \"for the client\" (with up to 6 photos each), the note and \"based on\". No names, marks, internal notes or history."],
    loose: ["Без номер на такт", "No pour number"], looseHint: ["не се броят като такт", "not counted as a pour"],
    print: ["Печат / PDF", "Print / PDF"], back: ["Назад", "Back"], week: ["Седмица", "Week"], month: ["Месец", "Month"],
    printHint: ["В прозореца за печат изберете „Запази като PDF“ за файл.", "In the print dialog choose \"Save as PDF\" for a file."],
    // round 16 M1: the steel could not be read at publishing time
    steelFail: ["Стоманата не можа да се прочете", "The steel could not be read"],
    steelNA: ["Стоманата не е налична", "Steel not available"],
    steelOr: ["публикувай без нея или откажи.", "publish without it, or cancel."],
    steelHad: ["Последното публикувано резюме има стомана – клиентът ще спре да вижда стоманата.", "The last published summary has steel – the client will stop seeing the steel."],
    steelDeniedHint: ["Публикувайте като член на 00_ADMIN или 02.1, за да е включена.", "Publish as a member of 00_ADMIN or 02.1 to include it."],
    steelRetryHint: ["Може да опитате пак след малко.", "You can try again in a moment."],
    steelGo: ["Публикувай без стоманата", "Publish without the steel"], steelCancel: ["Откажи", "Cancel"],
    rsDenied: ["няма достъп до STEEL/Монтаж", "no access to STEEL/Монтаж"], rsTimeout: ["Connect не отговаря", "Connect did not answer"],
    rsBusy: ["твърде много заявки (429)", "too many requests (429)"],
    steelLeft: ["Без стомана – клиентът ще спре да вижда стоманата.", "No steel – the client will stop seeing the steel."],
    pubCancelled: ["Публикуването е отказано – нищо не е качено.", "Publishing cancelled – nothing was uploaded."],
    // round 16 (L4): "Виж като клиент" shows only what the client sees, plus this one control
    leaveClient: ["Изход от изгледа като клиент", "Leave the client view"],
    // Дейности (shared/arsten-activities.js): the client view and publishing only
    site: ["Дейности на обекта", "Site activities"],
    siteClientHint: ["Записи от последните 30 дни.", "Entries from the last 30 days."],
    sitePub: ["Дейности за клиента", "Activities for the client"], sitePhotos: ["снимки", "photos"],
    sitePhCopy: ["Копиране на снимките за клиента", "Copying the photos for the client"],
    sitePhFailed: ["снимки не бяха копирани (вижте конзолата) – записите са публикувани без тях", "photos were not copied (see the console) – the entries went out without them"], siteWeek: ["в последните 7 дни", "in the last 7 days"],
    siteReadFail: ["Дейностите не можаха да се прочетат – публикуване без тях?", "The activities could not be read – publish without them?"],
  };
  // plain stage names for the client look (A18)
  const PLAIN = {
    none: ["Не е започнат", "Not started"], formwork: ["Кофраж", "Formwork"], rebar_first: ["В процес", "In progress"],
    rebar: ["Армировка", "Reinforcement"], poured: ["Бетон излят", "Concrete poured"], stripped: ["Завършен", "Finished"],
  };
  // one language for all tools (A10): shared key "arsten.lang" (shared/arsten-i18n.js); LANG_KEY is read once
  const I18N = window.ArstenI18n;
  const storedLang = I18N ? I18N.stored([LANG_KEY]) : (() => { try { return localStorage.getItem(LANG_KEY) || ""; } catch { return ""; } })();
  let lang = storedLang || "bg";
  const t = (k) => (T[k] ? T[k][lang === "bg" ? 0 : 1] : k);
  /** The counted form: tn(1, "poursWord") = "такт", tn(3, "poursWord") = "такта" (round 14 L6). */
  const tn = (n, k) => (Number(n) === 1 && T[k + "1"] ? t(k + "1") : t(k));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // dates with the year (A19): BG 03.11.2026, EN 3 Nov 2026; table cells 03.11.26
  const fmtDate = (d) => { if (!d) return ""; if (I18N) return I18N.fmtDate(d, lang); const [y, m, dd] = d.split("-"); return lang === "bg" ? `${dd}.${m}.${y}` : `${+dd} ${MONTHS[+m - 1] || m} ${y}`; };
  const fmtShort = (d) => { if (!d) return ""; if (I18N) return I18N.fmtDate(d, lang, { short: true }); const [y, m, dd] = d.split("-"); return `${dd}.${m}.${y.slice(2)}`; };
  const fmtNum = (v, dec) => Number(v || 0).toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const decOf = (unit) => (unit === "kg" ? 0 : 1);
  const toNum = (v) => { const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : null; };
  // text may be a function: then it is built again in the new language after a language switch (round 19 L4)
  let statusAgain = null;
  function setStatus(text, bad) {
    statusAgain = typeof text === "function" ? { text, bad } : null;
    $("status").textContent = typeof text === "function" ? text() : text; $("status").className = "status" + (bad ? " bad" : "");
  }
  const relabelStatus = () => { if (statusAgain) setStatus(statusAgain.text, statusAgain.bad); if (window.ArstenDiag && ArstenDiag.relabel) ArstenDiag.relabel(); };
  const errText = (e) => (e && (e.message || e.toString())) || String(e);
  async function guarded(fn) { try { await fn(); } catch (e) { setStatus(I18N ? I18N.err(errText(e), lang) : (lang === "bg" ? "Грешка: " : "Error: ") + errText(e), true); console.error(e); } }

  const state = {
    api: null, client: null, project: null, role: "", lib: null,
    pours: [], objects: [],        // pour groups (numbered only); their objects [{modelId, id, guid, pour, volume}]
    loose: [],                     // round 14: groups with no pour number ("TAKT" alone): no takt, not in the summary
    steel: null,                   // B-Client 2 (staff only): steel-summary.js totals from STEEL/Монтаж, null = none / not readable
    report: false, period: "week", // B-Client 4: the print view of the shown summary is open; week / month
    records: new Map(),            // guid -> client-safe record (steps, "without", dates)
    accepted: null,                // merged acceptance records (admin / GC only), else null
    models: [], stageName: "",     // "based on": loaded models [{id, name, version, date}], matched stage
    asOf: "", days: [],            // "" = today
    coloured: true, showAll: false,   // colouring on by default (owner, 17.11.2026; round 14 M2)
    // sums: summary file stamp (id | version | modifiedOn, CS.listFiles) -> summary: a same-day re-publish has a new stamp
    // (round 10 M1). sumPicked: the user chose an older day in the picker this session (else a reload shows the newest).
    summaries: [], sums: new Map(), sumDay: "", sumPicked: false, look: "live", asClient: false, lastLook: "",
    sumVerified: true, sumDropped: [],   // round 11 / 16 M2: uploaders checked against 00_ADMIN / 02.1; names of dropped files
    caps: [],
    staffStatus: "",               // round 16: the staff status line, put back when leaving "Виж като клиент"
    steelAsk: null,                // round 16 M1: {error, had, resolve} while the publish box asks "publish without steel?"
    group: (() => { try { return localStorage.getItem(GROUP_KEY) || "type"; } catch { return "type"; } })(),
  };
  /** The panel's role from the access result: works with the single role (access.role) and with the role union
   *  (access.roles, multi-group users). Admin, then GC; anyone else allowed here gets the client (summary-only) view. */
  function panelRole(access) {
    const roles = new Set([access && access.role].concat(Array.isArray(access && access.roles) ? access.roles : []).filter(Boolean));
    return roles.has("admin") ? "admin" : roles.has("gc") ? "gc" : "client";
  }
  /** Admin and GC: live view, acceptance column, "Виж като клиент". */
  const isStaff = () => state.role === "admin" || state.role === "gc";
  /** L8 (round 11): publishing for the client = admin or the execution PM ("stages" cap: 00_ADMIN, 02.1), not every GC member. */
  const canPublish = () => state.role === "admin" || state.caps.includes("stages");
  const clientLook = () => state.role === "client" || state.asClient;
  const sumFile = (day) => state.summaries.find((x) => x.day === day) || null;
  /** The summary shown for a day, from the cache of its current file version; null if not read. */
  const sumOf = (day) => { const f = sumFile(day); return (f && state.sums.get(f.stamp)) || null; };
  const inSummary = () => state.look === "summary" && !!sumOf(state.sumDay);

  // ---------- access token ----------
  let token = null, waiters = [];
  function onToken(tk) { token = tk; const w = waiters; waiters = []; w.forEach((f) => f(tk)); }
  // Round 17 L3 (the round 12 L6 fix of Монолитен бетон / Стомана): the waiter is registered before asking (the token
  // event may come while requestPermission runs). When Connect returns the token directly, refuses or throws, the waiter
  // and its 60 s timer are dropped, so no stray "No access token" rejection is logged a minute later.
  async function getToken(refresh) {
    if (token && !refresh) return token;
    let timer = 0, done = null;
    const p = new Promise((resolve, reject) => {
      done = (tk) => { clearTimeout(timer); resolve(tk); };
      waiters.push(done);
      timer = setTimeout(() => { waiters = waiters.filter((f) => f !== done); reject(new Error((lang === "bg" ? "Trimble Connect не даде ключ за достъп" : "No access token from Trimble Connect"))); }, 60000);
    });
    const drop = () => { clearTimeout(timer); waiters = waiters.filter((f) => f !== done); p.catch(() => {}); };
    let r;
    try { r = await state.api.extension.requestPermission("accesstoken"); } catch (e) { drop(); throw e; }
    if (r === "denied") { drop(); throw new Error((lang === "bg" ? "Достъпът до данните в Trimble Connect е отказан за това разширение." : "Access to Trimble Connect data was denied for this extension.")); }
    if (r && r !== "pending" && r !== "granted") { drop(); token = r; return r; }
    return p;
  }
  let core = null;
  const coreFor = () => window.ARSTEN_CORE || core || (core = B.coreClient(ArstenAccess.coreBase(state.project.location), getToken));
  const fetchFor = () => window.ARSTEN_FETCH || ((...a) => fetch(...a));

  // ---------- data (read-only) ----------
  async function loadPours() {
    const api = state.api;
    let modelObjs = await api.viewer.getObjects({ parameter: { class: PROXY } });
    if (!(modelObjs || []).some((m) => (m.objects || []).length)) modelObjs = await api.viewer.getObjects();
    const items = [];
    for (const m of modelObjs || []) {
      const ids = (m.objects || []).map((o) => o.id);
      for (let i = 0; i < ids.length; i += BATCH) {
        const props = (await api.viewer.getObjectProperties(m.modelId, ids.slice(i, i + BATCH))) || [];
        const found = [];
        for (const p of props) { const ps = C.readPourPset(p); if (ps) found.push({ modelId: m.modelId, id: p.id, props: ps }); }
        if (!found.length) continue;
        const guids = (await api.viewer.convertToObjectIds(m.modelId, found.map((f) => f.id))) || [];
        found.forEach((f, k) => { f.guid = guids[k] || null; });
        items.push(...found.filter((f) => f.guid));
      }
    }
    // round 14: objects with no pour number are no takt (as Монолитен бетон, which keeps them in state.loose): they are
    // not counted in "x / y такта", the per-pour table or the summary, and are ghosted like the rest of the model
    const { pours, unnumbered } = C.groupPours(items);
    state.pours = pours;
    state.loose = unnumbered;
    state.objects = [];
    for (const g of state.pours) for (const o of g.objects) state.objects.push({ modelId: o.modelId, id: o.id, guid: o.guid, pour: g.label, volume: toNum(o.props[C.P.volume]),
      rebar: toNum(o.props[C.P.rebar]), formwork: (toNum(o.props[C.P.fwSides]) || 0) + (toNum(o.props[C.P.fwBottom]) || 0) });
  }
  async function loadRecords(lib) {
    // "$" links (F4): Pour status writes the URL-encoded link; records still under the old raw-"$" link are read too
    // (encoded wins), so no pour drops out before they are moved in Pour status ("Премести").
    const LK = window.ArstenLinks;
    const links = state.objects.map((o) => S.entityLink(o.guid));
    const legacy = state.objects.filter((o) => LK.hasLegacy(o.guid)).map((o) => LK.legacyLink(o.guid));
    const got = await state.client.readMany(lib.id, S.DEF_ID, links);
    const raw = legacy.length ? await state.client.readMany(lib.id, S.DEF_ID, legacy) : new Map();
    const all = P.fromPsets(got, raw);
    // keep only what clients may see (steps, "without", dates)
    state.records = P.recordsAsOf(all, "");
    const range = P.dateRange(state.records);
    const today = S.today();
    state.days = [];
    if (range) for (let d = new Date(range.min + "T00:00:00"); S.today(d) <= today; d.setDate(d.getDate() + 1)) state.days.push(S.today(d));
  }
  /** Rebar acceptance (B-Client 3): read ONLY for admin / GC; the client gets it through the published summary. */
  async function loadAcceptance(lib) {
    if (!isStaff() || !lib) { state.accepted = null; return null; }
    try {
      // requests and decisions at the same time (round 12 M4); no decisions definition yet (404): none decided
      const [a, dec] = await Promise.all([
        state.client.listAll(lib.id, ACC.DEF_ID, ACC.prefix(state.project.id)),
        state.client.listAll(lib.id, ACC.DEC_ID, ACC.prefix(state.project.id)).catch((e) => { if (e.status !== 404) throw e; return new Map(); }),
      ]);
      state.accepted = ACC.merge([...a].map(([link, p]) => Object.assign({ link }, p)), dec).filter(ACC.valid);
    } catch (e) {
      if (e.status === 404) state.accepted = [];   // no acceptance definition yet: nothing asked
      else { state.accepted = null; console.warn("acceptance not read", e); }
    }
    return state.accepted;
  }
  const looseCount = () => state.loose.reduce((n, g) => n + ((g && g.objects) || []).length, 0);

  // ---------- steel (B-Client 2): staff only, read-only ----------
  /** Steel assemblies of the loaded models (IfcElementAssembly with the "Assembly/Сглобка" pset): [{guid, mark, weight}];
   *  [] when no steel model is loaded (then the summary carries counts only and says so). */
  async function loadAssemblies() {
    const api = state.api, chunks = [];
    let models = [];
    try { models = (await api.viewer.getObjects({ parameter: { class: ASSEMBLY } })) || []; } catch {}
    for (const m of models) {
      const ids = (m.objects || []).map((o) => o.id);
      for (let i = 0; i < ids.length; i += BATCH) chunks.push({ modelId: m.modelId, ids: ids.slice(i, i + BATCH) });
    }
    // round 17 M1: STEEL_POOL chunks at a time (was one after the other), properties and GUIDs of a chunk side by side;
    // the result keeps the model / chunk order
    const parts = await A.mapLimit(chunks, STEEL_POOL, async (c) => {
      const [props, guids] = await Promise.all([api.viewer.getObjectProperties(c.modelId, c.ids), api.viewer.convertToObjectIds(c.modelId, c.ids)]);
      const out = [];
      (props || []).forEach((p, k) => {
        if (p && p.class && !/elementassembly/i.test(String(p.class))) return;
        const set = (p && p.properties || []).find((x) => /^Assembly/i.test(String(x.name || "")));
        if (!set || !(guids || [])[k]) return;
        const ps = {};
        for (const q of set.properties || []) ps[q.name] = q.value;
        out.push(SP.assemblyOf(guids[k], ps));
      });
      return out;
    });
    return [].concat(...parts);
  }
  /** Steel totals for staff (the live view and publishing). The library STEEL/Монтаж only if it exists and this user may
   *  read it; asmstatus, fabstatus and the delivery notes are listed, never written. null: no steel section. */
  // fresh (round 18 L5, publishing): the library is looked up again, past psetapi's 2-minute "not found / no read right"
  // cache, so a library created or opened to this user a moment ago is seen
  let steelGen = 0;
  async function loadSteel(fresh) {
    const gen = ++steelGen;
    if (!isStaff() || !R || !F || !SP) { state.steel = null; return null; }
    const found = await state.client.findLibrary(state.project.id, R.LIB_NAMES, fresh ? { fresh: true } : undefined);
    if (!found || !found.lib) {
      // round 16 M1: "not readable" is not "no steel". A library this user may not read (pset-api 403, counted in
      // `denied`; STEEL is the one library AM_TEMPLATE locks) is an error, so publishing does not drop steel silently.
      if (found && found.denied > 0) { const e = new Error("STEEL/Монтаж: 403 (no read right)"); e.status = 403; e.steelDenied = true; throw e; }
      if (gen === steelGen) state.steel = null;
      return null;   // no steel library in the project: no steel section, as before
    }
    const lib = found.lib, none = (e) => { if (e && e.status === 404) return new Map(); throw e; };   // a definition not created yet: nothing
    const [status, fab, dels, instances] = await Promise.all([
      state.client.listAll(lib.id, R.DEF.status, "frn:entity:").catch(none),
      state.client.listAll(lib.id, F.DEF_ID, "frn:entity:").catch(none),
      state.client.listAll(lib.id, R.DEF.delivery, R.deliveryPrefix(state.project.id)).catch(none),
      loadAssemblies(),
    ]);
    const steel = SP.build({ instances, status: SP.byGuid(status), fab: SP.byGuid(fab), deliveries: [...dels.values()] });
    if (gen === steelGen) state.steel = steel;
    return steel;
  }
  /** Round 17 M1: the live steel card. Read after the first paint, and again only when the loaded model set changed or the
   *  last read is older than STEEL_MAX_AGE_MS; never two reads for the same model set at once. A failed read is not kept
   *  (the next load tries again). Publishing does not use this: readSteel reads afresh. */
  let steelRead = { key: null, at: 0 }, steelRun = null;
  function refreshSteel(key) {
    if (!isStaff()) return;
    if (key != null && steelRead.key === key && Date.now() - steelRead.at < STEEL_MAX_AGE_MS) return;
    if (steelRun && steelRun.key === key && key != null) return;
    const run = steelRun = { key };
    loadSteel()
      // round 19 L10: a failed read is kept for the staff card ("Стоманата не е налична (<reason>)"), a good one clears it
      .then((st) => { if (steelRun === run) steelRead = { key, at: Date.now() }; const had = state.steelErr; state.steelErr = null; if (st || had) render(); },
        (e) => { console.warn("steel not read", e); if (steelRun === run || !steelRun) { state.steelErr = e || new Error("steel"); render(); } })
      .finally(() => { if (steelRun === run) steelRun = null; });
  }

  /** "Based on" (A19): loaded models with version and date; the matching stage name (admin / GC). Never throws. */
  async function loadBasis(lib) {
    let models = [];
    try { models = ((await state.api.viewer.getModels("loaded")) || []).filter((m) => !m.state || m.state === "loaded"); } catch {}
    // one Core read per model, all at the same time (round 12 M4); the rows keep the viewer's model order
    const out = await Promise.all(models.map(async (m) => {
      const row = { id: m.id, name: String(m.name || "").replace(/\.(ifc|ifczip|trb)$/i, ""), version: "", date: "" };
      try {
        const f = await coreFor().req(`files/${encodeURIComponent(m.id)}`);
        const n = f && (f.revision || f.versionNumber || f.version);
        if (n != null && n !== "") row.version = "v" + n;
        const d = f && (f.modifiedOn || f.createdOn || f.uploadedOn);
        if (d) row.date = String(d).slice(0, 10);
      } catch {}
      if (!row.version && m.versionId) row.version = String(m.versionId).slice(0, 8);
      return row;
    }));
    state.models = out;
    if (isStaff() && lib && !state.stageName) {
      try {
        const link = `frn:entity:ARSTENSTAGES-${state.project.id}`;
        const got = await state.client.readMany(lib.id, "stages", [link]);
        const rec = got && got.get(link);
        state.stageName = CS.matchStage(rec && rec.json, out.map((m) => m.id));
      } catch {}
    }
  }
  /** The list of published summaries (everyone may read the folder listing; nothing is created here). */
  // Cached copies are kept per file version: a stamp no longer listed (re-published, removed) is dropped (round 10 M1).
  async function refreshSummaries() {
    const l = await CS.listSummaries(coreFor(), state.project.id, { trustCache });
    state.summaries = l.files;
    state.sumVerified = l.verified !== false;
    state.sumDropped = l.dropped || [];
    if (state.sumDropped.length) console.warn("summary files dropped (uploader not in 00_ADMIN / 02.1):", state.sumDropped.join(", "));
    if (l.trustError) console.warn("summary uploaders not verified:", l.trustError);
    const live = new Set(l.files.map((f) => f.stamp));
    for (const k of [...state.sums.keys()]) if (!live.has(k)) state.sums.delete(k);
    if (state.sumDay && !l.files.some((f) => f.day === state.sumDay)) { state.sumDay = ""; state.sumPicked = false; }
  }
  // round 12 L1: the uploader check (users, groups, members) kept ~10 min per project for this session
  const trustCache = CS.trustCache();
  async function openSummary(day) {
    const f = sumFile(day) || state.summaries[0];
    if (!f) return null;
    if (!state.sums.has(f.stamp)) state.sums.set(f.stamp, await CS.readSummary(coreFor(), f.id, fetchFor()));
    state.sumDay = f.day;
    return state.sums.get(f.stamp);
  }
  /** The day to show after a (re)load: the newest, unless the user picked an older one in this session that still exists. */
  const reloadDay = () => (state.sumPicked && sumFile(state.sumDay) ? state.sumDay : state.summaries[0] && state.summaries[0].day);
  /** M1 (round 11): the first readable summary, the reload day first, then the others newest first; null if none reads. */
  async function openFirstReadable() {
    const want = reloadDay();
    const order = [sumFile(want), ...state.summaries.filter((f) => f.day !== want)].filter(Boolean);
    for (const f of order) {
      try { return await openSummary(f.day); } catch (e) { console.warn("summary not read", f.name, e); }
    }
    return null;
  }
  /** Staff only: "(непроверен източник)" when the uploaders could not be checked (round 11 M2). The client never sees it. */
  const unverifiedMark = () => (isStaff() && !state.asClient && !state.sumVerified ? ` (${t("unverified")})` : "");   // not in "Виж като клиент"

  // ---------- what is shown: a summary-shaped view of the live data, or the published summary ----------
  const currentRecords = () => (state.asOf ? P.recordsAsOf(state.records, state.asOf) : state.records);
  // round 12 M5: built again only when the day or the data changed (not on a language, group or "show all" re-render)
  const liveBuild = CS.liveBuilder();
  function liveSummary() {
    const day = state.asOf || S.today();
    return liveBuild({ date: day, objects: state.objects, pours: state.pours, loose: state.loose, records: state.records, accepted: state.accepted,
      project: state.project, note: "", basedOn: { stage: state.stageName, models: state.models }, steel: state.steel });
  }
  const shown = () => (inSummary() ? sumOf(state.sumDay) : liveSummary());

  // ---------- colours ----------
  const STAGES = S.STAGES;
  const selector = (objs) => {
    const byModel = new Map();
    for (const o of objs) { if (!byModel.has(o.modelId)) byModel.set(o.modelId, []); byModel.get(o.modelId).push(o.id); }
    return { modelObjectIds: [...byModel].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds })) };
  };
  function recordOf() {
    if (!inSummary()) { const recs = currentRecords(); return (o) => recs.get(o.guid); }
    const byPour = new Map(sumOf(state.sumDay).pours.map((p) => [p.label, CS.pourRecord(p)]));
    return (o) => byPour.get(o.pour) || null;
  }
  async function applyColours() {
    const api = state.api;
    if (!state.coloured) return api.viewer.setObjectState(undefined, { color: "reset", opacity: 1 });
    await api.viewer.setObjectState(undefined, { color: GHOST, opacity: GHOST_OPACITY });   // everything that is not a pour
    const rec = recordOf();
    const buckets = STAGES.map(() => []);
    for (const o of state.objects) buckets[STAGES.indexOf(S.stageOf(rec(o)))].push(o);
    for (let k = 0; k < STAGES.length; k++) {
      if (buckets[k].length) await api.viewer.setObjectState(selector(buckets[k]), { color: STAGES[k].colour, opacity: k === 0 ? NOT_STARTED_OPACITY : 1 });
    }
  }

  // ---------- rendering ----------
  const stageName = (s) => (clientLook() && PLAIN[s.id] ? PLAIN[s.id][lang === "bg" ? 0 : 1] : lang === "bg" ? s.bg : s.en);
  function basisLine(sum) {
    const b = sum.basedOn || {};
    const models = (b.models || []).map((m) => esc(m.name) + (m.version || m.date ? ` <span class="sub">(${esc([m.version, fmtDate(m.date)].filter(Boolean).join(", "))})</span>` : "")).join(", ");
    // week 4: "N елемента без номер на такт не са включени" (round 14) and the steel basis (B-Client 2), report.js
    const extra = RP ? RP.basisExtras(sum, lang).map((x) => " · " + esc(x)).join("") : "";
    return `${esc(t("basedOn"))}: <b>${esc(b.stage || t("loadedModels"))}</b>${models ? " · " + models : ""} · ${esc(t("dataAsOf"))} ${esc(fmtDate(sum.date))}${extra}`;
  }
  // ---------- B-Client 4: printable report of the shown published summary ----------
  /** The print view: only from a published summary (the client view, or "Виж като клиент" for staff). */
  function renderReport() {
    const open = state.report && inSummary() && !!RP;
    $("report").hidden = !open;
    $("app").classList.toggle("reporting", open);   // index.html: the panel is hidden behind the report while it is open
    if (!open) return;
    $("btnDoPrint").textContent = t("print"); $("btnBack").textContent = t("back");
    $("btnWeek").textContent = t("week"); $("btnMonth").textContent = t("month");
    $("btnWeek").classList.toggle("on", state.period !== "month"); $("btnMonth").classList.toggle("on", state.period === "month");
    $("printHint").textContent = t("printHint");
    // round 17 L6: the report HTML (up to ~1 MB at 5 000 pours) is built again only when the summary, the language or
    // the period changed, not on every render while the print view is open
    const sum = sumOf(state.sumDay);
    if (repBuilt.sum !== sum || repBuilt.lang !== lang || repBuilt.period !== state.period) {
      $("repBody").innerHTML = RP.html(sum, { lang, period: state.period, photoUrl: (id) => phUrls.get(id) || "" });
      repBuilt = { sum, lang, period: state.period };
    }
  }
  let repBuilt = { sum: null, lang: "", period: "" };
  function openReport() {
    if (!inSummary()) return;
    state.report = true;
    render();
    return printWhenReady();
  }
  /** The photos of the report PERIOD: their URLs first (also those already being asked), then the images of the report
   *  as it is then (it may have been rebuilt meanwhile) loaded, at most 10 s, so they are in the print. */
  async function printWhenReady() {
    const sum = sumOf(state.sumDay);
    if (sum && RP) {
      const from = RP.periodFrom(sum, state.period === "month" ? "month" : "week");
      await loadPhotoUrls((sum.site || []).filter((x) => x.date > from && x.date <= sum.date).flatMap((x) => x.photos || []));
    }
    render();
    const imgs = typeof document.querySelectorAll === "function" ? [...document.querySelectorAll("#repBody img")] : [];
    const loaded = (im) => (im.complete ? null : new Promise((r) => { im.addEventListener("load", r, { once: true }); im.addEventListener("error", r, { once: true }); }));
    if (imgs.length) await Promise.race([Promise.all(imgs.map(loaded)), new Promise((r) => setTimeout(r, 10000))]);
    // the browser's print dialog ("Save as PDF" for a file); @media print in index.html shows only the report
    if (typeof window.print === "function") setTimeout(() => { try { window.print(); } catch (e) { console.warn("print", e); } }, 150);
  }
  function render() {
    document.documentElement.lang = lang;
    const look = clientLook() ? "client" : "live";
    if (state.lastLook !== look) { $("details").open = look !== "client"; state.lastLook = look; }   // collapsed for clients
    const summary = inSummary();
    $("title").textContent = t("title");
    $("lblColour").textContent = t("colour"); $("btnView").textContent = t("view");
    $("btnView").hidden = clientLook();   // A19: clients do not create views (nor does "Виж като клиент", round 16)
    $("hAsOf").textContent = t("asOf"); $("lblAsOf").textContent = t("asOfLbl"); $("btnToday").textContent = t("today");
    $("sumDetails").textContent = t("details"); $("hPours").textContent = t("pours"); $("hTimeline").textContent = t("timeline");
    $("btnMore").textContent = t("more");
    $("btnByType").textContent = t("byType"); $("btnList").textContent = t("list");
    $("btnByType").classList.toggle("on", state.group === "type"); $("btnList").classList.toggle("on", state.group !== "type");
    $("legend").innerHTML = STAGES.map((s, k) => `<span><span class="sw" style="background:${s.colour}${k === 0 ? `;opacity:${NOT_STARTED_OPACITY + 0.2}` : ""}"></span>${esc(stageName(s))}</span>`).join("")
      + `<span><span class="sw" style="background:${GHOST}"></span>${esc(t("other"))}</span>`;
    renderPublish();
    // round 16: "Виж като клиент" shows the client's status line, not the staff counts
    if (state.asClient && isStaff() && summary) setStatus(() => `${t("published")} ${fmtDate(state.sumDay)}`);
    // published-summary picker ("както е публикувано на 14.11")
    $("sumBox").hidden = !summary;
    if (summary) {
      $("lblSum").textContent = t("published") + unverifiedMark();
      $("selSum").innerHTML = state.summaries.map((f, i) => `<option value="${esc(f.day)}"${f.day === state.sumDay ? " selected" : ""}>${esc(fmtDate(f.day))}${i === 0 ? ` (${esc(t("latest"))})` : ""}</option>`).join("");
    }
    // as of (live only)
    $("hAsOf").hidden = summary; $("asOfBox").hidden = summary;
    const rng = $("rngAsOf");
    rng.max = String(Math.max(0, state.days.length - 1));
    rng.disabled = state.days.length < 2;
    rng.value = String(state.asOf ? Math.max(0, state.days.indexOf(state.asOf)) : Math.max(0, state.days.length - 1));
    $("asOfDate").textContent = fmtDate(state.asOf || S.today());
    $("btnToday").hidden = !state.asOf;

    const sum = shown();
    // headline (A18)
    const h = CS.headline(sum);
    $("headline").innerHTML = `<div class="hl"><span class="big">${fmtNum(h.pct * 100, 0)}%</span> <span>${esc(t("poured"))}
      <span class="num">(${fmtNum(h.qty, decOf(h.unit))} / ${fmtNum(h.total, decOf(h.unit))} ${esc(h.unit)})</span>
      · <b>+${fmtNum(h.weekQty, decOf(h.unit))} ${esc(h.unit)}</b> ${esc(t("thisWeek"))} · <b>${h.poured} / ${h.pours}</b> ${esc(tn(h.pours, "poursWord"))}</span></div>
      <div class="basis">${basisLine(sum)}</div>`
      + (summary && sum.clientNote ? `<div class="cnote"><b>${esc(t("clientNote"))}:</b> ${esc(sum.clientNote)}</div>` : "");
    // second headline card: steel (B-Client 2), from the summary's steel section (the client never reads the library)
    // round 19 L10: staff (not "Виж като клиент") see why the steel is missing instead of no card at all
    const steelMissing = !summary && !clientLook() && isStaff() && !sum.steel && state.steelErr;
    $("steelCard").hidden = !(sum.steel && RP) && !steelMissing;
    // round 15 L9: the steel records have no history per day, so with "Състояние към" a past day the card still shows
    // today's steel - said on the card, next to that day's concrete figures
    const steelNow = !summary && state.asOf ? ` <span class="sub">(${esc(t("steelToday"))})</span>` : "";
    $("steelCard").innerHTML = sum.steel && RP ? `<div class="hl">${RP.steelCard(sum.steel, lang)}${steelNow}</div>`
      : steelMissing ? `<div class="hl sub">${esc(t("steelNA"))} (${esc(steelReason(state.steelErr))})</div>` : "";
    // round 14: objects with no pour number, for staff only (the client's "based on" says they are left out)
    const nLoose = summary ? 0 : looseCount();
    $("looseNote").hidden = clientLook() || !nLoose;
    $("looseNote").textContent = nLoose ? `${t("loose")}: ${nLoose} ${tn(nLoose, "objects")} (${t("looseHint")})` : "";
    $("btnPrint").textContent = t("print");
    $("btnPrint").hidden = !summary || !RP;
    // details: the four bars, each in its unit
    $("overall").innerHTML = S.STEPS.map((st) => {
      const s = sum.totals[st.id];
      return `<div class="stat"><div class="hd"><b>${esc(stageName(st))}</b><span class="num">${fmtNum(s.pct * 100, 0)}%${s.unit ? ` · ${fmtNum(s.qty, decOf(s.unit))} / ${fmtNum(s.total, decOf(s.unit))} ${s.unit}` : ""}</span></div>
        <div class="track"><div class="fill" style="width:${Math.min(100, s.pct * 100).toFixed(1)}%;background:${st.colour}"></div></div>
        <div class="sub">${s.pours} / ${sum.counts.pours} ${esc(tn(sum.counts.pours, "poursDone"))}</div></div>`;
    }).join("") + `<div class="note">${esc(t("byVolume"))}${clientLook() ? "" : ` · ${sum.counts.objects} ${esc(tn(sum.counts.objects, "objects"))}`}</div>`;
    // per pour (B-Client 3: rebar accepted; B-Client 7: by type)
    const acc = sum.pours.some((p) => p.rebar !== null);
    const short = lang === "bg" ? ["Кофраж", "Арм.", "Излят", "Декофр."] : ["Formwork", "Rebar", "Poured", "Stripped"];
    const cols = 1 + short.length + (acc ? 1 : 0);
    $("pourHead").innerHTML = `<tr><th>${esc(t("pour"))}</th>${short.map((x) => `<th class="c">${x}</th>`).join("")}${acc ? `<th class="c">${esc(t("rebarAcc"))}</th>` : ""}</tr>`;
    const row = (p) => `<tr><td><span class="name">${esc(p.label)}</span>${clientLook() ? "" : ` <span class="sub">${p.objects}</span>`}</td>${S.STEPS.map((st) => {
      const c = p.steps[st.id];
      if (CS.allNa(p, st.id)) return `<td class="c done" title="${esc(fmtDate(c.date))}">${esc(t("without"))}</td>`;   // the stage does not apply
      if (CS.isComplete(p, st.id)) return `<td class="c done" title="${esc(fmtDate(c.date))}">${esc(fmtShort(c.date)) || "✓"}</td>`;
      if (c.done) return `<td class="c part">${c.done}/${p.objects}</td>`;
      return `<td class="c none">–</td>`;
    }).join("")}${acc ? `<td class="c ${p.rebar === "yes" ? "ok" : p.rebar === "pending" ? "part" : "none"}">${p.rebar === "yes" ? "✓" : p.rebar === "pending" ? esc(t("pending")) : "–"}</td>` : ""}</tr>`;
    if (state.group === "type") {
      $("pourRows").innerHTML = CS.groupByType(sum.pours).map((g) => `<tr class="grp"><td colspan="${cols}">${esc(CS.typeName(g.type, lang) || t("noType"))}
        <span class="sub">· ${g.pours.length} ${esc(tn(g.pours.length, "poursWord"))} · ${esc(t("groupPoured"))} ${g.poured}</span></td></tr>` + g.pours.map(row).join("")).join("");
    } else $("pourRows").innerHTML = sum.pours.map(row).join("");
    // timeline
    const stepById = Object.fromEntries(S.STEPS.map((s) => [s.id, s]));
    const tl = summary ? CS.timelineOf(sum) : P.timeline(state.objects, currentRecords());
    const list = state.showAll ? tl : tl.slice(0, 30);
    $("timeline").innerHTML = list.length ? list.map((e) => {
      const extra = summary ? "" : [clientLook() ? "" : `${e.count} ${esc(tn(e.count, "objects"))}`, e.qty >= 0.05 ? `${fmtNum(e.qty, decOf(e.unit))} ${e.unit}` : ""].filter(Boolean).join(" · ");
      return `<li><span class="d">${esc(fmtDate(e.date))}</span><span class="dot" style="background:${stepById[e.step].colour}"></span>
      <span><b>${esc(e.pour)}</b> · ${esc(stageName(stepById[e.step]))}${extra ? `<br><span class="sub">${extra}</span>` : ""}</span></li>`;
    }).join("") : `<li class="sub">${esc(t("noEvents"))}</li>`;
    $("btnMore").hidden = state.showAll || tl.length <= 30;
    renderSite(summary ? sum : null);
    renderReport();
  }

  // ---------- Дейности for the client (shared/arsten-activities.js; entered in the Дейности panel) ----------
  const SITE_CLIENT_DAYS = 30;
  /** Client look only: the published summary's activities of the last 30 days, read-only. Staff edit them in Дейности. */
  function renderSite(sum) {
    const rows = clientLook() && sum && sum.site ? sum.site.filter((x) => x.date > CS.addDays(sum.date, -SITE_CLIENT_DAYS)) : [];
    $("hSite").hidden = !rows.length; $("siteBox").hidden = !rows.length;
    if (!rows.length) return;
    $("hSite").textContent = t("site");
    $("siteHint").textContent = t("siteClientHint");
    $("siteList").innerHTML = rows.map((x) => `<li><span class="d">${esc(fmtDate(x.date))}</span><span class="txt">${esc(x.text)}${phThumbs(x)}</span></li>`).join("");
    loadPhotoUrls(rows.flatMap((x) => x.photos || []));
  }
  // photos of the published entries (client copies in _AM_Docs/Client/Photos): id -> download URL ("" failed, undefined loading)
  const phUrls = new Map();
  const phThumbs = (x) => {
    const ids = (x.photos || []).filter((id) => phUrls.get(id));
    return ids.length ? `<span class="ph">${ids.map((id) => `<img src="${esc(phUrls.get(id))}" alt="" loading="lazy" data-ph="${esc(id)}">`).join("")}</span>` : "";
  };
  const phPending = new Map();   // id -> promise while its URL is being asked (audit: a print waits for those too)
  /** Ask Connect for the download URLs of these photos (4 at a time, each once); re-render when they arrive. Resolves
   *  when every one of them is known, also those an earlier call is still asking for. */
  async function loadPhotoUrls(ids) {
    const all = [...new Set(ids)];
    const want = all.filter((id) => !phUrls.has(id));
    if (AV && want.length) {
      for (const id of want) phUrls.set(id, undefined);
      let i = 0;
      const next = async () => { while (i < want.length) { const id = want[i++]; try { phUrls.set(id, (await AV.photoUrl(coreFor(), id)) || ""); } catch (e) { console.warn("photo url", e); phUrls.set(id, ""); } } };
      const batch = Promise.all([next(), next(), next(), next()]).then(() => {
        for (const id of want) phPending.delete(id);
        repBuilt = { sum: null, lang: "", period: "" };   // the report is built again with the photos
        render();
      });
      for (const id of want) phPending.set(id, batch);
    }
    await Promise.all([...new Set(all.map((id) => phPending.get(id)).filter(Boolean))]);
  }
  document.addEventListener && document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("phView").hidden) $("phView").onclick(); });
  $("siteList").onclick = (e) => { const im = e.target; const id = im && im.dataset && im.dataset.ph; if (id && phUrls.get(id)) { $("phViewImg").src = phUrls.get(id); $("phView").hidden = false; } };
  $("phView").onclick = () => { $("phView").hidden = true; $("phViewImg").src = ""; };
  function renderPublish() {
    // the box ("Виж като клиент") for admin / GC; the publish form only for admin / PM (L8). Round 16: in "Виж като
    // клиент" the box is hidden too (the client has none); only "Изход от изгледа като клиент" stays.
    const show = isStaff() && !state.asClient;
    $("hPub").hidden = !show; $("pubBox").hidden = !show;
    $("leaveBar").hidden = !(isStaff() && state.asClient);
    $("btnLeaveClient").textContent = t("leaveClient");
    renderSteelAsk();
    if (!show) { $("pubForm").hidden = true; $("pubWho").hidden = true; return; }
    $("hPub").textContent = t("forClient");
    $("lblAsClient").textContent = t("asClient");
    $("chkAsClient").checked = state.asClient;
    $("chkAsClient").disabled = !state.summaries.length;
    $("pubForm").hidden = state.asClient || !canPublish();
    $("pubWho").hidden = canPublish();
    $("pubWho").textContent = canPublish() ? "" : t("pubWho") + (state.summaries.length ? ` ${t("lastPub")}: ${fmtDate(state.summaries[0].day)}${unverifiedMark()}.` : "");
    if (!canPublish()) return;
    $("lblStage").textContent = t("stageLbl"); $("lblNote").textContent = t("noteLbl");
    if (!$("inStage").value && state.stageName) $("inStage").value = state.stageName;
    const today = S.today(), done = state.summaries.some((f) => f.day === today);
    $("btnPublish").textContent = done ? t("republish") : t("publish");
    $("btnPublish").disabled = !state.objects.length || !state.lib;
    $("pubInfo").textContent = (state.summaries.length ? `${t("lastPub")}: ${fmtDate(state.summaries[0].day)}${unverifiedMark()}` : t("notPub"))
      + (state.sumDropped.length ? ` · ${state.sumDropped.length} ${t("dropped")}` : "");
    $("pubHint").textContent = t("pubHint");
  }

  // ---------- round 16 M1: the steel read at publishing time ----------
  const STEEL_RETRY_MS = 1500;
  const transient = (e) => !!e && (e.timeout === true || e.status === 429 || e.status === 503);
  /** The steel totals for publishing: {steel} (null = no steel library) or {error}. A 429, 503 or timeout is tried once
   *  more (after psetapi's own retries) before it counts as an error. */
  async function readSteel() {
    for (let n = 0; ; n++) {
      try { return { steel: await loadSteel(true) }; }   // fresh library lookup at publishing (round 18 L5)
      catch (e) {
        if (n === 0 && transient(e)) {
          console.warn("steel read failed, trying once more", e);
          await new Promise((r) => setTimeout(r, window.ARSTEN_DEMO ? 0 : STEEL_RETRY_MS));
          continue;
        }
        console.warn("steel not read", e);
        return { error: e };
      }
    }
  }
  /** Why the steel was not read, in plain words. */
  function steelReason(e) {
    if (e && (e.steelDenied || e.status === 403)) return t("rsDenied");
    if (e && e.timeout) return t("rsTimeout");
    if (e && e.status === 429) return t("rsBusy");
    return errText(e).slice(0, 160);
  }
  /** The newest published summary (from the cache of its version, else read once); null when none or not readable. */
  async function latestPublished() {
    const f = state.summaries[0];
    if (!f) return null;
    if (!state.sums.has(f.stamp)) { try { state.sums.set(f.stamp, await CS.readSummary(coreFor(), f.id, fetchFor())); } catch { return null; } }
    return state.sums.get(f.stamp) || null;
  }
  /** The inline question in the publish box: resolves true ("publish without the steel") or false ("cancel"). */
  function askSteel(error, had) {
    return new Promise((resolve) => { state.steelAsk = { error, had, resolve }; renderPublish(); });
  }
  function answerSteel(ok) {
    const a = state.steelAsk;
    state.steelAsk = null;
    $("steelAsk").hidden = true;
    if (a) a.resolve(ok);
  }
  function renderSteelAsk() {
    const a = state.steelAsk;
    $("steelAsk").hidden = !a;
    if (!a) return;
    const hint = a.error && (a.error.steelDenied || a.error.status === 403) ? t("steelDeniedHint") : t("steelRetryHint");
    $("steelAskText").textContent = `${t("steelFail")} (${steelReason(a.error)}) – ${t("steelOr")}${a.had ? " " + t("steelHad") : ""} ${hint}`;
    $("btnSteelGo").textContent = t("steelGo"); $("btnSteelCancel").textContent = t("steelCancel");
  }

  // ---------- publish (admin / GC) ----------
  // Round 10 M2: the pour statuses, the acceptance and the "based on" models are read again right before building, so a
  // panel left open since the morning does not publish the morning's figures stamped as today.
  let publishing = false;
  async function publish() {
    if (!canPublish() || !state.lib || publishing) return;
    publishing = true;
    $("btnPublish").disabled = true;
    try { await publish2(); } finally { publishing = false; $("btnPublish").disabled = !state.objects.length || !state.lib; }
  }
  async function publish2() {
    const day = S.today();
    setStatus(lang === "bg" ? "Четене на статусите на тактовете…" : "Reading the pour statuses…");
    await loadRecords(state.lib);      // fresh pour statuses at publishing time
    setStatus(lang === "bg" ? "Четене на приемането на армировката…" : "Reading the rebar acceptance…");
    await loadAcceptance(state.lib);   // fresh acceptance state at publishing time
    setStatus(lang === "bg" ? "Четене на моделите („Въз основа на“)…" : "Reading the models (\"Based on\")…");
    await loadBasis(state.lib);
    // B-Client 2: the steel totals afresh (read-only). Round 16 M1: no steel library = no steel section, as before; a
    // library that cannot be read, or a failed read (one more try on 429 / timeout), is never dropped silently: the
    // publish box asks "publish without the steel / cancel" and says when the client would stop seeing the steel.
    setStatus(lang === "bg" ? "Четене на стоманата (STEEL/Монтаж)…" : "Reading the steel (STEEL/Монтаж)…");
    const got = await readSteel();
    const steel = got.error ? null : got.steel || null;
    // Дейности afresh (a read error asks "publish without them?", as the steel does: never dropped silently)
    let siteOut = [];
    if (!AV && !window.confirm(t("siteReadFail") + "\n(arsten-activities.js)")) { setStatus(t("pubCancelled")); return; }
    if (AV) {
      setStatus(lang === "bg" ? "Четене на дейностите…" : "Reading the activities…");
      try { const r = await AV.load(coreFor(), state.project.id, fetchFor()); siteOut = AV.forSummary(r.items, day, { photos: true }); }
      catch (e) { console.warn("activities not read", e); setStatus(""); if (!window.confirm(t("siteReadFail") + `\n(${errText(e).slice(0, 160)})`)) { setStatus(t("pubCancelled")); return; } }
    }
    const prev = await latestPublished();
    const hadSteel = !!(prev && prev.steel);
    if (got.error) {
      setStatus("");
      if (!(await askSteel(got.error, hadSteel))) { setStatus(t("pubCancelled")); return; }
    }
    if (state.asOf && !state.days.includes(state.asOf)) state.asOf = "";
    render();                          // the live view shows the fresh figures behind the confirm dialog
    setStatus(lang === "bg" ? "Подготовка на резюмето…" : "Preparing the summary…");
    // the photos of the client entries are copied to _AM_Docs/Client/Photos only after the confirm below; the summary
    // shown in the confirm is built without them, then built again with the copies' ids (same inputs, same time stamp)
    const nPhotos = siteOut.reduce((n, x) => n + ((x.src || []).length), 0);
    const buildArgs = { date: day, now: new Date(), project: state.project, objects: state.objects, pours: state.pours, loose: state.loose, records: state.records,
      accepted: state.accepted, note: $("inNote").value, basedOn: { stage: $("inStage").value, models: state.models }, steel, site: siteOut };
    let sum = CS.build(buildArgs);
    const v = CS.validate(sum);
    if (!v.ok) throw new Error((lang === "bg" ? "Резюмето не е безопасно за клиента и НЕ е публикувано: " : "The summary is not client-safe and was NOT published: ") + v.errors.slice(0, 3).join("; "));
    const h = CS.headline(sum), again = state.summaries.some((f) => f.day === day);
    const q = lang === "bg"
      ? `Публикуване за клиента към ${fmtDate(day)}${again ? " (замества днешното, като нова версия)" : ""}:\n${fmtNum(h.pct * 100, 0)}% излято, ${h.poured} / ${h.pours} ${h.pours === 1 ? "такт" : "такта"}.\nКлиентът ще вижда тези данни, докато не публикувате ново резюме.`
      : `Publish for the client as of ${fmtDate(day)}${again ? " (replaces today's, as a new version)" : ""}:\n${fmtNum(h.pct * 100, 0)}% poured, ${h.poured} / ${h.pours} pours.\nThe client sees this until you publish a new one.`;
    // the steel line as the client will see it (plain text of the card)
    const qLines = q.split("\n");
    if (sum.steel && RP) qLines.splice(2, 0, RP.steelCard(sum.steel, lang).replace(/<[^>]+>/g, ""));
    else if (hadSteel) qLines.splice(2, 0, t("steelLeft"));   // round 16 M1: the client's steel card would disappear
    // activities going out: how many, and how many in the report week
    if (sum.site && sum.site.length) {
      const wk = sum.site.filter((x) => x.date > sum.week.from).length;
      qLines.splice(qLines.length - 1, 0, `${t("sitePub")}: ${sum.site.length} (${t("siteWeek")}: ${wk})${nPhotos ? ` · ${t("sitePhotos")}: ${nPhotos}` : ""}`);
    }
    // round 19 L8: the note that goes out with it (a note pre-filled from the last summary must not go out unseen)
    const noteOut = String(sum.clientNote || "").trim();
    const noteShown = noteOut.length > 300 ? noteOut.slice(0, 300) + "…" : noteOut;
    qLines.splice(qLines.length - 1, 0, noteOut ? (lang === "bg" ? `Бележка: „${noteShown}“` : `Note: "${noteShown}"`) : (lang === "bg" ? "Без бележка." : "No note."));
    if (!window.confirm(qLines.join("\n"))) { setStatus(""); return; }
    const c = coreFor();
    let photoNote = "";
    if (nPhotos && AV) {
      setStatus(`${t("sitePhCopy")} 0 / ${nPhotos}…`);
      const cp = await AV.copyForClient({ core: c, projectId: state.project.id, site: siteOut, fetch: fetchFor(),
        onProgress: (d, n) => setStatus(`${t("sitePhCopy")} ${d} / ${n}…`) });
      sum = CS.build(Object.assign({}, buildArgs, { site: cp.site }));
      const v2 = CS.validate(sum);
      if (!v2.ok) throw new Error((lang === "bg" ? "Резюмето не е безопасно за клиента и НЕ е публикувано: " : "The summary is not client-safe and was NOT published: ") + v2.errors.slice(0, 3).join("; "));
      if (cp.failed) photoNote = ` · ${cp.failed} ${t("sitePhFailed")}`;
    }
    state.folderCache = state.folderCache || new Map();
    const folderId = await B.ensureFolder(c, state.project.id, CS.FOLDER, state.folderCache);
    await B.uploadJson(c, folderId, CS.fileName(day), CS.toJson(sum), { fetch: window.ARSTEN_FETCH });
    try { await refreshSummaries(); } catch {}
    if (!sumFile(day)) state.summaries.unshift({ day, id: "", name: CS.fileName(day), modifiedOn: "", stamp: `local|${day}|${sum.published}` });
    state.sums.set(sumFile(day).stamp, sum);   // what was just uploaded is that version
    setStatus((lang === "bg" ? `Публикувано за клиента: ${CS.FOLDER.join("/")}/${CS.fileName(day)}` : `Published for the client: ${CS.FOLDER.join("/")}/${CS.fileName(day)}`) + photoNote, !!photoNote);
    render();
  }

  // ---------- save view ----------
  async function saveView() {
    if (state.role === "client") return;
    const name = window.prompt(lang === "bg" ? "Име на изгледа:" : "View name:",
      `${t("title")} ${fmtDate(state.asOf || S.today())}`);
    if (!name) return;
    if (!state.coloured) { state.coloured = true; $("chkColour").checked = true; await applyColours(); }
    await state.api.view.createView({ name, description: `${t("title")} · ${t("asOfLbl")} ${fmtDate(state.asOf || S.today())}` });
    setStatus(lang === "bg" ? `Изгледът „${name}“ е запазен. Споделете го от Изгледи → ⋮ → Редакция → „Shared with“.`
      : `View "${name}" saved. Share it from Views → ⋮ → Edit → "Shared with".`);
  }

  // ---------- wiring ----------
  $("chkColour").onchange = (e) => guarded(async () => { state.coloured = e.target.checked; await applyColours(); });
  $("btnView").onclick = () => guarded(saveView);
  let asOfTimer = null;
  $("rngAsOf").oninput = (e) => {
    const d = state.days[+e.target.value] || "";
    state.asOf = d && d < S.today() ? d : "";
    render();
    clearTimeout(asOfTimer);
    if (state.coloured) asOfTimer = setTimeout(() => guarded(applyColours), 250);
  };
  $("btnToday").onclick = () => guarded(async () => { state.asOf = ""; render(); if (state.coloured) await applyColours(); });
  $("btnMore").onclick = () => { state.showAll = true; render(); };
  $("selLang").value = lang;
  $("selLang").onchange = (e) => { lang = I18N ? I18N.setLang(e.target.value) : e.target.value; if (!I18N) { try { localStorage.setItem(LANG_KEY, lang); } catch {} } render(); relabelStatus(); };
  const setGroup = (g) => { state.group = g; try { localStorage.setItem(GROUP_KEY, g); } catch {} render(); };
  $("btnByType").onclick = () => setGroup("type");
  $("btnList").onclick = () => setGroup("list");
  $("selSum").onchange = (e) => guarded(async () => {
    await openSummary(e.target.value);
    state.sumPicked = !!state.summaries.length && state.sumDay !== state.summaries[0].day;   // the newest = follow new publishes
    render(); if (state.coloured) await applyColours();
  });
  async function setAsClient(on) {
    if (on && state.steelAsk) answerSteel(false);   // a pending "publish without the steel?" is cancelled
    state.asClient = on;
    $("chkAsClient").checked = on;
    state.sumPicked = false;
    state.report = false;
    if (state.asClient) { await openSummary(state.summaries[0] && state.summaries[0].day); state.look = state.sumDay ? "summary" : "live"; }
    else { state.look = "live"; if (state.staffStatus) setStatus(state.staffStatus); }
    render();
    if (state.coloured) await applyColours();
  }
  $("chkAsClient").onchange = (e) => guarded(() => setAsClient(e.target.checked));
  $("btnLeaveClient").onclick = () => guarded(() => setAsClient(false));
  $("btnSteelGo").onclick = () => answerSteel(true);
  $("btnSteelCancel").onclick = () => answerSteel(false);
  $("btnPublish").onclick = () => guarded(publish);
  // B-Client 4: "Печат / PDF" opens the print view of the shown summary and the print dialog
  $("btnPrint").onclick = () => guarded(openReport);
  $("btnDoPrint").onclick = () => guarded(printWhenReady);   // after Седмица -> Месец the month's photos load first
  $("btnBack").onclick = () => { state.report = false; render(); };
  $("btnWeek").onclick = () => { state.period = "week"; render(); };
  $("btnMonth").onclick = () => { state.period = "month"; render(); };

  /** One full load. Returns true when the panel shows the data (then a later event with the same models skips the reload). */
  async function load(key) {
    setStatus(lang === "bg" ? "Зареждане…" : "Loading…");
    state.lib = null;
    // Round 12 M4: the independent reads at the same time: the pour objects (viewer), the published summaries (Core,
    // with the uploader check) and, for admin / GC, the library lookup (pset-api). Errors are reported in the same order.
    let poursErr = null, sumErr = null;
    const libP = state.role !== "client" ? state.client.findLibrary(state.project.id, S.LIB_NAMES) : null;
    if (libP) libP.catch(() => {});   // awaited below; an error here must not be "unhandled" when there are no pours
    await Promise.all([
      loadPours().catch((e) => { poursErr = e; state.pours = []; state.loose = []; state.objects = []; }),
      // published summaries: the client reads ONLY these
      refreshSummaries().catch((e) => { sumErr = e; state.summaries = []; console.warn("summaries not listed", e); }),
    ]);
    if (state.role === "client") {
      // M1 (round 11): summary only. No library, no pour records, no acceptance, never a live fallback.
      state.records = new Map(); state.accepted = null; state.lib = null;
      if (state.summaries.length && await openFirstReadable()) {
        state.look = "summary";
        $("main").hidden = false;
        setStatus(() => `${t("published")} ${fmtDate(state.sumDay)}`);
        render();
        if (state.coloured) await applyColours();
        return true;
      }
      state.look = "live"; state.sumDay = "";
      $("main").hidden = true;
      if (state.coloured) { state.coloured = false; $("chkColour").checked = false; try { await applyColours(); } catch {} }
      return setStatus(t("noReport"));
    }
    if (poursErr) throw poursErr;
    if (!state.objects.length) { $("main").hidden = true; return setStatus(t("noPours"), true); }
    const found = await libP;
    if (!found.lib) { $("main").hidden = true; return setStatus(t("noLib"), true); }
    state.lib = found.lib;
    // records, acceptance and "based on" at the same time (round 12 M4); only the records can fail the load
    await Promise.all([loadRecords(found.lib), loadAcceptance(found.lib), loadBasis(found.lib)]);
    if (state.asClient && state.summaries.length) { try { await openSummary(reloadDay()); state.look = "summary"; } catch { state.look = "live"; } }
    else state.look = "live";
    // the PM's last client note, as a starting point for the next publish
    if (canPublish() && !$("inNote").value && state.summaries.length) {
      const keep = state.sumDay;
      try { const s = await openSummary(state.summaries[0].day); $("inNote").value = s.clientNote || ""; if (!state.asClient) state.look = "live"; } catch {}
      if (state.asClient && keep && sumFile(keep)) state.sumDay = keep;   // reading the note does not change the day shown
    }
    $("main").hidden = false;
    const nLoose = looseCount();   // round 14: as Монолитен бетон, "N такта"; the objects with no pour number apart
    state.staffStatus = () => `${state.pours.length} ${tn(state.pours.length, "poursWord")} · ${state.objects.length} ${tn(state.objects.length, "objects")}`
      + (nLoose ? ` · ${t("loose")}: ${nLoose} ${tn(nLoose, "objects")}` : "")
      + (sumErr && isStaff() ? ` · ${lang === "bg" ? "резюметата не се четат" : "summaries not readable"}: ${errText(sumErr)}` : "");
    setStatus(state.staffStatus);
    render();
    if (state.coloured) await applyColours();
    // B-Client 2: steel totals for the staff live view, after the first screen (read-only; publishing reads them again).
    // Round 17 M1: only when the model set changed or the last read is older than 5 minutes.
    refreshSteel(key);
    return true;
  }

  // ---------- loads: one at a time; a model event with the same models re-reads nothing (round 17 M1) ----------
  /** Key of the loaded models, as Монолитен бетон (viewer-pour-status U.modelSetKey): "id@versionId" sorted; null when it
   *  cannot be compared safely (nothing loaded, or a model without id / versionId: then the panel always reloads). */
  function modelSetKey(specs) {
    if (!Array.isArray(specs) || !specs.length) return null;
    const out = new Set();
    for (const m of specs) {
      if (!m || m.id == null || m.id === "" || m.versionId == null || m.versionId === "") return null;
      out.add(String(m.id) + "@" + String(m.versionId));
    }
    return [...out].sort().join("|");
  }
  const sameModelSet = (a, b) => a != null && b != null && a === b;
  async function loadedModels() {
    try { return (await state.api.viewer.getModels("loaded")) || []; } catch { return []; }
  }
  // lastModelsKey: the model set of the last load that showed the data. loadRun: the load running now; loadNext: the ONE
  // load queued behind it (any number of events while a load runs queue exactly one more; a forced one stays forced).
  let lastModelsKey = null, loadRun = null, loadNext = null;
  async function loadOnce(force) {
    const key = modelSetKey(await loadedModels());
    if (!force && sameModelSet(lastModelsKey, key)) {
      console.info("[Статус] model event: the loaded models did not change – no reload");
      if (state.coloured && !$("main").hidden) await applyColours();
      refreshSteel(key);   // only if the live steel is older than 5 minutes
      return;
    }
    lastModelsKey = null;
    if (await load(key)) lastModelsKey = key;
  }
  /** force: the first load (and tests' refresh); a model event is not forced and is skipped for the same model set. */
  function runLoad(force) {
    if (loadRun) {
      if (loadNext) { if (force) loadNext.force = true; return loadNext.p; }
      const q = loadNext = { force: !!force };
      q.p = loadRun.then(() => { loadNext = null; return runLoad(q.force); });
      return q.p;
    }
    const run = loadRun = (async () => { try { await guarded(() => loadOnce(force)); } finally { if (loadRun === run) loadRun = null; } })();
    return run;
  }

  /** A19: English when the Connect user's language is not Bulgarian (unless the user chose a language here). */
  async function pickLanguage(api, access) {
    if (storedLang) return;
    let l = "";
    try { const s = await api.user.getSettings(); l = (s && s.language) || ""; } catch {}
    if (!l) l = (access && access.user && access.user.language) || "";
    if (l) { lang = /^bg/i.test(l) ? "bg" : "en"; $("selLang").value = lang; }
  }

  async function start(api, client) {
    state.api = api;
    const demo = window.ARSTEN_DEMO;
    if (window.ArstenDiag) ArstenDiag.set({ panel: "Статус (project-status)", lang: () => lang });   // round 19 M1: before the access check, so a denied screen's diagnostics name the panel
    const access = demo ? { allowed: true, role: (demo && demo.role) || "admin", roles: demo && demo.roles, caps: (demo && demo.caps) || [], user: { language: (demo && demo.language) || "" } } : await ArstenAccess.check({ api, getToken, app: "projectStatus" });
    if (!access.allowed) { state.api = null; ArstenAccess.renderDenied(document.body, lang, access); return; }
    state.role = panelRole(access);
    state.caps = Array.isArray(access.caps) ? access.caps.slice() : [];
    await pickLanguage(api, access);
    state.project = (await api.project.getProject()) || {};
    // A23; the signed-in user's name is hidden in the copied diagnostics (round 15 L3)
    let diagUser = "";
    if (window.ArstenDiag && !demo) { try { const u = await api.user.getUser(); diagUser = (u && ([u.firstName, u.lastName].filter(Boolean).join(" ") || u.email)) || ""; } catch {} }
    if (window.ArstenDiag) ArstenDiag.set({ panel: "Статус (project-status)", projectId: state.project.id, redact: [diagUser], lang: () => lang });
    state.client = client || new A.PsetClient({ region: state.project.location || "europe", getToken });
    render();
    await runLoad(true);
  }
  // reload: what a model event runs after its debounce (skipped for the same models); refresh: a forced full load (tests)
  window.ProjectStatusApp = { start, state, panelRole, reload: () => runLoad(false), refresh: () => runLoad(true), modelSetKey, sameModelSet,
    _token: { getToken, onToken, waiting: () => waiters.length } };

  let reloadTimer = null;
  function onEvent(event, data) {
    if (event === "extension.accessToken") onToken(data);
    if (event === "viewer.onModelStateChanged" && state.client) { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => runLoad(false), 1500); }
    if (event === "viewer.onModelReset") { state.coloured = false; $("chkColour").checked = false; }
  }
  if (window.parent === window) {
    if (/[?&]demo\b/.test(location.search)) { const s = document.createElement("script"); s.src = "demo.js?t=" + Date.now(); document.body.appendChild(s); }
    else setStatus(I18N ? I18N.word("notInside", lang) : "Not inside Trimble Connect.", true);
    return;
  }
  if (I18N) setStatus(I18N.word("connecting", lang));
  TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000)
    .then((api) => start(api))
    .catch((e) => setStatus((I18N ? I18N.word("connectFail", lang) : "Could not connect to Trimble Connect") + ": " + errText(e), true));
})();
