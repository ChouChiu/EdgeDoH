export const RRType = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  OPT: 41,
  SVCB: 64,
  HTTPS: 65,
  ANY: 255,
} as const;

export const RRClass = {
  IN: 1,
} as const;

export const Rcode = {
  NOERROR: 0,
  FORMERR: 1,
  SERVFAIL: 2,
  NXDOMAIN: 3,
  NOTIMP: 4,
  REFUSED: 5,
} as const;

export const Flag = {
  QR: 0x8000,
  AA: 0x0400,
  TC: 0x0200,
  RD: 0x0100,
  RA: 0x0080,
  AD: 0x0020,
  CD: 0x0010,
} as const;

export const OPCODE_QUERY = 0;

/** DNS message header is always 12 bytes */
export const HEADER_SIZE = 12;

/** DoH messages travel over HTTP, so the only hard limit is the 16-bit length used by DNS over TCP */
export const MAX_MESSAGE_SIZE = 65535;

/** EDNS UDP payload size advertised in locally built responses (DNS Flag Day 2020 recommendation) */
export const EDNS_UDP_SIZE = 1232;

const typeNames = new Map<number, string>(Object.entries(RRType).map(([name, code]) => [code, name]));

export function typeName(type: number): string {
  return typeNames.get(type) ?? `TYPE${type}`;
}
