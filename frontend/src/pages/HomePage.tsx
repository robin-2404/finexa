import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, Database, FlaskConical, Gauge, LayoutDashboard, ScanSearch, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { Wordmark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("motion-safe:animate-fade-up", className)}>{children}</div>;
}

function Nav() {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-navy-900/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-5">
        <Link to="/" aria-label="FINEXA home"><Wordmark dark /></Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-sm text-navy-200 md:flex">
          <a href="#features" className="rounded hover:text-white">Features</a>
          <a href="#how-it-works" className="rounded hover:text-white">How it works</a>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <Button asChild size="sm"><Link to="/overview">Open workspace</Link></Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="text-navy-200 hover:bg-white/10 hover:text-white"><Link to="/login">Log in</Link></Button>
              <Button asChild size="sm"><Link to="/signup">Get started</Link></Button>
            </>
          )}
        </div>
      </div>
      <nav aria-label="Sections" className="flex justify-center gap-6 border-t border-white/10 py-2 text-[13px] text-navy-200 md:hidden">
        <a href="#features" className="hover:text-white">Features</a>
        <a href="#how-it-works" className="hover:text-white">How it works</a>
      </nav>
    </header>
  );
}

/** Static, illustrative preview. All numbers are sample values and are labelled as such. */
function ProductPreview() {
  const bars = [22, 30, 26, 38, 34, 48, 40, 31, 44, 52, 37, 29];
  const rows = [
    { ref: "TXN-000000", t: "T+00:00:02", amt: "24.50", s: 0.91, b: "High", c: "bg-danger-soft text-danger" },
    { ref: "TXN-000000", t: "T+00:00:07", amt: "310.00", s: 0.42, b: "Medium", c: "bg-warning-soft text-warning" },
    { ref: "TXN-000000", t: "T+00:00:15", amt: "8.99", s: 0.03, b: "Low", c: "bg-success-soft text-success" },
    { ref: "TXN-000000", t: "T+00:00:21", amt: "57.20", s: 0.07, b: "Low", c: "bg-success-soft text-success" },
  ];
  return (
    <figure className="relative" aria-label="Illustrative product preview">
      <div className="overflow-hidden rounded-xl border border-white/15 bg-background text-foreground shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)]">
        <div className="flex items-center gap-2 border-b bg-card px-4 py-2.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-border" /><span className="size-2.5 rounded-full bg-border" /><span className="size-2.5 rounded-full bg-border" />
          <span className="ml-3 text-xs text-muted-foreground">Overview</span>
        </div>
        <div className="grid grid-cols-[52px_1fr]" aria-hidden>
          <div className="flex flex-col items-center gap-3 bg-navy-900 py-4 text-navy-300">
            <LayoutDashboard className="size-4 text-teal-300" /><Activity className="size-4" /><ScanSearch className="size-4" /><FlaskConical className="size-4" />
          </div>
          <div className="min-w-0 space-y-3 p-4">
            <div className="grid grid-cols-3 gap-2.5">
              {[["Transactions", "1,240"], ["Model-flagged", "38"], ["In review queue", "12"]].map(([l, v]) => (
                <div key={l} className="rounded-md border bg-card p-2.5">
                  <p className="text-[10px] text-muted-foreground">{l}</p>
                  <p className="tabular text-base font-semibold">{v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="mb-2 text-[10px] text-muted-foreground">Transactions over elapsed dataset time</p>
              <div className="flex h-20 items-end gap-1.5">
                {bars.map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-sm bg-primary/70" style={{ height: `${h * 1.5}%` }} />
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-md border bg-card">
              <table className="tabular w-full text-[10.5px]">
                <thead className="bg-muted/70 text-left text-muted-foreground">
                  <tr><th className="px-2.5 py-1.5 font-medium">Reference</th><th className="px-2 font-medium">Elapsed</th><th className="px-2 text-right font-medium">Amount</th><th className="px-2 text-right font-medium">Model score</th><th className="px-2 font-medium">Risk</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2.5 py-1.5">{r.ref}</td><td className="px-2">{r.t}</td><td className="px-2 text-right">{r.amt}</td>
                      <td className="px-2 text-right">{r.s.toFixed(2)}</td>
                      <td className="px-2"><span className={cn("rounded px-1.5 py-0.5 font-medium", r.c)}>{r.b}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-navy-300">Illustrative preview with sample values. Not live results.</figcaption>
    </figure>
  );
}

const FEATURES = [
  {
    icon: LayoutDashboard, title: "See the historical picture",
    body: "An overview that keeps scopes apart: historical dataset counts, the current replay, and held-out evaluation results. Known fraud and model-flagged transactions are never blended.",
    visual: (
      <div className="flex h-full items-end gap-1.5 p-5">
        {[30, 44, 36, 58, 46, 70, 52, 40, 62].map((h, i) => <div key={i} className="flex-1 rounded-t bg-primary/70" style={{ height: `${h}%` }} />)}
      </div>
    ),
  },
  {
    icon: Activity, title: "Monitor a simulated stream",
    body: "Replay held-out transactions in dataset-time order through the real scoring pipeline. Start, pause, resume, reset and change speed, with labels kept out of the live view.",
    visual: (
      <div className="space-y-2 p-5">
        {[["0.94", "bg-danger"], ["0.51", "bg-warning"], ["0.06", "bg-success"], ["0.02", "bg-success"]].map(([s, c], i) => (
          <div key={i} className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-xs tabular">
            <span className="w-24 text-muted-foreground">T+00:0{i}:1{i}</span><span className="flex-1"><span className={cn("block h-1.5 rounded-full", c)} style={{ width: `${Number(s) * 100}%` }} /></span><span className="w-8 text-right font-medium">{s}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: ScanSearch, title: "Investigate with context",
    body: "Open any transaction to see its model score, per-transaction feature contributions, similar historical cases, and your own notes and assessment, each kept clearly separate from known outcomes.",
    visual: (
      <div className="grid grid-cols-2 gap-3 p-5 text-xs">
        <div className="space-y-2 rounded-md border bg-card p-3">
          <p className="font-medium">Feature contributions</p>
          {[["V14", 82, "bg-danger/70"], ["V4", 46, "bg-danger/70"], ["V12", 38, "bg-primary/70"]].map(([f, w, c]) => (
            <div key={f as string} className="flex items-center gap-2"><span className="w-7 text-muted-foreground">{f}</span><span className={cn("h-2 rounded-sm", c as string)} style={{ width: `${w}%` }} /></div>
          ))}
        </div>
        <div className="space-y-2 rounded-md border bg-card p-3"><p className="font-medium">Analyst note</p><div className="h-2 w-full rounded bg-muted" /><div className="h-2 w-4/5 rounded bg-muted" /><div className="h-2 w-3/5 rounded bg-muted" /></div>
      </div>
    ),
  },
  {
    icon: SlidersHorizontal, title: "Rehearse fraud policies",
    body: "Change review and hold thresholds and how many cases analysts can review per batch. See fraud flagged, fraud allowed, review demand and overflow, all measured on historical data.",
    visual: (
      <div className="space-y-4 p-5 text-xs">
        <div><p className="mb-1.5 font-medium">Review capacity per batch</p><div className="relative h-2 rounded-full bg-muted"><div className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary" /><div className="absolute left-2/5 top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-primary bg-white" /></div></div>
        <div className="grid grid-cols-3 gap-2">{["Within capacity", "Overflow", "Fraud allowed"].map((l) => <div key={l} className="rounded-md border bg-card p-2.5"><p className="text-[10px] text-muted-foreground">{l}</p><div className="mt-1.5 h-2 w-10 rounded bg-muted" /></div>)}</div>
      </div>
    ),
  },
];

const STEPS = [
  { icon: Database, t: "Historical data", d: "A labelled, anonymised transaction dataset, split into train, validation and test." },
  { icon: Gauge, t: "Model scoring", d: "A trained model gives every transaction a risk score between 0 and 1." },
  { icon: ScanSearch, t: "Investigation", d: "Analysts review alerts with explanations, similar cases and notes." },
  { icon: SlidersHorizontal, t: "Policy comparison", d: "Compare thresholds and review capacity on held-out data." },
];

export function HomePage() {
  useEffect(() => {
    document.title = "FINEXA: fraud risk analysis and investigation";
  }, []);
  return (
    <div className="bg-background">
      <a href="#content" className="skip-link">Skip to content</a>
      <Nav />
      <main id="content">
        {/* Hero */}
        <section className="bg-navy-900 text-white">
          <div className="mx-auto grid grid-cols-1 max-w-[1200px] items-center gap-12 px-5 pb-20 pt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pb-24 lg:pt-20">
            <Reveal>
              <h1 className="text-[34px] font-semibold leading-[1.12] tracking-tight sm:text-[42px] lg:text-[46px]">
                Understand fraud risk. Investigate with confidence.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-navy-200">
                Explore transaction risk, investigate model alerts, and compare fraud decision policies in one connected workspace.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg"><Link to="/signup">Get started <ArrowRight /></Link></Button>
                <Button asChild size="lg" variant="outline" className="border-white/25 text-white hover:bg-white/10 hover:text-white"><Link to="/login">Log in</Link></Button>
              </div>
              <p className="mt-6 flex items-start gap-2 text-[13px] text-navy-300"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> Runs on a historical dataset with simulated replay. Not connected to any bank or payment system.</p>
            </Reveal>
            <Reveal className="[animation-delay:120ms]"><ProductPreview /></Reveal>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-24 py-20">
          <div className="mx-auto max-w-[1200px] px-5">
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">Four views, one investigation workflow</h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">Each page answers a different question about the same model and the same data.</p>
            <div className="mt-12 space-y-12">
              {FEATURES.map((f, i) => (
                <div key={f.title} className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-14">
                  <div className={cn(i % 2 === 1 && "md:order-2")}>
                    <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-ink"><f.icon className="size-5" aria-hidden /></span>
                    <h3 className="mt-4 text-xl font-semibold tracking-tight">{f.title}</h3>
                    <p className="mt-2 max-w-md leading-relaxed text-muted-foreground">{f.body}</p>
                  </div>
                  <div className={cn("h-52 overflow-hidden rounded-xl border bg-muted/60", i % 2 === 1 && "md:order-1")} role="img" aria-label={`Illustration for ${f.title}`}>
                    {f.visual}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs text-muted-foreground">Feature illustrations are schematic and do not show real results.</p>
          </div>
        </section>

        {/* Workflow */}
        <section id="how-it-works" className="scroll-mt-24 border-y bg-card py-20">
          <div className="mx-auto max-w-[1200px] px-5">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
            <ol className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.t} className="relative rounded-lg border bg-background p-5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full bg-navy-900 text-sm font-semibold text-white tabular">{i + 1}</span>
                    <s.icon className="size-5 text-primary" aria-hidden />
                  </div>
                  <h3 className="mt-4 font-semibold">{s.t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
                  {i < STEPS.length - 1 && <ArrowRight className="absolute -right-5 top-1/2 z-10 hidden size-4 -translate-y-1/2 text-muted-foreground md:block" aria-hidden />}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Honest data section */}
        <section className="py-20">
          <div className="mx-auto grid grid-cols-1 max-w-[1200px] gap-10 px-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What the data is, and isn't</h2>
              <p className="mt-3 text-muted-foreground">FINEXA is built for analysis and demonstration. These limits are part of the product, not fine print.</p>
            </div>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
              {[
                ["Anonymised dataset", "Records contain elapsed Time, 28 anonymous numeric features (V1 to V28), Amount and a verified fraud label. FINEXA doesn't assign business meaning to V1 to V28."],
                ["Historical simulation", "The live monitor replays held-out historical transactions in dataset-time order. It is a simulation, not live payment traffic."],
                ["Scores are rankings", "Model risk scores are uncalibrated values between 0 and 1. They are not probabilities or confidence levels."],
                ["Recommendations only", "\"Hold\" is a simulated recommendation. Nothing is blocked, and flagged transactions are not counted as prevented or recovered."],
              ].map(([t, d]) => (
                <div key={t}><dt className="font-semibold">{t}</dt><dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</dd></div>
              ))}
            </dl>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-navy-900 py-16 text-white">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 px-5 md:flex-row md:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Ready to explore the workspace?</h2>
              <p className="mt-2 text-navy-200">Create an account and start a replay in a few clicks.</p>
            </div>
            <div className="flex gap-3">
              <Button asChild size="lg"><Link to="/signup">Get started <ArrowRight /></Link></Button>
              <Button asChild size="lg" variant="outline" className="border-white/25 text-white hover:bg-white/10 hover:text-white"><Link to="/login">Log in</Link></Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-muted-foreground">
          <Wordmark className="[&_svg]:size-5 [&>span:last-child]:text-sm" />
          <p>Historical fraud analysis and simulation. Not a banking system.</p>
        </div>
      </footer>
    </div>
  );
}
