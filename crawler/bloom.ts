// Bloom filter for "have we seen this URL/host already?". Sized from the expected
// item count and the target false-positive rate, with k hash positions derived by
// double hashing two 32-bit MurmurHash3 values (Kirsch and Mitzenmacher).

/** MurmurHash3 x86 32-bit of a UTF-16 string's char codes. */
export function murmur3(key: string, seed = 0): number {
  let h = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const len = key.length;
  let i = 0;
  for (; i + 4 <= len; i += 4) {
    let k =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(i + 1) & 0xff) << 8) |
      ((key.charCodeAt(i + 2) & 0xff) << 16) |
      ((key.charCodeAt(i + 3) & 0xff) << 24);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  let k = 0;
  switch (len & 3) {
    case 3:
      k ^= (key.charCodeAt(i + 2) & 0xff) << 16;
    // falls through
    case 2:
      k ^= (key.charCodeAt(i + 1) & 0xff) << 8;
    // falls through
    case 1:
      k ^= key.charCodeAt(i) & 0xff;
      k = Math.imul(k, c1);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, c2);
      h ^= k;
  }
  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class BloomFilter {
  readonly bits: Uint8Array;
  /** Number of bits (m) and hash positions per item (k). */
  readonly m: number;
  readonly k: number;
  count = 0;

  /** Size for `expected` items at false-positive rate `p`: m = -n ln p / (ln 2)^2, k = (m/n) ln 2. */
  constructor(expected: number, p = 0.01) {
    this.m = Math.max(64, Math.ceil((-expected * Math.log(p)) / Math.LN2 ** 2));
    this.k = Math.max(1, Math.round((this.m / expected) * Math.LN2));
    this.bits = new Uint8Array(Math.ceil(this.m / 8));
  }

  private *positions(item: string) {
    const h1 = murmur3(item, 0);
    const h2 = murmur3(item, 0x9747b28c) | 1;
    for (let i = 0; i < this.k; i++) yield ((h1 + Math.imul(i, h2)) >>> 0) % this.m;
  }

  add(item: string) {
    for (const bit of this.positions(item)) this.bits[bit >> 3] |= 1 << (bit & 7);
    this.count++;
  }

  /** False means definitely not added; true means probably added. */
  has(item: string): boolean {
    for (const bit of this.positions(item)) if (!(this.bits[bit >> 3] & (1 << (bit & 7)))) return false;
    return true;
  }

  /** Add and report whether it was new. */
  addIfNew(item: string): boolean {
    if (this.has(item)) return false;
    this.add(item);
    return true;
  }

  /** Expected false-positive rate at the current fill: (1 - e^(-kn/m))^k. */
  get falsePositiveRate(): number {
    return (1 - Math.exp((-this.k * this.count) / this.m)) ** this.k;
  }
}
