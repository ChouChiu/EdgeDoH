import { MAX_UPSTREAMS } from "#contract";

export { isUpstreamList } from "#contract";

export const UPSTREAMS_ERROR = `upstreams must be 1-${MAX_UPSTREAMS} https:// DoH URLs`;

export function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return options.includes(value as T);
}
