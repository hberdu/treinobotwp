'use strict';

// =============================================================
// Treinos — painel
// Stack: Chart.js + GSAP + ScrollTrigger
// =============================================================

const TOKEN = new URLSearchParams(location.search).get("token") || "";

const state = {
  atletas: [],
  treinos: [],
  meta: 5,
  semanasNoAno: 52,
  charts: {},
  filters: { from: null, to: null, preset: "30" },
  athlete: { name: null, range: "90" },
  loadedOnce: false,
};

// ===================== Cores / tema Chart.js =====================
const ACCENT = "#adff2f";
const ACCENT_DEEP = "#88ce02";
const ACCENT_SOFT = "rgba(173, 255, 47, 0.18)";
const SECONDARY = "#4dd0e1";
const PINK = "#ff5fa8";
const TXT = "#9aa1ad";
const TXT_STRONG = "#f2f3f5";
const GRID = "#1f242c";
const SURFACE = "#0d0f12";
const COLORS = [ACCENT, SECONDARY, PINK, "#fde047", "#a78bfa", "#fb923c", "#34d399", "#60a5fa"];

Chart.defaults.font.family = '"Inter", system-ui, -apple-system, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = TXT;
Chart.defaults.borderColor = GRID;
Chart.defaults.animation = { duration: 800, easing: "easeOutQuart" };
Chart.defaults.animations.colors = { duration: 400, easing: "easeOutQuart" };
Chart.defaults.plugins.tooltip.backgroundColor = "#0a0a0a";
Chart.defaults.plugins.tooltip.titleColor = ACCENT;
Chart.defaults.plugins.tooltip.bodyColor = "#f2f3f5";
Chart.defaults.plugins.tooltip.borderColor = "#1f242c";
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.cornerRadius = 10;
Chart.defaults.plugins.tooltip.displayColors = false;
Chart.defaults.plugins.tooltip.titleFont = { weight: "600", size: 12, family: "JetBrains Mono, monospace" };
Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };

// ===================== GSAP =====================
if (window.gsap && window.ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger);
}

// ===================== Helpers =====================
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
function weekLabel(iso) { return "S" + iso.split("-W")[1]; }

function applyPreset(preset) {
  const today = startOfDay(new Date());
  const to = new Date(today); to.setHours(23,59,59,999);
  let from = null;
  if (preset === "7")  { from = new Date(today); from.setDate(from.getDate() - 6); }
  else if (preset === "30") { from = new Date(today); from.setDate(from.getDate() - 29); }
  else if (preset === "90") { from = new Date(today); from.setDate(from.getDate() - 89); }
  else if (preset === "180") { from = new Date(today); from.setDate(from.getDate() - 179); }
  else if (preset === "year") { from = new Date(today.getFullYear(), 0, 1); }
  else return { from: null, to: null };
  return { from, to };
}
function inputDateValue(d) {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtRelative(d) {
  if (!d) return "—";
  const dt = new Date(d).getTime();
  const diff = Math.floor((Date.now() - dt) / 86400000);
  if (diff <= 0) return "hoje";
  if (diff === 1) return "ontem";
  if (diff < 7) return `há ${diff} dias`;
  if (diff < 30) return `há ${Math.floor(diff/7)} sem`;
  return fmtDate(d);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function initials(name) {
  const p = String(name).trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}

// ===================== Fetch =====================
async function loadData() {
  const url = TOKEN ? `/api/dashboard?token=${encodeURIComponent(TOKEN)}` : "/api/dashboard";
  const res = await fetch(url, { headers: TOKEN ? { "x-dashboard-token": TOKEN } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function postTreino(nome) {
  const url = TOKEN ? `/api/treino?token=${encodeURIComponent(TOKEN)}` : "/api/treino";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(TOKEN ? { "x-dashboard-token": TOKEN } : {}) },
    body: JSON.stringify({ nome }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ===================== Chart helper =====================
function upsertChart(canvasId, config) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  state.charts[canvasId] = new Chart(ctx, config);
}

// ===================== KPI counter =====================
function animateCounter(el, target, decimals = 0) {
  if (!window.gsap) { el.textContent = target.toFixed(decimals); return; }
  const obj = { v: Number(el.textContent.replace(/[^\d.-]/g, "")) || 0 };
  gsap.to(obj, {
    v: target,
    duration: 1.1,
    ease: "power2.out",
    onUpdate: () => { el.textContent = obj.v.toFixed(decimals); },
  });
}

// ===================== Reveal animations =====================
let revealInited = false;
function bindReveal(root = document) {
  if (!window.gsap) return;
  const items = root.querySelectorAll(".reveal:not(.is-revealed)");
  items.forEach((el) => {
    el.classList.add("is-revealed");
    gsap.to(el, {
      opacity: 1,
      y: 0,
      duration: .7,
      ease: "power3.out",
      scrollTrigger: revealInited ? {
        trigger: el,
        start: "top 92%",
        toggleActions: "play none none reverse",
      } : undefined,
    });
  });
  revealInited = true;
}

// ===================== OVERVIEW =====================
function getFilteredTreinos() {
  const { from, to } = state.filters;
  return state.treinos.filter((t) => {
    const d = new Date(t.data);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function renderKpis(treinos) {
  animateCounter($("#kpiAtletas"), state.atletas.length);
  animateCounter($("#kpiTreinos"), treinos.length);
  const media = state.atletas.length ? (treinos.length / state.atletas.length) : 0;
  animateCounter($("#kpiMedia"), media, 1);
  const today = startOfDay(new Date());
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const hoje = treinos.filter(t => {
    const d = new Date(t.data); return d >= today && d < tomorrow;
  }).length;
  animateCounter($("#kpiHoje"), hoje);
}

function renderRanking(treinos) {
  const counts = {};
  for (const t of treinos) counts[t.nome] = (counts[t.nome] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => e[1]);

  const grad = (ctx) => {
    const chart = ctx.chart;
    const { ctx: c, chartArea } = chart;
    if (!chartArea) return ACCENT;
    const g = c.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
    g.addColorStop(0, ACCENT_DEEP);
    g.addColorStop(1, ACCENT);
    return g;
  };

  upsertChart("chartRanking", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: grad,
        hoverBackgroundColor: SECONDARY,
        borderRadius: 5,
        barThickness: 14,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900, easing: "easeOutQuart", delay: (ctx) => (ctx.dataIndex || 0) * 40 },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TXT, precision: 0 }, grid: { color: GRID, drawBorder: false } },
        y: { ticks: { color: TXT_STRONG, font: { size: 12, weight: "500" } }, grid: { display: false, drawBorder: false } },
      },
    },
  });
}

function renderSemanal(treinos) {
  const semanasSet = new Set();
  const totals = {};
  for (const t of treinos) {
    const w = isoWeek(new Date(t.data));
    semanasSet.add(w);
    totals[w] = (totals[w] || 0) + 1;
  }
  const semanas = Array.from(semanasSet).sort();

  const grad = (ctx) => {
    const { ctx: c, chartArea } = ctx.chart;
    if (!chartArea) return ACCENT_SOFT;
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, "rgba(173, 255, 47, 0.45)");
    g.addColorStop(1, "rgba(173, 255, 47, 0)");
    return g;
  };

  upsertChart("chartSemanal", {
    type: "line",
    data: {
      labels: semanas.map(weekLabel),
      datasets: [{
        label: "Treinos",
        data: semanas.map(w => totals[w] || 0),
        borderColor: ACCENT,
        backgroundColor: grad,
        tension: 0.4,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: ACCENT,
        pointBorderColor: "#0a0a0a",
        pointBorderWidth: 2,
        borderWidth: 2.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TXT }, grid: { display: false, drawBorder: false } },
        y: { beginAtZero: true, ticks: { color: TXT, precision: 0 }, grid: { color: GRID, drawBorder: false } },
      },
    },
  });
}

function renderDiaSemana(treinos) {
  const labels = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  const counts = [0,0,0,0,0,0,0];
  for (const t of treinos) counts[new Date(t.data).getDay()]++;

  upsertChart("chartDiaSemana", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: ACCENT,
        hoverBackgroundColor: SECONDARY,
        borderRadius: 6,
        barThickness: 26,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: "easeOutQuart", delay: (ctx) => (ctx.dataIndex || 0) * 50 },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TXT, font: { weight: "500" } }, grid: { display: false, drawBorder: false } },
        y: { beginAtZero: true, ticks: { color: TXT, precision: 0 }, grid: { color: GRID, drawBorder: false } },
      },
    },
  });
}

function renderProgresso() {
  // ranking pela razão progresso/meta
  const atletas = [...state.atletas]
    .sort((a, b) => (b.progresso / b.meta) - (a.progresso / a.meta))
    .slice(0, 15);
  const labels = atletas.map(a => a.nome);
  const progresso = atletas.map(a => a.progresso);
  const restante = atletas.map(a => Math.max(0, a.meta - a.progresso));

  const colorPorAtleta = atletas.map(a => a.progresso >= a.meta ? "#4ade80" : ACCENT);

  upsertChart("chartProgresso", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Concluído", data: progresso, backgroundColor: colorPorAtleta, borderRadius: 5, stack: "p", barThickness: 12 },
        { label: "Falta", data: restante, backgroundColor: "#1f242c", borderRadius: 0, stack: "p", barThickness: 12 },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: "easeOutQuart" },
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: true, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x}` } },
      },
      scales: {
        x: { stacked: true, ticks: { color: TXT, precision: 0 }, grid: { color: GRID, drawBorder: false } },
        y: { stacked: true, ticks: { color: TXT_STRONG, font: { size: 11 } }, grid: { display: false, drawBorder: false } },
      },
    },
  });
}

function renderTable() {
  const tbody = $("#atletasTable tbody");
  tbody.innerHTML = "";
  // Classificação: progressoSemanal desc, desempate por treinos desc
  const ordenados = [...state.atletas].sort((a, b) => {
    if (b.progressoSemanal !== a.progressoSemanal) return b.progressoSemanal - a.progressoSemanal;
    return b.treinos - a.treinos;
  });

  ordenados.forEach((a, i) => {
    const pct = a.meta > 0 ? Math.min(100, Math.round((a.progresso/a.meta)*100)) : 0;
    const medal = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="medal ${medal}">${i+1}</span></td>
      <td><strong>${escapeHtml(a.nome)}</strong></td>
      <td class="num">${a.treinos}</td>
      <td class="num">${a.progresso}</td>
      <td class="num">${a.meta}</td>
      <td class="num">${a.progressoSemanal}/${state.semanasNoAno}</td>
      <td>
        <div class="progress-bar">
          <div class="track"><div class="fill ${pct >= 100 ? "full" : ""}" style="width:0%"></div></div>
          <span class="pct">${pct}%</span>
        </div>
      </td>
      <td><button class="row-action" data-athlete="${escapeHtml(a.nome)}">Ver</button></td>
    `;
    tbody.appendChild(tr);
    // animação de entrada
    if (window.gsap) {
      gsap.from(tr, { opacity: 0, x: -10, duration: .4, delay: Math.min(i * .03, .6), ease: "power2.out" });
      gsap.to(tr.querySelector(".fill"), { width: pct + "%", duration: 1, delay: .2 + Math.min(i * .03, .6), ease: "power2.out" });
    } else {
      tr.querySelector(".fill").style.width = pct + "%";
    }
  });

  tbody.querySelectorAll(".row-action").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      openAthleteView(e.currentTarget.getAttribute("data-athlete"));
    });
  });
}

function refreshOverview() {
  const treinos = getFilteredTreinos();
  renderKpis(treinos);
  renderRanking(treinos);
  renderSemanal(treinos);
  renderDiaSemana(treinos);
  renderProgresso();
  renderTable();
}

// ===================== ATHLETE =====================
function populateAthleteList() {
  const dl = $("#athleteOptions");
  dl.innerHTML = "";
  [...new Set(state.atletas.map(a => a.nome))].sort().forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    dl.appendChild(o);
  });
}

function switchTab(view) {
  $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("is-active", v.id === `view-${view}`));
  if (window.gsap) {
    const active = $(`#view-${view}`);
    gsap.fromTo(active, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .45, ease: "power2.out" });
  }
}

function openAthleteView(name) {
  switchTab("athlete");
  $("#athleteSearch").value = name;
  state.athlete.name = name;
  renderAthlete();
}

function getAthleteTreinos() {
  if (!state.athlete.name) return [];
  const { from } = applyPreset(state.athlete.range);
  return state.treinos
    .filter(t => t.nome === state.athlete.name)
    .filter(t => !from || new Date(t.data) >= from);
}

function computeStreak(treinosTodos) {
  const dias = new Set(treinosTodos.map(t => inputDateValue(startOfDay(new Date(t.data)))));
  const today = startOfDay(new Date());
  let streak = 0;
  let cursor = new Date(today);
  if (!dias.has(inputDateValue(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (dias.has(inputDateValue(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderAthlete() {
  const name = state.athlete.name;
  if (!name || !state.atletas.find(a => a.nome === name)) {
    $("#athleteContent").hidden = true;
    $("#athleteEmpty").style.display = "flex";
    return;
  }
  $("#athleteEmpty").style.display = "none";
  $("#athleteContent").hidden = false;

  const meta = state.atletas.find(a => a.nome === name);
  const todos = state.treinos.filter(t => t.nome === name);
  const periodo = getAthleteTreinos();

  $("#athleteAvatar").textContent = initials(name);
  $("#athleteName").textContent = name;

  // rank pela classificação (progressoSemanal desc)
  const ordenados = [...state.atletas].sort((a, b) => {
    if (b.progressoSemanal !== a.progressoSemanal) return b.progressoSemanal - a.progressoSemanal;
    return b.treinos - a.treinos;
  });
  const rank = ordenados.findIndex(a => a.nome === name) + 1;
  $("#athleteRank").textContent = `#${rank} no ranking · ${meta.treinos} treinos no total · meta ${meta.meta}/semana`;

  const pct = meta.meta > 0 ? Math.min(100, Math.round((meta.progresso/meta.meta)*100)) : 0;
  $("#athleteRingPct").textContent = pct + "%";
  const ring = $("#athleteRingFg");
  const C = 2 * Math.PI * 52;
  ring.style.strokeDasharray = C;
  ring.style.stroke = pct >= 100 ? "#4ade80" : ACCENT;
  if (window.gsap) {
    gsap.to(ring, { strokeDashoffset: C * (1 - pct/100), duration: 1.2, ease: "power2.out" });
  } else {
    ring.style.strokeDashoffset = C * (1 - pct/100);
  }

  animateCounter($("#aKpiTotal"), meta.treinos);
  animateCounter($("#aKpiPeriodo"), periodo.length);
  animateCounter($("#aKpiStreak"), computeStreak(todos));
  const ultimo = todos.length ? todos[todos.length - 1].data : null;
  $("#aKpiUltimo").textContent = fmtRelative(ultimo);

  renderAthleteSemanal(periodo, meta.meta);
  renderAthleteDiaSemana(periodo);
  renderAthleteMensal(todos);
  renderAthleteHeatmap(todos);
}

function renderAthleteSemanal(treinos, metaSemanal) {
  const semanasSet = new Set();
  const totals = {};
  for (const t of treinos) {
    const w = isoWeek(new Date(t.data));
    semanasSet.add(w);
    totals[w] = (totals[w] || 0) + 1;
  }
  const semanas = Array.from(semanasSet).sort();
  const cores = semanas.map(w => (totals[w] || 0) >= metaSemanal ? "#4ade80" : ACCENT);

  upsertChart("aChartSemanal", {
    type: "bar",
    data: {
      labels: semanas.map(weekLabel),
      datasets: [{
        data: semanas.map(w => totals[w] || 0),
        backgroundColor: cores,
        hoverBackgroundColor: cores.map(c => c === "#4ade80" ? "#22c55e" : SECONDARY),
        borderRadius: 5,
        barThickness: 16,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: "easeOutQuart", delay: (ctx) => (ctx.dataIndex || 0) * 35 },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TXT }, grid: { display: false, drawBorder: false } },
        y: { beginAtZero: true, ticks: { color: TXT, precision: 0 }, grid: { color: GRID, drawBorder: false } },
      },
    },
  });
}

function renderAthleteDiaSemana(treinos) {
  const labels = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  const counts = [0,0,0,0,0,0,0];
  for (const t of treinos) counts[new Date(t.data).getDay()]++;

  upsertChart("aChartDiaSemana", {
    type: "polarArea",
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: COLORS.slice(0, 7).map(c => c + "cc"),
        borderColor: "#0a0a0a",
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900, easing: "easeOutQuart" },
      plugins: {
        legend: { position: "bottom", labels: { color: TXT, boxWidth: 10, padding: 10, font: { size: 11 } } },
      },
      scales: {
        r: { ticks: { display: false, backdropColor: "transparent" }, grid: { color: GRID }, angleLines: { color: GRID } },
      },
    },
  });
}

function renderAthleteMensal(treinos) {
  const buckets = {};
  for (const t of treinos) {
    const d = new Date(t.data);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }
  const keys = Object.keys(buckets).sort();
  const labels = keys.map(k => {
    const [y, m] = k.split("-");
    return new Date(Number(y), Number(m)-1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
  });

  const grad = (ctx) => {
    const { ctx: c, chartArea } = ctx.chart;
    if (!chartArea) return ACCENT_SOFT;
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, "rgba(77, 208, 225, 0.4)");
    g.addColorStop(1, "rgba(77, 208, 225, 0)");
    return g;
  };

  upsertChart("aChartMensal", {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: keys.map(k => buckets[k]),
        borderColor: SECONDARY,
        backgroundColor: grad,
        tension: 0.35,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: SECONDARY,
        pointBorderColor: "#0a0a0a",
        pointBorderWidth: 2,
        borderWidth: 2.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TXT }, grid: { display: false, drawBorder: false } },
        y: { beginAtZero: true, ticks: { color: TXT, precision: 0 }, grid: { color: GRID, drawBorder: false } },
      },
    },
  });
}

function renderAthleteHeatmap(treinos) {
  const container = $("#aHeatmap");
  container.innerHTML = "";
  const WEEKS = 26;
  const today = startOfDay(new Date());
  const end = new Date(today);
  end.setDate(end.getDate() - end.getDay() + 6); // sábado da semana atual
  const start = new Date(end);
  start.setDate(start.getDate() - (WEEKS * 7 - 1));

  const counts = {};
  for (const t of treinos) {
    const d = startOfDay(new Date(t.data));
    if (d < start || d > end) continue;
    counts[inputDateValue(d)] = (counts[inputDateValue(d)] || 0) + 1;
  }

  const cells = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = inputDateValue(d);
    const v = counts[key] || 0;
    const cell = document.createElement("div");
    cell.className = "cell";
    if (v === 1) cell.classList.add("l1");
    else if (v === 2) cell.classList.add("l2");
    else if (v === 3) cell.classList.add("l3");
    else if (v >= 4) cell.classList.add("l4");
    cell.title = `${fmtDate(d)} · ${v} treino${v !== 1 ? "s" : ""}`;
    container.appendChild(cell);
    cells.push(cell);
  }

  if (window.gsap) {
    gsap.from(cells, { scale: 0, opacity: 0, stagger: 0.002, duration: .3, ease: "back.out(2)" });
  }
}

// ===================== Register treino =====================
function showToast(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  toast.style.opacity = "0";
  toast.style.transform = "translateY(20px)";
  if (window.gsap) {
    gsap.to(toast, { opacity: 1, y: 0, duration: .3, ease: "power2.out" });
    gsap.to(toast, { opacity: 0, y: 20, duration: .3, delay: 3.2, ease: "power2.in", onComplete: () => { toast.hidden = true; } });
  } else {
    toast.style.opacity = "1";
    setTimeout(() => { toast.hidden = true; }, 3500);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const input = $("#registerAthlete");
  const value = input.value.trim();
  if (!value) return;

  const match = state.atletas.find(a => a.nome.toLowerCase() === value.toLowerCase());
  if (!match) {
    showFeedback("Atleta não encontrado. Selecione um nome existente.", "error");
    return;
  }

  const btn = $("#registerBtn");
  const label = btn.querySelector(".btn-label");
  const loader = btn.querySelector(".btn-loader");
  btn.disabled = true;
  loader.hidden = false;
  label.textContent = "Registrando...";

  try {
    const result = await postTreino(match.nome);
    showFeedback(`Treino registrado para ${match.nome}.`, "success");
    showToast(`+1 treino · ${match.nome}`, "success");
    input.value = "";
    await fullReload();
  } catch (err) {
    showFeedback(`Falha ao registrar: ${err.message}`, "error");
    showToast("Erro ao registrar", "error");
  } finally {
    btn.disabled = false;
    loader.hidden = true;
    label.textContent = "Registrar treino";
  }
}

function showFeedback(msg, type) {
  const el = $("#registerFeedback");
  el.textContent = msg;
  el.className = `feedback ${type}`;
  el.hidden = false;
  if (window.gsap) {
    gsap.fromTo(el, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: .3, ease: "power2.out" });
  }
}

// ===================== Reload / events =====================
async function fullReload() {
  try {
    $("#refreshBtn").disabled = true;
    const data = await loadData();
    state.atletas = data.atletas || [];
    state.treinos = data.treinos || [];
    state.meta = data.meta || 5;
    state.semanasNoAno = data.semanasNoAno || 52;
    populateAthleteList();
    refreshOverview();
    if (state.athlete.name) renderAthlete();
    $("#lastUpdate").textContent = `${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    if (!state.loadedOnce) {
      state.loadedOnce = true;
      bindReveal();
    }
  } catch (err) {
    console.error(err);
    $("#lastUpdate").textContent = "erro";
  } finally {
    $("#refreshBtn").disabled = false;
  }
}

function bindEvents() {
  $("#refreshBtn").addEventListener("click", fullReload);

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.view));
  });

  $("#rangePreset").addEventListener("change", (e) => {
    state.filters.preset = e.target.value;
    const { from, to } = applyPreset(e.target.value);
    state.filters.from = from;
    state.filters.to = to;
    $("#dateFrom").value = inputDateValue(from);
    $("#dateTo").value = inputDateValue(to);
    refreshOverview();
  });
  $("#dateFrom").addEventListener("change", (e) => {
    state.filters.from = e.target.value ? new Date(e.target.value + "T00:00:00") : null;
    state.filters.preset = "";
    $("#rangePreset").value = "";
    refreshOverview();
  });
  $("#dateTo").addEventListener("change", (e) => {
    state.filters.to = e.target.value ? new Date(e.target.value + "T23:59:59") : null;
    state.filters.preset = "";
    $("#rangePreset").value = "";
    refreshOverview();
  });

  // athlete view search
  const search = $("#athleteSearch");
  search.addEventListener("input", (e) => {
    const v = e.target.value.trim();
    const match =
      state.atletas.find(a => a.nome.toLowerCase() === v.toLowerCase()) ||
      (v.length >= 2 ? state.atletas.find(a => a.nome.toLowerCase().includes(v.toLowerCase())) : null);
    state.athlete.name = match ? match.nome : null;
    renderAthlete();
  });
  search.addEventListener("change", (e) => {
    const v = e.target.value.trim();
    const match = state.atletas.find(a => a.nome.toLowerCase() === v.toLowerCase());
    if (match) { state.athlete.name = match.nome; search.value = match.nome; renderAthlete(); }
  });
  $("#athleteRange").addEventListener("change", (e) => {
    state.athlete.range = e.target.value;
    renderAthlete();
  });

  // registro
  $("#registerForm").addEventListener("submit", handleRegister);
}

// ===================== Init =====================
(function init() {
  bindEvents();
  const { from, to } = applyPreset(state.filters.preset);
  state.filters.from = from;
  state.filters.to = to;
  $("#dateFrom").value = inputDateValue(from);
  $("#dateTo").value = inputDateValue(to);
  fullReload();
  setInterval(fullReload, 5 * 60 * 1000);
})();
