import type { ProviderSdkCallLog, ProviderSdkCallRecord } from "./port.js";

export const createInMemoryProviderSdkCallLog = (): ProviderSdkCallLog => {
  const records: ProviderSdkCallRecord[] = [];

  return {
    capture(record) {
      records.push({
        ...record,
        ...(record.namespace ? { namespace: record.namespace } : {}),
      });
    },
    list(namespace) {
      if (!namespace) {
        return [...records];
      }
      return records.filter((record) => record.namespace === namespace);
    },
    reset(namespace) {
      if (!namespace) {
        records.length = 0;
        return;
      }
      let writeIndex = 0;
      for (let readIndex = 0; readIndex < records.length; readIndex += 1) {
        const record = records[readIndex];
        if (record && record.namespace !== namespace) {
          records[writeIndex] = record;
          writeIndex += 1;
        }
      }
      records.length = writeIndex;
    },
  };
};
