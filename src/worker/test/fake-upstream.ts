import { buildResponse, encodeIPv4, parseMessage, Rcode, RRType } from "#dns";

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
  if (url.hostname === "adguardteam.github.io") return fakeRegistry(url);
  if (url.hostname === "lists.test") {
    if (url.pathname === "/missing.txt") return new Response("gone", { status: 404 });
    if (url.pathname === "/titled.txt") return new Response(TITLED_LIST);
    // Longer than the header the Worker keeps, so the cut-off path is exercised
    if (url.pathname === "/long.txt") return new Response(`! Title: Long list\n${"! padding\n".repeat(3000)}||from-long.test^\n`);
    return new Response("||from-url.test^\n");
  }

  const raw = new Uint8Array(await request.arrayBuffer());
  const query = parseMessage(raw);
  const name = query.questions[0]!.name.toLowerCase();
  const reply = (body: Uint8Array) => new Response(body, { headers: { "content-type": "application/dns-message" } });

  if (name === "servfail.test" && url.hostname === "primary.test") {
    return reply(buildResponse(query, raw, { rcode: Rcode.SERVFAIL }));
  }
  if (name === "nx.test") return reply(buildResponse(query, raw, { rcode: Rcode.NXDOMAIN }));
  // The primary answers late, so parallel mode is expected to take the backup's answer
  if (name.startsWith("slow.") && url.hostname === "primary.test") await new Promise((r) => setTimeout(r, 300));

  const count = (counters.get(name) ?? 0) + 1;
  counters.set(name, count);
  const last = url.hostname === "backup.test" ? 200 + count : count;
  return reply(
    buildResponse(query, raw, {
      rcode: Rcode.NOERROR,
      answers: [{ type: RRType.A, ttl: 300, data: encodeIPv4(`192.0.2.${last}`) }],
    }),
  );
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
  if (sql.includes("AS avg_latency_ms")) {
    return data([{ total: "200", blocked: "50", rewritten: "2", allowlisted: "3", cached: "80", failed: "1", avg_latency_ms: 12.345 }]);
  }
  if (sql.includes("AS bucket")) {
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
    return data([{ bucket: hour, total: "7", blocked: "2" }]);
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
