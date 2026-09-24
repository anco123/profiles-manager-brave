import { HDKey } from "@scure/bip32";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";

function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function base58Encode(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  let digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const value = digits[i] * 256 + carry;
      digits[i] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let result = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    result += alphabet[digits[i]];
  }
  return result;
}

function base58Check(payload) {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  return base58Encode(concatBytes(payload, checksum));
}

/**
 * Zcash transparent P2PKH:
 * Mainnet version = 0x1CB8.
 * This produces a t1... address.
 *
 * Path used here:
 * m/44'/133'/0'/0/0
 *
 * This is for the transparent Zcash address family, not Sapling/Orchard.
 */
export function deriveZecTransparent(seed, index = 0) {
  const root = HDKey.fromMasterSeed(seed);
  const path = `m/44'/133'/0'/0/${index}`;
  const child = root.derive(path);

  if (!child.privateKey || !child.publicKey) {
    throw new Error("Unable to derive ZEC key");
  }

  const hash160 = ripemd160(sha256(child.publicKey));

  // Zcash Mainnet transparent P2PKH version bytes: 0x1CB8
  const version = new Uint8Array([0x1c, 0xb8]);
  const address = base58Check(concatBytes(version, hash160));

  return {
    path,
    privateKey: Buffer.from(child.privateKey).toString("hex"),
    publicKey: Buffer.from(child.publicKey).toString("hex"),
    address
  };
}
