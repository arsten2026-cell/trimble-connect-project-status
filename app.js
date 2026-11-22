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
    objects: ["обекта", "objects"], objects1: ["обект", "object"], poursWord1: ["такт", "pour"],
    poured: ["излято", "poured"], thisWeek: ["тази седмица", "this week"], poursWord: ["такта", "pours"],
    basedOn: ["Въз основа на", "Based on"], loadedModels: ["заредените модели", "the loaded models"], dataAsOf: ["данни към", "data as of"],
    clientNote: ["Бележка", "Note"],
    forClient: ["За клиента", "For the client"], asClient: ["Виж като клиент", "View as client"],
    // sweep 18.11.2026 (finding 7): plain label; the long list of what goes out is behind "Какво се публикува?"
    stageLbl: ["Етап на строежа (вижда се в отчета)", "Construction stage (shown in the report)"], noteLbl: ["Бележка към клиента (закъснения, нови дати)", "Note to the client (delays, new dates)"],
    publish: ["Публикувай за клиента", "Publish for the client"], republish: ["Публикувай отново (днес)", "Publish again (today)"],
    lastPub: ["Последно публикувано", "Last published"], notPub: ["Още няма публикувано резюме.", "Nothing published yet."],
    noReport: ["Все още няма публикуван отчет.", "No report has been published yet."],
    // sweep 18.11.2026 (finding 5): a failed read is not "nothing published"; the client gets a button to try again
    loadFail: ["Отчетът не можа да се зареди – проверете интернета и натиснете „Опитай пак“.", "The report could not be loaded – check the internet and press \"Try again\"."],
    retry: ["Опитай пак", "Try again"],
    // sweep 18.11.2026 (finding 2): the last summary could not be read at publishing, so nothing can be compared with it
    prevFail: ["Последното резюме не се прочете – не може да се сравни.", "The last summary could not be read – no comparison."],
    unverified: ["непроверен източник", "unverified source"],
    // sweep 18.11.2026: role names in plain words; the group codes stay in the console and the diagnostics only
    pubWho: ["Публикува администраторът или ръководителят изпълнение.", "The admin or the execution PM publishes."],
    dropped: ["пропуснати резюмета (качени от някой без право да публикува)", "summaries skipped (uploaded by someone who may not publish)"],
    published: ["Както е публикувано на", "As published on"], latest: ["последно", "latest"],
    rebarAcc: ["Арм. приета", "Rebar accepted"], rebarAccClient: ["Армировка приета", "Rebar accepted"],
    // sweep 18.11.2026 (finding 6): the client look uses the printed report's words, not the site abbreviations or N/M
    inProgress: ["в процес", "in progress"], pending: ["чака", "pending"],
    byType: ["По тип", "By type"], list: ["Списък", "List"], noType: ["Без тип", "No type"],
    // sweep 18.11.2026 (b): the word Монолитен бетон now uses for a step that does not apply (was "без" / "n/a")
    groupPoured: ["излети", "poured"], without: ["не се прави", "not needed"],
    // sweep 18.11.2026 (b): day / week steps beside the "Към дата" slider (one pixel is about a day on a phone)
    dayBack: ["‹ ден", "‹ day"], dayFwd: ["ден ›", "day ›"], weekBack: ["‹ седмица", "‹ week"],
    pubHint: ["Клиентът вижда само количества, дати и дейностите „за клиента“ – без имена и бележки.",
      "The client sees only quantities, dates and activities marked for the client – no names or notes."],
    pubWhat: ["Какво се публикува?", "What is published?"],
    pubHintFull: ["Публикува се само: количества по етапи, дати по тактове, „армировка приета“ да/не, общо за стоманата (изработено / доставено / монтирано), дейностите „за клиента“ (с до 6 снимки на запис), бележката и „въз основа на“. Без имена, марки, вътрешни бележки и история.",
      "Published: quantities per stage, dates per pour, \"rebar accepted\" yes/no, steel totals (fabricated / delivered / erected), the activities marked \"for the client\" (with up to 6 photos each), the note and \"based on\". No names, marks, internal notes or history."],
    loose: ["Без номер на такт", "No pour number"], looseHint: ["не се броят като такт", "not counted as a pour"],
    print: ["Печат / PDF", "Print / PDF"], back: ["Назад", "Back"], week: ["Седмица", "Week"], month: ["Месец", "Month"],
    printHint: ["В прозореца за печат изберете „Запази като PDF“ за файл.", "In the print dialog choose \"Save as PDF\" for a file."],
    // round 16 M1: the steel could not be read at publishing time
    steelFail: ["Стоманата не можа да се прочете", "The steel could not be read"],
    steelNA: ["Стоманата не е налична", "Steel not available"],
    steelOr: ["публикувай без нея или откажи.", "publish without it, or cancel."],
    steelHad: ["Последното публикувано резюме има стомана – клиентът ще спре да вижда стоманата.", "The last published summary has steel – the client will stop seeing the steel."],
    steelDeniedHint: ["Нека публикува администраторът или ръководителят изпълнение, за да е включена.", "Let the admin or the execution PM publish to include it."],
    steelRetryHint: ["Може да опитате пак след малко.", "You can try again in a moment."],
    steelGo: ["Публикувай без стоманата", "Publish without the steel"], steelCancel: ["Откажи", "Cancel"],
    rsDenied: ["нямате достъп до данните за стоманата", "no access to the steel data"], rsTimeout: ["Connect не отговаря", "Connect did not answer"],
    rsBusy: ["Connect е зает – опитайте след минута", "Connect is busy – try again in a minute"],
    rsViewer: ["моделът не отговаря", "the model did not answer"],
    steelLeft: ["Без стомана – клиентът ще спре да вижда стоманата.", "No steel – the client will stop seeing the steel."],
    pubCancelled: ["Публикуването е отказано – нищо не е качено.", "Publishing cancelled – nothing was uploaded."],
    // round 16 (L4): "Виж като клиент" shows only what the client sees, plus this one control
    leaveClient: ["Изход от изгледа като клиент", "Leave the client view"],
    // Дейности (shared/arsten-activities.js): the client view and publishing only
    site: ["Дейности на обекта", "Site activities"],
    siteClientHint: ["Записи от последните 30 дни.", "Entries from the last 30 days."],
    sitePub: ["Дейности за клиента", "Activities for the client"], sitePhotos: ["снимки", "photos"],
    sitePhCopy: ["Копиране на снимките за клиента", "Copying the photos for the client"],
    sitePhFailed: ["снимки не се копираха – записите отидоха без тях; публикувайте отново по-късно", "photos were not copied – the entries went out without them; publish again later"], siteWeek: ["в последните 7 дни", "in the last 7 days"],
    siteReadFail: ["Дейностите не можаха да се прочетат – публикуване без тях?", "The activities could not be read – publish without them?"],
    // sweep 18.11.2026: the publish question is a box in the panel (window.confirm can be blocked in Connect's frame)
    pubGo: ["Публикувай", "Publish"], pubWithout: ["Публикувай без тях", "Publish without them"],
    siteNew: ["Нови за клиента от последното публикуване", "New for the client since the last publish"], siteNoNew: ["Няма нови дейности от последното публикуване.", "No new activities since the last publish."],
    siteMore: ["и още", "and"], siteMoreEnd: ["", "more"],
    siteWho: ["Списъкът с дейности е качен последно от", "The activities list was last uploaded by"],
    siteWhoOut: ["който не е администратор, ръководител или от екипа на изпълнителя. Да влязат ли тези дейности при клиента?", "who is not the admin, a PM or on the contractor's team. Should these activities go to the client?"],
    // sweep 18.11.2026: the uploader could not be checked (no uploader in the listing, members not readable): asked too
    siteWhoUnknown: ["Не можа да се провери кой е качил списъка с дейности. Да влязат ли тези дейности при клиента?", "Could not check who uploaded the activities list. Should these activities go to the client?"],
    siteInclude: ["Включи дейностите", "Include the activities"], siteLeave: ["Без дейностите", "Without the activities"],
    siteLeft: ["Без дейности (списъкът не е качен от екипа).", "No activities (the list was not uploaded by the team)."],
    siteLeftUnknown: ["Без дейности (не можа да се провери кой е качил списъка).", "No activities (could not check who uploaded the list)."],
    // (Статус has no Обнови button: opening the panel again reads the list again)
    incomplete: ["списъкът с публикации може да е непълен – отворете панела отново", "the list of publications may be incomplete – open the panel again"],
    // sweep 18.11.2026: photos added to an entry that went out before (the photos are not part of its date + text)
    sitePhNew: ["Нови снимки към публикувани записи", "New photos on entries published before"],
    // sweep 18.11.2026: publish progress and result as texts of the table (rebuilt after a language switch)
    // sweep 18.11.2026 (b): the publish reads run together, so one progress text (they stepped through six before)
    pubRead: ["Чета данните…", "Reading the data…"], pubPrep: ["Подготовка на резюмето…", "Preparing the summary…"],
    // sweep 18.11.2026 (b): the publish question shows the whole text of each new entry and the photos going out
    pubShowAll: ["Покажи всички", "Show all"], pubShowAllHint: ["Прегледайте всички записи преди публикуване.", "Review every entry before publishing."],
    sitePhGoing: ["Снимки за клиента – отметнете тези, които не са за клиента:", "Photos for the client – tick the ones that are not for the client:"],
    phNotClient: ["не за клиента", "not for the client"],
    pubSaving: ["Качване на резюмето…", "Uploading the summary…"],
    published2: ["Публикувано за клиента ✓", "Published for the client ✓"], pubPrint: ["Печат на седмичния отчет", "Print weekly report"],
    pubNothing: ["Няма какво да се публикува: няма заредени тактове, стомана или дейности за клиента.", "Nothing to publish: no pours loaded, no steel and no activities for the client."],
    concreteLeft: ["Няма заредени тактове – клиентът ще спре да вижда бетона. Заредете модела с тактовете, ако не е нарочно.", "No pours loaded – the client will stop seeing the concrete. Load the pour model unless this is intended."],
    // sweep 18.11.2026 (finding 4): no pour objects in the loaded models is a valid state for staff (steel, activities)
    noPoursHint: ["Няма заредени тактове.", "No pours loaded."],
    // sweep 18.11.2026: "Запази изглед" asks for the name in the panel (window.prompt can be blocked in Connect's frame)
    viewName: ["Име на изгледа", "View name"], viewSave: ["Запази", "Save"], viewCancel: ["Откажи", "Cancel"],
    viewSaved: ["Изгледът „{n}“ е запазен. Споделяне: Изгледи → ⋮ → Редакция.", "View \"{n}\" saved. To share: Views → ⋮ → Edit."],
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
  const pad2 = (n) => String(n).padStart(2, "0");
  /** "YYYY-MM-DD" of a timestamp in the local time zone; the first 10 characters when it does not parse. */
  const localDay = (d) => { const x = new Date(d); return isNaN(x) ? String(d).slice(0, 10) : `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; };
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
    pubAsk: null,                  // sweep 18.11.2026: {text, go, cancel, resolve} while the publish box asks a question
    sumComplete: true,             // sweep 18.11.2026: false when the _AM_Docs/Client listing may be cut off
    ready: false,                  // sweep 18.11.2026: the last load ran to the end (publishing may start)
    pubDone: null,                 // sweep 18.11.2026: {day, failed} after a publish: success line + "Печат на седмичния отчет"
    reportAny: false,              // sweep 18.11.2026: the print view of the summary just published, from the live view
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
  // Sweep 18.11.2026: P.scanPours (4 chunks at once, GUIDs beside the properties, no boxes: Статус does not use them) and
  // a sessionStorage marker for a model version read in full without pour objects, as Монолитен бетон does. Before, a
  // stage with only the architecture or steel model loaded read every object one chunk after the other (~9 s) on every
  // open and every model-set change, and staff waited for it before the live view.
  const scanCache = {
    get: (k) => { try { const st = window.sessionStorage; return st ? JSON.parse(st.getItem(k) || "null") : null; } catch { return null; } },
    set: (k, v) => { try { const st = window.sessionStorage; if (st) st.setItem(k, JSON.stringify(v)); } catch {} },
    drop: (k) => { try { const st = window.sessionStorage; if (st) st.removeItem(k); } catch {} },
  };
  /** specs: getModels("loaded") of this load (model versions for the scan cache); read here when not given. */
  async function loadPours(specs) {
    const api = state.api;
    let modelObjs = await api.viewer.getObjects({ parameter: { class: PROXY } });
    let full = false;
    if (!(modelObjs || []).some((m) => (m.objects || []).length)) { modelObjs = await api.viewer.getObjects(); full = true; }
    if (full && !specs) specs = await loadedModels();
    const versions = new Map();
    for (const m of specs || []) if (m && m.versionId) { if (m.id != null) versions.set(m.id, m.versionId); versions.set(m.versionId, m.versionId); }
    const items = await P.scanPours(api, modelObjs, C.readPourPset, { batch: BATCH, limit: 4, mapLimit: A.mapLimit, full, versions, cache: scanCache,
      projectId: state.project && state.project.id, noBoxes: true });
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
    // side by side, as Pour status (speed audit item 7; sweep 18.11.2026): one batch-get round trip less on every load
    const [got, raw] = await Promise.all([state.client.readMany(lib.id, S.DEF_ID, links),
      legacy.length ? state.client.readMany(lib.id, S.DEF_ID, legacy) : new Map()]);
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
    // sweep 18.11.2026: a viewer error (models still streaming in, after a model reset) is NOT "no steel model": it was
    // swallowed, so publishing sent counts only without asking. It now fails the steel read (readSteel: one more try,
    // then "publish without the steel / cancel"; the staff card: "Стоманата не е налична (моделът не отговаря)").
    try { models = (await api.viewer.getObjects({ parameter: { class: ASSEMBLY } })) || []; }
    catch (e) { const err = new Error("viewer getObjects: " + errText(e)); err.viewer = true; err.cause = e; throw err; }
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
        // the Bulgarian (local) day, not the UTC day of Core's ISO time: a model uploaded at 01:30 on 17.11 is 17.11
        // (sweep 18.11.2026); this date also goes to the client summary (basedOn.models[].date)
        if (d) row.date = localDay(d);
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
    state.sumComplete = l.complete !== false;
    if (!state.sumComplete) console.warn("the listing of _AM_Docs/Client may be incomplete (paging)");
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
  /** The "Към дата" slider position: the index of state.asOf in state.days, the last day for today. */
  const asOfIndex = () => (state.asOf ? Math.max(0, state.days.indexOf(state.asOf)) : Math.max(0, state.days.length - 1));

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
  /**
   * The colour of each object from the shown published summary (user 22.11.2026). The summary has one entry per pour,
   * so a whole pour gets one colour: the last step done for ALL its objects, as before - but a pour where a later step
   * is only partly done (TAKT 1 "в процес" in every column) was "not started" and stayed see-through grey for the
   * client. Such a pour is now "В процес" (the client's word for it). Concrete poured and only the stripping partly
   * done stays "Бетон излят".
   */
  function summaryStage() {
    const sum = sumOf(state.sumDay), byPour = new Map(sum.pours.map((p) => [p.label, p]));
    const ids = S.STEPS.map((x) => x.id);
    return (o) => {
      const p = byPour.get(o.pour);
      if (!p) return S.NOT_STARTED;
      const st = S.stageOf(CS.pourRecord(p)), at = ids.indexOf(st.id);
      const partial = ids.some((id, i) => i > at && id !== "stripped" && p.steps && p.steps[id] && p.steps[id].done > 0 && !CS.isComplete(p, id));
      return partial ? S.REBAR_FIRST : st;
    };
  }
  // Sweep 18.11.2026 (finding 4): setObjectState fires onModelStateChanged; a same-model event within OWN_MS of our own
  // colouring is ours, so loadOnce does not repaint (which fired the event again: a repaint every 1.5 s with "Оцвети").
  const OWN_MS = 5000;
  let ownStateAt = 0;
  /** Live test 22.11.2026: right after a stage loads, Connect is still finishing the model and drops the colours set
   *  meanwhile (the view stayed uncoloured until "Оцвети" was ticked again or the model was clicked); its own "model
   *  changed" event then falls in OWN_MS and is taken for ours. After a load, the colours are set once more a little
   *  later. */
  let againTimer = null;
  function colourAgain() {
    clearTimeout(againTimer);
    againTimer = setTimeout(() => { if (state.coloured && state.objects.length) guarded(applyColours); }, 2500);
    if (againTimer && againTimer.unref) againTimer.unref();
  }
  async function applyColours() {
    ownStateAt = Date.now();
    try { return await applyColours2(); } finally { ownStateAt = Date.now(); }
  }
  async function applyColours2() {
    const api = state.api;
    // finding 4: no pour objects loaded: nothing to colour, so the rest of the model is not ghosted either
    if (!state.coloured || !state.objects.length) return api.viewer.setObjectState(undefined, { color: "reset", opacity: 1 });
    await api.viewer.setObjectState(undefined, { color: GHOST, opacity: GHOST_OPACITY });   // everything that is not a pour
    const stageFor = inSummary() ? summaryStage() : ((rec) => (o) => S.stageOf(rec(o)))(recordOf());
    const buckets = STAGES.map(() => []);
    for (const o of state.objects) buckets[STAGES.indexOf(stageFor(o))].push(o);
    // user 22.11.2026: in "Виж като клиент" the colours showed only after a click in the model, slowly. The groups do
    // not overlap, so they go out together (were one after another), and the viewer is then asked to draw again: the
    // camera it has now is set back with no animation (setObjectState alone may wait for the next user interaction)
    await Promise.all(buckets.map((b, k) => (b.length ? api.viewer.setObjectState(selector(b), { color: STAGES[k].colour, opacity: k === 0 ? NOT_STARTED_OPACITY : 1 }) : null)));
    await redrawViewer(api);
  }
  /** Make the 3D viewer draw now: the current camera set again without animation. Best effort (an older Workspace API
   *  without getCamera, or a camera it cannot give back, leaves it as before). */
  async function redrawViewer(api) {
    try {
      if (!api.viewer.getCamera || !api.viewer.setCamera) return;
      const cam = await api.viewer.getCamera();
      if (cam && typeof cam === "object") await api.viewer.setCamera(cam, { animationTime: 0 });
    } catch (e) { console.warn("viewer redraw", e); }
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
  // the report's summary: the one shown (client look), or the one just published (finding 10: "Печат на седмичния
  // отчет" in the publish box, from the live view)
  const reportSum = () => (inSummary() || state.reportAny ? sumOf(state.sumDay) : null);
  function renderReport() {
    const open = state.report && !!RP && !!reportSum();
    $("report").hidden = !open;
    $("app").classList.toggle("reporting", open);   // index.html: the panel is hidden behind the report while it is open
    if (!open) return;
    $("btnDoPrint").textContent = t("print"); $("btnBack").textContent = t("back");
    $("btnWeek").textContent = t("week"); $("btnMonth").textContent = t("month");
    $("btnWeek").classList.toggle("on", state.period !== "month"); $("btnMonth").classList.toggle("on", state.period === "month");
    $("printHint").textContent = t("printHint");
    // round 17 L6: the report HTML (up to ~1 MB at 5 000 pours) is built again only when the summary, the language or
    // the period changed, not on every render while the print view is open
    const sum = reportSum();
    if (repBuilt.sum !== sum || repBuilt.lang !== lang || repBuilt.period !== state.period) {
      $("repBody").innerHTML = RP.html(sum, { lang, period: state.period, photoUrl: (id) => phUrls.get(id) || "" });
      repBuilt = { sum, lang, period: state.period };
    }
  }
  let repBuilt = { sum: null, lang: "", period: "" };
  function openReport() {
    if (!reportSum()) return;
    state.report = true;
    render();
    return printWhenReady();
  }
  /** The photos of the report PERIOD: their URLs first (also those already being asked), then the images of the report
   *  as it is then (it may have been rebuilt meanwhile) loaded, at most 10 s, so they are in the print. */
  async function printWhenReady() {
    const sum = reportSum();
    if (sum && RP) {
      const from = RP.periodFrom(sum, state.period === "month" ? "month" : "week");
      // URLs older than PH_MAX_AGE_MS are asked again: signed links expire in a panel left open for the weekly print
      await loadPhotoUrls((sum.site || []).filter((x) => x.date > from && x.date <= sum.date).flatMap((x) => x.photos || []), { maxAgeMs: PH_MAX_AGE_MS });
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
    renderViewAsk();
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
    rng.value = String(asOfIndex());
    $("asOfDate").textContent = fmtDate(state.asOf || S.today());
    // sweep 18.11.2026 (b): a screen reader says the date, not the index; day / week steps for a phone
    if (typeof rng.setAttribute === "function") rng.setAttribute("aria-valuetext", fmtDate(state.asOf || S.today()));
    $("btnToday").hidden = !state.asOf;
    $("btnDayBack").textContent = t("dayBack"); $("btnDayFwd").textContent = t("dayFwd"); $("btnWeekBack").textContent = t("weekBack");
    const idx = asOfIndex();
    $("btnDayBack").disabled = $("btnWeekBack").disabled = rng.disabled || idx <= 0;
    $("btnDayFwd").disabled = rng.disabled || idx >= state.days.length - 1;

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
      return `<div class="stat"><div class="hd"><b>${esc(stageName(st))}</b><span class="num">${fmtNum(s.pct * 100, 0)}%${s.unit ? ` · ${fmtNum(s.qty, decOf(s.unit))} / ${fmtNum(s.total, decOf(s.unit))} ${esc(s.unit)}` : ""}</span></div>
        <div class="track"><div class="fill" style="width:${Math.min(100, s.pct * 100).toFixed(1)}%;background:${st.colour}"></div></div>
        <div class="sub">${s.pours} / ${sum.counts.pours} ${esc(tn(sum.counts.pours, "poursDone"))}</div></div>`;
    }).join("") + `<div class="note">${esc(t("byVolume"))}${clientLook() ? "" : ` · ${sum.counts.objects} ${esc(tn(sum.counts.objects, "objects"))}`}</div>`;
    // per pour (B-Client 3: rebar accepted; B-Client 7: by type)
    const acc = sum.pours.some((p) => p.rebar !== null);
    // sweep 18.11.2026 (finding 6): the client look uses the printed report's words (report.js PLAIN, "Бетон" for the
    // narrow column) so the phone and the paper say the same; staff keep the short site words
    const cl = clientLook();
    const short = cl ? (lang === "bg" ? ["Кофраж", "Армировка", "Бетон", "Завършен"] : ["Formwork", "Reinforcement", "Concrete", "Finished"])
      : lang === "bg" ? ["Кофраж", "Арм.", "Излят", "Декофр."] : ["Formwork", "Rebar", "Poured", "Stripped"];
    const cols = 1 + short.length + (acc ? 1 : 0);
    $("pourHead").innerHTML = `<tr><th>${esc(t("pour"))}</th>${short.map((x) => `<th class="c">${x}</th>`).join("")}${acc ? `<th class="c">${esc(t(cl ? "rebarAccClient" : "rebarAcc"))}</th>` : ""}</tr>`;
    const row = (p) => `<tr><td><span class="name">${esc(p.label)}</span>${clientLook() ? "" : ` <span class="sub">${p.objects}</span>`}</td>${S.STEPS.map((st) => {
      const c = p.steps[st.id];
      if (CS.allNa(p, st.id)) return `<td class="c done" title="${esc(fmtDate(c.date))}">${esc(t("without"))}</td>`;   // the stage does not apply
      if (CS.isComplete(p, st.id)) return `<td class="c done" title="${esc(fmtDate(c.date))}">${esc(fmtShort(c.date)) || "✓"}</td>`;
      if (c.done) return cl ? `<td class="c part">${esc(t("inProgress"))}</td>` : `<td class="c part">${c.done}/${p.objects}</td>`;   // N/M counts model objects: staff only
      return `<td class="c none">–</td>`;
    }).join("")}${acc ? `<td class="c ${p.rebar === "yes" ? "ok" : p.rebar === "pending" ? "part" : "none"}">${p.rebar === "yes" ? "✓" : p.rebar === "pending" ? esc(t("pending")) : "–"}</td>` : ""}</tr>`;
    if (state.group === "type") {
      $("pourRows").innerHTML = CS.groupByType(sum.pours).map((g) => `<tr class="grp"><td colspan="${cols}">${esc(CS.typeName(g.type, lang) || t("noType"))}
        <span class="sub">· ${g.pours.length} ${esc(tn(g.pours.length, "poursWord"))} · ${esc(t("groupPoured"))} ${g.poured}</span></td></tr>` + g.pours.map(row).join("")).join("");
    } else $("pourRows").innerHTML = sum.pours.map(row).join("");
    // finding 4: staff with no pour objects loaded see why the table is empty
    if (!summary && !sum.pours.length && !clientLook()) $("pourRows").innerHTML = `<tr><td colspan="${cols}" class="sub">${esc(t("noPoursHint"))}</td></tr>`;
    // timeline
    const stepById = Object.fromEntries(S.STEPS.map((s) => [s.id, s]));
    const tl = summary ? CS.timelineOf(sum) : P.timeline(state.objects, currentRecords());
    const list = state.showAll ? tl : tl.slice(0, 30);
    $("timeline").innerHTML = list.length ? list.map((e) => {
      const extra = summary ? "" : [clientLook() ? "" : `${e.count} ${esc(tn(e.count, "objects"))}`, e.qty >= 0.05 ? `${fmtNum(e.qty, decOf(e.unit))} ${esc(e.unit)}` : ""].filter(Boolean).join(" · ");
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
  // Sweep 18.11.2026 (b, speed): every URL of the 30 days was asked (4 at a time) and the list re-rendered only when ALL
  // had come, so the client read the texts with no photo for ~3 s on a phone (40 photos = 10 rounds), photos far down
  // asked first. A tile whose URL is not known yet is now a placeholder (same size: the layout does not jump); the
  // placeholders in view (+300 px, IntersectionObserver as Авторски надзор) are asked first, and each URL that comes
  // shows its tile (one render per 100 ms). Without IntersectionObserver every pending tile is queued. Only the print
  // (printWhenReady) still waits for all the URLs of its period.
  function renderSite(sum) {
    const rows = clientLook() && sum && sum.site ? sum.site.filter((x) => x.date > CS.addDays(sum.date, -SITE_CLIENT_DAYS)) : [];
    $("hSite").hidden = !rows.length; $("siteBox").hidden = !rows.length;
    if (!rows.length) { wantTiles(null); return; }
    $("hSite").textContent = t("site");
    $("siteHint").textContent = t("siteClientHint");
    $("siteList").innerHTML = rows.map((x) => `<li><span class="d">${esc(fmtDate(x.date))}</span><span class="txt">${esc(x.text)}${phThumbs(x)}</span></li>`).join("");
    wantTiles(rows.flatMap((x) => (x.photos || []).map((id, i) => tileId(x, i))).filter((id) => !phUrls.has(id) && !phPending.has(id)));
  }
  // photos of the published entries (client copies in _AM_Docs/Client/Photos): id -> download URL ("" failed or not
  // shown, undefined loading)
  const phUrls = new Map();
  // Sweep 18.11.2026: a tile shows the THUMBNAIL (x.thumbs[i], the client copy made at publish) - on a phone the list
  // loaded one 2560 px JPEG per tile. A tap opens the full photo (data-ph). A thumbnail whose URL failed, or whose image
  // did not load even with a fresh URL, falls back to the photo (thFailed). Summaries before thumbs show the photos.
  const thFailed = new Set();
  const tileId = (x, i) => {
    const id = x.photos[i], th = Array.isArray(x.thumbs) ? x.thumbs[i] : "";
    return th && typeof th === "string" && !thFailed.has(th) && phUrls.get(th) !== "" ? th : id;
  };
  const phThumbs = (x) => {
    const tiles = (x.photos || []).map((id, i) => ({ id, src: tileId(x, i) })).filter((p) => phUrls.get(p.src) !== "");
    return tiles.length ? `<span class="ph">${tiles.map((p) => (phUrls.get(p.src)
      ? `<img src="${esc(phUrls.get(p.src))}" alt="" loading="lazy" data-ph="${esc(p.id)}"${p.src !== p.id ? ` data-th="${esc(p.src)}"` : ""}>`
      : `<span class="ph-wait" data-want="${esc(p.src)}"></span>`)).join("")}</span>` : "";
  };
  let phIo = null;
  /** Ask the URLs of these pending tiles: the ones in view first (IntersectionObserver), else all of them in order. */
  function wantTiles(ids) {
    if (phIo) { phIo.disconnect(); phIo = null; }
    if (!ids || !ids.length) return;
    const box = $("siteList");
    if (typeof IntersectionObserver === "function" && box && typeof box.querySelectorAll === "function") {
      phIo = new IntersectionObserver((entries) => {
        const vis = entries.filter((e) => e.isIntersecting).map((e) => { phIo.unobserve(e.target); return e.target.dataset && e.target.dataset.want; }).filter(Boolean);
        if (vis.length) loadPhotoUrls(vis, { front: true });
      }, { rootMargin: "300px" });
      box.querySelectorAll("[data-want]").forEach((n) => phIo.observe(n));
      return;
    }
    loadPhotoUrls(ids);
  }
  const phPending = new Map();   // id -> promise while its URL is being asked (audit: a print waits for those too)
  // Sweep 18.11.2026: signed download URLs expire. phAt: id -> when its URL was asked; the print asks again for URLs
  // older than PH_MAX_AGE_MS. An image that fails to load: see photoFailed.
  const phAt = new Map();
  const PH_MAX_AGE_MS = 30 * 60000, PH_POOL = 4;
  // one pool for every URL (4 at a time): the tiles that come into view go to the front of the queue
  const phQueue = [];
  let phActive = 0, phRenderTimer = null;
  /** One render per 100 ms while URLs come in (the report is built again with the photos). */
  function softRender() {
    repBuilt = { sum: null, lang: "", period: "" };
    if (phRenderTimer) return;
    phRenderTimer = setTimeout(() => { phRenderTimer = null; render(); }, 100);
  }
  function pumpPhotos() {
    while (phActive < PH_POOL && phQueue.length) {
      const job = phQueue.shift();
      phActive++;
      (async () => {
        let u = "";
        try { u = (await photoUrlChecked(job.id)) || ""; } catch (e) { console.warn("photo url", e); }
        phUrls.set(job.id, u); phAt.set(job.id, Date.now());
        phPending.delete(job.id);
        phActive--;
        job.done();
        softRender();
        pumpPhotos();
      })();
    }
  }
  /** Ask Connect for the download URLs of these photos (PH_POOL at a time, each once); each one shows its tile when it
   *  comes. Resolves when every one of them is known, also those an earlier call is still asking for. opts.maxAgeMs:
   *  also ask again for URLs (or failures) asked longer ago than that; opts.front: ahead of the queue (tiles in view). */
  async function loadPhotoUrls(ids, opts) {
    const all = [...new Set(ids)];
    const maxAge = opts && opts.maxAgeMs;
    if (maxAge) for (const id of all) if (phUrls.get(id) !== undefined && phUrls.has(id) && !phPending.has(id) && Date.now() - (phAt.get(id) || 0) > maxAge) phUrls.delete(id);
    const want = all.filter((id) => !phUrls.has(id) && !phPending.has(id));
    if (AV && want.length) {
      const jobs = want.map((id) => {
        phUrls.set(id, undefined);
        let done = null;
        phPending.set(id, new Promise((r) => { done = r; }));
        return { id, done };
      });
      if (opts && opts.front) phQueue.unshift(...jobs); else phQueue.push(...jobs);
      pumpPhotos();
    }
    await Promise.all(all.map((id) => phPending.get(id)).filter(Boolean));
  }
  // ---- sweep 18.11.2026 (b, security): who uploaded the client photo shown ----
  // The summary is taken only from a trusted uploader, but its photo ids were opened as they are: files/fs/{id}/
  // downloadurl serves the LATEST version, so anyone with write on _AM_Docs/Client (by default every project member,
  // until the folder rights of AM_TEMPLATE are set) could upload a new version of a client photo and the client's
  // Статус and printed report showed it under the PM's entry. The current version's uploader is now read with the URL
  // (files/{id}, side by side) and must be a publisher (00_ADMIN / 02.1 / project ADMIN: the summaries' list, from the
  // same trust cache); a photo by anyone else is not shown. Uploader or list not readable: shown (unverified, as the
  // summaries). Pinning the exact version needs copyForClient (shared) to return it: see README.
  let phTrustP = null;
  const phTrusted = () => {
    const pid = state.project && state.project.id;
    const hit = pid ? trustCache.get(pid) : null;
    if (hit) return Promise.resolve(hit);
    if (!phTrustP) phTrustP = CS.trustedUploaders(coreFor(), pid).then((list) => { trustCache.set(pid, list); return list; },
      (e) => { console.warn("client photos: publishers not read - photos shown unverified", e); phTrustP = null; return null; });
    return phTrustP;
  };
  async function photoUrlChecked(id) {
    const c = coreFor();
    const meta = c.req(`files/${encodeURIComponent(id)}`).catch((e) => { if (!(e && e.status === 404)) console.warn("client photo: uploader not read", id, e); return null; });
    const [u, f] = await Promise.all([AV.photoUrl(c, id), meta]);
    if (!u || !f || !CS.uploaderOf(f)) return u;
    const ok = CS.uploadedByTrusted(f, await phTrusted());
    if (ok === false) { console.warn("client photo not shown: its current version was not uploaded by a publisher", id); return ""; }
    return u;
  }
  document.addEventListener && document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("phView").hidden) $("phView").onclick(); });
  // the tile may show the thumbnail: the full photo's URL is asked on the first tap (once), then it opens
  $("siteList").onclick = async (e) => {
    const im = e.target; const id = im && im.dataset && im.dataset.ph;
    if (!id) return;
    if (!phUrls.has(id) || phPending.has(id)) await loadPhotoUrls([id], { front: true });
    if (phUrls.get(id)) { $("phViewImg").src = phUrls.get(id); $("phView").hidden = false; }
  };
  $("phView").onclick = () => { $("phView").hidden = true; $("phViewImg").src = ""; };
  /**
   * An image (thumbnail or print) that did not load: its signed URL has probably expired, so a fresh one is asked.
   * Sweep 18.11.2026 (b): the rule of Дейности (viewer-activities imgFailed). phRetried was a Set for the whole session:
   * after the second expiry (Статус left open in the combined panel) a thumbnail switched to the 2560 px photo for good
   * and a photo stayed a broken image. Now the time of the last fresh URL is kept; one older than PH_RETRY_MS is asked
   * again, and only a failure of a URL fetched less than PH_RETRY_MS ago makes a thumbnail fall back to the photo, or a
   * photo show nothing.
   */
  const PH_RETRY_MS = 10 * 60000;
  const retriedAt = new Map();   // file id -> Date.now() of the last fresh URL asked after a failure
  function photoFailed(im) {
    if (!im || String(im.tagName || "").toUpperCase() !== "IMG") return;
    const src = (typeof im.getAttribute === "function" && im.getAttribute("src")) || im.src || "";
    const th = im.dataset && im.dataset.th;
    const id = th || (im.dataset && im.dataset.ph) || [...phUrls].find(([, u]) => u && u === src)?.[0];   // the print has no data-ph
    if (!id || phPending.has(id)) return;
    const last = retriedAt.get(id);
    if (last == null || Date.now() - last > PH_RETRY_MS) { retriedAt.set(id, Date.now()); phUrls.delete(id); loadPhotoUrls([id], { front: true }); return; }
    if (th) { thFailed.add(th); render(); return; }   // a fresh thumbnail URL failed too: show the photo (render asks it)
    phUrls.set(id, ""); render();                     // a fresh photo URL failed too: no tile rather than a broken image
  }
  /** "Опитай пак" / a forced load: every photo gets its fresh-URL try again. */
  const resetPhotoTries = () => { retriedAt.clear(); thFailed.clear(); };
  for (const box of ["siteList", "repBody"]) {
    const b = $(box);
    if (b && typeof b.addEventListener === "function") b.addEventListener("error", (e) => photoFailed(e.target), true);   // error does not bubble: capture
  }
  function renderPublish() {
    // the box ("Виж като клиент") for admin / GC; the publish form only for admin / PM (L8). Round 16: in "Виж като
    // клиент" the box is hidden too (the client has none); only "Изход от изгледа като клиент" stays.
    const show = isStaff() && !state.asClient;
    $("hPub").hidden = !show; $("pubBox").hidden = !show;
    $("leaveBar").hidden = !(isStaff() && state.asClient);
    $("btnLeaveClient").textContent = t("leaveClient");
    renderSteelAsk();
    renderPubAsk();
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
    // finding 4 (sweep 18.11.2026): no pour objects / no pour library is no reason to block publishing (steel, activities)
    $("btnPublish").disabled = publishing || !pubReady();
    const pd = state.pubDone;
    $("pubDone").hidden = !pd || !RP || !sumFile(pd.day);
    if (pd) { $("pubDoneText").textContent = `${t("published2")} (${fmtDate(pd.day)})`; $("btnPubPrint").textContent = t("pubPrint"); }
    $("pubInfo").textContent = (state.summaries.length ? `${t("lastPub")}: ${fmtDate(state.summaries[0].day)}${unverifiedMark()}` : t("notPub"))
      + (state.sumDropped.length ? ` · ${state.sumDropped.length} ${t("dropped")}` : "")
      + (state.sumComplete ? "" : ` · ⚠ ${t("incomplete")}`);
    $("pubHint").textContent = t("pubHint");
    $("pubWhatSum").textContent = t("pubWhat"); $("pubWhatText").textContent = t("pubHintFull");
  }

  // ---------- round 16 M1: the steel read at publishing time ----------
  const STEEL_RETRY_MS = 1500;
  const transient = (e) => !!e && (e.timeout === true || e.status === 429 || e.status === 503 || e.viewer === true);
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
    if (e && e.viewer) return t("rsViewer");
    if (e && e.status === 429) return t("rsBusy");
    return errText(e).slice(0, 160);
  }
  /** The newest published summary: {sum} (sum null = none published) or {error} (could not be read). Sweep 18.11.2026
   *  (finding 2): a failed read returned null like "nothing published", so the publish question dropped "the client's
   *  steel / concrete will disappear". A failed list or file read is tried once more; still failing is {error}. */
  async function latestPublished() {
    for (let n = 0; ; n++) {
      try {
        if (state.sumErr) { await refreshSummaries(); state.sumErr = null; }   // the listing failed at load: "none" is not sure
        const f = state.summaries[0];
        if (!f) return { sum: null };
        if (!state.sums.has(f.stamp)) state.sums.set(f.stamp, await CS.readSummary(coreFor(), f.id, fetchFor()));
        return { sum: state.sums.get(f.stamp) || null };
      } catch (e) {
        if (n === 0) { console.warn("last summary not read, trying once more", e); await new Promise((r) => setTimeout(r, window.ARSTEN_DEMO ? 0 : STEEL_RETRY_MS)); continue; }
        console.warn("last summary not read: no comparison", e);
        return { error: e };
      }
    }
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
  /** Sweep 18.11.2026: a question in the publish box (two buttons) instead of window.confirm, which Connect's frame or
   *  the mobile webview can block: confirm() then returns false at once and the publish ended with no message.
   *  Sweep 18.11.2026 (b): opts.full = the lines with every new entry (lines then holds the first SITE_SHOW_MAX and
   *  "… и още N"): "Покажи всички" must be pressed before the first button works. opts.photos [{id, th}] = the photos
   *  going out, shown as thumbnails with "не за клиента" per photo; the ticked ids are put in opts.drop (a Set). */
  function askPub(lines, go, cancel, opts) {
    if (state.pubAsk) answerPub(false);
    const o = opts || {};
    const join = (l) => l.filter((x) => x != null && x !== "").join("\n");
    return new Promise((resolve) => {
      const a = { text: join(lines), go, cancel, resolve, textAll: o.full ? join(o.full) : "", expanded: !o.full,
        photos: o.photos || [], drop: o.drop || new Set(), urls: new Map() };
      state.pubAsk = a;
      renderPublish();
      askPhotoUrls(a);
    });
  }
  function answerPub(ok) {
    const a = state.pubAsk;
    if (ok && a && !a.expanded) return;   // "Покажи всички" first: nothing goes out unseen
    state.pubAsk = null;
    $("pubAsk").hidden = true;
    if (a) a.resolve(ok);
  }
  /** The thumbnails of the photos in the publish question, 4 at a time (staff read the Дейности source files). */
  function askPhotoUrls(a) {
    if (!AV || !a.photos.length) return;
    let i = 0;
    const next = async () => {
      while (i < a.photos.length && state.pubAsk === a) {
        const p = a.photos[i++];
        let u = "";
        try { u = (await AV.photoUrl(coreFor(), p.th || p.id)) || ""; } catch (e) { console.warn("photo url (publish question)", e); }
        a.urls.set(p.id, u);
        if (state.pubAsk === a) renderAskPhotos(a);
      }
    };
    Promise.all([next(), next(), next(), next()]).catch(() => {});
  }
  function renderAskPhotos(a) {
    const box = $("pubAskPhotos");
    box.hidden = !a.photos.length;
    if (!a.photos.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="sub">${esc(t("sitePhGoing"))}</div>` + a.photos.map((p) => {
      const u = a.urls.get(p.id), off = a.drop.has(p.id);
      return `<label${off ? ' class="drop"' : ""}>${u ? `<img src="${esc(u)}" alt="">` : '<span class="ph-wait"></span>'}<span><input type="checkbox" data-drop="${esc(p.id)}"${off ? " checked" : ""}> ${esc(t("phNotClient"))}</span></label>`;
    }).join("");
  }
  $("pubAskPhotos").onchange = (e) => {
    const a = state.pubAsk, n = e && e.target, id = n && n.dataset && n.dataset.drop;
    if (!a || !id) return;
    if (n.checked) a.drop.add(id); else a.drop.delete(id);
    renderAskPhotos(a);
  };
  $("btnPubAll").onclick = () => { const a = state.pubAsk; if (!a) return; a.expanded = true; renderPubAsk(); };
  function renderPubAsk() {
    const a = state.pubAsk;
    $("pubAsk").hidden = !a;
    if (!a) return;
    $("pubAskText").textContent = a.expanded && a.textAll ? a.textAll : a.text;
    $("pubAllBar").hidden = a.expanded;
    $("btnPubAll").textContent = t("pubShowAll"); $("pubAllHint").textContent = t("pubShowAllHint");
    $("btnPubGo").disabled = !a.expanded;
    $("btnPubGo").textContent = t(a.go); $("btnPubCancel").textContent = t(a.cancel);
    renderAskPhotos(a);
  }
  function renderSteelAsk() {
    const a = state.steelAsk;
    $("steelAsk").hidden = !a;
    if (!a) return;
    const hint = a.error && (a.error.steelDenied || a.error.status === 403) ? t("steelDeniedHint") : t("steelRetryHint");
    $("steelAskText").textContent = `${t("steelFail")} (${steelReason(a.error)}) – ${t("steelOr")}${a.had ? " " + t("steelHad") : ""} ${hint}`;
    $("btnSteelGo").textContent = t("steelGo"); $("btnSteelCancel").textContent = t("steelCancel");
  }

  // ---------- sweep 18.11.2026: the activities going out, shown before publishing ----------
  const SITE_SHOW_MAX = 20;
  /** "• 17.11.2026 – text (снимки: 2)" per entry of out not in the summary prev (same date and text); all when prev is null. */
  function siteLines(out, prev) { return siteChanges(out, prev).fresh; }
  /**
   * What goes to the client that it did not get with prev (the last published summary): fresh = lines of the entries
   * whose date + full text were not in prev; photos = lines of the entries that were, but now carry more photos than
   * prev did ("• 12.11.2026 – text (+3 снимки)"). Sweep 18.11.2026: the key was date + text only, so 3 photos added
   * to an entry published last week went to _AM_Docs/Client/Photos with "Няма нови дейности" in the question. prev
   * holds the ids of the CLIENT copies, not the source ids, so the photo count per entry is compared (a copy that failed
   * last time is shown again here: shown once too often, never once too few).
   * Sweep 18.11.2026 (b): the text was cut to 80 characters, but up to 200 go out: a remark after the first 80 (a name,
   * a defect) reached the client unseen. Each line now carries the whole cleaned text (wrapped by the box). fresh /
   * photos hold the first SITE_SHOW_MAX lines and "… и още N"; freshAll / photosAll every line ("Покажи всички").
   * newPhotos: the photos of the new and grown entries [{id, th}] (source ids; th its thumbnail), for the thumbnails and
   * "не за клиента". The key stays date + text: the summary has no entry ids, and an entry whose text was edited after
   * the last publish has a new key, so it is listed again.
   */
  function siteChanges(out, prev) {
    const had = new Map();
    for (const x of (prev && prev.site) || []) { const k = x.date + "|" + x.text; had.set(k, Math.max(had.get(k) || 0, (x.photos || []).length)); }
    const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const nOf = (x) => (x.src || x.photos || []).length;
    const fresh = [], grown = [];
    for (const x of out || []) {
      const k = x.date + "|" + x.text;
      if (!had.has(k)) fresh.push(x);
      else if (nOf(x) > had.get(k)) grown.push({ x, add: nOf(x) - had.get(k) });
    }
    const more = (n) => `… ${t("siteMore")} ${n} ${t("siteMoreEnd")}`.trim();
    const short = (all) => (all.length > SITE_SHOW_MAX ? all.slice(0, SITE_SHOW_MAX).concat([more(all.length - SITE_SHOW_MAX)]) : all);
    const freshAll = fresh.map((x) => `• ${fmtDate(x.date)} – ${clean(x.text)}${nOf(x) ? ` (${t("sitePhotos")}: ${nOf(x)})` : ""}`);
    const photosAll = grown.map((g) => `• ${fmtDate(g.x.date)} – ${clean(g.x.text)} (+${g.add} ${t("sitePhotos")})`);
    const newPhotos = [];
    for (const x of fresh.concat(grown.map((g) => g.x))) for (const p of x.src || []) if (p && p.id && !newPhotos.some((q) => q.id === p.id)) newPhotos.push({ id: p.id, th: p.thumbId || "" });
    return { fresh: short(freshAll), photos: short(photosAll), freshAll, photosAll, newPhotos };
  }
  /** Who uploaded the current activities.json: {name, trusted: true / false / null (not checked), reason}. Sweep 18.11.2026:
   *  "not checked" (no uploader in the listing, no listing, the users / groups read failed) was null and published without
   *  asking; it is now its own answer, and publish2 asks (defaulting to leaving the entries out). The reason goes to the console. */
  async function siteUploader(r) {
    const unchecked = (reason, name) => { console.warn("activities uploader not checked:", reason); return { name: name || "", trusted: null, reason }; };
    if (!r || !r.folderId || !r.fileId) return unchecked("no file id of activities.json");
    if (!B.listFolder) return unchecked("ArstenBackup.listFolder missing");
    let u = null;
    try {
      const c = coreFor();
      const f = ((await B.listFolder(c, r.folderId)).items || []).find((x) => x && x.id === r.fileId);
      u = f && (f.modifiedBy || f.createdBy);
      if (!u) return unchecked(f ? "no uploader in the listing" : "activities.json not in the listing");
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id || "?";
      // not the summaries' trust cache: that list (00_ADMIN / 02.1) does not hold 02, who also edit Дейности
      const list = await CS.trustedUploaders(c, state.project.id, CS.SITE_GROUPS);
      const trusted = CS.uploadedByTrusted(f, list);
      return trusted == null ? unchecked("uploader not comparable", name) : { name, trusted };
    } catch (e) { return unchecked(errText(e), u && ([u.firstName, u.lastName].filter(Boolean).join(" ") || u.email)); }
  }
  /** The activities for the summary and who uploaded their list: {out, r, who} (who null when nothing goes out). */
  async function readSite(day) {
    const r = await AV.load(coreFor(), state.project.id, fetchFor());
    const out = AV.forSummary(r.items, day, { photos: true });
    return { r, out, who: out.length ? await siteUploader(r) : null };
  }

  // ---------- publish (admin / GC) ----------
  // Round 10 M2: the pour statuses, the acceptance and the "based on" models are read again right before building, so a
  // panel left open since the morning does not publish the morning's figures stamped as today.
  // Sweep 18.11.2026: a model event during publishing (a model streamed in, a stage changed while the question waits)
  // ran a full load: state.lib = null and new pour objects under the half-built summary, so the acceptance could go out
  // empty or other pours than the PM saw. Loads now wait for the publish (runLoad), a running load finishes before the
  // publish starts, and publish2 keeps its own copy of the library.
  let publishing = false, publishDone = null;
  /** The panel shows its data (the last load ran to the end): publishing may start. */
  const pubReady = () => !!state.ready;
  async function publish() {
    if (!canPublish() || publishing) return;
    publishing = true;
    let done = null;
    publishDone = new Promise((r) => { done = r; });
    $("btnPublish").disabled = true;
    try {
      if (loadRun) await loadRun;   // a load already running ends first (loads started from now on wait)
      if (pubReady()) await publish2();
    } finally { publishing = false; publishDone = null; done(); $("btnPublish").disabled = !pubReady(); }
  }
  /** Upload the summary file. Sweep 18.11.2026 (b): state.folderCache lives as long as the panel and ensureFolder trusts
   *  a cached id, so a _AM_Docs/Client deleted or recreated meanwhile failed every later publish of the session with a
   *  404. A 404 / 403 now drops the cached and the remembered (sessionStorage) ids and tries once more, afresh. */
  async function uploadSummary(c, day, sum) {
    const once = async () => {
      state.folderCache = state.folderCache || new Map();
      const folderId = await B.ensureFolder(c, state.project.id, CS.FOLDER, state.folderCache);
      await B.uploadJson(c, folderId, CS.fileName(day), CS.toJson(sum), { fetch: window.ARSTEN_FETCH });
    };
    try { await once(); }
    catch (e) {
      if (!(e && (e.status === 404 || e.status === 403))) throw e;
      console.warn("summary upload: the folder id may be stale - looked up afresh once", e);
      state.folderCache = new Map();
      if (typeof B.forgetFolder === "function") B.forgetFolder(c, state.project.id, CS.FOLDER);
      await once();
    }
  }
  async function publish2() {
    const day = S.today(), lib = state.lib;   // lib may be null: no pour library (steel / activities only, finding 4)
    state.pubDone = null;
    // progress texts as functions: rebuilt in the new language after a language switch (sweep 18.11.2026)
    const prog = (k) => setStatus(() => t(k));
    // Sweep 18.11.2026 (b, speed): the fresh reads (pour statuses, acceptance, "based on", steel, activities + who
    // uploaded them, the last summary) do not need each other's results; they ran one after the other (the steel alone
    // reads the whole steel model) and the PM watched six progress texts for many seconds. They now start together,
    // each caught into {v} / {e}; the questions below come in the same order as before, on the settled results.
    prog("pubRead");
    const settle = (fn) => Promise.resolve().then(fn).then((v) => ({ v }), (e) => ({ e }));
    const [rec, , , steelR, siteR, lastR] = await Promise.all([
      settle(() => (lib ? loadRecords(lib) : null)),       // fresh pour statuses at publishing time
      settle(() => (lib ? loadAcceptance(lib) : null)),    // fresh acceptance state (never throws)
      settle(() => loadBasis(lib)),                        // never throws
      // B-Client 2: the steel totals afresh (read-only). Round 16 M1: no steel library = no steel section, as before; a
      // library that cannot be read, or a failed read (one more try on 429 / timeout, inside readSteel), is never
      // dropped silently: the publish box asks "publish without the steel / cancel".
      settle(readSteel),
      settle(() => (AV ? readSite(day) : null)),
      settle(latestPublished),
    ]);
    if (!lib) { state.records = new Map(); state.accepted = null; }
    if (rec.e) throw rec.e;
    const got = steelR.e ? { error: steelR.e } : steelR.v;
    const steel = got.error ? null : got.steel || null;
    // Дейности afresh (a read error asks "publish without them?", as the steel does: never dropped silently)
    let siteOut = [], siteLeft = "";
    if (!AV) { setStatus(""); if (!(await askPub([t("siteReadFail"), "(arsten-activities.js)"], "pubWithout", "steelCancel"))) { setStatus(() => t("pubCancelled")); return; } }
    else if (siteR.e) {
      console.warn("activities not read", siteR.e); setStatus("");
      if (!(await askPub([t("siteReadFail"), `(${errText(siteR.e).slice(0, 160)})`], "pubWithout", "steelCancel"))) { setStatus(() => t("pubCancelled")); return; }
    } else {
      siteOut = siteR.v.out;
      const who = siteR.v.who;
      // sweep 18.11.2026: activities.json is a plain project file; anyone with file write could add "for the client"
      // entries. Its uploader is checked as the summaries' are; someone outside 00_ADMIN / 02 / 02.1 is asked about, and
      // so is an uploader that could not be checked (then the first button leaves the entries out).
      if (siteOut.length && who && who.trusted !== true) {
        setStatus("");
        const list = siteLines(siteOut, null).join("\n");
        const keep = who.trusted === false
          ? await askPub([`${t("siteWho")} ${who.name}, ${t("siteWhoOut")}`, list], "siteInclude", "siteLeave")
          : !(await askPub([t("siteWhoUnknown"), list], "siteLeave", "siteInclude"));
        if (!keep) { siteOut = []; siteLeft = who.trusted === false ? "siteLeft" : "siteLeftUnknown"; }
      }
    }
    const last = lastR.e ? { error: lastR.e } : lastR.v;
    const prev = last.sum || null, prevFail = !!last.error;
    // not readable: assume the client had steel and concrete, so their "will disappear" lines are never lost
    const hadSteel = prevFail || !!(prev && prev.steel);
    if (got.error) {
      setStatus("");
      if (!(await askSteel(got.error, hadSteel))) { setStatus(() => t("pubCancelled")); return; }
    }
    // finding 4: no pours, no steel and no activities: nothing for the client (an empty summary would only blank it)
    if (!state.objects.length && !steel && !siteOut.length) { setStatus(() => t("pubNothing"), true); return; }
    if (state.asOf && !state.days.includes(state.asOf)) state.asOf = "";
    render();                          // the live view shows the fresh figures behind the confirm dialog
    prog("pubPrep");
    // the photos of the client entries are copied to _AM_Docs/Client/Photos only after the confirm below; the summary
    // shown in the confirm is built without them, then built again with the copies' ids (same inputs, same time stamp)
    const countPhotos = () => siteOut.reduce((n, x) => n + ((x.src || []).length), 0);
    const nPhotos = countPhotos();
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
    // finding 4: the pour model not loaded right now would blank the client's concrete figures: said, as for the steel
    if (!state.objects.length && (prevFail || (prev && prev.counts && prev.counts.pours > 0))) qLines.splice(2, 0, t("concreteLeft"));
    if (prevFail) qLines.splice(2, 0, t("prevFail"));
    // activities going out: how many, and how many in the report week; the entries new since the last published summary
    // are listed with their whole text, and photos added since to an entry that went out before are listed apart (date,
    // text, +N photos). Sweep 18.11.2026 (b): more than SITE_SHOW_MAX lines need "Покажи всички" before "Публикувай",
    // and the new photos are shown as thumbnails with "не за клиента" each.
    let full = null, photosAsk = [];
    const drop = new Set();
    if (sum.site && sum.site.length) {
      const wk = sum.site.filter((x) => x.date > sum.week.from).length;
      qLines.splice(qLines.length - 1, 0, `${t("sitePub")}: ${sum.site.length} (${t("siteWeek")}: ${wk})${nPhotos ? ` · ${t("sitePhotos")}: ${nPhotos}` : ""}`);
      const ch = siteChanges(siteOut, prev);
      const blocks = (fresh, photos) => [fresh.length ? `${t("siteNew")}:\n${fresh.join("\n")}` : t("siteNoNew")].concat(photos.length ? [`${t("sitePhNew")}:\n${photos.join("\n")}`] : []);
      const at = qLines.length - 1;
      if (ch.freshAll.length > SITE_SHOW_MAX || ch.photosAll.length > SITE_SHOW_MAX) { full = qLines.slice(); full.splice(at, 0, ...blocks(ch.freshAll, ch.photosAll)); }
      qLines.splice(at, 0, ...blocks(ch.fresh, ch.photos));
      photosAsk = ch.newPhotos;
    } else if (siteLeft) qLines.splice(qLines.length - 1, 0, t(siteLeft));
    // round 19 L8: the note that goes out with it (a note pre-filled from the last summary must not go out unseen)
    const noteOut = String(sum.clientNote || "").trim();
    const noteShown = noteOut.length > 300 ? noteOut.slice(0, 300) + "…" : noteOut;
    const noteLine = noteOut ? (lang === "bg" ? `Бележка: „${noteShown}“` : `Note: "${noteShown}"`) : (lang === "bg" ? "Без бележка." : "No note.");
    qLines.splice(qLines.length - 1, 0, noteLine);
    if (full) full.splice(full.length - 1, 0, noteLine);
    setStatus("");
    if (!(await askPub(qLines, "pubGo", "steelCancel", { full, photos: photosAsk, drop }))) { setStatus(() => t("pubCancelled")); return; }
    // the photos ticked "не за клиента" are not copied (the entry still goes out, with the others)
    if (drop.size) siteOut = siteOut.map((x) => (x.src ? Object.assign({}, x, { src: x.src.filter((p) => !drop.has(p.id)) }) : x));
    const nCopy = countPhotos();
    const c = coreFor();
    let failed = 0;
    if (nCopy && AV) {
      let cpDone = 0, cpAll = nCopy;
      setStatus(() => `${t("sitePhCopy")} ${cpDone} / ${cpAll}…`);
      const cp = await AV.copyForClient({ core: c, projectId: state.project.id, site: siteOut, fetch: fetchFor(),
        onProgress: (d, n) => { cpDone = d; cpAll = n; setStatus(() => `${t("sitePhCopy")} ${cpDone} / ${cpAll}…`); } });
      sum = CS.build(Object.assign({}, buildArgs, { site: cp.site }));
      const v2 = CS.validate(sum);
      if (!v2.ok) throw new Error((lang === "bg" ? "Резюмето не е безопасно за клиента и НЕ е публикувано: " : "The summary is not client-safe and was NOT published: ") + v2.errors.slice(0, 3).join("; "));
      failed = cp.failed || 0;
    }
    prog("pubSaving");
    await uploadSummary(c, day, sum);
    // the place of the file is for the diagnostics, not for the PM (sweep 18.11.2026, as Дейности)
    (console.info || console.log)(`[Статус] published for the client: ${CS.FOLDER.join("/")}/${CS.fileName(day)}`);
    try { await refreshSummaries(); } catch {}
    if (!sumFile(day)) state.summaries.unshift({ day, id: "", name: CS.fileName(day), modifiedOn: "", stamp: `local|${day}|${sum.published}` });
    state.sums.set(sumFile(day).stamp, sum);   // what was just uploaded is that version
    // finding 10: the success line and "Печат на седмичния отчет" in the publish box (no detour through "Виж като клиент")
    state.pubDone = { day, failed };
    setStatus(() => `${t("published2")} (${fmtDate(day)})` + (failed ? ` · ${failed} ${t("sitePhFailed")}` : ""), !!failed);
    render();
  }
  /** Finding 10 (sweep 18.11.2026): the weekly report of the summary just published, from the live view. */
  async function printPublished() {
    const pd = state.pubDone;
    if (!pd || !sumFile(pd.day)) return;
    await openSummary(pd.day);
    state.reportAny = true;
    state.period = "week";
    return openReport();
  }

  // ---------- save view ----------
  // Sweep 18.11.2026: the name is asked in the panel (window.prompt can be blocked by Connect's frame or the mobile
  // webview: it then returned null and the button seemed dead, with no message)
  function saveView() {
    if (clientLook()) return;
    $("inViewName").value = `${t("title")} ${fmtDate(state.asOf || S.today())}`;
    $("viewAsk").hidden = false;
    renderViewAsk();
    try { $("inViewName").focus(); } catch {}
  }
  function renderViewAsk() {
    if (clientLook()) $("viewAsk").hidden = true;
    $("lblViewName").textContent = t("viewName");
    $("btnViewSave").textContent = t("viewSave"); $("btnViewCancel").textContent = t("viewCancel");
  }
  async function saveViewNow() {
    if (clientLook()) return;
    const name = String($("inViewName").value || "").trim() || `${t("title")} ${fmtDate(state.asOf || S.today())}`;
    $("viewAsk").hidden = true;
    if (!state.coloured) { state.coloured = true; $("chkColour").checked = true; await applyColours(); }
    await state.api.view.createView({ name, description: `${t("title")} · ${t("asOfLbl")} ${fmtDate(state.asOf || S.today())}` });
    setStatus(() => t("viewSaved").replace("{n}", name));
  }

  // ---------- wiring ----------
  $("chkColour").onchange = (e) => guarded(async () => { state.coloured = e.target.checked; await applyColours(); });
  $("btnView").onclick = () => saveView();
  $("btnViewSave").onclick = () => guarded(saveViewNow);
  $("btnViewCancel").onclick = () => { $("viewAsk").hidden = true; };
  $("inViewName").onkeydown = (e) => { if (e.key === "Enter") guarded(saveViewNow); else if (e.key === "Escape") $("viewAsk").hidden = true; };
  $("btnPubPrint").onclick = () => guarded(printPublished);
  let asOfTimer = null;
  /** The slider's day: an index into state.days (today = the last one). */
  function setAsOfIndex(i) {
    const d = state.days[i] || "";
    state.asOf = d && d < S.today() ? d : "";
    render();
    clearTimeout(asOfTimer);
    if (state.coloured) asOfTimer = setTimeout(() => guarded(applyColours), 250);
  }
  $("rngAsOf").oninput = (e) => setAsOfIndex(+e.target.value);
  // sweep 18.11.2026 (b): "‹ ден" / "ден ›" / "‹ седмица" move the day by 1 or 7 (last Friday is hard to hit by finger)
  const stepAsOf = (n) => { if (state.days.length < 2) return; setAsOfIndex(Math.min(state.days.length - 1, Math.max(0, asOfIndex() + n))); };
  $("btnDayBack").onclick = () => stepAsOf(-1);
  $("btnDayFwd").onclick = () => stepAsOf(1);
  $("btnWeekBack").onclick = () => stepAsOf(-7);
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
    if (on && state.pubAsk) answerPub(false);       // and a pending publish question
    state.asClient = on;
    $("chkAsClient").checked = on;
    state.sumPicked = false;
    state.report = false; state.reportAny = false;
    if (state.asClient) { await openSummary(state.summaries[0] && state.summaries[0].day); state.look = state.sumDay ? "summary" : "live"; }
    else { state.look = "live"; if (state.staffStatus) setStatus(state.staffStatus); }
    render();
    if (state.coloured) await applyColours();
  }
  $("chkAsClient").onchange = (e) => guarded(() => setAsClient(e.target.checked));
  $("btnLeaveClient").onclick = () => guarded(() => setAsClient(false));
  $("btnSteelGo").onclick = () => answerSteel(true);
  $("btnPubGo").onclick = () => answerPub(true);
  $("btnPubCancel").onclick = () => answerPub(false);
  $("btnSteelCancel").onclick = () => answerSteel(false);
  $("btnPublish").onclick = () => guarded(publish);
  $("btnRetry").onclick = () => { $("btnRetry").hidden = true; resetPhotoTries(); return runLoad(true); };
  // B-Client 4: "Печат / PDF" opens the print view of the shown summary and the print dialog
  $("btnPrint").onclick = () => guarded(openReport);
  $("btnDoPrint").onclick = () => guarded(printWhenReady);   // after Седмица -> Месец the month's photos load first
  $("btnBack").onclick = () => { state.report = false; state.reportAny = false; render(); };
  $("btnWeek").onclick = () => { state.period = "week"; render(); };
  $("btnMonth").onclick = () => { state.period = "month"; render(); };

  /** One full load. Returns true when the panel shows the data (then a later event with the same models skips the reload). */
  let loadGen = 0;
  async function load(key, specs) {
    const gen = ++loadGen;
    setStatus(lang === "bg" ? "Зареждане…" : "Loading…");
    $("btnRetry").hidden = true;
    state.lib = null;
    state.ready = false;
    // Round 12 M4: the independent reads at the same time: the pour objects (viewer), the published summaries (Core,
    // with the uploader check) and, for admin / GC, the library lookup (pset-api). Errors are reported in the same order.
    let poursErr = null, sumErr = null;
    const libP = state.role !== "client" ? state.client.findLibrary(state.project.id, S.LIB_NAMES) : null;
    if (libP) libP.catch(() => {});   // awaited below; an error here must not be "unhandled" when there are no pours
    const poursP = loadPours(specs).catch((e) => { poursErr = e; state.pours = []; state.loose = []; state.objects = []; });
    // published summaries: the client reads ONLY these
    await refreshSummaries().catch((e) => { sumErr = e; state.summaries = []; console.warn("summaries not listed", e); });
    state.sumErr = sumErr;   // publishing then reads the list again before taking "none" for sure (finding 2)
    // Sweep 18.11.2026: the summary text, dates and totals come from the published file; the pour objects only colour the
    // model. The client (and staff in "Виж като клиент") see the summary at once, not after a serial scan of the model
    // (which on a phone with the architecture or steel model loaded reads every object); the colours follow.
    if (state.role === "client") {
      // M1 (round 11): summary only. No library, no pour records, no acceptance, never a live fallback.
      state.records = new Map(); state.accepted = null; state.lib = null;
      if (state.summaries.length && await openFirstReadable()) {
        state.look = "summary";
        $("main").hidden = false;
        setStatus(() => `${t("published")} ${fmtDate(state.sumDay)}`);
        render();
        await poursP;
        if (state.coloured) { await applyColours(); colourAgain(); }
        return true;
      }
      state.look = "live"; state.sumDay = "";
      $("main").hidden = true;
      // Sweep 18.11.2026 (finding 5): "no report" only when the listing worked, was complete and was empty. A failed
      // listing, a cut-off one or files that would not open is "could not load" with "Опитай пак": a client on weak
      // signal took "Все още няма публикуван отчет" for "the team published nothing".
      if (sumErr || !state.sumComplete || state.summaries.length) {
        const why = sumErr && I18N && I18N.friendly ? () => `${t("loadFail")} (${I18N.friendly(sumErr, lang)})` : () => t("loadFail");
        setStatus(why, true);
        $("btnRetry").textContent = t("retry");
        $("btnRetry").hidden = false;
      } else setStatus(t("noReport"));
      if (state.coloured) { state.coloured = false; $("chkColour").checked = false; try { await applyColours(); } catch {} }
      await poursP;   // finished inside this load (loads run one at a time), so a late scan never overwrites a newer one
      return;
    }
    if (state.asClient && state.summaries.length) {
      // staff in "Виж като клиент": the summary first; the live data below is read as before (for leaving the view)
      try {
        if (await openFirstReadable()) {
          state.look = "summary";
          $("main").hidden = false;
          setStatus(() => `${t("published")} ${fmtDate(state.sumDay)}`);
          render();
        }
      } catch (e) { console.warn("summary not read", e); }
    }
    await poursP;
    if (poursErr) throw poursErr;
    // Finding 4 (sweep 18.11.2026): no pour objects in the loaded models (a steel-only hall, an early project with only
    // site works, a stage with only the architecture model) is a valid state for staff: the view stays, with "Няма
    // заредени тактове", the steel and the activities, and the PM can still publish. It hid the view, blocked publishing
    // and, in "Виж като клиент", hid the summary again; the load also never counted as done (every model event reloaded).
    const noPours = !state.objects.length;
    let found = null;
    if (noPours) { try { found = await libP; } catch (e) { console.warn("pour library not looked up (no pours loaded)", e); } }
    else found = await libP;
    if (!noPours && !found.lib) { $("main").hidden = true; return setStatus(t("noLib"), true); }
    state.lib = (found && found.lib) || null;
    // records, acceptance and "based on" at the same time (round 12 M4); only the records can fail the load
    if (noPours) { state.records = new Map(); state.days = []; await Promise.all([loadAcceptance(state.lib), loadBasis(state.lib)]); }
    else await Promise.all([loadRecords(found.lib), loadAcceptance(found.lib), loadBasis(found.lib)]);
    if (state.asClient && state.summaries.length) { try { await openSummary(reloadDay()); state.look = "summary"; } catch { state.look = "live"; } }
    else state.look = "live";
    $("main").hidden = false;
    const nLoose = looseCount();   // round 14: as Монолитен бетон, "N такта"; the objects with no pour number apart
    state.staffStatus = () => (state.objects.length ? `${state.pours.length} ${tn(state.pours.length, "poursWord")} · ${state.objects.length} ${tn(state.objects.length, "objects")}` : t("noPoursHint"))
      + (nLoose ? ` · ${t("loose")}: ${nLoose} ${tn(nLoose, "objects")}` : "")
      + (sumErr && isStaff() ? ` · ${lang === "bg" ? "резюметата не се четат" : "summaries not readable"}: ${errText(sumErr)}` : "");
    setStatus(state.staffStatus);
    render();
    prefillNote(gen);   // after the first paint (finding 1)
    if (state.coloured) { await applyColours(); colourAgain(); }
    // B-Client 2: steel totals for the staff live view, after the first screen (read-only; publishing reads them again).
    // Round 17 M1: only when the model set changed or the last read is older than 5 minutes.
    refreshSteel(key);
    return true;
  }

  /** The PM's last client note, as a starting point for the next publish. Sweep 18.11.2026 (finding 1): read in the
   *  background after the view is shown (it was a downloadurl + JSON download in series before the first paint); written
   *  only if the box is still empty, no newer load started and no publish is running. Does not change the day shown. */
  function prefillNote(gen) {
    if (!canPublish() || $("inNote").value || !state.summaries.length) return;
    const f = state.summaries[0];
    const got = state.sums.has(f.stamp) ? Promise.resolve(state.sums.get(f.stamp))
      : CS.readSummary(coreFor(), f.id, fetchFor()).then((s) => { state.sums.set(f.stamp, s); return s; });
    got.then((s) => { if (gen === loadGen && !publishing && !$("inNote").value && s && s.clientNote) $("inNote").value = s.clientNote; },
      (e) => console.warn("last client note not read", e));
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
    const specs = await loadedModels();
    const key = modelSetKey(specs);
    if (!force && sameModelSet(lastModelsKey, key)) {
      if (Date.now() - ownStateAt < OWN_MS) return;   // our own colouring's event (finding 4)
      console.info("[Статус] model event: the loaded models did not change – no reload");
      if (state.coloured && !$("main").hidden) await applyColours();
      refreshSteel(key);   // only if the live steel is older than 5 minutes
      return;
    }
    lastModelsKey = null;
    if (await load(key, specs)) { lastModelsKey = key; state.ready = true; renderPublish(); }
  }
  /** force: the first load (and tests' refresh); a model event is not forced and is skipped for the same model set. */
  function runLoad(force) {
    // sweep 18.11.2026: no load while publishing (it would swap the library and the pour objects under the summary);
    // the load runs after the publish
    if (publishing && publishDone) return publishDone.then(() => runLoad(force));
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
  window.ProjectStatusApp = { start, state, panelRole, reload: () => runLoad(false), _ownState: (at) => { ownStateAt = at; }, refresh: () => runLoad(true), modelSetKey, sameModelSet,
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
