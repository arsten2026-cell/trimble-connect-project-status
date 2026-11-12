// Project status: read-only client view of construction progress in the Trimble Connect 3D viewer.
// Reads the statuses that Pour status (Arsten) stores in the project library "CIP/Монолитно" and the pour objects
// of the Tekla model (property set Pour/Такт). Shows stages and dates only: no notes, no names, no rebar or
// formwork details. Writes nothing to the data; "Save view" only creates a Connect view of the current colours.
// Access: project ADMIN, groups CLIENT and GENERAL CONTRACTOR (shared/arsten-access.js, app "projectStatus").
(() => {
  "use strict";
  const C = window.PourLogic, S = window.PourStatus, A = window.PsetApi, P = window.ProjectProgress;
  const $ = (id) => document.getElementById(id);
  const PROXY = "IfcBuildingElementProxy";
  const BATCH = 200;
  const GHOST = "#D9D5CC", GHOST_OPACITY = 0.12, NOT_STARTED_OPACITY = 0.45;

  const T = {
    title: ["Статус на проекта", "Project status"],
    colour: ["Оцвети по статус", "Colour by status"], view: ["Запази изглед", "Save view"],
    asOf: ["Към дата", "As of date"], asOfLbl: ["Състояние към", "Status as of"], today: ["Днес", "Today"],
    overall: ["Общ напредък", "Overall progress"], pours: ["По тактове", "By pour"], timeline: ["Хронология", "Timeline"],
    more: ["Покажи всички", "Show all"], pour: ["Такт", "Pour"], other: ["Друго в модела (прозрачно)", "Rest of the model (ghosted)"],
    byVolume: ["по обем бетон", "by concrete volume"], poursDone: ["тактове завършени", "pours complete"],
    noEvents: ["Още няма отбелязани етапи.", "No stages recorded yet."],
    noLib: ["Статусите на тактовете още не са настроени в този проект.", "Pour statuses are not set up in this project yet."],
    noPours: ["В заредените модели няма тактове (Tekla IFC с Pour/Такт).", "No pours in the loaded models (Tekla IFC with Pour/Такт)."],
    objects: ["елемента", "objects"],
  };
  let lang = (() => { try { return localStorage.getItem("arsten.projectStatus.lang") || "bg"; } catch { return "bg"; } })();
  const t = (k) => (T[k] ? T[k][lang === "bg" ? 0 : 1] : k);
  const stepName = (s) => (lang === "bg" ? s.bg : s.en);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtDate = (d) => (d ? (lang === "bg" ? d.split("-").reverse().join(".") : d) : "");
  const fmtNum = (v, dec) => Number(v || 0).toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const toNum = (v) => { const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : null; };
  function setStatus(text, bad) { $("status").textContent = text; $("status").className = "status" + (bad ? " bad" : ""); }
  const errText = (e) => (e && (e.message || e.toString())) || String(e);
  async function guarded(fn) { try { await fn(); } catch (e) { setStatus("Error: " + errText(e), true); console.error(e); } }

  const state = {
    api: null, client: null, project: null,
    pours: [], objects: [],        // pour groups; pour objects [{modelId, id, guid, pour, volume}]
    records: new Map(),            // guid -> client-safe record (steps, "without", dates)
    asOf: "", days: [],            // "" = today
    coloured: false, showAll: false,
  };

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
    for (const g of state.pours) for (const o of g.objects) state.objects.push({ modelId: o.modelId, id: o.id, guid: o.guid, pour: g.label, volume: toNum(o.props[C.P.volume]) });
  }
  async function loadRecords(lib) {
    const links = state.objects.map((o) => S.entityLink(o.guid));
    const got = await state.client.readMany(lib.id, S.DEF_ID, links);
    const all = new Map();
    for (const [link, props] of got) all.set(link.replace(/^frn:entity:/, ""), props);
    // keep only what clients may see (steps, "without", dates)
    state.records = P.recordsAsOf(all, "");
    const range = P.dateRange(state.records);
    const today = S.today();
    state.days = [];
    if (range) for (let d = new Date(range.min + "T00:00:00"); S.today(d) <= today; d.setDate(d.getDate() + 1)) state.days.push(S.today(d));
  }

  // ---------- colours ----------
  const STAGES = S.STAGES;
  const selector = (objs) => {
    const byModel = new Map();
    for (const o of objs) { if (!byModel.has(o.modelId)) byModel.set(o.modelId, []); byModel.get(o.modelId).push(o.id); }
    return { modelObjectIds: [...byModel].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds })) };
  };
  const currentRecords = () => (state.asOf ? P.recordsAsOf(state.records, state.asOf) : state.records);
  async function applyColours() {
    const api = state.api;
    if (!state.coloured) return api.viewer.setObjectState(undefined, { color: "reset", opacity: 1 });
    await api.viewer.setObjectState(undefined, { color: GHOST, opacity: GHOST_OPACITY });   // everything that is not a pour
    const recs = currentRecords();
    const buckets = STAGES.map(() => []);
    for (const o of state.objects) buckets[STAGES.indexOf(S.stageOf(recs.get(o.guid)))].push(o);
    for (let k = 0; k < STAGES.length; k++) {
      if (buckets[k].length) await api.viewer.setObjectState(selector(buckets[k]), { color: STAGES[k].colour, opacity: k === 0 ? NOT_STARTED_OPACITY : 1 });
    }
  }

  // ---------- rendering ----------
  function render() {
    document.documentElement.lang = lang;
    $("title").textContent = t("title");
    $("lblColour").textContent = t("colour"); $("btnView").textContent = t("view");
    $("hAsOf").textContent = t("asOf"); $("lblAsOf").textContent = t("asOfLbl"); $("btnToday").textContent = t("today");
    $("hOverall").textContent = t("overall"); $("hPours").textContent = t("pours"); $("hTimeline").textContent = t("timeline");
    $("btnMore").textContent = t("more");
    $("legend").innerHTML = STAGES.map((s, k) => `<span><span class="sw" style="background:${s.colour}${k === 0 ? `;opacity:${NOT_STARTED_OPACITY + 0.2}` : ""}"></span>${esc(stepName(s))}</span>`).join("")
      + `<span><span class="sw" style="background:${GHOST}"></span>${esc(t("other"))}</span>`;
    // as of
    const rng = $("rngAsOf");
    rng.max = String(Math.max(0, state.days.length - 1));
    rng.disabled = state.days.length < 2;
    rng.value = String(state.asOf ? Math.max(0, state.days.indexOf(state.asOf)) : Math.max(0, state.days.length - 1));
    $("asOfDate").textContent = fmtDate(state.asOf || S.today());
    $("btnToday").hidden = !state.asOf;

    const recs = currentRecords();
    // overall
    const o = P.overall(state.objects, recs);
    $("overall").innerHTML = S.STEPS.map((st) => {
      const s = o.steps[st.id];
      return `<div class="stat"><div class="hd"><b>${esc(stepName(st))}</b><span class="num">${fmtNum(s.pct * 100, 0)}% · ${fmtNum(s.volume, 1)} / ${fmtNum(o.total.volume, 1)} m³</span></div>
        <div class="track"><div class="fill" style="width:${Math.min(100, s.pct * 100).toFixed(1)}%;background:${st.colour}"></div></div>
        <div class="sub">${o.poursComplete[st.id]} / ${o.pours} ${esc(t("poursDone"))}</div></div>`;
    }).join("") + `<div class="note">${esc(t("byVolume"))} · ${o.total.count} ${esc(t("objects"))}</div>`;
    // per pour
    const short = lang === "bg" ? ["Кофраж", "Арм.", "Излят", "Декофр."] : ["Formwork", "Rebar", "Poured", "Stripped"];
    $("pourHead").innerHTML = `<tr><th>${esc(t("pour"))}</th>${short.map((h) => `<th class="c">${h}</th>`).join("")}</tr>`;
    const rows = P.perPour(state.pours, recs);
    $("pourRows").innerHTML = rows.map((r) => `<tr><td><span class="name">${esc(r.label)}</span> <span class="sub">${r.total}</span></td>${S.STEPS.map((st) => {
      const c = r.steps[st.id];
      if (c.complete) return `<td class="c done" title="${esc(fmtDate(c.date))}">${esc(fmtDate(c.date).slice(0, 5)) || "✓"}</td>`;
      if (c.done) return `<td class="c part" title="${esc(fmtDate(c.date))}">${c.done}/${r.total}</td>`;
      return `<td class="c none">–</td>`;
    }).join("")}</tr>`).join("");
    // timeline
    const tl = P.timeline(state.objects, recs);
    const shown = state.showAll ? tl : tl.slice(0, 30);
    const stepById = Object.fromEntries(S.STEPS.map((s) => [s.id, s]));
    $("timeline").innerHTML = shown.length ? shown.map((e) => `<li><span class="d">${esc(fmtDate(e.date))}</span><span class="dot" style="background:${stepById[e.step].colour}"></span>
      <span><b>${esc(e.pour)}</b> · ${esc(stepName(stepById[e.step]))}<br><span class="sub">${e.count} ${esc(t("objects"))}${e.volume >= 0.05 ? ` · ${fmtNum(e.volume, 1)} m³` : ""}</span></span></li>`).join("")
      : `<li class="sub">${esc(t("noEvents"))}</li>`;
    $("btnMore").hidden = state.showAll || tl.length <= 30;
  }

  // ---------- save view ----------
  async function saveView() {
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
  $("selLang").onchange = (e) => { lang = e.target.value; try { localStorage.setItem("arsten.projectStatus.lang", lang); } catch {} render(); };

  async function load() {
    setStatus(lang === "bg" ? "Зареждане…" : "Loading…");
    await loadPours();
    if (!state.objects.length) { $("main").hidden = true; return setStatus(t("noPours"), true); }
    const found = await state.client.findLibrary(state.project.id, S.LIB_NAMES);
    if (!found.lib) { $("main").hidden = true; return setStatus(t("noLib"), true); }
    await loadRecords(found.lib);
    $("main").hidden = false;
    setStatus(`${state.pours.length} ${lang === "bg" ? "такта" : "pours"} · ${state.objects.length} ${t("objects")}`);
    render();
    if (state.coloured) await applyColours();
  }

  async function start(api, client) {
    state.api = api;
    const access = window.ARSTEN_DEMO ? { allowed: true, role: "admin" } : await ArstenAccess.check({ api, getToken, app: "projectStatus" });
    if (!access.allowed) { state.api = null; ArstenAccess.renderDenied(document.body, lang, access); return; }
    state.project = (await api.project.getProject()) || {};
    state.client = client || new A.PsetClient({ region: state.project.location || "europe", getToken });
    render();
    await guarded(load);
  }
  window.ProjectStatusApp = { start, state };

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
