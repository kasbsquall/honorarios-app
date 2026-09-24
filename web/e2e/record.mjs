// Testnet E2E test that records the walkthrough: dashboard -> link -> payment -> dashboard.
// Requires `npm run dev` at BASE and .env.local with the test keys.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:5180";
const OUT = new URL("../recordings/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const FX_TEST = "3.40"; // test value typed by the dashboard user, not an official rate
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);
page.on("pageerror", (e) => console.error("pageerror:", e.message));

// 1. Freelancer dashboard
await page.goto(`${BASE}/?dev=freelancer`);
await pause(1200);
await page.getByRole("button", { name: "I'd rather use Freighter" }).click();
await page.locator(".kpi:not(.sk)").waitFor({ timeout: 60_000 });
const reserveBefore = await page.locator(".kpi").innerText();
console.log("reserve before:", reserveBefore.replace(/\s+/g, " "));
await pause(1500);

await page.locator("#fx").fill(FX_TEST);
await page.locator("#fx").press("Tab");
await pause(900);

const ref = `E001-${Date.now() % 1000}`;
await page.locator('#newlink input[name="amount"]').pressSequentially("500", { delay: 60 });
await page.locator('#newlink input[name="ref"]').pressSequentially(ref, { delay: 40 });
await page.locator('#newlink input[name="concept"]').pressSequentially("Logo design", { delay: 30 });
await page.locator('#newlink input[name="name"]').pressSequentially("Kevin Soto", { delay: 30 });
await page.getByRole("button", { name: "Issue receipt and create link" }).click();
await page.locator("#linkout code").waitFor({ timeout: 120_000 }); // the receipt is signed and issued on chain
const link = await page.locator("#linkout code").innerText();
console.log("link:", link);
await pause(1500);

// 2. Foreign client pays
await page.goto(`${link.replace(/^https?:\/\/[^/]+/, BASE)}&dev=client`);
await pause(1800);
for (const label of ["Connect Freighter", "Prepare USDC", /^Pay /]) {
  await page.getByRole("button", { name: label }).click();
  await page.locator("#go:not([disabled]), a.btn").first().waitFor({ timeout: 90_000 });
  const err = await page.locator(".error").count();
  if (err) throw new Error(await page.locator(".error").innerText());
  await pause(1300);
}
const txUrl = await page.getByRole("link", { name: "View on Stellar Expert" }).getAttribute("href");
console.log("tx:", txUrl);
await pause(3000);

// 3. Back on the dashboard: the payment shows up, read from the network
await page.goto(`${BASE}/?dev=freelancer`);
await page.getByRole("button", { name: "I'd rather use Freighter" }).click();
await page.locator(".kpi:not(.sk)").waitFor({ timeout: 60_000 });
console.log("reserve after:", (await page.locator(".kpi").innerText()).replace(/\s+/g, " "));
await pause(1800);
await page.locator(".cards").scrollIntoViewIfNeeded();
await pause(2500);
await page.screenshot({ path: `${OUT}panel-final.png`, fullPage: true });

const video = page.video();
await context.close();
await browser.close();
console.log("video:", await video.path());
