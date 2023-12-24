const puppeteer = require('puppeteer');

const urls = [
  // Adicione suas URLs aqui
  'https://www.toprevenuegate.com/t7ub7j14r?key=dc75d3afad8a6e3edf3f40e3cd753a71'
];

const maxCliquesPorPagina = 15;

const userAgents = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 12; SM-G991B Build/PPP3.222110.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.120 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.105 Mobile Safari/537.36',
  'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
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
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium', // Caminho para o Chromium
    args: ['--no-sandbox'],
  });

  console.log('Iniciando simulação de acesso.');

  while (true) {
    for (const url of urls) {
      const page = await browser.newPage();

      // Aumenta o tempo limite para a execução de scripts para evitar o erro
      await page.setDefaultNavigationTimeout(0);
      await page.setDefaultTimeout(0); // Aumenta o tempo limite para a execução de scripts

      // Configuração do User-Agent
      await page.setUserAgent(getRandomUserAgent());

      try {
        console.log(`Acessando página: ${url}`);
        await page.goto(url);

        // Simula cliques aleatórios entre 1 e maxCliquesPorPagina
        const numCliques = Math.floor(Math.random() * maxCliquesPorPagina) + 1;
        console.log(`Realizando ${numCliques} cliques na página.`);
        for (let i = 0; i < numCliques; i++) {
          const x = Math.random() * (1920 - 1) + 1; // Gere coordenadas x aleatórias
          const y = Math.random() * (1080 - 1) + 1; // Gere coordenadas y aleatórias
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
      } finally {
        // Fecha a página no final de cada iteração
        await page.close();
      }
    }
  }
}

console.log('Iniciando o aplicativo.');

// Inicialize a simulação de acesso pela primeira vez
simularAcesso();
