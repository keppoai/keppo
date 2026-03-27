export interface AutomationEngine {
  checkScheduledAutomations(limit: number): Promise<void>;
  processAutomationTriggerEvents(limit: number): Promise<void>;
  reapStaleRuns(limit: number): Promise<void>;
  archiveHotLogs(opts: { limit: number; scanLimit: number }): Promise<void>;
  expireColdLogs(opts: { limit: number; scanLimit: number }): Promise<void>;
}
