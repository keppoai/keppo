import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EvaluationOrderCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evaluation Order</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          CEL deny rules → CEL approve rules → tool auto-approve → policy agent → manual approval
        </p>
      </CardContent>
    </Card>
  );
}
