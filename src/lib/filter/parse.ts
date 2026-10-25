import { isIPv4, isIPv6, Rcode, RRType } from "#dns";
import type { Glob } from "./glob.ts";
import type { ClientMatcher, Modifiers, ParseResult, Pattern, Rewrite, Rule } from "./types.ts";

const LABEL = "[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?";
const DOMAIN_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Cosmetic, scriptlet and HTML filtering markers used by browser ad blockers */
const COSMETIC_RE = /#[@?$%]{0,2}#|\$@?\$/;

/** Addresses that mean "block" in hosts files, as in AdGuard Home */
const NULL_IPS = new Set(["0.0.0.0", "127.0.0.1", "::", "::1", "0:0:0:0:0:0:0:0", "0:0:0:0:0:0:0:1"]);

/** Boilerplate names found in most hosts files that must never be blocked */
const HOSTS_SKIP = new Set([
  "localhost",
  "localhost.localdomain",
  "local",
  "broadcasthost",
  "ip6-localhost",
  "ip6-loopback",
  "ip6-localnet",
  "ip6-mcastprefix",
  "ip6-allnodes",
  "ip6-allrouters",
  "ip6-allhosts",
  "0.0.0.0",
]);

/** Rule text is untrusted, so keys like `constructor` must not reach Object.prototype */
function rcodeNamed(name: string): number | undefined {
  return Object.hasOwn(Rcode, name) ? Rcode[name as keyof typeof Rcode] : undefined;
}

class RuleError extends Error {}

export function isDomain(s: string): boolean {
  return s.length > 0 && s.length <= 253 && DOMAIN_RE.test(s);
}

/**
 * Parses one line of an AdGuard DNS filter list: Adblock-style, /etc/hosts-style or
 * domains-only syntax. https://adguard-dns.io/kb/general/dns-filtering-syntax/
 */
export function parseLine(raw: string, line: number): ParseResult {
  const text = raw.trim();
  if (text === "" || text.startsWith("!") || text.startsWith("#") || text.startsWith("[")) return { type: "skip" };
  if (!text.startsWith("/") && COSMETIC_RE.test(text)) return { type: "unsupported", reason: "cosmetic rule" };

  try {
    return parseHostsOrDomain(text, line) ?? parseAdblock(text, line);
  } catch (err) {
    if (err instanceof RuleError) return { type: "unsupported", reason: err.message };
    throw err;
  }
}

function parseHostsOrDomain(text: string, line: number): ParseResult | undefined {
  const comment = text.search(/\s#/);
  const fields = (comment >= 0 ? text.slice(0, comment) : text).split(/\s+/);

  if (fields.length === 1) {
    const domain = normalizeDomain(fields[0]!);
    if (!isDomain(domain)) return undefined;
    return { type: "rules", rules: [hostRule(domain, undefined, "domain", line, text)] };
  }

  const ip = fields[0]!;
  if (!isIP(ip)) return undefined;
  const rewrite: Rewrite | undefined = NULL_IPS.has(ip)
    ? undefined
    : { rcode: Rcode.NOERROR, type: ip.includes(":") ? RRType.AAAA : RRType.A, value: ip };

  const rules: Rule[] = [];
  for (const name of fields.slice(1)) {
    const domain = normalizeDomain(name);
    if (HOSTS_SKIP.has(domain) || !isDomain(domain)) continue;
    rules.push(hostRule(domain, rewrite, "hosts", line, `${ip} ${domain}`));
  }
  return rules.length > 0 ? { type: "rules", rules } : { type: "skip" };
}

function hostRule(domain: string, rewrite: Rewrite | undefined, syntax: "hosts" | "domain", line: number, text: string): Rule {
  return {
    action: "block",
    important: false,
    pattern: { kind: "exact", domain },
    ...(rewrite && { mods: { raw: "", rewrite } }),
    syntax,
    line,
    text,
  };
}

function parseAdblock(text: string, line: number): ParseResult {
  let rest = text;
  const allow = rest.startsWith("@@");
  if (allow) rest = rest.slice(2);

  let patternText = rest;
  let modText: string | undefined;
  const split = rest.startsWith("/") ? rest.lastIndexOf("/$") + 1 : rest.lastIndexOf("$");
  if (split > 0 || (split === 0 && !rest.startsWith("/"))) {
    patternText = rest.slice(0, split);
    modText = rest.slice(split + 1);
  }

  const tokens = modText === undefined ? [] : splitUnquoted(modText, ",");
  let important = false;
  let badfilter = false;
  const mods: Modifiers = { raw: modText ?? "" };
  let hasMods = false;
  const kept: string[] = [];

  for (const token of tokens) {
    const eq = token.indexOf("=");
    const name = (eq < 0 ? token : token.slice(0, eq)).trim().toLowerCase();
    const value = eq < 0 ? undefined : token.slice(eq + 1);
    if (name !== "badfilter") kept.push(token);

    switch (name) {
      case "important":
        important = true;
        break;
      case "badfilter":
        badfilter = true;
        break;
      case "dnstype":
        mods.dnstype = parseDnstype(required(name, value));
        hasMods = true;
        break;
      case "client":
        mods.client = parseClients(required(name, value));
        hasMods = true;
        break;
      case "denyallow":
        mods.denyallow = parseDenyallow(required(name, value));
        hasMods = true;
        break;
      case "dnsrewrite":
        if (value === undefined || value === "") {
          if (!allow) throw new RuleError("empty $dnsrewrite on a blocking rule");
          mods.rewriteException = true;
        } else {
          mods.rewrite = parseRewrite(value);
        }
        hasMods = true;
        break;
      case "ctag":
        throw new RuleError("unsupported modifier $ctag");
      default:
        throw new RuleError(`unsupported modifier $${name || "(empty)"}`);
    }
  }

  if (badfilter) {
    const target = (allow ? "@@" : "") + patternText + (kept.length > 0 ? "$" + kept.join(",") : "");
    return { type: "badfilter", target: badfilterKey(target) };
  }

  if (allow && mods.rewrite) {
    mods.rewriteException = mods.rewrite;
    delete mods.rewrite;
  }

  const pattern = toPattern(patternText, hasMods);
  return {
    type: "rules",
    rules: [{ action: allow ? "allow" : "block", important, pattern, ...(hasMods && { mods }), syntax: "adblock", line, text }],
  };
}

/** Badfilter targets are compared by exact rule text, case-insensitively */
export function badfilterKey(text: string): string {
  return text.trim().toLowerCase();
}

function toPattern(text: string, hasMods: boolean): Pattern {
  if (text.length > 2 && text.startsWith("/") && text.endsWith("/")) {
    const source = text.slice(1, -1);
    try {
      new RegExp(source);
    } catch {
      throw new RuleError("invalid regular expression");
    }
    return { kind: "regex", source };
  }

  let s = text.toLowerCase();
  if (s === "") {
    if (!hasMods) throw new RuleError("empty pattern");
    s = "*";
  }
  if (/[/:\s]/.test(s)) throw new RuleError("URL patterns cannot match hostnames");

  const anchor: Glob["anchor"] = s.startsWith("||") ? "domain" : s.startsWith("|") ? "start" : "none";
  const { body, end } = stripEnd(s.slice(anchor === "domain" ? 2 : anchor === "start" ? 1 : 0));
  if (end && anchor !== "none") {
    const domain = toAscii(body);
    if (isDomain(domain)) return { kind: anchor === "domain" ? "suffix" : "exact", domain };
  }
  // Hostnames contain no separators, so `^` or `|` anywhere else can never match
  if (/[\^|]/.test(body)) throw new RuleError("separator inside pattern");
  return { kind: "wildcard", glob: { anchor, end, parts: body.split("*") } };
}

function stripEnd(s: string): { body: string; end: boolean } {
  const end = ["^|", "^", "|"].find((e) => s.endsWith(e));
  return end ? { body: s.slice(0, -end.length), end: true } : { body: s, end: false };
}

function parseDnstype(value: string): { include: number[]; exclude: number[] } {
  const include: number[] = [];
  const exclude: number[] = [];
  for (const part of value.split("|")) {
    const negated = part.startsWith("~");
    const name = (negated ? part.slice(1) : part).trim().toUpperCase();
    const code = Object.hasOwn(RRType, name) ? RRType[name as keyof typeof RRType] : /^TYPE(\d{1,5})$/.exec(name)?.[1];
    if (code === undefined || Number(code) > 65535) throw new RuleError(`unknown DNS type in $dnstype: ${name}`);
    (negated ? exclude : include).push(Number(code));
  }
  // Mixing is pointless: inclusions already exclude everything else
  return include.length > 0 ? { include, exclude: [] } : { include, exclude };
}

function parseClients(value: string): ClientMatcher {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const part of splitUnquoted(value, "|")) {
    const negated = part.startsWith("~");
    let body = negated ? part.slice(1) : part;
    const quote = body[0];
    if ((quote === "'" || quote === '"') && body.endsWith(quote) && body.length >= 2) body = body.slice(1, -1);
    body = body.replace(/\\(.)/g, "$1").trim().toLowerCase();
    if (body === "") throw new RuleError("empty $client value");
    (negated ? exclude : include).push(body);
  }
  return { include, exclude };
}

function parseDenyallow(value: string): string[] {
  return value.split("|").map((part) => {
    const domain = normalizeDomain(part);
    if (!isDomain(domain)) throw new RuleError(`invalid domain in $denyallow: ${part}`);
    return domain;
  });
}

function parseRewrite(value: string): Rewrite {
  if (value.includes(";")) {
    const parts = value.split(";");
    if (parts.length !== 3) throw new RuleError("$dnsrewrite expects RCODE;RRTYPE;VALUE");
    const [rcodeName, typeName, data] = parts as [string, string, string];
    const rcode = rcodeNamed(rcodeName);
    if (rcode === undefined) throw new RuleError(`unknown rcode in $dnsrewrite: ${rcodeName}`);
    if (rcode !== Rcode.NOERROR || typeName === "") return { rcode };
    switch (typeName.toUpperCase()) {
      case "A":
        return { rcode, type: RRType.A, value: checkIP(data, isIPv4) };
      case "AAAA":
        return { rcode, type: RRType.AAAA, value: checkIP(data, isIPv6) };
      case "CNAME":
        return { rcode, type: RRType.CNAME, value: checkDomain(data) };
      default:
        throw new RuleError(`unsupported $dnsrewrite type: ${typeName}`);
    }
  }

  const rcode = rcodeNamed(value);
  if (rcode !== undefined) return { rcode };
  if (IPV4_RE.test(value)) return { rcode: Rcode.NOERROR, type: RRType.A, value: checkIP(value, isIPv4) };
  if (value.includes(":")) return { rcode: Rcode.NOERROR, type: RRType.AAAA, value: checkIP(value, isIPv6) };
  return { rcode: Rcode.NOERROR, type: RRType.CNAME, value: checkDomain(value) };
}

function checkIP(value: string, valid: (s: string) => boolean): string {
  if (!valid(value)) throw new RuleError(`invalid address in $dnsrewrite: ${value}`);
  return value;
}

function checkDomain(value: string): string {
  const domain = normalizeDomain(value);
  if (!isDomain(domain)) throw new RuleError(`invalid domain in $dnsrewrite: ${value}`);
  return domain;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === "") throw new RuleError(`$${name} requires a value`);
  return value;
}

/** Splits on `sep` outside quotes, honouring backslash escapes */
function splitUnquoted(s: string, sep: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < s.length) {
      current += c + s[++i];
    } else if (quote) {
      if (c === quote) quote = undefined;
      current += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === sep) {
      out.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  out.push(current);
  return out;
}

function isIP(s: string): boolean {
  return IPV4_RE.test(s) ? isIPv4(s) : s.includes(":") && isIPv6(s);
}

function normalizeDomain(s: string): string {
  const lower = s.trim().toLowerCase();
  return toAscii(lower.endsWith(".") ? lower.slice(0, -1) : lower);
}

function toAscii(domain: string): string {
  if (!/[^\x00-\x7f]/.test(domain)) return domain;
  try {
    return new URL(`http://${domain}`).hostname;
  } catch {
    return domain;
  }
}
