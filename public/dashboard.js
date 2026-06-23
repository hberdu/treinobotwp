'use strict';

// =============================================================
// treinos · 2026  ·  GSAP-style
// =============================================================
const TOKEN_STORAGE_KEY = "treinos:token";
function loadToken() {
  try {
    const fromUrl = new URLSearchParams(location.search).get("token");
    if (fromUrl) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, fromUrl);
      // Remove o token da URL para não vazar em logs/Referer/histórico.
      const url = new URL(location.href);
      url.searchParams.delete("token");
      history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
      return fromUrl;
    }
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch (_) {
    return new URLSearchParams(location.search).get("token") || "";
  }
}
const TOKEN = loadToken();
function authHeaders(extra) {
  const base = TOKEN ? { "x-dashboard-token": TOKEN } : {};
  return extra ? { ...base, ...extra } : base;
}

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
if (window.gsap && window.Flip) gsap.registerPlugin(Flip);

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
  const res = await fetch("/api/dashboard", { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function postTreino(nome) {
  const res = await fetch("/api/treino", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ nome }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ===================== CROSS HIGHLIGHT (chart ↔ table) =====================
let lastHighlight = null;

function pulseSwatch(tr) {
  if (!window.gsap) return;
  const sw = tr.querySelector(".athlete-swatch");
  if (!sw) return;
  gsap.fromTo(sw,
    { scaleY: 1, scaleX: 1 },
    { scaleY: 1.6, scaleX: 1.4, duration: .25, ease: "back.out(2.2)", yoyo: true, repeat: 1 }
  );
}

function highlightAthlete(name, opts = {}) {
  if (lastHighlight === name) return;
  lastHighlight = name;

  $$("#atletasTable tbody tr").forEach((tr) => {
    const isMain = tr.dataset.athleteRow === name;
    const isProgress = tr.dataset.athleteProgress === name;
    if (isMain || isProgress) {
      if (!tr.classList.contains("is-highlighted")) {
        tr.classList.add("is-highlighted");
        try { tr.style.setProperty("--athlete-color", colorFor(name)); } catch (_) {}
        if (isMain) pulseSwatch(tr);
        if (window.gsap && isMain) gsap.fromTo(tr, { x: -6 }, { x: 0, duration: .4, ease: "power3.out" });
      }
    } else {
      tr.classList.remove("is-highlighted");
    }
  });
}

function clearHighlight() {
  lastHighlight = null;
  $$("#atletasTable tbody tr.is-highlighted").forEach((tr) => tr.classList.remove("is-highlighted"));
}

function bindCrossHighlight() {
  // tabela → tabela (pulse no swatch)
  const tbody = $("#atletasTable tbody");
  if (tbody && !tbody.dataset.xhBound) {
    tbody.dataset.xhBound = "1";
    tbody.addEventListener("mouseover", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      const name = tr.dataset.athleteRow || tr.dataset.athleteProgress;
      if (name) highlightAthlete(name);
    });
    tbody.addEventListener("mouseleave", clearHighlight);
  }

  // canvas → tabela (sem mexer no chart, evita update infinito)
  ["chartRanking", "chartProgresso"].forEach((id) => {
    const canvas = document.getElementById(id);
    if (!canvas || canvas.dataset.xhBound) return;
    canvas.dataset.xhBound = "1";

    let lastIdx = -1;
    canvas.addEventListener("mousemove", (evt) => {
      const chart = state.charts[id];
      if (!chart) return;
      const points = chart.getElementsAtEventForMode(evt, "nearest", { intersect: true }, false);
      if (points.length) {
        const idx = points[0].index;
        if (idx === lastIdx) return;
        lastIdx = idx;
        const name = chart.data.labels[idx];
        if (name) highlightAthlete(name);
      } else if (lastIdx !== -1) {
        lastIdx = -1;
        clearHighlight();
      }
    });
    canvas.addEventListener("mouseleave", () => { lastIdx = -1; clearHighlight(); });
  });
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
function splitNodeChars(node) {
  // Substitui text nodes por <span class="char"> mantendo a estrutura
  const chars = [];
  const walk = (n) => {
    Array.from(n.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent;
        const frag = document.createDocumentFragment();
        [...text].forEach((ch) => {
          const span = document.createElement("span");
          span.className = "char";
          span.textContent = ch === " " ? "\u00A0" : ch;
          span.style.display = "inline-block";
          span.style.willChange = "transform, opacity";
          frag.appendChild(span);
          chars.push(span);
        });
        n.replaceChild(frag, child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        // mantém o wrapper (ex: .hl com gradiente) e quebra dentro dele
        walk(child);
      }
    });
  };
  walk(node);
  return chars;
}

function splitChars(el) {
  if (el.dataset.split === "done") return [];
  const allChars = [];
  $$(".line", el).forEach((line) => {
    // garante overflow hidden para o efeito reveal
    line.style.overflow = "hidden";
    line.style.display = "block";
    const chars = splitNodeChars(line);
    allChars.push(...chars);
  });
  el.dataset.split = "done";
  return allChars;
}

function animateHeroChars(view) {
  if (!window.gsap || !view) return;
  const titles = view.querySelectorAll(".hero-title");
  titles.forEach((t) => {
    const lines = $$(".line", t);
    if (!lines.length) return;
    // garante overflow hidden para o efeito reveal
    lines.forEach((l) => {
      l.style.overflow = "hidden";
      l.style.display = "block";
    });
    gsap.killTweensOf(lines);
    gsap.fromTo(lines,
      { yPercent: 110, opacity: 0 },
      {
        yPercent: 0,
        opacity: 1,
        duration: 1.1,
        ease: "expo.out",
        stagger: .12,
      }
    );
  });
  const subs = view.querySelectorAll(".hero-eyebrow, .hero-meta, .hero-sub, .aside-quote, .aside-tip");
  if (subs.length) {
    gsap.killTweensOf(subs);
    gsap.fromTo(subs,
      { y: 16, opacity: 0 },
      { y: 0, opacity: 1, duration: .65, ease: "power3.out", stagger: .08, delay: .3 }
    );
  }
}

// ===================== CURSOR FOLLOWER =====================
// (removido — usando cursor nativo)

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
    el.style.perspective = "1200px";
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rx = (py - .5) * -2.2;
      const ry = (px - .5) * 2.2;
      gsap.to(el, { rotateX: rx, rotateY: ry, transformPerspective: 1200, duration: .55, ease: "power3.out" });
    });
    el.addEventListener("mouseleave", () => {
      gsap.to(el, { rotateX: 0, rotateY: 0, duration: .55, ease: "power3.out" });
    });
  });
}

// ===================== MARQUEE =====================
// (removido)

// ===================== CARD REVEAL ON SCROLL =====================
function revealCardsOnScroll(scope) {
  if (!window.gsap || !window.ScrollTrigger) return;
  const items = Array.from((scope || document).querySelectorAll(".card, .kpi"))
    .filter((el) => !el.dataset.revealed);
  if (!items.length) return;
  items.forEach((el) => { el.dataset.revealed = "1"; });

  gsap.set(items, { opacity: 0, y: 38, scale: .96 });

  ScrollTrigger.batch(items, {
    start: "top 88%",
    once: true,
    onEnter: (batch) => {
      gsap.to(batch, {
        opacity: 1, y: 0, scale: 1,
        duration: .85,
        ease: "power3.out",
        stagger: { each: .08, from: "start" },
        clearProps: "transform",
      });
    },
  });
}

// ===================== HERO PARALLAX =====================
function bindHeroParallax(scope) {
  if (!window.gsap || !window.ScrollTrigger) return;
  const heroes = (scope || document).querySelectorAll(".hero");
  heroes.forEach((hero) => {
    if (hero.dataset.parallaxBound) return;
    hero.dataset.parallaxBound = "1";
    gsap.to(hero, {
      yPercent: 25,
      opacity: .25,
      ease: "none",
      scrollTrigger: {
        trigger: hero,
        start: "top top+=80",
        end: "bottom top+=80",
        scrub: true,
      },
    });
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
  const kAtl = $("#kpiAtletas"); if (kAtl) animateCounter(kAtl, state.atletas.length);
  const kTr  = $("#kpiTreinos");  if (kTr)  animateCounter(kTr, treinos.length);
  const kMed = $("#kpiMedia");
  if (kMed) {
    const media = state.atletas.length ? (treinos.length / state.atletas.length) : 0;
    animateCounter(kMed, media, 1);
  }
  const today = startOfDay(new Date());
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const hoje = treinos.filter(t => {
    const d = new Date(t.data); return d >= today && d < tomorrow;
  }).length;
  const kHj = $("#kpiHoje"); if (kHj) animateCounter(kHj, hoje);

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
  if (!tbody) return;
  tbody.innerHTML = "";
  const ordenados = [...state.atletas].sort((a, b) => {
    if (b.progressoSemanal !== a.progressoSemanal) return b.progressoSemanal - a.progressoSemanal;
    return b.treinos - a.treinos;
  });

  ordenados.forEach((a, i) => {
    const pct = a.meta > 0 ? Math.min(100, Math.round((a.progresso/a.meta)*100)) : 0;
    const medal = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
    const col = colorFor(a.nome);

    // linha principal do atleta
    const tr = document.createElement("tr");
    tr.style.setProperty("--athlete-color", col);
    tr.dataset.athleteRow = a.nome;
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
      <td><button class="row-action" data-athlete="${escapeHtml(a.nome)}">→</button></td>
    `;
    tbody.appendChild(tr);

    // linha de progresso (barra full-width abaixo)
    const prTr = document.createElement("tr");
    prTr.className = "progress-row";
    prTr.dataset.athleteProgress = a.nome;
    prTr.style.setProperty("--athlete-color", col);
    prTr.innerHTML = `
      <td colspan="7">
        <div class="progress-bar">
          <div class="track"><div class="fill ${pct >= 100 ? "full" : ""}" style="width:0%"></div></div>
          <span class="pct">${pct}%</span>
        </div>
      </td>
    `;
    tbody.appendChild(prTr);

    if (window.gsap) {
      gsap.from([tr, prTr], { opacity: 0, x: -10, duration: .4, delay: Math.min(i * .025, .6), ease: "power2.out", stagger: .02 });
      gsap.to(prTr.querySelector(".fill"), { width: pct + "%", duration: 1, delay: .2 + Math.min(i * .025, .6), ease: "power2.out" });
    } else {
      prTr.querySelector(".fill").style.width = pct + "%";
    }
  });

  tbody.querySelectorAll(".row-action").forEach((btn) => {
    btn.addEventListener("click", (e) => openAthleteView(e.currentTarget.getAttribute("data-athlete")));
  });
}

function renderRegisterRanking() {
  const ul = $("#registerRanking");
  if (!ul) return;
  ul.innerHTML = "";
  const ordenados = [...state.atletas].sort((a, b) => {
    if (b.progressoSemanal !== a.progressoSemanal) return b.progressoSemanal - a.progressoSemanal;
    return b.treinos - a.treinos;
  });
  ordenados.forEach((a, i) => {
    const medal = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
    const li = document.createElement("li");
    if (medal) li.classList.add(medal);
    li.style.setProperty("--athlete-color", colorFor(a.nome));
    li.innerHTML = `
      <span class="mr-rank mono">${String(i + 1).padStart(2, "0")}</span>
      <span class="mr-sw"></span>
      <span class="mr-name">${escapeHtml(a.nome)}</span>
      <span class="mr-stat mono"><b>${a.progressoSemanal}</b> \u00b7 ${a.treinos}t</span>
    `;
    ul.appendChild(li);
    if (window.gsap) {
      gsap.from(li, { opacity: 0, x: -8, duration: .35, delay: Math.min(i * .02, .4), ease: "power2.out" });
    }
  });
}

function refreshOverview() {
  const treinos = getFilteredTreinos();
  renderKpis(treinos);
  renderChampions(treinos);
  renderRanking(treinos);
  renderSemanal(treinos);
  renderDiaSemana(treinos);
  renderProgresso();
  renderTable();
  renderRegisterRanking();
  bindCrossHighlight();
}

// ===================== CHAMPIONS CAROUSEL (3D coverflow) =====================
const CHAMPS_STATE = { cards: [], current: 0, autoTimer: null };

function renderChampions() {
  const track = $("#champsRail");
  if (!track) return;
  track.innerHTML = "";
  $("#champsDots").innerHTML = "";

  const ordenados = [...state.atletas].sort((a, b) => {
    if (b.progressoSemanal !== a.progressoSemanal) return b.progressoSemanal - a.progressoSemanal;
    return b.treinos - a.treinos;
  });

  const today = startOfDay(new Date());
  const daysSinceMonday = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(monday.getDate() - daysSinceMonday);

  const treinosBySemana = {};
  for (const t of state.treinos) {
    const d = new Date(t.data);
    if (d >= monday) treinosBySemana[t.nome] = (treinosBySemana[t.nome] || 0) + 1;
  }

  const top = ordenados.slice(0, 8);
  if (top.length === 0) {
    const empty = document.createElement("article");
    empty.className = "champ-card empty";
    empty.textContent = "// sem dados ainda";
    track.appendChild(empty);
    return;
  }

  const maxSemana = Math.max(1, ...top.map(a => a.progressoSemanal || 0));
  const meta = state.meta || 5;

  CHAMPS_STATE.cards = [];
  top.forEach((a, i) => {
    const card = document.createElement("article");
    const col = colorFor(a.nome);
    card.className = "champ-card";
    card.style.setProperty("--champ-color", col);
    const pctBar = Math.min(100, Math.round((a.progressoSemanal / Math.max(maxSemana, 1)) * 100));
    card.innerHTML = `
      <div class="champ-rank">
        <b>${i + 1}</b>
        <span>${i === 0 ? "líder · ★" : "top " + (i + 1)}</span>
      </div>
      <div class="champ-name">${escapeHtml(a.nome)}</div>
      <div class="champ-bar"><i data-pct="${pctBar}"></i></div>
      <div class="champ-metrics">
        <div class="champ-metric">
          <span class="champ-metric-num">${treinosBySemana[a.nome] || 0}</span>
          <span class="champ-metric-label">esta sem.</span>
        </div>
        <div class="champ-metric">
          <span class="champ-metric-num">${a.progressoSemanal}</span>
          <span class="champ-metric-label">sem. ✓</span>
        </div>
        <div class="champ-metric">
          <span class="champ-metric-num">${a.treinos}</span>
          <span class="champ-metric-label">total</span>
        </div>
      </div>
    `;
    card.addEventListener("click", () => {
      const idx = CHAMPS_STATE.cards.indexOf(card);
      if (idx === CHAMPS_STATE.current) {
        openAthleteView(a.nome);
      } else {
        goToChamp(idx);
      }
    });
    track.appendChild(card);
    CHAMPS_STATE.cards.push(card);

    // dot indicator
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.addEventListener("click", () => goToChamp(i));
    $("#champsDots").appendChild(dot);
  });

  CHAMPS_STATE.current = 0;
  layoutChamps();

  // anima bars com delay
  CHAMPS_STATE.cards.forEach((c, i) => {
    const fill = c.querySelector(".champ-bar > i");
    if (fill) {
      const pct = fill.dataset.pct;
      if (window.gsap) gsap.to(fill, { width: pct + "%", duration: 1, delay: .6 + i * .08, ease: "power2.out" });
      else fill.style.width = pct + "%";
    }
  });

  // entrada inicial
  if (window.gsap) {
    gsap.from(CHAMPS_STATE.cards, {
      opacity: 0, y: 40, rotateX: -8, duration: .7,
      stagger: .08, ease: "power3.out",
    });
  }
}

function layoutChamps() {
  const N = CHAMPS_STATE.cards.length;
  if (!N) return;
  const cur = CHAMPS_STATE.current;
  const STEP_X = 180;     // px horizontal por nível
  const STEP_Z = 150;     // px de profundidade por nível
  const STEP_ROT = 22;    // graus por nível

  CHAMPS_STATE.cards.forEach((card, i) => {
    let diff = i - cur;
    // distância mínima circular para suavidade quando passa do limite
    if (diff > N / 2) diff -= N;
    if (diff < -N / 2) diff += N;
    const abs = Math.abs(diff);
    const x = diff * STEP_X;
    const z = -abs * STEP_Z;
    const rotY = -diff * STEP_ROT;
    const opacity = abs > 3 ? 0 : 1 - abs * 0.18;
    const blur = abs > 0 ? Math.min(4, abs * 1.2) : 0;
    const visible = abs <= 4;

    card.classList.toggle("is-center", diff === 0);
    card.style.pointerEvents = visible ? "auto" : "none";
    card.style.zIndex = String(100 - abs);

    if (window.gsap) {
      gsap.to(card, {
        x, z, rotateY: rotY, opacity,
        filter: `blur(${blur}px)`,
        duration: .8,
        ease: "power3.out",
      });
    } else {
      card.style.transform = `translate3d(${x}px, 0, ${z}px) rotateY(${rotY}deg)`;
      card.style.opacity = opacity;
    }
  });

  // dots
  $$("#champsDots .dot").forEach((d, i) => d.classList.toggle("is-active", i === cur));
}

function goToChamp(idx) {
  const N = CHAMPS_STATE.cards.length;
  if (!N) return;
  CHAMPS_STATE.current = ((idx % N) + N) % N;
  layoutChamps();
}

function nextChamp() { goToChamp(CHAMPS_STATE.current + 1); }
function prevChamp() { goToChamp(CHAMPS_STATE.current - 1); }

function scrollChampions(dir) {
  if (dir > 0) nextChamp(); else prevChamp();
}

function bindChampsSwipe() {
  const stage = document.querySelector(".champs-stage");
  if (!stage || stage.dataset.swipeBound) return;
  stage.dataset.swipeBound = "1";

  const SWIPE_DIST = 40;       // px mínimos para considerar swipe
  const SWIPE_VELOCITY = 0.3;  // px/ms para flick rápido
  const AXIS_THRESHOLD = 1.2;  // |dx| precisa ser > |dy| * 1.2
  let pointerId = null;
  let startX = 0, startY = 0, startT = 0;
  let lockedAxis = null; // null | "x" | "y"

  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
    lockedAxis = null;
  }, { passive: true });

  stage.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    if (lockedAxis) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    lockedAxis = Math.abs(dx) > Math.abs(dy) * AXIS_THRESHOLD ? "x" : "y";
    if (lockedAxis === "x") {
      try { stage.setPointerCapture(pointerId); } catch (_) {}
    }
  }, { passive: true });

  const finish = (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dt = performance.now() - startT;
    const releasedId = pointerId;
    pointerId = null;

    if (lockedAxis === "x") {
      try { stage.releasePointerCapture(releasedId); } catch (_) {}
      const velocity = Math.abs(dx) / Math.max(dt, 1);
      if (Math.abs(dx) >= SWIPE_DIST || velocity >= SWIPE_VELOCITY) {
        if (dx < 0) nextChamp(); else prevChamp();
      }
    }
    lockedAxis = null;
  };
  stage.addEventListener("pointerup", finish, { passive: true });
  stage.addEventListener("pointercancel", finish, { passive: true });

  // tap em card lateral leva para ele (mantém UX desktop)
  stage.addEventListener("click", (e) => {
    if (lockedAxis === "x") { e.preventDefault(); e.stopPropagation(); }
  });
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

const TABS_ORDER = ["overview", "register", "athlete"];

function currentView() {
  const el = document.querySelector(".view.is-active");
  return el ? el.id.replace("view-", "") : null;
}

function switchTab(view, opts = {}) {
  const prev = currentView();
  const dir = opts.dir != null ? opts.dir : (() => {
    const a = TABS_ORDER.indexOf(prev);
    const b = TABS_ORDER.indexOf(view);
    if (a < 0 || b < 0) return 0;
    return b > a ? 1 : (b < a ? -1 : 0);
  })();

  const tabs = $(".tabs");
  $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.view === view));
  movePill();
  $$(".view").forEach(v => v.classList.toggle("is-active", v.id === `view-${view}`));
  const active = $(`#view-${view}`);
  if (window.gsap) {
    const xFrom = dir === 0 ? 0 : (dir > 0 ? 40 : -40);
    gsap.fromTo(active,
      { opacity: 0, x: xFrom, y: 12 },
      { opacity: 1, x: 0, y: 0, duration: .5, ease: "power3.out" }
    );
    animateHeroChars(active);
    revealCardsOnScroll(active);
    bindHeroParallax(active);
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  }
  bindMagnets();
  bindTilts();
}

function bindGlobalSwipe() {
  // gesto longo de página troca de view (1↔2↔3)
  const root = document.body;
  if (root.dataset.pageSwipeBound) return;
  root.dataset.pageSwipeBound = "1";

  const SWIPE_DIST = () => Math.max(110, window.innerWidth * 0.22);
  const SWIPE_VELOCITY = 0.55; // px/ms (flick)
  const AXIS_RATIO = 1.6;      // mais exigente que o swipe do carrossel
  const EXEMPT_SELECTOR = [
    ".champs-stage",
    ".heatmap-card", ".heatmap-wrap", ".hm-months",
    ".mini-ranking-scroll",
    ".table-wrap",
    ".radial-menu", ".radial-backdrop",
    "input", "textarea", "select", "button", "a",
  ].join(",");

  let pid = null, sx = 0, sy = 0, st = 0;
  let locked = null;   // null | "x" | "y"
  let blocked = false;

  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return; // só toque/pen
    blocked = !!(e.target && e.target.closest && e.target.closest(EXEMPT_SELECTOR));
    if (blocked) return;
    pid = e.pointerId;
    sx = e.clientX; sy = e.clientY; st = performance.now();
    locked = null;
  }, { passive: true });

  window.addEventListener("pointermove", (e) => {
    if (blocked || e.pointerId !== pid || locked) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
    locked = Math.abs(dx) > Math.abs(dy) * AXIS_RATIO ? "x" : "y";
  }, { passive: true });

  const finish = (e) => {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - sx;
    const dt = performance.now() - st;
    pid = null;
    if (locked !== "x") { locked = null; return; }
    locked = null;

    const v = Math.abs(dx) / Math.max(dt, 1);
    if (Math.abs(dx) < SWIPE_DIST() && v < SWIPE_VELOCITY) return;

    const cur = currentView();
    const i = TABS_ORDER.indexOf(cur);
    if (i < 0) return;
    const targetIdx = dx < 0 ? i + 1 : i - 1;
    if (targetIdx < 0 || targetIdx >= TABS_ORDER.length) return;
    switchTab(TABS_ORDER[targetIdx], { dir: dx < 0 ? 1 : -1 });
  };
  window.addEventListener("pointerup", finish, { passive: true });
  window.addEventListener("pointercancel", finish, { passive: true });
}

function movePill() {
  const tabs = $(".tabs");
  if (!tabs) return;
  const active = tabs.querySelector(".tab.is-active");
  if (!active) return;
  const tabsRect = tabs.getBoundingClientRect();
  const r = active.getBoundingClientRect();
  tabs.style.setProperty("--pill-x", (r.left - tabsRect.left) + "px");
  tabs.style.setProperty("--pill-w", r.width + "px");
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
  const nameEl = $("#athleteName");
  nameEl.textContent = name;
  if (window.gsap) {
    nameEl.style.overflow = "hidden";
    gsap.killTweensOf(nameEl);
    gsap.fromTo(nameEl,
      { yPercent: 110, opacity: 0 },
      { yPercent: 0, opacity: 1, duration: 1, ease: "expo.out" }
    );
  }
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

// ===================== HEATMAP (ano inteiro, estilo GitHub) =====================
const HEATMAP_STATE = { weeks: [] };

function renderAthleteHeatmap(treinos) {
  const container = $("#aHeatmap");
  container.innerHTML = "";
  const tooltip = $("#hmTooltip");

  const today = startOfDay(new Date());
  const year = today.getFullYear();

  // ano inteiro: de 1º de janeiro até 31 de dezembro
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  // alinha início na segunda-feira ≤ 1º de janeiro
  const startDow = yearStart.getDay();
  const daysBackToMonday = (startDow + 6) % 7;
  const start = new Date(yearStart);
  start.setDate(start.getDate() - daysBackToMonday);

  // alinha fim no domingo ≥ 31 de dezembro
  const endDow = yearEnd.getDay();
  const daysForwardToSunday = (7 - endDow) % 7;
  const end = new Date(yearEnd);
  end.setDate(end.getDate() + daysForwardToSunday);

  const totalDays = Math.round((end - start) / 86400000) + 1;
  const totalCols = Math.ceil(totalDays / 7);

  const counts = {};
  for (const t of treinos) {
    const d = startOfDay(new Date(t.data));
    if (d < start || d > end) continue;
    counts[inputDateValue(d)] = (counts[inputDateValue(d)] || 0) + 1;
  }

  const todayKey = inputDateValue(today);
  let totalTreinos = 0, activeDays = 0, longestStreak = 0, curStreak = 0;
  const perWeek = {};
  const perDow = [0, 0, 0, 0, 0, 0, 0];

  HEATMAP_STATE.weeks = [];
  const monthsSpan = [];
  let curMonthIdx = -1;

  const dayLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const cells = [];

  for (let col = 0; col < totalCols; col++) {
    const colMonday = new Date(start);
    colMonday.setDate(colMonday.getDate() + col * 7);

    // label de mês baseada na quinta-feira da semana, contando só meses do ano atual
    const colThursday = new Date(colMonday);
    colThursday.setDate(colThursday.getDate() + 3);
    const thMonthInYear = (colThursday.getFullYear() === year);
    const thMonth = thMonthInYear ? colThursday.getMonth() : -1;
    if (thMonth !== curMonthIdx && thMonthInYear) {
      monthsSpan.push({
        label: colThursday.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        cols: 1,
        startCol: col,
      });
      curMonthIdx = thMonth;
    } else if (monthsSpan.length) {
      monthsSpan[monthsSpan.length - 1].cols++;
    }

    const colEl = document.createElement("div");
    colEl.className = "week-col";
    const isoW = isoWeek(colMonday);
    colEl.dataset.week = isoW;

    const days = [];
    for (let r = 0; r < 7; r++) {
      const d = new Date(colMonday);
      d.setDate(d.getDate() + r);
      const key = inputDateValue(d);
      const v = counts[key] || 0;
      const inYear = (d >= yearStart && d <= yearEnd);

      if (v > 0) {
        totalTreinos += v; activeDays++; curStreak++;
        longestStreak = Math.max(longestStreak, curStreak);
        perWeek[isoW] = (perWeek[isoW] || 0) + v;
        perDow[d.getDay()] += v;
      } else {
        curStreak = 0;
      }

      const cell = document.createElement("div");
      cell.className = "cell";
      if (!inYear) cell.classList.add("is-blank"); // dias fora do ano (padding)
      if (v === 1) cell.classList.add("l1");
      else if (v === 2) cell.classList.add("l2");
      else if (v === 3) cell.classList.add("l3");
      else if (v >= 4) cell.classList.add("l4");
      if (key === todayKey) cell.classList.add("is-today");
      cell.dataset.date = key;
      cell.dataset.count = v;
      cell.dataset.dateLabel = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
      cell.dataset.rel = fmtRelative(d);

      if (inYear) {
        cell.addEventListener("mouseenter", () => {
          tooltip.hidden = false;
          tooltip.querySelector(".hmt-date").textContent = cell.dataset.dateLabel;
          tooltip.querySelector(".hmt-count").innerHTML = v > 0
            ? `${v} <span class="hmt-meta">treino${v !== 1 ? "s" : ""}</span>`
            : `<span class="hmt-meta">sem treino</span>`;
          tooltip.querySelector(".hmt-rel").textContent = cell.dataset.rel;
          const r2 = cell.getBoundingClientRect();
          tooltip.style.left = (r2.left + r2.width / 2) + "px";
          tooltip.style.top = r2.top + "px";
          if (window.gsap) gsap.fromTo(tooltip, { opacity: 0, y: -4 }, { opacity: 1, y: -8, duration: .18, ease: "power2.out" });
        });
        cell.addEventListener("mouseleave", () => {
          if (window.gsap) gsap.to(tooltip, { opacity: 0, duration: .15, onComplete: () => { tooltip.hidden = true; } });
          else tooltip.hidden = true;
        });
      }

      colEl.appendChild(cell);
      days.push({ date: new Date(d), count: v, label: dayLabels[r], isToday: key === todayKey, inYear });
      cells.push(cell);
    }

    HEATMAP_STATE.weeks.push({ iso: isoW, monday: new Date(colMonday), days, el: colEl });
    container.appendChild(colEl);
  }

  // CSS variable com o número de colunas, para o grid distribuir uniformemente
  container.style.setProperty("--week-cols", totalCols);

  // months header com proporção em fr (acompanha o grid do heatmap)
  const monthsEl = $("#hmMonths");
  monthsEl.innerHTML = "";
  monthsSpan.forEach((m) => {
    const s = document.createElement("span");
    s.style.flex = `${m.cols} 0 0`;
    s.style.setProperty("--m-cols", m.cols);
    s.textContent = m.label;
    monthsEl.appendChild(s);
  });

  // stats
  const weeksEntries = Object.entries(perWeek);
  const bestWeek = weeksEntries.length ? weeksEntries.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
  const dayNamesShort = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  const favDowIdx = perDow.indexOf(Math.max(...perDow));
  const favDowCount = perDow[favDowIdx] || 0;
  const weeksInYear = totalCols;

  animateCounter($("#hmTotal"), totalTreinos);
  animateCounter($("#hmActiveDays"), activeDays);
  $("#hmBestWeek").textContent = bestWeek ? "S" + bestWeek[0].split("-W")[1] : "—";
  $("#hmBestWeekCount").textContent = bestWeek ? `${bestWeek[1]} treinos` : "—";
  animateCounter($("#hmLongestStreak"), longestStreak);
  $("#hmFavDay").textContent = favDowCount ? dayNamesShort[favDowIdx] : "—";
  $("#hmFavDayCount").textContent = favDowCount ? `${favDowCount} treinos` : "—";
  $("#hmAvgWeek").textContent = (totalTreinos / weeksInYear).toFixed(1);

  $("#heatmapPeriod").textContent = `Jan → Dez · ${year}`;

  if (window.gsap) {
    gsap.from(cells, { scale: 0, opacity: 0, stagger: { each: .001, from: "start" }, duration: .3, ease: "back.out(2)" });
  }

  bindHeatmapScrollSync();
}

function bindHeatmapScrollSync() {
  const months = document.getElementById("hmMonths");
  const wrap = document.querySelector(".heatmap-card .heatmap-wrap");
  if (!months || !wrap || wrap.dataset.syncBound) return;
  wrap.dataset.syncBound = "1";
  let lock = false;
  const sync = (a, b) => {
    if (lock) return;
    lock = true;
    b.scrollLeft = a.scrollLeft;
    requestAnimationFrame(() => { lock = false; });
  };
  wrap.addEventListener("scroll", () => sync(wrap, months), { passive: true });
  months.addEventListener("scroll", () => sync(months, wrap), { passive: true });
}

function renderWeekBreakdown(allTreinos, metaSem) {
  const ul = $("#weeksList");
  ul.innerHTML = "";

  const WEEKS = 12;
  const today = startOfDay(new Date());
  const ref = new Date(today);
  const daysSinceMonday = (ref.getDay() + 6) % 7;
  ref.setDate(ref.getDate() - daysSinceMonday);

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

  weeks.filter(w => w.count > 0).forEach((w, idx) => {
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
      const col = HEATMAP_STATE.weeks.find(x => x.iso === w.iso);
      if (col) col.el.classList.add("is-active");
    });
    li.addEventListener("mouseleave", () => {
      const col = HEATMAP_STATE.weeks.find(x => x.iso === w.iso);
      if (col) col.el.classList.remove("is-active");
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
  const icon = toast.querySelector(".toast-icon");
  const msg = toast.querySelector(".toast-msg");
  toast.className = `toast ${type}`;
  if (icon) icon.textContent = type === "error" ? "\u00d7" : "\u2713";
  if (msg) msg.textContent = message; else toast.textContent = message;
  toast.hidden = false;
  if (window.gsap) {
    gsap.killTweensOf(toast);
    gsap.fromTo(toast,
      { opacity: 0, x: 40, scale: .96 },
      { opacity: 1, x: 0, scale: 1, duration: .45, ease: "back.out(1.6)" }
    );
    gsap.to(toast, {
      opacity: 0, x: 40, duration: .35, delay: 3.2, ease: "power2.in",
      onComplete: () => {
        toast.hidden = true;
        gsap.set(toast, { clearProps: "all" });
      },
    });
  } else {
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
    showToast("atleta não encontrado", "error");
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
    showToast(`+1 treino registrado · ${match.nome}`, "success");
    input.value = "";
    await fullReload();
  } catch (err) {
    showToast(`falha ao registrar: ${err.message}`, "error");
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
      bindHeroParallax(document);
      bindMagnets();
      bindTilts();
      requestAnimationFrame(movePill);
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

  // champions arrows
  $$(".champ-arrow").forEach((btn) => {
    btn.addEventListener("click", () => scrollChampions(Number(btn.dataset.dir) || 1));
  });

  // setas teclado para navegar carrossel quando focado
  window.addEventListener("keydown", (e) => {
    if (document.activeElement && document.activeElement.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") prevChamp();
    if (e.key === "ArrowRight") nextChamp();
  });

  // mantem pill alinhada em resize + relayout do carrossel
  window.addEventListener("resize", () => {
    requestAnimationFrame(() => {
      movePill();
      layoutChamps();
    });
  });
}

function bindRadialMenu() {
  const menu = document.getElementById("radialMenu");
  const toggle = document.getElementById("radialToggle");
  if (!menu || !toggle) return;

  // backdrop dim por baixo do menu
  let backdrop = document.querySelector(".radial-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "radial-backdrop";
    document.body.appendChild(backdrop);
  }

  const open = () => {
    menu.classList.add("is-open");
    backdrop.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    syncActive();
  };
  const close = () => {
    menu.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  };
  const isOpen = () => menu.classList.contains("is-open");

  const syncActive = () => {
    const activeView = document.querySelector(".view.is-active");
    const current = activeView ? activeView.id.replace("view-", "") : null;
    menu.querySelectorAll(".radial-item[data-view]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.view === current);
    });
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen() ? close() : open();
  });

  menu.querySelectorAll(".radial-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const view = btn.dataset.view;
      const action = btn.dataset.action;
      if (view) {
        if (typeof switchTab === "function") switchTab(view);
      } else if (action === "refresh") {
        const rb = document.getElementById("refreshBtn");
        if (rb) rb.click(); else if (typeof fullReload === "function") fullReload();
      }
      setTimeout(close, 220);
    });
  });

  // fecha clicando fora ou ESC
  document.addEventListener("click", (e) => {
    if (!isOpen()) return;
    if (!menu.contains(e.target)) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });

  // mantém o ativo sincronizado quando as tabs do topbar são clicadas
  document.querySelectorAll(".tabs .tab").forEach((t) => t.addEventListener("click", syncActive));
  syncActive();
}

// ===================== INIT =====================
(function init() {
  bindEvents();
  bindRadialMenu();
  bindChampsSwipe();
  bindGlobalSwipe();
  const { from, to } = applyPreset(state.filters.preset);
  state.filters.from = from;
  state.filters.to = to;
  $("#dateFrom").value = inputDateValue(from);
  $("#dateTo").value = inputDateValue(to);
  fullReload();
  setInterval(fullReload, 5 * 60 * 1000);
})();
