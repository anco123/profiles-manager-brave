/* tslint:disable */
/* eslint-disable */
/**
 * Generate a new BIP39 24-word seed phrase
 *
 * IMPORTANT: This probably does not use secure randomness when used in the browser
 * and should not be used for anything other than testing
 *
 * # Returns
 *
 * A string containing a 24-word seed phrase
 */
export function generate_seed_phrase(): string;
export function describe_unified_address(encoded: string): string;
/**
 * Recover a human-verifiable summary of what a PCZT does.
 *
 * The Snap renders THIS, never the caller-supplied `signDetails`.
 *
 * # Arguments
 * * `network` - "main" or "test"
 * * `pczt` - the PCZT the dApp wants signed
 * * `ufvk` - the signer's Unified Full Viewing Key (for OVK/IVK recovery)
 *
 * # Returns
 * A JSON [`PcztSummary`] (`{ network, outputs, total_in, total_out, fee }`).
 */
export function pczt_describe(network: string, pczt: Pczt, ufvk: UnifiedFullViewingKey): any;
/**
 * Validate that a PCZT is safe to sign with this user's key.
 *
 * Returns `Ok(())` only if every spend is the user's, value balances, and the
 * fee is sane. Any failure is a hard reject — this is what kills blind signing.
 */
export function pczt_validate(network: string, pczt: Pczt, ufvk: UnifiedFullViewingKey): void;
/**
 * Signs and applies signatures to a PCZT.
 * Should in a secure environment (e.g. Metamask snap).
 *
 * # Arguments
 *
 * * `pczt` - The PCZT that needs to signed
 * * `usk` - UnifiedSpendingKey used to sign the PCZT
 * * `seed_fp` - The fingerprint of the seed used to create `usk`
 */
export function pczt_sign(network: string, pczt: Pczt, usk: UnifiedSpendingKey, seed_fp: SeedFingerprint): Promise<Pczt>;
export class Pczt {
  private constructor();
  free(): void;
  /**
   * Returns the postcard serialization of the Pczt (latest PCZT version).
   */
  serialize(): Uint8Array;
  /**
   * Deserialize to a Pczt from postcard bytes.
   */
  static from_bytes(bytes: Uint8Array): Pczt;
}
/**
 * A Zcash Sapling proof generation key
 *
 * This is a wrapper around the `sapling::ProofGenerationKey` type. It is used for generating proofs for Sapling PCZTs.
 */
export class ProofGenerationKey {
  private constructor();
  free(): void;
}
/**
 * A ZIP32 seed fingerprint. Essentially a Blake2b hash of the seed.
 *
 * This is a wrapper around the `zip32::fingerprint::SeedFingerprint` type.
 */
export class SeedFingerprint {
  free(): void;
  /**
   * Construct a new SeedFingerprint
   *
   * # Arguments
   *
   * * `seed` - At least 32 bytes of entry. Care should be taken as to how this is derived
   */
  constructor(seed: Uint8Array);
  to_bytes(): Uint8Array;
  static from_bytes(bytes: Uint8Array): SeedFingerprint;
}
/**
 * A Zcash viewing key
 *
 * This is a wrapper around the `zcash_keys::keys::ViewingKey` type.
 * UFVKs should be generated from a spending key by calling `to_unified_full_viewing_key`
 * They can also be encoded and decoded to a canonical string representation
 */
export class UnifiedFullViewingKey {
  free(): void;
  /**
   * Encode the UFVK to a string
   *
   * # Arguments
   *
   * * `network` - Must be either "main" or "test"
   */
  encode(network: string): string;
  /**
   * Construct a UFVK from its encoded string representation
   *
   * # Arguments
   *
   * * `network` - Must be either "main" or "test"
   * * `encoding` - The encoded string representation of the UFVK
   */
  constructor(network: string, encoding: string);
  /**
   * Get the default transparent address derived from this UFVK.
   *
   * This can be used before creating an account to detect the wallet birthday
   * by querying for transactions to this address.
   *
   * # Arguments
   *
   * * `network` - Must be either "main" or "test"
   *
   * # Returns
   *
   * The transparent address as a string, or None if this UFVK has no transparent component.
   */
  get_transparent_address(network: string): string | undefined;
  /**
   * Get the default Orchard + Sapling Unified Address (ZIP-316).
   *
   * This matches shielded wallets that include both shielded receiver types
   * and omit the transparent receiver.
   */
  get_unified_address(network: string): string;
  get_unified_address_custom(network: string, orchard: boolean, sapling: boolean, transparent: boolean): string;
}
/**
 * A Zcash spending key
 *
 * This is a wrapper around the `zcash_keys::keys::SpendingKey` type. It can be created from at least 32 bytes of seed entropy
 */
export class UnifiedSpendingKey {
  free(): void;
  /**
   * Construct a new UnifiedSpendingKey
   *
   * # Arguments
   *
   * * `network` - Must be either "main" or "test"
   * * `seed` - At least 32 bytes of entry. Care should be taken as to how this is derived
   * * `hd_index` - [ZIP32](https://zips.z.cash/zip-0032) hierarchical deterministic index of the account
   */
  constructor(network: string, seed: Uint8Array, hd_index: number);
  /**
   * Obtain the UFVK corresponding to this spending key
   */
  to_unified_full_viewing_key(): UnifiedFullViewingKey;
  to_sapling_proof_generation_key(): ProofGenerationKey;
}
