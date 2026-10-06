"""One real payment through Honorarios on Stellar mainnet, with the verified v2.0.0 wasm.

Two accounts the user creates and funds from their own wallet (keys stay in the Stellar CLI and
are never printed or written by this script):
  hn-main-freelancer  deploys the contract, sets a profile, issues the receipt, withdraws the reserve
  hn-main-client      buys a little USDC with XLM on the Stellar DEX and pays the receipt

Steps (each prints its transaction hash, and stops on the first failure):
  check     balances and trustlines only, sends nothing
  trust     USDC trustlines on both accounts
  buy       the client buys exactly AMOUNT USDC with XLM (path payment, strict receive)
  deploy    deploys split_v2.0.0.wasm (must match the release hash) with fee 0
  pay       set_profile Peru preset, issue receipt, client pays it
  withdraw  the freelancer withdraws the whole reserve back to themselves

Usage: python scripts/mainnet_run.py <step> [--contract C...] [--amount 2]
"""
import argparse
import hashlib
import subprocess
import sys
import time
from pathlib import Path

from stellar_sdk import Asset, Keypair, Network, Server, SorobanServer, TransactionBuilder, scval, xdr

RPC = "https://rpc.lightsail.network"
HORIZON = "https://horizon.stellar.org"
PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE
EXPLORER = "https://stellar.expert/explorer/public/tx/"
# Circle's USDC on Stellar (issuer home domain circle.com) and its Stellar Asset Contract.
USDC = Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN")
USDC_SAC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"
WASM_SHA256 = "3d6e9ff20db5f3f482453d6d421afdb7167234660422313f288ea6c801ed31a3"
PERU_BPS, LIMA = 800, -300


def key(alias: str) -> Keypair:
    out = subprocess.run(["stellar", "keys", "show", alias], capture_output=True, text=True, check=True)
    return Keypair.from_secret(out.stdout.strip())


def report(name: str, tx_hash: str) -> None:
    print(f"{name}: {EXPLORER}{tx_hash}")


def classic(horizon: Server, kp: Keypair, build) -> str:
    acct = horizon.load_account(kp.public_key)
    tx = build(TransactionBuilder(acct, PASSPHRASE, base_fee=1000)).set_timeout(120).build()
    tx.sign(kp)
    return horizon.submit_transaction(tx)["hash"]


def check(horizon: Server, *kps: Keypair) -> None:
    for kp in kps:
        try:
            acct = horizon.accounts().account_id(kp.public_key).call()
        except Exception:
            print(f"{kp.public_key}: not funded yet")
            continue
        bal = {b.get("asset_code", "XLM"): b["balance"] for b in acct["balances"]}
        print(f"{kp.public_key}: {bal}")


def invoke(soroban: SorobanServer, kp: Keypair, contract: str, fn: str, args) -> str:
    acct = soroban.load_account(kp.public_key)
    tx = (TransactionBuilder(acct, PASSPHRASE, base_fee=1000)
          .append_invoke_contract_function_op(contract, fn, args).set_timeout(120).build())
    tx = soroban.prepare_transaction(tx)
    tx.sign(kp)
    sent = soroban.send_transaction(tx)
    for _ in range(30):
        res = soroban.get_transaction(sent.hash)
        if res.status.value != "NOT_FOUND":
            if res.status.value != "SUCCESS":
                sys.exit(f"{fn} failed: {sent.hash}")
            return sent.hash
        time.sleep(2)
    sys.exit(f"{fn} timed out: {sent.hash}")


def main() -> None:  # noqa: C901
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["check", "trust", "buy", "deploy", "pay", "withdraw"])
    ap.add_argument("--contract")
    ap.add_argument("--amount", default="2")
    a = ap.parse_args()
    horizon, soroban = Server(HORIZON), SorobanServer(RPC)
    fl, cl = key("hn-main-freelancer"), key("hn-main-client")

    if a.step == "check":
        check(horizon, fl, cl)
    elif a.step == "trust":
        for kp, name in ((fl, "freelancer"), (cl, "client")):
            report(f"USDC trustline {name}", classic(horizon, kp, lambda b: b.append_change_trust_op(USDC)))
    elif a.step == "buy":
        report("client buys USDC with XLM", classic(horizon, cl, lambda b: b.append_path_payment_strict_receive_op(
            destination=cl.public_key, send_asset=Asset.native(), send_max="30",
            dest_asset=USDC, dest_amount=a.amount, path=[])))
    elif a.step == "deploy":
        wasm = Path(__file__).resolve().parent / "split_v2.0.0.wasm"
        if hashlib.sha256(wasm.read_bytes()).hexdigest() != WASM_SHA256:
            sys.exit("wasm does not match the v2.0.0 release hash")
        out = subprocess.run(
            ["stellar", "contract", "deploy", "--wasm", str(wasm), "--source", "hn-main-freelancer",
             "--rpc-url", RPC, "--network-passphrase", PASSPHRASE, "--",
             "--token", USDC_SAC, "--fee_bps", "0", "--fee_to", fl.public_key],
            capture_output=True, text=True, encoding="utf-8", check=True)
        print("contract:", out.stdout.strip().splitlines()[-1])
    elif a.step == "pay":
        units = int(round(float(a.amount) * 10_000_000))
        ref = scval.to_string("MAIN-1")
        report("set_profile Peru preset", invoke(soroban, fl, a.contract, "set_profile", [
            scval.to_address(fl.public_key), scval.to_uint32(PERU_BPS), scval.to_int32(LIMA)]))
        report("issue MAIN-1", invoke(soroban, fl, a.contract, "issue", [
            scval.to_address(fl.public_key), ref, scval.to_int128(units), scval.to_string("First mainnet payment")]))
        report("client pays MAIN-1", invoke(soroban, cl, a.contract, "pay", [
            scval.to_address(cl.public_key), scval.to_address(fl.public_key), ref]))
    elif a.step == "withdraw":
        sim = soroban.simulate_transaction(
            TransactionBuilder(soroban.load_account(fl.public_key), PASSPHRASE, base_fee=1000)
            .append_invoke_contract_function_op(a.contract, "tax_reserve", [scval.to_address(fl.public_key)])
            .set_timeout(60).build())

        reserve = scval.from_int128(xdr.SCVal.from_xdr(sim.results[0].xdr))
        report(f"withdraw reserve {reserve / 1e7} USDC", invoke(soroban, fl, a.contract, "withdraw_tax", [
            scval.to_address(fl.public_key), scval.to_address(fl.public_key), scval.to_int128(reserve)]))


if __name__ == "__main__":
    main()
