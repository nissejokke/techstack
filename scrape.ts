import puppeteer, { Page } from 'puppeteer';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';
import { Database } from 'bun:sqlite';

const db = new Database("mydb.sqlite", { create: true });
try {
    await db.run("CREATE TABLE frameworks (domain text PRIMARY KEY, frameworks text)");
}
catch { }

try {
    await db.run('ALTER TABLE frameworks ADD status text');
    await db.run('ALTER TABLE frameworks ADD statustext text');
}
catch { }
try {
    await db.run('ALTER TABLE frameworks ADD detectedin text');
} catch { }
// await db.query('delete from frameworks where domain = $domain;').run({ $domain: 'toysrus.com' })

const sites: string[] = await new Promise(resolve => {
    let readlines = 0;
    const maxlines = 20000;
    let sites: string[] = [];
    const lineReader = createInterface({
        input: createReadStream('top10milliondomains.csv'),
    });

    lineReader.on('line', function (line: string) {
        const [, domain] = line.split(',');
        if (readlines > 0) {
            const site = domain.substring(1, domain.length - 1);
            sites.push(`${site}`);
        }
        readlines++;
        if (readlines >= maxlines)
            lineReader.close();
    });

    lineReader.on('close', function () {
        resolve(sites);
    });
})

// Launch the browser and open a new blank page
const browser = await puppeteer.launch();

type Framework = 'solidjs' | 'react' | 'svelte';

const results: Record<Framework, string[]> = {};

// const maxcount = 3000;
let index = 0;
// const limit = index + maxcount;

console.log('crawling', sites.length, 'sites');

for (const site of sites) {
    const page = `https://${site}`;
    try {
        process.stdout.write(`${index.toString().padEnd(4, ' ')} ${site}`);
        const result = await checkPage(page);
        if (result.framework.length)
            process.stdout.write(`, frameworks: ${result.framework}`);

        result.framework.forEach(framework => {
            results[framework] = results[framework] || [];
            results[framework].push(page);
        });
    } catch (err) {
        process.stdout.write(`, error: ${page}: ${err.message}`);
    } finally {
        console.log();
    }

    index++;
    // if (index >= limit)
    //     break;
}

console.log('== results ==\n');
Object.keys(results).forEach(framework => {
    console.log(framework);
    console.log(results[framework].join(', '));
    console.log();
})

process.exit(0);

async function checkPage(url: string): Promise<{ framework: Framework[] }> {
    let page: Page | null = null;
    const frameworkFound: Framework[] = [];
    const detectedin: string[] = [];
    const dmain = url.split('//')[1];

    try {
        const ignoreHosts = [
            'www.googletagmanager.com',
            'www.google-analytics.com',
            'static.hotjar.com',
            'script.hotjar.com',
            /blogspot.\w+$/i
        ];

        const selectquery = db.query(`SELECT * FROM frameworks where domain = $domain`);
        const result = await selectquery.get({ $domain: dmain });
        if (result) {
            if (result.frameworks) {
                const parsed = result.frameworks.split(/, /g);
                return { framework: parsed };
            }
            else {
                return { framework: [] };
            }
        }

        page = await browser.newPage();
        await page.setRequestInterception(true);

        page.on('request', (req) => {
            const url = new URL(req.url());

            if (
                ignoreHosts.some(host => typeof host === 'string' ? 
                    host === url.hostname : 
                    url.hostname.match(host)) || 
                !['document', 'script'].includes(req.resourceType())) {
                req.abort();
            }
            else req.continue();
        });

        page.on('response', async (res) => {
            const url = new URL(res.url());

            const status = res.status();
            if (status === 200 && !ignoreHosts.some(host => host === url.hostname)) {
                if (url.pathname.endsWith('.js')) {
                    const data = await res.text();

                    if (['"solid-proxy"', 'solid-track'].some(needle => data.includes(needle))) {
                        if (!frameworkFound.includes('solidjs'))
                            frameworkFound.push('solidjs');
                        detectedin.push(res.url());
                    }
                    if (['"react"'].some(needle => data.includes(needle))) {
                        if (!frameworkFound.includes('react'))
                            frameworkFound.push('react');
                        detectedin.push(res.url());
                    }
                    if (['data-svelte'].some(needle => data.includes(needle))) {
                        if (!frameworkFound.includes('svelte'))
                            frameworkFound.push('svelte');
                        detectedin.push(res.url());
                    }
                }
            }
        });

        page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

        // Navigate the page to a URL.
        const res = await page.goto(url, { waitUntil: 'networkidle0' });
        if (!res) throw new Error('Res is null');

        const query = db.query("INSERT INTO frameworks (domain, frameworks, status, statustext, detectedin) VALUES ($domain, $frameworks, $status, $statustext, $detectedin)");
        await query.run({ $domain: dmain, $frameworks: frameworkFound.join(', '), $status: 'OK', $statustext: '', $detectedin: detectedin.join(', ') });

    } catch (err) {
        const query = db.query("INSERT INTO frameworks (domain, frameworks, status, statustext, detectedin) VALUES ($domain, $frameworks, $status, $statustext, $detectedin)");
        await query.run({ $domain: dmain, $frameworks: frameworkFound.join(', '), $status: 'ERROR', $statustext: err.message, $detectedin: detectedin.join(', ') });

        throw err;
    }
    finally {
        await page?.close();
    }
    return { framework: frameworkFound };
}