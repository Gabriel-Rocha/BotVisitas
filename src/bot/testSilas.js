const puppeteer = require('puppeteer');

const urls = [
  'https://leidimaia.blogspot.com/',
  'https://leidimaia.blogspot.com/2023/11/como-ganhar-dinheiro-com-fotografia.html',
  'https://leidimaia.blogspot.com/',
  'https://leidimaia.blogspot.com/2023/11/como-ganhar-dinheiro-com-fotografia.html',
  'https://leidimaia.blogspot.com/',
];

const maxCliquesPorPagina = 15;
const numSimultaneousPages = 5;
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

function getCurrentTimestamp() {
  const now = new Date();
  const timestamp = now.toISOString().slice(0, 19).replace("T", " ");
  return `[${timestamp}]`;
}

async function simularAcesso(url) {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(0);
  page.setDefaultTimeout(0);
  await page.setUserAgent(getRandomUserAgent());

  try {
    const timestamp = getCurrentTimestamp();
    console.log(`${timestamp} Acessando página: ${url}`);
    await page.goto(url);

    const x = 1920 / 2;
    const y = 1080 / 2;
    const numCliques = Math.floor(Math.random() * maxCliquesPorPagina) + 1;

    console.log(`${timestamp} Realizando ${numCliques} cliques no centro da tela.`);
    for (let i = 0; i < numCliques; i++) {
      await page.mouse.click(x, y);
    }
  } catch (error) {
    const timestamp = getCurrentTimestamp();
    console.log(`${timestamp} Ocorreu um erro ao acessar a página: ${url}`);
    console.error(error);
  } finally {
    await browser.close();
  }
}

console.log('Iniciando o aplicativo.');

async function iniciarSimulacao() {
  while (true) {
    const promises = urls.slice(0, numSimultaneousPages).map(url => simularAcesso(url));

    await Promise.all(promises)
      .then(() => {
        const timestamp = getCurrentTimestamp();
        console.log(`${timestamp} Simulação de acesso concluída para as páginas atuais.`);
      })
      .catch((error) => {
        console.error('Erro durante a simulação de acesso:', error);
      });

    const intervaloEntreAcessos = 1000;
    const timestamp = getCurrentTimestamp();
    console.log(`${timestamp} Aguardando ${intervaloEntreAcessos / 1000} segundos até o próximo conjunto de acessos...`);
    await new Promise(resolve => setTimeout(resolve, intervaloEntreAcessos));
  }
}

iniciarSimulacao();
