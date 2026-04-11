import { z } from "zod";
import type { ToolDefinition } from "../tool-definitions.js";

const sanitizeIdentifier = (value: string): string => {
  return value.replace(/[^a-zA-Z0-9_$]/g, "_");
};

const RESERVED_IDENTIFIERS = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const isSafeBindingIdentifier = (value: string): boolean => {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value) && !RESERVED_IDENTIFIERS.has(value);
};

const escapeBlockComment = (value: string): string => {
  return value.replace(/\*\//g, "*\\/");
};

const splitToolName = (toolName: string): { namespace: string; functionName: string } => {
  const [namespaceRaw, functionRaw] = toolName.split(".", 2);
  return {
    namespace: sanitizeIdentifier(namespaceRaw ?? "unknown"),
    functionName: sanitizeIdentifier(functionRaw ?? "call"),
  };
};

const unwrapSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return unwrapSchema((schema as unknown as { unwrap: () => z.ZodTypeAny }).unwrap());
  }
  return schema;
};

const schemaType = (schema: z.ZodTypeAny): string => {
  const unwrapped = unwrapSchema(schema);
  if (unwrapped instanceof z.ZodString) {
    return "string";
  }
  if (unwrapped instanceof z.ZodNumber) {
    return "number";
  }
  if (unwrapped instanceof z.ZodBoolean) {
    return "boolean";
  }
  if (unwrapped instanceof z.ZodArray) {
    return `${schemaType(unwrapped.element as unknown as z.ZodTypeAny)}[]`;
  }
  if (unwrapped instanceof z.ZodObject) {
    return "object";
  }
  if (unwrapped instanceof z.ZodEnum) {
    return "string";
  }
  if (unwrapped instanceof z.ZodLiteral) {
    return JSON.stringify(unwrapped.value);
  }
  return "unknown";
};

const isOptionalSchema = (schema: z.ZodTypeAny): boolean => {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault;
};

const extractObjectShape = (schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> => {
  const unwrapped = unwrapSchema(schema);
  if (!(unwrapped instanceof z.ZodObject)) {
    return {};
  }
  const shape = (unwrapped as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
  return shape ?? {};
};

const formatParamDoc = (schema: z.ZodTypeAny): string[] => {
  const shape = extractObjectShape(schema);
  const docs: string[] = [];
  for (const [name, field] of Object.entries(shape)) {
    const optional = isOptionalSchema(field) ? " (optional)" : "";
    docs.push(` * @param args.${name} ${schemaType(field)}${optional}`);
  }
  return docs;
};

const jsonSchemaFor = (schema: z.ZodTypeAny): Record<string, unknown> => {
  const unwrapped = unwrapSchema(schema);

  if (unwrapped instanceof z.ZodString) {
    return { type: "string" };
  }
  if (unwrapped instanceof z.ZodNumber) {
    return { type: "number" };
  }
  if (unwrapped instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (unwrapped instanceof z.ZodLiteral) {
    return { const: unwrapped.value };
  }
  if (unwrapped instanceof z.ZodEnum) {
    return { type: "string", enum: [...unwrapped.options] };
  }
  if (unwrapped instanceof z.ZodArray) {
    return {
      type: "array",
      items: jsonSchemaFor(unwrapped.element as unknown as z.ZodTypeAny),
    };
  }
  if (unwrapped instanceof z.ZodObject) {
    const shape = (unwrapped as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [name, field] of Object.entries(shape ?? {})) {
      properties[name] = jsonSchemaFor(field);
      if (!isOptionalSchema(field)) {
        required.push(name);
      }
    }
    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    };
  }
  return {};
};

export const zodToJsonSchema = (schema: z.ZodTypeAny): Record<string, unknown> => {
  return jsonSchemaFor(schema);
};

export const generateToolTypeStubs = (tools: ToolDefinition[]): string => {
  const lines: string[] = [];
  for (const tool of tools) {
    if (tool.provider === "keppo") {
      continue;
    }
    const shape = extractObjectShape(tool.input_schema);
    const params = Object.keys(shape);
    lines.push(`- ${tool.name}(${params.join(", ")}): ${tool.description}`);
  }
  return lines.join("\n");
};

type CodeModeSdkTarget = "default" | "jslite";

const generateDefaultCodeModeSDK = (tools: ToolDefinition[]): string => {
  const providers = new Map<string, string[]>();

  for (const tool of tools) {
    if (tool.provider === "keppo") {
      continue;
    }
    const { namespace, functionName } = splitToolName(tool.name);
    const docs = formatParamDoc(tool.input_schema);
    const functionLines = [
      "  /**",
      ` * ${escapeBlockComment(tool.description)}`,
      ...docs,
      "   */",
      `  async ${functionName}(args = {}) {`,
      `    return __keppo_call_tool(${JSON.stringify(tool.name)}, args);`,
      "  },",
    ];
    const existing = providers.get(namespace) ?? [];
    existing.push(functionLines.join("\n"));
    providers.set(namespace, existing);
  }

  const namespaceBlocks = [...providers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, functions]) => {
      return [
        `globalThis[${JSON.stringify(namespace)}] = Object.freeze({`,
        functions.sort().join("\n"),
        "});",
      ].join("\n");
    });

  return [
    '"use strict";',
    "",
    'if (typeof __keppo_call_tool !== "function") {',
    '  throw new Error("Missing __keppo_call_tool runtime bridge.");',
    "}",
    "",
    "globalThis.search_tools = async function search_tools(query, options = {}) {",
    '  if (typeof __keppo_search_tools !== "function") {',
    '    throw new Error("Missing __keppo_search_tools runtime bridge.");',
    "  }",
    "  return __keppo_search_tools(query, options);",
    "};",
    "",
    ...namespaceBlocks,
  ].join("\n");
};

const generateJsliteCodeModeSDK = (tools: ToolDefinition[]): string => {
  const providers = new Map<string, string[]>();

  for (const tool of tools) {
    if (tool.provider === "keppo") {
      continue;
    }
    const { namespace, functionName } = splitToolName(tool.name);
    const docs = formatParamDoc(tool.input_schema);
    const functionLines = [
      "  /**",
      ` * ${escapeBlockComment(tool.description)}`,
      ...docs,
      "   */",
      `  [${JSON.stringify(functionName)}]: async function (args) {`,
      `    return __keppo_execute_tool(${JSON.stringify(tool.name)}, args);`,
      "  },",
    ];
    const existing = providers.get(namespace) ?? [];
    existing.push(functionLines.join("\n"));
    providers.set(namespace, existing);
  }

  const namespaceBlocks = [...providers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, functions]) => {
      const lines = [
        `globalThis[${JSON.stringify(namespace)}] = {`,
        functions.sort().join("\n"),
        "};",
      ];
      if (isSafeBindingIdentifier(namespace)) {
        lines.push(`const ${namespace} = globalThis[${JSON.stringify(namespace)}];`);
      }
      return lines.join("\n");
    });

  return [
    '"use strict";',
    "",
    'if (typeof __keppo_execute_tool !== "function") {',
    '  throw new Error("Missing __keppo_execute_tool runtime bridge.");',
    "}",
    'if (typeof __keppo_execute_search_tools !== "function") {',
    '  throw new Error("Missing __keppo_execute_search_tools runtime bridge.");',
    "}",
    "",
    "async function search_tools(query, options) {",
    "  return __keppo_execute_search_tools(query, options);",
    "}",
    "",
    ...namespaceBlocks,
  ].join("\n");
};

export const generateCodeModeSDK = (
  tools: ToolDefinition[],
  options: { target?: CodeModeSdkTarget } = {},
): string => {
  return options.target === "jslite"
    ? generateJsliteCodeModeSDK(tools)
    : generateDefaultCodeModeSDK(tools);
};

export const generateCodeModeDeclarations = (tools: ToolDefinition[]): string => {
  const providerMethods = new Map<string, string[]>();

  for (const tool of tools) {
    if (tool.provider === "keppo") {
      continue;
    }
    const { namespace, functionName } = splitToolName(tool.name);
    const shape = extractObjectShape(tool.input_schema);
    const params = Object.entries(shape)
      .map(([name, field]) => `${name}${isOptionalSchema(field) ? "?" : ""}: ${schemaType(field)}`)
      .join("; ");
    const line = `  function ${functionName}(args: { ${params} }): Promise<unknown>;`;
    const existing = providerMethods.get(namespace) ?? [];
    existing.push(line);
    providerMethods.set(namespace, existing);
  }

  const namespaces = [...providerMethods.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, methods]) => {
      return [`declare namespace ${namespace} {`, ...methods.sort(), "}"];
    })
    .flat();

  return [
    "declare function search_tools(",
    "  query: string,",
    "  options?: { provider?: string; capability?: string; limit?: number },",
    "): Promise<unknown>;",
    "",
    ...namespaces,
    "",
    "export {};",
  ].join("\n");
};
