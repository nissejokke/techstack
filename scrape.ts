import puppeteer from 'puppeteer';

// Launch the browser and open a new blank page
const browser = await puppeteer.launch();

type Framework = 'solidjs' | 'react' | 'svelte';

const pages = ['https://nordvpn.org/', 'https://www.stashpad.com/', 'https://instagram.com', 'https://ikea.com'];

const results: Record<Framework, string[]> = {};

for (const page of pages) {
    const result = await checkPage(page);
    console.log(
        `${page}\nFrameworks: ${result.framework ?? 'None found'}\n`
    );
    result.framework.forEach(framework => {
        results[framework] = results[framework] || [];
        results[framework].push(page);
    });
}

console.log('== results ==\n');
Object.keys(results).forEach(framework => {
    console.log(framework);
    console.log(results[framework].join(', '));
    console.log();
})

process.exit(0);

async function checkPage(url: string): Promise<{ framework: Framework[] }> {
    const page = await browser.newPage();
    let frameworkFound: Framework[] = [];

    const ignoreHosts = [
        'www.googletagmanager.com',
        'www.google-analytics.com',
        'static.hotjar.com',
        'script.hotjar.com'
    ];

    // page.on('requestfinished', (request) => {
    //     console.log(request.url())
    // });

    page.on('response', async (res) => {
        const url = new URL(res.url());

        // console.log(Object.keys(res.headers()));
        // if (res.headers()['content-type'] === 'text/html') {
        //     const html = await res.text();
        //     html.includes
        // }
        if (!ignoreHosts.some(host => host === url.hostname)) {
            if (url.pathname.endsWith('.js')) {
                // console.log(url.hostname);

                const data = await res.text();
                if (['"solid-proxy"', 'solid-track'].some(needle => data.includes(needle))) {
                    if (!frameworkFound.includes('solidjs'))
                        frameworkFound.push('solidjs');
                }
                else if (['"react"'].some(needle => data.includes(needle))) {
                    if (!frameworkFound.includes('react'))
                        frameworkFound.push('react');
                }
                else if (['data-svelte'].some(needle => data.includes(needle))) {
                    if (!frameworkFound.includes('svelte'))
                        frameworkFound.push('svelte');
                }
            }
        }
        else {
            // console.log('Ignoring', url.hostname);
        }
    });

    page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    // Navigate the page to a URL.
    // await page.goto('https://nordvpn.org/'); // 'https://lume.io/'
    const res = await page.goto(url);
    if (!res) throw new Error('Res is null');

    const status = res.status();
    if (status !== 200) {
        throw new Error(`Got HTTP response code ${status} from ${url}`);
    };

    // const text = await page.evaluate(() => Array.from(document.querySelectorAll('.svelte'), element => element.textContent));

    await page.close();
    return { framework: frameworkFound };
}