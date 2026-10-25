import { Flag, HEADER_SIZE, RRType } from "./constants.ts";

export class DnsParseError extends Error {
  override name = "DnsParseError";
}

export interface Header {
  id: number;
  flags: number;
  qdcount: number;
  ancount: number;
  nscount: number;
  arcount: number;
}

export interface Question {
  /** Presentation form without the trailing dot, original case preserved */
  name: string;
  type: number;
  class: number;
}

export interface ResourceRecord {
  name: string;
  type: number;
  class: number;
  ttl: number;
  data: Uint8Array;
  /** Byte offset of the TTL field inside the original buffer, used to rewrite TTLs in place */
  ttlOffset: number;
}

export interface Message {
  header: Header;
  questions: Question[];
  answers: ResourceRecord[];
  authorities: ResourceRecord[];
  additionals: ResourceRecord[];
  /** Byte offset where the question section ends */
  questionEnd: number;
}

const MAX_POINTER_JUMPS = 64;
const MAX_NAME_LENGTH = 255;

export function readHeader(buf: Uint8Array): Header {
  if (buf.length < HEADER_SIZE) throw new DnsParseError("message shorter than header");
  const view = viewOf(buf);
  return {
    id: view.getUint16(0),
    flags: view.getUint16(2),
    qdcount: view.getUint16(4),
    ancount: view.getUint16(6),
    nscount: view.getUint16(8),
    arcount: view.getUint16(10),
  };
}

/** Parses a full DNS message, following name compression pointers */
export function parseMessage(buf: Uint8Array): Message {
  const header = readHeader(buf);
  const view = viewOf(buf);
  let offset = HEADER_SIZE;

  const questions: Question[] = [];
  for (let i = 0; i < header.qdcount; i++) {
    const { name, next } = readName(buf, offset);
    ensure(buf, next + 4);
    questions.push({ name, type: view.getUint16(next), class: view.getUint16(next + 2) });
    offset = next + 4;
  }
  const questionEnd = offset;

  const readSection = (count: number): ResourceRecord[] => {
    const records: ResourceRecord[] = [];
    for (let i = 0; i < count; i++) {
      const { name, next } = readName(buf, offset);
      ensure(buf, next + 10);
      const rdlength = view.getUint16(next + 8);
      const dataStart = next + 10;
      ensure(buf, dataStart + rdlength);
      records.push({
        name,
        type: view.getUint16(next),
        class: view.getUint16(next + 2),
        ttl: view.getUint32(next + 4),
        data: buf.subarray(dataStart, dataStart + rdlength),
        ttlOffset: next + 4,
      });
      offset = dataStart + rdlength;
    }
    return records;
  };

  const answers = readSection(header.ancount);
  const authorities = readSection(header.nscount);
  const additionals = readSection(header.arcount);
  return { header, questions, answers, authorities, additionals, questionEnd };
}

export function readName(buf: Uint8Array, start: number): { name: string; next: number } {
  const labels: string[] = [];
  let offset = start;
  let next = -1;
  let jumps = 0;
  let length = 0;

  for (;;) {
    ensure(buf, offset + 1);
    const len = buf[offset]!;
    if (len === 0) {
      offset += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      ensure(buf, offset + 2);
      if (++jumps > MAX_POINTER_JUMPS) throw new DnsParseError("too many compression pointers");
      if (next < 0) next = offset + 2;
      offset = ((len & 0x3f) << 8) | buf[offset + 1]!;
      continue;
    }
    if (len & 0xc0) throw new DnsParseError("unsupported label type");
    ensure(buf, offset + 1 + len);
    length += len + 1;
    if (length > MAX_NAME_LENGTH) throw new DnsParseError("name too long");
    labels.push(decodeLabel(buf.subarray(offset + 1, offset + 1 + len)));
    offset += 1 + len;
  }

  return { name: labels.join("."), next: next < 0 ? offset : next };
}

export function hasFlag(header: Header, flag: number): boolean {
  return (header.flags & flag) !== 0;
}

export function rcodeOf(header: Header): number {
  return header.flags & 0x000f;
}

export function opcodeOf(header: Header): number {
  return (header.flags >> 11) & 0x0f;
}

export function findOpt(msg: Message): ResourceRecord | undefined {
  return msg.additionals.find((rr) => rr.type === RRType.OPT);
}

/** DNSSEC OK bit lives in the OPT record's TTL field */
export function dnssecOk(msg: Message): boolean {
  const opt = findOpt(msg);
  return opt !== undefined && (opt.ttl & 0x8000) !== 0;
}

export function isResponse(header: Header): boolean {
  return hasFlag(header, Flag.QR);
}

/** Returns a copy of `buf` with the message ID replaced */
export function withId(buf: Uint8Array, id: number): Uint8Array {
  const out = buf.slice();
  viewOf(out).setUint16(0, id);
  return out;
}

/**
 * TTL a response may be cached for: the smallest TTL across answer and authority
 * records, and for negative answers the SOA rule from RFC 2308
 */
export function cacheTtl(msg: Message): number | undefined {
  let min: number | undefined;
  const consider = (ttl: number) => {
    min = min === undefined ? ttl : Math.min(min, ttl);
  };
  for (const rr of msg.answers) consider(rr.ttl);
  for (const rr of msg.authorities) {
    if (rr.type === RRType.SOA && rr.data.length >= 20) {
      consider(Math.min(rr.ttl, viewOf(rr.data).getUint32(rr.data.length - 4)));
    } else {
      consider(rr.ttl);
    }
  }
  return min;
}

/** Returns a copy of `buf` with every TTL (except OPT) reduced by `seconds`, floored at zero */
export function decrementTtls(buf: Uint8Array, msg: Message, seconds: number): Uint8Array {
  return mapTtls(buf, msg, (ttl) => Math.max(0, ttl - seconds));
}

/** Copy of `buf` with every record TTL (except OPT) raised to `min` and capped at `max` */
export function clampTtls(buf: Uint8Array, msg: Message, min: number, max: number): Uint8Array {
  return mapTtls(buf, msg, (ttl) => Math.min(max, Math.max(min, ttl)));
}

function mapTtls(buf: Uint8Array, msg: Message, map: (ttl: number) => number): Uint8Array {
  const out = buf.slice();
  const view = viewOf(out);
  for (const rr of [...msg.answers, ...msg.authorities, ...msg.additionals]) {
    if (rr.type !== RRType.OPT) view.setUint32(rr.ttlOffset, map(rr.ttl));
  }
  return out;
}

function decodeLabel(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    if (b === 0x2e || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else if (b > 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += "\\" + b.toString().padStart(3, "0");
  }
  return out;
}

function ensure(buf: Uint8Array, end: number) {
  if (end > buf.length) throw new DnsParseError("unexpected end of message");
}

export function viewOf(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}
