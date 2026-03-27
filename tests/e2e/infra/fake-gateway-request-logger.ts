import type { ProviderEventRecord } from "../providers/contract/provider-events";

const DEFAULT_NAMESPACE = "global";

export class FakeGatewayRequestLogger {
  private readonly events: ProviderEventRecord[] = [];

  capture(event: ProviderEventRecord): void {
    this.events.push(event);
  }

  list(namespace?: string): ProviderEventRecord[] {
    const selected = namespace?.trim();
    if (!selected) {
      return [...this.events];
    }
    return this.events.filter((event) => event.namespace === selected);
  }

  listForeign(namespace: string): ProviderEventRecord[] {
    return this.events.filter((event) => event.namespace !== namespace);
  }

  assertNoCrossNamespaceLeak(namespace: string): void {
    const leaks = this.events.filter(
      (event) => event.namespace !== namespace && event.namespace !== DEFAULT_NAMESPACE,
    );
    if (leaks.length > 0) {
      throw new Error(
        `Foreign namespace provider events detected for ${namespace}: ${JSON.stringify(
          leaks.map((event) => ({
            namespace: event.namespace,
            provider: event.provider,
            method: event.method,
            path: event.path,
          })),
        )}`,
      );
    }
  }

  reset(namespace?: string): void {
    const selected = namespace?.trim();
    if (!selected) {
      this.events.length = 0;
      return;
    }
    let index = this.events.length;
    while (index > 0) {
      index -= 1;
      if (this.events[index]?.namespace === selected) {
        this.events.splice(index, 1);
      }
    }
  }
}

export const resolveNamespaceFromRequest = (headers: Headers, fallback?: string): string => {
  const headerNamespace =
    headers.get("x-keppo-e2e-namespace") ?? headers.get("x-e2e-namespace") ?? fallback;
  if (!headerNamespace || !headerNamespace.trim()) {
    return DEFAULT_NAMESPACE;
  }
  return headerNamespace.trim();
};
