// Testnet E2E with a real passkey (Chromium virtual WebAuthn authenticator):
// create wallet -> payment link -> client pays -> dashboard -> withdraw reserve with passkey.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:5180";
const CLIENT = process.env.CLIENT_ADDR; // destination of the test withdrawal
const OUT = new URL("../recordings/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);
page.on("pageerror", (e) => console.error("pageerror:", e.message));

const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  },
});

// 1. Create wallet with passkey
await page.goto(BASE);
await page.getByRole("button", { name: "Create wallet with passkey" }).waitFor();
await pause(1000);
await page.locator("#name").pressSequentially("Kevin Soto", { delay: 50 });
await page.getByRole("button", { name: "Create wallet with passkey" }).click();
await page.locator(".kpi:not(.sk)").waitFor({ timeout: 180_000 });
console.log("wallet:", await page.locator("#who").innerText());
await pause(1500);

// 2. Receipt issued on chain with the passkey, and its payment link
await page.locator('#newlink input[name="amount"]').pressSequentially("200", { delay: 60 });
await page.locator('#newlink input[name="ref"]').pressSequentially("E001-3", { delay: 40 });
await page.locator('#newlink input[name="concept"]').pressSequentially("Editorial illustration", { delay: 30 });
await page.getByRole("button", { name: "Issue receipt and create link" }).click();
await page.locator("#linkout code, #linkout .error").first().waitFor({ timeout: 120_000 });
if (await page.locator("#linkout .error").count()) throw new Error(await page.locator("#linkout .error").innerText());
console.log("issued:", await page.locator("#linkout a").first().getAttribute("href"));
const link = await page.locator("#linkout code").innerText();
const walletId = new URL(link).searchParams.get("to");
console.log("smart wallet:", walletId);
await pause(1200);

// 3. Client pays
// The link points to the public domain; the walkthrough tests the local code.
const local = new URL(link);
await page.goto(`${BASE}${local.pathname}${local.search}&dev=client`);
await page.screenshot({ path: `${OUT}pay-before.png` });
await pause(1200);
for (const label of ["Connect Freighter", "Prepare USDC", /^Pay /]) {
  await page.getByRole("button", { name: label }).click();
  await page.locator("#go:not([disabled]), a.btn").first().waitFor({ timeout: 90_000 });
  if (await page.locator(".error").count()) throw new Error(await page.locator(".error").innerText());
  await pause(1000);
}
console.log("payment:", await page.getByRole("link", { name: "View on Stellar Expert" }).getAttribute("href"));
await pause(2000);

// 4. Dashboard: the passkey session restores itself
await page.goto(BASE);
await page.locator(".kpi:not(.sk)").waitFor({ timeout: 60_000 });
console.log("reserve:", (await page.locator(".kpi").innerText()).replace(/\s+/g, " "));
await pause(1500);

// 5. Withdraw the reserve signing with the passkey (fee paid by the relayer)
await page.locator('#withdraw input[name="to"]').pressSequentially(CLIENT, { delay: 8 });
await page.getByRole("button", { name: "Withdraw reserve" }).click();
await page.locator(".wd-out a, .wd-out .error").first().waitFor({ timeout: 120_000 });
console.log("withdrawal:", (await page.locator(".wd-out").innerText()).trim(), await page.locator(".wd-out a").getAttribute("href").catch(() => ""));
console.log("final reserve:", (await page.locator(".kpi").innerText()).replace(/\s+/g, " "));
await pause(2500);
await page.screenshot({ path: `${OUT}passkey-panel.png`, fullPage: true });

const video = page.video();
await context.close();
await browser.close();
console.log("video:", await video.path());
