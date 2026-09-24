import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const root = process.argv[2];
const mark = readFileSync(`${root}/design/p2-suiza/logo-mark.svg`, "utf8");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
const page = (bg, fg, svg) => `<html><head><link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,600&display=swap" rel="stylesheet"><style>
html,body{margin:0;width:1024px;height:1024px;background:${bg};display:grid;place-items:center}
svg{width:560px;height:560px}</style></head><body>${svg.replace(/#1B1A17/g, fg)}</body></html>`;
await p.setContent(page("#F3F1EC", "#1B1A17", mark)); await p.screenshot({ path: `${root}/brand/logo-1024-light.png` });
await p.setContent(page("#141412", "#ECE9E2", mark.replace("#D2461E", "#E8633A"))); await p.screenshot({ path: `${root}/brand/logo-1024-dark.png` });
await p.setContent(page("transparent", "#1B1A17", mark)); await p.screenshot({ path: `${root}/brand/logo-1024-transparent.png`, omitBackground: true });
await b.close();
