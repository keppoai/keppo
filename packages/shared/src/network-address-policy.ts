import { isIP } from "node:net";

export const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

const stripIpv6ZoneId = (address: string): string => {
  const percentIndex = address.indexOf("%");
  return percentIndex >= 0 ? address.slice(0, percentIndex) : address;
};

export const normalizeHostname = (hostname: string): string =>
  stripIpv6ZoneId(hostname.trim().toLowerCase())
    .replace(/^\[(.*)\]$/u, "$1")
    .replace(/\.+$/u, "");

const toIPv4Octets = (ip: string): number[] | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets;
};

const parseIPv6Segments = (input: string): number[] | null => {
  const normalized = normalizeHostname(input);
  if (!normalized) {
    return null;
  }

  let ipv4Tail: number[] = [];
  let ipv6Part = normalized;
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    if (lastColon < 0) {
      return null;
    }
    const ipv4 = normalized.slice(lastColon + 1);
    const octets = toIPv4Octets(ipv4);
    if (!octets) {
      return null;
    }
    ipv6Part = normalized.slice(0, lastColon);
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    ipv4Tail = [(a << 8) | b, (c << 8) | d];
  }

  const doubleColonIndex = ipv6Part.indexOf("::");
  if (doubleColonIndex !== ipv6Part.lastIndexOf("::")) {
    return null;
  }

  const [headRaw, tailRaw = ""] =
    doubleColonIndex >= 0
      ? [ipv6Part.slice(0, doubleColonIndex), ipv6Part.slice(doubleColonIndex + 2)]
      : [ipv6Part];

  const parseSide = (value: string): number[] | null => {
    if (!value) {
      return [];
    }
    const parts = value.split(":");
    const segments: number[] = [];
    for (const part of parts) {
      if (!/^[\da-f]{1,4}$/i.test(part)) {
        return null;
      }
      segments.push(Number.parseInt(part, 16));
    }
    return segments;
  };

  const head = parseSide(headRaw);
  const tail = parseSide(tailRaw);
  if (!head || !tail) {
    return null;
  }

  const nonCompressedLength = head.length + tail.length + ipv4Tail.length;
  if (doubleColonIndex >= 0) {
    if (nonCompressedLength > 8) {
      return null;
    }
    return [...head, ...new Array(8 - nonCompressedLength).fill(0), ...tail, ...ipv4Tail];
  }

  if (nonCompressedLength !== 8) {
    return null;
  }
  return [...head, ...tail, ...ipv4Tail];
};

const toEmbeddedIPv4 = (segments: number[]): string | null => {
  if (segments.length !== 8) {
    return null;
  }
  const highSegmentsAreZero = segments.slice(0, 5).every((segment) => segment === 0);
  const bridgeSegment = segments[5] ?? -1;
  if (!highSegmentsAreZero || (bridgeSegment !== 0 && bridgeSegment !== 0xffff)) {
    return null;
  }

  const a = ((segments[6] ?? 0) >> 8) & 0xff;
  const b = (segments[6] ?? 0) & 0xff;
  const c = ((segments[7] ?? 0) >> 8) & 0xff;
  const d = (segments[7] ?? 0) & 0xff;
  return `${a}.${b}.${c}.${d}`;
};

export const isLoopbackAddress = (address: string): boolean => {
  const normalized = normalizeHostname(address);
  if (isIP(normalized) === 4) {
    const octets = toIPv4Octets(normalized);
    return (octets?.[0] ?? -1) === 127;
  }

  const segments = parseIPv6Segments(normalized);
  return (
    segments !== null && segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1
  );
};

export const isBlockedIPv4 = (address: string): boolean => {
  const octets = toIPv4Octets(address);
  if (!octets) {
    return true;
  }
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  return a >= 224;
};

export const isBlockedIPv6 = (address: string): boolean => {
  const segments = parseIPv6Segments(address);
  if (!segments) {
    return true;
  }
  if (segments.every((segment) => segment === 0)) {
    return true;
  }
  if (segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1) {
    return true;
  }

  const embeddedIPv4 = toEmbeddedIPv4(segments);
  if (embeddedIPv4) {
    return isBlockedIPv4(embeddedIPv4);
  }

  const firstSegment = segments[0] ?? 0;
  if ((firstSegment & 0xfe00) === 0xfc00) {
    return true;
  }
  if ((firstSegment & 0xffc0) === 0xfe80) {
    return true;
  }
  return (firstSegment & 0xff00) === 0xff00;
};

export const isBlockedIpAddress = (address: string): boolean => {
  const normalized = normalizeHostname(address);
  const version = isIP(normalized);
  if (version === 4) {
    return isBlockedIPv4(normalized);
  }
  if (version === 6) {
    return isBlockedIPv6(normalized);
  }
  return true;
};
