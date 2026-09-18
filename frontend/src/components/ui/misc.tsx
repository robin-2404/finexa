import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* ---- Badge ---- */
const badgeVariants = cva("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "border-border bg-muted text-foreground/80",
      teal: "border-primary/20 bg-primary-soft text-primary-ink",
      red: "border-danger/20 bg-danger-soft text-danger",
      amber: "border-warning/25 bg-warning-soft text-warning",
      green: "border-success/20 bg-success-soft text-success",
      navy: "border-navy-700 bg-navy-900 text-white",
      outline: "border-input bg-transparent text-foreground/80",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* ---- Skeleton ---- */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

/* ---- Table ---- */
export function Table({ className, wrapperClassName, ...props }: React.ComponentProps<"table"> & { wrapperClassName?: string }) {
  return (
    <div className={cn("relative w-full overflow-auto scroll-thin", wrapperClassName)}>
      <table className={cn("w-full caption-bottom text-[13px] tabular", className)} {...props} />
    </div>
  );
}
export const THead = (p: React.ComponentProps<"thead">) => <thead className={cn("sticky top-0 z-10 bg-muted/80 backdrop-blur", p.className)} {...p} />;
export const TBody = (p: React.ComponentProps<"tbody">) => <tbody {...p} className={cn("[&_tr:last-child]:border-0", p.className)} />;
export const TR = ({ className, ...p }: React.ComponentProps<"tr">) => (
  <tr className={cn("border-b transition-colors hover:bg-muted/50", className)} {...p} />
);
export const TH = ({ className, ...p }: React.ComponentProps<"th">) => (
  <th scope="col" className={cn("h-9 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap", className)} {...p} />
);
export const TD = ({ className, ...p }: React.ComponentProps<"td">) => <td className={cn("px-3 py-2 align-middle", className)} {...p} />;

/* ---- Tabs ---- */
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex h-10 items-center gap-1 rounded-lg bg-muted p-1", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-8 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-card",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-5 focus-visible:outline-offset-4", className)} {...props} />;
}

/* ---- Tooltip ---- */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export function TooltipContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn("z-50 max-w-72 rounded-md bg-navy-900 px-3 py-2 text-xs leading-relaxed text-white shadow-pop animate-in fade-in-0 zoom-in-95", className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/* ---- Switch ---- */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn("inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input transition-colors data-[state=checked]:bg-primary disabled:opacity-50", className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}
