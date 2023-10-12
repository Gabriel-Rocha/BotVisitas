const fetch = require('node-fetch');

const siteURL = 'https://gabriel-rocha.github.io/';
const intervaloDeAcessoEmMilissegundos = 1000; // Acesso a cada 1 segundo

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/16.16299',
  // Adicione outros User-Agents aqui
];

function getRandomUserAgent() {
  const randomIndex = Math.floor(Math.random() * userAgents.length);
  return userAgents[randomIndex];
}

function acessarSite() {
  const headers = {
    'User-Agent': getRandomUserAgent(),
  };

  // Cria uma instância de fetch com a opção 'credentials' definida como 'include' para incluir cookies
  const fetchWithCookies = fetch(siteURL, {
    method: 'GET',
    headers,
    credentials: 'include', // Isso permite que cookies sejam enviados e recebidos
  });

  // Limpa os cookies antes de cada solicitação
  fetchWithCookies
    .then(response => {
      if (response.ok) {
        console.log(`Acessado com sucesso: ${siteURL}`);
      } else {
        console.error(`Erro ao acessar: ${siteURL}`);
      }
      return response.text(); // Adicionado para depuração
    })
    .then(data => {
      console.log(data); // Adicionado para depuração, exibe o conteúdo da página
    })
    .catch(error => {
      console.error(`Erro ao acessar: ${siteURL}`, error);
    });

  // Calcula o tempo passado em minutos
  const minutosPassados = process.uptime() / 60;
  console.log(`Tempo passado em minutos: ${minutosPassados.toFixed(2)} minutos.`);
}

console.log('Iniciando o aplicativo.');

setInterval(acessarSite, intervaloDeAcessoEmMilissegundos);
