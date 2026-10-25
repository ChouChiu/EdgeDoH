import { buildQuery, encodeBase64Url, Flag, hasFlag, MAX_MESSAGE_SIZE, parseMessage, Rcode, rcodeOf, RRType } from "#dns";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { resolve } from "./upstream.ts";
import { createDevice, ORIGIN, postQuery } from "../../test/helpers.ts";

async function answerOf(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/dns-message");
  return parseMessage(new Uint8Array(await res.arrayBuffer()));
}

/** The fake upstream counts answers per name in the last octet, so cached answers repeat it */
function lastOctet(msg: ReturnType<typeof parseMessage>): number | undefined {
  return msg.answers.find((rr) => rr.type === RRType.A)?.data[3];
}

describe("DoH endpoint", () => {
  it("answers RFC 8484 GET requests", async () => {
    const { id } = await createDevice();
    const query = buildQuery("get.example", RRType.A, { id: 0xabcd });
    const res = await exports.default.fetch(`${ORIGIN}/dns-query/${id}?dns=${encodeBase64Url(query)}`);
    const msg = await answerOf(res);
    expect(msg.header.id).toBe(0xabcd);
    expect(hasFlag(msg.header, Flag.QR)).toBe(true);
    expect(msg.questions[0]?.name).toBe("get.example");
    expect(lastOctet(msg)).toBe(1);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("serves repeated questions from cache, keeping the client's ID and letter case", async () => {
    const { id } = await createDevice();
    const first = await answerOf(await postQuery(id, buildQuery("cached.example", RRType.A, { id: 1 })));
    const second = await answerOf(await postQuery(id, buildQuery("CacHed.Example", RRType.A, { id: 2 })));
    expect(lastOctet(first)).toBe(1);
    expect(lastOctet(second)).toBe(1);
    expect(second.header.id).toBe(2);
    expect(second.questions[0]?.name).toBe("CacHed.Example");
  });

  it("does not share cache entries across query types", async () => {
    const { id } = await createDevice();
    await answerOf(await postQuery(id, buildQuery("types.example", RRType.A)));
    const other = await answerOf(await postQuery(id, buildQuery("types.example", RRType.TXT)));
    expect(lastOctet(other)).toBe(2);
  });

  it("falls back to the next upstream on SERVFAIL", async () => {
    const { id } = await createDevice();
    const msg = await answerOf(await postQuery(id, buildQuery("servfail.test", RRType.A)));
    expect(rcodeOf(msg.header)).toBe(Rcode.NOERROR);
    expect(lastOctet(msg)).toBeGreaterThan(200);
  });

  it("passes through NXDOMAIN without client caching when no SOA is present", async () => {
    const { id } = await createDevice();
    const res = await postQuery(id, buildQuery("nx.test", RRType.A));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(rcodeOf((await answerOf(res)).header)).toBe(Rcode.NXDOMAIN);
  });

  it("rejects unknown and malformed device IDs", async () => {
    const query = buildQuery("x.example", RRType.A);
    expect((await postQuery("zzzzzzzzzz", query)).status).toBe(404);
    expect((await postQuery("../api", query)).status).toBe(404);
    expect((await exports.default.fetch(`${ORIGIN}/dns-query`)).status).toBe(404);
  });

  it("validates the HTTP request", async () => {
    const { id } = await createDevice();
    const url = `${ORIGIN}/dns-query/${id}`;
    expect((await exports.default.fetch(url)).status).toBe(400);
    expect((await exports.default.fetch(`${url}?dns=***`)).status).toBe(400);
    expect((await exports.default.fetch(`${url}?dns=AAAA`)).status).toBe(400);
    expect((await exports.default.fetch(url, { method: "PUT" })).status).toBe(405);
    const wrongType = await exports.default.fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    expect(wrongType.status).toBe(415);
    const truncated = buildQuery("trunc.example", RRType.A).subarray(0, 16);
    expect((await postQuery(id, truncated)).status).toBe(400);
  });

  it("refuses bodies over the DNS message limit, even without a content-length", async () => {
    const { id } = await createDevice();
    const chunk = new Uint8Array(MAX_MESSAGE_SIZE);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    expect((await postQuery(id, stream)).status).toBe(413);
  });

  it("refuses non-query messages with NOTIMP", async () => {
    const { id } = await createDevice();
    const query = buildQuery("resp.example", RRType.A);
    query[2] = query[2]! | 0x80; // QR bit
    const msg = await answerOf(await postQuery(id, query));
    expect(rcodeOf(msg.header)).toBe(Rcode.NOTIMP);
  });
});

const UPSTREAM = { mode: "fallback", timeoutMs: 1000, cache: { enabled: true, minTtl: 0, maxTtl: 86400 } } as const;

describe("resolve", () => {
  it("skips unreachable upstreams and returns SERVFAIL when all fail", async () => {
    const ctx = createExecutionContext();
    const raw = buildQuery("down.example", RRType.A, { id: 5 });
    const fallback = await resolve(
      parseMessage(raw),
      raw,
      { ...UPSTREAM, upstreams: ["https://down.test/dns-query", "https://backup.test/dns-query"] },
      ctx,
    );
    expect(fallback.source).toBe("upstream");
    expect(fallback.upstream).toBe("https://backup.test/dns-query");

    const raw2 = buildQuery("down2.example", RRType.A, { id: 6 });
    const failed = await resolve(parseMessage(raw2), raw2, { ...UPSTREAM, upstreams: ["https://down.test/dns-query"] }, ctx);
    expect(failed.source).toBe("error");
    const msg = parseMessage(failed.response);
    expect(msg.header.id).toBe(6);
    expect(rcodeOf(msg.header)).toBe(Rcode.SERVFAIL);
    await waitOnExecutionContext(ctx);
  });
});
