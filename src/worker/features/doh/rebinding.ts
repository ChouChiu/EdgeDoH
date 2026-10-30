import { type Message, RRType } from "#dns";
import { type AddressRange, inRanges, parseRanges } from "./ranges.ts";

/** Pseudo list ID logged for answers the rebinding protection blocked */
export const REBINDING_LIST_ID = "rebinding";

/**
 * Addresses a public name must not resolve to: unspecified, loopback, RFC 1918, link-local and
 * IPv6 unique local. Carrier-grade NAT (100.64.0.0/10) is left out, since overlay networks such as
 * Tailscale publish public names for it
 */
const PRIVATE_RANGES = parseRanges([
  "0.0.0.0/8",
  "10.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "::/128",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
]);

/** `::ffff:a.b.c.d` carries an IPv4 address that clients connect to as such */
const MAPPED_PREFIX: AddressRange[] = parseRanges(["::ffff:0:0/96"]);

export function isPrivateAddress(address: Uint8Array): boolean {
  if (address.length === 16 && inRanges(address, MAPPED_PREFIX)) return inRanges(address.subarray(12), PRIVATE_RANGES);
  return inRanges(address, PRIVATE_RANGES);
}

/**
 * The first A or AAAA answer pointing at a private address, as `name type address` for the log;
 * undefined when every address is public. Records in other sections are not used by clients
 */
export function privateAnswer(msg: Message): string | undefined {
  for (const rr of msg.answers) {
    if ((rr.type === RRType.A && rr.data.length === 4) || (rr.type === RRType.AAAA && rr.data.length === 16)) {
      if (isPrivateAddress(rr.data)) return `${rr.name} ${rr.type === RRType.A ? "A" : "AAAA"} ${formatAddress(rr.data)}`;
    }
  }
  return undefined;
}

function formatAddress(bytes: Uint8Array): string {
  if (bytes.length === 4) return bytes.join(".");
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i]! << 8) | bytes[i + 1]!).toString(16));
  // Collapses the first run of zero groups, enough for a readable log line
  return groups.join(":").replace(/(^|:)0(:0)+(:|$)/, "::");
}
