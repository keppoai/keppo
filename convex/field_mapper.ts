export const pickFields = <T extends Record<string, unknown>, const K extends readonly (keyof T)[]>(
  row: T,
  keys: K,
): Pick<T, K[number]> => {
  const entries = keys.map((key) => [key, row[key]] as const);
  return Object.fromEntries(entries) as Pick<T, K[number]>;
};
