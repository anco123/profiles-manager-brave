import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createWallets } from "./wallet.js";

const rl = readline.createInterface({ input, output });

try {
  const wordInput = await rl.question("Mnemonic 12 hay 24 words? [24]: ");
  const words = wordInput.trim() === "" ? 24 : Number(wordInput.trim());

  const countInput = await rl.question("So luong vi muon tao? [1]: ");
  const count = countInput.trim() === "" ? 1 : Number(countInput.trim());

  const wallets = createWallets(count, words);

  console.log("\n=== GENERATED WALLETS ===\n");

  for (const w of wallets) {
    console.log(`Wallet #${w.index + 1}`);
    console.log(`Mnemonic : ${w.mnemonic}`);
    console.log(`ZEC      : ${w.zec.address}`);
    console.log(`ZEC key  : ${w.zec.privateKey}`);
    console.log(`EVM      : ${w.evm.address}`);
    console.log(`EVM key  : ${w.evm.privateKey}`);
    console.log(`ZEC path : ${w.zec.path}`);
    console.log(`EVM path : ${w.evm.path}`);
    console.log("----------------------------------------");
  }

  console.log("\nWARNING: private keys/mnemonics are secrets. Do not paste them into chat or commit them to Git.");
} catch (err) {
  console.error("\nERROR:", err.message);
  process.exitCode = 1;
} finally {
  rl.close();
}
