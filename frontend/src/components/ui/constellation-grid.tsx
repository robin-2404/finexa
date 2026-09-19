import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type ConstellationTheme = "dark" | "light";

export interface ConstellationGridProps {
  className?: string;
  /** Distance between grid nodes in CSS px. Larger = sparser and cheaper. */
  spacing?: number;
  /** "dark" for navy/black sections, "light" for white surfaces. */
  theme?: ConstellationTheme;
  /** Follow the pointer (repulsion, links to the cursor, coordinate labels). Off = ambient only. */
  interactive?: boolean;
  /** Draw small coordinate labels beside nodes near the pointer. */
  showLabels?: boolean;
  /** Overall opacity multiplier (0-1) so foreground content always stays readable. */
  intensity?: number;
}

interface Node {
  hx: number; hy: number; // home position
  x: number; y: number;
  vx: number; vy: number;
  pulse: number;          // 0..1, decays
  phase: number;          // idle shimmer offset
}
interface Ring { x: number; y: number; r: number; max: number; kind: "radar" | "shock" }

const PALETTE = {
  dark: { node: "103,232,249", line: "103,232,249", accent: "255,255,255", label: "165,243,252" },
  light: { node: "11,127,138", line: "11,127,138", accent: "18,38,74", label: "7,95,104" },
} as const;

/** Small deterministic PRNG so the layout is stable between renders. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Interactive canvas of a jittered node grid with spring physics: nodes are pushed away from the pointer and spring
 * back home, links appear/disappear as nodes move, clicks send a shockwave, and a radar ring pulses periodically.
 * Decorative only (aria-hidden, no pointer capture). Pauses when off-screen or when the tab is hidden, honours
 * prefers-reduced-motion (one static frame), caps DPR, and removes every listener/frame on unmount.
 */
export function ConstellationGrid({ className, spacing = 58, theme = "dark", interactive = true, showLabels = true, intensity = 1 }: ConstellationGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // e.g. non-browser environments: render nothing rather than fail

    const colors = PALETTE[theme];
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const dprCap = coarse ? 1.5 : 2;

    let w = 0, h = 0, cols = 0, rows = 0, dpr = 1;
    let nodes: Node[] = [];
    const rings: Ring[] = [];
    const pointer = { x: -9999, y: -9999, active: false };
    let raf = 0;
    let visible = true;
    let last = 0;
    let nextRadar = 0;
    let running = false;

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const step = w < 640 ? spacing * 1.25 : spacing; // sparser on small screens
      cols = Math.ceil(w / step) + 1;
      rows = Math.ceil(h / step) + 1;
      const rand = mulberry32(cols * 977 + rows * 131);
      nodes = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const hx = c * step + (rand() - 0.5) * step * 0.35;
          const hy = r * step + (rand() - 0.5) * step * 0.35;
          nodes.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0, pulse: 0, phase: rand() * Math.PI * 2 });
        }
      }
    };

    const step = (dt: number, t: number) => {
      const R = 150; // pointer influence radius
      const k = 42; // spring stiffness (1/s^2)
      const damp = 7.5; // damping (1/s)
      for (const n of nodes) {
        let ax = (n.hx - n.x) * k - n.vx * damp;
        let ay = (n.hy - n.y) * k - n.vy * damp;
        if (interactive && pointer.active) {
          const dx = n.x - pointer.x, dy = n.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R * R && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = (1 - d / R) ** 2 * 5200;
            ax += (dx / d) * f;
            ay += (dy / d) * f;
            n.pulse = Math.max(n.pulse, (1 - d / R) * 0.9);
          }
        }
        for (const ring of rings) {
          if (ring.kind !== "shock") continue;
          const dx = n.x - ring.x, dy = n.y - ring.y;
          const d = Math.hypot(dx, dy);
          const band = Math.abs(d - ring.r);
          if (band < 26 && d > 0.5) {
            const f = (1 - band / 26) * 2600 * (1 - ring.r / ring.max);
            ax += (dx / d) * f;
            ay += (dy / d) * f;
            n.pulse = Math.max(n.pulse, 0.9);
          }
        }
        n.vx += ax * dt;
        n.vy += ay * dt;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.pulse = Math.max(0, n.pulse - dt * 1.4);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.r += (ring.kind === "shock" ? 520 : 150) * dt;
        if (ring.r >= ring.max) rings.splice(i, 1);
      }
      if (t > nextRadar && nodes.length) {
        const n = nodes[Math.floor(Math.random() * nodes.length)];
        rings.push({ x: n.hx, y: n.hy, r: 0, max: 210, kind: "radar" });
        n.pulse = 1;
        nextRadar = t + 3200 + Math.random() * 2600;
      }
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const linkMax = spacing * 1.65;
      ctx.lineWidth = 1;
      // Links between grid neighbours (right, down, both diagonals); alpha follows the *current* distance so
      // connections fade in and out as nodes are displaced.
      const offs: [number, number][] = [[1, 0], [0, 1], [1, 1], [-1, 1]];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = nodes[r * cols + c];
          for (const [dc, dr] of offs) {
            const cc = c + dc, rr = r + dr;
            if (cc < 0 || cc >= cols || rr >= rows) continue;
            const b = nodes[rr * cols + cc];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > linkMax) continue;
            const glow = Math.max(a.pulse, b.pulse);
            const alpha = ((1 - d / linkMax) * 0.22 + glow * 0.5) * intensity;
            if (alpha < 0.01) continue;
            ctx.strokeStyle = `rgba(${colors.line},${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      // Links from the pointer to nearby nodes
      if (interactive && pointer.active) {
        for (const n of nodes) {
          const d = Math.hypot(n.x - pointer.x, n.y - pointer.y);
          if (d < 130) {
            ctx.strokeStyle = `rgba(${colors.accent},${((1 - d / 130) * 0.35 * intensity).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(pointer.x, pointer.y);
            ctx.lineTo(n.x, n.y);
            ctx.stroke();
          }
        }
      }
      // Rings
      for (const ring of rings) {
        const life = 1 - ring.r / ring.max;
        ctx.strokeStyle = `rgba(${colors.line},${(life * (ring.kind === "radar" ? 0.35 : 0.5) * intensity).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Nodes
      for (const n of nodes) {
        const shimmer = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t / 1100 + n.phase);
        const rad = 1.1 + shimmer * 0.5 + n.pulse * 2.4;
        const alpha = (0.32 + shimmer * 0.2 + n.pulse * 0.6) * intensity;
        ctx.fillStyle = `rgba(${colors.node},${Math.min(alpha, 1).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      // Coordinate labels near the pointer (max 3, so it never becomes noise)
      if (interactive && showLabels && pointer.active) {
        const near = nodes
          .map((n) => ({ n, d: Math.hypot(n.x - pointer.x, n.y - pointer.y) }))
          .filter((o) => o.d < 90)
          .sort((a, b) => a.d - b.d)
          .slice(0, 3);
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textBaseline = "middle";
        for (const { n, d } of near) {
          ctx.fillStyle = `rgba(${colors.label},${((1 - d / 90) * 0.85 * intensity).toFixed(3)})`;
          ctx.fillText(`${Math.round(n.hx)},${Math.round(n.hy)}`, n.x + 8, n.y - 8);
        }
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!running) return;
      const dt = Math.min((now - (last || now)) / 1000, 0.05);
      last = now;
      step(dt, now);
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running || reduced || !visible || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    build();
    draw(0); // a first frame is always painted (also the only frame with reduced motion)

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      pointer.active = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      pointer.x = x;
      pointer.y = y;
    };
    const onLeave = () => { pointer.active = false; };
    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      rings.push({ x, y, r: 0, max: 320, kind: "shock" });
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    const ro = new ResizeObserver(() => { build(); draw(performance.now()); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      visible ? start() : stop();
    }, { threshold: 0 });
    io.observe(canvas);

    if (interactive && !reduced) {
      // Window-level listeners so the canvas can stay pointer-events:none behind real content.
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [spacing, theme, interactive, showLabels, intensity]);

  return <canvas ref={canvasRef} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}
