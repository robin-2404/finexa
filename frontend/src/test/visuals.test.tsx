import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { ConstellationGrid } from "@/components/ui/constellation-grid";
import { detectQuality, PrismFallback, PrismHero, supportsWebGL } from "@/components/ui/prism-hero";
import { HomePage } from "@/pages/HomePage";
import { err, mockApi, renderApp } from "./utils";

/** A 2D context that records nothing but supports every call the grid makes. */
function fakeContext() {
  const noop = () => {};
  return new Proxy({} as CanvasRenderingContext2D, { get: () => noop, set: () => true });
}

function stubMatchMedia(reduced: boolean, coarse = false) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduced-motion") ? reduced : q.includes("coarse") ? coarse : false,
    media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("ConstellationGrid", () => {
  it("does not crash without a 2D context and stays decorative", () => {
    const { container } = render(<ConstellationGrid />);
    const canvas = container.querySelector("canvas")!;
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas.className).toContain("pointer-events-none");
  });

  it("animates, then removes every listener and cancels its frame on unmount", () => {
    stubMatchMedia(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeContext());
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 42);
    const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<ConstellationGrid />);
    expect(raf).toHaveBeenCalled();
    expect(add.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["pointermove", "pointerdown"]));
    unmount();
    expect(caf).toHaveBeenCalledWith(42);
    expect(remove.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["pointermove", "pointerdown"]));
  });

  it("paints a single still frame and attaches no pointer listeners under prefers-reduced-motion", () => {
    stubMatchMedia(true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeContext());
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const add = vi.spyOn(window, "addEventListener");
    render(<ConstellationGrid />);
    expect(raf).not.toHaveBeenCalled();
    expect(add.mock.calls.map((c) => c[0])).not.toContain("pointermove");
  });

  it("is non-interactive when asked (ambient only)", () => {
    stubMatchMedia(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeContext());
    const add = vi.spyOn(window, "addEventListener");
    render(<ConstellationGrid interactive={false} />);
    expect(add.mock.calls.map((c) => c[0])).not.toContain("pointermove");
  });
});

describe("PrismHero", () => {
  it("shows the product copy and actions, and a static crystal when WebGL is unavailable", () => {
    expect(supportsWebGL()).toBe(false); // jsdom has no WebGL
    render(
      <PrismHero
        eyebrow="Fraud analysis workspace" headline="Understand fraud risk." description="Explore transaction risk."
        meta={["Held-out replay", "Policy rehearsal"]} action={<a href="/signup">Get started</a>} secondaryAction={<a href="/login">Log in</a>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Understand fraud risk." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Highlights" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByLabelText("Decorative faceted crystal")).toBeInTheDocument();
  });

  it("puts the crystal in its own aria-hidden block, so it can never sit on top of the copy", () => {
    const { container } = render(<PrismHero eyebrow="e" headline="h" description="d" />);
    const canvasBlock = container.querySelector("[aria-hidden='true'].relative");
    expect(canvasBlock).not.toBeNull();
    expect(container.querySelector("h1")!.closest("div")).not.toBe(canvasBlock);
  });

  it("lowers the quality tier for small viewports, weak CPUs and touch devices", () => {
    const set = (w: number, cores: number, coarse = false) => {
      vi.stubGlobal("innerWidth", w);
      vi.stubGlobal("navigator", { hardwareConcurrency: cores, deviceMemory: 8 });
      stubMatchMedia(false, coarse);
    };
    set(1440, 12);
    expect(detectQuality()).toBe("high");
    set(1440, 4);
    expect(detectQuality()).toBe("medium");
    set(1440, 12, true);
    expect(detectQuality()).toBe("medium");
    set(900, 12);
    expect(detectQuality()).toBe("medium");
    set(390, 8);
    expect(detectQuality()).toBe("low");
    set(390, 4);
    expect(detectQuality()).toBe("low");
  });

  it("renders the fallback crystal component on its own", () => {
    render(<PrismFallback />);
    expect(screen.getByRole("img", { name: /decorative faceted crystal/i })).toBeInTheDocument();
  });
});

describe("Accordion", () => {
  it("toggles with the keyboard and exposes state to assistive tech", async () => {
    render(<Accordion items={[{ id: "a", question: "First?", answer: "Because." }, { id: "b", question: "Second?", answer: "Since." }]} />);
    const user = userEvent.setup();
    const first = screen.getByRole("button", { name: "First?" });
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Because.")).not.toBeInTheDocument();
    first.focus();
    await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("region", { name: "First?" })).toHaveTextContent("Because.");
    expect(first).toHaveAttribute("aria-controls", screen.getByRole("region", { name: "First?" }).id);
    await user.click(screen.getByRole("button", { name: "Second?" }));
    expect(first).toHaveAttribute("aria-expanded", "true"); // independent panels
    await user.keyboard(" "); // space on the focused (second) button closes it
    expect(screen.getByRole("button", { name: "Second?" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("HomePage", () => {
  it("keeps the required message and routes visitors to signup and login, without invented claims", async () => {
    mockApi({ "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x") });
    renderApp(<HomePage />, { route: "/" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Understand fraud risk. Investigate with confidence.");
    expect(screen.getByText(/Explore transaction risk, investigate model alerts, and compare fraud decision policies in one connected workspace\./)).toBeInTheDocument();
    const start = screen.getAllByRole("link", { name: /get started/i });
    expect(start.length).toBeGreaterThan(1);
    start.forEach((a) => expect(a).toHaveAttribute("href", "/signup"));
    screen.getAllByRole("link", { name: "Log in" }).forEach((a) => expect(a).toHaveAttribute("href", "/login"));
    expect(screen.getAllByRole("link", { name: "Features" })[0]).toHaveAttribute("href", "#features");
    expect(screen.getByText(/illustrative preview with sample values/i)).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/testimonial|trusted by|customers|% accuracy|award|saved \$/i);
  });

  it("offers the workspace to signed-in visitors instead of signup", async () => {
    mockApi({ "GET /auth/me": () => ({ body: { user: { id: 1, email: "a@b.co", created_at: "2026-09-18T00:00:00Z" }, csrf_token: "c", expires_at: "2026-09-19T00:00:00Z" } }) });
    renderApp(<HomePage />, { route: "/" });
    expect((await screen.findAllByRole("link", { name: /open workspace/i })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("answers the FAQ honestly (no bank connection, scores are not probabilities)", async () => {
    mockApi({ "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x") });
    renderApp(<HomePage />, { route: "/" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /connected to a bank/i }));
    expect(await screen.findByText(/nothing here moves money/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /what does the model risk score mean/i }));
    expect(await screen.findByText(/not a probability or a confidence level/i)).toBeInTheDocument();
  });
});
