import { encodeIPv4, encodeIPv6 } from "#dns";

export interface AddressRange {
  bytes: Uint8Array;
  bits: number;
}

/** Parses `address/bits` CIDRs once, at module load */
export function parseRanges(cidrs: string[]): AddressRange[] {
  return cidrs.map((cidr) => {
    const [address, bits] = cidr.split("/") as [string, string];
    return { bytes: address.includes(":") ? encodeIPv6(address) : encodeIPv4(address), bits: Number(bits) };
  });
}

/** `address` is 4 or 16 raw bytes; it only matches ranges of the same family */
export function inRanges(address: Uint8Array, ranges: AddressRange[]): boolean {
  return ranges.some(({ bytes, bits }) => {
    if (bytes.length !== address.length) return false;
    for (let i = 0; i * 8 < bits; i++) {
      const remaining = bits - i * 8;
      const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff;
      if ((bytes[i]! & mask) !== (address[i]! & mask)) return false;
    }
    return true;
  });
}
