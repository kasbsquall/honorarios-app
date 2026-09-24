// Takes the README screenshots from a running app (default: `npm run dev` on 5196) and one
// rejected transaction on Stellar Expert. Writes them to docs/screenshots/.
//   REJECTED_TX=<hash> node e2e/screenshots.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:5196";
const REJECTED_TX = process.env.REJECTED_TX;
const DEMO = readFileSync("src/panel.ts", "utf8").match(/DEMO_ADDRESS = "([GC][A-Z0-9]+)"/)[1];
const OUT = new URL("../../docs/screenshots/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));

await page.goto(BASE);
await page.locator(".intro h1").waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}01-home.png` });

await page.goto(`${BASE}/?demo`);
await page.locator(".kpi:not(.sk)").waitFor({ timeout: 60_000 });
await page.locator(".pending li").first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}06-demo-dashboard.png` });
await page.locator("#threshold").screenshot({ path: `${OUT}07-tax-prepayment.png` });
await page.locator(".pending").screenshot({ path: `${OUT}08-pending-receipts.png` });

const pending = await page.locator(".pending li a.btn").first().getAttribute("href");
const due = new URL(pending);
await page.goto(`${BASE}${due.pathname}${due.search}`);
await page.locator(".summary h1").waitFor({ timeout: 60_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}03-payment-due.png` });

await page.goto(`${BASE}/pay.html?${new URLSearchParams({ to: DEMO, ref: "E001-1" })}`);
await page.locator(".badge.ok").waitFor({ timeout: 60_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}04-payment-done.png` });

if (REJECTED_TX) {
  await page.goto(`https://stellar.expert/explorer/testnet/tx/${REJECTED_TX}`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}09-rejected-attack.png` });
}

await browser.close();
console.log(`screenshots in ${OUT}`);
