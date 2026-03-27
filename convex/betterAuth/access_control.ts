import { createAccessControl } from "better-auth/plugins/access";
import type { Role } from "better-auth/plugins/access";

export const authAccessControlStatement = {
  workspace: ["create", "manage", "view"],
  action: ["approve", "reject", "view"],
  integration: ["manage", "view"],
} as const;

export const authAccessControl = createAccessControl(authAccessControlStatement);

export const authAccessControlRoles = {
  owner: authAccessControl.newRole({
    workspace: ["create", "manage", "view"],
    action: ["approve", "reject", "view"],
    integration: ["manage", "view"],
  }),
  admin: authAccessControl.newRole({
    workspace: ["create", "manage", "view"],
    action: ["approve", "reject", "view"],
    integration: ["manage", "view"],
  }),
  approver: authAccessControl.newRole({
    workspace: ["view"],
    action: ["approve", "reject", "view"],
    integration: ["view"],
  }),
  viewer: authAccessControl.newRole({
    workspace: ["view"],
    action: ["view"],
    integration: ["view"],
  }),
} satisfies Record<string, Role>;
