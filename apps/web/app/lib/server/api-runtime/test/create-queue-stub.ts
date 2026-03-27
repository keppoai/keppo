import { vi, type Mock } from "vitest";
import type { QueueClient } from "../queue.js";

export type MockedQueueClient = QueueClient & {
  [K in keyof QueueClient]: Mock;
};

export const createQueueStub = (overrides: Partial<MockedQueueClient> = {}): MockedQueueClient => {
  return {
    enqueueApprovedAction: vi.fn().mockResolvedValue({ messageId: "msg_test" }),
    checkHealth: vi.fn().mockResolvedValue({
      ok: true,
      mode: "convex",
      detail: {},
    }),
    ...overrides,
  } as MockedQueueClient;
};
