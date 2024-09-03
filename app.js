const express = require("express");
const { Client } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path"); // Importar o módulo path
const app = express();
const client = new Client({});

// Import the functions you need from the SDKs you need
const { initializeApp } = require("firebase/app");
const { getFirestore, doc, getDoc, updateDoc, setDoc, collection, getDocs } = require("firebase/firestore");

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD2prl1jdMUdkNdQkidySfYFwTdLkinZV4",
  authDomain: "treinobot.firebaseapp.com",
  databaseURL: "https://treinobot-default-rtdb.firebaseio.com",
  projectId: "treinobot",
  storageBucket: "treinobot.appspot.com",
  messagingSenderId: "720957000050",
  appId: "1:720957000050:web:b753545187bf4f186ff5eb"
};

// Initialize Firebase
const appFirebase = initializeApp(firebaseConfig);
const db = getFirestore();

// Serve the index.html file
app.get("/", (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  fs.readFile(indexPath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading HTML file:", err);
      return res.status(500).send("Error loading page.");
    }
    res.send(data);
  });
});

// Serve the index.html file for /iniciar-chatbot
app.get("/iniciar-chatbot", (req, res) => {
  const indexPath = path.join(__dirname, "public", "chatbot.html");
  fs.readFile(indexPath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading HTML file:", err);
      return res.status(500).send("Error loading page.");
    }
    res.send(data);
  });
});

// Endpoint para iniciar o chatbot e gerar o QR code
app.get("/iniciar-chatbot", async (req, res) => {
  try {
    // Inicializar o cliente do WhatsApp
    client.initialize();

    // Gerar o QR code
    client.on("qr", async (qr) => {
      try {
        const qrCodeUrl = await generateQRCode(qr);
        res.json({ qrcode: qrCodeUrl, status: "Aguardando escaneamento" });
      } catch (error) {
        console.error("Erro ao gerar QR code:", error);
        res.status(500).json({ qrcode: null, status: "Erro ao gerar QR code" });
      }
    });
  } catch (error) {
    console.error("Erro ao iniciar o chatbot:", error);
    res.status(500).json({ qrcode: null, status: "Erro ao iniciar o chatbot" });
  }
});

// Função para gerar o QR code
async function generateQRCode(qrData) {
  return new Promise((resolve, reject) => {
    qrcode.toDataURL(qrData, (err, url) => {
      if (err) {
        reject(err);
      } else {
        resolve(url);
      }
    });
  });
}

// Função para inserir/atualizar um atleta
async function inserirAtleta(nomeUsuario) {
  // Verificar se o atleta já existe no banco
  const atletaRef = doc(db, "atletas", nomeUsuario);
  const atletaDoc = await getDoc(atletaRef);

  if (atletaDoc.exists()) {
    // Atualizar o número de treinos
    const novoNumeroTreinos = atletaDoc.data().treinos + 1;
    await updateDoc(atletaRef, {
      treinos: novoNumeroTreinos,
    });
    return `Número de treinos de *${nomeUsuario}* atualizado para ${novoNumeroTreinos}`;
  } else {
    // Criar novo atleta
    await setDoc(atletaRef, {
      nome: nomeUsuario,
      treinos: 1,
    });
    return `Atleta *${nomeUsuario}*, seu primeiro treino foi gerado.`;
  }
}

// Função para processar a mensagem
async function processarMensagem(mensagem, nomeUsuario) {
  if (mensagem === "!treino") {
    try {
      const mensagemAtleta = await inserirAtleta(nomeUsuario);
      console.log("Inserção de treino concluída com sucesso!");
      const { segunda, sexta, semanasRestantes } = getSegundaEsextaDaSemanaAtual();
      const texto = `
        Projeto semana ${semanaAtual}/${semanasNoAno} 
        (${segunda.toLocaleDateString()} - ${sexta.toLocaleDateString()})
        ${semanasRestantes} semanas restantes no ano
      `;

      const progressoSemanal = await getProgressoSemanal(nomeUsuario);

      const tabelaTreinos = await gerarTabelaTreinos();

      return `${mensagemAtleta}\n${texto}\nProgresso semanal: ${progressoSemanal}\n${tabelaTreinos}`;
    } catch (error) {
      console.error("Erro ao inserir/atualizar atleta:", error);
      return "Ocorreu um erro ao processar sua solicitação.";
    }
  }
}

// Função para obter a semana atual
function getSemanaAtual() {
  const hoje = new Date();
  const inicioDoAno = new Date(hoje.getFullYear(), 0, 1);
  const diff = hoje - inicioDoAno;
  const umaSemanaEmMilissegundos = 1000 * 60 * 60 * 24 * 7;
  const semana = Math.floor(diff / umaSemanaEmMilissegundos) + 1;
  return semana;
}

// Exemplo de uso da função
const semanaAtual = getSemanaAtual();
const semanasNoAno = 52; // Definindo um valor padrão de semanas no ano

// Calcular a data da segunda-feira da semana atual e da sexta-feira da mesma semana
function getSegundaEsextaDaSemanaAtual() {
  const dataAtual = new Date();
  const diaSemana = dataAtual.getDay(); // 0 (domingo) a 6 (sábado)
  const diffSegunda = diaSemana === 0 ? -6 : 1 - diaSemana; // Dia da semana atual até a segunda-feira
  const diffSexta = diaSemana === 0 ? 5 : 5 - diaSemana; // Dia da semana atual até a sexta-feira

  const segunda = new Date(dataAtual.getTime()); // Criando nova instância para segunda-feira
  segunda.setDate(dataAtual.getDate() + diffSegunda);

  const sexta = new Date(dataAtual.getTime()); // Criando nova instância para sexta-feira
  sexta.setDate(dataAtual.getDate() + diffSexta);

  // Calcular semanas restantes no ano
  const semanasRestantes = semanasNoAno - semanaAtual;

  return { segunda, sexta, semanasRestantes };
}

// Função para obter o nome do usuário com base no número
async function getNomeUsuario(numero) {
  try {
    const chat = await client.getChatById(numero);
    return chat.name;
  } catch (error) {
    console.error("Erro ao obter nome do usuário:", error);
    return "Nome do usuário não encontrado";
  }
}

// Função para gerar uma tabela com todos os treinos
async function gerarTabelaTreinos() {
  try {
    let tabela = "Tabela de Treinos:\n";
    const atletasRef = collection(db, "atletas");
    const snapshot = await getDocs(atletasRef);

    // Array para armazenar os dados dos atletas
    const atletas = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      atletas.push({ nome: data.nome, treinos: data.treinos });
    });

    // Ordenar atletas pelo número de treinos
    atletas.sort((a, b) => b.treinos - a.treinos);

    // Adicionar emojis para os atletas com maior número de treinos
    atletas.forEach((atleta, index) => {
      tabela += `*${atleta.nome}*: ${atleta.treinos} treinos`;

      // Adicionar emojis para o primeiro e segundo colocados
      if (index === 0) {
        tabela += " 🥇"; // Emoji de medalha de ouro
      } else if (index === 1) {
        tabela += " 🥈"; // Emoji de medalha de prata
      }

      tabela += "\n";
    });

    return tabela;
  } catch (error) {
    console.error("Erro ao gerar tabela de treinos:", error);
    return "Erro ao gerar tabela de treinos.";
  }
}

// Função para obter o progresso semanal do usuário
async function getProgressoSemanal(nomeUsuario) {
  try {
    const atletaRef = doc(db, "atletas", nomeUsuario);
    const atletaDoc = await getDoc(atletaRef);

    if (atletaDoc.exists()) {
      const treinosSemana = atletaDoc.data().treinos % 5;
      return `${treinosSemana}/5`;
    } else {
      return "Atleta não encontrado";
    }
  } catch (error) {
    console.error("Erro ao obter progresso semanal:", error);
    return "Erro ao obter progresso semanal.";
  }
}

// Exemplo de uso da função
client.on("ready", () => {
  console.log("Aplicação Online");
});

// Exemplo de uso da função
client.on("message", async (message) => {
  if (message.body.startsWith("!treino") && message.from.endsWith("@g.us")) {
    // Verifica se a mensagem é de um grupo
    const nomeUsuario = await getNomeUsuario(message.author);
    const mensagemRetorno = await processarMensagem("!treino", nomeUsuario);
    client.sendMessage(message.from, mensagemRetorno);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
