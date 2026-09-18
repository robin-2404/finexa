import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Wordmark } from "@/components/layout/Logo";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="grid grid-cols-1 min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between bg-navy-900 p-10 text-white lg:flex">
        <Link to="/" aria-label="FINEXA home"><Wordmark dark /></Link>
        <div className="max-w-md">
          <h2 className="text-2xl font-semibold leading-snug tracking-tight">Understand fraud risk. Investigate with confidence.</h2>
          <ul className="mt-6 space-y-3 text-sm text-navy-200">
            {[
              "Replay held-out transactions through a trained model",
              "Investigate alerts with per-transaction explanations",
              "Compare review and hold policies against review capacity",
            ].map((t) => (
              <li key={t} className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-300" aria-hidden />{t}</li>
            ))}
          </ul>
        </div>
        <p className="max-w-md text-xs leading-relaxed text-navy-300">
          FINEXA analyses a historical dataset and runs simulations. It is not connected to a bank or payment system, and "hold" is a simulated recommendation.
        </p>
      </aside>
      <main className="flex flex-col bg-background">
        <div className="p-5 lg:hidden"><Link to="/" aria-label="FINEXA home"><Wordmark /></Link></div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12 pt-2 lg:py-12">
          <div className="w-full max-w-[400px]">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
            <div className="mt-7">{children}</div>
            <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>
          </div>
        </div>
      </main>
    </div>
  );
}

export function PasswordInput({
  id, value, onChange, onBlur, autoComplete, invalid, describedBy, disabled,
}: {
  id: string; value: string; onChange: (v: string) => void; onBlur?: () => void; autoComplete: string;
  invalid?: boolean; describedBy?: string; disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id} name={id} type={show ? "text" : "password"} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        autoComplete={autoComplete} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        className="pr-10"
      />
      <button
        type="button" onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

export function FormAlert({ tone = "error", children, id }: { tone?: "error" | "info"; children: ReactNode; id?: string }) {
  return (
    <div
      id={id} role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2.5 text-sm", tone === "error" ? "border-danger/30 bg-danger-soft text-danger" : "border-primary/25 bg-primary-soft text-primary-ink")}
    >
      {children}
    </div>
  );
}
