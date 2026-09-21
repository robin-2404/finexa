import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, Database, FlaskConical, Gauge, LayoutDashboard, Menu, ScanSearch, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { Wordmark } from "@/components/layout/Logo";
import { Reveal } from "@/components/shared/Reveal";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ConstellationGrid } from "@/components/ui/constellation-grid";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/overlay";
import { PrismHero } from "@/components/ui/prism-hero";
import { cn } from "@/lib/utils";

const darkGhost = "border-white/25 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white";
const SECTIONS: [string, string][] = [["#features", "Features"], ["#how-it-works", "How it works"], ["#faq", "FAQ"]];

function Nav() {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#030407]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-5">
        <Link to="/" aria-label="FINEXA home" className="rounded-md"><Wordmark dark /></Link>
        <nav aria-label="Main" className="hidden items-center gap-8 text-sm text-[rgba(237,232,223,0.7)] md:flex">
          {SECTIONS.map(([href, label]) => (
            <a key={href} href={href} className="group/nav relative rounded py-1 transition-colors hover:text-white">
              {label}
              <span className="absolute inset-x-0 -bottom-0.5 h-px scale-x-0 bg-cyan-300/70 transition-transform duration-200 ease-out group-hover/nav:scale-x-100" aria-hidden />
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 sm:flex">
            {signedIn ? (
              <Button asChild size="sm"><Link to="/overview">Open workspace</Link></Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="text-[rgba(237,232,223,0.8)] hover:bg-white/10 hover:text-white"><Link to="/login">Log in</Link></Button>
                <Button asChild size="sm"><Link to="/signup">Get started</Link></Button>
              </>
            )}
          </div>
          <Button
            variant="ghost" size="icon" className="text-white hover:bg-white/10 sm:hidden"
            aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}
          >
            <Menu />
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent side="right" hideClose className="w-[86vw] max-w-[340px] border-white/10 bg-[#050609] text-[#EDE8DF]">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
            <Wordmark dark />
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu">
              <span aria-hidden className="text-lg leading-none">×</span>
            </Button>
          </div>
          <nav aria-label="Sections" className="flex flex-col gap-1 p-4 text-[15px]">
            {SECTIONS.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="rounded-md px-3 py-3 text-[rgba(237,232,223,0.8)] transition-colors hover:bg-white/[0.06] hover:text-white">
                {label}
              </a>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-2 border-t border-white/10 p-4">
            {signedIn ? (
              <Button asChild size="lg" onClick={() => setOpen(false)}><Link to="/overview">Open workspace</Link></Button>
            ) : (
              <>
                <Button asChild size="lg" onClick={() => setOpen(false)}><Link to="/signup">Get started</Link></Button>
                <Button asChild size="lg" variant="outline" className={darkGhost} onClick={() => setOpen(false)}><Link to="/login">Log in</Link></Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
    <figure className="group relative" aria-label="Illustrative product preview">
      <div aria-hidden className="absolute -inset-3 -z-10 rounded-[28px] bg-[radial-gradient(closest-side,rgba(11,127,138,0.16),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100 sm:-inset-6" />
      <div className="overflow-hidden rounded-xl border bg-background text-foreground shadow-[0_30px_70px_-30px_rgba(11,26,48,0.45)] transition-transform duration-500 ease-out group-hover:-translate-y-1">
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
                {bars.map((h, i) => <div key={i} className="flex-1 rounded-t-sm bg-primary/70" style={{ height: `${h * 1.5}%` }} />)}
              </div>
            </div>
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="tabular w-full min-w-[420px] text-[10.5px]">
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
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">Illustrative preview with sample values. Not live results.</figcaption>
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
          <div key={i} className="tabular flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-xs">
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

const FAQ = [
  { id: "bank", question: "Is FINEXA connected to a bank or payment system?", answer: "No. FINEXA analyses a historical dataset and runs simulations on it. Nothing here moves money, and a “hold” is a simulated recommendation, not a real block." },
  { id: "data", question: "What data does it use?", answer: "An anonymised transaction dataset with elapsed Time, 28 anonymous numeric features (V1 to V28), Amount, and a verified fraud label. FINEXA doesn't assign business meaning to V1 to V28, and Time is elapsed dataset time rather than a calendar date." },
  { id: "score", question: "What does the model risk score mean?", answer: "It is a ranking score between 0 and 1: higher means the model ranks the transaction as more suspicious. Calibration was not evaluated, so it is not a probability or a confidence level." },
  { id: "labels", question: "Why are some labels hidden?", answer: "Held-out labels stay out of the live and scoring views so the model's output isn't judged by peeking at the answer. You can reveal them in clearly labelled retrospective views." },
  { id: "notes", question: "Do analyst notes and assessments retrain the model?", answer: "No. Your review status, assessment and notes are stored separately from the dataset labels and are never used for retraining." },
  { id: "results", question: "Do the results predict future performance?", answer: "No. Results come from a single historical split. They don't establish how the model would perform on future traffic, and “flagged” fraud is never counted as prevented or recovered." },
];

export function HomePage() {
  useEffect(() => {
    document.title = "FINEXA: fraud risk analysis and investigation";
  }, []);
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  return (
    <div className="overflow-x-clip bg-background">
      <a href="#content" className="skip-link">Skip to content</a>
      <Nav />
      <main id="content">
        <PrismHero
          background={<ConstellationGrid theme="dark" spacing={60} intensity={0.9} />}
          eyebrow="Fraud analysis workspace"
          headline="Understand fraud risk. Investigate with confidence."
          description="Explore transaction risk, investigate model alerts, and compare fraud decision policies in one connected workspace."
          action={
            <Button asChild size="lg">
              <Link to={signedIn ? "/overview" : "/signup"}>{signedIn ? "Open workspace" : "Get started"} <ArrowRight /></Link>
            </Button>
          }
          secondaryAction={!signedIn && <Button asChild size="lg" variant="outline" className={darkGhost}><Link to="/login">Log in</Link></Button>}
          meta={["Held-out replay", "Per-transaction explanations", "Policy rehearsal"]}
          footnote={<span className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> Runs on a historical dataset with simulated replay. Not connected to any bank or payment system.</span>}
        />

        {/* Product preview */}
        <section className="py-20" aria-labelledby="preview-h">
          <div className="mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-12 px-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
            <Reveal>
              <h2 id="preview-h" className="text-[28px] font-semibold tracking-tight sm:text-4xl">One workspace, from overview to case file</h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">Start with the historical picture, watch a simulated stream, then open any alert to see what drove its score.</p>
              <ul className="mt-6 space-y-3 text-sm">
                {["Every metric is labelled with its scope", "Scores stay on a 0 to 1 scale, never a probability", "Labels stay hidden until you ask for them"].map((t) => (
                  <li key={t} className="flex items-start gap-2.5"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />{t}</li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={0.08}><ProductPreview /></Reveal>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-24 border-y bg-card py-20">
          <div className="mx-auto max-w-[1240px] px-5">
            <Reveal>
              <h2 className="max-w-2xl text-[28px] font-semibold tracking-tight sm:text-4xl">Four views, one investigation workflow</h2>
              <p className="mt-3 max-w-2xl text-muted-foreground">Each page answers a different question about the same model and the same data.</p>
            </Reveal>
            <div className="mt-12 space-y-14">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} className="group grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-14">
                  <div className={cn(i % 2 === 1 && "md:order-2")}>
                    <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-ink transition-transform duration-300 group-hover:scale-110"><f.icon className="size-5" aria-hidden /></span>
                    <h3 className="mt-4 text-xl font-semibold tracking-tight">{f.title}</h3>
                    <p className="mt-2 max-w-md leading-relaxed text-muted-foreground">{f.body}</p>
                  </div>
                  <div className={cn("h-52 overflow-hidden rounded-xl border bg-muted/60 transition-all duration-300 group-hover:-translate-y-1 group-hover:border-primary/30 group-hover:shadow-pop", i % 2 === 1 && "md:order-1")} role="img" aria-label={`Schematic illustration for ${f.title}`}>
                    {f.visual}
                  </div>
                </Reveal>
              ))}
            </div>
            <p className="mt-8 text-xs text-muted-foreground">Feature illustrations are schematic and do not show real results.</p>
          </div>
        </section>

        {/* Technology: similarity groups */}
        <section className="relative isolate overflow-hidden bg-[#030407] py-24 text-[#EDE8DF]" aria-labelledby="sim-h">
          <div className="absolute inset-0 -z-10"><ConstellationGrid theme="dark" spacing={72} intensity={0.7} showLabels /></div>
          <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_30%_50%,rgba(3,4,7,0.9)_0%,rgba(3,4,7,0.4)_60%,rgba(3,4,7,0.1)_100%)]" />
          <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-10 px-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <Reveal>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-cyan-200">Pattern Lab</p>
              <h2 id="sim-h" className="mt-3 text-[28px] font-semibold tracking-tight text-[#F3EFE7] sm:text-4xl">Similar records, not networks of people</h2>
              <p className="mt-4 max-w-md leading-relaxed text-[rgba(237,232,223,0.68)]">
                Transactions are grouped by how alike they are in the model's feature space. It's a way to see structure in the data, not evidence that any accounts are connected.
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <dl className="grid gap-4 sm:grid-cols-3">
                {[
                  ["Sample sizes shown", "Every group reports how many records it contains."],
                  ["Prevalence from labels", "Known fraud rates come from the labelled training split."],
                  ["Small groups flagged", "Groups with very few fraud cases are marked as unreliable."],
                ].map(([t, d]) => (
                  <div key={t} className="rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-cyan-300/25 hover:bg-white/[0.06]">
                    <dt className="text-sm font-semibold text-[#F3EFE7]">{t}</dt>
                    <dd className="mt-1.5 text-[13px] leading-relaxed text-[rgba(237,232,223,0.6)]">{d}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
        </section>

        {/* Workflow */}
        <section id="how-it-works" className="scroll-mt-24 py-20">
          <div className="mx-auto max-w-[1240px] px-5">
            <Reveal><h2 className="text-[28px] font-semibold tracking-tight sm:text-4xl">How it works</h2></Reveal>
            <ol className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.t} className="relative">
                  <Reveal delay={i * 0.05} className="h-full rounded-xl border bg-card p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-pop">
                    <div className="flex items-center gap-3">
                      <span className="tabular grid size-9 place-items-center rounded-full bg-navy-900 text-sm font-semibold text-white">{i + 1}</span>
                      <s.icon className="size-5 text-primary" aria-hidden />
                    </div>
                    <h3 className="mt-4 font-semibold">{s.t}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
                  </Reveal>
                  {i < STEPS.length - 1 && <ArrowRight className="absolute -right-4 top-1/2 z-10 hidden size-4 -translate-y-1/2 text-muted-foreground md:block" aria-hidden />}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Honest data section */}
        <section className="border-y bg-card py-20">
          <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-10 px-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
            <Reveal>
              <h2 className="text-[28px] font-semibold tracking-tight sm:text-4xl">What the data is, and isn't</h2>
              <p className="mt-3 text-muted-foreground">FINEXA is built for analysis and demonstration. These limits are part of the product, not fine print.</p>
            </Reveal>
            <Reveal delay={0.06}>
              <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
                {[
                  ["Anonymised dataset", "Records contain elapsed Time, 28 anonymous numeric features (V1 to V28), Amount and a verified fraud label. FINEXA doesn't assign business meaning to V1 to V28."],
                  ["Historical simulation", "The live monitor replays held-out historical transactions in dataset-time order. It is a simulation, not live payment traffic."],
                  ["Scores are rankings", "Model risk scores are uncalibrated values between 0 and 1. They are not probabilities or confidence levels."],
                  ["Recommendations only", "\"Hold\" is a simulated recommendation. Nothing is blocked, and flagged transactions are not counted as prevented or recovered."],
                ].map(([t, d]) => (
                  <div key={t}><dt className="font-semibold">{t}</dt><dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</dd></div>
                ))}
              </dl>
            </Reveal>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 py-20" aria-labelledby="faq-h">
          <div className="mx-auto max-w-[820px] px-5">
            <Reveal>
              <h2 id="faq-h" className="text-[28px] font-semibold tracking-tight sm:text-4xl">Questions, answered plainly</h2>
              <div className="mt-8"><Accordion items={FAQ} /></div>
            </Reveal>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative isolate overflow-hidden bg-[#030407] py-20 text-[#EDE8DF]">
          <div className="absolute inset-0 -z-10"><ConstellationGrid theme="dark" spacing={64} intensity={0.55} showLabels={false} /></div>
          <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_50%,rgba(3,4,7,0.85)_0%,rgba(3,4,7,0.35)_70%,rgba(3,4,7,0.1)_100%)]" />
          <Reveal className="mx-auto flex max-w-[1240px] flex-col items-start justify-between gap-6 px-5 md:flex-row md:items-center">
            <div>
              <h2 className="text-[28px] font-semibold tracking-tight text-[#F3EFE7] sm:text-4xl">Ready to explore the workspace?</h2>
              <p className="mt-2 text-[rgba(237,232,223,0.68)]">Create an account and start a replay in a few clicks.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg"><Link to={signedIn ? "/overview" : "/signup"}>{signedIn ? "Open workspace" : "Get started"} <ArrowRight /></Link></Button>
              {!signedIn && <Button asChild size="lg" variant="outline" className={darkGhost}><Link to="/login">Log in</Link></Button>}
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-muted-foreground">
          <Wordmark className="[&_svg]:size-5 [&>span:last-child]:text-sm" />
          <p>Historical fraud analysis and simulation. Not a banking system.</p>
        </div>
      </footer>
    </div>
  );
}
