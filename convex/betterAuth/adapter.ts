import { createApi } from "@convex-dev/better-auth";
import { createAuthOptions } from "./auth";
import schema from "./schema";

export const adapter = createApi(schema, createAuthOptions);

export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } = adapter;
