import type { ToolSearchResult } from "./tool-search-types.js";
import {
  generateCodeModeDeclarations,
  generateCodeModeSDK,
  generateToolTypeStubs,
  zodToJsonSchema,
} from "./sdk-generator.js";
import {
  createSandboxProvider,
  type SandboxExecutionFailure,
  type SandboxMode,
  type SandboxToolCall,
} from "./sandbox.js";
import { DockerSandbox } from "./sandbox-docker.js";
import { JsliteSandbox } from "./sandbox-jslite.js";
import { UnikraftSandbox } from "./sandbox-unikraft.js";
import { VercelSandbox } from "./sandbox-vercel.js";
import { extractToolReferences } from "./static-analyzer.js";
import {
  CodeModeGatingError,
  createGatedToolHandler,
  type GatingDecision,
} from "./gated-tool-handler.js";
import {
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPES,
  createCodeModeStructuredExecutionError,
  formatCodeModeStructuredExecutionError,
  parseCodeModeStructuredExecutionError,
  type CodeModeStructuredExecutionErrorPayload,
  type CodeModeStructuredExecutionErrorType,
} from "./structured-execution-error.js";
import { CODE_MODE_TOOLS } from "./mcp-tools.js";

export {
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPES,
  CODE_MODE_TOOLS,
  CodeModeGatingError,
  DockerSandbox,
  JsliteSandbox,
  UnikraftSandbox,
  VercelSandbox,
  createCodeModeStructuredExecutionError,
  createGatedToolHandler,
  createSandboxProvider,
  extractToolReferences,
  formatCodeModeStructuredExecutionError,
  generateCodeModeDeclarations,
  generateCodeModeSDK,
  generateToolTypeStubs,
  parseCodeModeStructuredExecutionError,
  zodToJsonSchema,
};

export type {
  CodeModeStructuredExecutionErrorPayload,
  CodeModeStructuredExecutionErrorType,
  GatingDecision,
  SandboxExecutionFailure,
  SandboxMode,
  SandboxToolCall,
  ToolSearchResult,
};
