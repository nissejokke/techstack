# Tech stack

Scrapes sites using puppeteer. Detects frontend frameworks react, solidjs and svelte. Stores result in sqlite database and also prints result at end.

## Requirements

- bun

## How to use

1. Download https://www.domcop.com/files/top/top10milliondomains.csv.zip (link can be found at https://www.domcop.com/top-10-million-websites)
2. Unzip
3. Place csv file in this folder
4. Run `bun scrape.ts`