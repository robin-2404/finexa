import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AccordionItem {
  id: string;
  question: string;
  answer: ReactNode;
}

/** Accessible disclosure list: real buttons with aria-expanded/aria-controls, keyboard-operable, motion-safe. */
export function Accordion({ items, className }: { items: AccordionItem[]; className?: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const base = useId();
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  return (
    <div className={cn("divide-y rounded-xl border bg-card", className)}>
      {items.map((it) => {
        const isOpen = open.has(it.id);
        const panelId = `${base}-${it.id}-panel`;
        const btnId = `${base}-${it.id}-btn`;
        return (
          <div key={it.id}>
            <h3>
              <button
                id={btnId} type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(it.id)}
                className="flex min-h-12 w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-medium hover:bg-muted/40"
              >
                <span>{it.question}</span>
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={panelId} role="region" aria-labelledby={btnId}
                  initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden"
                >
                  <div className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{it.answer}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
