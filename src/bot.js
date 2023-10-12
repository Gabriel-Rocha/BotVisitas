const puppeteer = require('puppeteer');

const urls = [
  'https://resumotechbrasil.blogspot.com/',
  'https://resumotechbrasil.blogspot.com/2023/10/riscos-de-seguranca-em-ataques-de.html',
  'https://resumotechbrasil.blogspot.com/2023/10/cve-2023-38545-falha-de-seguranca-de.html',
  'https://resumotechbrasil.blogspot.com/2023/10/pesquisadores-desenvolvem-metodo-para.html',
  'https://resumotechbrasil.blogspot.com/2023/10/queda-acentuada-no-encaminhamento-de.html',
  'https://resumotechbrasil.blogspot.com/2023/10/adesivos-gerados-por-ia-no-facebook.html',
  'https://resumotechbrasil.blogspot.com/2023/10/Desligamento-de-Redes-2G-e-3G.html',
  'https://resumotechbrasil.blogspot.com/2023/10/Google-Anuncia-Novas-Regras%20.html',
  'https://resumotechbrasil.blogspot.com/2023/10/programa-hackers-do-bem.html',
  'https://resumotechbrasil.blogspot.com/2023/10/%20Captchas-do-Bing-Chat.html',
  'https://resumotechbrasil.blogspot.com/2023/10/A-Computacao-em-Nuvem-e-a-Transformacao-Digital.html',
  'https://resumotechbrasil.blogspot.com/2023/10/o-poder-transformador-da-inteligencia.html',
  'https://resumotechbrasil.blogspot.com/2023/09/tecnologia-verde-inovacoes-tecnologicas.html',
  'https://resumotechbrasil.blogspot.com/2023/09/big-data-e-analise-de-dados-como-as.html',
  'https://resumotechbrasil.blogspot.com/2023/09/computacao-em-nuvem-beneficios-e.html',
  'https://resumotechbrasil.blogspot.com/2023/09/robotica-e-automacao-impacto-na-forca.html',
  'https://resumotechbrasil.blogspot.com/2023/09/tecnologia-5g-como-isso-vai-mudar-forma.html',
  'https://resumotechbrasil.blogspot.com/2023/09/ciberseguranca-protegendo-se-em-um.html',
  'https://resumotechbrasil.blogspot.com/2023/09/internet-das-coisas-iot-impacto-no-dia.html',
  'https://resumotechbrasil.blogspot.com/2023/09/realidade-virtual-e-realidade-aumentada.html',
  'https://resumotechbrasil.blogspot.com/2023/09/a-ascensao-da-inteligencia-artificial.html',
  'https://resumotechbrasil.blogspot.com/2023/09/titulo-tecnologias-inovadoras-das-big.html',
  'https://resumotechbrasil.blogspot.com/2023/09/titulo-avancos-tecnologicos-que-estao.html',
  'https://resumotechbrasil.blogspot.com/2023/10/el-salvador-revoluciona-mineracao-de.html',
  'https://resumotechbrasil.blogspot.com/2023/10/europeia-avalia-controle-de-exportacao.html',
  'https://resumotechbrasil.blogspot.com/2023/10/bloomberg-conclui-aquisicao-da-broadway.html',
  'https://resumotechbrasil.blogspot.com/2023/10/ia-sem-codigo-tendencia-que-tornara-ia.html',
  'https://resumotechbrasil.blogspot.com/2023/10/metaverso-2023-o-ano-definidor-da.html',
  'https://resumotechbrasil.blogspot.com/2023/10/metaverso-2023-o-ano-definidor-da.html',
  'https://resumotechbrasil.blogspot.com/2023/10/avancos-tecnologicos-em-2023-explorando.html',
  'https://resumotechbrasil.blogspot.com/2023/10/avancos-tecnologicos-em-2023-explorando_7.html',
  'https://resumotechbrasil.blogspot.com/2023/10/hidrogenio-verde-fusao-nuclear-e-o.html'

];

const intervaloEntreAcessos = 30000; 
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

        // Simula cliques aleatórios entre 1 e maxCliquesPorPagina
        const numCliques = Math.floor(Math.random() * maxCliquesPorPagina) + 1;
        console.log(`Realizando ${numCliques} cliques na página.`);
        for (let i = 0; i < numCliques; i++) {
          const x = Math.random() * (1920 - 1) + 1; // Gere coordenadas x aleatórias
          const y = Math.random() * (1080 - 1) + 1; // Gere coordenadas y aleatórias
          await page.mouse.click(x, y);
        }

        // Aguarde 30 segundos até o próximo acesso
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

// Execute a função simularAcesso a cada 3 minutos (180000 milissegundos)
/* setInterval(() => {
  console.log('Reiniciando simulação de acesso.');
  simularAcesso();
}, 180000); // 180000 milissegundos = 3 minutos
 */
// Inicialize a simulação de acesso pela primeira vez
simularAcesso();
