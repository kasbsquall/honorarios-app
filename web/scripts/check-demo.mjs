// Checks that the sample panel's wallet really received payments in the current contract.
// A contract redeploy once left this constant pointing at a dead deployment, and the
// sample panel, which is the first thing anyone opens, showed zeros for a day.
import { readFileSync } from "node:fs";
import { Address, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative } from "@stellar/stellar-sdk";

const src = readFileSync("src/panel.ts", "utf8");
const wallet = src.match(/DEMO_ADDRESS = "([GC][A-Z0-9]+)"/)[1];
const contract = readFileSync("src/stellar.ts", "utf8").match(/CONTRACT_ID = "(C[A-Z0-9]+)"/)[1];
const server = new rpc.Server("https://soroban-testnet.stellar.org");
// Any existing account works as the source of a simulation: nothing is signed or sent.
// One is created and funded on the fly with friendbot so it does not depend on local keys.
const probeKp = Keypair.random();
await fetch(`https://friendbot.stellar.org/?addr=${probeKp.publicKey()}`);
const probe = probeKp.publicKey();

const call = async (fn, ...args) => {
  const acc = await server.getAccount(probe);
  const tx = new TransactionBuilder(acc, { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contract).call(fn, ...args)).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result.retval);
};

const period = await call("current_period");
const gross = await call("month_gross", nativeToScVal(new Address(wallet)), nativeToScVal(period, { type: "u32" }));
const reserve = await call("tax_reserve", nativeToScVal(new Address(wallet)));
const fmt = (v) => (Number(v) / 1e7).toFixed(2);

console.log(`contract ${contract}`);
console.log(`wallet   ${wallet}`);
console.log(`period ${period}: gross ${fmt(gross)} USDC · reserve ${fmt(reserve)} USDC`);

if (gross === 0n && reserve === 0n) {
  console.error("\nFAIL: that wallet has nothing in this contract. The sample panel will show zeros.");
  process.exit(1);
}
console.log("\nOK: the sample panel has something to show.");
