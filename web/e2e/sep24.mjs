// Reserve withdrawal through SEP-24 against the SDF test anchor, on testnet.
// Dashboard with Freighter (dev signer) -> SEP-10 -> anchor form with dummy data
// -> withdrawal from the contract -> payment with memo to the anchor -> final anchor status.
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5196";
const AMOUNT = process.env.AMOUNT ?? "5";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));

await page.goto(`${BASE}/?dev=freelancer`);
await page.getByRole("button", { name: "I'd rather use Freighter" }).click();
await page.locator(".kpi:not(.sk)").waitFor({ timeout: 90_000 });
console.log("reserve before:", (await page.locator(".kpi").innerText()).replace(/\s+/g, " "));
await page.locator(".howto summary").click();

const [popup] = await Promise.all([context.waitForEvent("page"), page.locator("#sep24-go").click()]);
await popup.waitForURL(/anchor-ref-ui/, { timeout: 90_000 });
await popup.locator("input").first().waitFor({ timeout: 60_000 });
const inputs = popup.locator("input");
console.log("anchor fields:", await inputs.count());
// Dummy data: the test anchor moves no real money and does not verify identity.
const values = [AMOUNT, "Test", "Honorarios", "test@example.com", "Test bank", "000123"];
for (let i = 0; i < values.length; i++) await inputs.nth(i).fill(values[i]);
await popup.getByRole("button", { name: /submit/i }).click();

await page.locator("#sep24-send").waitFor({ timeout: 120_000 });
console.log("anchor:", await page.locator("#sep24 [role=status]").innerText());
await page.locator("#sep24-send").click();
await page.locator("#sep24 [role=status]").filter({ hasText: /completed|error|expired|refunded/ }).waitFor({ timeout: 300_000 });
console.log("final:", await page.locator("#sep24 [role=status]").innerText());
console.log("txs:", await page.locator("#sep24 a[href*='/tx/']").evaluateAll((as) => as.map((a) => a.href)));
console.log("anchor url:", await page.locator("#sep24 a", { hasText: "View the withdrawal" }).getAttribute("href").catch(() => ""));
await page.locator("#sep24").screenshot({ path: new URL("../recordings/sep24.png", import.meta.url).pathname.replace(/^\/(\w:)/, "$1") });
await browser.close();
