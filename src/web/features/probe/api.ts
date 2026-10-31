import { useQuery } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";

export interface ProbeDevice {
  id: string;
  name: string;
}

/** Long enough for a slow DoH round trip; a host that does answer the name is not waited on past this */
const LOOKUP_TIMEOUT_MS = 4000;

/**
 * Makes the browser resolve a name only EdgeDoH answers (`<nonce>.edgedoh-probe.<this host>`), then asks the Worker
 * which device's DoH URL saw it. null: this device resolves through something else, such as another resolver,
 * the browser's own secure DNS or a proxy. On `localhost` the lookup never leaves the machine, so it is always null
 */
async function runProbe(): Promise<ProbeDevice | null> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  // Only the lookup matters; EdgeDoH answers NXDOMAIN, so the request itself is expected to fail
  await fetch(`https://${nonce}.edgedoh-probe.${location.hostname}/`, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }).catch(
    () => undefined,
  );
  return (await request<{ device: ProbeDevice | null }>(`/probe/${nonce}`)).device;
}

/** Each run uses a fresh name, so cached lookups never answer for an older one */
export function useProbe() {
  return useQuery({ queryKey: ["probe"], queryFn: runProbe, staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false });
}
