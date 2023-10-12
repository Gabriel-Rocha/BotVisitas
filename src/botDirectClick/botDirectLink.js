const puppeteer = require('puppeteer');

const urls = [
  //adsterra
  'https://www.highcpmrevenuegate.com/ijanywbcx?key=afc18ac98661d4ce908fb577d6329cf4',
  'https://www.highcpmrevenuegate.com/ssn2stu0?key=fe6f57058786d13b1e1b3f3dc6bfcbb9',
  'https://www.highcpmrevenuegate.com/y5rthu80d?key=a80bd46037dcfb8c5a56907a82e4e850',
  'https://www.highcpmrevenuegate.com/hgrhpa17?key=8a376d3e507fc56a76daf9ca63f3294d',
  'https://www.highcpmrevenuegate.com/iiiw1zn27a?key=7fa6f5ae755a15fc5c159b77b4602c41',
  'https://www.highcpmrevenuegate.com/adgu51m44?key=8aeeec5d84a5be1aa6e98154e795d130',
  'https://www.highcpmrevenuegate.com/iv25c2mtj?key=d2c91fe22d26270dd7dd403464bf5227',
  'https://www.highcpmrevenuegate.com/p7zzca3m1?key=7b912895f148dba099a1aae2d07cb41f',
  'https://www.highcpmrevenuegate.com/v7ai60g4cp?key=5e827f600cec91c7f16ba17e00f24b94',
  'https://www.highcpmrevenuegate.com/i2a1b789h4?key=d916be92e7ab83e4d81b565aa6ec615f',
  'https://www.highcpmrevenuegate.com/r4ncmvqv9?key=282473cce469f7f11108ea96ba14fdf6',
  'https://www.highcpmrevenuegate.com/usd0wrn0?key=b142159adf737e1113f2eb376ee20655',
  'https://www.highcpmrevenuegate.com/hk53b9cm?key=214bf199157175a813d07859378dc5c5',
  'https://www.highcpmrevenuegate.com/nncnqbkiv?key=6b076955204f382d9e209d35c4a17159',
  "https://www.highcpmrevenuegate.com/i1nw65r6x?key=7342a536c2b806030599f926f0af654d"
];

const intervaloEntreAcessos = 1000;
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

        // Aguarde o intervalo definido até o próximo acesso
        console.log(`Aguardando ${intervaloEntreAcessos / 1000} segundos até o próximo acesso...`);
        await page.waitForTimeout(intervaloEntreAcessos);
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
