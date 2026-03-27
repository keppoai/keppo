import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);

export const unikraftClientConfigSchema = z
  .object({
    token: nonEmptyStringSchema,
    metro: nonEmptyStringSchema,
  })
  .strict();

export const unikraftInstanceSchema = z
  .object({
    uuid: nonEmptyStringSchema,
    name: nonEmptyStringSchema.optional(),
    state: nonEmptyStringSchema.optional(),
    image: nonEmptyStringSchema.optional(),
    created_at: nonEmptyStringSchema.optional(),
    started_at: nonEmptyStringSchema.optional(),
    stopped_at: nonEmptyStringSchema.optional(),
    memory_mb: z.number().int().positive().optional(),
    vcpus: z.number().int().positive().optional(),
    env: z.record(z.string(), z.string()).optional(),
    args: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    private_fqdn: nonEmptyStringSchema.optional(),
  })
  .passthrough();

export const unikraftLogEntrySchema = z
  .object({
    message: z.string().optional(),
    content: z.string().optional(),
    line: z.string().optional(),
    timestamp: z.string().optional(),
    stream: z.string().optional(),
  })
  .passthrough();

export const unikraftInstanceLogSchema = z
  .object({
    output: z.string().optional(),
    offset: z.number().int().optional(),
    next_offset: z.number().int().optional(),
    lines: z.array(z.union([z.string(), unikraftLogEntrySchema])).optional(),
    entries: z.array(z.union([z.string(), unikraftLogEntrySchema])).optional(),
  })
  .passthrough();

export const unikraftCreateInstanceParamsSchema = z
  .object({
    name: nonEmptyStringSchema.optional(),
    image: nonEmptyStringSchema,
    memory_mb: z.number().int().positive().optional(),
    vcpus: z.number().int().positive().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    autostart: z.boolean().optional(),
    restart_policy: z.enum(["never", "always", "on_failure"]).optional(),
    features: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    timeout_s: z.number().int().min(0).optional(),
  })
  .strict();

export const unikraftApiResponseStatusSchema = z.enum(["success", "error"]);

export const unikraftApiErrorSchema = z
  .object({
    code: z.string().optional(),
    detail: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export const createUnikraftApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z
    .object({
      status: unikraftApiResponseStatusSchema,
      message: z.string().optional(),
      data: dataSchema,
      errors: z.array(unikraftApiErrorSchema).optional(),
    })
    .passthrough();

export const unikraftInstanceEnvelopeSchema = z
  .object({
    instance: unikraftInstanceSchema.optional(),
    instances: z.array(unikraftInstanceSchema).optional(),
  })
  .passthrough();

export type UnikraftClientConfig = z.infer<typeof unikraftClientConfigSchema>;
export type UnikraftInstance = z.infer<typeof unikraftInstanceSchema>;
export type UnikraftCreateInstanceParams = z.infer<typeof unikraftCreateInstanceParamsSchema>;
export type UnikraftInstanceLog = z.infer<typeof unikraftInstanceLogSchema>;
export type UnikraftApiError = z.infer<typeof unikraftApiErrorSchema>;
export type UnikraftApiResponse<T> = {
  status: z.infer<typeof unikraftApiResponseStatusSchema>;
  message?: string;
  data: T;
  errors?: UnikraftApiError[];
};
