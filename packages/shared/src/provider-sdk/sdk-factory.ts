import type { ProviderSdkCallLog } from "./port.js";

type SdkFactoryOptions = {
  callLog?: ProviderSdkCallLog;
};

type FakeSdkFactoryOptions<TClientStore> = SdkFactoryOptions & {
  clientStore?: TClientStore;
};

const withOptionalCallLog = (options?: SdkFactoryOptions): SdkFactoryOptions => {
  return options?.callLog ? { callLog: options.callLog } : {};
};

export const createRealSdkFactory = <TSdk>(
  build: (options: SdkFactoryOptions) => TSdk,
): ((options?: SdkFactoryOptions) => TSdk) => {
  return (options?: SdkFactoryOptions): TSdk => {
    return build(withOptionalCallLog(options));
  };
};

export const createFakeSdkFactory = <TSdk, TClientStore>(params: {
  createClientStore: () => TClientStore;
  build: (clientStore: TClientStore, options: SdkFactoryOptions) => TSdk;
}): ((options?: FakeSdkFactoryOptions<TClientStore>) => TSdk) => {
  return (options?: FakeSdkFactoryOptions<TClientStore>): TSdk => {
    const clientStore = options?.clientStore ?? params.createClientStore();
    return params.build(clientStore, withOptionalCallLog(options));
  };
};
