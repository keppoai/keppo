import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { getActionStatusBadgeVariant, getRiskBadgeVariant } from "@/lib/action-badges";
import { pretty, fullTimestamp } from "@/lib/format";
import type { UserFacingError } from "@/lib/user-facing-errors";
import type { ActionDetailResponse } from "@/lib/types";

type ApprovalFeedback = {
  title: string;
  summary: string;
  actionLabel?: string;
  onAction?: () => void;
} | null;

type ApprovalGroupContext = {
  automation_run_id: string;
  automation_name: string | null;
  automation_run_started_at: string | null;
  visible_action_count: number;
  visible_pending_count: number;
};

const joinStringList = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return items.length > 0 ? items.join(", ") : null;
};

const getRecordValue = (source: unknown, key: string): unknown => {
  if (!source || typeof source !== "object") {
    return null;
  }
  return (source as Record<string, unknown>)[key];
};

const formatRunId = (runId: string): string => runId.replace(/^run_/, "").slice(0, 8);

const summarizePayloadPreview = (
  payloadPreview: unknown,
): Array<{ label: string; value: string }> => {
  const recipient =
    joinStringList(getRecordValue(payloadPreview, "to")) ??
    joinStringList(getRecordValue(payloadPreview, "recipient")) ??
    joinStringList(getRecordValue(payloadPreview, "recipients"));
  const subject =
    typeof getRecordValue(payloadPreview, "subject") === "string"
      ? String(getRecordValue(payloadPreview, "subject"))
      : null;
  const destination =
    typeof getRecordValue(payloadPreview, "path") === "string"
      ? String(getRecordValue(payloadPreview, "path"))
      : typeof getRecordValue(payloadPreview, "url") === "string"
        ? String(getRecordValue(payloadPreview, "url"))
        : null;
  const tool =
    typeof getRecordValue(payloadPreview, "tool_name") === "string"
      ? String(getRecordValue(payloadPreview, "tool_name"))
      : null;

  return [
    recipient ? { label: "Recipients", value: recipient } : null,
    subject ? { label: "Subject", value: subject } : null,
    destination ? { label: "Destination", value: destination } : null,
    tool ? { label: "Tool", value: tool } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
};

interface ApprovalDetailPanelProps {
  actionId: string | null;
  details: ActionDetailResponse | null;
  groupContext: ApprovalGroupContext | null;
  onApprove: (id: string) => Promise<void> | void;
  onRequestReject: (ids: string[]) => void;
  canApprove: boolean;
  feedback: ApprovalFeedback;
  error: UserFacingError | null;
  selectedActionVisible: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  testIdScope?: string;
}

export function ApprovalDetailPanel({
  actionId,
  details,
  groupContext,
  onApprove,
  onRequestReject,
  canApprove,
  feedback,
  error,
  selectedActionVisible,
  isApproving,
  isRejecting,
  testIdScope = "approval-detail",
}: ApprovalDetailPanelProps) {
  if (!actionId || !details) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Select an action from the table</p>
      </div>
    );
  }

  const action = details.action;
  const approvals = details.approvals ?? [];
  const celMatches = details.cel_rule_matches ?? [];
  const policyDecisions = details.policy_decisions ?? [];
  const timeline = details.timeline ?? [];

  const actionType = action.action_type ?? "Unknown";
  const riskLevel = action.risk_level ?? "low";
  const status = action.status ?? "pending";
  const createdAt = action.created_at;
  const payloadPreview = action.payload_preview ?? {};
  const payload = details.normalized_payload ?? payloadPreview;
  const output = action.result_redacted ?? {};
  const payloadSummary = summarizePayloadPreview(payloadPreview);
  const shortRunId = formatRunId(action.automation_run_id);
  const nextStep =
    status === "pending"
      ? riskLevel === "critical" || riskLevel === "high"
        ? "Review the redacted preview, then approve only if the destination and scope match the request."
        : "Confirm the payload still matches the operator's intent, then approve or reject from this panel."
      : status === "approved"
        ? "Action approval is complete. Use the execution output and timeline below to confirm the run finished as expected."
        : "Action was rejected. Check the approval history and timeline below before retrying from the originating workflow.";
  const timelineSummary =
    timeline.length > 0
      ? `${timeline.length} event${timeline.length === 1 ? "" : "s"} recorded`
      : "No timeline events yet";
  const approvalSummary =
    approvals.length > 0
      ? `${approvals.length} approval decision${approvals.length === 1 ? "" : "s"} recorded`
      : status === "pending"
        ? "Approval still needed"
        : "No approval decisions recorded";
  const reviewScopeLabel = groupContext
    ? groupContext.automation_name?.trim() || `Run ${formatRunId(groupContext.automation_run_id)}`
    : action.automation_name?.trim() || `Run ${shortRunId}`;
  const reviewScopeDescription = groupContext
    ? `${groupContext.visible_pending_count} pending of ${groupContext.visible_action_count} visible in this run`
    : "Single-action review";

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-6">
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold">{actionType}</h3>
                <Badge variant={getRiskBadgeVariant(riskLevel)}>{riskLevel}</Badge>
                <Badge variant={getActionStatusBadgeVariant(status)}>{status}</Badge>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Review the destination, scope, and intent first. Keep raw traces and execution data
                as secondary evidence while you decide.
              </p>
            </div>
            {canApprove ? (
              <div className="flex min-w-[240px] flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  data-testid="approval-detail-approve"
                  variant="default"
                  size="lg"
                  className="flex-1"
                  onClick={() => void Promise.resolve(onApprove(actionId))}
                  disabled={status !== "pending" || isApproving || isRejecting}
                >
                  {isApproving ? "Approving..." : "Approve"}
                </Button>
                <Button
                  data-testid="approval-detail-reject"
                  variant="destructive"
                  size="lg"
                  className="flex-1"
                  onClick={() => onRequestReject([actionId])}
                  disabled={status !== "pending" || isApproving || isRejecting}
                >
                  {isRejecting ? "Rejecting..." : "Reject"}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border bg-muted/15 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Selected for review
                </p>
                <p className="mt-2 text-base font-semibold">{reviewScopeLabel}</p>
                <p className="mt-1 text-sm text-muted-foreground">{reviewScopeDescription}</p>
              </div>
              <Badge variant={groupContext ? "warning" : "outline"}>
                {groupContext ? "Grouped run review" : "Single action"}
              </Badge>
            </div>
          </div>

          <div className="rounded-2xl border bg-background px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Decision summary</p>
                <p className="mt-1 text-sm text-muted-foreground">{nextStep}</p>
              </div>
              <Badge
                variant={status === "pending" ? "outline" : getActionStatusBadgeVariant(status)}
              >
                {status === "pending" ? "Ready for review" : status}
              </Badge>
            </div>
            {payloadSummary.length > 0 ? (
              <dl className="mt-4 grid gap-3 md:grid-cols-2">
                {payloadSummary.map((item) => (
                  <div key={item.label} className="rounded-xl bg-muted/20 px-3 py-3">
                    <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="mt-2 text-sm font-medium">{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>

          <div className="rounded-2xl border bg-background px-4 py-4">
            <p className="text-sm font-semibold">Review checklist</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl bg-muted/20 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Created</p>
                <p className="mt-2 text-sm font-medium">
                  {createdAt ? fullTimestamp(createdAt) : "Unknown"}
                </p>
              </div>
              <div className="rounded-xl bg-muted/20 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Timeline
                </p>
                <p className="mt-2 text-sm font-medium">{timelineSummary}</p>
              </div>
              <div className="rounded-xl bg-muted/20 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Review state
                </p>
                <p className="mt-2 text-sm font-medium">{approvalSummary}</p>
              </div>
              <div className="rounded-xl bg-muted/20 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Run</p>
                <p className="mt-2 text-sm font-medium">
                  {action.automation_name?.trim() || `Run ${shortRunId}`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {groupContext
                    ? `${groupContext.visible_pending_count} pending of ${groupContext.visible_action_count} visible`
                    : `Run ${shortRunId}`}
                </p>
              </div>
            </div>
          </div>
        </div>

        {!selectedActionVisible ? (
          <Alert variant="info" data-testid={`${testIdScope}-selection-preserved`}>
            <AlertTitle>Queue updated while you were reviewing</AlertTitle>
            <AlertDescription>
              This action moved out of the current filtered list, but Keppo is keeping the detail
              panel open so you can finish reviewing the timeline and result without losing context.
            </AlertDescription>
          </Alert>
        ) : null}

        {feedback ? (
          <Alert variant="info" data-testid={`${testIdScope}-feedback`}>
            <AlertTitle>{feedback.title}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{feedback.summary}</span>
              {feedback.actionLabel && feedback.onAction ? (
                <Button size="sm" variant="outline" onClick={feedback.onAction}>
                  {feedback.actionLabel}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? <UserFacingErrorView error={error} variant="compact" /> : null}

        {!canApprove ? (
          <p className="text-sm text-muted-foreground">
            Viewer role cannot approve or reject actions.
          </p>
        ) : null}

        <Separator />

        <Tabs defaultValue="summary" className="space-y-4">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="raw">Raw data</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="space-y-4">
            <div>
              <h4 className="mb-2 text-sm font-medium">Payload preview</h4>
              <pre className="overflow-auto rounded-md bg-muted p-4 text-xs">
                {pretty(payloadPreview)}
              </pre>
              <p className="mt-2 text-xs text-muted-foreground">
                Use the redacted preview to confirm the target, scope, and intent before approving.
              </p>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-medium">Execution output</h4>
              <pre className="overflow-auto rounded-md bg-muted p-4 text-xs">{pretty(output)}</pre>
              <p className="mt-2 text-xs text-muted-foreground">
                Result details appear here after execution completes or returns an error.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="raw" className="space-y-4">
            <div>
              <h4 className="mb-2 text-sm font-medium">Executable payload</h4>
              <pre className="overflow-auto rounded-md bg-muted p-4 text-xs">{pretty(payload)}</pre>
              {details.normalized_payload == null ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Executable payload was purged or is unavailable, so Keppo is showing the redacted
                  preview instead.
                </p>
              ) : null}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-medium">Metadata</h4>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">ID</dt>
                <dd className="font-mono text-xs">{actionId}</dd>
                <dt className="text-muted-foreground">Run</dt>
                <dd className="font-mono text-xs">{action.automation_run_id}</dd>
                {action.automation_name ? (
                  <>
                    <dt className="text-muted-foreground">Automation</dt>
                    <dd>{action.automation_name}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Idempotency</dt>
                <dd className="font-mono text-xs">{action.idempotency_key}</dd>
                {action.automation_run_started_at ? (
                  <>
                    <dt className="text-muted-foreground">Run started</dt>
                    <dd>{fullTimestamp(action.automation_run_started_at)}</dd>
                  </>
                ) : null}
                {createdAt ? (
                  <>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{fullTimestamp(createdAt)}</dd>
                  </>
                ) : null}
                {action.resolved_at ? (
                  <>
                    <dt className="text-muted-foreground">Resolved</dt>
                    <dd>{fullTimestamp(action.resolved_at)}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex flex-col gap-2">
          <div>
            <h4 className="text-sm font-medium">Evidence and history</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              Expand the rule trace, approval history, or execution timeline only when you need
              deeper evidence.
            </p>
          </div>
          <Accordion defaultValue={["approvals"]} multiple className="rounded-2xl border px-4">
            {celMatches.length > 0 ? (
              <AccordionItem value="cel">
                <AccordionTrigger>CEL rule matches</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 text-sm">
                    {celMatches.map((match) => (
                      <div key={match.id} className="rounded-xl bg-muted/20 p-3">
                        <Badge variant={match.effect === "deny" ? "destructive" : "secondary"}>
                          {match.effect}
                        </Badge>
                        <div className="mt-2 font-mono text-xs">{match.expression_snapshot}</div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ) : null}
            {policyDecisions.length > 0 ? (
              <AccordionItem value="policy">
                <AccordionTrigger>Policy decisions</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 text-sm">
                    {policyDecisions.map((decision) => (
                      <div key={decision.id} className="rounded-xl bg-muted/20 p-3">
                        <Badge variant={decision.result === "deny" ? "destructive" : "secondary"}>
                          {decision.result}
                        </Badge>
                        <div className="mt-2">{decision.explanation}</div>
                        {decision.policies_evaluated?.length ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            policies: {decision.policies_evaluated.join(" | ")}
                          </div>
                        ) : null}
                        <div className="text-xs text-muted-foreground">
                          confidence: {decision.confidence}
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ) : null}
            <AccordionItem value="approvals">
              <AccordionTrigger>Approval history</AccordionTrigger>
              <AccordionContent>
                {approvals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No approvals recorded.</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    {approvals.map((entry) => (
                      <div key={entry.id} className="rounded-xl bg-muted/20 p-3">
                        <Badge variant={entry.decision === "reject" ? "destructive" : "secondary"}>
                          {entry.decider_type}:{entry.decision}
                        </Badge>
                        {entry.reason ? <div className="mt-2">{entry.reason}</div> : null}
                        <div className="text-xs text-muted-foreground">
                          {fullTimestamp(entry.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="timeline">
              <AccordionTrigger>Execution timeline</AccordionTrigger>
              <AccordionContent>
                {timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No timeline events recorded.</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    {timeline.map((event) => (
                      <div key={event.id} className="rounded-xl bg-muted/20 p-3">
                        <Badge variant="outline">{event.event_type}</Badge>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {fullTimestamp(event.created_at)}
                        </div>
                        <div className="mt-2 font-mono text-xs">{pretty(event.payload ?? {})}</div>
                      </div>
                    ))}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </ScrollArea>
  );
}
