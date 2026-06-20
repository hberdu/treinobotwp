'use strict';

require('dotenv').config({ quiet: true });

const express = require("express");
const path = require("path");
const fs = require("fs");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");
const puppeteer = require("puppeteer");
const { OpenAI } = require("openai");
const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  collection,
  getDocs,
  addDoc,
} = require("firebase/firestore");

// ============================================
// CONSTANTES
// ============================================
const CONFIG = Object.freeze({
  DEFAULT_HTTP_PORT: Number(process.env.PORT || 4020),
  MAX_BACKOFF_MS: 5 * 60 * 1000,
  INITIAL_BACKOFF_MS: 5_000,
  DISCONNECT_RECONNECT_DELAY_MS: 10_000,
  HTTP_RETRY_DELAY_MS: 2_000,
  READY_CHECK_INTERVAL_MS: 500,
  READY_CHECK_MAX_ATTEMPTS: 50,
  GPT_MAX_CHARS: 300,
  GPT_MAX_TOKENS: 100,
  GPT_MODEL: "gpt-3.5-turbo",
  SEMANAS_NO_ANO: 52,
  META_PADRAO: 5,
  AUTH_DATA_PATH: path.join(__dirname, ".wwebjs_auth_treino"),
  GROUP_SUFFIX: "@g.us",
});

const FIREBASE_CONFIG = Object.freeze({
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyD2prl1jdMUdkNdQkidySfYFwTdLkinZV4",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "treinobot.firebaseapp.com",
  databaseURL: process.env.FIREBASE_DATABASE_URL || "https://treinobot-default-rtdb.firebaseio.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "treinobot",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "treinobot.appspot.com",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "720957000050",
  appId: process.env.FIREBASE_APP_ID || "1:720957000050:web:b753545187bf4f186ff5eb",
});

// ============================================
// LOGGER COM TIMESTAMP
// ============================================
const ts = () => new Date().toISOString();
const log = Object.freeze({
  info: (scope, ...args) => console.log(`[${ts()}] [${scope}]`, ...args),
  warn: (scope, ...args) => console.warn(`[${ts()}] [${scope}] ⚠️`, ...args),
  error: (scope, ...args) => console.error(`[${ts()}] [${scope}] ❌`, ...args),
  ok: (scope, ...args) => console.log(`[${ts()}] [${scope}] ✅`, ...args),
});

// ============================================
// EXPRESS APP
// ============================================
const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    whatsappReady: Boolean(client?.info),
    reconnectAttempt,
    timestamp: ts(),
  });
});

// ============================================
// DASHBOARD API
// ============================================
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || null;
const DASHBOARD_PUBLIC_URL = process.env.DASHBOARD_PUBLIC_URL || "http://191.252.102.34:4020/dashboard";

function dashboardAuth(req, res, next) {
  if (!DASHBOARD_TOKEN) return next();
  const provided = req.query.token || req.headers["x-dashboard-token"];
  if (provided !== DASHBOARD_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function toISO(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "number") return new Date(value).toISOString();
  if (value.seconds) return new Date(value.seconds * 1000).toISOString();
  return null;
}

app.get("/api/atletas", dashboardAuth, async (_req, res) => {
  try {
    const snapshot = await getDocs(collection(db, "atletas2026"));
    const atletas = [];
    snapshot.forEach((d) => {
      const data = d.data() || {};
      atletas.push({
        id: d.id,
        nome: data.nome || d.id,
        treinos: Number(data.treinos || 0),
        progresso: Number(data.progresso || 0),
        progressoSemanal: Number(data.progressoSemanal || 0),
        meta: Number(data.meta || CONFIG.META_PADRAO),
      });
    });
    res.json({ atletas });
  } catch (error) {
    log.error("API/atletas", error?.message || error);
    res.status(500).json({ error: "failed_to_load_atletas" });
  }
});

app.get("/api/treinos", dashboardAuth, async (req, res) => {
  try {
    const snapshot = await getDocs(collection(db, "data-treino"));
    const since = req.query.since ? new Date(req.query.since) : null;
    const until = req.query.until ? new Date(req.query.until) : null;
    const nomeFiltro = req.query.nome ? String(req.query.nome) : null;

    const treinos = [];
    snapshot.forEach((d) => {
      const data = d.data() || {};
      const isoDate = toISO(data["data-treino"]);
      if (!isoDate) return;
      const nome = data.nome || null;
      if (!nome) return;
      if (nomeFiltro && nome !== nomeFiltro) return;
      const dt = new Date(isoDate);
      if (since && dt < since) return;
      if (until && dt > until) return;
      treinos.push({ id: d.id, nome, data: isoDate });
    });

    treinos.sort((a, b) => new Date(a.data) - new Date(b.data));
    res.json({ treinos, total: treinos.length });
  } catch (error) {
    log.error("API/treinos", error?.message || error);
    res.status(500).json({ error: "failed_to_load_treinos" });
  }
});

// Cache em memória do payload do dashboard. Invalidado quando um treino é
// registrado (handleTreino / handleTreino2 / POST /api/treino).
const DASHBOARD_CACHE_TTL_MS = 60_000;
let dashboardCache = { data: null, expiresAt: 0, building: null };

function invalidateDashboardCache() {
  dashboardCache = { data: null, expiresAt: 0, building: null };
}

async function loadDashboardPayload() {
  const now = Date.now();
  if (dashboardCache.data && dashboardCache.expiresAt > now) return dashboardCache.data;
  if (dashboardCache.building) return dashboardCache.building;

  dashboardCache.building = (async () => {
    const [atletasSnap, treinosSnap] = await Promise.all([
      getDocs(collection(db, "atletas2026")),
      getDocs(collection(db, "data-treino")),
    ]);

    const atletas = [];
    atletasSnap.forEach((d) => {
      const data = d.data() || {};
      atletas.push({
        id: d.id,
        nome: data.nome || d.id,
        treinos: Number(data.treinos || 0),
        progresso: Number(data.progresso || 0),
        progressoSemanal: Number(data.progressoSemanal || 0),
        meta: Number(data.meta || CONFIG.META_PADRAO),
      });
    });

    const treinos = [];
    treinosSnap.forEach((d) => {
      const data = d.data() || {};
      const iso = toISO(data["data-treino"]);
      const nome = data.nome || null;
      if (!iso || !nome) return;
      treinos.push({ id: d.id, nome, data: iso });
    });
    treinos.sort((a, b) => new Date(a.data) - new Date(b.data));

    const payload = {
      atletas,
      treinos,
      meta: CONFIG.META_PADRAO,
      semanasNoAno: CONFIG.SEMANAS_NO_ANO,
      generatedAt: ts(),
    };
    dashboardCache = { data: payload, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS, building: null };
    return payload;
  })().catch((err) => {
    dashboardCache.building = null;
    throw err;
  });

  return dashboardCache.building;
}

app.get("/api/dashboard", dashboardAuth, async (_req, res) => {
  try {
    const payload = await loadDashboardPayload();
    res.json(payload);
  } catch (error) {
    log.error("API/dashboard", error?.message || error);
    res.status(500).json({ error: "failed_to_load_dashboard" });
  }
});

app.post("/api/treino", dashboardAuth, async (req, res) => {
  try {
    const nome = (req.body && req.body.nome ? String(req.body.nome) : "").trim();
    if (!nome) return res.status(400).json({ error: "nome_required" });

    const ref = doc(db, "atletas2026", nome);
    const snap = await getDoc(ref);
    if (!snap.exists()) return res.status(404).json({ error: "atleta_nao_encontrado" });

    const message = await inserirAtleta(nome);
    res.json({ ok: true, message });
  } catch (error) {
    log.error("API/treino", error?.message || error);
    res.status(500).json({ error: "failed_to_register" });
  }
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/ranking-card", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "ranking-card.html"));
});

// ============================================
// WHATSAPP CLIENT
// ============================================
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: CONFIG.AUTH_DATA_PATH }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  },
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/wwebjs/wa-web-cache/master/data/",
  },
});

// ============================================
// FIREBASE
// ============================================
initializeApp(FIREBASE_CONFIG);
const db = getFirestore();

// ============================================
// OPENAI (opcional)
// ============================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const hasOpenAIKey = Boolean(OPENAI_API_KEY);
if (!hasOpenAIKey) {
  log.warn("OpenAI", "OPENAI_API_KEY não configurada. Comandos de IA ficarão indisponíveis, mas o bot continuará online.");
}
const openai = hasOpenAIKey ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ============================================
// ESTADO DE RECONEXÃO
// ============================================
let readyCheckStarted = false;
let isInitializing = false;
let reconnectTimer = null;
let reconnectAttempt = 0;

function computeBackoff(attempt) {
  const base = CONFIG.INITIAL_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(base, CONFIG.MAX_BACKOFF_MS);
}

function scheduleReinitialize(reason, delayMs) {
  if (reconnectTimer) {
    log.info("Reconexao", `Já existe reagendamento pendente. Ignorando novo trigger (motivo: ${reason}).`);
    return;
  }
  reconnectAttempt += 1;
  const wait = typeof delayMs === "number" ? delayMs : computeBackoff(reconnectAttempt);
  log.warn("Reconexao", `Tentativa #${reconnectAttempt} agendada em ${Math.round(wait / 1000)}s. Motivo: ${reason}`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    log.info("Reconexao", `Executando tentativa #${reconnectAttempt} (motivo original: ${reason})`);
    await initializeClient();
  }, wait);
}

/**
 * Remove arquivos de lock do Chromium e mata o processo que estiver segurando
 * o userDataDir (caso o Node tenha sido reiniciado e o navegador anterior
 * ficou órfão). Resolve o erro: "The browser is already running for ...".
 */
function cleanupBrowserLock() {
  try {
    const sessionDir = path.join(CONFIG.AUTH_DATA_PATH, "session");
    if (!fs.existsSync(sessionDir)) return;

    const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket"];

    for (const name of lockFiles) {
      const lockPath = path.join(sessionDir, name);
      let target = null;
      try {
        target = fs.readlinkSync(lockPath); // ex: "hostname-12345"
      } catch (_) {
        // não é symlink ou não existe
      }

      if (target && name === "SingletonLock") {
        const match = /-(\d+)$/.exec(target);
        const pid = match ? Number(match[1]) : NaN;
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, "SIGKILL");
            log.warn("Cleanup", `Processo chromium órfão (pid=${pid}) finalizado.`);
          } catch (e) {
            if (e && e.code !== "ESRCH") {
              log.warn("Cleanup", `Falha ao matar pid=${pid}:`, e?.message || e);
            }
          }
        }
      }

      try {
        if (fs.existsSync(lockPath) || target) {
          fs.unlinkSync(lockPath);
          log.info("Cleanup", `Lock removido: ${name}`);
        }
      } catch (e) {
        if (e && e.code !== "ENOENT") {
          log.warn("Cleanup", `Não foi possível remover ${name}:`, e?.message || e);
        }
      }
    }
  } catch (error) {
    log.warn("Cleanup", "Erro inesperado durante cleanupBrowserLock:", error?.message || error);
  }
}

async function initializeClient() {
  if (isInitializing) {
    log.info("Init", "Inicialização já em andamento. Ignorando chamada duplicada.");
    return;
  }
  isInitializing = true;
  log.info("Init", `Inicializando cliente WhatsApp (tentativa #${reconnectAttempt + (reconnectAttempt === 0 ? 1 : 0)})...`);
  try {
    cleanupBrowserLock();
    await client.initialize();
    log.ok("Init", "client.initialize() retornou. Aguardando eventos de autenticação/ready.");
    reconnectAttempt = 0;
  } catch (error) {
    const msg = error?.message || String(error);
    log.error("Init", "Falha ao inicializar cliente:", msg);
    if (/browser is already running/i.test(msg)) {
      log.warn("Init", "Detectado lock de navegador. Executando cleanup adicional antes do retry.");
      cleanupBrowserLock();
    }
    scheduleReinitialize("falha_initialize");
  } finally {
    isInitializing = false;
  }
}

// ============================================
// REGISTRAR TODOS OS LISTENERS ANTES DE INICIALIZAR
// ============================================

client.on("loading_screen", (percent, message) => {
  log.info("Cliente", `Carregando: ${percent}% - ${message}`);
});

client.on("qr", (qr) => {
  log.info("QR", "QR CODE gerado. Escaneie com seu WhatsApp:");
  qrcodeTerminal.generate(qr, { small: true });
  log.info("QR", "Aguardando escaneamento...");
});

client.on("authenticated", () => {
  log.ok("Auth", "Autenticado com sucesso. Sessão salva em .wwebjs_auth_treino");

  if (readyCheckStarted) return;
  readyCheckStarted = true;

  let checkAttempts = 0;
  const checkReadyInterval = setInterval(() => {
    checkAttempts++;
    log.info("Verificacao", `Tentativa ${checkAttempts}/${CONFIG.READY_CHECK_MAX_ATTEMPTS} - client.info: ${client.info ? "SIM" : "não"}`);
    if (client.info) {
      log.ok("Cliente", `Pronto! Usuário conectado: ${client.info.pushname}`);
      clearInterval(checkReadyInterval);
    } else if (checkAttempts >= CONFIG.READY_CHECK_MAX_ATTEMPTS) {
      log.warn("Cliente", "Timeout aguardando client.info. Seguindo mesmo assim.");
      clearInterval(checkReadyInterval);
    }
  }, CONFIG.READY_CHECK_INTERVAL_MS);
});

client.on("remote_session_saved", () => {
  log.ok("Sessao", "Sessão remota salva com sucesso.");
});

client.on("ready", () => {
  log.ok("Cliente", "READY! Bot online e aguardando mensagens.");
  reconnectAttempt = 0;
});

client.on("change_state", (state) => {
  log.info("Estado", `Mudou para: ${state}`);
});

client.on("connection_lost", () => {
  log.warn("Conexao", "Conexão perdida com WhatsApp Web. Aguardando recuperação automática...");
});

client.on("error", (error) => {
  log.error("Cliente", "Erro reportado pelo client:", error?.message || error);
});

client.on("auth_failure", (msg) => {
  log.error("Auth", "Falha na autenticação:", msg);
  readyCheckStarted = false;
  scheduleReinitialize("auth_failure");
});

client.on("disconnected", (reason) => {
  log.warn("Conexao", `Cliente desconectado. Motivo: ${reason}`);
  readyCheckStarted = false;
  // Tenta destruir o client antes de reiniciar para liberar recursos do puppeteer.
  (async () => {
    try {
      await client.destroy();
      log.info("Conexao", "client.destroy() concluído.");
    } catch (e) {
      log.warn("Conexao", "Erro ao destruir client (ignorado):", e?.message || e);
    } finally {
      scheduleReinitialize(`disconnected:${reason}`, 10000);
    }
  })();
});

// ============================================
// DISPATCHER DE COMANDOS
// ============================================
async function safeReply(msg, content, contexto) {
  try {
    await msg.reply(content);
  } catch (error) {
    log.error("Handler", `Erro ao enviar resposta (${contexto}):`, error?.message || error);
  }
}

const CATCHUP_FETCH_LIMIT = 100;

/**
 * Identifica o handler correspondente a uma mensagem (sem executá-lo).
 */
function findCommandEntry(body) {
  if (!body) return null;
  return COMMAND_HANDLERS.find((c) => c.match(body)) || null;
}

/**
 * Ao receber um !treino, varre o histórico do grupo desde a última mensagem
 * do próprio bot e reprocessa quaisquer comandos que tenham ficado sem
 * resposta (ex.: o bot estava offline). Processa em ordem cronológica e
 * pula a própria mensagem que disparou o catch-up (ela será tratada a
 * seguir, no fluxo normal).
 */
async function catchUpMissedCommands(currentMsg) {
  try {
    const chat = await currentMsg.getChat();
    const fetched = await chat.fetchMessages({ limit: CATCHUP_FETCH_LIMIT });

    // Coleta candidatos do mais novo para o mais antigo, parando na
    // primeira mensagem enviada pelo próprio bot.
    const candidatos = [];
    for (let i = fetched.length - 1; i >= 0; i--) {
      const m = fetched[i];
      if (m.fromMe) break;
      if (m.id?._serialized === currentMsg.id?._serialized) continue;
      const entry = findCommandEntry(m.body);
      if (entry) candidatos.push({ m, entry });
    }

    if (candidatos.length === 0) {
      log.info("CatchUp", "Nenhum comando pendente desde a última resposta do bot.");
      return;
    }

    // Reprocessa em ordem cronológica (mais antigo primeiro).
    candidatos.reverse();
    log.info("CatchUp", `Reprocessando ${candidatos.length} comando(s) pendente(s).`);
    for (const { m, entry } of candidatos) {
      try {
        log.info("CatchUp", `→ Reprocessando ${entry.label} (id=${m.id?._serialized})`);
        await entry.handler(m, { skipCatchUp: true });
      } catch (error) {
        log.error("CatchUp", `Falha ao reprocessar ${entry.label}:`, error?.message || error);
      }
    }
  } catch (error) {
    log.warn("CatchUp", "Não foi possível executar o catch-up:", error?.message || error);
  }
}

async function handleTreino(msg, opts = {}) {
  log.info("Handler", "Comando !treino detectado");
  if (!opts.skipCatchUp) {
    await catchUpMissedCommands(msg);
  }
  const nomeUsuario = await getNomeUsuario(msg.author);
  log.info("Handler", `Usuário: ${nomeUsuario}`);
  const retorno = await processarMensagem("!treino", nomeUsuario);
  await safeReply(msg, retorno || "Erro ao gerar a mensagem de retorno.", "!treino");
}

async function handleStatus(msg) {
  log.info("Handler", "Comando !status detectado");
  const nomeUsuario = await getNomeUsuario(msg.author);
  log.info("Handler", `Usuário: ${nomeUsuario}`);
  const retorno = await processarMensagemSemAtualizar("!status", nomeUsuario);
  await safeReply(msg, retorno || "Erro ao gerar a mensagem de retorno.", "!status");
}

// ============================================
// SCREENSHOT DO RANKING (PNG)
// ============================================
let _screenshotBrowser = null;
let _screenshotBrowserPromise = null;

async function getScreenshotBrowser() {
  if (_screenshotBrowser && _screenshotBrowser.isConnected()) return _screenshotBrowser;
  if (_screenshotBrowserPromise) return _screenshotBrowserPromise;
  _screenshotBrowserPromise = puppeteer
    .launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    })
    .then((b) => {
      _screenshotBrowser = b;
      _screenshotBrowserPromise = null;
      b.on("disconnected", () => { _screenshotBrowser = null; });
      return b;
    })
    .catch((err) => {
      _screenshotBrowserPromise = null;
      throw err;
    });
  return _screenshotBrowserPromise;
}

async function generateRankingPng() {
  const browser = await getScreenshotBrowser();
  const page = await browser.newPage();
  try {
    // Viewport único, grande o suficiente para acomodar todos os atletas
    await page.setViewport({ width: 1640, height: 1800, deviceScaleFactor: 2 });
    const port = currentHttpPort || CONFIG.DEFAULT_HTTP_PORT;
    const tokenQs = DASHBOARD_TOKEN ? `?token=${encodeURIComponent(DASHBOARD_TOKEN)}` : "";
    const url = `http://127.0.0.1:${port}/ranking-card${tokenQs}`;
    // domcontentloaded é mais rápido que networkidle0 e a página já sinaliza
    // __rankingReady quando os dados e as fontes estão prontos
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForFunction(() => window.__rankingReady === true, { timeout: 10000 });

    const el = await page.$(".card");
    if (!el) throw new Error("card_not_found");
    const base64 = await el.screenshot({ type: "png", encoding: "base64", omitBackground: false });
    if (!base64 || typeof base64 !== "string" || base64.length < 100) {
      throw new Error(`invalid_screenshot_output (len=${base64 ? base64.length : 0})`);
    }
    return base64.replace(/\s+/g, "");
  } finally {
    await page.close().catch(() => {});
  }
}

async function sendRankingImage(msg, captionExtra) {
  try {
    log.info("Imagem", "Gerando PNG do ranking...");
    const base64 = await generateRankingPng();
    const media = new MessageMedia("image/png", base64, "ranking.png");
    const sendOptions = { sendMediaAsDocument: false };
    if (captionExtra) sendOptions.caption = captionExtra;
    await msg.reply(media, undefined, sendOptions);
    log.ok("Imagem", `PNG enviado (${Math.round((base64.length * 3) / 4 / 1024)} KB).`);
  } catch (error) {
    log.error("Imagem", "Falha ao gerar/enviar imagem:", error?.message || error);
    await safeReply(msg, "Erro ao gerar imagem do ranking.", "ranking-img");
  }
}

async function handleTreino2(msg, opts = {}) {
  log.info("Handler", "Comando !treino2 detectado");
  if (!opts.skipCatchUp) {
    await catchUpMissedCommands(msg);
  }
  const nomeUsuario = await getNomeUsuario(msg.author);
  log.info("Handler", `Usuário: ${nomeUsuario}`);
  await inserirAtleta(nomeUsuario);
  await sendRankingImage(msg, `Ranking atualizado · ${nomeUsuario}`);
}

async function handleStatus2(msg) {
  log.info("Handler", "Comando !status2 detectado");
  await sendRankingImage(msg);
}

async function handlePergunta(msg) {
  const body = msg.body;
  const prefixo = body.startsWith("!p ") ? "!p " : "!pergunta ";
  const pergunta = body.slice(prefixo.length).trim();
  log.info("Handler", `Comando de pergunta detectado (${prefixo.trim()})`);

  if (!pergunta) {
    await safeReply(msg, "Por favor, digite uma pergunta após o comando !p ou !pergunta", "pergunta-vazia");
    return;
  }

  log.info("Handler", `Pergunta para GPT: "${pergunta}"`);
  const resposta = await obterRespostaGPT(pergunta);
  log.info("Handler", `Respondendo com: "${resposta}"`);
  await safeReply(msg, resposta, "pergunta");
}

async function handleDashboard(msg) {
  log.info("Handler", "Comando !dashboard detectado");
  const url = DASHBOARD_TOKEN
    ? `${DASHBOARD_PUBLIC_URL}?token=${DASHBOARD_TOKEN}`
    : DASHBOARD_PUBLIC_URL;
  const texto = `📊 *Dashboard de Treinos*\nAcompanhe ranking, progresso e evolução semanal:\n${url}`;
  await safeReply(msg, texto, "!dashboard");
}

const COMMAND_HANDLERS = [
  { match: (body) => body.startsWith("!treino2"), handler: handleTreino2, label: "!treino2" },
  { match: (body) => body.startsWith("!status2"), handler: handleStatus2, label: "!status2" },
  { match: (body) => body.startsWith("!treino"), handler: handleTreino, label: "!treino" },
  { match: (body) => body.startsWith("!status"), handler: handleStatus, label: "!status" },
  { match: (body) => body.startsWith("!dashboard") || body.startsWith("!painel"), handler: handleDashboard, label: "!dashboard" },
  { match: (body) => body.startsWith("!pergunta ") || body.startsWith("!p "), handler: handlePergunta, label: "!pergunta" },
];

client.on("message", async (msg) => {
  try {
    if (!msg?.from?.endsWith(CONFIG.GROUP_SUFFIX)) return;
    if (!msg?.body) return;

    const entry = COMMAND_HANDLERS.find((c) => c.match(msg.body));
    if (!entry) return;

    log.info("Mensagem", `COMANDO recebido: ${entry.label}`);
    await entry.handler(msg);
  } catch (error) {
    log.error("Mensagem", "Erro no processamento da mensagem:", error?.message || error);
  }
});

// ============================================
// HANDLERS GLOBAIS DE CRASH (não derrubam o processo)
// ============================================
process.on("uncaughtException", (err) => {
  log.error("Process", "uncaughtException:", err?.stack || err);
  scheduleReinitialize("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  log.error("Process", "unhandledRejection:", reason?.stack || reason);
  scheduleReinitialize("unhandledRejection");
});

process.on("SIGTERM", () => {
  log.warn("Process", "SIGTERM recebido. Encerrando graciosamente...");
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  log.warn("Process", "SIGINT recebido. Encerrando graciosamente...");
  shutdown("SIGINT");
});

async function shutdown(signal) {
  try {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    await client.destroy().catch(() => {});
    if (_screenshotBrowser) await _screenshotBrowser.close().catch(() => {});
  } finally {
    log.info("Process", `Shutdown concluído (${signal}). Encerrando.`);
    process.exit(0);
  }
}

// ============================================
// AGORA INICIALIZAR O CLIENTE
// ============================================
initializeClient();

// ============================================
// SERVIDOR HTTP COM TRATAMENTO DE EADDRINUSE
// ============================================
let currentHttpPort = null;
function startHttpServer(portToUse, attempt = 1) {
  const server = app.listen(portToUse, () => {
    currentHttpPort = portToUse;
    log.ok("HTTP", `Servidor iniciado na porta ${portToUse}`);
  });

  server.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      const nextPort = Number(portToUse) + 1;
      log.warn("HTTP", `Porta ${portToUse} em uso (EADDRINUSE). Tentando ${nextPort} em ${CONFIG.HTTP_RETRY_DELAY_MS / 1000}s... (tentativa ${attempt})`);
      setTimeout(() => startHttpServer(nextPort, attempt + 1), CONFIG.HTTP_RETRY_DELAY_MS);
      return;
    }
    log.error("HTTP", "Erro no servidor Express:", error?.message || error);
    setTimeout(() => startHttpServer(portToUse, attempt + 1), CONFIG.HTTP_RETRY_DELAY_MS * 2);
  });
}

startHttpServer(CONFIG.DEFAULT_HTTP_PORT);

const insertNewTraining = async (athleteName) => {
  try {
    log.info("insertNewTraining", `Inserindo treino para: ${athleteName}`);
    const res = await addDoc(collection(db, "data-treino"), {
      nome: athleteName,
      "data-treino": new Date(),
    });
    log.ok("insertNewTraining", `Treino inserido. ID: ${res.id}`);
  } catch (error) {
    log.error("insertNewTraining", `Erro ao inserir treino para ${athleteName}:`, error?.message || error);
    return "Erro ao inserir treino.";
  }
};

async function inserirAtleta(nomeUsuario) {
  try {
    log.info("inserirAtleta", `Processando atleta: ${nomeUsuario}`);
    const atletaRef = doc(db, "atletas2026", nomeUsuario);
    const atletaDoc = await getDoc(atletaRef);
    log.info("inserirAtleta", `Documento existe: ${atletaDoc.exists()}`);

    if (atletaDoc.exists()) {
      const dadosAtleta = atletaDoc.data();

      if (!dadosAtleta || typeof dadosAtleta.treinos === "undefined") {
        throw new Error("Dados do atleta estão incompletos ou inválidos.");
      }

      await insertNewTraining(dadosAtleta.nome);

      const novoNumeroTreinos = (dadosAtleta.treinos || 0) + 1;
      const meta = dadosAtleta.meta || CONFIG.META_PADRAO;
      const progresso = (dadosAtleta.progresso || 0) + 1;
      const progressoSemanal = (dadosAtleta.progressoSemanal || 0) + (progresso === meta ? 1 : 0);

      await updateDoc(atletaRef, {
        treinos: novoNumeroTreinos,
        progresso,
        progressoSemanal,
        meta,
      });
      log.ok("inserirAtleta", `Atleta ${nomeUsuario} atualizado. Treinos: ${novoNumeroTreinos}, Progresso: ${progresso}`);
      invalidateDashboardCache();

      return `Número de treinos de ${nomeUsuario} atualizado para ${novoNumeroTreinos}.`;
    }

    log.info("inserirAtleta", `Novo atleta. Criando documento: ${nomeUsuario}`);
    await setDoc(atletaRef, {
      nome: nomeUsuario,
      treinos: 1,
      progresso: 1,
      progressoSemanal: 0,
      meta: CONFIG.META_PADRAO,
    });
    await insertNewTraining(nomeUsuario);
    log.ok("inserirAtleta", `Novo atleta ${nomeUsuario} criado com sucesso`);
    invalidateDashboardCache();
    return `Atleta ${nomeUsuario}, seu primeiro treino foi gerado.`;
  } catch (error) {
    log.error("inserirAtleta", "Erro ao inserir/atualizar atleta:", error?.message || error);
    return "Erro ao inserir/atualizar atleta.";
  }
}

function montarCabecalhoSemana() {
  const semanaAtual = getSemanaAtual();
  const semanasRestantes = CONFIG.SEMANAS_NO_ANO - semanaAtual;
  const { segunda, domingo } = getSegundaEDomingoDaSemanaAtual();
  return `
Projeto semana ${semanaAtual}/${CONFIG.SEMANAS_NO_ANO} 
(${segunda.toLocaleDateString("pt-br")} - ${domingo.toLocaleDateString("pt-br")})
${semanasRestantes} semanas restantes no ano
`;
}

async function processarMensagem(mensagem, nomeUsuario) {
  if (mensagem !== "!treino") return null;
  try {
    const mensagemAtleta = await inserirAtleta(nomeUsuario);
    const cabecalho = montarCabecalhoSemana();
    const tabelaTreinos = await gerarTabelaTreinos();
    const mensagemFinal = `\`\`\`
${mensagemAtleta}
${cabecalho}
${tabelaTreinos}
\`\`\``;
    log.info("processarMensagem", "Mensagem final gerada.");
    return mensagemFinal;
  } catch (error) {
    log.error("processarMensagem", "Erro ao processar a mensagem:", error?.message || error);
    return "Ocorreu um erro ao processar sua solicitação.";
  }
}

async function processarMensagemSemAtualizar(mensagem, nomeUsuario) {
  if (mensagem !== "!status") return null;
  try {
    const cabecalho = montarCabecalhoSemana();
    const tabelaTreinos = await gerarTabelaTreinos();
    const mensagemFinal = `\`\`\`
${cabecalho}
${tabelaTreinos}
\`\`\``;
    log.info("processarMensagemSemAtualizar", "Mensagem final gerada.");
    return mensagemFinal;
  } catch (error) {
    log.error("processarMensagemSemAtualizar", "Erro ao processar a mensagem:", error?.message || error);
    return "Ocorreu um erro ao processar sua solicitação.";
  }
}

function getSemanaAtual() {
  const hoje = new Date();
  const inicioDoAno = new Date(hoje.getFullYear(), 0, 1);
  const diff = hoje - inicioDoAno;
  const umaSemanaEmMilissegundos = 1000 * 60 * 60 * 24 * 7;
  return Math.floor(diff / umaSemanaEmMilissegundos) + 1;
}

function getSegundaEDomingoDaSemanaAtual() {
  const dataAtual = new Date();
  const diaSemana = dataAtual.getDay();
  const diffSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const diffDomingo = diaSemana === 0 ? 0 : 7 - diaSemana;

  const segunda = new Date(dataAtual.getTime());
  segunda.setDate(dataAtual.getDate() + diffSegunda);
  const domingo = new Date(dataAtual.getTime());
  domingo.setDate(dataAtual.getDate() + diffDomingo);

  return { segunda, domingo };
}

async function getNomeUsuario(numero) {
  try {
    const chat = await client.getChatById(numero);
    return chat ? chat.name : "Nome do usuário não encontrado";
  } catch (error) {
    log.error("getNomeUsuario", "Erro ao obter nome do usuário:", error?.message || error);
    return "Nome do usuário não encontrado";
  }
}

const gerarTabelaTreinos = async () => {
  try {
    const atletasRef = collection(db, "atletas2026");
    const snapshot = await getDocs(atletasRef);

    const atletas = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.nome) {
        atletas.push({
          nome: data.nome,
          treinos: data.treinos || 0,
          progresso: data.progresso || 0,
          meta: data.meta || CONFIG.META_PADRAO,
          progressoSemanal: data.progressoSemanal || 0,
        });
      } else {
        log.warn("gerarTabelaTreinos", `Dados incompletos para o documento: ${docSnap.id}`);
      }
    });

    if (atletas.length === 0) {
      throw new Error("Nenhum atleta encontrado ou dados incompletos.");
    }

    atletas.sort((a, b) => {
      if (b.progressoSemanal !== a.progressoSemanal) {
        return b.progressoSemanal - a.progressoSemanal;
      }
      return b.treinos - a.treinos;
    });

    const maxNomeLength = Math.max(...atletas.map((a) => a.nome.length));

    const MEDALHAS = ["🥇", "🥈", "🥉"];
    const linhas = atletas.map((atleta, index) => {
      const progressoTexto = `${atleta.progresso}/${atleta.meta} - ${atleta.progressoSemanal}/${CONFIG.SEMANAS_NO_ANO}`;
      const medalha = MEDALHAS[index] ? ` ${MEDALHAS[index]}` : "";
      return `${atleta.nome.padEnd(maxNomeLength)} ${String(atleta.treinos)} ${progressoTexto}${medalha}`;
    });

    return `Tabela de Treinos:\n${linhas.join("\n")}\n`;
  } catch (error) {
    log.error("gerarTabelaTreinos", "Erro ao gerar tabela de treinos:", error?.message || error);
    return "Erro ao gerar tabela de treinos.";
  }
};

const obterRespostaGPT = async (pergunta) => {
  if (!openai) {
    return "Comando indisponível: OPENAI_API_KEY não configurada.";
  }
  try {
    log.info("obterRespostaGPT", `Enviando pergunta ao ChatGPT: "${pergunta}"`);
    const resposta = await openai.chat.completions.create({
      model: CONFIG.GPT_MODEL,
      messages: [
        {
          role: "user",
          content: `Responda com no máximo ${CONFIG.GPT_MAX_CHARS} caracteres: ${pergunta}`,
        },
      ],
      max_tokens: CONFIG.GPT_MAX_TOKENS,
    });

    let mensagem = resposta.choices[0].message.content.trim();
    log.info("obterRespostaGPT", `Resposta recebida (${mensagem.length} caracteres).`);

    if (mensagem.length > CONFIG.GPT_MAX_CHARS) {
      log.info("obterRespostaGPT", "Resposta excedia limite, truncando...");
      mensagem = `${mensagem.substring(0, CONFIG.GPT_MAX_CHARS - 3)}...`;
    }

    return mensagem;
  } catch (error) {
    log.error("obterRespostaGPT", "Erro ao chamar ChatGPT:", error?.message || error);
    return "Desculpe, não consegui processar sua pergunta no momento.";
  }
};
