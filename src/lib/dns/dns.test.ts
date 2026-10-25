import { describe, expect, it } from "vitest";
import {
  buildQuery,
  buildResponse,
  cacheTtl,
  decodeBase64Url,
  decrementTtls,
  dnssecOk,
  DnsParseError,
  encodeBase64Url,
  encodeIPv4,
  encodeIPv6,
  encodeName,
  readName,
  Flag,
  hasFlag,
  parseMessage,
  Rcode,
  rcodeOf,
  RRType,
  withId,
} from "./index.ts";

/** Hand-built upstream response: www.example.com CNAME example.com, example.com A 93.184.215.14, with compression */
function cnameResponse(): Uint8Array {
  const q = buildQuery("www.example.com", RRType.A, { id: 0x1234 });
  const bytes = [...q];
  bytes[2] = 0x81; // QR + RD
  bytes[3] = 0x80; // RA
  bytes[7] = 2; // ANCOUNT
  // www.example.com CNAME example.com (pointer to offset 16 = "example" label inside the question)
  bytes.push(0xc0, 0x0c, 0x00, 0x05, 0x00, 0x01, 0x00, 0x00, 0x01, 0x2c, 0x00, 0x02, 0xc0, 0x10);
  // example.com A 93.184.215.14, TTL 60
  bytes.push(0xc0, 0x10, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x04, 93, 184, 215, 14);
  return Uint8Array.from(bytes);
}

/** NXDOMAIN with an SOA whose TTL is 3600 and MINIMUM is 900 */
function nxdomainResponse(): Uint8Array {
  const q = buildQuery("nope.example.com", RRType.A, { id: 7 });
  const bytes = [...q];
  bytes[2] = 0x81;
  bytes[3] = 0x83; // RA + NXDOMAIN
  bytes[9] = 1; // NSCOUNT
  const rdata = [0, 0, 1, 2, 3, 4, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0x03, 0x84];
  bytes.push(0xc0, 0x11, 0x00, 0x06, 0x00, 0x01, 0x00, 0x00, 0x0e, 0x10, 0x00, rdata.length, ...rdata);
  return Uint8Array.from(bytes);
}

describe("parseMessage", () => {
  it("parses a query", () => {
    const msg = parseMessage(buildQuery("Example.COM", RRType.AAAA, { id: 42, edns: { dnssecOk: true } }));
    expect(msg.header.id).toBe(42);
    expect(hasFlag(msg.header, Flag.RD)).toBe(true);
    expect(msg.questions).toEqual([{ name: "Example.COM", type: RRType.AAAA, class: 1 }]);
    expect(msg.additionals[0]?.type).toBe(RRType.OPT);
    expect(dnssecOk(msg)).toBe(true);
  });

  it("follows compression pointers", () => {
    const msg = parseMessage(cnameResponse());
    expect(msg.answers.map((a) => [a.name, a.type, a.ttl])).toEqual([
      ["www.example.com", RRType.CNAME, 300],
      ["example.com", RRType.A, 60],
    ]);
    expect([...msg.answers[1]!.data]).toEqual([93, 184, 215, 14]);
  });

  it("rejects truncated messages", () => {
    const buf = cnameResponse();
    expect(() => parseMessage(buf.subarray(0, 8))).toThrow(DnsParseError);
    expect(() => parseMessage(buf.subarray(0, buf.length - 2))).toThrow(DnsParseError);
  });

  it("rejects pointer loops", () => {
    const bytes = [...buildQuery("a", RRType.A)];
    // Replace the question name with a pointer to itself
    bytes.splice(12, 3, 0xc0, 0x0c);
    expect(() => parseMessage(Uint8Array.from(bytes))).toThrow(/compression pointers/);
  });

  it("escapes unusual label bytes", () => {
    const bytes = [...buildQuery("ab", RRType.A)];
    bytes[13] = 0x2e; // "." inside a label
    expect(parseMessage(Uint8Array.from(bytes)).questions[0]?.name).toBe("\\.b");
  });
});

describe("TTL handling", () => {
  it("uses the smallest record TTL", () => {
    expect(cacheTtl(parseMessage(cnameResponse()))).toBe(60);
  });

  it("caps negative answers by SOA MINIMUM", () => {
    const msg = parseMessage(nxdomainResponse());
    expect(rcodeOf(msg.header)).toBe(Rcode.NXDOMAIN);
    expect(cacheTtl(msg)).toBe(900);
  });

  it("returns undefined without records", () => {
    expect(cacheTtl(parseMessage(buildQuery("a.b", RRType.A)))).toBeUndefined();
  });

  it("decrements TTLs without touching the original", () => {
    const raw = cnameResponse();
    const aged = decrementTtls(raw, parseMessage(raw), 100);
    expect(parseMessage(aged).answers.map((a) => a.ttl)).toEqual([200, 0]);
    expect(parseMessage(raw).answers.map((a) => a.ttl)).toEqual([300, 60]);
  });

  it("rewrites the ID on a copy", () => {
    const raw = cnameResponse();
    expect(parseMessage(withId(raw, 0xbeef)).header.id).toBe(0xbeef);
    expect(parseMessage(raw).header.id).toBe(0x1234);
  });
});

describe("buildResponse", () => {
  it("answers the question with records pointing at it", () => {
    const raw = buildQuery("ads.example.com", RRType.A, { id: 99, edns: {} });
    const query = parseMessage(raw);
    const res = parseMessage(
      buildResponse(query, raw, { rcode: Rcode.NOERROR, answers: [{ type: RRType.A, ttl: 10, data: encodeIPv4("0.0.0.0") }] }),
    );
    expect(res.header.id).toBe(99);
    expect(hasFlag(res.header, Flag.QR)).toBe(true);
    expect(hasFlag(res.header, Flag.RD)).toBe(true);
    expect(hasFlag(res.header, Flag.RA)).toBe(true);
    expect(res.questions).toEqual(query.questions);
    expect(res.answers).toHaveLength(1);
    expect(res.answers[0]).toMatchObject({ name: "ads.example.com", type: RRType.A, ttl: 10 });
    expect(res.additionals[0]?.type).toBe(RRType.OPT);
  });

  it("builds error responses", () => {
    const raw = buildQuery("x.test", RRType.TXT);
    const res = parseMessage(buildResponse(parseMessage(raw), raw, { rcode: Rcode.SERVFAIL }));
    expect(rcodeOf(res.header)).toBe(Rcode.SERVFAIL);
    expect(res.answers).toHaveLength(0);
    expect(res.additionals).toHaveLength(0);
  });

  it("writes explicit owner names after pointer-owned records", () => {
    const raw = buildQuery("alias.test", RRType.A, { id: 3 });
    const query = parseMessage(raw);
    const res = parseMessage(
      buildResponse(query, raw, {
        rcode: Rcode.NOERROR,
        answers: [
          { type: RRType.CNAME, ttl: 10, data: encodeName("target.test") },
          { name: encodeName("target.test"), type: RRType.A, ttl: 20, data: encodeIPv4("192.0.2.9") },
        ],
      }),
    );
    expect(res.answers.map((a) => [a.name, a.type, a.ttl])).toEqual([
      ["alias.test", RRType.CNAME, 10],
      ["target.test", RRType.A, 20],
    ]);
    expect(readName(res.answers[0]!.data, 0).name).toBe("target.test");
  });
});

describe("address encoding", () => {
  it("encodes IPv4", () => {
    expect([...encodeIPv4("192.168.1.255")]).toEqual([192, 168, 1, 255]);
    expect(() => encodeIPv4("256.1.1.1")).toThrow();
    expect(() => encodeIPv4("1.2.3")).toThrow();
  });

  it("encodes IPv6 forms", () => {
    expect([...encodeIPv6("::")]).toEqual(Array(16).fill(0));
    expect([...encodeIPv6("2001:db8::1")]).toEqual([0x20, 0x01, 0x0d, 0xb8, ...Array(11).fill(0), 1]);
    expect([...encodeIPv6("::ffff:1.2.3.4")]).toEqual([...Array(10).fill(0), 0xff, 0xff, 1, 2, 3, 4]);
    expect([...encodeIPv6("1:2:3:4:5:6:7:8")].filter((_, i) => i % 2)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => encodeIPv6("1::2::3")).toThrow();
    expect(() => encodeIPv6("1:2:3")).toThrow();
    expect(() => encodeIPv6("12345::")).toThrow();
  });
});

describe("base64url", () => {
  it("round-trips the RFC 8484 example query", () => {
    const encoded = "AAABAAABAAAAAAAAA3d3dwdleGFtcGxlA2NvbQAAAQAB";
    const msg = parseMessage(decodeBase64Url(encoded));
    expect(msg.questions[0]).toEqual({ name: "www.example.com", type: RRType.A, class: 1 });
    expect(encodeBase64Url(decodeBase64Url(encoded))).toBe(encoded);
  });

  it("rejects invalid input", () => {
    expect(() => decodeBase64Url("abc$")).toThrow(DnsParseError);
  });
});
