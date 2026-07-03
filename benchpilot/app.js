// BenchPilot frontend — end-to-end TNBC bench-to-decision workflow.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = (p, o) => fetch(p, o).then(r => r.json());
const esc = s => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const state = { question: "", target: null, experiment: "", inventory: [], cat: "all" };

const EXAMPLES = [
  "PARP inhibitor combination strategies in BRCA-wildtype TNBC",
  "TROP2 antibody-drug conjugates in metastatic TNBC",
  "Immune checkpoint blockade and PD-L1 in TNBC",
  "ATR inhibition to exploit replication stress in TNBC",
];

// ---------- navigation ----------
function show(view) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $("#view-" + view).classList.add("active");
  $$(".navitem").forEach(n => n.classList.toggle("active", n.dataset.view === view));
  window.scrollTo(0, 0);
}
$$(".navitem").forEach(n => n.onclick = () => show(n.dataset.view));
document.addEventListener("click", e => {
  const g = e.target.closest("[data-goto]");
  if (g) { e.preventDefault(); show(g.dataset.goto); }
});

// ---------- boot ----------
(async function init() {
  const s = await api("/api/stats");
  $("#kbStats").textContent = `${s.papers} papers · ${s.trials} trials · ${s.inventory.total} reagents`;
  const eng = $("#engineBadge");
  eng.textContent = s.engine === "granite" ? "IBM Granite" : "Offline engine";
  eng.classList.toggle("offline", s.engine !== "granite");
  $("#examples").innerHTML = EXAMPLES.map(e => `<span class="ex">${esc(e)}</span>`).join("");
  $$("#examples .ex").forEach(x => x.onclick = () => { $("#q").value = x.textContent; ask(); });
  $("#landingFoot").textContent = `Built with IBM Bob · ${s.papers} papers · ${s.trials} trials · ${s.inventory.total} reagents`;
  loadInventory();
})();

// ---------- 01 discover ----------
$("#askBtn").onclick = ask;
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") ask(); });

async function ask() {
  const q = $("#q").value.trim();
  if (!q) return;
  state.question = q;
  const box = $("#discoverResults");
  box.innerHTML = `<div class="card"><span class="spinner"></span> Searching corpus and extracting targets…</div>`;
  const r = await api("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, k: 6 }) });
  box.innerHTML = renderDiscover(r);
  $$("#discoverResults [data-target]").forEach(b => b.onclick = () => goDesign(b.dataset.target, b.dataset.assay));
}

function renderDiscover(r) {
  const engine = r.engine === "granite" ? "IBM Granite" : "grounded";
  let h = `<div class="card"><h3>Evidence synthesis · ${engine}</h3><div class="synthesis">${esc(r.synthesis)}</div></div>`;

  h += `<div class="section-label">Targets found in the evidence</div>`;
  if (r.targets.length) {
    h += `<div class="targets">` + r.targets.map(t => `
      <div class="target">
        <div class="tname">${esc(t.target)}</div>
        <div class="ttype">${esc(t.type)}</div>
        <div class="counts"><span><b>${t.paper_count}</b> papers</span><span><b>${t.trial_count}</b> trials</span></div>
        <button data-target="${esc(t.target)}" data-assay="${esc(t.assay)}">Design experiment →</button>
      </div>`).join("") + `</div>`;
  } else { h += `<div class="empty">No curated targets matched — try a more specific query.</div>`; }

  h += `<div class="section-label">Supporting evidence</div><div class="evidence">
    <div class="evcol"><h4>Papers</h4>${r.papers.map(p => `
      <div class="ev"><div class="evtitle">${esc(p.title)}</div>
      <div class="evmeta"><a href="https://pubmed.ncbi.nlm.nih.gov/${esc(p.id)}/" target="_blank">PMID ${esc(p.id)}</a>
      <span>${esc(p.year || "")}</span><span class="pill">score ${p.score}</span></div>
      ${p.abstract ? `<details class="ev-more"><summary>Show abstract</summary><div class="ev-body">${esc(p.abstract)}</div></details>` : ""}
      </div>`).join("")}</div>
    <div class="evcol"><h4>Clinical trials</h4>${r.trials.map(t => `
      <div class="ev"><div class="evtitle">${esc(t.title)}</div>
      <div class="evmeta"><a href="https://clinicaltrials.gov/study/${esc(t.id)}" target="_blank">${esc(t.id)}</a>
      <span class="pill">${esc(t.phase || "—")}</span><span>${esc(t.status || "")}</span></div>
      <details class="ev-more"><summary>Show trial details</summary><div class="ev-body">
        <div><span class="hk">Status</span>${esc(t.status || "—")}</div>
        <div><span class="hk">Phase</span>${esc(t.phase || "—")}</div>
        ${t.sponsor ? `<div><span class="hk">Sponsor</span>${esc(t.sponsor)}</div>` : ""}
        ${t.interventions ? `<div><span class="hk">Interventions</span>${esc(t.interventions)}</div>` : ""}
        ${(t.primary_outcomes && t.primary_outcomes.length) ? `<div><span class="hk">Primary outcomes</span>${t.primary_outcomes.map(esc).join("; ")}</div>` : ""}
      </div></details>
      </div>`).join("")}</div>
  </div>`;
  return h;
}

// ---------- 02 hypotheses & plan ----------
async function goDesign(target, assay) {
  state.target = target; state.assay = assay;
  show("design");
  const body = $("#designBody"); body.className = "";
  body.innerHTML = `<div class="card"><span class="spinner"></span> Generating hypotheses for <b>${esc(target)}</b>…</div>`;
  const hyps = await api("/api/hypotheses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, question: state.question }) });
  state.hypotheses = hyps;
  body.innerHTML = renderHypotheses(target, hyps);
  $$("#designBody [data-hyp]").forEach(b => b.onclick = () => selectHypothesis(b.dataset.hyp));
}

function renderHypotheses(target, hyps) {
  const eng = (hyps[0] && hyps[0].engine === "granite") ? "IBM Granite" : "grounded templates";
  let h = `<div class="hyp-head"><div><div class="hh-target">${esc(target)}</div>
    <div class="hh-sub">${hyps.length} candidate hypotheses · ${eng}</div></div></div>`;
  h += `<div class="hyps">` + hyps.map(x => `
    <div class="hyp">
      <div class="hyp-top"><span class="hid">${esc(x.id)}</span><span class="conf conf-${x.confidence}">${esc(x.confidence)} confidence</span></div>
      ${x.plain ? `<div class="hplain">💡 ${esc(x.plain)}</div>` : ""}
      <div class="hstate">${esc(x.statement)}</div>
      <div class="hgrid">
        <div><span class="hk">Prediction</span>${esc(x.prediction || "")}</div>
        <div><span class="hk">Falsification</span>${esc(x.falsification || "")}</div>
        <div><span class="hk">Mechanism</span>${esc(x.mechanism || "")}</div>
        <div><span class="hk">Novelty</span>${esc(x.novelty || "")}</div>
      </div>
      <div class="hrat">${esc(x.rationale || "")}</div>
      <button class="primary hbtn" data-hyp="${esc(x.id)}">Select &amp; plan experiments →</button>
    </div>`).join("") + `</div>`;
  return h;
}

async function selectHypothesis(hid) {
  const hyp = (state.hypotheses || []).find(h => h.id === hid);
  if (!hyp) return;
  state.hypothesis = hyp;
  const body = $("#designBody");
  body.innerHTML = renderHypotheses(state.target, state.hypotheses.filter(h => h.id === hid))
    + `<div class="card"><span class="spinner"></span> Planning experiments…</div>`;
  const plan = await api("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: state.target, hypothesis: hyp, question: state.question }) });
  state.currentPlan = plan;
  body.innerHTML = renderHypotheses(state.target, state.hypotheses.filter(h => h.id === hid)) + renderPlan(plan);
  $("#planSpinup").onclick = spinup;
  $("#backHyps").onclick = () => { body.innerHTML = renderHypotheses(state.target, state.hypotheses); $$("#designBody [data-hyp]").forEach(b => b.onclick = () => selectHypothesis(b.dataset.hyp)); };
}

function renderPlan(plan) {
  const wps = plan.work_packages, tot = plan.total_weeks || 1;
  const eng = plan.engine === "granite" ? "IBM Granite" : "template";
  let h = `<div class="plan-head"><div class="section-label" style="margin:22px 0 6px">Experiment plan · ${wps.length} work packages · ${tot} weeks · ${eng}</div>
    <button class="ghost" id="backHyps" style="height:32px">← other hypotheses</button></div>`;
  // Gantt
  h += `<div class="gantt"><div class="gantt-ruler">` +
    Array.from({ length: tot }, (_, i) => `<span style="width:${100 / tot}%">w${i + 1}</span>`).join("") + `</div>`;
  h += wps.map((w, i) => {
    const left = 100 * w.start_week / tot, width = 100 * (w.end_week - w.start_week) / tot;
    return `<div class="gantt-row"><div class="gantt-label"><b>${esc(w.id)}</b> ${esc(w.title)}</div>
      <div class="gantt-track"><div class="gantt-bar bar${i % 5}" style="left:${left}%;width:${width}%">
        ${esc(w.assay_type)} · ${w.end_week - w.start_week}w</div></div></div>`;
  }).join("") + `</div>`;
  // WP detail cards
  h += `<div class="section-label">Work packages</div><div class="wps">` + wps.map(w => `
    <div class="wp">
      <div class="wp-top"><span class="hid">${esc(w.id)}</span>
        <span class="wp-when">wk ${w.start_week + 1}–${w.end_week}${(w.depends_on || []).length ? " · after " + w.depends_on.join(", ") : " · start now"}</span></div>
      <div class="wp-title">${esc(w.title)}</div>
      <div class="wp-aim">${esc(w.aim || "")}</div>
      <div class="wp-meta">
        ${w.design && w.design.groups ? `<div><span class="hk">Test groups</span>${w.design.groups.map(esc).join(", ")} · n=${w.design.replicates}</div>` : ""}
        ${w.model_systems && w.model_systems.length ? `<div><span class="hk">Cell lines</span>${w.model_systems.map(esc).join(", ")}</div>` : ""}
        ${w.design && w.design.controls ? `<div><span class="hk">Controls</span>${w.design.controls.map(esc).join(", ")}</div>` : ""}
        ${w.readouts && w.readouts.length ? `<div><span class="hk">Readouts</span>${w.readouts.map(esc).join(", ")}</div>` : ""}
        ${w.reagents && w.reagents.length ? `<div><span class="hk">Reagents</span>${w.reagents.map(esc).join(", ")}</div>` : ""}
      </div>
    </div>`).join("") + `</div>`;
  h += `<div class="spinup-cta"><div><div class="sct-title">Turn this plan into a project</div>
    <div class="sct-sub">Each work package becomes a scheduled, assignable task — with reagent checks — on the team board.</div></div>
    <button class="primary" id="planSpinup">🚀 Spin up project &amp; assign tasks →</button></div>`;
  return h;
}

// ---------- 03 protocol ----------
$("#protoBtn").onclick = runProtocol;
$("#protoInput").addEventListener("keydown", e => { if (e.key === "Enter") runProtocol(); });

async function runProtocol() {
  const exp = $("#protoInput").value.trim();
  if (!exp) return;
  const body = $("#protocolBody");
  body.innerHTML = `<div class="card"><span class="spinner"></span> Drafting protocol and reconciling against live stock…</div>`;
  const r = await api("/api/protocol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ experiment: exp }) });
  state.lastMaterials = (r.check || []).map(c => c.required_name);
  state.lastAssay = (r.protocol && r.protocol.title || "").toLowerCase().includes("qpcr") ? "qpcr" : "experiment";
  body.innerHTML = renderProtocol(r);
  const btn = $("#dlOrder");
  if (btn) btn.onclick = () => downloadCSV(r.order_list);
  const sb = $("#spinupBtn");
  if (sb) sb.onclick = spinup;
}

function renderProtocol(r) {
  const p = r.protocol, eng = p.engine === "granite" ? "IBM Granite" : "template";
  let h = `<div class="card"><h3>Protocol · ${eng}</h3>
    <div style="font-size:16px;font-weight:600">${esc(p.title)}</div>
    <div class="ttype" style="margin:4px 0 10px">⏱ ${esc(p.estimated_duration || "")} · ${esc(p.objective || "")}</div>
    <ol class="steps">${(p.steps || []).map(s => `<li>${esc(s)}</li>`).join("")}</ol></div>`;

  h += `<div class="section-label">Materials vs live inventory</div>
    <div class="table-wrap"><table><thead><tr>
    <th>Status</th><th>Material</th><th>Need</th><th>In stock</th><th>Matched</th><th>Vendor</th></tr></thead><tbody>` +
    r.check.map(c => `<tr>
      <td><span class="status s-${c.status}"><span class="dot"></span>${c.status}</span></td>
      <td>${esc(c.required_name)}</td>
      <td class="mono-cell">${esc(c.required_qty)} ${esc(c.required_unit)}</td>
      <td class="mono-cell">${esc(c.in_stock)} ${esc(c.unit)}</td>
      <td class="mono-cell">${esc(c.matched_id || "—")}</td>
      <td>${esc(c.vendor || "—")}</td></tr>`).join("") + `</tbody></table></div>`;

  const o = r.order_list;
  if (o.length) {
    h += `<div class="section-label">Need to order (${o.length})</div><div class="order">` +
      o.map(x => `<div class="oitem"><span><span class="status s-${x.status}"><span class="dot"></span>${x.status}</span> &nbsp;${esc(x.required_name)}</span>
        <span class="mono-cell">~${esc(x.suggested_order_qty)} ${esc(x.required_unit)} · ${esc(x.vendor || "vendor TBD")} ${esc(x.catalog_number || "")}</span></div>`).join("") +
      `<div style="margin-top:14px"><button class="ghost" id="dlOrder">⬇ Download order list (CSV)</button></div></div>`;
  } else {
    h += `<div class="order ok" style="margin-top:16px">✓ All materials in stock — ready to run.</div>`;
  }
  h += `<div class="spinup-cta">
    <div><div class="sct-title">Hand this to the team</div>
    <div class="sct-sub">Create a project and auto-assign discovery → design → protocol → experiment → analysis tasks.</div></div>
    <button class="primary" id="spinupBtn">🚀 Spin up project &amp; assign tasks →</button></div>`;
  return h;
}

function downloadCSV(rows) {
  const head = ["status", "material", "suggested_qty", "unit", "vendor", "catalog_number"];
  const lines = [head.join(",")].concat(rows.map(r =>
    [r.status, `"${r.required_name}"`, r.suggested_order_qty, r.required_unit, `"${r.vendor || ""}"`, r.catalog_number || ""].join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "benchpilot_order_list.csv"; a.click();
}

// ---------- inventory ----------
async function loadInventory() {
  const r = await api("/api/inventory");
  state.inventory = r.items;
  renderCats();
  renderInventory();
  $("#invSummary").innerHTML =
    `<span><b>${r.stats.total}</b> items</span><span style="color:var(--miss)"><b>${r.stats.low}</b> low / out</span><span style="color:var(--exp)"><b>${r.stats.expired}</b> expired</span>`;
}
function renderCats() {
  const cats = ["all", ...new Set(state.inventory.map(i => i.category))];
  $("#catChips").innerHTML = cats.map(c =>
    `<span class="catchip ${c === state.cat ? "active" : ""}" data-cat="${c}">${c[0].toUpperCase() + c.slice(1)}</span>`).join("");
  $$(".catchip").forEach(ch => ch.onclick = () => { state.cat = ch.dataset.cat; renderCats(); renderInventory(); });
}
function today() { return new Date().toISOString().slice(0, 10); }
function statusOf(it) {
  if ((it.quantity || 0) <= (it.reorder_threshold || 0)) return "MISSING";
  if (it.expiration && it.expiration < today()) return "EXPIRED";
  return "AVAILABLE";
}
function renderInventory() {
  const q = $("#invSearch").value.trim().toLowerCase();
  let rows = state.inventory;
  if (state.cat !== "all") rows = rows.filter(i => i.category === state.cat);
  if (q) rows = rows.filter(i => (i.name + i.vendor + i.catalog_number + i.cas + i.subtype).toLowerCase().includes(q));
  $("#invBody").innerHTML = rows.map(it => {
    const st = statusOf(it);
    return `<tr data-id="${esc(it.id)}">
      <td><span class="dot" style="background:var(--${st === "MISSING" ? "miss" : st === "EXPIRED" ? "exp" : "ok"})"></span></td>
      <td class="mono-cell">${esc(it.id)}</td>
      <td>${esc(it.name)}</td>
      <td><span class="cat-tag">${esc(it.category)}</span></td>
      <td class="mono-cell">${esc(it.quantity)} ${esc(it.unit)}</td>
      <td class="mono-cell">${esc(it.concentration || "—")}</td>
      <td>${esc(it.vendor || "—")}</td>
      <td class="mono-cell">${esc(it.catalog_number || "—")}</td>
      <td class="mono-cell">${esc(it.storage_location || "—")}</td></tr>`;
  }).join("") || `<tr><td colspan="9" class="empty">No items match.</td></tr>`;
  $$("#invBody tr[data-id]").forEach(tr => tr.onclick = () => openDrawer(tr.dataset.id));
}
$("#invSearch").addEventListener("input", renderInventory);

// drawer detail
async function openDrawer(id) {
  const it = await api("/api/inventory/" + id);
  const st = statusOf(it);
  const row = (k, v) => v ? `<div class="drow"><span class="dk">${k}</span><span>${esc(v)}</span></div>` : "";
  $("#drawer").innerHTML = `<button class="close" id="dClose">×</button>
    <h2>${esc(it.name)}</h2>
    <div class="dsub">${esc(it.id)} · <span class="status s-${st}"><span class="dot"></span>${st}</span></div>
    ${row("Category", it.category)}${row("Subtype", it.subtype)}
    ${row("Quantity", `${it.quantity} ${it.unit}  (reorder ≤ ${it.reorder_threshold})`)}
    ${row("Concentration", it.concentration)}${row("Purity", it.purity)}
    ${row("Molecular weight", it.molecular_weight && it.molecular_weight + " g/mol")}${row("Form", it.form)}
    ${row("Vendor", it.vendor)}${row("Catalog #", it.catalog_number)}${row("CAS", it.cas)}
    ${row("Storage", `${it.storage_location || ""} · ${it.storage_temp || ""}`)}
    ${row("Lot", it.lot)}${row("Expiration", it.expiration)}${row("Hazard", it.hazard)}${row("Notes", it.notes)}
    <button class="danger" id="dDelete">Delete item</button>`;
  openPanel();
  $("#dClose").onclick = closePanel;
  $("#dDelete").onclick = async () => {
    if (!confirm(`Delete ${it.name}?`)) return;
    await api("/api/inventory/" + id, { method: "DELETE" });
    closePanel(); loadInventory();
  };
}
function openPanel() { $("#drawer").classList.add("show"); $("#scrim").classList.add("show"); }
function closePanel() { $("#drawer").classList.remove("show"); $("#scrim").classList.remove("show"); }
$("#scrim").onclick = () => { closePanel(); $("#modal").classList.remove("show"); };

// add item modal
$("#addBtn").onclick = () => {
  const f = (k, ph, val = "") => `<label>${k}<input name="${k}" placeholder="${ph}" value="${val}"></label>`;
  $("#modalCard").innerHTML = `<h2>Catalogue a new reagent</h2>
    <div class="formgrid">
      <label class="full">Name<input name="name" placeholder="e.g. Niraparib"></label>
      <label>Category<select name="category"><option>chemical</option><option>biological</option><option>plastic</option></select></label>
      ${f("subtype", "PARP inhibitor")}
      ${f("vendor", "Selleck")}${f("catalog_number", "S-1234")}
      ${f("cas", "1038915-60-4")}${f("molecular_weight", "320.4")}
      ${f("concentration", "10 mM stock")}${f("purity", "≥98%")}
      ${f("form", "Powder")}
      <label>Quantity<input name="quantity" type="number" value="100"></label>
      ${f("unit", "mg")}
      <label>Reorder ≤<input name="reorder_threshold" type="number" value="20"></label>
      ${f("storage_location", "Freezer -20 #1")}${f("storage_temp", "-20C")}
      ${f("expiration", "2027-01-01")}${f("hazard", "Irritant")}
      <label class="full">Notes<input name="notes" placeholder="optional"></label>
    </div>
    <div class="modal-actions"><button class="ghost" id="mCancel">Cancel</button><button class="primary" id="mSave">Add to inventory</button></div>`;
  $("#modal").classList.add("show");
  $("#mCancel").onclick = () => $("#modal").classList.remove("show");
  $("#mSave").onclick = async () => {
    const data = {};
    $$("#modalCard [name]").forEach(i => data[i.name] = i.type === "number" ? parseFloat(i.value || 0) : i.value);
    if (!data.name) { alert("Name is required"); return; }
    await api("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    $("#modal").classList.remove("show");
    loadInventory();
  };
};

// ================= V3: Projects & Team =================
const LOADERS = { projects: loadProjects, team: loadTeam };
$$(".navitem").forEach(n => n.onclick = () => { show(n.dataset.view); (LOADERS[n.dataset.view] || (() => {}))(); });

const STATUS_LABEL = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" };
const avatar = (ini, name) => `<span class="avatar ${!name || name === "Unassigned" ? "none" : ""}" title="${esc(name || "Unassigned")}">${esc(ini || "—")}</span>`;

// ---- Projects ----
async function loadProjects() {
  const projs = await api("/api/projects");
  state.projects = projs;
  $("#projectPicker").innerHTML = projs.map((p, i) => `
    <div class="proj-card ${i === 0 ? "active" : ""}" data-pid="${esc(p.id)}">
      <div class="pname">${esc(p.name)}</div>
      <div class="pgoal">${esc(p.goal)}</div>
      <div class="progress"><span style="width:${p.progress}%"></span></div>
      <div class="pmeta"><span>${p.done_count}/${p.task_count} done</span><span>${esc(p.lead_name)}</span></div>
    </div>`).join("");
  $$("#projectPicker .proj-card").forEach(c => c.onclick = () => {
    $$("#projectPicker .proj-card").forEach(x => x.classList.remove("active"));
    c.classList.add("active"); openProject(c.dataset.pid);
  });
  if (projs.length) openProject(projs[0].id);
}

async function openProject(pid) {
  state.currentProject = pid;
  const body = $("#projectBody");
  body.innerHTML = `<div class="card"><span class="spinner"></span> Loading board and running stand-up…</div>`;
  const [pr, su] = await Promise.all([api("/api/project/" + pid), api("/api/standup?project=" + pid)]);
  state.currentProjectData = pr;
  body.innerHTML = renderProjectHeader(pr.project) + renderStandup(su) + renderPipeline(pr.pipeline)
    + renderRoadmap(pr.board)
    + `<div class="section-label">Board · drag cards to update status · click a card for details &amp; photos</div>` + renderBoard(pr.board);
  $("#editProjBtn").onclick = () => openProjectEditor(pr, "edit");
  wireBoardDnD(pid);
}

function renderProjectHeader(p) {
  const team = (p.member_objs || []).map(m => avatar(m.initials, m.name)).join("");
  return `<div class="proj-header">
    <div><div class="ph-name">${esc(p.name)}</div>
      <div class="ph-goal">${esc(p.goal || "")}</div>
      <div class="ph-team">${team || '<span class="muted" style="color:var(--muted);font-size:12.5px">No team assigned yet</span>'}</div></div>
    <button class="ghost" id="editProjBtn">✎ Edit project</button></div>`;
}

function wireBoardDnD(pid) {
  let dragId = null, moved = false;
  $$("#projectBody .taskcard").forEach(c => {
    c.addEventListener("dragstart", e => { dragId = c.dataset.id; moved = true; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.dataset.id); });
    c.addEventListener("dragend", () => { dragId = null; c.classList.remove("dragging"); setTimeout(() => moved = false, 50); });
    c.addEventListener("click", () => { if (!moved) openTaskDrawer(c.dataset.id, pid); });
  });
  $$("#projectBody .col").forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("dragover"); });
    col.addEventListener("dragleave", () => col.classList.remove("dragover"));
    col.addEventListener("drop", async e => {
      e.preventDefault(); col.classList.remove("dragover");
      const id = dragId || e.dataTransfer.getData("text/plain");
      if (!id) return;
      await api("/api/tasks/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: col.dataset.status }) });
      openProject(pid);
    });
  });
}

function renderStandup(s) {
  const c = s.counts;
  let flags = "";
  if (s.blockers.length) flags += `<div class="flag"><b>Blockers:</b> ` +
    s.blockers.map(b => `${esc(b.title)} — ${esc(b.reason)}`).join(" · ") + `</div>`;
  if (s.unassigned.length) flags += `<div class="flag">${s.unassigned.length} unassigned task(s) — see Team &amp; tasks.</div>`;
  return `<div class="standup"><h3>✦ AI stand-up</h3>
    <div class="snarr">${esc(s.narrative)}</div>
    <div class="schips"><span>✅ ${c.done} done</span><span>🔵 ${c.in_progress} in progress</span><span>⚪ ${c.todo} to do</span><span style="color:var(--miss)">⛔ ${c.blocked} blocked</span></div>
    ${flags}</div>`;
}

function renderPipeline(pipe) {
  return `<div class="pipeline">` + pipe.map((s, i) =>
    `<div class="stage"><div class="sn">${esc(s.stage)}</div><div class="sc">${s.count}</div></div>` +
    (i < pipe.length - 1 ? "" : "")).join("") + `</div>`;
}

function renderBoard(board) {
  return `<div class="board">` + ["todo", "in_progress", "blocked", "done"].map(st => `
    <div class="col" data-status="${st}"><h4>${STATUS_LABEL[st]} <span>${board[st].length}</span></h4>
      ${board[st].map(t => taskCard(t)).join("")}
    </div>`).join("") + `</div>`;
}

function taskCard(t) {
  const rd = t.readiness || { ready: true, missing: [] };
  const badge = t.reagents && t.reagents.length
    ? (rd.ready ? `<span class="ready">reagents ok</span>` : `<span class="ready block">need ${esc(rd.missing.join(", "))}</span>`)
    : "";
  const photos = (t.attachments && t.attachments.length) ? `<span class="tphoto">🖼 ${t.attachments.length}</span>` : "";
  return `<div class="taskcard" draggable="true" data-id="${esc(t.id)}">
    <div class="tt">${esc(t.title)}</div>
    <div class="trow"><span>${avatar(t.assignee_initials, t.assignee_name)}</span>
    <span style="display:flex;gap:6px;align-items:center">${photos}<span class="prio ${t.priority}">${t.priority}</span></span></div>
    ${badge ? `<div class="trow" style="margin-top:7px">${badge}</div>` : ""}</div>`;
}

// ---- Team & tasks ----
async function loadTeam() {
  const data = await api("/api/team");
  state.members = data.members;
  const projName = {}; (state.projects || await api("/api/projects")).forEach(p => projName[p.id] = p.name);

  $("#rosterBody").innerHTML = data.members.map(m => `
    <div class="mcard">${avatar(m.initials, m.name)}
      <div><div class="mname">${esc(m.name)}</div><div class="mrole">${esc(m.role)}</div>
      <div class="mload">${m.active} active${m.blocked ? ` · <span class="b">${m.blocked} blocked</span>` : ""}</div></div>
    </div>`).join("");

  $("#dupBody").innerHTML = "";

  const opts = a => data.members.map(m => `<option value="${m.id}" ${a === m.id ? "selected" : ""}>${esc(m.initials)} · ${esc(m.name)}</option>`).join("");
  $("#taskBody").innerHTML = data.tasks.map(t => `
    <tr>
      <td class="mono-cell">${esc(t.id)}</td>
      <td>${esc(t.title)}</td>
      <td class="mono-cell">${esc(t.project_id)}</td>
      <td>${esc(t.target)}</td>
      <td><select class="mini" data-task="${t.id}" data-f="assignee"><option value="">— Unassigned</option>${opts(t.assignee)}</select></td>
      <td><select class="mini" data-task="${t.id}" data-f="status">${["todo", "in_progress", "blocked", "done"].map(s => `<option value="${s}" ${t.status === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select></td>
      <td><span class="prio ${t.priority}">${t.priority}</span></td>
      <td class="mono-cell">${esc(t.due || "")}</td>
    </tr>`).join("");

  $$('#taskBody select').forEach(sel => sel.onchange = async () => {
    await api("/api/tasks/" + sel.dataset.task, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [sel.dataset.f]: sel.value || null }) });
    loadTeam();
  });
}

$("#suggestBtn").onclick = async () => {
  const s = await api("/api/suggest");
  if (!s.length) { alert("No unassigned tasks — the board is fully staffed."); return; }
  const rows = s.map(x => `<div class="oitem"><span>${esc(x.title)} <span class="mono-cell">→ ${esc(x.target)}</span></span>
    <span><b>${esc(x.suggest)}</b> <span class="mono-cell">(${esc(x.why)})</span> &nbsp;
    <button class="ghost" style="padding:3px 10px" data-t="${x.task_id}" data-m="${x.suggest_id}">Assign</button></span></div>`).join("");
  $("#modalCard").innerHTML = `<h2>✦ Suggested assignments</h2><div class="order" style="background:#f6fbfb;border-color:#cfe6e6">${rows}</div>
    <div class="modal-actions"><button class="ghost" id="mClose">Close</button></div>`;
  $("#modal").classList.add("show");
  $("#mClose").onclick = () => $("#modal").classList.remove("show");
  $$("#modalCard [data-t]").forEach(b => b.onclick = async () => {
    await api("/api/tasks/" + b.dataset.t, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignee: b.dataset.m }) });
    b.textContent = "✓ Assigned"; b.disabled = true; loadTeam();
  });
};

// ================= V3.1: create + spin up =================
function openModal(html) {
  $("#modalCard").innerHTML = html;
  $("#modal").classList.add("show");
  $$("#modalCard [data-close]").forEach(b => b.onclick = closeModal);
}
function closeModal() { $("#modal").classList.remove("show"); }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });

async function ensureMeta() {
  if (!state.projects) state.projects = await api("/api/projects");
  if (!state.members) { const t = await api("/api/team"); state.members = t.members; }
}
const memberOpts = (sel) => (state.members || []).map(m =>
  `<option value="${m.id}" ${sel === m.id ? "selected" : ""}>${esc(m.initials)} · ${esc(m.name)}</option>`).join("");

// discovery / plan -> project editor (assign team + adjust tasks, then save)
async function spinup() {
  await ensureMeta();
  const q = state.question || $("#protoInput").value || "";
  const tgt = state.target || "";
  const lbl = tgt || (q.slice(0, 48) + (q.length > 48 ? "…" : ""));
  const plan = state.currentPlan;
  let tasks;
  if (plan && plan.work_packages && plan.work_packages.length) {
    const base = new Date();
    const due = wk => { const d = new Date(base); d.setDate(d.getDate() + wk * 7); return d.toISOString().slice(0, 10); };
    tasks = plan.work_packages.map(w => ({
      title: `${w.id}: ${w.title}`, stage: w.stage || "experiment", target: tgt,
      assignee: "", priority: "high", due: due(w.end_week), reagents: w.reagents || [],
      design: w.design || null, status: "todo",
    }));
  } else {
    const reagents = state.lastMaterials || [];
    const assay = state.lastAssay || "experiment";
    tasks = [
      { title: `Literature & trial scan: ${lbl}`, stage: "discover", target: tgt, status: "done", priority: "medium", due: "", reagents: [] },
      { title: `Design experiment`, stage: "design", target: tgt, priority: "high", due: "", reagents: [] },
      { title: `Draft & source protocol: ${lbl}`, stage: "protocol", target: tgt, priority: "high", due: "", reagents },
      { title: `Run ${assay} assay: ${lbl}`, stage: "experiment", target: tgt, priority: "high", due: "", reagents },
      { title: `Analyze results: ${lbl}`, stage: "analysis", target: tgt, priority: "medium", due: "", reagents: [] },
    ];
  }
  const goal = (state.hypothesis && state.hypothesis.statement) || q;
  const lead = (state.members || []).some(m => m.id === "MEM-00") ? "MEM-00" : null;  // Fedor Lipskerov, lead researcher
  const members = state.isDemo ? (state.members || []).map(m => m.id) : (lead ? [lead] : []);
  openProjectEditor({ name: `${lbl} — TNBC`, goal, lead, members, tasks }, "create");
}

// suggestion under the search bar — fills the box so the user can edit/submit themselves
$("#demoQ").onclick = () => { $("#q").value = $("#demoQ").textContent.trim(); $("#q").focus(); };

// new project (empty editor)
$("#newProjBtn").onclick = async () => {
  await ensureMeta();
  openProjectEditor({ name: "", goal: "", lead: null, members: [], tasks: [] }, "create");
};

// new task
$("#newTaskBtn").onclick = async () => {
  await ensureMeta();
  const projOpts = state.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  const stageOpts = ["discover", "design", "protocol", "experiment", "analysis"].map(s => `<option>${s}</option>`).join("");
  openModal(`<h2>New task</h2>
    <div class="formgrid">
      <label>Project<select id="nt_proj">${projOpts}</select></label>
      <label>Stage<select id="nt_stage">${stageOpts}</select></label>
      <label class="full">Title<input id="nt_title" placeholder="e.g. PARP viability assay in HCC1937"></label>
      <label>Target<input id="nt_target" placeholder="e.g. PARP/BRCA (HR deficiency)"></label>
      <label>Assignee<select id="nt_assignee"><option value="">— Unassigned</option>${memberOpts()}</select></label>
      <label>Priority<select id="nt_prio"><option>high</option><option selected>medium</option><option>low</option></select></label>
      <label>Due<input id="nt_due" placeholder="YYYY-MM-DD"></label>
      <label class="full">Reagents (comma-separated)<input id="nt_reag" placeholder="Olaparib, MTT reagent, 96-well plate, clear flat"></label>
    </div>
    <div class="modal-actions"><button class="ghost" data-close>Cancel</button><button class="primary" id="nt_save">Add task</button></div>`);
  $("#nt_save").onclick = async () => {
    const title = $("#nt_title").value.trim();
    if (!title) { alert("Title required"); return; }
    const reagents = $("#nt_reag").value.split(",").map(s => s.trim()).filter(Boolean);
    await api("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: $("#nt_proj").value, title, stage: $("#nt_stage").value,
        target: $("#nt_target").value, assignee: $("#nt_assignee").value || null,
        priority: $("#nt_prio").value, due: $("#nt_due").value, reagents }) });
    closeModal(); loadTeam();
  };
};

// ================= Project editor (create from experiment / edit) =================
const STAGES = ["discover", "design", "protocol", "experiment", "analysis"];

async function openProjectEditor(data, mode) {
  await ensureMeta();
  const isEdit = mode === "edit";
  const members = state.members;
  let proj, tasks = [];
  if (isEdit) {
    proj = { id: data.project.id, name: data.project.name, goal: data.project.goal,
             lead: data.project.lead || "", members: data.project.members || [] };
    Object.values(data.board).forEach(col => col.forEach(t => tasks.push({
      _id: t.id, title: t.title, stage: t.stage, target: t.target, assignee: t.assignee || "",
      priority: t.priority, due: t.due || "", reagents: t.reagents || [], status: t.status,
      design: t.design || null, attachments: t.attachments || [],
    })));
  } else {
    proj = { name: data.name || "", goal: data.goal || "", lead: data.lead || "", members: data.members || [] };
    tasks = (data.tasks || []).map(t => ({ title: t.title, stage: t.stage, target: t.target || "",
      assignee: t.assignee || "", priority: t.priority || "medium", due: t.due || "",
      reagents: t.reagents || [], design: t.design || null, attachments: t.attachments || [],
      status: t.status || "todo" }));
  }
  const removed = new Set();

  const memberChecks = () => members.map(m =>
    `<label class="mcheck"><input type="checkbox" value="${m.id}" ${(proj.members || []).includes(m.id) ? "checked" : ""}>
     ${avatar(m.initials, m.name)} ${esc(m.name)}</label>`).join("");
  const assigneeSel = a => `<select class="mini te-assignee"><option value="">—</option>${members.map(m =>
    `<option value="${m.id}" ${a === m.id ? "selected" : ""}>${esc(m.initials)}</option>`).join("")}</select>`;
  const sel = (cls, val, opts) => `<select class="mini ${cls}">${opts.map(o =>
    `<option ${o === val ? "selected" : ""}>${o}</option>`).join("")}</select>`;
  const taskRows = () => tasks.map((t, i) => `
    <div class="te-row" data-i="${i}">
      <input class="te-title" value="${esc(t.title)}" placeholder="Task title">
      <div class="te-ctrls">${sel("te-stage", t.stage, STAGES)}${assigneeSel(t.assignee)}${sel("te-prio", t.priority, ["high", "medium", "low"])}
        <input class="te-due mini" value="${esc(t.due)}" placeholder="due">
        <button class="te-del" title="remove">✕</button></div>
    </div>`).join("");

  function collect() {
    $$("#pe_tasks .te-row").forEach(row => {
      const i = +row.dataset.i;
      tasks[i].title = $(".te-title", row).value;
      tasks[i].stage = $(".te-stage", row).value;
      tasks[i].assignee = $(".te-assignee", row).value;
      tasks[i].priority = $(".te-prio", row).value;
      tasks[i].due = $(".te-due", row).value;
    });
  }
  function rerenderTasks() { $("#pe_tasks").innerHTML = taskRows(); wireDel(); }
  function wireDel() {
    $$("#pe_tasks .te-del").forEach(b => b.onclick = () => {
      collect(); const i = +b.closest(".te-row").dataset.i;
      if (tasks[i]._id) removed.add(tasks[i]._id);
      tasks.splice(i, 1); rerenderTasks();
    });
  }
  function autoAssign() {
    collect();
    const checked = $$("#pe_members input:checked").map(c => c.value);
    const pool = members.filter(m => m.role !== "Principal Investigator" && (!checked.length || checked.includes(m.id)));
    if (!pool.length) { alert("Add team members first."); return; }
    const load = {}; pool.forEach(m => load[m.id] = 0);
    tasks.forEach(t => {
      if (t.status === "done") return;
      const tgt = (t.target || proj.name || "").toLowerCase();
      const best = pool.slice().sort((a, b) => {
        const fit = m => tgt.split(/\W+/).filter(w => w.length > 3 && (m.focus || "").toLowerCase().includes(w)).length;
        return (fit(b) - fit(a)) || (load[a.id] - load[b.id]);
      })[0];
      t.assignee = best.id; load[best.id]++;
    });
    rerenderTasks();
  }

  openModal(`<h2>${isEdit ? "Edit project" : "New project"}</h2>
    <div class="formgrid">
      <label class="full">Project name<input id="pe_name" value="${esc(proj.name)}" placeholder="e.g. ATR inhibition in TNBC"></label>
      <label class="full">Goal<input id="pe_goal" value="${esc(proj.goal)}" placeholder="One-line objective"></label>
      <label>Lead<select id="pe_lead"><option value="">— none</option>${members.map(m => `<option value="${m.id}" ${proj.lead === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>
    </div>
    <div class="pe-sec">Team members</div>
    <div id="pe_members" class="mchecks">${memberChecks()}</div>
    <div class="pe-sec">Tasks <button class="ghost" id="pe_auto" style="height:30px;padding:0 12px;font-size:12.5px">✦ Auto-assign</button></div>
    <div id="pe_tasks">${taskRows()}</div>
    <button class="ghost" id="pe_add" style="height:34px;margin-top:10px">+ Add task</button>
    <div class="modal-actions"><button class="ghost" data-close>Cancel</button><button class="primary" id="pe_save">${isEdit ? "Save changes" : "Create project"}</button></div>`);

  wireDel();
  $("#pe_add").onclick = () => { collect(); tasks.push({ title: "", stage: "experiment", target: proj.name || "", assignee: "", priority: "medium", due: "", reagents: [], status: "todo" }); rerenderTasks(); };
  $("#pe_auto").onclick = autoAssign;
  $("#pe_save").onclick = async () => {
    collect();
    const name = $("#pe_name").value.trim();
    if (!name) { alert("Project name is required"); return; }
    const goal = $("#pe_goal").value, lead = $("#pe_lead").value || null;
    const mem = $$("#pe_members input:checked").map(c => c.value);
    const btn = $("#pe_save"); btn.disabled = true; btn.textContent = "Saving…";
    let pid;
    if (isEdit) {
      pid = proj.id;
      await api("/api/project/" + pid, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, goal, lead, members: mem }) });
      for (const id of removed) await api("/api/tasks/" + id, { method: "DELETE" });
      for (const t of tasks) {
        if (t._id) await api("/api/tasks/" + t._id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t.title, stage: t.stage, assignee: t.assignee || null, priority: t.priority, due: t.due }) });
        else await api("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: pid, title: t.title, stage: t.stage, target: t.target || name, assignee: t.assignee || null, priority: t.priority, due: t.due, reagents: t.reagents || [], design: t.design || null, attachments: t.attachments || [] }) });
      }
    } else {
      const res = await api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, goal, lead, members: mem }) });
      pid = res.id;
      for (const t of tasks) await api("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: pid, title: t.title, stage: t.stage, target: t.target || name, assignee: t.assignee || null, status: t.status || "todo", priority: t.priority, due: t.due, reagents: t.reagents || [], design: t.design || null, attachments: t.attachments || [] }) });
    }
    closeModal(); state.projects = null; show("projects"); await loadProjects();
    const card = $$("#projectPicker .proj-card").find(c => c.dataset.pid === pid);
    if (card) { $$("#projectPicker .proj-card").forEach(x => x.classList.remove("active")); card.classList.add("active"); openProject(pid); card.scrollIntoView({ behavior: "smooth", block: "center" }); }
  };
}

// ---- task detail drawer (design + reagents + photos + upload) ----
async function openTaskDrawer(id, pid) {
  const t = await api("/api/tasks/" + id);
  const d = t.design || {};
  const row = (k, v) => v ? `<div class="drow"><span class="dk">${k}</span><span>${esc(v)}</span></div>` : "";
  const list = (k, a) => (a && a.length) ? `<div class="drow"><span class="dk">${k}</span><span>${a.map(esc).join(", ")}</span></div>` : "";
  const rd = t.readiness || { ready: true, missing: [] };
  const photos = (t.attachments || []).map(u =>
    `<a href="${esc(u)}" target="_blank"><img class="tphoto-img" src="${esc(u)}" alt="attachment"></a>`).join("");
  $("#drawer").innerHTML = `<button class="close" id="dClose">×</button>
    <h2>${esc(t.title)}</h2>
    <div class="dsub">${esc(t.id)} · ${esc(t.stage)} · <span class="prio ${t.priority}">${t.priority}</span></div>
    ${row("Assignee", t.assignee_name)}${row("Status", t.status)}${row("Due", t.due)}${row("Target", t.target)}
    ${d.groups || d.cell_lines ? `<div class="dsec">Experimental design</div>` : ""}
    ${list("Cell lines", d.cell_lines)}${list("Groups", d.groups)}
    ${row("Replicates", d.replicates ? "n = " + d.replicates : "")}${list("Controls", d.controls)}${row("Readout", d.readout)}
    ${(t.reagents && t.reagents.length) ? `<div class="dsec">Reagents ${rd.ready ? '<span class="ready">in stock</span>' : '<span class="ready block">need ' + esc(rd.missing.join(", ")) + '</span>'}</div>
      <div class="drow" style="grid-template-columns:1fr"><span>${t.reagents.map(esc).join(", ")}</span></div>` : ""}
    <div class="dsec">Protocol photos</div>
    <div class="tphotos">${photos || '<span class="muted" style="color:var(--muted);font-size:12.5px">No photos yet.</span>'}</div>
    <label class="upl">📷 Add photo<input type="file" id="tUpload" accept="image/*" hidden></label>`;
  openPanel();
  $("#dClose").onclick = closePanel;
  $("#tUpload").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    await fetch("/api/tasks/" + id + "/photo", { method: "POST", body: fd });
    openTaskDrawer(id, pid);                     // refresh drawer
    if (pid && state.currentProject === pid) openProject(pid);   // refresh card badge
  };
}

// per-project WP roadmap (collapsible timeline built from task due dates)
const STATUS_BAR = { done: "#12a150", in_progress: "#0d9488", blocked: "#e0524a", todo: "#94a0ad" };
function renderRoadmap(board) {
  const tasks = [].concat(...Object.values(board));
  const dated = tasks.filter(t => t.due);
  if (!dated.length) return "";
  const ms = dated.map(t => new Date(t.due).getTime());
  const min = Math.min(...ms), max = Math.max(...ms);
  const totW = Math.max(1, Math.round((max - min) / (7 * 864e5)) + 1);
  const wk = t => Math.round((new Date(t.due).getTime() - min) / (7 * 864e5));
  const sorted = tasks.slice().sort((a, b) => (a.due ? new Date(a.due) : 8e15) - (b.due ? new Date(b.due) : 8e15));
  let h = `<details class="roadmap-wrap"><summary>▾ WP roadmap / timeline (${dated.length} scheduled)</summary>
    <div class="gantt" style="margin-top:12px"><div class="gantt-ruler">` +
    Array.from({ length: totW }, (_, i) => `<span style="width:${100 / totW}%">w${i + 1}</span>`).join("") + `</div>`;
  h += sorted.map(t => {
    const end = t.due ? Math.max(1, wk(t) + 1) : 1;
    const width = 100 * end / totW;
    const col = STATUS_BAR[t.status] || "#94a0ad";
    return `<div class="gantt-row"><div class="gantt-label"><b>${esc((t.title.split(":")[0]))}</b> ${esc(t.title.replace(/^WP\d+:\s*/, "").slice(0, 40))}</div>
      <div class="gantt-track"><div class="gantt-bar" style="left:0;width:${width}%;background:${col}">${esc(t.status)}${t.due ? " · " + esc(t.due) : ""}</div></div></div>`;
  }).join("") + `</div></details>`;
  return h;
}

// ===== Landing / search hero =====
(function landing() {
  const L = $("#landing");
  const enter = q => { if (!q) return; L.classList.add("hidden"); show("discover"); $("#q").value = q; ask(); };
  const go = () => enter($("#landingQ").value.trim());
  $("#landingBtn").onclick = go;
  $("#landingQ").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  $("#landingExamples").innerHTML = EXAMPLES.slice(0, 3).map(e => `<span class="ex">${esc(e)}</span>`).join("");
  $$("#landingExamples .ex").forEach(x => x.onclick = () => enter(x.textContent));
  const brand = document.querySelector(".brand");
  if (brand) brand.onclick = () => { L.classList.remove("hidden"); setTimeout(() => $("#landingQ").focus(), 100); };
  setTimeout(() => $("#landingQ").focus(), 300);
})();

// ================= Knowledge graph (+ link-prediction ML) =================
LOADERS.graph = loadGraph;
const GCOLOR = { gene: "#0d9488", drug: "#3b82f6", subtype: "#8b5cf6" };
let _graph = null, _gpos = null, _gadj = null, _ghi = null;

async function loadGraph() {
  if (!_graph) _graph = await api("/api/graph");
  const g = _graph;
  _gadj = {}; g.nodes.forEach(n => _gadj[n.id] = {});
  g.edges.forEach(e => { (_gadj[e.source] = _gadj[e.source] || {})[e.target] = e.weight; (_gadj[e.target] = _gadj[e.target] || {})[e.source] = e.weight; });
  renderGraphPanels(g);
  setTimeout(() => drawGraph(), 60);          // after layout settles
}

function renderGraphPanels(g) {
  const m = g.model || {};
  $("#graphModel").innerHTML = `<div class="gcard"><h3>✦ Link-prediction model</h3>
    <div class="gbadge">${esc(m.name || "LogisticRegression")} · AUC <b>${m.auc != null ? m.auc : "—"}</b></div>
    <div class="gsub">Trained on graph features: ${(m.features || []).join(", ")}.</div>
    <div class="gstats">${(g.stats || {}).nodes || 0} nodes · ${(g.stats || {}).edges || 0} edges · ${(g.stats || {}).communities || 0} communities · ${(g.stats || {}).docs || 0} docs</div></div>`;
  $("#graphPreds").innerHTML = `<div class="section-label">Connections worth exploring</div>` +
    (g.predictions || []).map(p => `<div class="gpred" data-a="${esc(p.a)}" data-b="${esc(p.b)}">
      <div class="gpred-top"><span>${esc(p.a)} <span class="gx">✕</span> ${esc(p.b)}</span><span class="gscore">${p.score}</span></div>
      <div class="gpred-bar"><span style="width:${Math.round(p.score * 100)}%"></span></div>
      <div class="gpred-why">${esc(p.type_a)} × ${esc(p.type_b)} · structurally supported · ${p.shared} shared neighbours</div></div>`).join("");
  $("#graphEmerging").innerHTML = `<div class="section-label">Emerging (rising mentions)</div><div class="gemerge">` +
    (g.emerging || []).map(e => `<span class="gtrend" data-a="${esc(e.id)}">${esc(e.id)} <b>▲ ${e.slope > 0 ? "+" : ""}${e.slope}</b></span>`).join("") + `</div>`;
  $$("#graphPreds .gpred").forEach(el => el.onclick = () => { _ghi = el.dataset.a; drawGraph(el.dataset.a, el.dataset.b); showNode(el.dataset.a); });
  $$("#graphEmerging .gtrend").forEach(el => el.onclick = () => { _ghi = el.dataset.a; drawGraph(el.dataset.a); showNode(el.dataset.a); });
}

function drawGraph(hiA, hiB) {
  const g = _graph, cv = $("#graphCanvas"), wrap = cv.parentElement;
  const dpr = window.devicePixelRatio || 1, W = wrap.clientWidth, H = 540;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const xs = g.nodes.map(n => n.x), ys = g.nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), pad = 60;
  const sx = v => pad + (v - minX) / (maxX - minX || 1) * (W - 2 * pad);
  const sy = v => pad + (v - minY) / (maxY - minY || 1) * (H - 2 * pad);
    _gpos = {}; g.nodes.forEach(n => { _gpos[n.id] = { x: sx(n.x), y: sy(n.y), r: 4 + Math.sqrt(n.pagerank) * 42, n }; });
  const hi = hiA ? new Set([hiA, hiB].filter(Boolean).concat(hiA ? Object.keys(_gadj[hiA] || {}) : []).concat(hiB ? Object.keys(_gadj[hiB] || {}) : [])) : null;
  const maxW = Math.max(...g.edges.map(e => e.weight), 1);
  // edges
  g.edges.forEach(e => {
    const a = _gpos[e.source], b = _gpos[e.target]; if (!a || !b) return;
    const on = !hi || (hi.has(e.source) && hi.has(e.target)) || (hiA && (e.source === hiA || e.target === hiA)) || (hiB && (e.source === hiB || e.target === hiB));
    const pair = hiA && hiB && ((e.source === hiA && e.target === hiB) || (e.source === hiB && e.target === hiA));
    ctx.strokeStyle = pair ? "rgba(224,82,74,.9)" : on ? `rgba(15,18,22,${0.08 + 0.5 * e.weight / maxW})` : "rgba(15,18,22,.03)";
    ctx.lineWidth = pair ? 2.5 : on ? 0.4 + 2 * e.weight / maxW : 0.4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  });
  // predicted link (dashed red) if two-node highlight but no existing edge
  if (hiA && hiB && !(_gadj[hiA] || {})[hiB]) { const a = _gpos[hiA], b = _gpos[hiB]; ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = "#e0524a"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore(); }
  // nodes
  g.nodes.slice().sort((a, b) => a.pagerank - b.pagerank).forEach(n => {
    const p = _gpos[n.id], on = !hi || hi.has(n.id);
    ctx.globalAlpha = on ? 1 : 0.18;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fillStyle = GCOLOR[n.type] || "#888"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.globalAlpha = 1;
  });
  // labels (top nodes + highlighted)
  ctx.font = "600 11.5px 'IBM Plex Sans',sans-serif"; ctx.fillStyle = "#15171c";
  const byPR = g.nodes.slice().sort((a, b) => b.pagerank - a.pagerank);
  const labelSet = new Set(byPR.slice(0, 11).map(n => n.id)); if (hi) hi.forEach(id => labelSet.add(id));
  labelSet.forEach(id => { const p = _gpos[id]; if (!p) return; if (hi && !hi.has(id)) return; ctx.fillText(id, p.x + p.r + 3, p.y + 4); });
  wireGraphHover();
}

function wireGraphHover() {
  const cv = $("#graphCanvas"), tip = $("#graphTip");
  cv.onmousemove = e => {
    const rect = cv.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let hit = null; for (const id in _gpos) { const p = _gpos[id]; if ((mx - p.x) ** 2 + (my - p.y) ** 2 <= (p.r + 4) ** 2) { hit = id; break; } }
    if (hit) { const n = _gpos[hit].n; tip.style.display = "block"; tip.style.left = (mx + 14) + "px"; tip.style.top = (my + 8) + "px"; tip.innerHTML = `<b>${esc(hit)}</b> · ${esc(n.type)}<br>${n.mentions} mentions · ${n.degree} links · trend ${n.trend > 0 ? "+" : ""}${n.trend}`; cv.style.cursor = "pointer"; }
    else { tip.style.display = "none"; cv.style.cursor = "default"; }
  };
  cv.onmouseleave = () => { tip.style.display = "none"; };
  cv.onclick = e => {
    const rect = cv.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
    for (const id in _gpos) { const p = _gpos[id]; if ((mx - p.x) ** 2 + (my - p.y) ** 2 <= (p.r + 4) ** 2) { _ghi = id; drawGraph(id); showNode(id); return; } }
    _ghi = null; drawGraph();
  };
}

function showNode(id) {
  const n = (_graph.nodes || []).find(x => x.id === id); if (!n) return;
  const nb = Object.entries(_gadj[id] || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  $("#graphNode").className = "";
  $("#graphNode").innerHTML = `<div class="gcard"><h3>${esc(id)} <span class="cat-tag">${esc(n.type)}</span></h3>
    <div class="gstats">${n.mentions} mentions · ${n.degree} connections · PageRank ${n.pagerank} · trend ${n.trend > 0 ? "+" : ""}${n.trend}</div>
    <div class="section-label" style="margin:14px 0 8px">Most connected</div>
    <div class="gchips">${nb.map(([id2, w]) => `<span class="gchip" data-a="${esc(id2)}">${esc(id2)} <b>${w}</b></span>`).join("")}</div></div>`;
  $$("#graphNode .gchip").forEach(el => el.onclick = () => { _ghi = el.dataset.a; drawGraph(el.dataset.a); showNode(el.dataset.a); });
}
window.addEventListener("resize", () => { if ($("#view-graph").classList.contains("active") && _graph) drawGraph(_ghi); });

// ================= Papers & trials browser =================
LOADERS.corpus = () => loadCorpus(true);
const corpus = { kind: "paper", q: "", offset: 0, total: 0, items: [] };

async function loadCorpus(reset) {
  if (reset) { corpus.offset = 0; corpus.items = []; }
  const r = await api(`/api/corpus?kind=${corpus.kind}&q=${encodeURIComponent(corpus.q)}&offset=${corpus.offset}&limit=50`);
  corpus.total = r.total; corpus.items = corpus.items.concat(r.items);
  $("#corpusCount").textContent = `Showing ${corpus.items.length} of ${r.total.toLocaleString()} ${corpus.kind === "paper" ? "papers" : "trials"}`;
  $("#corpusList").innerHTML = corpus.items.map(corpusCard).join("");
  $("#corpusMore").style.display = corpus.items.length < r.total ? "inline-flex" : "none";
}
function corpusCard(x) {
  if (corpus.kind === "paper") return `<div class="cx">
    <div class="cx-title">${esc(x.title)}</div>
    <div class="cx-meta"><a href="https://pubmed.ncbi.nlm.nih.gov/${esc(x.id)}/" target="_blank">PMID ${esc(x.id)}</a>
      <span>${esc(x.year || "")}</span>${x.journal ? `<span class="cx-j">${esc(x.journal)}</span>` : ""}</div>
    ${x.abstract ? `<details class="ev-more"><summary>Abstract</summary><div class="ev-body">${esc(x.abstract)}</div></details>` : ""}</div>`;
  return `<div class="cx">
    <div class="cx-title">${esc(x.title)}</div>
    <div class="cx-meta"><a href="https://clinicaltrials.gov/study/${esc(x.id)}" target="_blank">${esc(x.id)}</a>
      <span class="pill">${esc(x.phase || "—")}</span><span>${esc(x.status || "")}</span>${x.sponsor ? `<span class="cx-j">${esc(x.sponsor)}</span>` : ""}</div>
    <details class="ev-more"><summary>Details</summary><div class="ev-body">
      ${x.interventions ? `<div><span class="hk">Interventions</span>${esc(x.interventions)}</div>` : ""}
      ${(x.primary_outcomes && x.primary_outcomes.length) ? `<div><span class="hk">Primary outcomes</span>${x.primary_outcomes.map(esc).join("; ")}</div>` : ""}
    </div></details></div>`;
}
$$("#corpusSeg button").forEach(b => b.onclick = () => {
  $$("#corpusSeg button").forEach(x => x.classList.remove("active")); b.classList.add("active");
  corpus.kind = b.dataset.k; loadCorpus(true);
});
let _cxT;
$("#corpusSearch").addEventListener("input", e => { clearTimeout(_cxT); corpus.q = e.target.value.trim(); _cxT = setTimeout(() => loadCorpus(true), 250); });
$("#corpusMore").onclick = () => { corpus.offset += 50; loadCorpus(false); };
