const puppeteer = require('puppeteer');

async function openPageAndClickAd() {
    console.log('Iniciando uma nova iteração do loop...');

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        console.log('Limpando cache e cookies...');
        await page.goto('about:blank'); // Abre uma página em branco para limpar o cache e cookies
        await page.waitForTimeout(2000); // Aguarde alguns segundos

        console.log('Abrindo a página...');
        await page.goto('https://gabriel-rocha.github.io/ads.html', { waitUntil: 'domcontentloaded' });
        console.log('Aguardando 1 segundos para a página carregar...');
        await page.waitForTimeout(2000);

        const iframes = await page.frames();

        for (const iframe of iframes) {
            const ads = await iframe.$$('.ad');

            for (const ad of ads) {
                console.log('Clicando em um anúncio...');
                await ad.click();
                console.log('Aguardando 1 segundos após clicar no anúncio...');
                await page.waitForTimeout(2000);
                console.log('Fechando a página...');
                await browser.close();
            }
        }
    } catch (error) {
        console.error('Ocorreu um erro:', error);
    } finally {
        await browser.close();
    }
}

(async () => {
    while (true) {
        await openPageAndClickAd();
    }
})();
