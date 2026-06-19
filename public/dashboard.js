'use strict';

// =============================================================
// Dashboard de Treinos — consome /api/dashboard e renderiza
// gráficos com Chart.js. Funciona em qualquer servidor que sirva
// estes arquivos junto com a API REST.
// =============================================================

const PALETTE = [
  "#38bdf8", "#f59e0b", "#10b981", "#ef4444", "#a855f7",
  "#ec4899", "#22d3ee", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#eab308", "#f43f5e", "#0ea5e9", "#8b5cf6",
];

const TOKEN = new URLSearchParams(location.search).get("token") || "";

const state = {
  atletas: [],
  treinos: [],
  meta: 5,
  semanasNoAno: 52,
  charts: {},
  filters: { atleta: "", from: null, to: null, preset: "30" },
};

// ----------------------- Utils -----------------------
const $ = (sel) => document.querySelector(sel);

function fmtDate(d) {
  return d.toLocaleDateString("pt-BR");
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function applyPreset(preset) {
  const today = startOfDay(new Date());
  const to = new Date(today);
  to.setHours(23, 59, 59, 999);
  let from = null;

  if (preset === "7") {
    from = new Date(today); from.setDate(from.getDate() - 6);
  } else if (preset === "30") {
    from = new Date(today); from.setDate(from.getDate() - 29);
  } else if (preset === "90") {
    from = new Date(today); from.setDate(from.getDate() - 89);
  } else if (preset === "year") {
    from = new Date(today.getFullYear(), 0, 1);
  } else {
    return { from: null, to: null };
  }
  return { from, to };
}

function inputDateValue(d) {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ----------------------- Fetch -----------------------
async function loadData() {
  const url = TOKEN ? `/api/dashboard?token=${encodeURIComponent(TOKEN)}` : "/api/dashboard";
  const res = await fetch(url, { headers: TOKEN ? { "x-dashboard-token": TOKEN } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ----------------------- Filtragem -----------------------
function getFilteredTreinos() {
  const { atleta, from, to } = state.filters;
  return state.treinos.filter((t) => {
    if (atleta && t.nome !== atleta) return false;
    const d = new Date(t.data);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

// ----------------------- Render: KPIs -----------------------
function renderKpis(treinos) {
  const nomes = new Set(treinos.map((t) => t.nome));
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

// ----------------------- Render: Gráfico Ranking -----------------------
function renderRanking(treinos) {
  const counts = {};
  for (const t of treinos) counts[t.nome] = (counts[t.nome] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const labels = entries.map((e) => e[0]);
  const data = entries.map((e) => e[1]);

  upsertChart("chartRanking", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Treinos no período",
        data,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
        y: { ticks: { color: "#e2e8f0" }, grid: { display: false } },
      },
    },
  });
}

// ----------------------- Render: Evolução semanal -----------------------
function renderSemanal(treinos) {
  const atletaSel = state.filters.atleta;
  const atletas = atletaSel
    ? [atletaSel]
    : Array.from(new Set(treinos.map((t) => t.nome))).sort();

  const semanasSet = new Set();
  const porAtleta = {};
  for (const t of treinos) {
    const w = isoWeek(new Date(t.data));
    semanasSet.add(w);
    if (!porAtleta[t.nome]) porAtleta[t.nome] = {};
    porAtleta[t.nome][w] = (porAtleta[t.nome][w] || 0) + 1;
  }
  const semanas = Array.from(semanasSet).sort();

  const datasets = atletas.map((nome, i) => ({
    label: nome,
    data: semanas.map((w) => porAtleta[nome]?.[w] || 0),
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length] + "33",
    tension: 0.3,
    fill: false,
    pointRadius: 3,
  }));

  upsertChart("chartSemanal", {
    type: "line",
    data: { labels: semanas, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#e2e8f0", boxWidth: 12 },
          position: "bottom",
        },
      },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
        y: { beginAtZero: true, ticks: { color: "#94a3b8", precision: 0 }, grid: { color: "#334155" } },
      },
    },
  });
}

// ----------------------- Render: Distribuição por dia da semana -----------------------
function renderDiaSemana(treinos) {
  const labels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const t of treinos) {
    const d = new Date(t.data);
    counts[d.getDay()]++;
  }

  upsertChart("chartDiaSemana", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Treinos",
        data: counts,
        backgroundColor: "#38bdf8",
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: "#94a3b8", precision: 0 }, grid: { color: "#334155" } },
      },
    },
  });
}

// ----------------------- Render: Progresso vs Meta -----------------------
function renderProgresso() {
  const atletas = state.filters.atleta
    ? state.atletas.filter((a) => a.nome === state.filters.atleta)
    : [...state.atletas].sort((a, b) => (b.progresso / b.meta) - (a.progresso / a.meta));

  const labels = atletas.map((a) => a.nome);
  const progresso = atletas.map((a) => a.progresso);
  const restante = atletas.map((a) => Math.max(0, a.meta - a.progresso));

  upsertChart("chartProgresso", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Progresso", data: progresso, backgroundColor: "#10b981", borderRadius: 4, stack: "p" },
        { label: "Restante", data: restante, backgroundColor: "#334155", borderRadius: 4, stack: "p" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#e2e8f0" }, position: "bottom" } },
      scales: {
        x: { stacked: true, ticks: { color: "#94a3b8" }, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { color: "#94a3b8", precision: 0 }, grid: { color: "#334155" } },
      },
    },
  });
}

// ----------------------- Render: Tabela -----------------------
function renderTable() {
  const tbody = $("#atletasTable tbody");
  tbody.innerHTML = "";
  const ordenados = [...state.atletas].sort((a, b) => b.treinos - a.treinos);
  ordenados.forEach((a, i) => {
    const pct = a.meta > 0 ? Math.min(100, Math.round((a.progresso / a.meta) * 100)) : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(a.nome)}</td>
      <td>${a.treinos}</td>
      <td>${a.progresso}</td>
      <td>${a.meta}</td>
      <td>${a.progressoSemanal}/${state.semanasNoAno}</td>
      <td><span class="bar" style="width:${pct}%"></span>${pct}%</td>
    `;
    tbody.appendChild(tr);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// ----------------------- Chart helper -----------------------
function upsertChart(canvasId, config) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (state.charts[canvasId]) {
    state.charts[canvasId].destroy();
  }
  state.charts[canvasId] = new Chart(ctx, config);
}

// ----------------------- Atualização -----------------------
function refreshUI() {
  const treinos = getFilteredTreinos();
  renderKpis(treinos);
  renderRanking(treinos);
  renderSemanal(treinos);
  renderDiaSemana(treinos);
  renderProgresso();
  renderTable();
}

function populateAtletasSelect() {
  const sel = $("#atletaSelect");
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos</option>';
  const nomes = [...new Set(state.atletas.map((a) => a.nome))].sort();
  for (const n of nomes) {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  }
  sel.value = current;
}

async function fullReload() {
  try {
    $("#refreshBtn").disabled = true;
    const data = await loadData();
    state.atletas = data.atletas || [];
    state.treinos = data.treinos || [];
    state.meta = data.meta || 5;
    state.semanasNoAno = data.semanasNoAno || 52;
    populateAtletasSelect();
    refreshUI();
    $("#lastUpdate").textContent = `Atualizado ${new Date().toLocaleTimeString("pt-BR")}`;
  } catch (err) {
    console.error(err);
    $("#lastUpdate").textContent = "Erro ao carregar dados";
  } finally {
    $("#refreshBtn").disabled = false;
  }
}

// ----------------------- Eventos -----------------------
function bindEvents() {
  $("#refreshBtn").addEventListener("click", fullReload);

  $("#atletaSelect").addEventListener("change", (e) => {
    state.filters.atleta = e.target.value;
    refreshUI();
  });

  $("#rangePreset").addEventListener("change", (e) => {
    state.filters.preset = e.target.value;
    const { from, to } = applyPreset(e.target.value);
    state.filters.from = from;
    state.filters.to = to;
    $("#dateFrom").value = inputDateValue(from);
    $("#dateTo").value = inputDateValue(to);
    refreshUI();
  });

  $("#dateFrom").addEventListener("change", (e) => {
    state.filters.from = e.target.value ? new Date(e.target.value + "T00:00:00") : null;
    state.filters.preset = "";
    $("#rangePreset").value = "";
    refreshUI();
  });

  $("#dateTo").addEventListener("change", (e) => {
    state.filters.to = e.target.value ? new Date(e.target.value + "T23:59:59") : null;
    state.filters.preset = "";
    $("#rangePreset").value = "";
    refreshUI();
  });
}

// ----------------------- Init -----------------------
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
