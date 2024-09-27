const express = require("express");
const { Client } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const app = express();
const port = 3000;

const client = new Client();

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

client.initialize();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});

client.on("qr", (qr) => {
  qrcodeTerminal.generate(qr, { small: true });
});

const insertNewTraining = async (athleteName) => {
  try {
    const res = await addDoc(collection(db, "data-treino"), {
      nome: athleteName,
      "data-treino": new Date(),
    });
  } catch (error) {
    console.error("Erro ao inserir treino", error);
    return "Erro ao inserir treino.";
  }
};

async function inserirAtleta(nomeUsuario) {
  try {
    const atletaRef = doc(db, "atletas", nomeUsuario);

    const atletaDoc = await getDoc(atletaRef);

    if (atletaDoc.exists()) {
      const dadosAtleta = atletaDoc.data();

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

      return `Número de treinos de ${nomeUsuario} atualizado para ${novoNumeroTreinos}.`;
    } else {
      await setDoc(atletaRef, {
        nome: nomeUsuario,
        treinos: 1,
        progresso: 1,
        progressoSemanal: 0,
        meta: 5,
      });

      await insertNewTraining(nomeUsuario);

      return `Atleta ${nomeUsuario}, seu primeiro treino foi gerado.`;
    }
  } catch (error) {
    console.error("Erro ao inserir/atualizar atleta:", error);
    return "Erro ao inserir/atualizar atleta.";
  }
}

async function processarMensagem(mensagem, nomeUsuario) {
  if (mensagem === "!treino") {
    try {
      const mensagemAtleta = await inserirAtleta(nomeUsuario);
      const { segunda, sexta, semanasRestantes } =
        getSegundaEsextaDaSemanaAtual();
      const texto = `
Projeto semana ${semanaAtual}/${semanasNoAno} 
(${segunda.toLocaleDateString()} - ${sexta.toLocaleDateString()})
${semanasRestantes} semanas restantes no ano
      `;

      const progressoSemanal = await getProgressoSemanal(nomeUsuario);
      const tabelaTreinos = await gerarTabelaTreinos();

      // Formatar mensagem com crases para texto monoespaçado
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

function getSemanaAtual() {
  const hoje = new Date();
  const inicioDoAno = new Date(hoje.getFullYear(), 0, 1);
  const diff = hoje - inicioDoAno;
  const umaSemanaEmMilissegundos = 1000 * 60 * 60 * 24 * 7;
  const semana = Math.floor(diff / umaSemanaEmMilissegundos) + 1;
  return semana;
}

const semanaAtual = getSemanaAtual();
const semanasNoAno = 52;

function getSegundaEsextaDaSemanaAtual() {
  const dataAtual = new Date();
  const diaSemana = dataAtual.getDay();
  const diffSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const diffSexta = diaSemana === 0 ? 5 : 5 - diaSemana;

  const segunda = new Date(dataAtual.getTime());
  segunda.setDate(dataAtual.getDate() + diffSegunda);

  const sexta = new Date(dataAtual.getTime());
  sexta.setDate(dataAtual.getDate() + diffSexta);

  const semanasRestantes = semanasNoAno - semanaAtual;

  return { segunda, sexta, semanasRestantes };
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
  try {
    let tabela = "Tabela de Treinos:\n";
    const atletasRef = collection(db, "atletas");
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

    // Ordena os atletas pelo progresso semanal
    atletas.sort((a, b) => b.progressoSemanal - a.progressoSemanal);

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

async function getProgressoSemanal(nomeUsuario) {
  try {
    const atletaRef = doc(db, "atletas", nomeUsuario);
    const atletaDoc = await getDoc(atletaRef);

    if (atletaDoc.exists()) {
      const dadosAtleta = atletaDoc.data();
      const progressoSemanal = dadosAtleta.progressoSemanal || 0;
      const progresso = dadosAtleta.progresso || 0;
      const meta = dadosAtleta.meta || 5;

      return `${progresso}/${meta} - Progresso Semanal: ${progressoSemanal}/${semanasNoAno}`;
    } else {
      return "Atleta não encontrado";
    }
  } catch (error) {
    console.error("Erro ao obter progresso semanal:", error);
    return "Erro ao obter progresso semanal.";
  }
}

client.on("ready", () => {
  console.log("QR code escaneado, Aplicação online");
});

client.on("message", async (msg) => {
  if (msg.body.startsWith("!treino") && msg.from.endsWith("@g.us")) {
    const nomeUsuario = await getNomeUsuario(msg.author);
    const mensagemRetorno = await processarMensagem("!treino", nomeUsuario);

    if (mensagemRetorno) {
      msg.reply(mensagemRetorno);
    } else {
      console.error("Mensagem de retorno vazia.");
      msg.reply("Erro ao gerar a mensagem de retorno.");
    }
  }
});
