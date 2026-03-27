import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { fullTimestamp, pretty } from "@/lib/format";
import { parseConfigVersions, type AutomationConfigVersion } from "@/lib/automations-view-model";
import { ConfigDiff } from "@/components/automations/config-diff";

type VersionHistoryProps = {
  automationId: string;
  currentConfigVersionId: string | null;
  onVersionChange: () => void;
};

const parseVersionNumber = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function VersionHistory({
  automationId,
  currentConfigVersionId,
  onVersionChange,
}: VersionHistoryProps) {
  const [selectedViewVersion, setSelectedViewVersion] = useState<number | null>(null);
  const [compareLeft, setCompareLeft] = useState<number | null>(null);
  const [compareRight, setCompareRight] = useState<number | null>(null);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const versionsRaw = useQuery(
    makeFunctionReference<"query">("automations:listConfigVersions"),
    automationId ? { automation_id: automationId } : "skip",
  );
  const rollbackMutation = useMutation(
    makeFunctionReference<"mutation">("automations:rollbackAutomationConfig"),
  );

  const versions = useMemo(() => parseConfigVersions(versionsRaw), [versionsRaw]);
  const selectedVersion = useMemo(() => {
    if (selectedViewVersion === null) {
      return versions[0] ?? null;
    }
    return versions.find((item) => item.version_number === selectedViewVersion) ?? null;
  }, [selectedViewVersion, versions]);

  const leftVersion = useMemo(() => {
    if (compareLeft === null) {
      return null;
    }
    return versions.find((item) => item.version_number === compareLeft) ?? null;
  }, [compareLeft, versions]);

  const rightVersion = useMemo(() => {
    if (compareRight === null) {
      return null;
    }
    return versions.find((item) => item.version_number === compareRight) ?? null;
  }, [compareRight, versions]);

  const handleRollback = async (version: AutomationConfigVersion) => {
    setBusyVersionId(version.id);
    setError(null);
    try {
      await rollbackMutation({ automation_id: automationId, config_version_id: version.id });
      onVersionChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rollback failed.");
    } finally {
      setBusyVersionId(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {versions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No versions found.</p>
          ) : (
            versions.map((version) => {
              const isCurrent = version.id === currentConfigVersionId;
              const isBusy = busyVersionId === version.id;
              return (
                <div key={version.id} className="rounded-md border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant={isCurrent ? "default" : "outline"}>
                      v{version.version_number}
                    </Badge>
                    {isCurrent ? <Badge variant="secondary">current</Badge> : null}
                    <span className="text-muted-foreground text-xs">
                      {fullTimestamp(version.created_at)}
                    </span>
                  </div>

                  <p className="text-sm">
                    {version.change_summary?.trim() || "No change summary provided."}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedViewVersion(version.version_number);
                      }}
                    >
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCompareLeft(version.version_number);
                      }}
                    >
                      Compare Left
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCompareRight(version.version_number);
                      }}
                    >
                      Compare Right
                    </Button>
                    {!isCurrent ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          void handleRollback(version);
                        }}
                        disabled={isBusy}
                      >
                        {isBusy ? "Rolling back..." : "Rollback"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Version Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <LabelledSelect
              label="View version"
              value={selectedViewVersion?.toString() ?? ""}
              options={versions.map((version) => ({
                value: version.version_number.toString(),
                label: `v${version.version_number}`,
              }))}
              onChange={(nextValue) => {
                setSelectedViewVersion(nextValue ? parseVersionNumber(nextValue) : null);
              }}
            />

            <pre className="bg-muted max-h-[320px] overflow-auto rounded p-3 text-xs whitespace-pre-wrap">
              {selectedVersion ? pretty(selectedVersion) : "Select a version"}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Compare Versions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            <LabelledSelect
              label="Left"
              value={compareLeft?.toString() ?? ""}
              options={versions.map((version) => ({
                value: version.version_number.toString(),
                label: `v${version.version_number}`,
              }))}
              onChange={(nextValue) => {
                setCompareLeft(nextValue ? parseVersionNumber(nextValue) : null);
              }}
            />
            <LabelledSelect
              label="Right"
              value={compareRight?.toString() ?? ""}
              options={versions.map((version) => ({
                value: version.version_number.toString(),
                label: `v${version.version_number}`,
              }))}
              onChange={(nextValue) => {
                setCompareRight(nextValue ? parseVersionNumber(nextValue) : null);
              }}
            />
          </CardContent>
        </Card>

        <ConfigDiff current={leftVersion} compareTo={rightVersion} />

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LabelledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span>{label}</span>
      <NativeSelect value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        <option value="">Select version</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
