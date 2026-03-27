export type HelperUiState =
  | "starting"
  | "waiting"
  | "captured"
  | "submitting"
  | "connected"
  | "error";

export const formatUiStateLabel = (state: HelperUiState): string => {
  switch (state) {
    case "starting":
      return "Starting";
    case "waiting":
      return "Waiting for ChatGPT sign-in";
    case "captured":
      return "Captured callback";
    case "submitting":
      return "Connecting to Keppo";
    case "connected":
      return "Connected";
    case "error":
      return "Error";
  }
};
