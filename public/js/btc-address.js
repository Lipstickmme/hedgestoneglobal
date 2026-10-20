/*
 * Is this a Bitcoin address, and if not, why not - in words a customer can
 * act on. One file for the browser (window.BtcAddress) and the server
 * (require), so the Send page and the API agree on every answer.
 *
 * Every Bitcoin address carries a checksum: bech32 / bech32m for bc1...
 * (BIP 173, BIP 350) and a double SHA-256 for 1... and 3... (Base58Check). A
 * mistyped or truncated address almost never passes it, which is the whole
 * point: Bitcoin sent to a wrong address cannot be brought back.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BtcAddress = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------ SHA-256 -- */

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function sha256(bytes) {
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    const bits = len * 8;
    m[total - 4] = (bits >>> 24) & 0xff; m[total - 3] = (bits >>> 16) & 0xff;
    m[total - 2] = (bits >>> 8) & 0xff; m[total - 1] = bits & 0xff;
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i += 1) w[i] = (m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3];
      for (let i = 16; i < 64; i += 1) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i += 1) {
        const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i += 1) {
      out[4 * i] = h[i] >>> 24; out[4 * i + 1] = (h[i] >>> 16) & 0xff; out[4 * i + 2] = (h[i] >>> 8) & 0xff; out[4 * i + 3] = h[i] & 0xff;
    }
    return out;
  }

  /* ------------------------------------------------------ bech32(m) bc1 -- */

  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  const BECH32M = 0x2bc830a3;

  function polymod(values) {
    let chk = 1;
    for (const v of values) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i += 1) if ((top >>> i) & 1) chk ^= GEN[i];
    }
    return chk >>> 0;
  }

  function hrpExpand(hrp) {
    const out = [];
    for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >> 5);
    out.push(0);
    for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
    return out;
  }

  function convertBits(data, from, to) {
    let acc = 0;
    let bits = 0;
    const out = [];
    const max = (1 << to) - 1;
    for (const v of data) {
      acc = (acc << from) | v;
      bits += from;
      while (bits >= to) { bits -= to; out.push((acc >> bits) & max); }
    }
    if (bits >= from || ((acc << (to - bits)) & max)) return null;
    return out;
  }

  function checkSegwit(raw) {
    const sep = raw.lastIndexOf('1');
    for (const ch of raw.slice(sep + 1)) {
      if (CHARSET.indexOf(ch.toLowerCase()) === -1) return bad('bad_character', `"${ch}" cannot appear in an address starting bc1 (it never uses 1, b, i or o after the start). Copy the address again from your wallet.`);
    }
    if (raw !== raw.toLowerCase() && raw !== raw.toUpperCase()) return bad('mixed_case', 'An address starting bc1 is all lower case (or all upper case). Copy it again from your wallet.');
    const a = raw.toLowerCase();
    const hrp = a.slice(0, sep);
    const testnet = hrp === 'tb' || hrp === 'bcrt';
    const data = [];
    for (const ch of a.slice(sep + 1)) data.push(CHARSET.indexOf(ch));
    const expected = a.startsWith('bc1q') || a.startsWith('tb1q') ? [42, 62] : [62];
    if (a.length < 14 || data.length < 7) return bad('too_short', `This address is too short (${a.length} characters). Part of it is missing: copy the whole address from your wallet.`);
    const pm = polymod(hrpExpand(hrp).concat(data));
    const encoding = pm === 1 ? 'bech32' : pm === BECH32M ? 'bech32m' : null;
    if (!encoding) {
      const lengthNote = expected.includes(a.length) ? '' : ` It is ${a.length} characters long, and an address like this is ${expected.join(' or ')}.`;
      return bad('checksum', `This address has a mistake in it: its built-in check does not match, so a character is wrong, missing or extra.${lengthNote} Copy it again from your wallet rather than typing it.`);
    }
    const version = data[0];
    const program = convertBits(data.slice(1, -6), 5, 8);
    const valid = program && program.length >= 2 && program.length <= 40 && version <= 16
      && (version === 0 ? encoding === 'bech32' && (program.length === 20 || program.length === 32) : encoding === 'bech32m');
    if (!valid) return bad('invalid', 'This is not a valid Bitcoin address. Copy it again from your wallet.');
    // Versions 2 to 16 are reserved for future upgrades: valid to write, but no
    // wallet uses them, and Bitcoin sent to one today is not safe.
    if (version > 1) return bad('unsupported', 'This kind of address is not in use yet, so nothing can be sent to it. Use an address starting bc1q, bc1p, 1 or 3.');
    if (testnet) return bad('testnet', 'That is a test-network address. It cannot receive real Bitcoin: use an address from a wallet on the Bitcoin network.');
    const type = version === 1 ? 'Taproot (bc1p)' : program.length === 20 ? 'Native SegWit (bc1q)' : 'SegWit script (bc1q)';
    return { ok: true, address: a, type, length: a.length };
  }

  /* --------------------------------------------------- Base58Check 1, 3 -- */

  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function checkBase58(a) {
    for (const ch of a) {
      if (B58.indexOf(ch) === -1) return bad('bad_character', `"${ch}" cannot appear in a Bitcoin address (0, O, I and l are never used). Copy the address again from your wallet.`);
    }
    if (a.length < 26 || a.length > 35) {
      return bad(a.length < 26 ? 'too_short' : 'too_long', `An address starting with ${a[0]} is 26 to 35 characters; this one is ${a.length}. ${a.length < 26 ? 'Part of it is missing' : 'Something extra was copied with it'}: copy the whole address from your wallet.`);
    }
    // Base58 to bytes.
    let bytes = [0];
    for (const ch of a) {
      let carry = B58.indexOf(ch);
      for (let i = 0; i < bytes.length; i += 1) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
      while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (let i = 0; i < a.length && a[i] === '1'; i += 1) bytes.push(0);
    bytes = bytes.reverse();
    if (bytes.length !== 25) return bad('invalid', 'This is not a valid Bitcoin address. Copy it again from your wallet.');
    const payload = new Uint8Array(bytes.slice(0, 21));
    const sum = sha256(sha256(payload));
    for (let i = 0; i < 4; i += 1) {
      if (sum[i] !== bytes[21 + i]) return bad('checksum', 'This address has a mistake in it: its built-in check does not match, so a character is wrong. Copy it again from your wallet rather than typing it.');
    }
    const version = bytes[0];
    if (version === 0x6f || version === 0xc4) return bad('testnet', 'That is a test-network address. It cannot receive real Bitcoin: use an address from a wallet on the Bitcoin network.');
    if (version === 0x00) return { ok: true, address: a, type: 'Legacy (1...)', length: a.length };
    if (version === 0x05) return { ok: true, address: a, type: 'Script (3...)', length: a.length };
    return bad('invalid', 'This is not a Bitcoin address. Bitcoin addresses start with bc1, 1 or 3.');
  }

  /* ----------------------------------------------------------- the check -- */

  function bad(code, reason) {
    return { ok: false, code, reason };
  }

  /**
   * @returns {{ ok: true, address, type, length } | { ok: false, code, reason }}
   */
  function check(value) {
    const a = String(value == null ? '' : value).trim();
    if (!a) return bad('empty', 'Paste the address from the Receive screen of your wallet.');
    if (a.includes('@')) return bad('email', 'That is an email address, not a Bitcoin address. Paste the address from the Receive screen of your wallet.');
    if (/\s/.test(a)) return bad('spaces', 'A Bitcoin address has no spaces. Copy it again from your wallet as one piece.');
    if (/^0x[0-9a-f]{40}$/i.test(a)) return bad('ethereum', 'That is an Ethereum address. Only a Bitcoin address (starting bc1, 1 or 3) can receive Bitcoin.');
    if (/^bitcoin:/i.test(a)) return check(a.slice(8).split('?')[0]);
    if (/^(bc|tb|bcrt)1/i.test(a)) return checkSegwit(a);
    if (/^[13mn2]/.test(a)) return checkBase58(a);
    return bad('unknown', 'That is not a Bitcoin address. Bitcoin addresses start with bc1, 1 or 3.');
  }

  return { check, isValid: (v) => check(v).ok, _sha256: sha256 };
}));
