import { buildQuery, parseMessage, Rcode, rcodeOf, RRType } from "#dns";
import { describe, expect, it } from "vitest";
import { api, createDevice, postQuery } from "../../test/helpers.ts";
import { probeNonce } from "./store.ts";

const NONCE = "0123456789abcdef0123456789abcdef";

describe("probe names", () => {
  it("takes the nonce only from the exact shape", () => {
    expect(probeNonce(`${NONCE}.edgedoh-probe.dns.example`)).toBe(NONCE);
    expect(probeNonce(`${NONCE}.other.dns.example`)).toBeUndefined();
    expect(probeNonce(`x${NONCE.slice(1)}.edgedoh-probe.dns.example`)).toBeUndefined();
    expect(probeNonce(`a${NONCE}.edgedoh-probe.dns.example`)).toBeUndefined();
    expect(probeNonce("example.com")).toBeUndefined();
  });
});

describe("probe API", () => {
  it("reports the device whose DoH URL resolved the probe name", async () => {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    expect(await (await api(`/probe/${nonce}`)).json()).toEqual({ device: null });

    const { id } = await createDevice("Probe laptop");
    // Some resolvers randomise the case of query names
    const res = await postQuery(id, buildQuery(`${nonce.toUpperCase()}.EdgeDoH-Probe.dns.example`, RRType.A));
    expect(rcodeOf(parseMessage(new Uint8Array(await res.arrayBuffer())).header)).toBe(Rcode.NXDOMAIN);

    expect(await (await api(`/probe/${nonce}`)).json()).toEqual({ device: { id, name: "Probe laptop" } });
  });

  it("rejects malformed nonces", async () => {
    expect((await api("/probe/not-a-nonce")).status).toBe(400);
  });
});
