const puppeteer = require('puppeteer');

const urls = [
  // urls
];

const maxCliquesPorPagina = 15;
const numSimultaneousPages = 5; // Altere para o número desejado de páginas acessadas simultaneamente

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/16.16299',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/100.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/14.0.3',
];


function getRandomUserAgent() {
  const randomIndex = Math.floor(Math.random() * userAgents.length);
  return userAgents[randomIndex];
}

async function simularAcesso(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(0);
  await page.setDefaultTimeout(0);
  await page.setUserAgent(getRandomUserAgent());

  try {
    console.log(`Acessando página: ${url}`);
    await page.goto(url);

    const x = 1920 / 2;
    const y = 1080 / 2;
    const numCliques = Math.floor(Math.random() * maxCliquesPorPagina) + 1;

    console.log(`Realizando ${numCliques} cliques no centro da tela.`);
    for (let i = 0; i < numCliques; i++) {
      await page.mouse.click(x, y);
    }
  } catch (error) {
    console.log(`Ocorreu um erro ao acessar a página: ${url}`);
    console.error(error);
  } finally {
    await browser.close();
  }
}

console.log('Iniciando o aplicativo.');

// Função assíncrona que contém o loop infinito
async function iniciarSimulacao() {
  while (true) {
    const promises = urls.slice(0, numSimultaneousPages).map(url => simularAcesso(url));

    await Promise.all(promises)
      .then(() => {
        console.log('Simulação de acesso concluída para as páginas atuais.');
      })
      .catch((error) => {
        console.error('Erro durante a simulação de acesso:', error);
      });

    // Aguarde um intervalo antes de iniciar o próximo conjunto de acessos
    const intervaloEntreAcessos = 2000; // em milissegundos (2 segundos)
    console.log(`Aguardando ${intervaloEntreAcessos / 1000} segundos até o próximo conjunto de acessos...`);
    await new Promise(resolve => setTimeout(resolve, intervaloEntreAcessos));
  }
}

// Inicie a simulação
iniciarSimulacao();
