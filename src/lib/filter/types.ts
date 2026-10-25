import type { Glob } from "./glob.ts";

export type Action = "block" | "allow";

/** Where a rule came from syntactically; drives how it is shown back to the user */
export type Syntax = "adblock" | "hosts" | "domain";

export type Pattern =
  /** Matches the domain itself only */
  | { kind: "exact"; domain: string }
  /** Matches the domain and all of its subdomains */
  | { kind: "suffix"; domain: string }
  /** Adblock wildcard pattern, matched without RegExp */
  | { kind: "wildcard"; glob: Glob }
  /** `/regex/` rules, matched against the lowercase hostname without trailing dot */
  | { kind: "regex"; source: string };

/**
 * A `$dnsrewrite` value. `type`/`value` are absent for keyword rewrites such as NXDOMAIN
 * or an empty NOERROR
 */
export interface Rewrite {
  rcode: number;
  type?: number;
  value?: string;
}

export interface ClientMatcher {
  include: string[];
  exclude: string[];
}

export interface Modifiers {
  /** Original modifier text after `$`, kept for display */
  raw: string;
  dnstype?: { include: number[]; exclude: number[] };
  client?: ClientMatcher;
  denyallow?: string[];
  /** On blocking rules: the replacement answer */
  rewrite?: Rewrite;
  /** On exception rules: cancels every rewrite (`true`) or only the identical one */
  rewriteException?: true | Rewrite;
}

export interface Rule {
  action: Action;
  important: boolean;
  pattern: Pattern;
  mods?: Modifiers;
  syntax: Syntax;
  /** 1-based line number in the source list */
  line: number;
  text: string;
}

export type ParseResult =
  | { type: "rules"; rules: Rule[] }
  | { type: "badfilter"; target: string }
  | { type: "skip" }
  | { type: "unsupported"; reason: string };
