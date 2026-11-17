// Printable weekly / monthly report (week 4, B-Client 4) and the steel card text (B-Client 2). Since 17.11.2026 also the
// period's activities ("Дейности на обекта", summary version 4, shared/arsten-activities.js).
// Built ONLY from a published client summary (client-summary.js; the client view, or "Виж като клиент" for staff), so
// it can never show more than the client may see. Print: the panel shows this HTML in place of the panel and calls
// window.print(); the print stylesheet (index.html, @media print) hides everything else. No PDF library: the browser's
// "Save as PDF" makes the PDF. BG and EN follow the panel language. Footer "Arsten / Multiplan · <date>".
// Pure (strings only). Browser: window.ClientReport; node: require.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const lib = factory(node ? require("./client-summary.js") : root.ClientSummary, node ? require("./status.js") : root.PourStatus,
    node ? require("./steel-summary.js") : root.SteelProgress);
  if (node) module.exports = lib;
  else root.ClientReport = lib;
})(typeof self !== "undefined" ? self : this, function (CS, S, SP) {
  "use strict";

  const L = {
    weekly: ["Седмичен отчет за напредъка", "Weekly progress report"], monthly: ["Месечен отчет за напредъка", "Monthly progress report"],
    published: ["Както е публикувано на", "As published on"], project: ["Проект", "Project"],
    poured: ["излято", "poured"], thisWeek: ["тази седмица", "this week"], poursWord: ["такта", "pours"], poursWord1: ["такт", "pour"],
    stages: ["По етапи", "By stage"], stage: ["Етап", "Stage"], share: ["%", "%"], qty: ["Количество", "Quantity"], poursDone: ["Завършени тактове", "Pours complete"],
    week: ["За седмицата", "This week"], month: ["За месеца", "This month"], thisMonth: ["този месец", "this month"], poursPlus: ["такта", "pours"], poursPlus1: ["такт", "pour"], byPour: ["По тактове (по тип)", "By pour (by type)"], pour: ["Такт", "Pour"], rebarAcc: ["Арм. приета", "Rebar accepted"],
    pending: ["чака", "pending"], without: ["без", "n/a"], noType: ["Без тип", "No type"], groupPoured: ["излети", "poured"],
    period: ["Изпълнено в периода", "Done in the period"], none: ["Няма завършени етапи в периода.", "No stages completed in the period."],
    note: ["Бележка", "Note"], site: ["Дейности на обекта", "Site activities"], basedOn: ["Въз основа на", "Based on"], loadedModels: ["заредените модели", "the loaded models"], dataAsOf: ["данни към", "data as of"],
    steel: ["Стомана", "Steel"], erected: ["монтирано", "erected"], delivered: ["доставено", "delivered"], fabricated: ["изработено", "fabricated"],
    erectedN: ["монтирани", "erected"], deliveredN: ["доставени", "delivered"], fabricatedN: ["изработени", "fabricated"], asmWord: ["сглобки", "assemblies"], pcs: ["бр.", "pcs"],
    steelWeight: ["стомана: % по тегло от модела", "steel: % by weight from the model"],
    steelCount: ["стомана: % по брой сглобки (моделът няма тегла)", "steel: % by number of assemblies (the model has no weights)"],
    steelNoModel: ["стомана: само бройки – моделът на стоманата не е бил зареден", "steel: counts only – the steel model was not loaded"],
    unnumbered: ["обекта без номер на такт не са включени", "objects without a pour number are not included"],
    unnumbered1: ["обект без номер на такт не е включен", "object without a pour number is not included"],
  };
  // plain stage names for the client (A18), as the client look of the panel
  const PLAIN = { formwork: ["Кофраж", "Formwork"], rebar: ["Армировка", "Reinforcement"], poured: ["Бетон излят", "Concrete poured"], stripped: ["Завършен", "Finished"] };
  const STEP_IDS = S.STEPS.map((s) => s.id);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function fmt(lang) {
    const bg = lang === "bg";
    const t = (k) => (L[k] ? L[k][bg ? 0 : 1] : k);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const date = (d) => { if (!d) return ""; const [y, m, dd] = String(d).split("-"); return bg ? `${dd}.${m}.${y}` : `${+dd} ${MONTHS[+m - 1] || m} ${y}`; };
    const short = (d) => { if (!d) return ""; const [y, m, dd] = String(d).split("-"); return `${dd}.${m}.${y.slice(2)}`; };
    const num = (v, dec) => Number(v || 0).toLocaleString(bg ? "bg-BG" : "en-GB", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const pct = (x) => `${num((x || 0) * 100, 0)}%`;
    const stage = (id) => (PLAIN[id] ? PLAIN[id][bg ? 0 : 1] : id);
    // the counted form, as the panel's tn() (round 16 L3): tn(1, "poursWord") = "такт" / "pour", otherwise "такта" / "pours"
    const tn = (n, k) => (Math.abs(Number(n)) === 1 && L[k + "1"] ? t(k + "1") : t(k));
    return { bg, t, tn, esc, date, short, num, pct, stage, dec: (unit) => (unit === "kg" ? 0 : 1) };
  }

  /** Steel card (B-Client 2): "Стомана: 62% монтирано (12,4 / 20,1 t) · доставено 80% · изработено 95%" (HTML).
   *  Without weights: % by count with "(120 / 195 бр.)"; without a steel model: counts only. "" without a steel section. */
  function steelCard(st, lang) {
    if (!st) return "";
    const f = fmt(lang), sh = SP.shares(st);
    if (!sh) {
      const c = st.count || {};
      // delivered only when it is bounded by a known total (an older no-model file has total 0 and an uncapped
      // delivered figure, which could exceed the pieces that exist: left out, round 15 L6)
      const del = c.total > 0 ? ` · ${f.esc(f.t("deliveredN"))} ${Math.min(c.delivered || 0, c.total)}` : "";
      return `<b>${f.esc(f.t("steel"))}:</b> ${f.esc(f.t("erectedN"))} <b>${c.erected || 0}</b>${del} · ${f.esc(f.t("fabricatedN"))} ${c.fabricated || 0} ${f.esc(f.t("asmWord"))}`;
    }
    const of = st.byWeight ? `${f.num(st.kg.erected / 1000, 1)} / ${f.num(st.kg.total / 1000, 1)} t` : `${st.count.erected} / ${st.count.total} ${f.t("pcs")}`;
    return `<b>${f.esc(f.t("steel"))}:</b> <span class="big">${f.pct(sh.erected)}</span> ${f.esc(f.t("erected"))} <span class="num">(${f.esc(of)})</span>`
      + ` · ${f.esc(f.t("delivered"))} <b>${f.pct(sh.delivered)}</b> · ${f.esc(f.t("fabricated"))} <b>${f.pct(sh.fabricated)}</b>`;
  }
  /** Plain-text additions to "Въз основа на" (round 14 takt count; B-Client 2 steel basis). */
  function basisExtras(sum, lang) {
    const f = fmt(lang), out = [];
    const n = sum && sum.basedOn && sum.basedOn.unnumbered;
    if (n > 0) out.push(`${n} ${f.t(n === 1 ? "unnumbered1" : "unnumbered")}`);
    const st = sum && sum.steel;
    if (st) out.push(f.t(!st.model ? "steelNoModel" : st.byWeight ? "steelWeight" : "steelCount"));
    return out;
  }
  /** "Въз основа на: <stage> · models (version, date) · данни към <date> · extras" (HTML). */
  function basisHtml(sum, lang) {
    const f = fmt(lang), b = (sum && sum.basedOn) || {};
    const models = (b.models || []).map((m) => f.esc(m.name) + (m.version || m.date ? ` <span class="sub">(${f.esc([m.version, f.date(m.date)].filter(Boolean).join(", "))})</span>` : "")).join(", ");
    const extra = basisExtras(sum, lang).map((x) => " · " + f.esc(x)).join("");
    return `${f.esc(f.t("basedOn"))}: <b>${f.esc(b.stage || f.t("loadedModels"))}</b>${models ? " · " + models : ""} · ${f.esc(f.t("dataAsOf"))} ${f.esc(f.date(sum.date))}${extra}`;
  }
  /** First day of the report period: the summary's week, or the 30 days before the summary date (monthly). */
  const periodFrom = (sum, period) => (period === "month" ? CS.addDays(sum.date, -30) : (sum.week && sum.week.from) || CS.addDays(sum.date, -7));

  /**
   * The printable report of one summary: a complete HTML fragment (styles in index.html, .rep*).
   * @param sum a validated client summary; o {lang: "bg"|"en", period: "week"|"month"}
   */
  function html(sum, o) {
    o = o || {};
    const f = fmt(o.lang || "bg"), t = f.t, esc = f.esc;
    const period = o.period === "month" ? "month" : "week";
    const h = CS.headline(sum);
    const from = periodFrom(sum, period);
    const acc = sum.pours.some((p) => p.rebar !== null);
    const head = `<div class="rep-top"><span class="rep-brand"><b>Arsten</b> / Multiplan</span><span>${esc(t("published"))} ${esc(f.date(sum.date))}</span></div>
      <h1 class="rep-h1">${esc(t(period === "month" ? "monthly" : "weekly"))}</h1>
      ${sum.project && sum.project.name ? `<div class="rep-sub">${esc(t("project"))}: <b>${esc(sum.project.name)}</b></div>` : ""}`;
    // round 19 L2: a monthly report shows the month. The summary keeps only the 7-day quantities, so the month is
    // counted in pours: the pours whose stage was completed in the 30 days (as the timeline below).
    const month = period === "month";
    const inPeriod = (id) => sum.pours.filter((p) => { const d = p.steps[id] && p.steps[id].date; return d && d > from && d <= sum.date && CS.isComplete(p, id) && !CS.allNa(p, id); }).length;
    const plusPours = (n) => `+${n} ${esc(f.tn(n, "poursPlus"))}`;
    const headline = `<div class="rep-card"><span class="big">${f.pct(h.pct)}</span> ${esc(t("poured"))}
      <span class="num">(${f.num(h.qty, f.dec(h.unit))} / ${f.num(h.total, f.dec(h.unit))} ${esc(h.unit)})</span>
      · <b>${month ? plusPours(inPeriod("poured")) : `+${f.num(h.weekQty, f.dec(h.unit))} ${esc(h.unit)}`}</b> ${esc(t(month ? "thisMonth" : "thisWeek"))} · <b>${h.poured} / ${h.pours}</b> ${esc(f.tn(h.pours, "poursWord"))}</div>`;
    const steel = sum.steel ? `<div class="rep-card">${steelCard(sum.steel, o.lang)}</div>` : "";
    const stages = `<h2 class="rep-h2">${esc(t("stages"))}</h2><div class="rep-scroll"><table class="rep-t"><thead><tr><th>${esc(t("stage"))}</th><th class="c">${esc(t("share"))}</th>
      <th class="c">${esc(t("qty"))}</th><th class="c">${esc(t("poursDone"))}</th><th class="c">${esc(t(month ? "month" : "week"))}</th></tr></thead><tbody>${STEP_IDS.map((id) => {
        const s = sum.totals[id];
        return `<tr><td>${esc(f.stage(id))}</td><td class="c">${f.pct(s.pct)}</td><td class="c">${f.num(s.qty, f.dec(s.unit))} / ${f.num(s.total, f.dec(s.unit))} ${esc(s.unit)}</td>
          <td class="c">${s.pours} / ${sum.counts.pours}</td><td class="c">${month ? plusPours(inPeriod(id)) : `+${f.num(s.weekQty, f.dec(s.unit))} ${esc(s.unit)}`}</td></tr>`;
      }).join("")}</tbody></table></div>`;
    const cell = (p, id) => {
      const c = p.steps[id];
      if (CS.allNa(p, id)) return `<td class="c">${esc(t("without"))}</td>`;
      if (CS.isComplete(p, id)) return `<td class="c done">${esc(f.short(c.date)) || "✓"}</td>`;
      if (c.done) return `<td class="c">${c.done}/${p.objects}</td>`;
      return `<td class="c none">–</td>`;
    };
    const cols = 1 + STEP_IDS.length + (acc ? 1 : 0);
    const pours = `<h2 class="rep-h2">${esc(t("byPour"))}</h2><div class="rep-scroll"><table class="rep-t"><thead><tr><th>${esc(t("pour"))}</th>${STEP_IDS.map((id) => `<th class="c">${esc(f.stage(id))}</th>`).join("")}
      ${acc ? `<th class="c">${esc(t("rebarAcc"))}</th>` : ""}</tr></thead><tbody>${CS.groupByType(sum.pours).map((g) => `<tr class="grp"><td colspan="${cols}">${esc(CS.typeName(g.type, o.lang) || t("noType"))}
      <span class="sub">· ${g.pours.length} ${esc(f.tn(g.pours.length, "poursWord"))} · ${esc(t("groupPoured"))} ${g.poured}</span></td></tr>` + g.pours.map((p) => `<tr><td><b>${esc(p.label)}</b></td>${STEP_IDS.map((id) => cell(p, id)).join("")}
      ${acc ? `<td class="c">${p.rebar === "yes" ? "✓" : p.rebar === "pending" ? esc(t("pending")) : "–"}</td>` : ""}</tr>`).join("")).join("")}</tbody></table></div>`;
    const events = CS.timelineOf(sum).filter((e) => e.date > from && e.date <= sum.date);
    const done = `<h2 class="rep-h2">${esc(t("period"))} <span class="sub">(${esc(f.date(CS.addDays(from, 1)))} – ${esc(f.date(sum.date))})</span></h2>`
      + (events.length ? `<ul class="rep-l">${events.map((e) => `<li><span class="d">${esc(f.date(e.date))}</span> <b>${esc(e.pour)}</b> · ${esc(f.stage(e.step))}</li>`).join("")}</ul>` : `<p class="sub">${esc(t("none"))}</p>`);
    // photos of an entry (client copies): o.photoUrl(id) gives the download URL ("" / missing = left out)
    const photosOf = (x) => {
      const urls = (x.photos || []).map((id) => (o.photoUrl ? o.photoUrl(id) : "")).filter(Boolean);
      return urls.length ? `<span class="rep-ph">${urls.map((u) => `<img src="${esc(u)}" alt="">`).join("")}</span>` : "";
    };
    // site works (version 4): the ones done in the period, oldest first; no section when there are none
    const siteRows = (sum.site || []).filter((x) => x && x.date > from && x.date <= sum.date).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const site = siteRows.length ? `<h2 class="rep-h2">${esc(t("site"))}</h2><ul class="rep-l rep-site">${siteRows.map((x) => `<li><span class="d">${esc(f.date(x.date))}</span> <span>${esc(x.text)}${photosOf(x)}</span></li>`).join("")}</ul>` : "";
    const note = sum.clientNote ? `<div class="rep-note"><b>${esc(t("note"))}:</b> ${esc(sum.clientNote)}</div>` : "";
    const foot = `<div class="rep-basis">${basisHtml(sum, o.lang)}</div><div class="rep-foot">Arsten / Multiplan · ${esc(f.date(sum.date))}</div>`;
    return head + headline + stages + steel + pours + done + site + note + foot;
  }

  return { html, steelCard, basisExtras, basisHtml, periodFrom, PLAIN };
});
