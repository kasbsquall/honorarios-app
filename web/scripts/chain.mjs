// Helpers shared by the scripts that write to testnet with the test keys.
// The keys live in web/.env.development.local, outside the repo.
import { readFileSync } from "node:fs";
import {
  Address, Asset, BASE_FEE, Contract, Horizon, Keypair, Networks, Operation, TransactionBuilder,
  nativeToScVal, rpc, scValToNative, xdr,
} from "@stellar/stellar-sdk";

export const NETWORK = Networks.TESTNET;
export const CONTRACT = readFileSync("src/stellar.ts", "utf8").match(/CONTRACT_ID = "(C[A-Z0-9]+)"/)[1];
export const DEMO = readFileSync("src/panel.ts", "utf8").match(/DEMO_ADDRESS = "([GC][A-Z0-9]+)"/)[1];
export const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
export const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
export const soroban = new rpc.Server("https://soroban-testnet.stellar.org");

const env = Object.fromEntries(
  readFileSync(".env.development.local", "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("=").map((x) => x.trim())),
);
export const client = Keypair.fromSecret(env.VITE_DEV_CLIENT_SECRET);
export const freelancer = Keypair.fromSecret(env.VITE_DEV_FREELANCER_SECRET);

export const usdc = (n) => BigInt(Math.round(Number(n) * 1e7));
export const addr = (a) => nativeToScVal(new Address(a));
export const str = (s) => nativeToScVal(s, { type: "string" });
export const i128 = (n) => nativeToScVal(n, { type: "i128" });

/** Storage key of a receipt, DataKey::Receipt(freelancer, number) in the contract. */
export function receiptKey(owner, ref) {
  return xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract: new Address(CONTRACT).toScAddress(),
    key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Receipt"), addr(owner), str(ref)]),
    durability: xdr.ContractDataDurability.persistent(),
  }));
}

/** Read without signing: simulates the call and returns the value. */
export async function read(fn, ...args) {
  const acc = await soroban.getAccount(client.publicKey());
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(new Contract(CONTRACT).call(fn, ...args)).setTimeout(30).build();
  const sim = await soroban.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result.retval);
}

async function waitFor(hash) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const g = await soroban.getTransaction(hash);
    if (g.status !== "NOT_FOUND") return g;
  }
  throw new Error(`no response for ${hash}`);
}

/** Regular call: simulates, signs with `signer` as the source account and submits. */
export async function invoke(signer, fn, ...args) {
  const acc = await soroban.getAccount(signer.publicKey());
  let tx = new TransactionBuilder(acc, { fee: "1000000", networkPassphrase: NETWORK })
    .addOperation(new Contract(CONTRACT).call(fn, ...args)).setTimeout(120).build();
  tx = await soroban.prepareTransaction(tx);
  tx.sign(signer);
  const sent = await soroban.sendTransaction(tx);
  const res = await waitFor(sent.hash);
  if (res.status !== "SUCCESS") throw new Error(`${fn} failed: ${sent.hash}`);
  return sent.hash;
}

/**
 * Submits a call the contract is going to reject. Simulation refuses to prepare a failing
 * transaction, so the footprint and resources are taken from a similar valid call
 * (`template`) and the bad call is sent as is, with the signature an attacker would have.
 * The network includes it in a ledger and marks it as failed: it stays as public proof.
 */
export async function forceFailing(signer, { fn, args, auth = [], template, extraReadOnly = [] }) {
  const acc = await soroban.getAccount(signer.publicKey());
  const probe = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(new Contract(CONTRACT).call(template.fn, ...template.args)).setTimeout(30).build();
  const sim = await soroban.simulateTransaction(probe);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`the template does not simulate: ${sim.error}`);

  const data = sim.transactionData.build();
  const fp = data.resources().footprint();
  fp.readOnly([...fp.readOnly(), ...extraReadOnly]);
  const res = data.resources();
  res.instructions(res.instructions() * 2);
  data.resourceFee(xdr.Int64.fromString(String(Number(data.resourceFee().toString()) * 2)));

  // The template's builder already used a sequence number, so the account is reloaded.
  const tx = new TransactionBuilder(await soroban.getAccount(signer.publicKey()), {
    fee: String(Number(BASE_FEE) + Number(data.resourceFee().toString())),
    networkPassphrase: NETWORK,
  })
    .addOperation(Operation.invokeContractFunction({ contract: CONTRACT, function: fn, args, auth }))
    .setSorobanData(data)
    .setTimeout(120)
    .build();
  tx.sign(signer);
  const sent = await soroban.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error(`the network did not accept it into the queue: ${JSON.stringify(sent.errorResult)}`);
  const out = await waitFor(sent.hash);
  return { hash: sent.hash, status: out.status, reason: errorsOf(out) };
}

/** The error the network rejected the transaction with, read from its diagnostic events. */
function errorsOf(tx) {
  const errs = new Set();
  for (const d of tx.diagnosticEventsXdr ?? []) {
    for (const t of d.event().body().v0().topics()) {
      if (t.switch().name !== "scvError") continue;
      const e = t.error();
      errs.add(e.switch().name === "sceContract" ? `Error(Contract, #${e.contractCode()})` : `Error(${e.switch().name}, ${e.code().name})`);
    }
  }
  return [...errs].join(" | ");
}

/** Source-account authorization for a call: the one the sender of the transaction would sign. */
export function sourceAuth(fn, args) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(CONTRACT).toScAddress(), functionName: fn, args }),
      ),
      subInvocations: [],
    }),
  });
}

/** Leaves at least `need` USDC in the client's account, buying with XLM through a path payment. */
export async function ensureClientUsdc(need) {
  const acc = await horizon.loadAccount(client.publicKey());
  const line = acc.balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === USDC.issuer);
  const have = Number(line?.balance ?? 0);
  if (have >= need) return null;
  const missing = (need - have + 1).toFixed(7);
  const paths = await horizon.strictReceivePaths([Asset.native()], USDC, missing).call();
  if (!paths.records.length) throw new Error("no XLM -> USDC route");
  const best = paths.records[0];
  const builder = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK });
  // A fresh account needs the USDC trustline before it can receive the path payment.
  if (!line) builder.addOperation(Operation.changeTrust({ asset: USDC }));
  const tx = builder
    .addOperation(Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax: (Number(best.source_amount) * 1.15).toFixed(7),
      destination: client.publicKey(),
      destAsset: USDC,
      destAmount: missing,
      path: best.path.map((p) => (p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer))),
    }))
    .setTimeout(120).build();
  tx.sign(client);
  return (await horizon.submitTransaction(tx)).hash;
}

/** Adds the USDC trustline to a classic account if it does not have one yet. */
export async function ensureTrustline(kp) {
  const acc = await horizon.loadAccount(kp.publicKey());
  if (acc.balances.some((b) => b.asset_code === "USDC" && b.asset_issuer === USDC.issuer)) return null;
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.changeTrust({ asset: USDC })).setTimeout(120).build();
  tx.sign(kp);
  return (await horizon.submitTransaction(tx)).hash;
}
