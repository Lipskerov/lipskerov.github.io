/* BenchPilot static backend — reimplements the /api/* routes fully client-side so the
   app runs on GitHub Pages with no server. Data ships as JSON; edits persist to localStorage.
   Intercepts window.fetch for /api/* (and photo upload); everything else passes through. */
(function () {
  "use strict";
  const LS = "benchpilot_state_v3";
  const D = { papers: [], trials: [], inventory: [], members: [], projects: [], tasks: [] };
  let BM = null;

  // ---------------- boot ----------------
  const READY = (async () => {
    const [papers, trials, inventory, team] = await Promise.all(
      ["data/papers.json", "data/trials.json", "data/inventory.json", "data/team.json"].map(u => fetch(u).then(r => r.json())));
    D.papers = papers; D.trials = trials;
    const saved = localStorage.getItem(LS);
    if (saved) { const s = JSON.parse(saved); D.inventory = s.inventory; D.members = s.members; D.projects = s.projects; D.tasks = s.tasks; }
    else { D.inventory = inventory; D.members = team.members; D.projects = team.projects; D.tasks = team.tasks; save(); }
    BM = buildBM25(D.papers, D.trials);
  })();
  const save = () => localStorage.setItem(LS, JSON.stringify({ inventory: D.inventory, members: D.members, projects: D.projects, tasks: D.tasks }));

  // ---------------- BM25 retrieval ----------------
  const STOP = new Set("the a an and or of in to for with on is are be as by from that this we our study results using used effects effect showed shown role".split(" "));
  const tok = s => (s || "").toLowerCase().match(/[a-z0-9\-]+/g)?.filter(t => !STOP.has(t) && t.length > 1) || [];
  function buildBM25(papers, trials) {
    const docs = [];
    papers.forEach(p => docs.push({ kind: "paper", meta: { kind: "paper", id: p.id, title: p.title, year: p.year, journal: p.journal, abstract: p.abstract }, toks: tok(p.title + " " + p.abstract) }));
    trials.forEach(t => docs.push({ kind: "trial", meta: { kind: "trial", id: t.id, title: t.title, phase: t.phase, status: t.status, sponsor: t.sponsor, interventions: t.interventions, primary_outcomes: t.primary_outcomes }, toks: tok(t.title + " " + t.interventions + " " + t.conditions) }));
    const N = docs.length, df = {};
    docs.forEach(d => new Set(d.toks).forEach(t => df[t] = (df[t] || 0) + 1));
    const idf = {}; for (const t in df) idf[t] = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
    const avgdl = docs.reduce((a, d) => a + d.toks.length, 0) / Math.max(N, 1);
    return { docs, idf, avgdl, k1: 1.5, b: 0.75 };
  }
  function search(q, k, kind) {
    const qt = tok(q), out = [];
    for (const d of BM.docs) {
      if (kind && d.kind !== kind) continue;
      if (!d.toks.length) continue;
      const tf = {}; d.toks.forEach(t => tf[t] = (tf[t] || 0) + 1);
      const dl = d.toks.length; let sc = 0;
      for (const t of qt) { if (!tf[t]) continue; const f = tf[t], idf = BM.idf[t] || 0; sc += idf * (f * (BM.k1 + 1)) / (f + BM.k1 * (1 - BM.b + BM.b * dl / BM.avgdl)); }
      if (sc > 0) out.push([sc, d.meta]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.slice(0, k).map(([sc, m]) => ({ ...m, score: Math.round(sc * 1000) / 1000 }));
  }

  // ---------------- reasoning ----------------
  const TARGETS = {
    "PARP/BRCA (HR deficiency)": { type: "DNA-repair / synthetic lethality", assay: "parp", aliases: ["parp", "parp1", "brca", "brca1", "brca2", "olaparib", "talazoparib", "niraparib", "rucaparib", "veliparib", "homologous recombination", "hrd", "brcaness"] },
    "TROP2 (ADC target)": { type: "Antibody-drug conjugate target", assay: "viability", aliases: ["trop2", "trop-2", "sacituzumab", "govitecan", "datopotamab", "dato-dxd", "adc"] },
    "PD-L1 / PD-1 (immune checkpoint)": { type: "Immune checkpoint", assay: "apoptosis", aliases: ["pd-l1", "pdl1", "pd-1", "pd1", "pembrolizumab", "atezolizumab", "durvalumab", "nivolumab", "checkpoint", "immunotherapy"] },
    "PI3K / AKT / PTEN": { type: "PI3K signaling", assay: "western", aliases: ["pi3k", "akt", "pten", "pik3ca", "ipatasertib", "capivasertib", "alpelisib"] },
    "ATR / CHK1 / WEE1 (DDR)": { type: "DNA-damage response / cell cycle", assay: "if", aliases: ["atr", "chk1", "wee1", "ceralasertib", "adavosertib", "replication stress"] },
    "AR (androgen receptor)": { type: "Nuclear receptor (LAR subtype)", assay: "qpcr", aliases: ["androgen receptor", "ar-positive", "enzalutamide", "bicalutamide", "lar subtype"] },
    "EGFR": { type: "Receptor tyrosine kinase", assay: "western", aliases: ["egfr", "cetuximab", "erlotinib", "gefitinib"] },
    "CDK4/6": { type: "Cell-cycle kinase", assay: "viability", aliases: ["cdk4", "cdk6", "cdk4/6", "palbociclib", "ribociclib", "abemaciclib"] },
    "VEGF / angiogenesis": { type: "Angiogenesis", assay: "viability", aliases: ["vegf", "angiogenesis", "bevacizumab"] },
  };
  const DET = {
    "PARP/BRCA (HR deficiency)": { drug: "Olaparib", combo: "Cisplatin", marker: "γH2AX foci", ab: "Anti-gamma-H2AX", cells: ["HCC1937 (BRCA1-mutant)", "MDA-MB-231 (BRCA-wt)", "MCF-10A (normal)"], assay: "viability", mech: "PARP trapping at DNA lesions and replication-fork collapse" },
    "TROP2 (ADC target)": { drug: "Sacituzumab govitecan", combo: null, marker: "TROP2 surface expression", ab: "Anti-PARP1 antibody", cells: ["MDA-MB-468 (TROP2-high)", "MDA-MB-231", "MCF-10A (normal)"], assay: "viability", mech: "TROP2-directed payload delivery and topoisomerase-I inhibition" },
    "PD-L1 / PD-1 (immune checkpoint)": { drug: "Anti-PD-L1 antibody", combo: "Paclitaxel", marker: "PD-L1 expression", ab: "Anti-PD-L1 antibody", cells: ["MDA-MB-231", "MDA-MB-468", "MCF-10A (normal)"], assay: "apoptosis", mech: "relief of PD-1/PD-L1-mediated T-cell suppression" },
    "ATR / CHK1 / WEE1 (DDR)": { drug: "Olaparib", combo: "Cisplatin", marker: "γH2AX / replication stress", ab: "Anti-gamma-H2AX", cells: ["MDA-MB-231", "MDA-MB-468", "MCF-10A (normal)"], assay: "if", mech: "abrogation of the S/G2 checkpoint under replication stress" },
  };
  const GEN = { drug: "a targeted inhibitor", combo: null, marker: "pathway markers", ab: "Anti-GAPDH (loading control)", cells: ["MDA-MB-231", "MDA-MB-468", "MCF-10A (normal)"], assay: "viability", mech: "modulation of the target pathway" };
  const REAG = {
    viability: ["RPMI-1640 medium", "Fetal Bovine Serum (FBS)", "96-well plate, clear flat", "MTT reagent", "DMSO", "Filter tips 200 uL"],
    western: ["Pierce BCA Protein Assay Kit", "Acrylamide/Bis 30%", "Goat anti-Rabbit HRP", "SuperSignal West Pico ECL", "Anti-GAPDH (loading control)"],
    if: ["Paraformaldehyde 16%", "Triton X-100", "DAPI", "24-well plate, TC-treated", "Bovine Serum Albumin (BSA)"],
    apoptosis: ["Annexin V-FITC Apoptosis Kit", "Propidium Iodide", "6-well plate, TC-treated"],
    qpcr: ["RNeasy Mini Kit", "High-Capacity cDNA RT Kit", "PowerUp SYBR Green Master Mix", "96-well qPCR plate"],
    analysis: [],
  };
  const textOf = d => (d.kind === "trial" || d.interventions !== undefined) ? (d.title + " " + (d.interventions || "")).toLowerCase() : (d.title + " " + (d.abstract || "")).toLowerCase();
  function extractTargets(question, papers, trials, top = 6) {
    const res = [];
    for (const name in TARGETS) {
      const m = TARGETS[name], re = new RegExp("\\b(" + m.aliases.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b");
      const ph = papers.filter(p => re.test(textOf(p))), th = trials.filter(t => re.test(textOf(t)));
      const n = ph.length + th.length; if (!n) continue;
      const qh = re.test((question || "").toLowerCase());
      res.push({ target: name, type: m.type, assay: m.assay, paper_count: ph.length, trial_count: th.length, score: n + (qh ? 5 : 0), example_pmids: ph.slice(0, 3).map(x => x.id), example_ncts: th.slice(0, 3).map(x => x.id) });
    }
    res.sort((a, b) => b.score - a.score); return res.slice(0, top);
  }
  function synth(question, papers, trials) {
    const parts = [];
    if (papers.length) { parts.push(`The retrieved literature centers on ${(papers[0].title || "").replace(/\.$/, "")} (PMID ${papers[0].id})`); if (papers.length > 1) parts.push(`and related work such as ${(papers[1].title || "").replace(/\.$/, "")} (PMID ${papers[1].id})`); }
    if (trials.length) { const ph = [...new Set(trials.map(t => t.phase).filter(Boolean))]; parts.push(`. In the clinic, ${trials.length} matching trials (e.g., ${trials[0].id}, ${trials[0].phase || ""}) are evaluating related interventions${ph.length ? " across " + ph.join(", ") : ""}`); }
    const s = parts.length ? (parts.join(" ").replace(/ \./g, ".") + ".") : "No strongly matching evidence was retrieved for this question.";
    return { synthesis: s, engine: "offline" };
  }
  function evNote(papers, trials) { const p = papers.length ? `PMID ${papers[0].id}` : "the literature"; return `Grounded in ${p} and ${papers.length} related papers; ${trials.length} matching trials indicate clinical momentum, motivating mechanistic follow-up.`; }
  function pdl1Hyps(note, cells) {
    return [
      { id: "H1", engine: "offline", confidence: "medium", plain: "Chemo + immunotherapy together should help more patients respond than chemo alone.", statement: "Adding immunotherapy (a PD-L1 checkpoint blocker) to standard chemotherapy improves treatment response in triple-negative breast cancer by helping the immune system attack tumor cells that chemotherapy has exposed.", mechanism: "Chemotherapy stresses tumor cells and exposes them to the immune system; blocking the PD-L1 'brake' then lets immune cells recognise and kill the cancer.", prediction: "The chemo + immunotherapy combination kills notably more tumor cells (≥30% greater response) than either treatment alone, and the benefit is largest in PD-L1-high tumors.", rationale: note, falsification: "If the combination works no better than chemotherapy alone, the hypothesis is wrong.", novelty: "Which patients benefit most — and how PD-L1 level predicts it — is still unclear.", key_readouts: ["Tumor-cell killing", "PD-L1 level", "Immune activation"], model_systems: cells },
      { id: "H2", engine: "offline", confidence: "medium", plain: "Tumors with more of the PD-L1 'brake' should respond better to immunotherapy.", statement: "PD-L1 level on tumor cells predicts which triple-negative breast cancers respond to immunotherapy, and can be used to select patients most likely to benefit.", mechanism: "Higher PD-L1 means the tumor is relying more on the immune 'brake', so releasing it helps more.", prediction: "PD-L1-high tumor models show a clearly stronger response to the PD-L1 blocker (correlation |r| ≥ 0.6).", rationale: note, falsification: "If response is unrelated to PD-L1 level, PD-L1 is not a useful selection marker.", novelty: "A simple, measurable marker to pick the right patients would change practice.", key_readouts: ["PD-L1 level", "Tumor-cell killing"], model_systems: cells },
      { id: "H3", engine: "offline", confidence: "low", plain: "Immunotherapy on its own may only help a subset of tumors.", statement: "Immunotherapy alone (PD-L1 blockade without chemotherapy) reduces tumor-cell survival only in a subset of triple-negative breast cancers.", mechanism: "Without chemotherapy to expose the tumor, the immune system may not recognise most tumors.", prediction: "PD-L1 blocker alone reduces survival in ≤1 of 3 models, fewer than the combination.", rationale: note, falsification: "Broad single-agent activity across all models would refute the 'subset-only' claim.", novelty: "Clarifies when immunotherapy needs a chemotherapy partner.", key_readouts: ["Tumor-cell killing"], model_systems: cells },
    ];
  }
  function hypotheses(target, question, papers, trials) {
    const det = DET[target] || GEN, note = evNote(papers, trials), cells = det.cells, drug = det.drug, combo = det.combo;
    if (target.startsWith("PD-L1")) return pdl1Hyps(note, cells);
    const H = [
      { id: "H1", engine: "offline", confidence: "medium", statement: `Pharmacological inhibition of ${target} with ${drug} reduces TNBC cell viability in a dose-dependent manner, with greatest sensitivity in ${cells[0]}.`, mechanism: `${drug} acts through ${det.mech}.`, prediction: `${drug} lowers viability ≥30% at clinically relevant doses in sensitive lines, with a ≥3-fold IC50 shift versus ${cells[cells.length - 1]}.`, rationale: note, falsification: "A flat dose–response (no IC50 reached, <10% viability change) would refute it.", novelty: "Direct, quantitative sensitivity comparison across defined TNBC backgrounds is under-reported.", key_readouts: ["Cell viability / IC50", "Apoptosis"], model_systems: cells },
      { id: "H2", engine: "offline", confidence: "medium", statement: combo ? `Combining ${drug} with ${combo} produces synthetic-lethal synergy in TNBC beyond either agent alone.` : `Acquired resistance to ${drug} in TNBC is driven by adaptive rewiring of the ${target} pathway.`, mechanism: combo ? `${combo} increases the DNA-damage burden that ${drug} converts into lethal lesions.` : `Compensatory signaling restores survival despite ${target} inhibition.`, prediction: combo ? "Combination index <0.7 (Chou–Talalay) with ≥2-fold IC50 reduction versus monotherapy." : "Resistant sub-lines show ≥2-fold higher IC50 and altered pathway-marker levels.", rationale: note, falsification: combo ? "An additive/antagonistic index (CI ≥1) would refute synergy." : "No IC50 shift in derived sub-lines would refute the resistance model.", novelty: "Mechanistic dissection in the BRCA-wildtype / HR-proficient setting remains a gap.", key_readouts: ["Combination index", "Cell viability", det.marker], model_systems: cells.slice(0, 2) },
      { id: "H3", engine: "offline", confidence: "low", statement: `${det.marker} is a predictive biomarker of ${drug} response and stratifies TNBC lines by sensitivity.`, mechanism: `Baseline ${det.marker} reflects dependence on the ${target} axis.`, prediction: `Baseline ${det.marker} correlates with ${drug} IC50 across lines (|r| ≥ 0.6).`, rationale: note, falsification: "No correlation between marker level and IC50 would refute the biomarker claim.", novelty: "Links a measurable baseline marker to a functional drug-response readout.", key_readouts: [det.marker, "IC50"], model_systems: cells },
    ];
    H[0].plain = `In plain terms: blocking ${target.split(" ")[0]} with ${drug} should slow tumor growth.`;
    H[1].plain = combo ? "In plain terms: two drugs together may work better than one." : "In plain terms: tumors may adapt and resist the drug over time.";
    H[2].plain = `In plain terms: measuring ${det.marker} up front may predict who responds.`;
    return H;
  }
  const wp = (i, title, aim, stage, assay, cells, readouts, reagents, dur, deps, design) => { const w = { id: "WP" + i, title, aim, stage, assay_type: assay, model_systems: cells, readouts, reagents, duration_weeks: dur, depends_on: deps }; if (design) w.design = design; return w; };
  const design = (cells, groups, controls, readout, reps = 3) => ({ cell_lines: cells, groups, replicates: reps, controls, readout });
  function schedule(wps) { const by = {}; wps.forEach(w => by[w.id] = w); for (let k = 0; k <= wps.length; k++) wps.forEach(w => { let st = 0; (w.depends_on || []).forEach(d => { if (by[d] && by[d].end_week != null) st = Math.max(st, by[d].end_week); }); w.start_week = st; w.end_week = st + Math.max(1, w.duration_weeks || 2); }); const total = wps.reduce((a, w) => Math.max(a, w.end_week), 0); return { work_packages: wps, total_weeks: total, engine: "offline" }; }
  function plan(hyp, target) {
    const stmt = ((hyp && hyp.statement) || "").toLowerCase(), det = DET[target] || GEN, drug = det.drug, combo = det.combo, cells = det.cells, ab = det.ab, assay = det.assay, norm = cells[cells.length - 1];
    const descriptive = (/express|biomarker|predict/.test(stmt)) && !/inhibit|reduce|synerg|resist|lethal/.test(stmt);
    let wps;
    if (descriptive) {
      wps = [wp(1, `Characterize ${det.marker} across TNBC lines`, `Measure baseline ${det.marker} and correlate with ${drug} response.`, "experiment", "western", cells, [det.marker, "IC50"], REAG.western.concat([ab]), 3, [], design(cells, ["Baseline (untreated)"], ["GAPDH loading control", norm], "Marker vs response")),
        wp(2, "Analysis & correlation", "Correlate marker with response; evaluate the hypothesis.", "analysis", "analysis", [], ["Correlation (r)", "Figures"], [], 1, ["WP1"])];
    } else {
      const dose = ["Vehicle (DMSO)", `${drug} low`, `${drug} mid`, `${drug} high`];
      wps = [
        wp(1, `Western blot — baseline ${det.marker.split(" ")[0]} / target expression`, `Quantify ${target} / marker protein levels across TNBC lines by Western blot to stratify models.`, "experiment", "western", cells, ["Target/marker band intensity", "GAPDH loading control"], REAG.western.concat([ab]), 2, [], design(cells, ["Baseline (untreated)"], ["GAPDH loading control", `${norm} normal line`], "Band intensity normalised to GAPDH")),
        wp(2, `${drug} dose-response (${assay})`, `Primary test: establish ${drug} sensitivity / IC50 across lines with a dose series.`, "experiment", assay, cells, ["Cell viability / IC50"], REAG[assay].concat([drug]), 3, ["WP1"], design(cells, dose, ["Vehicle (DMSO)", `${norm} normal line`, "Untreated"], "IC50 per line (5-point dose series)")),
        wp(3, `IF microscopy — ${det.marker} localisation`, `Confirm on-pathway effect by immunofluorescence (${det.marker}, green) vs DAPI (blue).`, "experiment", "if", cells.slice(0, 2), [det.marker, "Apoptosis"], REAG.if.concat([ab]), 3, ["WP1"], design(cells.slice(0, 2), ["Vehicle", `${drug}-treated`], ["Secondary-antibody only (no primary)", "DAPI only"], "Marker localisation per nucleus")),
      ];
      if (combo) wps.push(wp(4, `${drug} + ${combo} combination`, `Test whether ${combo} potentiates ${drug} (synergy / combination index).`, "experiment", "viability", cells.slice(0, 2), ["Combination index", "Viability"], REAG.viability.concat([drug, combo]), 3, ["WP2"], design(cells.slice(0, 2), ["Vehicle (DMSO)", drug, combo, `${drug} + ${combo}`], ["Vehicle (DMSO)", "Single agents"], "Combination index (Chou–Talalay)")));
      const dep = ["WP2", "WP3"].concat(combo ? ["WP4"] : []);
      wps.push(wp(wps.length + 1, "Analysis & synthesis", "Integrate results, run statistics, and evaluate the hypothesis.", "analysis", "analysis", [], ["Statistics", "Figures", "Go/no-go"], [], 1, dep));
    }
    return schedule(wps);
  }

  // ---------------- protocols ----------------
  const PROTO = {
    parp: { title: "PARP-inhibitor viability assay in TNBC cells", objective: "Determine the dose-response of a PARP inhibitor on TNBC cell viability.", estimated_duration: "5 days", steps: ["Seed 5,000 TNBC cells per well in a 96-well plate; incubate 24 h.", "Prepare olaparib serial dilutions in DMSO; treat wells in triplicate.", "Incubate 72 h at 37 °C, 5% CO2.", "Add MTT reagent; solubilize formazan in DMSO.", "Read absorbance at 570 nm and compute IC50."], materials: [["Olaparib", "chemical", 10, "mg"], ["MDA-MB-231 cell line", "biological", 1, "vials"], ["RPMI-1640 medium", "chemical", 100, "mL"], ["Fetal Bovine Serum (FBS)", "chemical", 50, "mL"], ["96-well plate, clear flat", "plastic", 1, "case"], ["MTT reagent", "chemical", 50, "mg"], ["DMSO", "chemical", 20, "mL"], ["Filter tips 200 uL", "plastic", 2, "rack"]] },
    qpcr: { title: "qPCR gene-expression assay in TNBC cells", objective: "Quantify target mRNA expression relative to GAPDH in treated vs control cells.", estimated_duration: "2 days", steps: ["Extract total RNA with the RNeasy Mini Kit.", "Reverse-transcribe 1 µg RNA.", "Set up SYBR Green qPCR with target and GAPDH primers.", "Run 40 cycles; analyze with 2^-ddCt."], materials: [["RNeasy Mini Kit", "biological", 1, "preps"], ["High-Capacity cDNA RT Kit", "biological", 50, "rxns"], ["PowerUp SYBR Green Master Mix", "biological", 200, "rxns"], ["PARP1 qPCR primers (F/R)", "biological", 5, "nmol"], ["GAPDH qPCR primers (F/R)", "biological", 5, "nmol"], ["96-well qPCR plate", "plastic", 1, "case"], ["Filter tips 10 uL", "plastic", 2, "rack"]] },
    western: { title: "Western blot for DNA-damage / apoptosis markers", objective: "Assess PARP and cleaved-caspase-3 protein levels after treatment.", estimated_duration: "2 days", steps: ["Lyse cells; quantify protein with BCA.", "Run SDS-PAGE; transfer to membrane.", "Block in BSA; probe with primary antibodies.", "Detect with HRP secondary + ECL; normalize to GAPDH."], materials: [["Pierce BCA Protein Assay Kit", "biological", 1, "assays"], ["Acrylamide/Bis 30%", "chemical", 50, "mL"], ["Anti-PARP1 antibody", "biological", 50, "uL"], ["Anti-cleaved Caspase-3", "biological", 50, "uL"], ["Goat anti-Rabbit HRP", "biological", 20, "uL"], ["Anti-GAPDH (loading control)", "biological", 20, "uL"], ["SuperSignal West Pico ECL", "biological", 10, "mL"], ["Bovine Serum Albumin (BSA)", "chemical", 25, "g"]] },
    apoptosis: { title: "Annexin V / PI apoptosis assay by flow cytometry", objective: "Quantify apoptotic and necrotic fractions after drug treatment.", estimated_duration: "3 days", steps: ["Treat cells in 6-well plates for 48 h.", "Harvest, wash, resuspend in binding buffer.", "Stain with Annexin V-FITC and PI.", "Acquire on flow cytometer; gate populations."], materials: [["Annexin V-FITC Apoptosis Kit", "biological", 20, "tests"], ["Propidium Iodide", "chemical", 5, "mg"], ["Cisplatin", "chemical", 10, "mg"], ["6-well plate, TC-treated", "plastic", 1, "case"], ["MDA-MB-468 cell line", "biological", 1, "vials"]] },
    if: { title: "Immunofluorescence of γH2AX DNA-damage foci", objective: "Visualize DNA double-strand-break foci after treatment.", estimated_duration: "2 days", steps: ["Seed cells on coverslips in 24-well plates.", "Fix with PFA; permeabilize with Triton X-100.", "Block in BSA; stain with primary + fluorescent secondary; counterstain DAPI.", "Image and count foci per nucleus."], materials: [["Paraformaldehyde 16%", "chemical", 20, "mL"], ["Triton X-100", "chemical", 5, "mL"], ["Anti-gamma-H2AX", "biological", 50, "uL"], ["DAPI", "chemical", 5, "mg"], ["24-well plate, TC-treated", "plastic", 1, "case"], ["Bovine Serum Albumin (BSA)", "chemical", 25, "g"]] },
  };
  function suggestProtocol(text) {
    const t = (text || "").toLowerCase(); let key = "parp";
    if (/qpcr|rt-pcr|expression|mrna|transcript/.test(t)) key = "qpcr";
    else if (/western|protein|blot|immunoblot/.test(t)) key = "western";
    else if (/apopto|annexin|flow cyto|cell death/.test(t)) key = "apoptosis";
    else if (/immunofluor|microscop|foci|h2ax|staining| if /.test(t)) key = "if";
    const p = PROTO[key];
    return { title: p.title, objective: p.objective, estimated_duration: p.estimated_duration, steps: p.steps, engine: "offline", query: text, materials: p.materials.map(m => ({ name: m[0], category: m[1], quantity: m[2], unit: m[3] })) };
  }

  // ---------------- inventory ----------------
  const today = () => new Date().toISOString().slice(0, 10);
  const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const PREFIX = { chemical: "CHEM", biological: "BIOL", plastic: "PLAS" };
  function invList(cat, srch) {
    let r = D.inventory.slice();
    if (cat && cat !== "all") r = r.filter(i => i.category === cat);
    if (srch) { const q = srch.toLowerCase(); r = r.filter(i => ((i.name || "") + (i.vendor || "") + (i.catalog_number || "") + (i.subtype || "")).toLowerCase().includes(q)); }
    return r.sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));
  }
  const invLow = () => D.inventory.filter(i => (i.quantity || 0) <= (i.reorder_threshold || 0));
  const invExpired = () => D.inventory.filter(i => i.expiration && i.expiration < today());
  const invStats = () => ({ total: D.inventory.length, low: invLow().length, expired: invExpired().length });
  function invNextId(cat) { const pre = PREFIX[cat] || "ITEM"; const nums = D.inventory.filter(i => (i.id || "").startsWith(pre + "-")).map(i => parseInt(i.id.split("-").pop())).filter(n => !isNaN(n)); return `${pre}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0")}`; }
  function invAdd(it) { it = { ...it }; if (!it.id) it.id = invNextId(it.category || "chemical"); it.last_updated = today(); D.inventory.push(it); save(); return it.id; }
  function invUpdate(id, f) { const i = D.inventory.find(x => x.id === id); if (i) { Object.assign(i, f); i.last_updated = today(); save(); } }
  function invDelete(id) { D.inventory = D.inventory.filter(x => x.id !== id); save(); }
  function bestMatch(req, items) {
    for (const key of ["cas", "catalog_number"]) { const v = String(req[key] || "").trim().toLowerCase(); if (v && !["", "n/a", "none"].includes(v)) { const hit = items.find(it => String(it[key] || "").trim().toLowerCase() === v); if (hit) return hit; } }
    const rn = norm(req.name); if (!rn) return null;
    let hit = items.find(it => norm(it.name) === rn); if (hit) return hit;
    hit = items.find(it => { const nn = norm(it.name); return nn.includes(rn) || rn.includes(nn); }); if (hit) return hit;
    // token-overlap fuzzy
    const rt = new Set(rn.split(" ")); let best = null, bestS = 0;
    for (const it of items) { const nt = norm(it.name).split(" "); const ov = nt.filter(t => rt.has(t)).length; const s = ov / Math.max(rt.size, nt.length); if (s > bestS) { bestS = s; best = it; } }
    return bestS >= 0.5 ? best : null;
  }
  function checkProtocol(materials) {
    const items = D.inventory, td = today(), rows = [];
    for (const req of materials) {
      const m = bestMatch(req, items), rq = req.quantity, ru = req.unit || "";
      let status, inStock, unit, row;
      if (!m) { status = "MISSING"; inStock = 0; unit = ru; row = { matched_id: null, matched_name: null, vendor: null, catalog_number: null }; }
      else { inStock = m.quantity || 0; unit = m.unit || ru; const reorder = m.reorder_threshold || 0, exp = m.expiration || "", sameU = String(ru).toLowerCase() === String(unit).toLowerCase() && rq != null; if (inStock <= 0) status = "MISSING"; else if (exp && exp < td) status = "EXPIRED"; else if (inStock <= reorder || (sameU && inStock < rq)) status = "LOW"; else status = "AVAILABLE"; row = { matched_id: m.id, matched_name: m.name, vendor: m.vendor, catalog_number: m.catalog_number }; }
      let sug = null; if (["MISSING", "LOW", "EXPIRED"].includes(status)) { const reorder = (m && m.reorder_threshold) || 0, base = Math.max(rq || 0, reorder * 2); sug = Math.round(Math.max(base - (status === "LOW" ? inStock : 0), rq || reorder || 1) * 10) / 10; }
      rows.push({ ...row, required_name: req.name, required_qty: rq, required_unit: ru, category: req.category, in_stock: inStock, unit, status, suggested_order_qty: sug });
    }
    return rows;
  }
  const orderList = rows => { const need = rows.filter(r => ["MISSING", "LOW", "EXPIRED"].includes(r.status)); const ord = { MISSING: 0, LOW: 1, EXPIRED: 2 }; return need.sort((a, b) => (ord[a.status] || 9) - (ord[b.status] || 9)); };

  // ---------------- team ----------------
  const nameOf = id => { const m = D.members.find(x => x.id === id); return m ? m.name : "Unassigned"; };
  const iniOf = id => { const m = D.members.find(x => x.id === id); return m ? m.initials : "—"; };
  const taskRow = t => ({ ...t, reagents: t.reagents || [], attachments: t.attachments || [], design: t.design || null, assignee_name: nameOf(t.assignee), assignee_initials: iniOf(t.assignee) });
  function tasks(pid, asg, status) { let r = D.tasks.filter(t => (!pid || t.project_id === pid) && (!asg || t.assignee === asg) && (!status || t.status === status)); return r.map(taskRow); }
  const getTask = id => { const t = D.tasks.find(x => x.id === id); return t ? taskRow(t) : null; };
  function readiness(t) { const rg = t.reagents || []; if (!rg.length) return { ready: true, missing: [] }; const rows = checkProtocol(rg.map(r => ({ name: r, quantity: 1, unit: "" }))); const miss = rows.filter(r => ["MISSING", "EXPIRED"].includes(r.status)).map(r => r.required_name); return { ready: miss.length === 0, missing: miss }; }
  function workload() { return D.members.map(m => { const ts = tasks(null, m.id); const active = ts.filter(t => ["todo", "in_progress", "blocked"].includes(t.status)); return { ...m, active: active.length, total: ts.length, blocked: ts.filter(t => t.status === "blocked").length }; }); }
  function duplicates(pid) { const ts = tasks(pid).filter(t => t.status !== "done"), byT = {}; ts.forEach(t => (byT[t.target] = byT[t.target] || []).push(t)); const g = []; for (const target in byT) { const arr = byT[target], ppl = new Set(arr.filter(t => t.assignee).map(t => t.assignee)); if (arr.length >= 2 && ppl.size >= 2) g.push({ target, tasks: arr.map(t => ({ id: t.id, title: t.title, assignee_name: t.assignee_name })) }); } return g; }
  function projRow(p) { const ts = tasks(p.id), done = ts.filter(t => t.status === "done").length; return { ...p, members: p.members || [], lead_name: nameOf(p.lead), member_objs: (p.members || []).map(id => D.members.find(m => m.id === id)).filter(Boolean), task_count: ts.length, done_count: done, progress: ts.length ? Math.round(100 * done / ts.length) : 0 }; }
  const projects = () => D.projects.map(projRow);
  const project = id => { const p = D.projects.find(x => x.id === id); return p ? projRow(p) : null; };
  function board(pid) { const b = { todo: [], in_progress: [], blocked: [], done: [] }; tasks(pid).forEach(t => { t.readiness = readiness(t); b[t.status].push(t); }); return b; }
  function pipeline(pid) { const stages = ["discover", "design", "protocol", "experiment", "analysis"], c = {}; stages.forEach(s => c[s] = 0); tasks(pid).forEach(t => c[t.stage] = (c[t.stage] || 0) + 1); return stages.map(s => ({ stage: s, count: c[s] })); }
  function nextTaskId() { const nums = D.tasks.map(t => parseInt((t.id || "").split("-").pop())).filter(n => !isNaN(n)); return "TSK-" + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0"); }
  function addTask(it) { it = { ...it }; it.id = it.id || nextTaskId(); it.status = it.status || "todo"; it.created = today(); it.reagents = it.reagents || []; it.attachments = it.attachments || []; D.tasks.push(it); save(); return it.id; }
  function updateTask(id, f) { const t = D.tasks.find(x => x.id === id); if (t) { Object.assign(t, f); save(); } }
  function deleteTask(id) { D.tasks = D.tasks.filter(x => x.id !== id); save(); }
  function nextProjId() { const nums = D.projects.map(p => parseInt((p.id || "").split("-").pop())).filter(n => !isNaN(n)); return "PRJ-" + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0"); }
  function addProject(name, goal, lead, members) { const id = nextProjId(); D.projects.push({ id, name, goal: goal || "", status: "active", lead: lead || null, members: members || (lead ? [lead] : []), created: today() }); save(); return id; }
  function updateProject(id, f) { const p = D.projects.find(x => x.id === id); if (p) { ["name", "goal", "lead", "status", "members"].forEach(k => { if (k in f) p[k] = f[k]; }); save(); } }
  function standup(pid) {
    const ts = tasks(pid); ts.forEach(t => t.readiness = readiness(t));
    const active = ts.filter(t => t.status !== "done"), blocked = ts.filter(t => t.status === "blocked" || !t.readiness.ready), unassigned = active.filter(t => !t.assignee), readyHigh = active.filter(t => t.priority === "high" && t.readiness.ready && t.status !== "blocked");
    const counts = {}; ["todo", "in_progress", "blocked", "done"].forEach(s => counts[s] = ts.filter(t => t.status === s).length);
    const blockers = blocked.map(t => ({ id: t.id, title: t.title, assignee: t.assignee_name, reason: t.readiness.missing.length ? "out of stock: " + t.readiness.missing.join(", ") : "flagged blocked" }));
    const parts = [`${counts.done} done, ${counts.in_progress} in progress, ${counts.todo} to do, ${counts.blocked} blocked.`];
    if (blocked.length) { const b = blocked[0]; parts.push(`Top blocker: '${b.title}' (${b.assignee_name})` + (b.readiness.missing.length ? ` — waiting on ${b.readiness.missing.join(", ")}.` : ".")); }
    if (readyHigh.length) parts.push(`Prioritize '${readyHigh[0].title}' — high priority and all reagents in stock.`);
    if (unassigned.length) parts.push(`${unassigned.length} task(s) still unassigned.`);
    return { narrative: parts.join(" "), counts, blockers, priorities: readyHigh.map(t => ({ id: t.id, title: t.title, assignee: t.assignee_name })), unassigned: unassigned.map(t => ({ id: t.id, title: t.title, priority: t.priority })), duplicates: duplicates(pid).map(g => ({ target: g.target, who: g.tasks.map(x => x.assignee_name), tasks: g.tasks.map(x => x.id) })) };
  }
  function suggest(pid) {
    const wl = {}; workload().forEach(w => wl[w.id] = w); const pool = D.members.filter(m => m.role !== "Principal Investigator");
    return tasks(pid).filter(t => !t.assignee && t.status !== "done").map(t => {
      const tgt = (t.target || "").toLowerCase();
      const best = pool.slice().sort((a, b) => { const fit = m => tgt.replace(/\//g, " ").split(" ").filter(w => w.length > 3 && (m.focus || "").toLowerCase().includes(w)).length; return (fit(b) - fit(a)) || (wl[a.id].active - wl[b.id].active); })[0];
      return { task_id: t.id, title: t.title, target: t.target, suggest: best.name, suggest_id: best.id, why: `${best.focus} · ${wl[best.id].active} active tasks` };
    });
  }

  // ---------------- router ----------------
  async function route(method, path, body, qs) {
    const q = new URLSearchParams(qs || "");
    const parts = path.split("/").filter(Boolean); // e.g. ["api","project","PRJ-01"]
    const seg = parts[1], id = parts[2], sub = parts[3];
    if (path === "/api/stats") { const p = D.papers.length, t = D.trials.length; return { papers: p, trials: t, inventory: invStats(), engine: "offline" }; }
    if (path === "/api/ask") { const k = body.k || 8, papers = search(body.question, Math.max(k, 20), "paper"), trials = search(body.question, Math.max(k, 20), "trial"); const s = synth(body.question, papers, trials); return { synthesis: s.synthesis, engine: "offline", targets: extractTargets(body.question, papers, trials), papers: papers.slice(0, k), trials: trials.slice(0, k) }; }
    if (path === "/api/hypotheses") { const qn = body.question || body.target, papers = search(qn, 25, "paper"), trials = search(qn, 25, "trial"); return hypotheses(body.target, body.question || "", papers, trials); }
    if (path === "/api/plan") return plan(body.hypothesis, body.target);
    if (path === "/api/protocol") { const proto = suggestProtocol(body.experiment); const check = checkProtocol(proto.materials); return { protocol: proto, check, order_list: orderList(check) }; }
    // inventory
    if (seg === "inventory" && !id && method === "GET") return { items: invList(q.get("category"), q.get("search")), stats: invStats() };
    if (seg === "inventory" && !id && method === "POST") return { id: invAdd(body) };
    if (seg === "inventory" && id && method === "GET") { const it = D.inventory.find(x => x.id === id); return it || {}; }
    if (seg === "inventory" && id && method === "PUT") { invUpdate(id, body); return { ok: true }; }
    if (seg === "inventory" && id && method === "DELETE") { invDelete(id); return { ok: true }; }
    // team / projects
    if (path === "/api/team") return { members: workload(), projects: projects(), tasks: tasks(), duplicates: duplicates() };
    if (seg === "projects" && method === "GET") return projects();
    if (seg === "projects" && method === "POST") return { id: addProject(body.name, body.goal, body.lead, body.members) };
    if (seg === "project" && id && method === "GET") { const p = project(id); if (!p) return {}; return { project: p, board: board(id), pipeline: pipeline(id), members: D.members }; }
    if (seg === "project" && id && method === "PUT") { updateProject(id, body); return { ok: true }; }
    if (path === "/api/standup") return standup(q.get("project"));
    if (path === "/api/suggest") return suggest(q.get("project"));
    // tasks
    if (seg === "tasks" && !id && method === "POST") return { id: addTask(body) };
    if (seg === "tasks" && id && sub === "photo" && method === "POST") { const url = await readPhoto(body); const t = D.tasks.find(x => x.id === id); if (t) { t.attachments = (t.attachments || []).concat([url]); save(); } return { attachments: t ? t.attachments : [] }; }
    if (seg === "tasks" && id && method === "GET") { const t = getTask(id); if (!t) return {}; t.readiness = readiness(t); return t; }
    if (seg === "tasks" && id && method === "PATCH") { updateTask(id, body); return { ok: true }; }
    if (seg === "tasks" && id && method === "DELETE") { deleteTask(id); return { ok: true }; }
    return { error: "not found", path };
  }
  function readPhoto(fd) { return new Promise(res => { try { const f = fd.get("file"); const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); } catch (e) { res(""); } }); }

  // ---------------- fetch interception ----------------
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    if (!/\/api\//.test(url)) return _fetch(input, init);
    await READY;
    const u = new URL(url, location.href);
    const path = "/api/" + u.pathname.split("/api/")[1];
    const method = (init && init.method) || "GET";
    let body = null;
    if (init && init.body) { if (init.body instanceof FormData) body = init.body; else { try { body = JSON.parse(init.body); } catch (e) { body = {}; } } }
    const out = await route(method, path, body, u.search.replace(/^\?/, ""));
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  };
})();
