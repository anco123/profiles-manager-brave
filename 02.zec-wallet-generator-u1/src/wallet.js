import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic
} from "@scure/bip39";
import { wordlist as ENGLISH } from "@scure/bip39/wordlists/english";
import { HDNodeWallet } from "ethers";
import { deriveZecUnified } from "./zec.js";

export function createMnemonic(words = 24) {
  if (words !== 12 && words !== 24) {
    throw new Error("words must be 12 or 24");
  }

  return generateMnemonic(ENGLISH, words === 24 ? 256 : 128);
}

export function createWalletFromMnemonic(mnemonic, index = 0) {
  if (!validateMnemonic(mnemonic, ENGLISH)) {
    throw new Error("Invalid BIP-39 English mnemonic");
  }

  // Each row owns a different mnemonic, so both chains start from their first
  // account/address instead of increasing the account number per output row.
  const evmPath = "m/44'/60'/0'/0/0";
  const seed = mnemonicToSeedSync(mnemonic);
  const zec = deriveZecUnified(seed, 0);
  const evm = HDNodeWallet.fromPhrase(mnemonic, "", evmPath);

  return {
    index,
    words: mnemonic.trim().split(/\s+/).length,
    mnemonic,
    zec,
    evm: {
      address: evm.address,
      privateKey: evm.privateKey,
      path: evmPath
    }
  };
}

export function createWallet({ words = 24, index = 0 } = {}) {
  return createWalletFromMnemonic(createMnemonic(words), index);
}

export function createWallets(count = 1, words = 24) {
  if (!Number.isInteger(count) || count < 1 || count > 100000) {
    throw new Error("count must be an integer from 1 to 100000");
  }

  return Array.from({ length: count }, (_, index) =>
    createWallet({ words, index })
  );
}
