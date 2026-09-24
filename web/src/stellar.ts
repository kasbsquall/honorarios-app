import {
  Address,
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  contract,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { getNetworkDetails, isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";

export const NETWORK = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const CONTRACT_ID = "CC6SGVMYAN3NY7PHFACMA4H4BZSOK2Q2NJ7Z64UJY3PTA4A2TJZOEU2H";
export const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
export const TAX_BPS = 800n;
export const EXPLORER = "https://stellar.expert/explorer/testnet";
const DECIMALS = 7;
const PATH_SLIPPAGE = 1.05;
// A testnet ledger closes about every 5 s: used to turn a TTL in ledgers into a date.
const LEDGER_SECONDS = 5;
// Ledger where the contract was deployed: there are no events before it.
const DEPLOY_LEDGER = 4_853_318;
// The testnet RPC scans at most ~10k ledgers per query.
const EVENT_SCAN_STEP = 9_000;

const horizon = new Horizon.Server(HORIZON_URL);
const server = new rpc.Server(RPC_URL);

export function toUnits(amount: string): bigint {
  const raw = amount.trim();
  if (raw.startsWith("-")) throw new Error("The amount cannot be negative.");
  const [whole, frac = ""] = raw.split(".");
  return BigInt(whole || "0") * 10n ** BigInt(DECIMALS) + BigInt(frac.padEnd(DECIMALS, "0").slice(0, DECIMALS));
}

export function fromUnits(units: bigint, digits = 2): string {
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const whole = abs / 10n ** BigInt(DECIMALS);
  const frac = (abs % 10n ** BigInt(DECIMALS)).toString().padStart(DECIMALS, "0").slice(0, digits);
  return `${sign}${whole.toLocaleString("en-US")}${digits ? "." + frac : ""}`;
}

/** Service fee the contract was deployed with, read from the chain.
 *  Queried once per page load: it cannot change while the contract lives. */
let feeCache: Promise<{ bps: bigint; to: string }> | null = null;
export function serviceFee(): Promise<{ bps: bigint; to: string }> {
  feeCache ??= (async () => {
    const client = (await honorarios()) as any;
    const [bps, to] = (await client.fee()).result;
    return { bps: BigInt(bps), to: String(to) };
  })();
  return feeCache;
}

/** Same split as the contract: reserve rounded up, fee truncated.
 *  feeBps must come from `serviceFee()`, never from a local constant. If the contract
 *  charged a fee the screen did not know about, the client would sign a false breakdown. */
export function split(gross: bigint, feeBps: bigint = 0n) {
  const tax = (gross * TAX_BPS + 9_999n) / 10_000n;
  const fee = (gross * feeBps) / 10_000n;
  return { gross, tax, fee, net: gross - tax - fee };
}

export function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

// Signer for local testnet testing only (npm run dev + ?dev=client|freelancer).
// The keys live in .env.development.local (Vite does not load it in a build), which is not committed. It does not exist in a production build.
function devKeypair(): Keypair | null {
  if (!import.meta.env.DEV) return null;
  const role = new URLSearchParams(location.search).get("dev");
  const secret =
    role === "client" ? import.meta.env.VITE_DEV_CLIENT_SECRET
    : role === "freelancer" ? import.meta.env.VITE_DEV_FREELANCER_SECRET
    : undefined;
  return secret ? Keypair.fromSecret(secret) : null;
}

/** Rejects if the promise never settles: without the extension, Freighter never answers. */
function within<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error(msg)), ms))]);
}

export const FREIGHTER_INSTALL = "https://www.freighter.app/";

export async function connectWallet(): Promise<string> {
  const dev = devKeypair();
  if (dev) return dev.publicKey();
  const here = await within(isConnected(), 4000, "no-freighter").catch(() => ({ isConnected: false }));
  if (!here?.isConnected) throw new Error("We could not find the Freighter extension in this browser.");
  const access = await within(requestAccess(), 90_000, "Freighter did not respond. Open it and try again.");
  if (access.error) throw new Error("Freighter rejected the connection.");
  const net = await getNetworkDetails();
  if (net.networkPassphrase !== NETWORK) throw new Error("Switch Freighter to Testnet to continue.");
  return access.address;
}

export async function sign(xdrTx: string, address: string): Promise<string> {
  const dev = devKeypair();
  if (dev && dev.publicKey() === address) {
    const tx = TransactionBuilder.fromXDR(xdrTx, NETWORK);
    tx.sign(dev);
    return tx.toXDR();
  }
  const res = await signTransaction(xdrTx, { networkPassphrase: NETWORK, address });
  if (res.error) throw new Error("The signature was cancelled in Freighter.");
  return res.signedTxXdr;
}

export async function usdcBalance(address: string): Promise<bigint | null> {
  const acc = await horizon.loadAccount(address);
  const line = acc.balances.find(
    (b) => "asset_code" in b && b.asset_code === USDC.code && b.asset_issuer === USDC.issuer,
  );
  return line ? toUnits(line.balance) : null;
}

/** Leaves at least `amount` USDC in the payer's account, buying with XLM if needed. */
export async function ensureUsdc(payer: string, amount: bigint): Promise<string | null> {
  const balance = await usdcBalance(payer);
  if (balance !== null && balance >= amount) return null;

  const missing = amount - (balance ?? 0n);
  const paths = await horizon.strictReceivePaths([Asset.native()], USDC, fromUnits(missing, 7)).call();
  if (!paths.records.length) throw new Error("No XLM to USDC route is available on testnet.");
  const best = paths.records[0];
  const sendMax = (Number(best.source_amount) * PATH_SLIPPAGE).toFixed(7);
  // sendMax belongs to this route, so the same route must be executed, never an empty one.
  const hops = best.path.map((a: { asset_code?: string; asset_issuer?: string }) =>
    a.asset_code && a.asset_issuer ? new Asset(a.asset_code, a.asset_issuer) : Asset.native(),
  );

  const account = await horizon.loadAccount(payer);
  const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK });
  if (balance === null) builder.addOperation(Operation.changeTrust({ asset: USDC }));
  builder.addOperation(
    Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax,
      destination: payer,
      destAsset: USDC,
      destAmount: fromUnits(missing, 7),
      path: hops,
    }),
  );
  const tx = builder.setTimeout(120).build();
  const signed = TransactionBuilder.fromXDR(await sign(tx.toXDR(), payer), NETWORK);
  const res = await horizon.submitTransaction(signed);
  return res.hash;
}

/** Classic USDC payment with a memo: that is how a SEP-24 anchor knows which withdrawal it belongs to. */
export async function sendUsdcWithMemo(from: string, to: string, amount: string, memo: string, memoType: string): Promise<string> {
  const account = await horizon.loadAccount(from);
  const m = memoType === "id" ? Memo.id(memo) : memoType === "hash" ? Memo.hash(Array.from(atob(memo), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")) : Memo.text(memo);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.payment({ destination: to, asset: USDC, amount }))
    .addMemo(m)
    .setTimeout(120)
    .build();
  const signed = TransactionBuilder.fromXDR(await sign(tx.toXDR(), from), NETWORK);
  return (await horizon.submitTransaction(signed)).hash;
}

/** Adds the USDC trustline to a G account with Freighter. Without it, the account cannot
 *  receive the net amount of a payment and the client would see the payment fail on signing. */
export async function addUsdcTrustline(address: string): Promise<string> {
  const account = await horizon.loadAccount(address);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(120)
    .build();
  const signed = TransactionBuilder.fromXDR(await sign(tx.toXDR(), address), NETWORK);
  return (await horizon.submitTransaction(signed)).hash;
}

export function honorarios(publicKey?: string) {
  return contract.Client.from({
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK,
    rpcUrl: RPC_URL,
    publicKey,
    signTransaction: async (x: string) => ({ signedTxXdr: await sign(x, publicKey!) }),
  });
}

/** The SDK only throws if the submission does not reach PENDING or times out: a transaction
 *  that was included and FAILED comes back through the normal path. Without this check the
 *  screen would show "Paid" and an explorer link to a transaction that failed. */
function hashOf(sent: any): string {
  const st = sent?.getTransactionResponse?.status;
  if (st && st !== "SUCCESS") {
    throw new Error(`The network rejected the transaction (${st}). No funds were moved.`);
  }
  const hash = sent?.sendTransactionResponse?.hash;
  if (!hash) throw new Error("The network did not return the transaction hash. Check your wallet before trying again.");
  return hash;
}

export type Receipt = { gross: bigint; concept: string; paid: boolean };

/** The receipt as the contract stores it. `null` if nobody issued it. */
export async function readReceipt(freelancer: string, ref: string): Promise<Receipt | null> {
  const client = (await honorarios()) as any;
  const r = (await client.receipt({ freelancer, receipt_ref: ref })).result;
  if (!r) return null;
  return { gross: BigInt(r.gross), concept: String(r.concept), paid: Boolean(r.paid) };
}

/** The freelancer issues the receipt by signing with Freighter. Only issued receipts can be paid. */
export async function issueWithWallet(freelancer: string, ref: string, gross: bigint, concept: string): Promise<string> {
  const client = (await honorarios(freelancer)) as any;
  const tx = await client.issue({ freelancer, receipt_ref: ref, gross, concept });
  return hashOf(await tx.signAndSend());
}

/** The amount is not in the link: the contract charges what the issued receipt says. */
export async function payInvoice(payer: string, freelancer: string, ref: string): Promise<string> {
  const client = (await honorarios(payer)) as any;
  const tx = await client.pay({ payer, freelancer, receipt_ref: ref });
  return hashOf(await tx.signAndSend());
}

/** Renews the reserve's TTL with Freighter. If the reserve was already archived, the
 *  SDK client restores it first (restore: true). */
export async function extendWithWallet(freelancer: string): Promise<string> {
  const client = (await honorarios(freelancer)) as any;
  const tx = await client.extend_reserve({ freelancer }, { restore: true });
  return hashOf(await tx.signAndSend({ force: true }));
}

/** How long the reserve lives on the network before it is archived. `null` if it does not exist. */
export async function reserveLiveUntil(freelancer: string): Promise<Date | null> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(CONTRACT_ID).toScAddress(),
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("TaxReserve"), nativeToScVal(freelancer, { type: "address" })]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const [res, latest] = await Promise.all([server.getLedgerEntries(key), server.getLatestLedger()]);
  const until = res.entries[0]?.liveUntilLedgerSeq;
  if (until === undefined) return null;
  return new Date(Date.now() + (until - latest.sequence) * LEDGER_SECONDS * 1000);
}

export async function withdrawWithWallet(freelancer: string, to: string, amount: bigint): Promise<string> {
  const client = (await honorarios(freelancer)) as any;
  const tx = await client.withdraw_tax({ freelancer, to, amount });
  return hashOf(await tx.signAndSend());
}

export async function taxReserve(freelancer: string): Promise<bigint> {
  const client = (await honorarios()) as any;
  const tx = await client.tax_reserve({ freelancer });
  return BigInt(tx.result);
}

/** Gross received in the month, read from the contract: it does not depend on how many events the RPC keeps. */
export async function monthGross(freelancer: string): Promise<{ period: number; gross: bigint }> {
  const client = (await honorarios()) as any;
  const period = Number((await client.current_period()).result);
  const tx = await client.month_gross({ freelancer, period });
  return { period, gross: BigInt(tx.result) };
}

export type Paid = {
  gross: bigint;
  net: bigint;
  tax: bigint;
  fee: bigint;
  ref: string;
  payer: string;
  txHash: string;
  at: Date;
};

/** Contract events with that name and that freelancer as topic, newest first. */
async function contractEvents(name: string, freelancer: string) {
  const { sequence } = await server.getLatestLedger();
  const topics = [[xdr.ScVal.scvSymbol(name).toXDR("base64"), nativeToScVal(freelancer, { type: "address" }).toXDR("base64")]];
  const probe = await server.getEvents({ startLedger: sequence - 1, filters: [], limit: 1 });
  const from = Math.max(DEPLOY_LEDGER, probe.oldestLedger);
  const windows: number[] = [];
  for (let start = from; start <= sequence; start += EVENT_SCAN_STEP) windows.push(start);

  // Each window is paged until it runs out: with a fixed limit, extra payments
  // disappeared silently and the list showed fewer than there are.
  const scan = async (start: number) => {
    const endLedger = Math.min(start + EVENT_SCAN_STEP, sequence + 1);
    const filters = [{ type: "contract" as const, contractIds: [CONTRACT_ID], topics }];
    const out: Awaited<ReturnType<typeof server.getEvents>>["events"] = [];
    let page = await server.getEvents({ startLedger: start, endLedger, filters, limit: 100 });
    out.push(...page.events);
    while (page.events.length === 100 && page.cursor) {
      page = await server.getEvents({ cursor: page.cursor, filters, limit: 100 });
      out.push(...page.events);
    }
    return out;
  };

  const pages = await Promise.all(windows.map(scan));
  return pages.flat().reverse();
}

export async function paidEvents(freelancer: string): Promise<Paid[]> {
  return (await contractEvents("paid", freelancer)).map((e) => {
      const v = scValToNative(e.value);
      return {
        gross: BigInt(v.gross),
        net: BigInt(v.net),
        tax: BigInt(v.tax),
        // The fee field exists since the contract can charge a service fee.
        fee: BigInt(v.fee ?? 0),
        ref: String(v.receipt_ref),
        payer: String(v.payer),
        txHash: e.txHash,
        at: new Date(e.ledgerClosedAt),
      };
    });
}

export type Issued = { ref: string; gross: bigint; concept: string; at: Date };

/** Receipts issued by the freelancer, paid or not. */
export async function issuedEvents(freelancer: string): Promise<Issued[]> {
  return (await contractEvents("issued", freelancer)).map((e) => {
    const v = scValToNative(e.value);
    return { ref: String(v.receipt_ref), gross: BigInt(v.gross), concept: String(v.concept), at: new Date(e.ledgerClosedAt) };
  });
}
