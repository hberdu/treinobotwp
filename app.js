require('dotenv').config();
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const app = express();
const port = 3000;


const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth_treino') }),
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
  
  // Verificar apenas uma vez se client.info fica disponível
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

// Quando a sessão é restaurada (sem precisar de QR code)
client.on("remote_session_saved", () => {
  console.log("[Eventos] ✅ Sessão remota salva com sucesso!");
});

client.on("ready", () => {
  console.log("[Eventos] ✅ CLIENTE PRONTO! Bot online e aguardando mensagens");
});

// Listener para mudança de estado
client.on("change_state", (state) => {
  console.log(`[Eventos] 📊 Estado mudou para: ${state}`);
});

// Listener para conexão perdida
client.on("connection_lost", () => {
  console.log("[Eventos] ⚠️ Conexão perdida com WhatsApp Web");
});

// Listener para erro geral
client.on("error", (error) => {
  console.error("[Eventos] ❌ Erro:", error.message);
});

// Listener para falha de autenticação
client.on("auth_failure", (msg) => {
  console.error("[Eventos] ❌ Falha na autenticação:", msg);
});

// Listener para desconexão
client.on("disconnected", async (reason) => {
  console.log("[Eventos] 🔌 Cliente desconectado:", reason);
  console.log("[Eventos] 🔄 Tentando reconectar em 10 segundos...");
  setTimeout(async () => {
    try {
      await client.initialize();
      console.log("[Eventos] Reconexão bem-sucedida.");
    } catch (error) {
      console.error("[Eventos] Erro na reconexão:", error);
    }
  }, 10000); // 10 segundos de delay
});

// ============================================
// LISTENER DE MENSAGENS (REGISTRAR ANTES DE INICIALIZAR)
// ============================================

client.on("message", async (msg) => {
  try {
    const timestamp = new Date().toLocaleTimeString("pt-BR");
    const isGroup = msg.from.endsWith("@g.us");
    
    if (msg.body.startsWith("!treino") && msg.from.endsWith("@g.us")) {
    console.log(`\n[${timestamp}] 📨 COMANDO: !treino`);
    console.log(`[Handler] Comando !treino detectado`);
    const nomeUsuario = await getNomeUsuario(msg.author);
    console.log(`[Handler] Nome do usuário: ${nomeUsuario}`);
    const mensagemRetorno = await processarMensagem("!treino", nomeUsuario);

    if (mensagemRetorno) {
      try {
        await msg.reply(mensagemRetorno);
      } catch (replyError) {
        console.error("[Handler] Erro ao enviar resposta para !treino:", replyError.message);
      }
    } else {
      console.error("Mensagem de retorno vazia.");
      try {
        await msg.reply("Erro ao gerar a mensagem de retorno.");
      } catch (replyError) {
        console.error("[Handler] Erro ao enviar mensagem de erro para !treino:", replyError.message);
      }
    }
  } else if (msg.body.startsWith("!status") && msg.from.endsWith("@g.us")) {
    console.log(`\n[${timestamp}] 📨 COMANDO: !status`);
    console.log(`[Handler] Comando !status detectado`);
    const nomeUsuario = await getNomeUsuario(msg.author);
    console.log(`[Handler] Nome do usuário: ${nomeUsuario}`);
    const mensagemRetorno = await processarMensagemSemAtualizar(
      "!status",
      nomeUsuario
    );

    if (mensagemRetorno) {
      try {
        await msg.reply(mensagemRetorno);
      } catch (replyError) {
        console.error("[Handler] Erro ao enviar resposta para !status:", replyError.message);
      }
    } else {
      console.error("Mensagem de retorno vazia.");
      try {
        await msg.reply("Erro ao gerar a mensagem de retorno.");
      } catch (replyError) {
        console.error("[Handler] Erro ao enviar mensagem de erro para !status:", replyError.message);
      }
    }
  } else if (
    (msg.body.startsWith("!pergunta ") || msg.body.startsWith("!p ")) &&
    msg.from.endsWith("@g.us")
  ) {
    console.log(`\n[${timestamp}] 📨 COMANDO: ${msg.body.startsWith("!p ") ? "!p" : "!pergunta"}`);
    console.log(`[Handler] Comando de pergunta detectado`);
    let pergunta;
    if (msg.body.startsWith("!p ")) {
      pergunta = msg.body.substring(3).trim();
    } else {
      pergunta = msg.body.substring(10).trim();
    }

    if (pergunta) {
      console.log(`[Handler] Pergunta para GPT: "${pergunta}"`);
      const resposta = await obterRespostaGPT(pergunta);
      console.log(`[Handler] Respondendo com: "${resposta}"`);
      try {
        await msg.reply(resposta);
      } catch (replyError) {
        console.error("[Handler] Erro ao enviar resposta para pergunta:", replyError.message);
      }
    } else {
      try {
        await msg.reply("Por favor, digite uma pergunta após o comando !p ou !pergunta");
      } catch (replyError) {
        console.error("[Handler] Erro ao enviar mensagem de erro para pergunta:", replyError.message);
      }
    }
  }
  } catch (error) {
    console.error("[Eventos] Erro no processamento da mensagem:", error);
  }
});

// ============================================
// AGORA INICIALIZAR O CLIENTE
// ============================================

(async () => {
  console.log("Inicializando cliente...");
  try {
    await client.initialize();
    console.log("Cliente inicializado. Aguardando eventos...\n");
  } catch (error) {
    console.error("Erro ao inicializar cliente:", error);
    process.exit(1);
  }
})();

const PORT = process.env.PORT || 4020;
app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});

const insertNewTraining = async (athleteName) => {
  try {
    console.log(`[insertNewTraining] Iniciando inserção de treino para: ${athleteName}`);
    const res = await addDoc(collection(db, "data-treino"), {
      nome: athleteName,
      "data-treino": new Date(),
    });
    console.log(`[insertNewTraining] Treino inserido com sucesso. ID: ${res.id}`);
  } catch (error) {
    console.error(`[insertNewTraining] Erro ao inserir treino para ${athleteName}:`, error);
    return "Erro ao inserir treino.";
  }
};

async function inserirAtleta(nomeUsuario) {
  try {
    console.log(`[inserirAtleta] Processando atleta: ${nomeUsuario}`);
    const atletaRef = doc(db, "atletas2026", nomeUsuario);

    const atletaDoc = await getDoc(atletaRef);
    console.log(`[inserirAtleta] Documento encontrado: ${atletaDoc.exists()}`);


    if (atletaDoc.exists()) {
      const dadosAtleta = atletaDoc.data();
      console.log(`[inserirAtleta] Dados do atleta encontrados:`, dadosAtleta);

      await insertNewTraining(dadosAtleta.nome);


      if (!dadosAtleta || typeof dadosAtleta.treinos === "undefined") {
        throw new Error("Dados do atleta estão incompletos ou inválidos.");
      }

      const novoNumeroTreinos = (dadosAtleta.treinos || 0) + 1;
      let progresso = dadosAtleta.progresso || 0;
      const meta = dadosAtleta.meta || 5;
      let progressoSemanal = dadosAtleta.progressoSemanal || 0;

      progresso += 1;

      if (progresso === meta) {
        progressoSemanal += 1;
      }

      await updateDoc(atletaRef, {
        treinos: novoNumeroTreinos,
        progresso: progresso,
        progressoSemanal: progressoSemanal,
        meta: meta,
      });
      console.log(`[inserirAtleta] Atleta ${nomeUsuario} atualizado. Treinos: ${novoNumeroTreinos}, Progresso: ${progresso}`);

      return `Número de treinos de ${nomeUsuario} atualizado para ${novoNumeroTreinos}.`;
    } else {
      console.log(`[inserirAtleta] Novo atleta. Criando documento para: ${nomeUsuario}`);
      await setDoc(atletaRef, {
        nome: nomeUsuario,
        treinos: 1,
        progresso: 1,
        progressoSemanal: 0,
        meta: 5,
      });

      await insertNewTraining(nomeUsuario);
      console.log(`[inserirAtleta] Novo atleta ${nomeUsuario} criado com sucesso`);

      return `Atleta ${nomeUsuario}, seu primeiro treino foi gerado.`;
    }
  } catch (error) {
    console.error("Erro ao inserir/atualizar atleta:", error);
    return "Erro ao inserir/atualizar atleta.";
  }
}

async function processarMensagem(mensagem, nomeUsuario) {
  const semanaAtual = getSemanaAtual();
  const semanasNoAno = 52;
  const semanasRestantes = semanasNoAno - semanaAtual;
  if (mensagem === "!treino") {
    try {
      const mensagemAtleta = await inserirAtleta(nomeUsuario);
      const { segunda, domingo } = getSegundaEDomingoDaSemanaAtual();
      const texto = `
Projeto semana ${semanaAtual}/${semanasNoAno} 
(${segunda.toLocaleDateString("pt-br")} - ${domingo.toLocaleDateString(
        "pt-br"
      )})
${semanasRestantes} semanas restantes no ano
      `;
      const tabelaTreinos = await gerarTabelaTreinos();
      const mensagemFinal = `\`\`\`
${mensagemAtleta}
${texto}
${tabelaTreinos}
\`\`\``;

      console.log("Mensagem final:\n", mensagemFinal);
      return mensagemFinal;
    } catch (error) {
      console.error("Erro ao processar a mensagem:", error);
      return "Ocorreu um erro ao processar sua solicitação.";
    }
  }
}

async function processarMensagemSemAtualizar(mensagem, nomeUsuario) {
  const semanaAtual = getSemanaAtual();
  const semanasNoAno = 52;
  const semanasRestantes = semanasNoAno - semanaAtual;
  if (mensagem === "!status") {
    try {
      const { segunda, domingo } = getSegundaEDomingoDaSemanaAtual();
      const texto = `
Projeto semana ${semanaAtual}/${semanasNoAno} 
(${segunda.toLocaleDateString("pt-br")} - ${domingo.toLocaleDateString(
        "pt-br"
      )})
${semanasRestantes} semanas restantes no ano
`;

      const tabelaTreinos = await gerarTabelaTreinos();
      const mensagemFinal = `\`\`\`
      ${texto}
      ${tabelaTreinos}
      \`\`\``;
      console.log("Mensagem final:\n", mensagemFinal);
      return mensagemFinal;
    } catch (error) {
      console.error("Erro ao processar a mensagem:", error);
      return "Ocorreu um erro ao processar sua solicitação.";
    }
  }
}

function getSemanaAtual() {
  const hoje = new Date();
  const inicioDoAno = new Date(hoje.getFullYear(), 0, 1);
  const diff = hoje - inicioDoAno;
  const umaSemanaEmMilissegundos = 1000 * 60 * 60 * 24 * 7;
  const semana = Math.floor(diff / umaSemanaEmMilissegundos) + 1;
  return semana;
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
    console.error("Erro ao obter nome do usuário:", error);
    return "Nome do usuário não encontrado";
  }
}

const gerarTabelaTreinos = async () => {
  const semanasNoAno = 52;
  try {
    let tabela = "Tabela de Treinos:\n";
    const atletasRef = collection(db, "atletas2026");
    const snapshot = await getDocs(atletasRef);

    const atletas = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data && data.nome) {
        atletas.push({
          nome: data.nome,
          treinos: data.treinos || 0,
          progresso: data.progresso || 0,
          meta: data.meta || 5,
          progressoSemanal: data.progressoSemanal || 0,
        });
      } else {
        console.warn(`Dados incompletos para o documento: ${doc.id}`);
      }
    });

    if (atletas.length === 0) {
      throw new Error("Nenhum atleta encontrado ou dados incompletos.");
    }

    // Ordena os atletas pelo progresso semanal e depois pela quantidade de treinos
    atletas.sort((a, b) => {
      if (b.progressoSemanal !== a.progressoSemanal) {
        return b.progressoSemanal - a.progressoSemanal;
      } else {
        return b.treinos - a.treinos;
      }
    });

    // Calcula o comprimento máximo de nome e treinos para formatação
    const maxNomeLength = Math.max(
      ...atletas.map((atleta) => {
        if (!atleta.nome) {
          console.error("Nome do atleta está indefinido:", atleta);
          throw new Error("Nome do atleta está indefinido.");
        }
        return atleta.nome.length;
      })
    );
    console.log(maxNomeLength);

    atletas.forEach((atleta, index) => {
      const progressoTexto = `${atleta.progresso}/${atleta.meta} - ${atleta.progressoSemanal}/${semanasNoAno}`;

      let linha = `${atleta.nome.padEnd(maxNomeLength)} ${String(
        atleta.treinos
      ).padStart(1)}`;

      // Define o emoji da medalha de acordo com a posição e adiciona ao final da linha
      if (index === 0) {
        linha += ` ${progressoTexto} 🥇\n`;
      } else if (index === 1) {
        linha += ` ${progressoTexto} 🥈\n`;
      } else if (index === 2) {
        linha += ` ${progressoTexto} 🥉\n`;
      } else {
        linha += ` ${progressoTexto}\n`;
      }

      tabela += linha;
    });

    return tabela;
  } catch (error) {
    console.error("Erro ao gerar tabela de treinos:", error);
    return "Erro ao gerar tabela de treinos.";
  }
};

const obterRespostaGPT = async (pergunta) => {
  try {
    console.log(`[obterRespostaGPT] Enviando pergunta ao ChatGPT: "${pergunta}"`);
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
    console.log(`[obterRespostaGPT] Resposta recebida (${mensagem.length} caracteres): "${mensagem.substring(0, 100)}..."`);

    if (mensagem.length > 300) {
      console.log(`[obterRespostaGPT] Resposta excedia 300 caracteres, truncando...`);
      mensagem = mensagem.substring(0, 297) + "...";
    }

    return mensagem;
  } catch (error) {
    console.error("Erro ao chamar ChatGPT:", error);
    return "Desculpe, não consegui processar sua pergunta no momento.";
  }
};
