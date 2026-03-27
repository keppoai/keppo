export type WorkerPortBlock = {
  fakeGateway: number;
  api: number;
  dashboard: number;
  queueBroker: number;
};

const DEFAULT_PORT_BASE = Number(process.env.KEPPO_E2E_PORT_BASE ?? 9900);
const PORT_BLOCK_SIZE = Number(process.env.KEPPO_E2E_PORT_BLOCK_SIZE ?? 20);

const resolveBasePort = (): number => {
  if (!Number.isFinite(DEFAULT_PORT_BASE) || DEFAULT_PORT_BASE < 1024) {
    return 9900;
  }
  return Math.floor(DEFAULT_PORT_BASE);
};

const resolveBlockSize = (): number => {
  if (!Number.isFinite(PORT_BLOCK_SIZE) || PORT_BLOCK_SIZE < 5) {
    return 20;
  }
  return Math.floor(PORT_BLOCK_SIZE);
};

export const getWorkerPortBlock = (workerIndex: number): WorkerPortBlock => {
  const index = Number.isFinite(workerIndex) && workerIndex >= 0 ? Math.floor(workerIndex) : 0;
  const base = resolveBasePort() + index * resolveBlockSize();

  return {
    fakeGateway: base + 1,
    api: base + 2,
    dashboard: base + 3,
    queueBroker: base + 4,
  };
};

export const DEFAULT_WORKER_PORT_BLOCK = getWorkerPortBlock(0);
