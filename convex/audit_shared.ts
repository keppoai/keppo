export const extractAuditActionId = (payload: Record<string, unknown>): string | undefined => {
  const actionId = payload.action_id;
  return typeof actionId === "string" && actionId.length > 0 ? actionId : undefined;
};

export const auditActionIdField = (payload: Record<string, unknown>): { action_id?: string } => {
  const actionId = extractAuditActionId(payload);
  return actionId ? { action_id: actionId } : {};
};
