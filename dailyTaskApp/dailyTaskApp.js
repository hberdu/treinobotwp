const path = require("path");
const rootDir = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(rootDir, '.env') });

const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const fs = require("fs");
const { OpenAI } = require("openai");
const app = express();
const port = 3000;


const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(rootDir, '.wwebjs_auth_daily') }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wwebjs/wa-web-cache/master/data/'
  }
});

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

const firebaseConfig = {
  apiKey: "AIzaSyD2prl1jdMUdkNdQkidySfYFwTdLkinZV4",
  authDomain: "treinobot.firebaseapp.com",
  databaseURL: "https://treinobot-default-rtdb.firebaseio.com",
  projectId: "treinobot",
  storageBucket: "treinobot.appspot.com",
  messagingSenderId: "720957000050",
  appId: "1:720957000050:web:b753545187bf4f186ff5eb",
};

const appFirebase = initializeApp(firebaseConfig);
const db = getFirestore();

// Usar variável de ambiente para a chave de API
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error("[ERRO] OPENAI_API_KEY não configurada! Configure a variável de ambiente.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Flag para garantir que não criamos múltiplos intervalos
let readyCheckStarted = false;

// Mapeamento de atividades e pontos
const activityMap = {
  1: { name: 'Varrer/Aspirar a casa', points: 1 },
  2: { name: 'Lavar a Louça', points: 1 },
  3: { name: 'Lavar as roupas', points: 1 },
  4: { name: 'Lavar o Banheiro do Corredor', points: 2 },
  5: { name: 'Lavar o Banheiro do Quarto', points: 2 },
  6: { name: 'Lavar Sacada', points: 2 },
  7: { name: 'Cozinhar Almoço', points: 1 },
  8: { name: 'Cozinhar Janta', points: 1 },
  9: { name: 'Limpar Cozinha', points: 2 },
  10: { name: 'Limpar Sala', points: 2 },
  11: { name: 'Limpar Escritório', points: 2 },
  12: { name: 'Organizar Armário da Cozinha', points: 3 },
  13: { name: 'Organizar Armário do Escritório', points: 3 },
  14: { name: 'Organizar Armário do quarto', points: 3 },
  15: { name: 'Lavar o Carro', points: 1 },
  16: { name: 'Limpar Caixa de Areia dos Gatos', points: 1 },
  17: { name: 'Colocar comida para os Gatos', points: 1 },
  18: { name: 'Tirar o lixo', points: 1 },
  19: { name: 'Separar o lixo', points: 2 },
};

// Atividades-chave para emojis de liderança
const EMOJI = {
  dishes: '🫧', // lavar a louça
  cooking: '🍳', // cozinhar
  cats: '🐱', // caixa/comida gatos
  laundry: '🧺', // lavar roupas
};

// ============================================
// REGISTRAR TODOS OS LISTENERS ANTES DE INICIALIZAR
// ============================================

client.on("loading_screen", (percent, message) => {
  console.log(`[Cliente] Carregando: ${percent}% - ${message}`);
});

client.on("qr", (qr) => {
  console.log("\n[Eventos] ⏳ QR CODE - Escaneie com seu WhatsApp:\n");
  qrcodeTerminal.generate(qr, { small: true });
  console.log("\n[Eventos] QR Code gerado acima. Aguardando escaneamento...\n");
});

client.on("authenticated", () => {
  console.log("[Eventos] ✓ Autenticado com sucesso! Sessão salva em .wwebjs_auth");
  
  if (readyCheckStarted) return;
  readyCheckStarted = true;
  
  let checkAttempts = 0;
  const checkReadyInterval = setInterval(() => {
    checkAttempts++;
    console.log(`[Verificação] Tentativa ${checkAttempts}/50 - client.info: ${client.info ? 'SIM ✓' : 'não'}`);
    
    if (client.info) {
      console.log(`\n[Eventos] ✅ CLIENTE PRONTO!`);
      console.log(`[Eventos] Usuário conectado: ${client.info.pushname}`);
      clearInterval(checkReadyInterval);
    } else if (checkAttempts >= 50) {
      console.log(`\n[Eventos] ⏱️ Timeout após 25 segundos de espera`);
      console.log(`[Eventos] ⚠️ Continuando mesmo sem client.info...`);
      console.log(`[Eventos] 🤖 Bot está pronto para receber mensagens!\n`);
      clearInterval(checkReadyInterval);
    }
  }, 500);
});

client.on("remote_session_saved", () => {
  console.log("[Eventos] ✅ Sessão remota salva com sucesso!");
});

client.on("ready", () => {
  console.log("[Eventos] ✅ CLIENTE PRONTO! Bot online e aguardando mensagens");
});

client.on("change_state", (state) => {
  console.log(`[Eventos] 📊 Estado mudou para: ${state}`);
});

client.on("connection_lost", () => {
  console.log("[Eventos] ⚠️ Conexão perdida com WhatsApp Web");
});

client.on("error", (error) => {
  console.error("[Eventos] ❌ Erro:", error.message);
});

client.on("auth_failure", (msg) => {
  console.error("[Eventos] ❌ Falha na autenticação:", msg);
});

client.on("disconnected", (reason) => {
  console.log("[Eventos] 🔌 Cliente desconectado:", reason);
});

// ============================================
// LISTENER DE MENSAGENS (REGISTRAR ANTES DE INICIALIZAR)
// ============================================

client.on("message", async (msg) => {
  const timestamp = new Date().toLocaleTimeString("pt-BR");
  const isGroup = msg.from.endsWith("@g.us");
  const body = msg.body.trim();

  // Comando para listar atividades
  if ((body === "!atividades" || body === "!atividades") && isGroup) {
    console.log(`\n[${timestamp}] 📨 COMANDO: !atividades`);
    const linhas = Object.keys(activityMap).map((k) => `${k} - ${activityMap[k].name} = ${activityMap[k].points}pt`);
    msg.reply("Tabela de Atividades:\n" + linhas.join('\n'));
    return;
  }

  // Comando !feito
  if (body.startsWith("!feito") && isGroup) {
    console.log(`\n[${timestamp}] 📨 COMANDO: !feito`);
    const nomeUsuario = await getNomeUsuario(msg.author);
    const arg = body.substring(6).trim();

    if (!arg) {
      msg.reply("Atividade não existente na tabela, consulte utilizando !atividades para saber todas as possibilidades.");
      return;
    }

    // tenta interpretar como número
    let activityId = null;
    if (/^\d+$/.test(arg)) {
      const idNum = parseInt(arg, 10);
      if (activityMap[idNum]) activityId = idNum;
    } else {
      // compara pelo nome exato (case-insensitive)
      const lower = arg.toLowerCase();
      for (const k of Object.keys(activityMap)) {
        if (activityMap[k].name.toLowerCase() === lower) {
          activityId = parseInt(k, 10);
          break;
        }
      }
    }

    if (!activityId) {
      msg.reply("Atividade não existente na tabela, consulte utilizando !atividades para saber todas as possibilidades.");
      return;
    }

    // registra no banco
    const resultado = await registrarAtividade(nomeUsuario, activityId);
    console.log(`[registrarAtividade] Resultado: ${resultado}`);

    // gerar ranking e responder
    const tabela = await gerarTabelaAtividades();
    msg.reply(tabela);
    return;
  }

  // mantém outros comandos originais (ex: !treino, !status, !p) se necessário
});

// ============================================
// AGORA INICIALIZAR O CLIENTE
// ============================================

console.log("Inicializando cliente...");
client.initialize();
console.log("Cliente inicializado. Aguardando eventos...\n");

const PORT = process.env.PORT || 4033;
app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});

const insertNewActivityLog = async (memberName, activity) => {
  try {
    const res = await addDoc(collection(db, "data-atividades"), {
      nome: memberName,
      atividade: activity.name,
      pontos: activity.points,
      "data-atividade": new Date(),
    });
    return res.id;
  } catch (error) {
    console.error(`[insertNewActivityLog] Erro ao inserir atividade para ${memberName}:`, error);
    return null;
  }
};

async function registrarAtividade(nomeUsuario, activityId) {
  try {
    const membrosRef = doc(db, "atividadesDeCasa2026", nomeUsuario);
    const membroDoc = await getDoc(membrosRef);

    const activity = activityMap[activityId];
    if (!activity) throw new Error('Atividade inválida');

    if (membroDoc.exists()) {
      const dados = membroDoc.data();
      const counts = dados.counts || {};
      const currentCount = counts[activityId] || 0;
      counts[activityId] = currentCount + 1;

      const novoTotal = (dados.totalPoints || 0) + activity.points;

      await updateDoc(membrosRef, {
        totalPoints: novoTotal,
        counts: counts,
        nome: nomeUsuario,
      });

      await insertNewActivityLog(nomeUsuario, activity);
      return `Atividade registrada: ${activity.name} (${activity.points}pt) para ${nomeUsuario}`;
    } else {
      const counts = {};
      counts[activityId] = 1;
      await setDoc(membrosRef, {
        nome: nomeUsuario,
        totalPoints: activity.points,
        counts: counts,
      });

      await insertNewActivityLog(nomeUsuario, activity);
      return `Membro ${nomeUsuario} criado e atividade registrada.`;
    }
  } catch (error) {
    console.error("Erro ao registrar atividade:", error);
    return "Erro ao registrar atividade.";
  }
}

const gerarTabelaAtividades = async () => {
  try {
    let tabela = "Ranking de Atividades:\n";
    const membrosRef = collection(db, "atividadesDeCasa2026");
    const snapshot = await getDocs(membrosRef);

    const membros = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.nome) {
        membros.push({
          nome: data.nome,
          totalPoints: data.totalPoints || 0,
          counts: data.counts || {},
        });
      }
    });

    if (membros.length === 0) {
      return "Nenhum membro encontrado.";
    }

    // Ordena pelo total de pontos
    membros.sort((a, b) => b.totalPoints - a.totalPoints);

    // calcula líderes por atividade para emojis
    const leaders = {};
    for (const k of Object.keys(activityMap)) {
      let top = null;
      let topCount = 0;
      for (const m of membros) {
        const c = m.counts[k] || 0;
        if (c > topCount) {
          top = m.nome;
          topCount = c;
        }
      }
      if (top) leaders[k] = { nome: top, count: topCount };
    }

    // Monta linhas com medalhas e emojis de liderança
    const maxNomeLength = Math.max(...membros.map(m => m.nome.length));

    membros.forEach((m, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
      let line = `${index + 1} - ${m.nome.padEnd(maxNomeLength)} - ${m.totalPoints}pt ${medal}`;

      // adiciona emojis de liderança conforme as regras
      if (leaders[2] && leaders[2].nome === m.nome) line += ` ${EMOJI.dishes}`;
      if ((leaders[7] && leaders[7].nome === m.nome) || (leaders[8] && leaders[8].nome === m.nome)) line += ` ${EMOJI.cooking}`;
      if ((leaders[16] && leaders[16].nome === m.nome) || (leaders[17] && leaders[17].nome === m.nome)) line += ` ${EMOJI.cats}`;
      if (leaders[3] && leaders[3].nome === m.nome) line += ` ${EMOJI.laundry}`;

      tabela += line + '\n';
    });

    return tabela;
  } catch (error) {
    console.error("Erro ao gerar tabela de atividades:", error);
    return "Erro ao gerar tabela de atividades.";
  }
};

async function getNomeUsuario(numero) {
  try {
    const chat = await client.getChatById(numero);
    return chat ? chat.name : numero;
  } catch (error) {
    console.error("Erro ao obter nome do usuário:", error);
    return numero;
  }

}

const obterRespostaGPT = async (pergunta) => {
  try {
    const resposta = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: `Responda com no máximo 300 caracteres: ${pergunta}`,
        },
      ],
      max_tokens: 100,
    });

    let mensagem = resposta.choices[0].message.content.trim();

    if (mensagem.length > 300) {
      mensagem = mensagem.substring(0, 297) + "...";
    }

    return mensagem;
  } catch (error) {
    console.error("Erro ao chamar ChatGPT:", error);
    return "Desculpe, não consegui processar sua pergunta no momento.";
  }
};
