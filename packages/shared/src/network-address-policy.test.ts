import { describe, expect, it } from "vitest";
import { isBlockedIpAddress, isBlockedIPv6, isLoopbackAddress } from "./network-address-policy.js";

describe("network address policy", () => {
  it("blocks hex-encoded IPv4-mapped loopback IPv6 literals", () => {
    expect(isBlockedIPv6("::ffff:7f00:1")).toBe(true);
    expect(isBlockedIpAddress("::ffff:7f00:1")).toBe(true);
  });

  it("blocks IPv4-compatible private IPv6 literals", () => {
    expect(isBlockedIPv6("::0a00:0001")).toBe(true);
  });

  it("recognizes IPv6 loopback in expanded form", () => {
    expect(isLoopbackAddress("0:0:0:0:0:0:0:1")).toBe(true);
  });

  it("allows public IPv4-mapped IPv6 literals", () => {
    expect(isBlockedIPv6("::ffff:0808:0808")).toBe(false);
  });
});
