const MIN_TOKEN_LENGTH = 32;
const MIN_UNIQUE_CHARS = 8;

export const isKeppoToken = (token: string): boolean => {
  return token.startsWith("keppo_") && token.length > "keppo_".length;
};

export const validateTokenEntropy = (token: string): boolean => {
  if (token.length < MIN_TOKEN_LENGTH) {
    return false;
  }

  const uniqueChars = new Set(token);
  if (uniqueChars.size < MIN_UNIQUE_CHARS) {
    return false;
  }

  const classes = {
    lower: /[a-z]/.test(token),
    upper: /[A-Z]/.test(token),
    digit: /[0-9]/.test(token),
    symbol: /[^A-Za-z0-9]/.test(token),
  };

  const classCount = Object.values(classes).filter(Boolean).length;
  return classCount >= 2;
};
