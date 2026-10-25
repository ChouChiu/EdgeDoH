import { compile, type FilterSource } from "#filter";

export type CompileRequest = { sources: FilterSource[] };
export type CompileResponse =
  | ({ ok: true } & ReturnType<typeof compile>)
  | { ok: false; error: string };

self.onmessage = (event: MessageEvent<CompileRequest>) => {
  try {
    const result = compile(event.data.sources);
    const message: CompileResponse = { ok: true, ...result };
    const buffers = [result.snapshot.meta, ...result.snapshot.shards].map((b) => b.buffer as ArrayBuffer);
    (self as unknown as Worker).postMessage(message, buffers);
  } catch (err) {
    const message: CompileResponse = { ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(message);
  }
};
