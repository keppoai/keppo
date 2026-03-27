export const timeoutScenario = {
  id: "timeout",
  description: "Provider emits deterministic gateway timeout responses to exhaust retries",
  seed: {
    forceTimeout: true,
  },
};
