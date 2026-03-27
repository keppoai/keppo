import type { AutomationEngine } from "../automation-engine.js";

export const defaultAutomationEngine: AutomationEngine = {
  async checkScheduledAutomations(_limit: number): Promise<void> {},
  async processAutomationTriggerEvents(_limit: number): Promise<void> {},
  async reapStaleRuns(_limit: number): Promise<void> {},
  async archiveHotLogs(_opts: { limit: number; scanLimit: number }): Promise<void> {},
  async expireColdLogs(_opts: { limit: number; scanLimit: number }): Promise<void> {},
};
