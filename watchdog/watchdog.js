'use strict';

// =============================================================
// Watchdog · monitora /healthz do treinobot e reinicia via PM2
// =============================================================
require('dotenv').config({ quiet: true });

const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { URL } = require('url');

const CONFIG = Object.freeze({
  TARGET:               process.env.WATCHDOG_TARGET            || 'http://127.0.0.1:4020/healthz',
  INTERVAL_MS:   Number(process.env.WATCHDOG_INTERVAL_MS       || 30_000),
  TIMEOUT_MS:    Number(process.env.WATCHDOG_TIMEOUT_MS        || 8_000),
  FAIL_THRESHOLD:Number(process.env.WATCHDOG_FAILURES_THRESHOLD|| 5),
  RESTART_COOLDOWN_MS: Number(process.env.WATCHDOG_RESTART_COOLDOWN_MS || 5 * 60_000),
  BOOT_GRACE_MS: Number(process.env.WATCHDOG_BOOT_GRACE_MS     || 90_000),
  PM2_TARGET:           process.env.WATCHDOG_PM2_TARGET        || 'treinobot',
  PM2_BIN:              process.env.WATCHDOG_PM2_BIN           || 'pm2',
  REQUIRE_WHATSAPP:    (process.env.WATCHDOG_REQUIRE_WHATSAPP  || 'true') !== 'false',
});

const ts = () => new Date().toISOString();
const log = Object.freeze({
  info:  (...args) => console.log(`[${ts()}] [watchdog]`, ...args),
  warn:  (...args) => console.warn(`[${ts()}] [watchdog] ⚠️`, ...args),
  error: (...args) => console.error(`[${ts()}] [watchdog] ❌`, ...args),
  ok:    (...args) => console.log(`[${ts()}] [watchdog] ✅`, ...args),
});

let failures = 0;
let lastRestartAt = 0;
const startedAt = Date.now();

function check() {
  return new Promise((resolve) => {
    const url = new URL(CONFIG.TARGET);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      timeout:  CONFIG.TIMEOUT_MS,
      headers:  { 'user-agent': 'treinobot-watchdog/1.0' },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; if (body.length > 4096) req.destroy(); });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return resolve({ ok: false, reason: `http_${res.statusCode}` });
        }
        try {
          const json = JSON.parse(body);
          if (json.status !== 'ok') return resolve({ ok: false, reason: `status_${json.status}` });
          if (CONFIG.REQUIRE_WHATSAPP && json.whatsappReady !== true) {
            return resolve({ ok: false, reason: 'whatsapp_not_ready' });
          }
          resolve({ ok: true, json });
        } catch (err) {
          resolve({ ok: false, reason: 'invalid_json' });
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error',   (err) => resolve({ ok: false, reason: err.code || err.message || 'request_error' }));
  });
}

function restartTarget() {
  return new Promise((resolve) => {
    log.warn(`Disparando: ${CONFIG.PM2_BIN} restart ${CONFIG.PM2_TARGET}`);
    execFile(CONFIG.PM2_BIN, ['restart', CONFIG.PM2_TARGET], { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        log.error('Falha ao reiniciar via PM2:', err.message || err);
        if (stderr) log.error('stderr:', stderr.trim());
      } else {
        log.ok('PM2 restart executado.');
        if (stdout) log.info(stdout.trim());
      }
      resolve();
    });
  });
}

async function tick() {
  const result = await check();
  if (result.ok) {
    if (failures > 0) log.ok(`Healthy novamente após ${failures} falha(s).`);
    failures = 0;
    return;
  }

  failures++;

  // Boot grace: ignora falhas até o app ter tempo de subir
  const sinceStart = Date.now() - startedAt;
  if (sinceStart < CONFIG.BOOT_GRACE_MS) {
    log.info(`Falha durante boot grace (${result.reason}). ${Math.round((CONFIG.BOOT_GRACE_MS - sinceStart) / 1000)}s restantes.`);
    return;
  }

  log.warn(`Falha #${failures}/${CONFIG.FAIL_THRESHOLD} · motivo: ${result.reason}`);
  if (failures < CONFIG.FAIL_THRESHOLD) return;

  const sinceRestart = Date.now() - lastRestartAt;
  if (lastRestartAt && sinceRestart < CONFIG.RESTART_COOLDOWN_MS) {
    log.warn(`Cooldown ativo (${Math.round((CONFIG.RESTART_COOLDOWN_MS - sinceRestart) / 1000)}s restantes). Pulando restart.`);
    return;
  }

  lastRestartAt = Date.now();
  failures = 0;
  await restartTarget();
}

function start() {
  log.info('Configuração:', {
    target: CONFIG.TARGET,
    intervalMs: CONFIG.INTERVAL_MS,
    failThreshold: CONFIG.FAIL_THRESHOLD,
    cooldownMs: CONFIG.RESTART_COOLDOWN_MS,
    bootGraceMs: CONFIG.BOOT_GRACE_MS,
    pm2Target: CONFIG.PM2_TARGET,
    requireWhatsApp: CONFIG.REQUIRE_WHATSAPP,
  });
  tick();
  setInterval(tick, CONFIG.INTERVAL_MS);
}

process.on('SIGTERM', () => { log.info('SIGTERM recebido. Encerrando.'); process.exit(0); });
process.on('SIGINT',  () => { log.info('SIGINT recebido. Encerrando.');  process.exit(0); });

start();
