import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { PublicOnly, RequireAuth, FullPageStatus } from "@/auth/guards";
import { AppShell } from "@/components/layout/AppShell";
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/auth/LoginPage";
import { SignupPage } from "@/pages/auth/SignupPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { Skeleton } from "@/components/ui/misc";

// Workspace pages (charts included) load on demand so the public pages stay light.
const OverviewPage = lazy(() => import("@/pages/OverviewPage").then((m) => ({ default: m.OverviewPage })));
const MonitorPage = lazy(() => import("@/pages/MonitorPage").then((m) => ({ default: m.MonitorPage })));
const InvestigationPage = lazy(() => import("@/pages/InvestigationPage").then((m) => ({ default: m.InvestigationPage })));
const TransactionDetailPage = lazy(() => import("@/pages/TransactionDetailPage").then((m) => ({ default: m.TransactionDetailPage })));
const PatternsPage = lazy(() => import("@/pages/PatternsPage").then((m) => ({ default: m.PatternsPage })));

function PageFallback() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading page">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<FullPageStatus label="Loading…" />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/overview" element={<Suspense fallback={<PageFallback />}><OverviewPage /></Suspense>} />
            <Route path="/monitor" element={<Suspense fallback={<PageFallback />}><MonitorPage /></Suspense>} />
            <Route path="/investigation" element={<Suspense fallback={<PageFallback />}><InvestigationPage /></Suspense>} />
            <Route path="/investigation/:transactionId" element={<Suspense fallback={<PageFallback />}><TransactionDetailPage /></Suspense>} />
            <Route path="/patterns" element={<Suspense fallback={<PageFallback />}><PatternsPage /></Suspense>} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
