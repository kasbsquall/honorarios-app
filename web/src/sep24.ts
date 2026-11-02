// Withdrawal through a SEP-24 anchor on testnet: SDF's test anchor accepts Circle's USDC
// and simulates the payout to a bank. On mainnet the same protocol is spoken by an anchor that
// settles in soles; here it lets the full path run with test money.
import { tr } from "./i18n";
import { NETWORK, USDC, sign } from "./stellar";

export const TEST_ANCHOR = "https://testanchor.stellar.org";

export type AnchorTx = {
  id: string;
  status: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: string;
  more_info_url?: string;
  stellar_transaction_id?: string;
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(tr(`The anchor responded with ${res.status}.`, `El ancla respondió con ${res.status}.`));
  return res.json() as Promise<T>;
}

/** SEP-10: the anchor sends a challenge, the wallet signs it and the anchor returns a session token. */
export async function anchorLogin(account: string): Promise<string> {
  const challenge = await json<{ transaction: string; network_passphrase: string }>(
    await fetch(`${TEST_ANCHOR}/auth?account=${account}`),
  );
  if (challenge.network_passphrase !== NETWORK) throw new Error(tr("The anchor is not on testnet.", "El ancla no está en testnet."));
  const signed = await sign(challenge.transaction, account);
  const { token } = await json<{ token: string }>(
    await fetch(`${TEST_ANCHOR}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: signed }),
    }),
  );
  return token;
}

/** Opens an interactive withdrawal: the anchor returns the page where the user enters their details. */
export async function startWithdraw(token: string, account: string, amount: string): Promise<{ id: string; url: string }> {
  return json(
    await fetch(`${TEST_ANCHOR}/sep24/transactions/withdraw/interactive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ asset_code: USDC.code, asset_issuer: USDC.issuer, account, amount }),
    }),
  );
}

export async function anchorTx(token: string, id: string): Promise<AnchorTx> {
  const res = await json<{ transaction: AnchorTx }>(
    await fetch(`${TEST_ANCHOR}/sep24/transaction?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  return res.transaction;
}

/** The anchor's limits for withdrawing USDC. The test anchor accepts small amounts. */
export async function withdrawLimits(): Promise<{ min: number; max: number }> {
  const info = await json<{ withdraw?: Record<string, { enabled?: boolean; min_amount?: number; max_amount?: number }> }>(
    await fetch(`${TEST_ANCHOR}/sep24/info`),
  );
  const usdc = info.withdraw?.[USDC.code];
  if (!usdc?.enabled) throw new Error(tr("The test anchor is not accepting USDC withdrawals right now.", "El ancla de pruebas no está aceptando retiros de USDC en este momento."));
  return { min: usdc.min_amount ?? 0, max: usdc.max_amount ?? Number.POSITIVE_INFINITY };
}
