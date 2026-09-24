import { contract } from "@stellar/stellar-sdk";
import { IndexedDBStorage, SmartAccountKit } from "smart-account-kit";
import { CONTRACT_ID, NETWORK, RPC_URL } from "./stellar";

// OpenZeppelin contracts already deployed on testnet (stellar/smart-account-kit, demo/.env.example).
const ACCOUNT_WASM_HASH = "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a";
const WEBAUTHN_VERIFIER = "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F";
// SDF's public testnet relayer: it pays the smart wallet's network fees.
const RELAYER_URL = "https://smart-account-relayer-proxy.sdf-ecosystem.workers.dev";

let kit: SmartAccountKit | null = null;

function getKit(): SmartAccountKit {
  kit ??= new SmartAccountKit({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    accountWasmHash: ACCOUNT_WASM_HASH,
    webauthnVerifierAddress: WEBAUTHN_VERIFIER,
    relayerUrl: RELAYER_URL,
    rpName: "Honorarios",
    storage: new IndexedDBStorage(),
  });
  return kit;
}

/** Restores the saved session without asking for the passkey. */
export async function restorePasskey(): Promise<string | null> {
  try {
    const res = await getKit().connectWallet();
    return res?.contractId ?? null;
  } catch {
    return null;
  }
}

export async function createPasskeyWallet(name: string): Promise<string> {
  const res = await getKit().createWallet("Honorarios", name || "freelancer", { autoSubmit: true });
  if (res.submitResult && !res.submitResult.success) {
    throw new Error("The wallet could not be deployed. Try again in a moment.");
  }
  return res.contractId;
}

export async function connectPasskey(): Promise<string> {
  const res = await getKit().connectWallet({ prompt: true });
  if (!res) throw new Error("We could not find a wallet for this passkey.");
  return res.contractId;
}

export async function disconnectPasskey() {
  await getKit().disconnect();
}

/** Withdraws from the reserve by signing with the passkey. The relayer pays the network fee. */
export async function withdrawWithPasskey(freelancer: string, to: string, amount: bigint): Promise<string> {
  const client = (await contract.Client.from({ contractId: CONTRACT_ID, networkPassphrase: NETWORK, rpcUrl: RPC_URL })) as any;
  const tx = await client.withdraw_tax({ freelancer, to, amount });
  const res = await getKit().signAndSubmit(tx);
  if (!res.success) throw new Error("The withdrawal did not go through. Check the amount and try again.");
  return res.hash;
}

/** Issues the receipt by signing with the passkey. Only issued receipts can be paid later. */
export async function issueWithPasskey(freelancer: string, ref: string, gross: bigint, concept: string): Promise<string> {
  const client = (await contract.Client.from({ contractId: CONTRACT_ID, networkPassphrase: NETWORK, rpcUrl: RPC_URL })) as any;
  const tx = await client.issue({ freelancer, receipt_ref: ref, gross, concept });
  const res = await getKit().signAndSubmit(tx);
  if (!res.success) throw new Error("The receipt was not issued. If you already used that receipt number, choose another one.");
  return res.hash;
}

/** Renews the reserve's lifetime on the network. It moves no funds and the relayer pays the network fee. */
export async function extendWithPasskey(freelancer: string): Promise<string> {
  const client = (await contract.Client.from({ contractId: CONTRACT_ID, networkPassphrase: NETWORK, rpcUrl: RPC_URL })) as any;
  const tx = await client.extend_reserve({ freelancer }, { restore: true });
  const res = await getKit().signAndSubmit(tx);
  if (!res.success) throw new Error("The reserve could not be renewed. Try again in a moment.");
  return res.hash;
}
