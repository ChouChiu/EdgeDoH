import { type AnswerRecord, buildResponse, ECS_OPTION, encodeAlpn, encodeIPv4, encodeIPv6, encodeName, encodeSvcb, findOpt, parseMessage, Rcode, RRType, SvcParam, viewOf } from "#dns";

/**
 * Stand-in for real DoH resolvers, wired in as Miniflare's outbound service.
 * The last octet of every A answer is a per-name counter, so tests can tell cached answers from fresh ones
 */
const counters = new Map<string, number>();

const TITLED_LIST = [
  "[Adblock Plus 2.0]",
  "! Title: Titled list",
  "! Description: Blocks things",
  "! Homepage: https://lists.test/",
  "! License: MIT",
  "! Version: 1.2.3",
  "||from-titled.test^",
].join("\n");

export async function fakeUpstream(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === "down.test") return new Response("unavailable", { status: 503 });
  if (url.hostname === "api.cloudflare.com") return fakeSqlApi(request);
  if (url.hostname === "hooks.test") return fakeWebhook(url, request);
  if (url.hostname === "adguardteam.github.io") return fakeRegistry(url);
  if (url.hostname === "raw.githubusercontent.com") {
    // Counts fetches, so tests can tell a cached catalog from a fresh one
    if (url.pathname.endsWith("/service-catalog/main/output/community.json")) {
      const count = (counters.get("community.json") ?? 0) + 1;
      counters.set("community.json", count);
      return Response.json({ license: "GPL-2.0", services: [], fetch: count });
    }
    if (url.pathname.endsWith("/service-catalog/main/output/adguard.json")) {
      return new Response('{"license":"GPL-3.0","services":[{"id":"tiktok","name":"TikTok","group":"social_network","icon":"<svg/>","rules":["||tiktok.test^"]}]}');
    }
    return new Response("not found", { status: 404 });
  }
  if (url.hostname === "lists.test") {
    if (url.pathname === "/missing.txt") return new Response("gone", { status: 404 });
    // A source with an ETag that answers conditional requests, and a bump endpoint that publishes a new version
    if (url.pathname === "/versioned/bump") {
      counters.set("versioned", (counters.get("versioned") ?? 1) + 1);
      return new Response("ok");
    }
    if (url.pathname === "/versioned.txt") {
      const etag = `"v${counters.get("versioned") ?? 1}"`;
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
      return new Response(`||${etag.slice(1, -1)}.versioned.test^\n`, { headers: { etag } });
    }
    // Ignores conditional headers but keeps one Last-Modified
    if (url.pathname === "/static.txt") return new Response("||static.test^\n", { headers: { "last-modified": "Mon, 26 Oct 2026 00:00:00 GMT" } });
    if (url.pathname === "/titled.txt") return new Response(TITLED_LIST);
    // Longer than the header the Worker keeps, so the cut-off path is exercised
    if (url.pathname === "/long.txt") return new Response(`! Title: Long list\n${"! padding\n".repeat(3000)}||from-long.test^\n`);
    return new Response("||from-url.test^\n");
  }

  const raw = new Uint8Array(await request.arrayBuffer());
  const query = parseMessage(raw);
  const name = query.questions[0]!.name.toLowerCase();
  const type = query.questions[0]!.type;
  const reply = (body: Uint8Array) => new Response(body, { headers: { "content-type": "application/dns-message" } });

  if (name === "servfail.test" && url.hostname === "primary.test") {
    return reply(buildResponse(query, raw, { rcode: Rcode.SERVFAIL }));
  }
  if (name === "nx.test") return reply(buildResponse(query, raw, { rcode: Rcode.NXDOMAIN }));

  // ECS: answers with the subnet the query carried, 0.0.0.0 when it carried none
  if (name === "ecs.test") {
    const opt = findOpt(query);
    let address = [0, 0, 0, 0];
    if (opt) {
      const view = viewOf(opt.data);
      for (let i = 0; i + 4 <= opt.data.length; i += 4 + view.getUint16(i + 2)) {
        if (view.getUint16(i) === ECS_OPTION) address = [...opt.data.subarray(i + 8, i + 4 + view.getUint16(i + 2)), 0, 0, 0, 0].slice(0, 4);
      }
    }
    return reply(buildResponse(query, raw, { rcode: Rcode.NOERROR, answers: [{ type: RRType.A, ttl: 60, data: Uint8Array.from(address) }] }));
  }

  // ECH and HTTPS records: a Cloudflare-proxied name without and with its own HTTPS record
  const https = (params: [number, Uint8Array][]) => [{ type: RRType.HTTPS, ttl: 120, data: encodeSvcb({ priority: 1, target: "", params: new Map(params) }) }];
  if (name === "cloudflare-ech.com" && type === RRType.HTTPS) {
    // An upstream that cannot resolve the ECH source, for the stored-config fallback
    if (url.hostname === "noech.test") return reply(buildResponse(query, raw, { rcode: Rcode.SERVFAIL }));
    return reply(buildResponse(query, raw, { rcode: Rcode.NOERROR, answers: https([[SvcParam.ECH, Uint8Array.of(0xec, 0x40)]]) }));
  }
  // A name that reaches Cloudflare through a CNAME, like zones on partial (CNAME) setup
  if (name === "cname-proxied.test") {
    const target = "cname-proxied.test.cdn.cloudflare.net";
    const answers: AnswerRecord[] = [{ type: RRType.CNAME, ttl: 600, data: encodeName(target) }];
    if (type === RRType.A) answers.push({ name: encodeName(target), type: RRType.A, ttl: 600, data: encodeIPv4("104.16.1.4") });
    return reply(buildResponse(query, raw, { rcode: Rcode.NOERROR, answers }));
  }
  if (name === "proxied.test" || name === "proxied-https.test") {
    if (type === RRType.A) return reply(buildResponse(query, raw, { rcode: Rcode.NOERROR, answers: [{ type: RRType.A, ttl: 600, data: encodeIPv4("104.16.1.2") }] }));
    if (type === RRType.HTTPS && name === "proxied-https.test") {
      return reply(
        buildResponse(query, raw, {
          rcode: Rcode.NOERROR,
          answers: https([
            [SvcParam.ALPN, encodeAlpn(["h2"])],
            [SvcParam.IPV4HINT, encodeIPv4("104.16.1.3")],
          ]),
        }),
      );
    }
    return reply(buildResponse(query, raw, { rcode: Rcode.NOERROR }));
  }
  if (type === RRType.HTTPS) return reply(buildResponse(query, raw, { rcode: Rcode.NOERROR }));
  // Public names answering with private addresses, for the rebinding protection
  if (name.endsWith(".rebind.test")) {
    const address = name.startsWith("lan.") ? encodeIPv4("192.168.1.10") : name.startsWith("v6.") ? encodeIPv6("fd00::1") : encodeIPv4("8.8.8.8");
    const answers: AnswerRecord[] = [];
    if (name.startsWith("cname.")) answers.push({ type: RRType.CNAME, ttl: 60, data: encodeName("lan.rebind.test") }, { name: encodeName("lan.rebind.test"), type: RRType.A, ttl: 60, data: encodeIPv4("10.0.0.5") });
    else if ((address.length === 4) === (type === RRType.A)) answers.push({ type, ttl: 60, data: address });
    return reply(buildResponse(query, raw, { rcode: Rcode.NOERROR, answers }));
  }
  // The primary answers late, so parallel mode is expected to take the backup's answer
  if (name.startsWith("slow.") && url.hostname === "primary.test") await new Promise((r) => setTimeout(r, 300));

  const count = (counters.get(name) ?? 0) + 1;
  counters.set(name, count);
  const last = url.hostname === "backup.test" ? 200 + count : url.hostname === "route.test" ? 100 + count : count;
  return reply(
    buildResponse(query, raw, {
      rcode: Rcode.NOERROR,
      answers: [{ type: RRType.A, ttl: 300, data: encodeIPv4(`192.0.2.${last}`) }],
    }),
  );
}

/** Messages posted to hooks.test/ok, read back and cleared through hooks.test/received */
const hookLog: unknown[] = [];

async function fakeWebhook(url: URL, request: Request): Promise<Response> {
  if (url.pathname === "/received") return Response.json(hookLog.splice(0));
  if (url.pathname === "/fail") return new Response("nope", { status: 500 });
  hookLog.push(await request.json());
  return new Response(null, { status: 204 });
}

/** Last SQL statements received, exposed through a debug row so tests can assert on them */
const sqlLog: string[] = [];

/** Minimal stand-in for the Analytics Engine SQL API */
async function fakeSqlApi(request: Request): Promise<Response> {
  if (request.headers.get("authorization") !== "Bearer test-token") return new Response("unauthorized", { status: 403 });
  const sql = await request.text();
  sqlLog.push(sql);
  const data = (rows: unknown[]) => Response.json({ meta: [], data: rows, rows: rows.length });

  if (sql.includes("fail_please")) return new Response("boom", { status: 500 });
  if (sql.includes("AS limited")) return data([{ total: "200", failed: "20", blocked: "50", limited: "3" }]);
  if (sql.includes("AS avg_latency_ms")) {
    return data([{ total: "200", blocked: "50", rewritten: "2", allowlisted: "3", cached: "80", failed: "1", avg_latency_ms: 12.345 }]);
  }
  if (sql.includes("AS bucket")) {
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
    return data([{ bucket: hour, total: "7", blocked: "2" }]);
  }
  if (sql.includes("AS p95_ms")) return data([{ host: "dns.google", answered: "90", avg_ms: 23.456, p95_ms: 80 }]);
  if (sql.includes("GROUP BY failed")) {
    return data([
      { failed: "down.test", count: "4" },
      { failed: "down.test,dns.google", count: "3" },
      { failed: "dns.google", count: "7" },
    ]);
  }
  if (sql.includes("GROUP BY key")) {
    const label = sql.includes("argMax") ? { label: "Phone" } : {};
    return data([{ key: "doubleclick.net", ...label, count: "42" }]);
  }
  if (sql.includes("ORDER BY timestamp DESC")) {
    return data([
      {
        timestamp: "2026-10-24 15:30:00",
        device: "aaaaaaaaaa",
        device_name: "Phone",
        name: "ads.example",
        type: "A",
        action: "block",
        source: "local",
        rcode: "NOERROR",
        rule: "||ads.example^",
        list: "test",
        line: 1,
        upstream: "",
        latency_ms: 0,
        sample_interval: "1",
        sql_seen: sqlLog.length,
      },
    ]);
  }
  return data([{ echo: sql }]);
}

/** HostlistsRegistry stand-in with one list */
function fakeRegistry(url: URL): Response {
  if (url.pathname.endsWith("/filters.json")) {
    return Response.json({
      groups: [{ groupId: 1, groupName: "General", displayNumber: 1 }],
      tags: [],
      filters: [
        {
          filterKey: "test_registry_list",
          filterId: 99,
          groupId: 1,
          name: "Test registry list",
          description: "for tests",
          deprecated: false,
          tags: [],
          languages: [],
          downloadUrl: "https://adguardteam.github.io/HostlistsRegistry/assets/filter_99.txt",
        },
      ],
    });
  }
  if (url.pathname.endsWith("/filter_99.txt")) return new Response("! Title: test\n||from-registry.test^\n");
  return new Response("not found", { status: 404 });
}
