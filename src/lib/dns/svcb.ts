import { encodeName } from "./builder.ts";
import { DnsParseError, readName, viewOf } from "./message.ts";

/** SvcParamKeys from RFC 9460 section 14.3.2 */
export const SvcParam = {
  ALPN: 1,
  IPV4HINT: 4,
  ECH: 5,
  IPV6HINT: 6,
} as const;

/** SVCB/HTTPS RDATA; `params` keeps every key, known or not, as raw value bytes */
export interface Svcb {
  priority: number;
  /** Presentation form without the trailing dot; "" is the root, meaning the owner name */
  target: string;
  params: Map<number, Uint8Array>;
}

/** TargetName is never compressed (RFC 9460 section 2.2), so the RDATA parses on its own */
export function parseSvcb(data: Uint8Array): Svcb {
  const view = viewOf(data);
  if (data.length < 3) throw new DnsParseError("SVCB record too short");
  const priority = view.getUint16(0);
  const { name, next } = readName(data, 2);
  const params = new Map<number, Uint8Array>();
  let offset = next;
  while (offset < data.length) {
    if (offset + 4 > data.length) throw new DnsParseError("truncated SvcParam");
    const key = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (offset + 4 + length > data.length) throw new DnsParseError("truncated SvcParam value");
    params.set(key, data.subarray(offset + 4, offset + 4 + length));
    offset += 4 + length;
  }
  return { priority, target: name, params };
}

/** Params are written in ascending key order, as RFC 9460 requires */
export function encodeSvcb(record: Svcb): Uint8Array {
  const target = encodeName(record.target);
  const keys = [...record.params.keys()].sort((a, b) => a - b);
  let size = 2 + target.length;
  for (const key of keys) size += 4 + record.params.get(key)!.length;
  const out = new Uint8Array(size);
  const view = viewOf(out);
  view.setUint16(0, record.priority);
  out.set(target, 2);
  let offset = 2 + target.length;
  for (const key of keys) {
    const value = record.params.get(key)!;
    view.setUint16(offset, key);
    view.setUint16(offset + 2, value.length);
    out.set(value, offset + 4);
    offset += 4 + value.length;
  }
  return out;
}

export function decodeAlpn(value: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length; ) {
    const length = value[i]!;
    out.push(String.fromCharCode(...value.subarray(i + 1, i + 1 + length)));
    i += 1 + length;
  }
  return out;
}

export function encodeAlpn(ids: string[]): Uint8Array {
  const bytes: number[] = [];
  for (const id of ids) {
    bytes.push(id.length);
    for (let i = 0; i < id.length; i++) bytes.push(id.charCodeAt(i));
  }
  return Uint8Array.from(bytes);
}

/** Splits an ipv4hint or ipv6hint value into 4- or 16-byte addresses */
export function splitHints(value: Uint8Array, size: 4 | 16): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i + size <= value.length; i += size) out.push(value.subarray(i, i + size));
  return out;
}
