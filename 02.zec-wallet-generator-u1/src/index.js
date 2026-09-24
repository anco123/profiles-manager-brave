import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { exportWalletsToJson } from "./export-json.js";
import { createWallets } from "./wallet.js";

const rl = readline.createInterface({ input, output });

try {
  const wordInput = await rl.question("Mnemonic 12 hay 24 words? [24]: ");
  const words = wordInput.trim() === "" ? 24 : Number(wordInput.trim());

  const countInput = await rl.question("So luong vi muon tao? [1]: ");
  const count = countInput.trim() === "" ? 1 : Number(countInput.trim());

  const wallets = createWallets(count, words);
  const jsonPath = await exportWalletsToJson(wallets);

  console.log("\n=== GENERATED WALLETS ===\n");

  for (const w of wallets) {
    console.log(`Wallet #${w.index + 1}`);
    console.log(`Mnemonic : ${w.mnemonic}`);
    console.log(`ZEC      : ${w.zec.address}`);
    console.log(`ZEC UFVK : ${w.zec.ufvk}`);
    console.log(`ZEC type : ${w.zec.receivers.join(" + ")}`);
    console.log(`EVM      : ${w.evm.address}`);
    console.log(`EVM key  : ${w.evm.privateKey}`);
    console.log(`ZEC path : ${w.zec.path}`);
    console.log(`EVM path : ${w.evm.path}`);
    console.log("----------------------------------------");
  }

  console.log(`\nJSON file: ${jsonPath}`);
  console.log("\nWARNING: mnemonic and private keys are secrets. UFVK reveals wallet history. Keep all of them private.");
} catch (err) {
  console.error("\nERROR:", err.message);
  process.exitCode = 1;
} finally {
  rl.close();
}
