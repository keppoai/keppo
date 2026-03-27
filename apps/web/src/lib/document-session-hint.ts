export const hasDocumentSessionHint = (): boolean => {
  if (typeof document === "undefined") {
    return false;
  }

  return document.documentElement.hasAttribute("data-has-session");
};

export const clearDocumentSessionHint = (): void => {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.removeAttribute("data-has-session");
};
