import { setTimeout as sleep } from "node:timers/promises";

export type CronDriverConfig = {
  apiBaseUrl: string;
  queueBrokerBaseUrl: string;
  authorizationHeader: string | null;
  intervalMs: number;
  maintenanceIntervalMs: number;
  autoStart: boolean;
  pauseRequested?: () => boolean;
  setPausedState?: (paused: boolean) => void;
};

export class CronDriver {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private paused = false;
  private lastMaintenanceAt = 0;
  private lastError: string | null = null;
  private suppressedErrorCount = 0;
  private lastSuppressedFlushAt = 0;
  private readonly suppressedFlushIntervalMs = 5_000;

  constructor(private readonly config: CronDriverConfig) {}

  private maintenanceIntervalMs(): number {
    return Math.max(0, Math.floor(this.config.maintenanceIntervalMs));
  }

  private shouldTriggerMaintenance(now: number): boolean {
    const maintenanceIntervalMs = this.maintenanceIntervalMs();
    if (maintenanceIntervalMs === 0) {
      return false;
    }
    return (
      this.lastMaintenanceAt === 0 ||
      now - this.lastMaintenanceAt >= Math.max(this.config.intervalMs, maintenanceIntervalMs)
    );
  }

  private flushSuppressedSummary(force = false): void {
    if (this.suppressedErrorCount === 0) {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastSuppressedFlushAt < this.suppressedFlushIntervalMs) {
      return;
    }
    process.stderr.write(
      `[cron-driver] (suppressed ${this.suppressedErrorCount} repeated errors)\n`,
    );
    this.suppressedErrorCount = 0;
    this.lastSuppressedFlushAt = now;
  }

  private onTickFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message === this.lastError) {
      this.suppressedErrorCount += 1;
      this.flushSuppressedSummary();
      return;
    }
    this.flushSuppressedSummary(true);
    this.lastError = message;
    this.lastSuppressedFlushAt = Date.now();
    process.stderr.write(`[cron-driver] auto tick failed: ${message}\n`);
  }

  private onTickSuccess(): void {
    this.flushSuppressedSummary(true);
    this.lastError = null;
    this.suppressedErrorCount = 0;
  }

  private syncPausedState(paused: boolean): void {
    if (this.paused === paused) {
      return;
    }
    this.paused = paused;
    this.config.setPausedState?.(paused);
  }

  start(): void {
    if (!this.config.autoStart || this.timer) {
      return;
    }
    this.timer = setInterval(
      () => {
        if (this.config.pauseRequested?.()) {
          if (!this.running) {
            this.syncPausedState(true);
          }
          return;
        }
        this.syncPausedState(false);
        void this.tick().catch((error) => {
          this.onTickFailure(error);
        });
      },
      Math.max(50, this.config.intervalMs),
    );
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.running) {
      await sleep(10);
    }
    this.syncPausedState(false);
    this.flushSuppressedSummary(true);
  }

  getLastError(): string | null {
    return this.lastError;
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    let succeeded = false;
    try {
      let maintenanceError: unknown = null;
      await this.advance(Math.max(1, this.config.intervalMs));
      try {
        const now = Date.now();
        if (this.shouldTriggerMaintenance(now)) {
          await this.triggerMaintenance();
          this.lastMaintenanceAt = now;
        }
      } catch (error) {
        maintenanceError = error;
      }
      await this.drainQueue();
      if (maintenanceError) {
        throw maintenanceError;
      }
      succeeded = true;
    } finally {
      this.running = false;
      if (succeeded) {
        this.onTickSuccess();
      }
    }
  }

  async triggerMaintenance(): Promise<void> {
    const response = await fetch(`${this.config.apiBaseUrl}/internal/cron/maintenance`, {
      method: "POST",
      headers: this.config.authorizationHeader
        ? { authorization: this.config.authorizationHeader }
        : {},
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`cron maintenance request failed: ${response.status} ${text}`);
    }
  }

  async advance(ms: number): Promise<void> {
    const response = await fetch(`${this.config.queueBrokerBaseUrl}/advance`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ms,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`queue broker advance failed: ${response.status} ${text}`);
    }
  }

  async drainQueue(): Promise<void> {
    const response = await fetch(`${this.config.queueBrokerBaseUrl}/drain`, {
      method: "POST",
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`queue broker drain failed: ${response.status} ${text}`);
    }
  }
}
