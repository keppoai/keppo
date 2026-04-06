const normalizeEnvironment = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? "";

export const getKeppoEnvironment = (): string =>
  normalizeEnvironment(process.env.KEPPO_ENVIRONMENT);

export const isHostedPreviewEnvironment = (): boolean => getKeppoEnvironment() === "preview";
