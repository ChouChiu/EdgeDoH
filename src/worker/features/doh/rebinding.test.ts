import { buildQuery, buildResponse, encodeIPv4, encodeIPv6, encodeName, parseMessage, Rcode, RRType } from "#dns";
import { describe, expect, it } from "vitest";
import { isPrivateAddress, privateAnswer } from "./rebinding.ts";

describe("isPrivateAddress", () => {
  it("covers loopback, RFC 1918, link-local and unique local ranges, and nothing next to them", () => {
    for (const ip of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.1.1", "172.16.0.1", "172.31.255.255", "192.168.0.1"]) {
      expect(isPrivateAddress(encodeIPv4(ip)), ip).toBe(true);
    }
    for (const ip of ["1.1.1.1", "172.15.255.255", "172.32.0.0", "192.169.0.1", "100.64.0.1", "11.0.0.1"]) {
      expect(isPrivateAddress(encodeIPv4(ip)), ip).toBe(false);
    }
    for (const ip of ["::", "::1", "fd12::1", "fc00::1", "fe80::1", "::ffff:192.168.1.1"]) {
      expect(isPrivateAddress(encodeIPv6(ip)), ip).toBe(true);
    }
    for (const ip of ["2606:4700::1", "::2", "fec0::1", "::ffff:8.8.8.8"]) {
      expect(isPrivateAddress(encodeIPv6(ip)), ip).toBe(false);
    }
  });
});

describe("privateAnswer", () => {
  it("names the first private address record in the answer section", () => {
    const raw = buildQuery("a.example", RRType.AAAA);
    const answers = [
      { type: RRType.CNAME, ttl: 60, data: encodeName("b.example") },
      { name: encodeName("b.example"), type: RRType.AAAA, ttl: 60, data: encodeIPv6("fe80::1") },
    ];
    const msg = parseMessage(buildResponse(parseMessage(raw), raw, { rcode: Rcode.NOERROR, answers }));
    expect(privateAnswer(msg)).toBe("b.example AAAA fe80::1");

    const pub = parseMessage(buildResponse(parseMessage(raw), raw, { rcode: Rcode.NOERROR, answers: [{ type: RRType.AAAA, ttl: 60, data: encodeIPv6("2001:db8::1") }] }));
    expect(privateAnswer(pub)).toBeUndefined();
  });
});
