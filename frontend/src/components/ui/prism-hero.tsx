import { Component, lazy, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll } from "motion/react";
import { cn } from "@/lib/utils";
import type { PrismQuality } from "./prism-scene";

// The three.js scene (and three itself) is a separate chunk: the rest of the app never pays for it.
const PrismScene = lazy(() => import("./prism-scene"));

export interface PrismHeroProps {
  eyebrow: string;
  headline: ReactNode;
  description: ReactNode;
  /** Short factual chips shown under the actions. */
  meta?: string[];
  action?: ReactNode;
  secondaryAction?: ReactNode;
  /** Optional atmospheric layer rendered behind everything (e.g. <ConstellationGrid />). */
  background?: ReactNode;
  /** Small print under the meta chips. */
  footnote?: ReactNode;
  className?: string;
}

/** Quality tier from viewport, CPU/memory hints and pointer type. Weaker devices never get the expensive path. */
export function detectQuality(): PrismQuality {
  if (typeof window === "undefined") return "low";
  const w = window.innerWidth;
  const nav = navigator as Navigator & { deviceMemory?: number };
  let tier = w < 640 ? 0 : w < 1100 ? 1 : 2;
  if ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4) tier = Math.max(0, tier - 1);
  if (window.matchMedia?.("(pointer: coarse)").matches) tier = Math.min(tier, 1);
  return (["low", "medium", "high"] as const)[tier];
}

export function supportsWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

/** Static faceted crystal used when WebGL is unavailable or the 3D scene fails; keeps the layout intact. */
export function PrismFallback({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 400" className={cn("size-full", className)} role="img" aria-label="Decorative faceted crystal">
      <defs>
        <linearGradient id="pf-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a5f3fc" stopOpacity=".55" /><stop offset="1" stopColor="#0e7490" stopOpacity=".15" /></linearGradient>
        <linearGradient id="pf-b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".35" /><stop offset="1" stopColor="#3b82f6" stopOpacity=".12" /></linearGradient>
        <radialGradient id="pf-g" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#22d3ee" stopOpacity=".22" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx="200" cy="200" r="190" fill="url(#pf-g)" />
      <g stroke="#a5f3fc" strokeOpacity=".55" strokeWidth="1.2" strokeLinejoin="round">
        <polygon points="200,40 320,120 280,250 120,250 80,120" fill="url(#pf-a)" />
        <polygon points="200,40 320,120 200,150" fill="url(#pf-b)" />
        <polygon points="200,40 80,120 200,150" fill="#ffffff" fillOpacity=".08" />
        <polygon points="320,120 280,250 200,150" fill="#38bdf8" fillOpacity=".14" />
        <polygon points="80,120 120,250 200,150" fill="#22d3ee" fillOpacity=".1" />
        <polygon points="120,250 280,250 200,350" fill="url(#pf-b)" />
        <polygon points="200,150 120,250 280,250" fill="#ffffff" fillOpacity=".06" />
      </g>
    </svg>
  );
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("PrismHero: 3D scene failed, showing the static fallback.", error, info.componentStack);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Crystal canvas. Renders only while (a) in view, (b) the tab is visible; reduced motion draws one still frame.
 * Quality is re-evaluated when the viewport crosses a breakpoint.
 */
function PrismCanvas({ sectionRef }: { sectionRef: React.RefObject<HTMLElement | null> }) {
  const reduced = !!useReducedMotion();
  const [quality, setQuality] = useState<PrismQuality>(() => detectQuality());
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const [webgl] = useState(() => supportsWebGL());
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end start"] });

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => setQuality(detectQuality()), 200);
    };
    const onVis = () => setTabVisible(!document.hidden);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [sectionRef]);

  if (!webgl) return <PrismFallback />;
  const frameloop = !inView || !tabVisible ? "never" : reduced ? "demand" : "always";
  return (
    <SceneBoundary fallback={<PrismFallback />}>
      <Suspense fallback={<PrismFallback className="opacity-40" />}>
        <PrismScene quality={quality} frameloop={frameloop} reduced={reduced} progress={scrollYProgress} />
      </Suspense>
    </SceneBoundary>
  );
}

/**
 * Dark cinematic hero: atmospheric background layer, product copy on the left, procedural refractive crystal on the
 * right (below the copy on phones, so it can never cover text or buttons).
 */
export function PrismHero({ eyebrow, headline, description, meta, action, secondaryAction, background, footnote, className }: PrismHeroProps) {
  const ref = useRef<HTMLElement>(null);
  return (
    <section ref={ref} className={cn("relative isolate overflow-hidden bg-[#030407] text-[#EDE8DF]", className)}>
      {background && <div className="absolute inset-0 -z-20">{background}</div>}
      {/* Vignette keeps the copy readable over the moving grid. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_28%_45%,rgba(3,4,7,0.92)_0%,rgba(3,4,7,0.55)_48%,rgba(3,4,7,0.15)_100%)]" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-t from-[#030407] to-transparent" />

      <div className="mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-2 px-5 pb-10 pt-14 lg:min-h-[min(780px,90vh)] lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-6 lg:pb-16 lg:pt-20">
        <div className="relative z-10">
          <motion.p
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-cyan-200"
          >
            <span className="size-1.5 rounded-full bg-cyan-300" aria-hidden /> {eyebrow}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="text-[36px] font-semibold leading-[1.06] tracking-[-0.025em] text-[#F3EFE7] sm:text-[48px] lg:text-[58px]"
          >
            {headline}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="mt-5 max-w-xl text-base leading-relaxed text-[rgba(237,232,223,0.68)] sm:text-[17px]"
          >
            {description}
          </motion.p>
          {(action || secondaryAction) && (
            <motion.div
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8 flex flex-wrap gap-3"
            >
              {action}
              {secondaryAction}
            </motion.div>
          )}
          {meta && meta.length > 0 && (
            <motion.ul
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.35 }}
              className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[rgba(237,232,223,0.55)]" aria-label="Highlights"
            >
              {meta.map((m) => (
                <li key={m} className="flex items-center gap-2"><span className="size-1 rounded-full bg-cyan-300/70" aria-hidden />{m}</li>
              ))}
            </motion.ul>
          )}
          {footnote && <div className="mt-6 text-[13px] text-[rgba(237,232,223,0.5)]">{footnote}</div>}
        </div>

        <div className="relative h-[260px] sm:h-[340px] lg:h-[560px]" aria-hidden="true">
          <PrismCanvas sectionRef={ref} />
        </div>
      </div>
    </section>
  );
}
