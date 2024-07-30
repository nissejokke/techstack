import puppeteer, { Page } from 'puppeteer';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';
import { Database } from 'bun:sqlite';

const db = new Database("mydb.sqlite", { create: true });
try {
    await db.run("CREATE TABLE frameworks (id integer PRIMARY KEY, domain text, frameworks text)");
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
try {
    await db.run('ALTER TABLE frameworks RENAME COLUMN frameworks TO tech');
} catch { }
// await db.query('delete from frameworks where domain = $domain;').run({ $domain: 'disneylandparis.com' })


// Launch the browser and open a new blank page
const browser = await puppeteer.launch();

type Tech = 'solidjs' | 'react' | 'svelte' | 'vue' | 'angular' | string;

const results: Record<Tech, string[]> = {};
let index = 0;
let readlines = 0;

const lineReader = createInterface({
    input: createReadStream('top10milliondomains.csv'),
});

for await (const line of lineReader) {
    const [, domain] = line.split(',');
    if (readlines > 0) {
        const site = domain.substring(1, domain.length - 1);
        await parseSite(site);
    }
    readlines++;
}

console.log('== results ==\n');
Object.keys(results).forEach(framework => {
    console.log(framework);
    console.log(results[framework].join(', '));
    console.log();
})

process.exit(0);

async function parseSite(site: string): Promise<void> {
    const page = `https://${site}`;
    try {
        process.stdout.write(`${index.toString().padEnd(4, ' ')} ${site}`);
        const result = await parseSiteTech(page);
        if (result.tech.length)
            process.stdout.write(`, tech: ${result.tech.join(', ')}`);

        result.tech.forEach(framework => {
            results[framework] = results[framework] || [];
            results[framework].push(page);
        });
    } catch (err) {
        process.stdout.write(`, error: ${page}: ${err.message}`);
    } finally {
        console.log();
    }

    index++;
}

async function parseSiteTech(url: string): Promise<{ tech: Tech[] }> {
    const techFound: Tech[] = [];
    const detectedin: string[] = [];

    const addTech = (tech: string, url: string) => {
        if (!techFound.includes(tech))
            techFound.push(tech);
        detectedin.push(url);
    }

    let page: Page | null = null;
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
            if (result.tech) {
                const parsed = result.tech.split(/, /g);
                return { tech: parsed };
            }
            else {
                return { tech: [] };
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

                    if (['"solid-proxy"', '"solid-track"'].some(needle => data.includes(needle))) {
                        addTech('solidjs', res.url());
                    }
                    if (['"react"', 'REACT_DEVTOOLS', 'REACT_APP'].some(needle => data.includes(needle))) {
                        addTech('react', res.url());
                    }
                    if (['data-svelte'].some(needle => data.includes(needle))) {
                        addTech('svelte', res.url());
                    }
                    if (['vue()', '@vue/'].some(needle => data.includes(needle))) {
                        addTech('vue', res.url());
                    }
                    if (['runOutsideAngular', '"angular"'].some(needle => data.includes(needle))) {
                        addTech('angular', res.url());
                    }
                }
            }
        });

        page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

        // Navigate the page to a URL.
        const res = await page.goto(url, { waitUntil: 'networkidle0' });
        if (!res) throw new Error('Res is null');

        const html = await res.text();
        const matches = html.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)["']/);
        if (matches)
            addTech(matches[1].replace(',', ' '), res.url());

        const query = db.query("INSERT INTO frameworks (domain, tech, status, statustext, detectedin) VALUES ($domain, $tech, $status, $statustext, $detectedin)");
        await query.run({ $domain: dmain, $tech: techFound.join(', '), $status: 'OK', $statustext: '', $detectedin: detectedin.join(', ') });

    } catch (err) {
        const query = db.query("INSERT INTO frameworks (domain, tech, status, statustext, detectedin) VALUES ($domain, $tech, $status, $statustext, $detectedin)");
        await query.run({ $domain: dmain, $tech: techFound.join(', '), $status: 'ERROR', $statustext: err.message, $detectedin: detectedin.join(', ') });

        throw err;
    }
    finally {
        await page?.close();
    }
    return { tech: techFound };
}