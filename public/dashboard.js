'use strict';

// =============================================================
// Dashboard de Treinos — visão geral + visão por atleta
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
};

// Detecta tema atual pra cores do Chart.js
const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
const TXT = isDark ? "#a1a1aa" : "#71717a";
const TXT_STRONG = isDark ? "#fafafa" : "#18181b";
const GRID = isDark ? "#27272a" : "#f0f0f1";
const ACCENT = isDark ? "#fafafa" : "#18181b";
const ACCENT_SOFT = isDark ? "rgba(250,250,250,.12)" : "rgba(24,24,27,.08)";
const COLORS = [
  "#18181b", "#52525b", "#a1a1aa", "#71717a", "#3f3f46",
  "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c",
  "#ca8a04", "#16a34a", "#059669", "#0891b2", "#9333ea",
];

// Defaults globais Chart.js
Chart.defaults.font.family = '"Inter", system-ui, -apple-system, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = TXT;
Chart.defaults.borderColor = GRID;
Chart.defaults.plugins.tooltip.backgroundColor = isDark ? "#18181b" : "#18181b";
Chart.defaults.plugins.tooltip.titleColor = "#fafafa";
Chart.defaults.plugins.tooltip.bodyColor = "#e4e4e7";
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.displayColors = false;
Chart.defaults.plugins.tooltip.titleFont = { weight: "600", size: 12 };
Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };

// ============== Utils ==============
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

function weekLabel(isoStr) {
  return "S" + isoStr.split("-W")[1];
}

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
  const now = Date.now();
  const dt = new Date(d).getTime();
  const diff = Math.floor((now - dt) / 86400000);
  if (diff <= 0) return "hoje";
  if (diff === 1) return "ontem";
  if (diff < 7) return `há ${diff} dias`;
  if (diff < 30) return `há ${Math.floor(diff/7)} sem`;
  return fmtDate(d);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

// ============== Fetch ==============
async function loadData() {
  const url = TOKEN ? `/api/dashboard?token=${encodeURIComponent(TOKEN)}` : "/api/dashboard";
  const res = await fetch(url, { headers: TOKEN ? { "x-dashboard-token": TOKEN } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ============== Chart helper ==============
function upsertChart(canvasId, config) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  state.charts[canvasId] = new Chart(ctx, config);
}

// ============== OVERVIEW ==============
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
  $("#kpiAtletas").textContent = state.atletas.length;
  $("#kpiTreinos").textContent = treinos.length;
  const media = state.atletas.length ? (treinos.length / state.atletas.length).toFixed(1) : "0";
  $("#kpiMedia").textContent = media;
  const today = startOfDay(new Date());
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const hoje = treinos.filter((t) => {
    const d = new Date(t.data);
    return d >= today && d < tomorrow;
  }).length;
  $("#kpiHoje").textContent = hoje;
}

function renderRanking(treinos) {
  const counts = {};
  for (const t of treinos) counts[t.nome] = (counts[t.nome] || 0) + 1;
  const entries = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 15);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => e[1]);

  upsertChart("chartRanking", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ACCENT,
        hoverBackgroundColor: ACCENT,
        borderRadius: 4,
        barThickness: 14,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TXT, precision: 0 }, grid: { color: GRID, drawBorder: false } },
        y: { ticks: { color: TXT_STRONG, font: { size: 12 } }, grid: { display: false, drawBorder: false } },
      },
    },
  });
}

function renderSemanal(treinos) {
  const semanasSet = new Set();
  const totalPorSemana = {};
  for (const t of treinos) {
    const w = isoWeek(new Date(t.data));
    semanasSet.add(w);
    totalPorSemana[w] = (totalPorSemana[w] || 0) + 1;
  }
  const semanas = Array.from(semanasSet).sort();

  upsertChart("chartSemanal", {
    type: "line",
    data: {
      labels: semanas.map(weekLabel),
      datasets: [{
        label: "Treinos",
        data: semanas.map(w => totalPorSemana[w] || 0),
        borderColor: ACCENT,
        backgroundColor: ACCENT_SOFT,
        tension: 0.35,
        fill: true,
        pointRadius: 3,
        pointBackgroundColor: ACCENT,
        pointBorderColor: isDark ? "#0a0a0a" : "#ffffff",
        pointBorderWidth: 2,
        borderWidth: 2,
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
        borderRadius: 4,
        barThickness: 24,
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

function renderProgresso() {
  const atletas = [...state.atletas]
    .sort((a,b) => (b.progresso/b.meta) - (a.progresso/a.meta))
    .slice(0, 15);
  const labels = atletas.map(a => a.nome);
  const progresso = atletas.map(a => a.progresso);
  const restante = atletas.map(a => Math.max(0, a.meta - a.progresso));

  upsertChart("chartProgresso", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Progresso", data: progresso, backgroundColor: ACCENT, borderRadius: { topLeft: 0, topRight: 4, bottomLeft: 0, bottomRight: 4 }, stack: "p", barThickness: 12 },
        { label: "Restante",  data: restante,  backgroundColor: GRID,   borderRadius: 0, stack: "p", barThickness: 12 },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { displayColors: true } },
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
  const ordenados = [...state.atletas].sort((a,b) => b.treinos - a.treinos);
  ordenados.forEach((a, i) => {
    const pct = a.meta > 0 ? Math.min(100, Math.round((a.progresso/a.meta)*100)) : 0;
    const medalClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="medal ${medalClass}">${i+1}</span></td>
      <td><strong>${escapeHtml(a.nome)}</strong></td>
      <td class="num">${a.treinos}</td>
      <td class="num">${a.progresso}</td>
      <td class="num">${a.meta}</td>
      <td class="num">${a.progressoSemanal}/${state.semanasNoAno}</td>
      <td>
        <div class="progress-bar">
          <div class="track"><div class="fill ${pct >= 100 ? "full" : ""}" style="width:${pct}%"></div></div>
          <span class="pct">${pct}%</span>
        </div>
      </td>
      <td><button class="row-action" data-athlete="${escapeHtml(a.nome)}">Ver</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".row-action").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const name = e.currentTarget.getAttribute("data-athlete");
      openAthleteView(name);
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

// ============== ATHLETE VIEW ==============
function populateAthleteList() {
  const dl = $("#athleteOptions");
  dl.innerHTML = "";
  [...new Set(state.atletas.map(a => a.nome))].sort().forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    dl.appendChild(o);
  });
}

function openAthleteView(name) {
  // troca pra aba "Atleta"
  $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === "athlete"));
  $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === "view-athlete"));
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
  // dias únicos com treino, mais recente primeiro
  const dias = new Set(treinosTodos.map(t => inputDateValue(startOfDay(new Date(t.data)))));
  const today = startOfDay(new Date());
  let streak = 0;
  let cursor = new Date(today);
  // se não treinou hoje, conta a partir de ontem
  if (!dias.has(inputDateValue(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
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
  const todosDoAtleta = state.treinos.filter(t => t.nome === name);
  const treinosPeriodo = getAthleteTreinos();

  // Hero
  $("#athleteAvatar").textContent = initials(name);
  $("#athleteName").textContent = name;
  const ordenados = [...state.atletas].sort((a,b) => b.treinos - a.treinos);
  const rank = ordenados.findIndex(a => a.nome === name) + 1;
  $("#athleteRank").textContent = `#${rank} no ranking · ${meta.treinos} treinos no total`;

  const pct = meta.meta > 0 ? Math.min(100, Math.round((meta.progresso/meta.meta)*100)) : 0;
  $("#athleteRingPct").textContent = pct + "%";
  const ring = $("#athleteRingFg");
  const C = 2 * Math.PI * 52;
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - pct/100);
  ring.style.stroke = pct >= 100 ? "#16a34a" : ACCENT;

  // KPIs
  $("#aKpiTotal").textContent = meta.treinos;
  $("#aKpiPeriodo").textContent = treinosPeriodo.length;
  $("#aKpiStreak").textContent = computeStreak(todosDoAtleta);
  const ultimo = todosDoAtleta.length ? todosDoAtleta[todosDoAtleta.length - 1].data : null;
  $("#aKpiUltimo").textContent = fmtRelative(ultimo);

  renderAthleteSemanal(treinosPeriodo);
  renderAthleteDiaSemana(treinosPeriodo);
  renderAthleteMensal(todosDoAtleta);
  renderAthleteHeatmap(todosDoAtleta);
}

function renderAthleteSemanal(treinos) {
  const semanasSet = new Set();
  const porSemana = {};
  for (const t of treinos) {
    const w = isoWeek(new Date(t.data));
    semanasSet.add(w);
    porSemana[w] = (porSemana[w] || 0) + 1;
  }
  const semanas = Array.from(semanasSet).sort();
  const meta = state.atletas.find(a => a.nome === state.athlete.name)?.meta || state.meta;

  upsertChart("aChartSemanal", {
    type: "bar",
    data: {
      labels: semanas.map(weekLabel),
      datasets: [
        {
          label: "Treinos",
          data: semanas.map(w => porSemana[w] || 0),
          backgroundColor: semanas.map(w => (porSemana[w] || 0) >= meta ? "#16a34a" : ACCENT),
          borderRadius: 4,
          barThickness: 16,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: { annotations: { line: { type: "line", yMin: meta, yMax: meta } } },
      },
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
        backgroundColor: COLORS.slice(0,7).map(c => c + "cc"),
        borderColor: isDark ? "#0a0a0a" : "#ffffff",
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { color: TXT, boxWidth: 10, padding: 12 } } },
      scales: {
        r: {
          ticks: { display: false },
          grid: { color: GRID },
          angleLines: { color: GRID },
        },
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

  upsertChart("aChartMensal", {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: keys.map(k => buckets[k]),
        borderColor: ACCENT,
        backgroundColor: ACCENT_SOFT,
        tension: 0.3,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: ACCENT,
        pointBorderColor: isDark ? "#0a0a0a" : "#ffffff",
        pointBorderWidth: 2,
        borderWidth: 2,
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

  // últimos ~26 semanas (~6 meses)
  const WEEKS = 26;
  const today = startOfDay(new Date());
  // alinhar pra começar num domingo
  const end = new Date(today);
  end.setDate(end.getDate() - end.getDay() + 6); // sábado dessa semana
  const start = new Date(end);
  start.setDate(start.getDate() - (WEEKS * 7 - 1));

  const counts = {};
  for (const t of treinos) {
    const d = startOfDay(new Date(t.data));
    if (d < start || d > end) continue;
    const key = inputDateValue(d);
    counts[key] = (counts[key] || 0) + 1;
  }

  const totalDias = WEEKS * 7;
  for (let i = 0; i < totalDias; i++) {
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
  }
}

// ============== Reload / events ==============
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
  } catch (err) {
    console.error(err);
    $("#lastUpdate").textContent = "Erro ao carregar";
  } finally {
    $("#refreshBtn").disabled = false;
  }
}

function bindEvents() {
  $("#refreshBtn").addEventListener("click", fullReload);

  // tabs
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.view;
      $$(".tab").forEach(t => t.classList.toggle("is-active", t === tab));
      $$(".view").forEach(v => v.classList.toggle("is-active", v.id === `view-${target}`));
    });
  });

  // overview filters
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

  // athlete search
  const search = $("#athleteSearch");
  search.addEventListener("input", (e) => {
    const v = e.target.value.trim();
    const match = state.atletas.find(a =>
      a.nome.toLowerCase() === v.toLowerCase()
    ) || state.atletas.find(a =>
      v.length >= 2 && a.nome.toLowerCase().includes(v.toLowerCase())
    );
    state.athlete.name = match ? match.nome : null;
    renderAthlete();
  });
  search.addEventListener("change", (e) => {
    const v = e.target.value.trim();
    const match = state.atletas.find(a => a.nome.toLowerCase() === v.toLowerCase());
    if (match) {
      state.athlete.name = match.nome;
      search.value = match.nome;
      renderAthlete();
    }
  });

  $("#athleteRange").addEventListener("change", (e) => {
    state.athlete.range = e.target.value;
    renderAthlete();
  });
}

// ============== Init ==============
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
