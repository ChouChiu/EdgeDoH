/**
 * Adblock wildcard patterns such as `||ads*.example.com^`, matched without RegExp.
 * V8 compiles every RegExp on its first and again on a later execution, which for hundreds
 * of rules costs more than the 10 ms CPU budget of a cold Workers isolate
 */
export interface Glob {
  /** none: anywhere, start: `|`, domain: `||` (start of the name or after a dot) */
  anchor: "none" | "start" | "domain";
  /** `^` or `|` at the end: the pattern must reach the end of the name */
  end: boolean;
  /** Literal segments between `*` wildcards, lowercase */
  parts: string[];
}

/**
 * Greedy leftmost matching is exact for globs whose only wildcard is `*`: taking the earliest
 * position for each segment leaves the most room for the rest
 */
export function globMatch(glob: Glob, name: string): boolean {
  const { parts, end } = glob;
  const last = parts.length - 1;
  const first = parts[0]!;

  let pos: number;
  if (glob.anchor === "start") {
    if (!name.startsWith(first)) return false;
    pos = first.length;
  } else if (glob.anchor === "domain") {
    const at = first === "" || name.startsWith(first) ? 0 : name.indexOf(`.${first}`) + 1;
    if (at === 0 && first !== "" && !name.startsWith(first)) return false;
    pos = at + first.length;
    // Without wildcards the single segment must still be able to reach the end
    if (last === 0) return !end || pos === name.length || endsAtBoundary(name, first);
  } else {
    if (last === 0) return end ? name.endsWith(first) : name.includes(first);
    const at = name.indexOf(first);
    if (at < 0) return false;
    pos = at + first.length;
  }

  if (last === 0) return !end || pos === name.length;

  for (let i = 1; i < last; i++) {
    const at = name.indexOf(parts[i]!, pos);
    if (at < 0) return false;
    pos = at + parts[i]!.length;
  }

  const tail = parts[last]!;
  if (end) return name.length - tail.length >= pos && name.endsWith(tail);
  return name.indexOf(tail, pos) >= 0;
}

/** `||a.b^` without wildcards: the name is `a.b` or ends with `.a.b` */
function endsAtBoundary(name: string, domain: string): boolean {
  return name === domain || name.endsWith(`.${domain}`);
}

/**
 * The longest label the pattern forces the name to contain whole, if any. `||ads*.example.com^`
 * yields `example`: every match has it between dots (or at an anchored edge). Used to index
 * wildcard rules so a query only tests the few whose label it actually has
 */
export function indexLabel(glob: Glob): string | undefined {
  let best: string | undefined;
  glob.parts.forEach((part, i) => {
    const pieces = part.split(".");
    pieces.forEach((piece, j) => {
      if (piece === "") return;
      const startsAtBoundary = j > 0 || (i === 0 && glob.anchor !== "none");
      const endsAtBoundary = j < pieces.length - 1 || (i === glob.parts.length - 1 && glob.end);
      if (startsAtBoundary && endsAtBoundary && piece.length > (best?.length ?? 0)) best = piece;
    });
  });
  return best;
}

/**
 * Literal text a `^`-anchored regex must start with, e.g. `139.45.197.` for `/^139\.45\.197\.\d+/`.
 * Lets most regex rules be skipped, and never compiled, for ordinary names
 */
export function regexPrefix(source: string): string {
  if (!source.startsWith("^") || hasTopLevelAlternation(source)) return "";
  let out = "";
  for (let i = 1; i < source.length; i++) {
    const c = source[i]!;
    if (c === "\\" && source[i + 1] === ".") {
      out += ".";
      i++;
    } else if (/[a-z0-9_-]/.test(c)) {
      // A quantifier after this character would make it optional, so stop before it
      if (/[?*{]/.test(source[i + 1] ?? "")) break;
      out += c;
    } else {
      break;
    }
  }
  return out;
}

/** `^ab|cd` matches `cd` anywhere, so a prefix only holds without top-level `|` */
function hasTopLevelAlternation(source: string): boolean {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === "\\") i++;
    else if (inClass) inClass = c !== "]";
    else if (c === "[") inClass = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "|" && depth === 0) return true;
  }
  return false;
}
