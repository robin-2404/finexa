import type { ReactNode } from "react";
import { Label } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlay";

export const ALL = "all";

/** A labelled select whose empty state is the sentinel "all" (Radix disallows empty item values). */
export function FilterSelect<T extends string>({
  id, label, value, onChange, options, className, disabledOptions,
}: {
  id: string;
  label: ReactNode;
  value: T | typeof ALL;
  onChange: (v: T | typeof ALL) => void;
  options: { value: T | typeof ALL; label: string }[];
  className?: string;
  disabledOptions?: Partial<Record<string, string>>;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 block text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T | typeof ALL)}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={!!disabledOptions?.[o.value]}>
              {o.label}{disabledOptions?.[o.value] ? ` (${disabledOptions[o.value]})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export const SPLIT_OPTIONS = [
  { value: "test", label: "Held-out test" },
  { value: "validation", label: "Held-out validation" },
  { value: "train", label: "Training reference" },
  { value: ALL, label: "All splits" },
] as const;

export const BAND_OPTIONS = [
  { value: ALL, label: "Any risk band" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

export const ACTION_OPTIONS = [
  { value: ALL, label: "Any action" },
  { value: "hold", label: "Hold (simulated)" },
  { value: "review", label: "Review" },
  { value: "allow", label: "Allow" },
] as const;

export const SPLIT_HELP: Record<string, string> = {
  test: "Held-out test: never used for training or threshold selection.",
  validation: "Held-out validation: used to choose the model and thresholds.",
  train: "Training reference: the model was fitted on these rows, so scores here look better than they would on new data.",
};
