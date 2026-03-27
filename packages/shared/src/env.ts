const TRUE_BOOLEAN_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_BOOLEAN_ENV_VALUES = new Set(["0", "false", "no", "off"]);

export const parseEnvBoolean = (value: string | undefined): boolean | null => {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUE_BOOLEAN_ENV_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_BOOLEAN_ENV_VALUES.has(normalized)) {
    return false;
  }
  return null;
};

export const readEnvBoolean = (value: string | undefined, defaultValue = false): boolean => {
  const parsed = parseEnvBoolean(value);
  return parsed ?? defaultValue;
};
