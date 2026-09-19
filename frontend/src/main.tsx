import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { TooltipProvider } from "./components/ui/misc";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <MotionConfig reducedMotion="user">
            <TooltipProvider delayDuration={150}>
              <App />
            </TooltipProvider>
          </MotionConfig>
          <Toaster position="bottom-right" richColors closeButton />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
