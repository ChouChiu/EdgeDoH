import { describe, expect, it } from "vitest";

// Source text of every module, tests excluded: they may wire features together however they need.
// Worker features are checked here too, because the Worker test pool has no file system access
const read = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([path]) => !/\.test\.tsx?$/.test(path)));
const web = read(import.meta.glob<string>("/src/web/features/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }));
const worker = read(import.meta.glob<string>("/src/worker/features/**/*.ts", { query: "?raw", import: "default", eager: true }));

const featureOf = (path: string) => path.split("/")[4]!;
const specifiers = (source: string) => [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);

/** Feature to the features it imports */
function graph(files: Record<string, string>, target: (specifier: string) => string | undefined): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (const [path, source] of Object.entries(files)) {
    const from = featureOf(path);
    const to = edges.get(from) ?? new Set<string>();
    for (const spec of specifiers(source)) {
      const feature = target(spec);
      if (feature && feature !== from) to.add(feature);
    }
    edges.set(from, to);
  }
  return edges;
}

/** One cycle as a path such as `a -> b -> a`, or undefined */
function findCycle(edges: Map<string, Set<string>>): string | undefined {
  const done = new Set<string>();
  const visit = (node: string, path: string[]): string | undefined => {
    if (path.includes(node)) return [...path.slice(path.indexOf(node)), node].join(" -> ");
    if (done.has(node)) return undefined;
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next, [...path, node]);
      if (cycle) return cycle;
    }
    done.add(node);
    return undefined;
  };
  for (const node of edges.keys()) {
    const cycle = visit(node, []);
    if (cycle) return cycle;
  }
  return undefined;
}

describe("feature boundaries", () => {
  it("lets a dashboard feature reach another one only through its api.ts, and never the app shell", () => {
    const offending = Object.entries(web).flatMap(([path, source]) =>
      specifiers(source)
        .filter((spec) => spec.startsWith("@/app/") || (spec.startsWith("@/features/") && spec.split("/")[2] !== featureOf(path) && spec.split("/")[3] !== "api"))
        .map((spec) => `${path}: ${spec}`),
    );
    expect(offending).toEqual([]);
  });

  it("keeps dashboard features free of import cycles", () => {
    expect(findCycle(graph(web, (spec) => /^@\/features\/([^/]+)\//.exec(spec)?.[1]))).toBeUndefined();
  });

  it("keeps Worker features free of import cycles", () => {
    expect(findCycle(graph(worker, (spec) => /^\.\.\/([^/.]+)\//.exec(spec)?.[1]))).toBeUndefined();
  });
});
