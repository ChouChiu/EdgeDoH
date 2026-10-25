/**
 * 64-bit cyrb53-style hash of `s` from `start` to the end, as two unsigned 32-bit halves.
 * Hashing a suffix in place avoids allocating substrings on the DNS hot path
 */
export function hash64(s: string, start = 0): [hi: number, lo: number] {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = start; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h2 >>> 0, h1 >>> 0];
}
