
let imports = {};
imports['__wbindgen_placeholder__'] = module.exports;
let wasm;
const { TextEncoder, TextDecoder } = require(`util`);

let WASM_VECTOR_LEN = 0;

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.buffer !== wasm.memory.buffer) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextEncoder = new TextEncoder('utf-8');

const encodeString = function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
};

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_export_5.set(idx, obj);
    return idx;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().slice(ptr, ptr + len));
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => {
    wasm.__wbindgen_export_6.get(state.dtor)(state.a, state.b)
});

function makeMutClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor };
    const real = (...args) => {
        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            if (--state.cnt === 0) {
                wasm.__wbindgen_export_6.get(state.dtor)(a, state.b);
                CLOSURE_DTORS.unregister(state);
            } else {
                state.a = a;
            }
        }
    };
    real.original = state;
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_export_5.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
/**
 * Generate a new BIP39 24-word seed phrase
 *
 * IMPORTANT: This probably does not use secure randomness when used in the browser
 * and should not be used for anything other than testing
 *
 * # Returns
 *
 * A string containing a 24-word seed phrase
 * @returns {string}
 */
module.exports.generate_seed_phrase = function() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.generate_seed_phrase();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
};

/**
 * @param {string} encoded
 * @returns {string}
 */
module.exports.describe_unified_address = function(encoded) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(encoded, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.describe_unified_address(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
};

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}
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
 * @param {string} network
 * @param {Pczt} pczt
 * @param {UnifiedFullViewingKey} ufvk
 * @returns {any}
 */
module.exports.pczt_describe = function(network, pczt, ufvk) {
    const ptr0 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(pczt, Pczt);
    _assertClass(ufvk, UnifiedFullViewingKey);
    const ret = wasm.pczt_describe(ptr0, len0, pczt.__wbg_ptr, ufvk.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
};

/**
 * Validate that a PCZT is safe to sign with this user's key.
 *
 * Returns `Ok(())` only if every spend is the user's, value balances, and the
 * fee is sane. Any failure is a hard reject — this is what kills blind signing.
 * @param {string} network
 * @param {Pczt} pczt
 * @param {UnifiedFullViewingKey} ufvk
 */
module.exports.pczt_validate = function(network, pczt, ufvk) {
    const ptr0 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(pczt, Pczt);
    _assertClass(ufvk, UnifiedFullViewingKey);
    const ret = wasm.pczt_validate(ptr0, len0, pczt.__wbg_ptr, ufvk.__wbg_ptr);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
};

/**
 * Signs and applies signatures to a PCZT.
 * Should in a secure environment (e.g. Metamask snap).
 *
 * # Arguments
 *
 * * `pczt` - The PCZT that needs to signed
 * * `usk` - UnifiedSpendingKey used to sign the PCZT
 * * `seed_fp` - The fingerprint of the seed used to create `usk`
 * @param {string} network
 * @param {Pczt} pczt
 * @param {UnifiedSpendingKey} usk
 * @param {SeedFingerprint} seed_fp
 * @returns {Promise<Pczt>}
 */
module.exports.pczt_sign = function(network, pczt, usk, seed_fp) {
    const ptr0 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(pczt, Pczt);
    var ptr1 = pczt.__destroy_into_raw();
    _assertClass(usk, UnifiedSpendingKey);
    var ptr2 = usk.__destroy_into_raw();
    _assertClass(seed_fp, SeedFingerprint);
    var ptr3 = seed_fp.__destroy_into_raw();
    const ret = wasm.pczt_sign(ptr0, len0, ptr1, ptr2, ptr3);
    return ret;
};

function __wbg_adapter_32(arg0, arg1, arg2) {
    wasm.closure59_externref_shim(arg0, arg1, arg2);
}

function __wbg_adapter_115(arg0, arg1, arg2, arg3) {
    wasm.closure219_externref_shim(arg0, arg1, arg2, arg3);
}

const PcztFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_pczt_free(ptr >>> 0, 1));

class Pczt {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Pczt.prototype);
        obj.__wbg_ptr = ptr;
        PcztFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PcztFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_pczt_free(ptr, 0);
    }
    /**
     * Returns the postcard serialization of the Pczt (latest PCZT version).
     * @returns {Uint8Array}
     */
    serialize() {
        const ret = wasm.pczt_serialize(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Deserialize to a Pczt from postcard bytes.
     * @param {Uint8Array} bytes
     * @returns {Pczt}
     */
    static from_bytes(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.pczt_from_bytes(ptr0, len0);
        return Pczt.__wrap(ret);
    }
}
module.exports.Pczt = Pczt;

const ProofGenerationKeyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_proofgenerationkey_free(ptr >>> 0, 1));
/**
 * A Zcash Sapling proof generation key
 *
 * This is a wrapper around the `sapling::ProofGenerationKey` type. It is used for generating proofs for Sapling PCZTs.
 */
class ProofGenerationKey {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ProofGenerationKey.prototype);
        obj.__wbg_ptr = ptr;
        ProofGenerationKeyFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ProofGenerationKeyFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_proofgenerationkey_free(ptr, 0);
    }
}
module.exports.ProofGenerationKey = ProofGenerationKey;

const SeedFingerprintFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_seedfingerprint_free(ptr >>> 0, 1));
/**
 * A ZIP32 seed fingerprint. Essentially a Blake2b hash of the seed.
 *
 * This is a wrapper around the `zip32::fingerprint::SeedFingerprint` type.
 */
class SeedFingerprint {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(SeedFingerprint.prototype);
        obj.__wbg_ptr = ptr;
        SeedFingerprintFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SeedFingerprintFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_seedfingerprint_free(ptr, 0);
    }
    /**
     * Construct a new SeedFingerprint
     *
     * # Arguments
     *
     * * `seed` - At least 32 bytes of entry. Care should be taken as to how this is derived
     * @param {Uint8Array} seed
     */
    constructor(seed) {
        const ptr0 = passArray8ToWasm0(seed, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.seedfingerprint_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        SeedFingerprintFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Uint8Array}
     */
    to_bytes() {
        const ret = wasm.seedfingerprint_to_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {SeedFingerprint}
     */
    static from_bytes(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.seedfingerprint_from_bytes(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return SeedFingerprint.__wrap(ret[0]);
    }
}
module.exports.SeedFingerprint = SeedFingerprint;

const UnifiedFullViewingKeyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_unifiedfullviewingkey_free(ptr >>> 0, 1));
/**
 * A Zcash viewing key
 *
 * This is a wrapper around the `zcash_keys::keys::ViewingKey` type.
 * UFVKs should be generated from a spending key by calling `to_unified_full_viewing_key`
 * They can also be encoded and decoded to a canonical string representation
 */
class UnifiedFullViewingKey {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(UnifiedFullViewingKey.prototype);
        obj.__wbg_ptr = ptr;
        UnifiedFullViewingKeyFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        UnifiedFullViewingKeyFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_unifiedfullviewingkey_free(ptr, 0);
    }
    /**
     * Encode the UFVK to a string
     *
     * # Arguments
     *
     * * `network` - Must be either "main" or "test"
     * @param {string} network
     * @returns {string}
     */
    encode(network) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.unifiedfullviewingkey_encode(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Construct a UFVK from its encoded string representation
     *
     * # Arguments
     *
     * * `network` - Must be either "main" or "test"
     * * `encoding` - The encoded string representation of the UFVK
     * @param {string} network
     * @param {string} encoding
     */
    constructor(network, encoding) {
        const ptr0 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(encoding, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.unifiedfullviewingkey_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        UnifiedFullViewingKeyFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
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
     * @param {string} network
     * @returns {string | undefined}
     */
    get_transparent_address(network) {
        const ptr0 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.unifiedfullviewingkey_get_transparent_address(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v2;
        if (ret[0] !== 0) {
            v2 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * Get the default Orchard + Sapling Unified Address (ZIP-316).
     *
     * This matches shielded wallets that include both shielded receiver types
     * and omit the transparent receiver.
     * @param {string} network
     * @returns {string}
     */
    get_unified_address(network) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.unifiedfullviewingkey_get_unified_address(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {string} network
     * @param {boolean} orchard
     * @param {boolean} sapling
     * @param {boolean} transparent
     * @returns {string}
     */
    get_unified_address_custom(network, orchard, sapling, transparent) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.unifiedfullviewingkey_get_unified_address_custom(this.__wbg_ptr, ptr0, len0, orchard, sapling, transparent);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
}
module.exports.UnifiedFullViewingKey = UnifiedFullViewingKey;

const UnifiedSpendingKeyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_unifiedspendingkey_free(ptr >>> 0, 1));
/**
 * A Zcash spending key
 *
 * This is a wrapper around the `zcash_keys::keys::SpendingKey` type. It can be created from at least 32 bytes of seed entropy
 */
class UnifiedSpendingKey {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        UnifiedSpendingKeyFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_unifiedspendingkey_free(ptr, 0);
    }
    /**
     * Construct a new UnifiedSpendingKey
     *
     * # Arguments
     *
     * * `network` - Must be either "main" or "test"
     * * `seed` - At least 32 bytes of entry. Care should be taken as to how this is derived
     * * `hd_index` - [ZIP32](https://zips.z.cash/zip-0032) hierarchical deterministic index of the account
     * @param {string} network
     * @param {Uint8Array} seed
     * @param {number} hd_index
     */
    constructor(network, seed, hd_index) {
        const ptr0 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(seed, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.unifiedspendingkey_new(ptr0, len0, ptr1, len1, hd_index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        UnifiedSpendingKeyFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Obtain the UFVK corresponding to this spending key
     * @returns {UnifiedFullViewingKey}
     */
    to_unified_full_viewing_key() {
        const ret = wasm.unifiedspendingkey_to_unified_full_viewing_key(this.__wbg_ptr);
        return UnifiedFullViewingKey.__wrap(ret);
    }
    /**
     * @returns {ProofGenerationKey}
     */
    to_sapling_proof_generation_key() {
        const ret = wasm.unifiedspendingkey_to_sapling_proof_generation_key(this.__wbg_ptr);
        return ProofGenerationKey.__wrap(ret);
    }
}
module.exports.UnifiedSpendingKey = UnifiedSpendingKey;

module.exports.__wbg_String_8f0eb39a4a4c2f66 = function(arg0, arg1) {
    const ret = String(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
};

module.exports.__wbg_async_9ff6d9e405f13772 = function(arg0) {
    const ret = arg0.async;
    return ret;
};

module.exports.__wbg_buffer_609cc3eee51ed158 = function(arg0) {
    const ret = arg0.buffer;
    return ret;
};

module.exports.__wbg_call_672a4d21634d4a24 = function() { return handleError(function (arg0, arg1) {
    const ret = arg0.call(arg1);
    return ret;
}, arguments) };

module.exports.__wbg_call_7cccdd69e0791ae2 = function() { return handleError(function (arg0, arg1, arg2) {
    const ret = arg0.call(arg1, arg2);
    return ret;
}, arguments) };

module.exports.__wbg_crypto_86f2631e91b51511 = function(arg0) {
    const ret = arg0.crypto;
    return ret;
};

module.exports.__wbg_data_432d9c3df2630942 = function(arg0) {
    const ret = arg0.data;
    return ret;
};

module.exports.__wbg_getRandomValues_b3f15fcbfabb0f8b = function() { return handleError(function (arg0, arg1) {
    arg0.getRandomValues(arg1);
}, arguments) };

module.exports.__wbg_msCrypto_d562bbe83e0d4b91 = function(arg0) {
    const ret = arg0.msCrypto;
    return ret;
};

module.exports.__wbg_new_23a2665fac83c611 = function(arg0, arg1) {
    try {
        var state0 = {a: arg0, b: arg1};
        var cb0 = (arg0, arg1) => {
            const a = state0.a;
            state0.a = 0;
            try {
                return __wbg_adapter_115(a, state0.b, arg0, arg1);
            } finally {
                state0.a = a;
            }
        };
        const ret = new Promise(cb0);
        return ret;
    } finally {
        state0.a = state0.b = 0;
    }
};

module.exports.__wbg_new_405e22f390576ce2 = function() {
    const ret = new Object();
    return ret;
};

module.exports.__wbg_new_78feb108b6472713 = function() {
    const ret = new Array();
    return ret;
};

module.exports.__wbg_new_a12002a7f91c75be = function(arg0) {
    const ret = new Uint8Array(arg0);
    return ret;
};

module.exports.__wbg_new_b1a33e5095abf678 = function() { return handleError(function (arg0, arg1) {
    const ret = new Worker(getStringFromWasm0(arg0, arg1));
    return ret;
}, arguments) };

module.exports.__wbg_new_c68d7209be747379 = function(arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return ret;
};

module.exports.__wbg_new_e9a4a67dbababe57 = function(arg0) {
    const ret = new Int32Array(arg0);
    return ret;
};

module.exports.__wbg_newnoargs_105ed471475aaf50 = function(arg0, arg1) {
    const ret = new Function(getStringFromWasm0(arg0, arg1));
    return ret;
};

module.exports.__wbg_newwithbyteoffsetandlength_d97e637ebe145a9a = function(arg0, arg1, arg2) {
    const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
    return ret;
};

module.exports.__wbg_newwithlength_a381634e90c276d4 = function(arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return ret;
};

module.exports.__wbg_node_e1f24f89a7336c2e = function(arg0) {
    const ret = arg0.node;
    return ret;
};

module.exports.__wbg_of_4a05197bfc89556f = function(arg0, arg1, arg2) {
    const ret = Array.of(arg0, arg1, arg2);
    return ret;
};

module.exports.__wbg_pczt_new = function(arg0) {
    const ret = Pczt.__wrap(arg0);
    return ret;
};

module.exports.__wbg_postMessage_6edafa8f7b9c2f52 = function() { return handleError(function (arg0, arg1) {
    arg0.postMessage(arg1);
}, arguments) };

module.exports.__wbg_process_3975fd6c72f520aa = function(arg0) {
    const ret = arg0.process;
    return ret;
};

module.exports.__wbg_queueMicrotask_97d92b4fcc8a61c5 = function(arg0) {
    queueMicrotask(arg0);
};

module.exports.__wbg_queueMicrotask_d3219def82552485 = function(arg0) {
    const ret = arg0.queueMicrotask;
    return ret;
};

module.exports.__wbg_randomFillSync_f8c153b79f285817 = function() { return handleError(function (arg0, arg1) {
    arg0.randomFillSync(arg1);
}, arguments) };

module.exports.__wbg_require_b74f47fc2d022fd6 = function() { return handleError(function () {
    const ret = module.require;
    return ret;
}, arguments) };

module.exports.__wbg_resolve_4851785c9c5f573d = function(arg0) {
    const ret = Promise.resolve(arg0);
    return ret;
};

module.exports.__wbg_set_37837023f3d740e8 = function(arg0, arg1, arg2) {
    arg0[arg1 >>> 0] = arg2;
};

module.exports.__wbg_set_3f1d0b984ed272ed = function(arg0, arg1, arg2) {
    arg0[arg1] = arg2;
};

module.exports.__wbg_set_65595bdd868b3009 = function(arg0, arg1, arg2) {
    arg0.set(arg1, arg2 >>> 0);
};

module.exports.__wbg_setonmessage_5a885b16bdc6dca6 = function(arg0, arg1) {
    arg0.onmessage = arg1;
};

module.exports.__wbg_static_accessor_GLOBAL_88a902d13a557d07 = function() {
    const ret = typeof global === 'undefined' ? null : global;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
};

module.exports.__wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0 = function() {
    const ret = typeof globalThis === 'undefined' ? null : globalThis;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
};

module.exports.__wbg_static_accessor_SELF_37c5d418e4bf5819 = function() {
    const ret = typeof self === 'undefined' ? null : self;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
};

module.exports.__wbg_static_accessor_WINDOW_5de37043a91a9c40 = function() {
    const ret = typeof window === 'undefined' ? null : window;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
};

module.exports.__wbg_subarray_aa9065fa9dc5df96 = function(arg0, arg1, arg2) {
    const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
    return ret;
};

module.exports.__wbg_then_44b73946d2fb3e7d = function(arg0, arg1) {
    const ret = arg0.then(arg1);
    return ret;
};

module.exports.__wbg_value_dab73d3d5d4abaaf = function(arg0) {
    const ret = arg0.value;
    return ret;
};

module.exports.__wbg_versions_4e31226f5e8dc909 = function(arg0) {
    const ret = arg0.versions;
    return ret;
};

module.exports.__wbg_waitAsync_61f0a081053dd3c2 = function(arg0, arg1, arg2) {
    const ret = Atomics.waitAsync(arg0, arg1 >>> 0, arg2);
    return ret;
};

module.exports.__wbg_waitAsync_7ce6c8a047c752c3 = function() {
    const ret = Atomics.waitAsync;
    return ret;
};

module.exports.__wbindgen_bigint_from_u64 = function(arg0) {
    const ret = BigInt.asUintN(64, arg0);
    return ret;
};

module.exports.__wbindgen_cb_drop = function(arg0) {
    const obj = arg0.original;
    if (obj.cnt-- == 1) {
        obj.a = 0;
        return true;
    }
    const ret = false;
    return ret;
};

module.exports.__wbindgen_closure_wrapper222 = function(arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 60, __wbg_adapter_32);
    return ret;
};

module.exports.__wbindgen_closure_wrapper224 = function(arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 60, __wbg_adapter_32);
    return ret;
};

module.exports.__wbindgen_error_new = function(arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return ret;
};

module.exports.__wbindgen_init_externref_table = function() {
    const table = wasm.__wbindgen_export_5;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
    ;
};

module.exports.__wbindgen_is_function = function(arg0) {
    const ret = typeof(arg0) === 'function';
    return ret;
};

module.exports.__wbindgen_is_object = function(arg0) {
    const val = arg0;
    const ret = typeof(val) === 'object' && val !== null;
    return ret;
};

module.exports.__wbindgen_is_string = function(arg0) {
    const ret = typeof(arg0) === 'string';
    return ret;
};

module.exports.__wbindgen_is_undefined = function(arg0) {
    const ret = arg0 === undefined;
    return ret;
};

module.exports.__wbindgen_link_9579f016b4522a24 = function(arg0) {
    const val = `onmessage = function (ev) {
        let [ia, index, value] = ev.data;
        ia = new Int32Array(ia.buffer);
        let result = Atomics.wait(ia, index, value);
        postMessage(result);
    };
    `;
    const ret = typeof URL.createObjectURL === 'undefined' ? "data:application/javascript," + encodeURIComponent(val) : URL.createObjectURL(new Blob([val], { type: "text/javascript" }));
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
};

module.exports.__wbindgen_memory = function() {
    const ret = wasm.memory;
    return ret;
};

module.exports.__wbindgen_number_new = function(arg0) {
    const ret = arg0;
    return ret;
};

module.exports.__wbindgen_rethrow = function(arg0) {
    throw arg0;
};

module.exports.__wbindgen_string_new = function(arg0, arg1) {
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
};

module.exports.__wbindgen_throw = function(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
};
imports.wbg = { memory: new WebAssembly.Memory({initial:37,maximum:16384,shared:true}) };
const path = require('path').join(__dirname, 'webzjs_keys_bg.wasm');
const bytes = require('fs').readFileSync(path);

const wasmModule = new WebAssembly.Module(bytes);
const wasmInstance = new WebAssembly.Instance(wasmModule, imports);
wasm = wasmInstance.exports;
module.exports.__wasm = wasm;

wasm.__wbindgen_start();

