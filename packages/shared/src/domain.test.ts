import { describe, expect, it } from "vitest";
import {
  QUEUE_ENQUEUE_ERROR_CODE,
  formatQueueEnqueueErrorMessage,
  isQueueEnqueueErrorCode,
  parseQueueEnqueueErrorCode,
} from "./domain.js";

describe("queue enqueue error contracts", () => {
  it("formats and parses typed queue enqueue error messages", () => {
    const formatted = formatQueueEnqueueErrorMessage(
      QUEUE_ENQUEUE_ERROR_CODE.localQueueEnqueueFailed,
      "503 overloaded",
    );
    expect(formatted).toBe("local_queue_enqueue_failed: 503 overloaded");
    expect(parseQueueEnqueueErrorCode(formatted)).toBe(
      QUEUE_ENQUEUE_ERROR_CODE.localQueueEnqueueFailed,
    );
  });

  it("parses exact queue enqueue error codes and rejects unknown codes", () => {
    expect(parseQueueEnqueueErrorCode("vercel_queue_send_unavailable")).toBe(
      QUEUE_ENQUEUE_ERROR_CODE.vercelQueueSendUnavailable,
    );
    expect(parseQueueEnqueueErrorCode("queue down")).toBeNull();
    expect(isQueueEnqueueErrorCode("direct_queue_enqueue_failed")).toBe(true);
    expect(isQueueEnqueueErrorCode("unknown_code")).toBe(false);
  });
});
