import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportWalletsToJson } from "./export-json.js";
import { createWalletFromMnemonic } from "./wallet.js";

const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const EXPECTED_ZEC =
  "u14hxpxnwfzfujl6n36gfpr2e90mxzupmaksy3ly7ztgcey8qa06703yutk3m3u46tfkeywk9w69atu6zmdlp0lekh8jpsxmpzngrspf379dtgyvyfggtqlyvcq3wjr5y5xngex2qtsxheywdyzdfalk5clnms8wy3fje0j560wvsjm6d8";
const EXPECTED_EVM = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

const wallet = createWalletFromMnemonic(TEST_MNEMONIC);

assert.equal(wallet.zec.address, EXPECTED_ZEC);
assert.deepEqual(wallet.zec.receivers, ["Orchard", "Sapling"]);
assert.equal(wallet.evm.address, EXPECTED_EVM);

const tempDir = await mkdtemp(path.join(tmpdir(), "zec-wallet-test-"));

try {
  const jsonPath = await exportWalletsToJson([wallet], {
    outputDir: tempDir,
    now: new Date("2026-01-02T03:04:05.678Z")
  });
  const exported = JSON.parse(await readFile(jsonPath, "utf8"));

  assert.equal(path.basename(jsonPath), "wallets-2026-01-02T03-04-05-678Z.json");
  assert.equal(exported.generatedAt, "2026-01-02T03:04:05.678Z");
  assert.equal(exported.walletCount, 1);
  assert.equal(exported.mnemonicWords, 12);
  assert.equal(exported.wallets[0].index, 1);
  assert.equal(exported.wallets[0].zec.address, EXPECTED_ZEC);
  assert.equal(exported.wallets[0].evm.address, EXPECTED_EVM);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("Self-test passed: ZEC, EVM, and JSON export are correct.");
