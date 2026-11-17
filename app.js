// Project status: client view of construction progress in the Trimble Connect 3D viewer.
// Live view: reads the statuses that Pour status (Arsten) stores in the project library "CIP/Монолитно" and the pour
// objects of the Tekla model (property set Pour/Такт). Shows stages and dates only: no notes, no names.
// Client summary (week 3, B-Client 1): admin / GC publish ONE client-safe JSON per day to _ArstenDocs/Client
// (client-summary.js; upload with shared/arsten-backup.js). The CLIENT role reads ONLY those files ("as published on
// 14.11", picker over the files). Round 11 M1: with none published (or none readable) the client gets "Все още няма
// публикуван отчет" and the panel never reads the library (no pset call at all for the client). Round 11 M2: only files
// uploaded by 00_ADMIN / 02 / 02.1 members or a Connect project ADMIN count (client-summary.js listSummaries).
// Admin / GC keep the live view with "Виж като клиент" (the latest summary). Connect access rights are not changed here.
// Writes: only the summary file (admin or the PM = "stages" cap, round 11 L8, on "Публикувай за клиента") and
// "Save view" (a Connect view, not for clients).
// Access: project ADMIN, groups CLIENT and GENERAL CONTRACTOR (shared/arsten-access.js, app "projectStatus").
(() => {
  "use strict";
  const C = window.PourLogic, S = window.PourStatus, A = window.PsetApi, P = window.ProjectProgress, CS = window.ClientSummary;
  const ACC = window.ArstenAcceptance, B = window.ArstenBackup;
  const $ = (id) => document.getElementById(id);
  const PROXY = "IfcBuildingElementProxy";
  const BATCH = 200;
  const GHOST = "#D9D5CC", GHOST_OPACITY = 0.12, NOT_STARTED_OPACITY = 0.45;
  const LANG_KEY = "arsten.projectStatus.lang", GROUP_KEY = "arsten.projectStatus.group";

  const T = {
    title: ["Статус", "Status"],
    colour: ["Оцвети по статус", "Colour by status"], view: ["Запази изглед", "Save view"],
    asOf: ["Към дата", "As of date"], asOfLbl: ["Състояние към", "Status as of"], today: ["Днес", "Today"],
    overall: ["Общ напредък", "Overall progress"], details: ["Подробности", "Details"], pours: ["По тактове", "By pour"], timeline: ["Хронология", "Timeline"],
    more: ["Покажи всички", "Show all"], pour: ["Такт", "Pour"], other: ["Друго в модела (прозрачно)", "Rest of the model (ghosted)"],
    byVolume: ["кофраж и декофриране по m², армировка по kg, бетон по m³", "formwork and stripping by m², rebar by kg, concrete by m³"], poursDone: ["тактове завършени", "pours complete"],
    noEvents: ["Още няма отбелязани етапи.", "No stages recorded yet."],
    noLib: ["Статусите на тактовете още не са настроени в този проект.", "Pour statuses are not set up in this project yet."],
    noPours: ["В заредените модели няма тактове (Tekla IFC с Pour/Такт).", "No pours in the loaded models (Tekla IFC with Pour/Такт)."],
    objects: ["елемента", "objects"],
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
    dropped: ["пропуснати резюмета от лица извън 00_ADMIN / 02 / 02.1", "summaries skipped (uploaded by someone outside 00_ADMIN / 02 / 02.1)"],
    published: ["Както е публикувано на", "As published on"], latest: ["последно", "latest"],
    rebarAcc: ["Арм. приета", "Rebar accepted"], pending: ["чака", "pending"],
    byType: ["По тип", "By type"], list: ["Списък", "List"], noType: ["Без тип", "No type"],
    groupPoured: ["излети", "poured"], without: ["без", "n/a"],
    pubHint: ["Публикува се само: количества по етапи, дати по тактове, „армировка приета“ да/не, бележката и „въз основа на“. Без имена, вътрешни бележки и история.",
      "Published: quantities per stage, dates per pour, \"rebar accepted\" yes/no, the note and \"based on\". No names, internal notes or history."],
  };
  // plain stage names for the client look (A18)
  const PLAIN = {
    none: ["Не е започнат", "Not started"], formwork: ["Кофраж", "Formwork"], rebar_first: ["В процес", "In progress"],
    rebar: ["Армировка", "Reinforcement"], poured: ["Бетон излят", "Concrete poured"], stripped: ["Завършен", "Finished"],
  };
  const storedLang = (() => { try { return localStorage.getItem(LANG_KEY) || ""; } catch { return ""; } })();
  let lang = storedLang || "bg";
  const t = (k) => (T[k] ? T[k][lang === "bg" ? 0 : 1] : k);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // dates with the year (A19): BG 03.11.2026, EN 3 Nov 2026; table cells 03.11.26
  const fmtDate = (d) => { if (!d) return ""; const [y, m, dd] = d.split("-"); return lang === "bg" ? `${dd}.${m}.${y}` : `${+dd} ${MONTHS[+m - 1] || m} ${y}`; };
  const fmtShort = (d) => { if (!d) return ""; const [y, m, dd] = d.split("-"); return `${dd}.${m}.${y.slice(2)}`; };
  const fmtNum = (v, dec) => Number(v || 0).toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const decOf = (unit) => (unit === "kg" ? 0 : 1);
  const toNum = (v) => { const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : null; };
  function setStatus(text, bad) { $("status").textContent = text; $("status").className = "status" + (bad ? " bad" : ""); }
  const errText = (e) => (e && (e.message || e.toString())) || String(e);
  async function guarded(fn) { try { await fn(); } catch (e) { setStatus("Error: " + errText(e), true); console.error(e); } }

  const state = {
    api: null, client: null, project: null, role: "", lib: null,
    pours: [], objects: [],        // pour groups; pour objects [{modelId, id, guid, pour, volume}]
    records: new Map(),            // guid -> client-safe record (steps, "without", dates)
    accepted: null,                // merged acceptance records (admin / GC only), else null
    models: [], stageName: "",     // "based on": loaded models [{id, name, version, date}], matched stage
    asOf: "", days: [],            // "" = today
    coloured: true, showAll: false,   // colouring on by default (owner, 17.11.2026; round 14 M2)
    // sums: summary file stamp (id | version | modifiedOn, CS.listFiles) -> summary: a same-day re-publish has a new stamp
    // (round 10 M1). sumPicked: the user chose an older day in the picker this session (else a reload shows the newest).
    summaries: [], sums: new Map(), sumDay: "", sumPicked: false, look: "live", asClient: false, lastLook: "",
    sumVerified: true, sumDropped: [],   // round 11 M2: uploaders checked against 00_ADMIN / 02 / 02.1; names of dropped files
    caps: [],
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
  async function getToken(refresh) {
    if (token && !refresh) return token;
    const p = new Promise((resolve, reject) => { waiters.push(resolve); setTimeout(() => reject(new Error("No access token from Trimble Connect")), 60000); });
    const r = await state.api.extension.requestPermission("accesstoken");
    if (r === "denied") throw new Error("Access to Trimble Connect data was denied for this extension.");
    if (r && r !== "pending" && r !== "granted") { token = r; return r; }
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
    const { pours, unnumbered } = C.groupPours(items);
    state.pours = [...pours, ...unnumbered];
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
    if (state.sumDropped.length) console.warn("summary files dropped (uploader not in 00_ADMIN / 02 / 02.1):", state.sumDropped.join(", "));
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
  const unverifiedMark = () => (isStaff() && !state.sumVerified ? ` (${t("unverified")})` : "");

  // ---------- what is shown: a summary-shaped view of the live data, or the published summary ----------
  const currentRecords = () => (state.asOf ? P.recordsAsOf(state.records, state.asOf) : state.records);
  // round 12 M5: built again only when the day or the data changed (not on a language, group or "show all" re-render)
  const liveBuild = CS.liveBuilder();
  function liveSummary() {
    const day = state.asOf || S.today();
    return liveBuild({ date: day, objects: state.objects, pours: state.pours, records: state.records, accepted: state.accepted,
      project: state.project, note: "", basedOn: { stage: state.stageName, models: state.models } });
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
    return `${esc(t("basedOn"))}: <b>${esc(b.stage || t("loadedModels"))}</b>${models ? " · " + models : ""} · ${esc(t("dataAsOf"))} ${esc(fmtDate(sum.date))}`;
  }
  function render() {
    document.documentElement.lang = lang;
    const look = clientLook() ? "client" : "live";
    if (state.lastLook !== look) { $("details").open = look !== "client"; state.lastLook = look; }   // collapsed for clients
    const summary = inSummary();
    $("title").textContent = t("title");
    $("lblColour").textContent = t("colour"); $("btnView").textContent = t("view");
    $("btnView").hidden = state.role === "client";   // A19: clients do not create views
    $("hAsOf").textContent = t("asOf"); $("lblAsOf").textContent = t("asOfLbl"); $("btnToday").textContent = t("today");
    $("sumDetails").textContent = t("details"); $("hPours").textContent = t("pours"); $("hTimeline").textContent = t("timeline");
    $("btnMore").textContent = t("more");
    $("btnByType").textContent = t("byType"); $("btnList").textContent = t("list");
    $("btnByType").classList.toggle("on", state.group === "type"); $("btnList").classList.toggle("on", state.group !== "type");
    $("legend").innerHTML = STAGES.map((s, k) => `<span><span class="sw" style="background:${s.colour}${k === 0 ? `;opacity:${NOT_STARTED_OPACITY + 0.2}` : ""}"></span>${esc(stageName(s))}</span>`).join("")
      + `<span><span class="sw" style="background:${GHOST}"></span>${esc(t("other"))}</span>`;
    renderPublish();
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
      · <b>+${fmtNum(h.weekQty, decOf(h.unit))} ${esc(h.unit)}</b> ${esc(t("thisWeek"))} · <b>${h.poured} / ${h.pours}</b> ${esc(t("poursWord"))}</span></div>
      <div class="basis">${basisLine(sum)}</div>`
      + (summary && sum.clientNote ? `<div class="cnote"><b>${esc(t("clientNote"))}:</b> ${esc(sum.clientNote)}</div>` : "");
    // details: the four bars, each in its unit
    $("overall").innerHTML = S.STEPS.map((st) => {
      const s = sum.totals[st.id];
      return `<div class="stat"><div class="hd"><b>${esc(stageName(st))}</b><span class="num">${fmtNum(s.pct * 100, 0)}%${s.unit ? ` · ${fmtNum(s.qty, decOf(s.unit))} / ${fmtNum(s.total, decOf(s.unit))} ${s.unit}` : ""}</span></div>
        <div class="track"><div class="fill" style="width:${Math.min(100, s.pct * 100).toFixed(1)}%;background:${st.colour}"></div></div>
        <div class="sub">${s.pours} / ${sum.counts.pours} ${esc(t("poursDone"))}</div></div>`;
    }).join("") + `<div class="note">${esc(t("byVolume"))}${clientLook() ? "" : ` · ${sum.counts.objects} ${esc(t("objects"))}`}</div>`;
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
        <span class="sub">· ${g.pours.length} ${esc(t("poursWord"))} · ${esc(t("groupPoured"))} ${g.poured}</span></td></tr>` + g.pours.map(row).join("")).join("");
    } else $("pourRows").innerHTML = sum.pours.map(row).join("");
    // timeline
    const stepById = Object.fromEntries(S.STEPS.map((s) => [s.id, s]));
    const tl = summary ? CS.timelineOf(sum) : P.timeline(state.objects, currentRecords());
    const list = state.showAll ? tl : tl.slice(0, 30);
    $("timeline").innerHTML = list.length ? list.map((e) => {
      const extra = summary ? "" : [clientLook() ? "" : `${e.count} ${esc(t("objects"))}`, e.qty >= 0.05 ? `${fmtNum(e.qty, decOf(e.unit))} ${e.unit}` : ""].filter(Boolean).join(" · ");
      return `<li><span class="d">${esc(fmtDate(e.date))}</span><span class="dot" style="background:${stepById[e.step].colour}"></span>
      <span><b>${esc(e.pour)}</b> · ${esc(stageName(stepById[e.step]))}${extra ? `<br><span class="sub">${extra}</span>` : ""}</span></li>`;
    }).join("") : `<li class="sub">${esc(t("noEvents"))}</li>`;
    $("btnMore").hidden = state.showAll || tl.length <= 30;
  }
  function renderPublish() {
    const show = isStaff();   // the box ("Виж като клиент") for admin / GC; the publish form only for admin / PM (L8)
    $("hPub").hidden = !show; $("pubBox").hidden = !show;
    if (!show) return;
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
    if (state.asOf && !state.days.includes(state.asOf)) state.asOf = "";
    render();                          // the live view shows the fresh figures behind the confirm dialog
    setStatus(lang === "bg" ? "Подготовка на резюмето…" : "Preparing the summary…");
    const sum = CS.build({ date: day, now: new Date(), project: state.project, objects: state.objects, pours: state.pours, records: state.records,
      accepted: state.accepted, note: $("inNote").value, basedOn: { stage: $("inStage").value, models: state.models } });
    const v = CS.validate(sum);
    if (!v.ok) throw new Error((lang === "bg" ? "Резюмето не е безопасно за клиента и НЕ е публикувано: " : "The summary is not client-safe and was NOT published: ") + v.errors.slice(0, 3).join("; "));
    const h = CS.headline(sum), again = state.summaries.some((f) => f.day === day);
    const q = lang === "bg"
      ? `Публикуване за клиента към ${fmtDate(day)}${again ? " (замества днешното, като нова версия)" : ""}:\n${fmtNum(h.pct * 100, 0)}% излято, ${h.poured} / ${h.pours} такта.\nКлиентът ще вижда тези данни, докато не публикувате ново резюме.`
      : `Publish for the client as of ${fmtDate(day)}${again ? " (replaces today's, as a new version)" : ""}:\n${fmtNum(h.pct * 100, 0)}% poured, ${h.poured} / ${h.pours} pours.\nThe client sees this until you publish a new one.`;
    if (!window.confirm(q)) { setStatus(""); return; }
    const c = coreFor();
    state.folderCache = state.folderCache || new Map();
    const folderId = await B.ensureFolder(c, state.project.id, CS.FOLDER, state.folderCache);
    await B.uploadJson(c, folderId, CS.fileName(day), CS.toJson(sum), { fetch: window.ARSTEN_FETCH });
    try { await refreshSummaries(); } catch {}
    if (!sumFile(day)) state.summaries.unshift({ day, id: "", name: CS.fileName(day), modifiedOn: "", stamp: `local|${day}|${sum.published}` });
    state.sums.set(sumFile(day).stamp, sum);   // what was just uploaded is that version
    setStatus(lang === "bg" ? `Публикувано за клиента: ${CS.FOLDER.join("/")}/${CS.fileName(day)}` : `Published for the client: ${CS.FOLDER.join("/")}/${CS.fileName(day)}`);
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
  $("selLang").onchange = (e) => { lang = e.target.value; try { localStorage.setItem(LANG_KEY, lang); } catch {} render(); };
  const setGroup = (g) => { state.group = g; try { localStorage.setItem(GROUP_KEY, g); } catch {} render(); };
  $("btnByType").onclick = () => setGroup("type");
  $("btnList").onclick = () => setGroup("list");
  $("selSum").onchange = (e) => guarded(async () => {
    await openSummary(e.target.value);
    state.sumPicked = !!state.summaries.length && state.sumDay !== state.summaries[0].day;   // the newest = follow new publishes
    render(); if (state.coloured) await applyColours();
  });
  $("chkAsClient").onchange = (e) => guarded(async () => {
    state.asClient = e.target.checked;
    state.sumPicked = false;
    if (state.asClient) { await openSummary(state.summaries[0] && state.summaries[0].day); state.look = state.sumDay ? "summary" : "live"; }
    else state.look = "live";
    render();
    if (state.coloured) await applyColours();
  });
  $("btnPublish").onclick = () => guarded(publish);

  async function load() {
    setStatus(lang === "bg" ? "Зареждане…" : "Loading…");
    state.lib = null;
    // Round 12 M4: the independent reads at the same time: the pour objects (viewer), the published summaries (Core,
    // with the uploader check) and, for admin / GC, the library lookup (pset-api). Errors are reported in the same order.
    let poursErr = null, sumErr = null;
    const libP = state.role !== "client" ? state.client.findLibrary(state.project.id, S.LIB_NAMES) : null;
    if (libP) libP.catch(() => {});   // awaited below; an error here must not be "unhandled" when there are no pours
    await Promise.all([
      loadPours().catch((e) => { poursErr = e; state.pours = []; state.objects = []; }),
      // published summaries: the client reads ONLY these
      refreshSummaries().catch((e) => { sumErr = e; state.summaries = []; console.warn("summaries not listed", e); }),
    ]);
    if (state.role === "client") {
      // M1 (round 11): summary only. No library, no pour records, no acceptance, never a live fallback.
      state.records = new Map(); state.accepted = null; state.lib = null;
      if (state.summaries.length && await openFirstReadable()) {
        state.look = "summary";
        $("main").hidden = false;
        setStatus(`${t("published")} ${fmtDate(state.sumDay)}`);
        render();
        if (state.coloured) await applyColours();
        return;
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
    setStatus(`${state.pours.length} ${t("poursWord")} · ${state.objects.length} ${t("objects")}` + (sumErr && isStaff() ? ` · ${lang === "bg" ? "резюметата не се четат" : "summaries not readable"}: ${errText(sumErr)}` : ""));
    render();
    if (state.coloured) await applyColours();
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
    const access = demo ? { allowed: true, role: (demo && demo.role) || "admin", roles: demo && demo.roles, caps: (demo && demo.caps) || [], user: { language: (demo && demo.language) || "" } } : await ArstenAccess.check({ api, getToken, app: "projectStatus" });
    if (!access.allowed) { state.api = null; ArstenAccess.renderDenied(document.body, lang, access); return; }
    state.role = panelRole(access);
    state.caps = Array.isArray(access.caps) ? access.caps.slice() : [];
    await pickLanguage(api, access);
    state.project = (await api.project.getProject()) || {};
    state.client = client || new A.PsetClient({ region: state.project.location || "europe", getToken });
    render();
    await guarded(load);
  }
  window.ProjectStatusApp = { start, state, panelRole, reload: () => guarded(load) };   // reload: what a model event runs (tests)

  let reloadTimer = null;
  function onEvent(event, data) {
    if (event === "extension.accessToken") onToken(data);
    if (event === "viewer.onModelStateChanged" && state.client) { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => guarded(load), 1500); }
    if (event === "viewer.onModelReset") { state.coloured = false; $("chkColour").checked = false; }
  }
  if (window.parent === window) {
    if (/[?&]demo\b/.test(location.search)) { const s = document.createElement("script"); s.src = "demo.js?t=" + Date.now(); document.body.appendChild(s); }
    else setStatus("Not inside Trimble Connect. Add this extension to a project and open it from the 3D viewer side panel.", true);
    return;
  }
  TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000)
    .then((api) => start(api))
    .catch((e) => setStatus("Could not connect to Trimble Connect: " + errText(e), true));
})();
