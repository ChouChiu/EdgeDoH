import { DnsParseError } from "./message.ts";

/** Decodes the unpadded base64url `dns` parameter of a DoH GET request (RFC 8484 section 4.1) */
export function decodeBase64Url(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(input)) throw new DnsParseError("invalid base64url");
  const b64 = input.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new DnsParseError("invalid base64url");
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
