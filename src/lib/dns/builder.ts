import { EDNS_UDP_SIZE, Flag, HEADER_SIZE, RRClass, RRType } from "./constants.ts";
import { findOpt, type Message, viewOf } from "./message.ts";

export interface AnswerRecord {
  /** Encoded owner name; omitted means a pointer to the first question name */
  name?: Uint8Array;
  type: number;
  ttl: number;
  data: Uint8Array;
}

export interface ResponseOptions {
  rcode: number;
  /** Records answering the first question */
  answers?: AnswerRecord[];
}

/**
 * Builds a response to `query` locally, echoing its ID, RD/CD bits and question section.
 * Used for blocked names, rewrites and error replies
 */
export function buildResponse(query: Message, raw: Uint8Array, opts: ResponseOptions): Uint8Array {
  const answers = query.questions.length > 0 ? (opts.answers ?? []) : [];
  const question = raw.subarray(HEADER_SIZE, query.questionEnd);
  const withOpt = findOpt(query) !== undefined;

  let size = HEADER_SIZE + question.length;
  for (const a of answers) size += (a.name ? a.name.length : 2) + 10 + a.data.length;
  if (withOpt) size += 11;

  const out = new Uint8Array(size);
  const view = viewOf(out);
  const echoed = query.header.flags & (Flag.RD | Flag.CD);
  view.setUint16(0, query.header.id);
  view.setUint16(2, Flag.QR | Flag.RA | echoed | (opts.rcode & 0x0f));
  view.setUint16(4, query.questions.length);
  view.setUint16(6, answers.length);
  view.setUint16(8, 0);
  view.setUint16(10, withOpt ? 1 : 0);
  out.set(question, HEADER_SIZE);

  let offset = HEADER_SIZE + question.length;
  for (const a of answers) {
    if (a.name) {
      out.set(a.name, offset);
      offset += a.name.length;
    } else {
      // Compression pointer to the first question name at offset 12
      view.setUint16(offset, 0xc000 | HEADER_SIZE);
      offset += 2;
    }
    view.setUint16(offset, a.type);
    view.setUint16(offset + 2, RRClass.IN);
    view.setUint32(offset + 4, a.ttl);
    view.setUint16(offset + 8, a.data.length);
    out.set(a.data, offset + 10);
    offset += 10 + a.data.length;
  }

  if (withOpt) {
    // Root name, OPT, UDP payload size, extended rcode/version/flags all zero, no options
    out[offset] = 0;
    view.setUint16(offset + 1, RRType.OPT);
    view.setUint16(offset + 3, EDNS_UDP_SIZE);
    view.setUint32(offset + 5, 0);
    view.setUint16(offset + 9, 0);
  }

  return out;
}

export function encodeIPv4(address: string): Uint8Array {
  const parts = address.split(".");
  if (parts.length !== 4) throw new Error(`invalid IPv4 address: ${address}`);
  return Uint8Array.from(
    parts.map((p) => {
      const n = Number(p);
      if (!/^\d{1,3}$/.test(p) || n > 255) throw new Error(`invalid IPv4 address: ${address}`);
      return n;
    }),
  );
}

export function encodeIPv6(address: string): Uint8Array {
  const invalid = () => new Error(`invalid IPv6 address: ${address}`);
  const halves = address.split("::");
  if (halves.length > 2) throw invalid();

  const groups = (s: string) => (s === "" ? [] : s.split(":"));
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];

  // Embedded IPv4 in the last group, e.g. ::ffff:1.2.3.4
  const last = tail.length > 0 ? tail : head;
  const v4 = last.length > 0 && last[last.length - 1]!.includes(".") ? encodeIPv4(last.pop()!) : undefined;

  const explicit = head.length + tail.length + (v4 ? 2 : 0);
  if (halves.length === 1 ? explicit !== 8 : explicit > 7) throw invalid();

  const words = [...head, ...Array<string>(8 - explicit).fill("0"), ...tail].map((g) => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) throw invalid();
    return parseInt(g, 16);
  });

  const out = new Uint8Array(16);
  const view = viewOf(out);
  words.forEach((w, i) => view.setUint16(i * 2, w));
  if (v4) out.set(v4, 12);
  return out;
}

export function isIPv4(address: string): boolean {
  return succeeds(() => encodeIPv4(address));
}

export function isIPv6(address: string): boolean {
  return succeeds(() => encodeIPv6(address));
}

function succeeds(fn: () => unknown): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

export interface QueryOptions {
  id?: number;
  recursionDesired?: boolean;
  /** Adds an OPT record; `dnssecOk` sets the DO bit */
  edns?: { dnssecOk?: boolean };
}

/** Encodes a single-question query, mainly for tests and tooling */
export function buildQuery(name: string, type: number, opts: QueryOptions = {}): Uint8Array {
  const encodedName = encodeName(name);
  const size = HEADER_SIZE + encodedName.length + 4 + (opts.edns ? 11 : 0);
  const out = new Uint8Array(size);
  const view = viewOf(out);
  view.setUint16(0, opts.id ?? 0);
  view.setUint16(2, opts.recursionDesired === false ? 0 : Flag.RD);
  view.setUint16(4, 1);
  view.setUint16(10, opts.edns ? 1 : 0);
  out.set(encodedName, HEADER_SIZE);
  let offset = HEADER_SIZE + encodedName.length;
  view.setUint16(offset, type);
  view.setUint16(offset + 2, RRClass.IN);
  offset += 4;
  if (opts.edns) {
    view.setUint16(offset + 1, RRType.OPT);
    view.setUint16(offset + 3, EDNS_UDP_SIZE);
    view.setUint32(offset + 5, opts.edns.dnssecOk ? 0x8000 : 0);
  }
  return out;
}

/** Encodes a presentation-form name as uncompressed wire labels */
export function encodeName(name: string): Uint8Array {
  const trimmed = name.endsWith(".") ? name.slice(0, -1) : name;
  const labels = trimmed === "" ? [] : trimmed.split(".");
  const bytes: number[] = [];
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) throw new Error(`invalid label in name: ${name}`);
    bytes.push(label.length);
    for (let i = 0; i < label.length; i++) {
      const c = label.charCodeAt(i);
      if (c > 0x7f) throw new Error(`non-ASCII name, use punycode: ${name}`);
      bytes.push(c);
    }
  }
  bytes.push(0);
  if (bytes.length > 255) throw new Error(`name too long: ${name}`);
  return Uint8Array.from(bytes);
}
