const puppeteer = require('puppeteer-core');

// Configuração do Tor Proxy (ajuste conforme necessário)
const torProxy = 'socks5://127.0.0.1:9150';

async function acessarURLAnonimamente(url) {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Users/gabri/OneDrive/Documentos/Tor Browser/Browser/firefox.exe', // Caminho correto para o executável do Tor Browser
    args: [`--proxy-server=${torProxy}`, '--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // Configurar o User-Agent para evitar rastreamento
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36');

  try {
    // Acesse a URL
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Aguarde um tempo (opcional) para que a página seja carregada completamente
    await page.waitForTimeout(5000);

    // Obtenha o conteúdo da página
    const pageContent = await page.content();
    console.log(pageContent);
  } catch (error) {
    console.error('Erro ao acessar a URL:', error);
  } finally {
    await browser.close();
  }
}

// URL que você deseja acessar anonimamente
const url = 'https://resumotechbrasil.blogspot.com/'; // Substitua pela URL desejada

acessarURLAnonimamente(url);
