import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic
} from "@scure/bip39";

import { wordlist as ENGLISH } from "@scure/bip39/wordlists/english";

import { HDNodeWallet } from "ethers";
import { deriveZecTransparent } from "./zec.js";

/**
 * Creates a BIP-39 mnemonic.
 *
 * 24 words = 256 bits entropy.
 * 12 words = 128 bits entropy.
 *
 * Important: Zcash's current ZIP 32 guidance requires 256 bits of
 * entropy when GENERATING a Zcash wallet, so 24 words is the
 * Zcash-compliant generation option. 12 words is provided here only
 * because the application explicitly supports it; it should not be
 * presented as a newly-generated ZIP-32-compliant Zcash seed.
 */
export function createMnemonic(words = 24) {
  if (words !== 12 && words !== 24) {
    throw new Error("words must be 12 or 24");
  }

  return generateMnemonic(ENGLISH, words === 24 ? 256 : 128);
}

export function createWallet({ words = 24, index = 0 } = {}) {
  const mnemonic = createMnemonic(words);

  if (!validateMnemonic(mnemonic, ENGLISH)) {
    throw new Error("Generated mnemonic failed BIP-39 validation");
  }

  const seed = mnemonicToSeedSync(mnemonic);
  const zec = deriveZecTransparent(seed, index);

  // Standard Ethereum BIP-44 path.
  const evmPath = `m/44'/60'/0'/0/${index}`;
  const evm = HDNodeWallet.fromPhrase(
    mnemonic,
    "",
    evmPath
  );

  // The raw BIP-39 seed is intentionally NOT returned by default.
  return {
    index,
    words,
    mnemonic,
    zec: {
      address: zec.address,
      privateKey: zec.privateKey,
      path: zec.path
    },
    evm: {
      address: evm.address,
      privateKey: evm.privateKey,
      path: evmPath
    }
  };
}

export function createWallets(count = 1, words = 24) {
  if (!Number.isInteger(count) || count < 1 || count > 100000) {
    throw new Error("count must be an integer from 1 to 100000");
  }

  return Array.from({ length: count }, (_, index) =>
    createWallet({ words, index })
  );
}
