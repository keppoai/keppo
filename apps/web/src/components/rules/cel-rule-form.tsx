import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { parseRuleTestContext, readRuleErrorMessage } from "@/lib/rules-view-model";

interface CelRuleFormProps {
  onCreate: (input: {
    name: string;
    description: string;
    expression: string;
    effect: "approve" | "deny";
  }) => Promise<void>;
  onTest: (expression: string, context: Record<string, unknown>) => Promise<boolean>;
}

const DEFAULT_TEST_CONTEXT =
  '{"tool":{"name":"stripe.issueRefund"},"action":{"preview":{"amount":25}}}';

const celRuleSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  description: z.string().trim(),
  expression: z.string().trim().min(1, "Expression is required."),
  test_context: z.string().trim().min(1, "Test context is required."),
  effect: z.enum(["approve", "deny"]),
});

type CelRuleValues = z.infer<typeof celRuleSchema>;

export function CelRuleForm({ onCreate, onTest }: CelRuleFormProps) {
  const validationRunIdRef = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [validationStatus, setValidationStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const {
    register,
    handleSubmit,
    reset,
    watch,
    getValues,
    formState: { errors },
  } = useForm<CelRuleValues>({
    resolver: zodResolver(celRuleSchema),
    defaultValues: {
      name: "",
      description: "",
      expression: "",
      test_context: DEFAULT_TEST_CONTEXT,
      effect: "deny",
    },
  });
  const expressionDraft = watch("expression");

  const validationContext: Record<string, unknown> = {
    tool: { name: "gmail.sendEmail", capability: "write", risk_level: "high" },
    action: { type: "send_email", preview: { recipients: ["customer@example.com"] } },
    workspace: { name: "default", policy_mode: "manual_only" },
    now: new Date().toISOString(),
  };

  useEffect(() => {
    const runId = ++validationRunIdRef.current;
    const expression = expressionDraft.trim();
    if (!expression) {
      setValidationStatus("idle");
      return;
    }
    const timeout = window.setTimeout(() => {
      void onTest(expression, validationContext)
        .then(() => {
          if (validationRunIdRef.current !== runId) {
            return;
          }
          setValidationStatus("valid");
        })
        .catch(() => {
          if (validationRunIdRef.current !== runId) {
            return;
          }
          setValidationStatus("invalid");
        });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [expressionDraft, onTest]);

  const handleCreate = handleSubmit(async (values) => {
    setError(null);
    setTestResult(null);
    setIsSubmitting(true);

    try {
      await onTest(values.expression, validationContext);
      await onCreate({
        name: values.name,
        description: values.description,
        expression: values.expression,
        effect: values.effect,
      });
      reset();
      setTestResult("Rule created");
    } catch (value) {
      setError(readRuleErrorMessage(value));
    } finally {
      setIsSubmitting(false);
    }
  });

  const handleTest = async () => {
    setError(null);
    setTestResult(null);
    setIsTesting(true);
    const values = getValues();
    const expression = values.expression.trim();
    if (!expression) {
      setError("Expression is required");
      setIsTesting(false);
      return;
    }

    const parsedContext = parseRuleTestContext(values.test_context);
    if (!parsedContext.ok) {
      setError(parsedContext.message);
      setIsTesting(false);
      return;
    }

    try {
      const result = await onTest(expression, parsedContext.value);
      setTestResult(
        result ? "Expression matched test context" : "Expression did not match test context",
      );
    } catch (value) {
      setError(readRuleErrorMessage(value));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add CEL Rule</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={handleCreate} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cel-name">Name</Label>
            <Input id="cel-name" placeholder="Rule name" {...register("name")} />
            {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cel-description">Description</Label>
            <Input
              id="cel-description"
              placeholder="Optional description"
              {...register("description")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cel-expression">Expression</Label>
            <Textarea
              id="cel-expression"
              placeholder='tool.name == "stripe.issueRefund" && action.preview.amount > 20'
              className="min-h-24 font-mono text-sm"
              {...register("expression")}
            />
            {errors.expression ? (
              <p className="text-xs text-destructive">{errors.expression.message}</p>
            ) : null}
            <div className="rounded-md border bg-muted p-2 text-xs">
              <span className="text-muted-foreground">Syntax preview: </span>
              <code className="font-mono text-foreground">
                {expressionDraft || 'tool.name == "stripe.issueRefund"'}
              </code>
            </div>
            <p className="text-xs text-muted-foreground">
              Inline validation:{" "}
              {validationStatus === "idle"
                ? "enter an expression"
                : validationStatus === "valid"
                  ? "valid"
                  : "invalid"}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cel-test-context">Test Context (JSON)</Label>
            <Textarea
              id="cel-test-context"
              className="min-h-24 font-mono text-xs"
              {...register("test_context")}
            />
            {errors.test_context ? (
              <p className="text-xs text-destructive">{errors.test_context.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cel-effect">Effect</Label>
            <NativeSelect id="cel-effect" {...register("effect")}>
              <option value="deny">Deny</option>
              <option value="approve">Approve</option>
            </NativeSelect>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void handleTest();
              }}
              disabled={isTesting}
            >
              {isTesting ? "Testing..." : "Test Expression"}
            </Button>
            <Button type="submit" className="w-fit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Rule"}
            </Button>
          </div>

          {(error || testResult) && (
            <p
              role="alert"
              className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
            >
              {error ?? testResult}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
