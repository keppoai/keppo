import { describe, expect, it, vi } from "vitest";
import { UnikraftCloudClient, UnikraftCloudClientError } from "./client.js";

describe("UnikraftCloudClient", () => {
  it("creates instances with the expected metro URL, headers, and body", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            instance: {
              uuid: "inst_123",
              name: "keppo-run",
              state: "running",
              image: "ghcr.io/keppo/automation:latest",
              created_at: "2026-03-22T00:00:00Z",
            },
          },
        }),
        { status: 200 },
      ),
    );

    const client = new UnikraftCloudClient({ token: "uk_test", metro: "fra0" }, fetchFn);
    const instance = await client.createInstance({
      image: "ghcr.io/keppo/automation:latest",
      env: { KEY: "value" },
      autostart: true,
      restart_policy: "never",
    });

    expect(instance.uuid).toBe("inst_123");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.fra0.unikraft.cloud/v1/instances",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer uk_test",
          accept: "application/json",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          image: "ghcr.io/keppo/automation:latest",
          env: { KEY: "value" },
          autostart: true,
          restart_policy: "never",
        }),
      }),
    );
  });

  it("deletes instances with the expected endpoint", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {},
        }),
        { status: 200 },
      ),
    );

    const client = new UnikraftCloudClient({ token: "uk_test", metro: "sfo0" }, fetchFn);
    await client.deleteInstance("inst_456");

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.sfo0.unikraft.cloud/v1/instances/inst_456",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("stops instances with the documented drain timeout query parameter", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            instance: {
              uuid: "inst_stop",
              name: "keppo-run",
              state: "stopping",
              image: "ghcr.io/keppo/automation:latest",
              created_at: "2026-03-22T00:00:00Z",
            },
          },
        }),
        { status: 200 },
      ),
    );

    const client = new UnikraftCloudClient({ token: "uk_test", metro: "was0" }, fetchFn);
    await client.stopInstance("inst_stop", { drainTimeoutMs: 2_500 });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.was0.unikraft.cloud/v1/instances/inst_stop/stop?drain_timeout_ms=2500",
      expect.objectContaining({
        method: "PUT",
      }),
    );
  });

  it("retrieves instance logs", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            logs: {
              output: "line 1\nline 2\n",
              offset: 0,
              next_offset: 14,
            },
          },
        }),
        { status: 200 },
      ),
    );

    const client = new UnikraftCloudClient({ token: "uk_test", metro: "dal0" }, fetchFn);
    const logs = await client.getInstanceLogs("inst_789", { offset: 10, limit: 1000 });

    expect(logs).toEqual({
      output: "line 1\nline 2\n",
      offset: 0,
      next_offset: 14,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.dal0.unikraft.cloud/v1/instances/inst_789/log?offset=10&limit=1000",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("throws a typed error on non-2xx responses", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ message: "boom" }), { status: 500 }));

    const client = new UnikraftCloudClient({ token: "uk_test", metro: "was0" }, fetchFn);

    await expect(client.listInstances()).rejects.toEqual(
      expect.objectContaining<Partial<UnikraftCloudClientError>>({
        name: "UnikraftCloudClientError",
        status: 500,
      }),
    );
  });

  it("supports already-normalized metro names", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: [],
        }),
        { status: 200 },
      ),
    );

    const client = new UnikraftCloudClient({ token: "uk_test", metro: "sin" }, fetchFn);
    await client.listInstances();

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.sin.unikraft.cloud/v1/instances",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });
});
