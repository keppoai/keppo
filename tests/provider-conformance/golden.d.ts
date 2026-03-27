import type {
  ConformanceOutputValueType,
  ProviderActionGoldenErrorExpectation,
  ProviderActionGoldenResultExpectation,
  ProviderConformanceErrorKind,
} from "./action-matrix";
export type NormalizedConformanceResult = {
  status: string;
  hasActionId: boolean;
  outputShape: Record<string, ConformanceOutputValueType>;
};
export type NormalizedConformanceError = {
  kind: ProviderConformanceErrorKind;
  message: string;
};
export declare const normalizeConformanceResult: (
  payload: Record<string, unknown>,
) => NormalizedConformanceResult;
export declare const normalizeConformanceError: (error: unknown) => NormalizedConformanceError;
export declare const assertGoldenResult: (
  scope: string,
  actual: NormalizedConformanceResult,
  expected: ProviderActionGoldenResultExpectation,
) => void;
export declare const assertGoldenError: (
  scope: string,
  actual: NormalizedConformanceError,
  expected: ProviderActionGoldenErrorExpectation,
) => void;
//# sourceMappingURL=golden.d.ts.map
