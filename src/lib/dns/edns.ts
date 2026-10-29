import { encodeIPv4, encodeIPv6 } from "./builder.ts";
import { EDNS_UDP_SIZE, RRType } from "./constants.ts";
import { findOpt, type Message, viewOf } from "./message.ts";

/** EDNS Client Subnet option code (RFC 7871) */
export const ECS_OPTION = 8;

export interface ClientSubnet {
  /** 1 = IPv4, 2 = IPv6 (address family numbers) */
  family: 1 | 2;
  prefix: number;
  /** Address truncated to `prefix` bits, `ceil(prefix / 8)` bytes long */
  address: Uint8Array;
}

/**
 * Subnet sent upstream for an address: /24 for IPv4 and /56 for IPv6, the widths public resolvers
 * use themselves (RFC 7871 section 11.1). Undefined for anything that is not an address
 */
export function clientSubnet(ip: string, v4Prefix = 24, v6Prefix = 56): ClientSubnet | undefined {
  let bytes: Uint8Array;
  let family: 1 | 2;
  try {
    [bytes, family] = ip.includes(":") ? [encodeIPv6(ip), 2] : [encodeIPv4(ip), 1];
  } catch {
    return undefined;
  }
  const prefix = family === 1 ? v4Prefix : v6Prefix;
  const address = bytes.slice(0, Math.ceil(prefix / 8));
  const spare = address.length * 8 - prefix;
  if (spare > 0) address[address.length - 1]! &= (0xff << spare) & 0xff;
  return { family, prefix, address };
}

/**
 * Whether the client asked resolvers not to reveal its subnet: an ECS option with source prefix 0
 * (RFC 7871 section 7.1.2). Such queries are forwarded without a subnet of ours
 */
export function subnetOptedOut(query: Message): boolean {
  const opt = findOpt(query);
  if (!opt) return false;
  const view = viewOf(opt.data);
  for (let i = 0; i + 4 <= opt.data.length; i += 4 + view.getUint16(i + 2)) {
    if (view.getUint16(i) === ECS_OPTION && i + 7 <= opt.data.length) return opt.data[i + 6] === 0;
  }
  return false;
}

/** Presentation form such as `192.0.2.0/24`, used in cache keys */
export function subnetText(subnet: ClientSubnet): string {
  if (subnet.family === 1) {
    const full = [...subnet.address, 0, 0, 0, 0].slice(0, 4);
    return `${full.join(".")}/${subnet.prefix}`;
  }
  const full = new Uint8Array(16);
  full.set(subnet.address);
  const view = viewOf(full);
  const groups = Array.from({ length: 8 }, (_, i) => view.getUint16(i * 2).toString(16));
  return `${groups.join(":")}/${subnet.prefix}`;
}

/**
 * Copy of a query carrying `subnet` as its only ECS option. The rebuilt message keeps the header,
 * question and every other EDNS option; non-OPT additional records are dropped, as stub queries carry none
 */
export function withClientSubnet(raw: Uint8Array, query: Message, subnet: ClientSubnet): Uint8Array {
  const opt = findOpt(query);
  const options: Uint8Array[] = [];
  if (opt) {
    const view = viewOf(opt.data);
    for (let i = 0; i + 4 <= opt.data.length; ) {
      const code = view.getUint16(i);
      const length = view.getUint16(i + 2);
      if (code !== ECS_OPTION) options.push(opt.data.subarray(i, i + 4 + length));
      i += 4 + length;
    }
  }
  const ecs = new Uint8Array(8 + subnet.address.length);
  const ecsView = viewOf(ecs);
  ecsView.setUint16(0, ECS_OPTION);
  ecsView.setUint16(2, 4 + subnet.address.length);
  ecsView.setUint16(4, subnet.family);
  ecs[6] = subnet.prefix;
  ecs[7] = 0;
  ecs.set(subnet.address, 8);
  options.push(ecs);

  const rdlength = options.reduce((n, o) => n + o.length, 0);
  const out = new Uint8Array(query.questionEnd + 11 + rdlength);
  out.set(raw.subarray(0, query.questionEnd));
  const view = viewOf(out);
  view.setUint16(6, 0);
  view.setUint16(8, 0);
  view.setUint16(10, 1);
  let offset = query.questionEnd;
  out[offset] = 0;
  view.setUint16(offset + 1, RRType.OPT);
  // OPT keeps the client's payload size in CLASS and its extended rcode, version and DO bit in TTL
  view.setUint16(offset + 3, opt?.class ?? EDNS_UDP_SIZE);
  view.setUint32(offset + 5, opt?.ttl ?? 0);
  view.setUint16(offset + 9, rdlength);
  offset += 11;
  for (const o of options) {
    out.set(o, offset);
    offset += o.length;
  }
  return out;
}
