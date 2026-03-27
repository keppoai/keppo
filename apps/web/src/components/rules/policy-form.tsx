import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const policySchema = z.object({
  text: z.string().trim().min(1, "Policy text is required."),
});

type PolicyValues = z.infer<typeof policySchema>;

interface PolicyFormProps {
  onSubmit: (values: PolicyValues) => Promise<void>;
}

export function PolicyForm({ onSubmit }: PolicyFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PolicyValues>({
    resolver: zodResolver(policySchema),
    defaultValues: { text: "" },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Policy</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit(async (values) => {
            await onSubmit(values);
            reset();
          })}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="policy-text">Policy Text</Label>
            <Textarea
              id="policy-text"
              placeholder="Describe the policy in plain text..."
              className="min-h-24"
              {...register("text")}
            />
            {errors.text ? <p className="text-xs text-destructive">{errors.text.message}</p> : null}
          </div>

          <Button type="submit" className="w-fit" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Policy"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
