import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { UnifiedSpendingKey } = require(
  "../vendor/zcash-wasm/webzjs_keys.js"
);

/**
 * Derives the default Zcash Mainnet Unified Address for one ZIP-32 account.
 * The address contains Orchard + Sapling receivers and omits transparent.
 */
export function deriveZecUnified(seed, account = 0) {
  if (!(seed instanceof Uint8Array) || seed.length < 32) {
    throw new Error("ZEC seed must be a Uint8Array of at least 32 bytes");
  }

  if (!Number.isInteger(account) || account < 0 || account > 0x7fffffff) {
    throw new Error("ZEC account must be an integer from 0 to 2147483647");
  }

  const spendingKey = new UnifiedSpendingKey(
    "main",
    Uint8Array.from(seed),
    account
  );
  const viewingKey = spendingKey.to_unified_full_viewing_key();

  try {
    const address = viewingKey.get_unified_address("main");
    const ufvk = viewingKey.encode("main");

    if (!address.startsWith("u1")) {
      throw new Error("Derived Zcash address is not a Mainnet Unified Address");
    }

    return {
      address,
      ufvk,
      account,
      path: `ZIP-32 account ${account}`,
      receivers: ["Orchard", "Sapling"]
    };
  } finally {
    viewingKey.free();
    spendingKey.free();
  }
}
