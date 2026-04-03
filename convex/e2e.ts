import {
  countNamespaceRecords as countNamespaceRecordsImpl,
  listPendingActionsByNamespace as listPendingActionsByNamespaceImpl,
  reset as resetImpl,
  resetNamespace as resetNamespaceImpl,
} from "./e2e_reset.js";
import {
  createWorkspace as createWorkspaceImpl,
  createWorkspaceForOrgWithLimitCheck as createWorkspaceForOrgWithLimitCheckImpl,
  setOrgFeatureAccess as setOrgFeatureAccessImpl,
  setOrgSuspended as setOrgSuspendedImpl,
  setToolAutoApproval as setToolAutoApprovalImpl,
  setUsageMeterForOrg as setUsageMeterForOrgImpl,
} from "./e2e_workspaces.js";
import {
  createAutomationForWorkspace as createAutomationForWorkspaceImpl,
  createAutomationViaContract as createAutomationViaContractImpl,
  deleteAutomationFixture as deleteAutomationFixtureImpl,
  getAutomationCascadeFixtureState as getAutomationCascadeFixtureStateImpl,
  getAutomationFixturePublicViews as getAutomationFixturePublicViewsImpl,
  getAutomationFixtureRun as getAutomationFixtureRunImpl,
  getAutomationFixtureRunLogs as getAutomationFixtureRunLogsImpl,
  getAutomationFixtureState as getAutomationFixtureStateImpl,
  listAutomationFixtureRuns as listAutomationFixtureRunsImpl,
  listAutomationFixtureTriggerEvents as listAutomationFixtureTriggerEventsImpl,
  rollbackAutomationFixtureConfig as rollbackAutomationFixtureConfigImpl,
  seedAutomationCascadeFixture as seedAutomationCascadeFixtureImpl,
  seedAutomationFixture as seedAutomationFixtureImpl,
  updateAutomationFixtureConfig as updateAutomationFixtureConfigImpl,
} from "./e2e_automations.js";
import {
  createInviteCodeForTesting as createInviteCodeForTestingImpl,
  getInviteToken as getInviteTokenImpl,
  getLatestInviteTokenForEmail as getLatestInviteTokenForEmailImpl,
  seedInvitePromoForOrg as seedInvitePromoForOrgImpl,
  storeInviteToken as storeInviteTokenImpl,
} from "./e2e_invites.js";
import {
  approveAction as approveActionImpl,
  backdateActionForMaintenance as backdateActionForMaintenanceImpl,
  backdateRunActivityForAction as backdateRunActivityForActionImpl,
  createGroupedPendingActions as createGroupedPendingActionsImpl,
  createCelRule as createCelRuleImpl,
  getAction as getActionImpl,
  listAuditEvents as listAuditEventsImpl,
  listPendingActions as listPendingActionsImpl,
  rejectAction as rejectActionImpl,
  triggerWriteAction as triggerWriteActionImpl,
} from "./e2e_actions.js";
import { getRaceConditionState as getRaceConditionStateImpl } from "./e2e_reliability.js";

// Convex local dev reliably registers helpers from this umbrella module when
// they are rebound as local exports instead of bare re-exports.
export const approveAction = approveActionImpl;
export const backdateActionForMaintenance = backdateActionForMaintenanceImpl;
export const backdateRunActivityForAction = backdateRunActivityForActionImpl;
export const countNamespaceRecords = countNamespaceRecordsImpl;
export const createAutomationForWorkspace = createAutomationForWorkspaceImpl;
export const createAutomationViaContract = createAutomationViaContractImpl;
export const createCelRule = createCelRuleImpl;
export const createGroupedPendingActions = createGroupedPendingActionsImpl;
export const createInviteCodeForTesting = createInviteCodeForTestingImpl;
export const createWorkspace = createWorkspaceImpl;
export const createWorkspaceForOrgWithLimitCheck = createWorkspaceForOrgWithLimitCheckImpl;
export const deleteAutomationFixture = deleteAutomationFixtureImpl;
export const getAction = getActionImpl;
export const getAutomationCascadeFixtureState = getAutomationCascadeFixtureStateImpl;
export const getAutomationFixturePublicViews = getAutomationFixturePublicViewsImpl;
export const getAutomationFixtureRun = getAutomationFixtureRunImpl;
export const getAutomationFixtureRunLogs = getAutomationFixtureRunLogsImpl;
export const getAutomationFixtureState = getAutomationFixtureStateImpl;
export const getInviteToken = getInviteTokenImpl;
export const getLatestInviteTokenForEmail = getLatestInviteTokenForEmailImpl;
export const getRaceConditionState = getRaceConditionStateImpl;
export const listAuditEvents = listAuditEventsImpl;
export const listAutomationFixtureRuns = listAutomationFixtureRunsImpl;
export const listAutomationFixtureTriggerEvents = listAutomationFixtureTriggerEventsImpl;
export const listPendingActions = listPendingActionsImpl;
export const listPendingActionsByNamespace = listPendingActionsByNamespaceImpl;
export const rejectAction = rejectActionImpl;
export const reset = resetImpl;
export const resetNamespace = resetNamespaceImpl;
export const rollbackAutomationFixtureConfig = rollbackAutomationFixtureConfigImpl;
export const seedAutomationCascadeFixture = seedAutomationCascadeFixtureImpl;
export const seedAutomationFixture = seedAutomationFixtureImpl;
export const seedInvitePromoForOrg = seedInvitePromoForOrgImpl;
export const setOrgFeatureAccess = setOrgFeatureAccessImpl;
export const setOrgSuspended = setOrgSuspendedImpl;
export const setToolAutoApproval = setToolAutoApprovalImpl;
export const setUsageMeterForOrg = setUsageMeterForOrgImpl;
export const storeInviteToken = storeInviteTokenImpl;
export const triggerWriteAction = triggerWriteActionImpl;
export const updateAutomationFixtureConfig = updateAutomationFixtureConfigImpl;
