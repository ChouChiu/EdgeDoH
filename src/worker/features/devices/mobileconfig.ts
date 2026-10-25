import { sha256, toHex } from "../../shared/crypto.ts";
import type { Device } from "./store.ts";

/** Unsigned Apple configuration profile that points iOS / macOS system DNS at this device's DoH URL */
export async function mobileconfig(device: Device, dohUrl: string): Promise<string> {
  const host = new URL(dohUrl).hostname;
  const identifier = `${host.split(".").reverse().join(".")}.${device.id}`;
  const [outer, inner] = await Promise.all([stableUuid(`${device.id}:profile`), stableUuid(`${device.id}:dns`)]);
  const name = escapeXml(`cf-dns · ${device.name}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>DNSSettings</key>
      <dict>
        <key>DNSProtocol</key>
        <string>HTTPS</string>
        <key>ServerURL</key>
        <string>${escapeXml(dohUrl)}</string>
      </dict>
      <key>PayloadDisplayName</key>
      <string>${name}</string>
      <key>PayloadIdentifier</key>
      <string>${identifier}.dns</string>
      <key>PayloadType</key>
      <string>com.apple.dnsSettings.managed</string>
      <key>PayloadUUID</key>
      <string>${inner}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>${name}</string>
  <key>PayloadIdentifier</key>
  <string>${identifier}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${outer}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}

/** Same device, same UUIDs, so reinstalling replaces the old profile instead of adding another */
async function stableUuid(seed: string): Promise<string> {
  const bytes = (await sha256(seed)).subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = toHex(bytes).toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}
