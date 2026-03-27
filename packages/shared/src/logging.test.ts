import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logging";

describe("createLogger", () => {
  let debugSpy: MockInstance;
  let infoSpy: MockInstance;
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.KEPPO_LOG_LEVEL;
  });

  afterEach(() => {
    delete process.env.KEPPO_LOG_LEVEL;
  });

  it("logs all levels at the default threshold", () => {
    const logger = createLogger("test");

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("suppresses logs below the configured threshold", () => {
    process.env.KEPPO_LOG_LEVEL = "warn";
    const logger = createLogger("test");

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("supports silent level", () => {
    process.env.KEPPO_LOG_LEVEL = "silent";
    const logger = createLogger("test");

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("falls back to debug when configured level is invalid", () => {
    process.env.KEPPO_LOG_LEVEL = "invalid";
    const logger = createLogger("test");

    logger.debug("debug");
    logger.info("info");

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });
});
