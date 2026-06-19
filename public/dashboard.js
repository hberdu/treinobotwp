'use strict';

// =============================================================
// treinos · 2026  ·  GSAP-style
// =============================================================
const TOKEN = new URLSearchParams(location.search).get("token") || "";

// ===================== PALETTE =====================
const PALETTE = [
  "#c0ff3e", "#22d3ee", "#f472b6", "#fbbf24", "#a78bfa",
  "#fb923c", "#34d399", "#60a5fa", "#fb7185", "#facc15",
  "#c084fc", "#2dd4bf", "#f87171", "#86efac", "#93c5fd",
  "#fcd34d", "#f9a8d4", "#7dd3fc", "#bef264", "#fda4af",
];

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function colorFor(name) { return PALETTE[hashCode(String(name)) % PALETTE.length]; }
function alpha(hex, a) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0,2), 16);
  const g = parseInt(c.substring(2,4), 16);
  const b = parseInt(c.substring(4,6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ===================== STATE =====================
const state = {
  atletas: [],
  treinos: [],
  meta: 5,
  semanasNoAno: 52,
  charts: {},
  filters: { from: null, to: null, preset: "30" },
  athlete: { name: null, range: "90", color: PALETTE[0] },
  loadedOnce: false,
};

// ===================== CHART.JS DEFAULTS =====================
const TXT = "#9c9ca8";
const TXT_STRONG = "#f4f4f6";
const GRID = "#1c1c24";
Chart.defaults.font.family = '"Inter", system-ui, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = TXT;
Chart.defaults.borderColor = GRID;
Chart.defaults.animation = { duration: 900, easing: "easeOutQuart" };
Chart.defaults.animations.colors = { duration: 400, easing: "easeOutQuart" };
Chart.defaults.plugins.tooltip.backgroundColor = "#060608";
Chart.defaults.plugins.tooltip.titleColor = "#fff";
Chart.defaults.plugins.tooltip.bodyColor = "#f4f4f6";
Chart.defaults.plugins.tooltip.borderColor = "#2a2a35";
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.cornerRadius = 10;
Chart.defaults.plugins.tooltip.displayColors = false;
Chart.defaults.plugins.tooltip.titleFont = { weight: "600", size: 11, family: "JetBrains Mono, monospace" };
Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };

// ===================== GSAP =====================
if (window.gsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

// ===================== UTILS =====================
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2,"0")}`;
}
function weekLabel(iso) { return "S" + iso.split("-W")[1]; }
function weekStartDate(iso) {
  const [y, w] = iso.split("-W").map(Number);
  const simple = new Date(Date.UTC(y, 0, 1 + (w - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  if (dow <= 4) simple.setUTCDate(simple.getUTCDate() - dow + 1);
  else simple.setUTCDate(simple.getUTCDate() + 8 - dow);
  return simple;
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
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
function fmtRange(a, b) {
  const da = new Date(a), db = new Date(b);
  const mesmoMes = da.getMonth() === db.getMonth();
  if (mesmoMes) {
    return `${da.getDate()}–${db.getDate()} ${da.toLocaleDateString("pt-BR", { month: "short" })}`;
  }
  return `${fmtDate(da)} → ${fmtDate(db)}`;
}
function fmtRelative(d) {
  if (!d) return "—";
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (diff <= 0) return "hoje";
  if (diff === 1) return "ontem";
  if (diff < 7) return `há ${diff}d`;
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

// ===================== FETCH =====================
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

// ===================== CHART HELPER =====================
function upsertChart(id, config) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(ctx, config);
}

// ===================== COUNTERS =====================
function animateCounter(el, target, decimals = 0) {
  if (!window.gsap) { el.textContent = target.toFixed(decimals); return; }
  const obj = { v: Number(el.textContent.replace(/[^\d.-]/g, "")) || 0 };
  gsap.to(obj, {
    v: target, duration: 1.1, ease: "power2.out",
    onUpdate: () => { el.textContent = obj.v.toFixed(decimals); },
  });
}

// ===================== SPLIT TEXT (chars stagger) =====================
function splitChars(el) {
  if (el.dataset.split === "done") return;
  $$(".line", el).forEach((line) => {
    const text = line.textContent;
    line.textContent = "";
    const wrap = document.createElement("span");
    wrap.className = "wrap-inline";
    [...text].forEach((ch) => {
      const span = document.createElement("span");
      span.className = "char";
      span.textContent = ch === " " ? "\u00A0" : ch;
      // preserve highlight if inside hl
      wrap.appendChild(span);
    });
    line.appendChild(wrap);
  });
  el.dataset.split = "done";
}
function animateHeroChars(view) {
  if (!window.gsap) return;
  const titles = view.querySelectorAll(".hero-title");
  titles.forEach((t) => {
    splitChars(t);
    const chars = t.querySelectorAll(".char");
    gsap.fromTo(chars,
      { y: "110%", opacity: 0 },
      { y: "0%", opacity: 1, duration: .9, ease: "expo.out", stagger: .025 }
    );
  });
  const subs = view.querySelectorAll(".hero-meta, .hero-eyebrow, .aside-quote, .aside-tip");
  if (subs.length) gsap.fromTo(subs, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: .6, ease: "power3.out", stagger: .08, delay: .3 });
}

// ===================== CURSOR FOLLOWER =====================
function initCursor() {
  if (!window.gsap || window.matchMedia("(pointer: coarse)").matches) return;
  const cursor = $(".cursor");
  if (!cursor) return;
  const xTo = gsap.quickTo(cursor, "x", { duration: .25, ease: "power3" });
  const yTo = gsap.quickTo(cursor, "y", { duration: .25, ease: "power3" });
  window.addEventListener("mousemove", (e) => { xTo(e.clientX); yTo(e.clientY); });

  // hover state on interactive elements
  const hoverables = "a, button, .tab, .row-action, .field input, .field select, .weeks-list li, .heatmap .cell, .card, .kpi";
  document.body.addEventListener("mouseover", (e) => {
    if (e.target.closest(hoverables)) cursor.classList.add("hover");
  }, true);
  document.body.addEventListener("mouseout", (e) => {
    if (e.target.closest(hoverables)) cursor.classList.remove("hover");
  }, true);
}

// ===================== MAGNETIC BUTTONS =====================
function bindMagnets() {
  if (!window.gsap) return;
  $$("[data-magnet]").forEach((el) => {
    if (el.dataset.magnetBound) return;
    el.dataset.magnetBound = "1";
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2;
      const y = e.clientY - r.top - r.height / 2;
      gsap.to(el, { x: x * 0.25, y: y * 0.25, duration: .35, ease: "power3.out" });
    });
    el.addEventListener("mouseleave", () => {
      gsap.to(el, { x: 0, y: 0, duration: .6, ease: "elastic.out(1, 0.4)" });
    });
  });
}

// ===================== TILT CARDS =====================
function bindTilts() {
  if (!window.gsap) return;
  $$("[data-tilt]").forEach((el) => {
    if (el.dataset.tiltBound) return;
    el.dataset.tiltBound = "1";
    el.style.perspective = "900px";
    const inner = el;
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rx = (py - .5) * -6;
      const ry = (px - .5) * 6;
      gsap.to(inner, { rotateX: rx, rotateY: ry, transformPerspective: 900, duration: .4, ease: "power3.out" });
    });
    el.addEventListener("mouseleave", () => {
      gsap.to(inner, { rotateX: 0, rotateY: 0, duration: .8, ease: "elastic.out(1, 0.4)" });
    });
  });
}

// ===================== MARQUEE =====================
function startMarquee() {
  if (!window.gsap) return;
  const inner = $("#marqueeInner");
  if (!inner) return;
  // duplicate content for seamless loop
  inner.innerHTML = inner.innerHTML + inner.innerHTML;
  const w = inner.scrollWidth / 2;
  gsap.to(inner, { x: -w, duration: 28, ease: "none", repeat: -1 });
}

// ===================== CARD REVEAL ON SCROLL =====================
function revealCardsOnScroll(scope) {
  if (!window.gsap || !window.ScrollTrigger) return;
  const items = (scope || document).querySelectorAll(".card, .kpi");
  items.forEach((el) => {
    if (el.dataset.revealed) return;
    el.dataset.revealed = "1";
    gsap.fromTo(el,
      { opacity: 0, y: 24 },
      {
        opacity: 1, y: 0, duration: .7, ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 92%", once: true },
      }
    );
  });
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

  $("#heroAtletas").textContent = state.atletas.length;
  $("#heroTreinos").textContent = treinos.length;
  const weekStart = startOfDay(new Date());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekly = treinos.filter(t => new Date(t.data) >= weekStart).length;
  $("#heroSemana").textContent = weekly;
}

function renderRanking(treinos) {
  const counts = {};
  for (const t of treinos) counts[t.nome] = (counts[t.nome] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => e[1]);
  const colors = labels.map(colorFor);

  upsertChart("chartRanking", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        hoverBackgroundColor: colors.map(c => alpha(c, 1)),
        borderRadius: 5,
        barThickness: 14,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900, easing: "easeOutQuart", delay: (ctx) => (ctx.dataIndex || 0) * 35 },
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
    if (!chartArea) return "rgba(34, 211, 238, 0.2)";
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, "rgba(34, 211, 238, 0.45)");
    g.addColorStop(.5, "rgba(244, 114, 182, 0.18)");
    g.addColorStop(1, "rgba(34, 211, 238, 0)");
    return g;
  };

  const lineGrad = (ctx) => {
    const { ctx: c, chartArea } = ctx.chart;
    if (!chartArea) return "#22d3ee";
    const g = c.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
    g.addColorStop(0, "#22d3ee");
    g.addColorStop(.5, "#f472b6");
    g.addColorStop(1, "#c0ff3e");
    return g;
  };

  upsertChart("chartSemanal", {
    type: "line",
    data: {
      labels: semanas.map(weekLabel),
      datasets: [{
        data: semanas.map(w => totals[w] || 0),
        borderColor: lineGrad,
        backgroundColor: grad,
        tension: 0.4,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: "#f4f4f6",
        pointBorderColor: "#060608",
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
  // each day with a color
  const colors = ["#fb7185","#fbbf24","#c0ff3e","#34d399","#22d3ee","#a78bfa","#f472b6"];

  upsertChart("chartDiaSemana", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: colors,
        hoverBackgroundColor: colors.map(c => alpha(c, .85)),
        borderRadius: 6,
        barThickness: 26,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 750, easing: "easeOutQuart", delay: (ctx) => (ctx.dataIndex || 0) * 60 },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TXT, font: { weight: "500" } }, grid: { display: false, drawBorder: false } },
        y: { beginAtZero: true, ticks: { color: TXT, precision: 0 }, grid: { color: GRID, drawBorder: false } },
      },
    },
  });
}

function renderProgresso() {
  const atletas = [...state.atletas]
    .sort((a, b) => (b.progresso / b.meta) - (a.progresso / a.meta))
    .slice(0, 15);
  const labels = atletas.map(a => a.nome);
  const progresso = atletas.map(a => a.progresso);
  const restante = atletas.map(a => Math.max(0, a.meta - a.progresso));
  const cores = atletas.map(a => a.progresso >= a.meta ? "#34d399" : colorFor(a.nome));

  upsertChart("chartProgresso", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Concluído", data: progresso, backgroundColor: cores, borderRadius: 5, stack: "p", barThickness: 12 },
        { label: "Falta", data: restante, backgroundColor: "#1c1c24", borderRadius: 0, stack: "p", barThickness: 12 },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
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
  const ordenados = [...state.atletas].sort((a, b) => {
    if (b.progressoSemanal !== a.progressoSemanal) return b.progressoSemanal - a.progressoSemanal;
    return b.treinos - a.treinos;
  });

  ordenados.forEach((a, i) => {
    const pct = a.meta > 0 ? Math.min(100, Math.round((a.progresso/a.meta)*100)) : 0;
    const medal = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
    const col = colorFor(a.nome);
    const tr = document.createElement("tr");
    tr.style.setProperty("--athlete-color", col);
    tr.innerHTML = `
      <td><span class="medal ${medal}">${i+1}</span></td>
      <td>
        <div class="athlete-cell">
          <span class="athlete-swatch"></span>
          <span class="athlete-name">${escapeHtml(a.nome)}</span>
        </div>
      </td>
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
      <td><button class="row-action" data-athlete="${escapeHtml(a.nome)}">→</button></td>
    `;
    tbody.appendChild(tr);
    if (window.gsap) {
      gsap.from(tr, { opacity: 0, x: -10, duration: .4, delay: Math.min(i * .025, .6), ease: "power2.out" });
      gsap.to(tr.querySelector(".fill"), { width: pct + "%", duration: 1, delay: .15 + Math.min(i * .025, .6), ease: "power2.out" });
    } else {
      tr.querySelector(".fill").style.width = pct + "%";
    }
  });

  tbody.querySelectorAll(".row-action").forEach((btn) => {
    btn.addEventListener("click", (e) => openAthleteView(e.currentTarget.getAttribute("data-athlete")));
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

// ===================== ATHLETE VIEW =====================
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
  const active = $(`#view-${view}`);
  if (window.gsap) {
    gsap.fromTo(active, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .45, ease: "power3.out" });
    animateHeroChars(active);
    revealCardsOnScroll(active);
  }
  bindMagnets();
  bindTilts();
}

function openAthleteView(name) {
  switchTab("athlete");
  $("#athleteSearch").value = name;
  state.athlete.name = name;
  renderAthlete();
}

function getAthletePeriodFrom() {
  return applyPreset(state.athlete.range).from;
}

function getAthleteTreinos() {
  if (!state.athlete.name) return [];
  const from = getAthletePeriodFrom();
  return state.treinos
    .filter(t => t.nome === state.athlete.name)
    .filter(t => !from || new Date(t.data) >= from);
}

function computeStreak(all) {
  const dias = new Set(all.map(t => inputDateValue(startOfDay(new Date(t.data)))));
  const today = startOfDay(new Date());
  let streak = 0;
  let cur = new Date(today);
  if (!dias.has(inputDateValue(cur))) cur.setDate(cur.getDate() - 1);
  while (dias.has(inputDateValue(cur))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

function renderAthlete() {
  const name = state.athlete.name;
  const view = $("#view-athlete");
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

  // SET COLOR
  const color = colorFor(name);
  state.athlete.color = color;
  view.style.setProperty("--athlete-color", color);

  // hero
  $("#athleteName").textContent = name;
  const ordenados = [...state.atletas].sort((a, b) => {
    if (b.progressoSemanal !== a.progressoSemanal) return b.progressoSemanal - a.progressoSemanal;
    return b.treinos - a.treinos;
  });
  const rank = ordenados.findIndex(a => a.nome === name) + 1;
  $("#athleteRank").textContent = `#${rank} · meta ${meta.meta}/sem · ${meta.progressoSemanal} semanas cumpridas`;

  const pct = meta.meta > 0 ? Math.min(100, Math.round((meta.progresso/meta.meta)*100)) : 0;
  $("#athleteRingPct").textContent = pct + "%";
  const ring = $("#athleteRingFg");
  const C = 2 * Math.PI * 60;
  ring.style.strokeDasharray = C;
  if (window.gsap) {
    gsap.to(ring, { strokeDashoffset: C * (1 - pct/100), duration: 1.2, ease: "power3.out" });
  } else {
    ring.style.strokeDashoffset = C * (1 - pct/100);
  }

  animateCounter($("#aKpiTotal"), meta.treinos);
  animateCounter($("#aKpiPeriodo"), periodo.length);
  animateCounter($("#aKpiStreak"), computeStreak(todos));
  const ultimo = todos.length ? todos[todos.length - 1].data : null;
  $("#aKpiUltimo").textContent = fmtRelative(ultimo);

  renderAthleteHeatmap(todos);
  renderWeekBreakdown(todos, meta.meta);
  renderAthleteSemanal(periodo, meta.meta, color);
  renderAthleteDiaSemana(periodo, color);
  renderAthleteMensal(todos, color);

  if (window.gsap) {
    gsap.from($(".athlete-hero"), { opacity: 0, y: 30, duration: .8, ease: "power3.out" });
    bindTilts();
  }
}

function renderAthleteHeatmap(treinos) {
  const container = $("#aHeatmap");
  container.innerHTML = "";

  const WEEKS = 26;
  const today = startOfDay(new Date());
  const end = new Date(today);
  end.setDate(end.getDate() - end.getDay() + 6); // sábado
  const start = new Date(end);
  start.setDate(start.getDate() - (WEEKS * 7 - 1));

  const counts = {};
  for (const t of treinos) {
    const d = startOfDay(new Date(t.data));
    if (d < start || d > end) continue;
    counts[inputDateValue(d)] = (counts[inputDateValue(d)] || 0) + 1;
  }

  const totalDias = WEEKS * 7;
  const cells = [];
  let totalTreinos = 0;
  let activeDays = 0;
  const monthMarkers = [];
  let lastMonth = -1;

  for (let i = 0; i < totalDias; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = inputDateValue(d);
    const v = counts[key] || 0;
    if (v > 0) { totalTreinos += v; activeDays++; }

    if (d.getDate() === 1 && d.getMonth() !== lastMonth) {
      monthMarkers.push(d.toLocaleDateString("pt-BR", { month: "short" }));
      lastMonth = d.getMonth();
    }

    const cell = document.createElement("div");
    cell.className = "cell";
    if (v === 1) cell.classList.add("l1");
    else if (v === 2) cell.classList.add("l2");
    else if (v === 3) cell.classList.add("l3");
    else if (v >= 4) cell.classList.add("l4");
    cell.title = `${fmtDate(d)} · ${v} treino${v !== 1 ? "s" : ""}`;
    cell.dataset.week = isoWeek(d);
    container.appendChild(cell);
    cells.push(cell);
  }

  $("#heatmapTotal").textContent = `${totalTreinos} treinos · ${activeDays} dias ativos`;
  $("#hmMonths").textContent = monthMarkers.join("  ·  ");

  if (window.gsap) {
    gsap.from(cells, { scale: 0, opacity: 0, stagger: { each: .003, from: "start" }, duration: .35, ease: "back.out(2)" });
  }
}

function renderWeekBreakdown(allTreinos, metaSem) {
  const ul = $("#weeksList");
  ul.innerHTML = "";

  const WEEKS = 12;
  const today = startOfDay(new Date());
  const ref = new Date(today);
  ref.setDate(ref.getDate() - ref.getDay() + 1); // segunda atual

  const weeks = [];
  for (let i = 0; i < WEEKS; i++) {
    const monday = new Date(ref);
    monday.setDate(monday.getDate() - i * 7);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const iso = isoWeek(monday);
    const count = allTreinos.filter(t => {
      const d = new Date(t.data);
      return d >= monday && d < new Date(sunday.getTime() + 86400000);
    }).length;
    weeks.push({ iso, monday, sunday, count, label: weekLabel(iso) });
  }

  weeks.forEach((w, idx) => {
    const li = document.createElement("li");
    const pct = metaSem > 0 ? Math.min(100, Math.round((w.count / metaSem) * 100)) : 0;
    const isFull = w.count >= metaSem;
    li.innerHTML = `
      <span class="w-label">${w.label}<br><small>${fmtRange(w.monday, w.sunday)}</small></span>
      <div class="w-bar"><i class="${isFull ? "full" : ""}" data-pct="${pct}"></i></div>
      <span class="w-count">${w.count}<span class="w-meta">/${metaSem}</span></span>
    `;
    li.dataset.week = w.iso;
    ul.appendChild(li);

    if (window.gsap) {
      gsap.from(li, { opacity: 0, y: 12, duration: .4, delay: idx * .04, ease: "power2.out" });
      gsap.to(li.querySelector(".w-bar > i"), { width: pct + "%", duration: .9, delay: .25 + idx * .04, ease: "power2.out" });
    } else {
      li.querySelector(".w-bar > i").style.width = pct + "%";
    }

    li.addEventListener("mouseenter", () => {
      $$(`#aHeatmap .cell[data-week="${w.iso}"]`).forEach((c) => {
        c.classList.add("is-active");
        if (window.gsap) gsap.fromTo(c, { scale: 1 }, { scale: 1.35, duration: .25, ease: "power2.out" });
      });
    });
    li.addEventListener("mouseleave", () => {
      $$(`#aHeatmap .cell[data-week="${w.iso}"]`).forEach((c) => {
        c.classList.remove("is-active");
        if (window.gsap) gsap.to(c, { scale: 1, duration: .3, ease: "power2.out" });
      });
    });
  });
}

function renderAthleteSemanal(treinos, metaSemanal, color) {
  const semanasSet = new Set();
  const totals = {};
  for (const t of treinos) {
    const w = isoWeek(new Date(t.data));
    semanasSet.add(w);
    totals[w] = (totals[w] || 0) + 1;
  }
  const semanas = Array.from(semanasSet).sort();
  const cores = semanas.map(w => (totals[w] || 0) >= metaSemanal ? "#34d399" : color);

  upsertChart("aChartSemanal", {
    type: "bar",
    data: {
      labels: semanas.map(weekLabel),
      datasets: [{
        data: semanas.map(w => totals[w] || 0),
        backgroundColor: cores,
        hoverBackgroundColor: cores.map(c => alpha(c, .8)),
        borderRadius: 5,
        barThickness: 16,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: "easeOutQuart", delay: (ctx) => (ctx.dataIndex || 0) * 30 },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TXT }, grid: { display: false, drawBorder: false } },
        y: { beginAtZero: true, ticks: { color: TXT, precision: 0 }, grid: { color: GRID, drawBorder: false } },
      },
    },
  });
}

function renderAthleteDiaSemana(treinos, color) {
  const labels = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  const counts = [0,0,0,0,0,0,0];
  for (const t of treinos) counts[new Date(t.data).getDay()]++;

  upsertChart("aChartDiaSemana", {
    type: "polarArea",
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: counts.map((_, i) => alpha(color, 0.35 + (i % 4) * 0.15)),
        borderColor: "#060608",
        borderWidth: 2,
        hoverOffset: 10,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: TXT, boxWidth: 10, padding: 10, font: { size: 11 } } },
      },
      scales: {
        r: { ticks: { display: false, backdropColor: "transparent" }, grid: { color: GRID }, angleLines: { color: GRID } },
      },
    },
  });
}

function renderAthleteMensal(treinos, color) {
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
    if (!chartArea) return alpha(color, .3);
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, alpha(color, .45));
    g.addColorStop(1, alpha(color, 0));
    return g;
  };

  upsertChart("aChartMensal", {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: keys.map(k => buckets[k]),
        borderColor: color,
        backgroundColor: grad,
        tension: 0.35,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: color,
        pointBorderColor: "#060608",
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

// ===================== REGISTER =====================
function showToast(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  if (window.gsap) {
    gsap.fromTo(toast, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: .3, ease: "power2.out" });
    gsap.to(toast, { opacity: 0, y: 20, duration: .3, delay: 3.2, ease: "power2.in", onComplete: () => { toast.hidden = true; } });
  } else {
    setTimeout(() => { toast.hidden = true; }, 3500);
  }
}

function showFeedback(msg, type) {
  const el = $("#registerFeedback");
  el.textContent = msg;
  el.className = `feedback ${type}`;
  el.hidden = false;
  if (window.gsap) gsap.fromTo(el, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: .3, ease: "power2.out" });
}

async function handleRegister(e) {
  e.preventDefault();
  const input = $("#registerAthlete");
  const value = input.value.trim();
  if (!value) return;
  const match = state.atletas.find(a => a.nome.toLowerCase() === value.toLowerCase());
  if (!match) {
    showFeedback("→ atleta não encontrado.", "error");
    return;
  }
  const btn = $("#registerBtn");
  const label = btn.querySelector(".btn-label");
  const loader = btn.querySelector(".btn-loader");
  btn.disabled = true;
  loader.hidden = false;
  label.textContent = "registrando";

  try {
    await postTreino(match.nome);
    showFeedback(`✓ +1 treino registrado para ${match.nome}.`, "success");
    showToast(`+1 · ${match.nome}`, "success");
    input.value = "";
    await fullReload();
  } catch (err) {
    showFeedback(`× falha: ${err.message}`, "error");
    showToast("erro ao registrar", "error");
  } finally {
    btn.disabled = false;
    loader.hidden = true;
    label.textContent = "+1 treino";
  }
}

// ===================== RELOAD / EVENTS =====================
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
      animateHeroChars($("#view-overview"));
      revealCardsOnScroll(document);
      bindMagnets();
      bindTilts();
    }
  } catch (err) {
    console.error(err);
    $("#lastUpdate").textContent = "erro";
  } finally {
    $("#refreshBtn").disabled = false;
  }
}

function bindEvents() {
  $("#refreshBtn").addEventListener("click", () => {
    if (window.gsap) gsap.to("#refreshBtn svg", { rotate: 360, duration: .7, ease: "power2.out", onComplete: () => gsap.set("#refreshBtn svg", { rotate: 0 }) });
    fullReload();
  });

  $$(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.view)));

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

  $("#registerForm").addEventListener("submit", handleRegister);
}

// ===================== INIT =====================
(function init() {
  initCursor();
  startMarquee();
  bindEvents();
  const { from, to } = applyPreset(state.filters.preset);
  state.filters.from = from;
  state.filters.to = to;
  $("#dateFrom").value = inputDateValue(from);
  $("#dateTo").value = inputDateValue(to);
  fullReload();
  setInterval(fullReload, 5 * 60 * 1000);
})();
