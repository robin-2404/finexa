import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Activity, ChevronsUpDown, DatabaseZap, FlaskConical, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ScanSearch, ServerCrash, Wifi } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/misc";
import { SimStatusBadge } from "@/components/shared/badges";
import { useDataset, useHealth, useSimulation } from "@/hooks/queries";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Wordmark } from "./Logo";

const NAV = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/monitor", label: "Live Monitor", icon: Activity },
  { to: "/investigation", label: "Investigation", icon: ScanSearch },
  { to: "/patterns", label: "Pattern Lab", icon: FlaskConical },
] as const;

const TITLES: [RegExp, string][] = [
  [/^\/overview/, "Overview"],
  [/^\/monitor/, "Live Monitor"],
  [/^\/investigation\/.+/, "Case investigation"],
  [/^\/investigation/, "Investigation"],
  [/^\/patterns/, "Pattern Lab"],
];
const titleFor = (path: string) => TITLES.find(([re]) => re.test(path))?.[1] ?? "FINEXA";

function NavList({ collapsed, onNavigate, indicatorId }: { collapsed?: boolean; onNavigate?: () => void; indicatorId: string }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
      {!collapsed && (
        <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-shell-text-muted/70">Workspace</p>
      )}
      {NAV.map(({ to, label, icon: Icon }) => (
        <Tooltip key={to} delayDuration={collapsed ? 100 : 100000}>
          <TooltipTrigger asChild>
            <NavLink
              to={to}
              onClick={onNavigate}
              aria-label={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  "group relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-shell-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-shell-navy",
                  isActive ? "text-white" : "text-shell-text-muted hover:bg-shell-elevated/60 hover:text-shell-text",
                  collapsed && "justify-center px-0",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId={indicatorId}
                      className="absolute inset-0 rounded-lg bg-shell-elevated shadow-[inset_2px_0_0_var(--color-shell-accent)]"
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    />
                  )}
                  <Icon className={cn("relative size-[18px] shrink-0", isActive && "text-shell-accent")} aria-hidden strokeWidth={2} />
                  {!collapsed && <span className="relative truncate">{label}</span>}
                </>
              )}
            </NavLink>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">{label}</TooltipContent>}
        </Tooltip>
      ))}
    </nav>
  );
}

function ConnectionPill() {
  const health = useHealth();
  if (health.isError) {
    return (
      <Badge tone="red" title="The health check failed">
        <ServerCrash aria-hidden /> Backend offline
      </Badge>
    );
  }
  if (health.isPending) return <Badge tone="neutral">Connecting…</Badge>;
  if (!health.data.ready) {
    return (
      <Badge tone="amber" title={health.data.reasons.join("; ")}>
        <DatabaseZap aria-hidden /> Model not ready
      </Badge>
    );
  }
  return (
    <Badge tone="green" title={`Model ${health.data.model_version}`}>
      <Wifi aria-hidden /> Backend connected
    </Badge>
  );
}

function SimulationPill() {
  const sim = useSimulation();
  if (!sim.data) return null;
  return (
    <Link to="/monitor" className="rounded-md" aria-label={`Simulation ${sim.data.status}, open Live Monitor`}>
      <SimStatusBadge status={sim.data.status} />
    </Link>
  );
}

function DatasetChip() {
  const ds = useDataset();
  if (!ds.data) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="hidden max-w-64 items-center gap-2 truncate rounded-md border border-shell-border bg-shell-elevated px-2.5 py-1 text-xs text-shell-text-muted xl:inline-flex">
          <span className="truncate font-medium text-shell-text">{ds.data.source_file}</span>
          <span className="tabular shrink-0">{formatInt(ds.data.rows)} rows</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Historical dataset · SHA-256 {ds.data.fingerprint_sha256.slice(0, 12)}… · {formatInt(ds.data.class_counts.fraud)} known fraud records
      </TooltipContent>
    </Tooltip>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const initial = (user?.email ?? "?").charAt(0).toUpperCase();
  async function onLogout() {
    setBusy(true);
    await logout();
    toast.success("Signed out");
    navigate("/", { replace: true });
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md border border-shell-border bg-shell-elevated py-1 pl-1 pr-2 text-sm text-shell-text outline-none transition-colors hover:bg-shell-elevated/70 focus-visible:ring-2 focus-visible:ring-shell-accent/60"
          aria-label="Account menu"
        >
          <span className="grid size-7 place-items-center rounded bg-shell-navy text-xs font-semibold text-shell-accent" aria-hidden>{initial}</span>
          <span className="hidden max-w-40 truncate text-[13px] md:inline">{user?.email}</span>
          <ChevronsUpDown className="size-3.5 text-shell-text-muted" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          Signed in as
          <span className="block truncate text-sm font-medium text-foreground">{user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); if (!busy) void onLogout(); }} disabled={busy}>
          <LogOut aria-hidden /> {busy ? "Signing out…" : "Log out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HealthBanner() {
  const health = useHealth();
  if (health.isError) {
    return (
      <div role="alert" className="mb-5 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        <ServerCrash className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">The FINEXA backend is not reachable.</p>
          <p className="text-[13px]">Data below may be unavailable until it is running again. Start it with <code>uvicorn app.main:app --port 8000</code> in <code>backend/</code>.</p>
        </div>
      </div>
    );
  }
  return null;
}

/** Shown instead of a page when the backend reports it can't serve data (e.g. the model was never trained). */
function NotReadyPanel() {
  const health = useHealth();
  return (
    <div role="alert" className="mx-auto mt-10 max-w-xl rounded-lg border bg-card p-8 text-center shadow-card">
      <div className="mx-auto grid size-11 place-items-center rounded-full bg-warning-soft text-warning"><DatabaseZap className="size-5" aria-hidden /></div>
      <h1 className="mt-4 text-lg font-semibold">The model isn't ready</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The backend is running, but it can't serve data yet: {(health.data?.reasons.join("; ") || "model artifacts are missing").replace(/\.+$/, "")}.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Train the model, then restart the API: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">python -m app.ml.train</code> (run from <code className="rounded bg-muted px-1.5 py-0.5 text-xs">backend/</code>).
      </p>
      <Button variant="secondary" className="mt-5" onClick={() => void health.refetch()} loading={health.isFetching}>Check again</Button>
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("finexa.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false);
  const title = titleFor(location.pathname);
  const health = useHealth();
  const notReady = !!health.data && !health.data.ready;

  useEffect(() => {
    try {
      localStorage.setItem("finexa.sidebar", collapsed ? "collapsed" : "expanded");
    } catch {
      /* preference only */
    }
  }, [collapsed]);
  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => {
    document.title = `${title} · FINEXA`;
  }, [title]);

  return (
    <div className="min-h-dvh bg-background">
      <a href="#main" className="skip-link">Skip to content</a>

      <aside
        className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-shell-border bg-shell-navy transition-[width] duration-200 lg:flex", collapsed ? "w-[68px]" : "w-[248px]")}
        aria-label="Sidebar"
      >
        <div className={cn("flex h-16 items-center border-b border-shell-border", collapsed ? "justify-center" : "px-5")}>
          <Link to="/overview" aria-label="FINEXA overview" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/60">
            {collapsed ? <Wordmark className="[&>span:last-child]:hidden" dark /> : <Wordmark dark />}
          </Link>
        </div>
        <div className="mt-4 flex-1"><NavList collapsed={collapsed} indicatorId="nav-active-desktop" /></div>
        <div className={cn("border-t border-shell-border p-3", collapsed && "flex justify-center")}>
          <Button
            variant="ghost" size={collapsed ? "icon" : "sm"}
            className="w-full justify-start text-shell-text-muted hover:bg-shell-elevated hover:text-shell-text data-[c=true]:w-9"
            data-c={collapsed}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
          >
            {collapsed ? <PanelLeftOpen /> : <><PanelLeftClose /> Collapse</>}
          </Button>
        </div>
      </aside>

      <Dialog open={drawer} onOpenChange={setDrawer}>
        <DialogContent side="left" className="border-r border-shell-border bg-shell-navy text-shell-text" hideClose aria-describedby={undefined}>
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="flex h-16 items-center border-b border-shell-border px-5"><Wordmark dark /></div>
          <div className="mt-4"><NavList onNavigate={() => setDrawer(false)} indicatorId="nav-active-drawer" /></div>
        </DialogContent>
      </Dialog>

      <div className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-[68px]" : "lg:pl-[248px]")}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-shell-border bg-shell-surface/95 px-4 text-shell-text backdrop-blur md:px-6">
          <Button
            variant="ghost" size="icon"
            className="text-shell-text-muted hover:bg-shell-elevated hover:text-shell-text lg:hidden"
            onClick={() => setDrawer(true)} aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-shell-text" aria-live="polite">{title}</p>
          <DatasetChip />
          <div className="hidden items-center gap-2 sm:flex">
            <ConnectionPill />
            <SimulationPill />
          </div>
          <AccountMenu />
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b border-shell-border bg-shell-surface px-4 py-2 sm:hidden">
          <ConnectionPill />
          <SimulationPill />
        </div>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] px-4 py-6 outline-none md:px-8 md:py-8">
          <HealthBanner />
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
            {notReady ? <NotReadyPanel /> : <Outlet />}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
