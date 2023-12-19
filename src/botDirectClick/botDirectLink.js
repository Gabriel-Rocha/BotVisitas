const puppeteer = require('puppeteer');

const urls = [
  // Adicione suas URLs aqui
  'https://www.toprevenuegate.com/gdc7b45t?key=5d4c01a272248790f8e17c7c266b78ac'
];

const maxCliquesPorPagina = 15;

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

async function simularAcesso() {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  // Aumenta o tempo limite para a execução de scripts para evitar o erro
  await page.setDefaultNavigationTimeout(0);
  await page.setDefaultTimeout(0); // Aumenta o tempo limite para a execução de scripts

  // Configuração do User-Agent
  await page.setUserAgent(getRandomUserAgent());

  console.log('Iniciando simulação de acesso.');

  while (true) {
    for (const url of urls) {
      try {
        console.log(`Acessando página: ${url}`);
        await page.goto(url);

        // Simula cliques no centro da tela
        const x = 1920 / 2; // Meio da largura da tela
        const y = 1080 / 2; // Meio da altura da tela

        const numCliques = Math.floor(Math.random() * maxCliquesPorPagina) + 1;
        console.log(`Realizando ${numCliques} cliques no centro da tela.`);
        for (let i = 0; i < numCliques; i++) {
          await page.mouse.click(x, y);
        }

        // Gera um intervalo aleatório entre 1 minuto (60 segundos) e 60 minutos (3600 segundos)
        const intervaloAleatorio = Math.floor(Math.random() * 3540) + 60;
        console.log(`Aguardando ${intervaloAleatorio} segundos até o próximo acesso...`);
        await page.waitForTimeout(intervaloAleatorio * 1000);
      } catch (error) {
        // Captura o erro e continua a execução do código
        console.log(`Ocorreu um erro ao acessar a página: ${url}`);
        console.log(error);
        continue;
      }
    }
  }
}

console.log('Iniciando o aplicativo.');

// Inicialize a simulação de acesso pela primeira vez
simularAcesso();
