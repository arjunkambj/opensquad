import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { HexclaveProvider, HexclaveTheme } from "@hexclave/react";
import "./index.css";
import { ConvexClientProvider } from "./components/ConvexClientProvider";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/toast";
import { hexclaveClientApp } from "./hexclave/client";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div>Loading...</div>}>
      <HexclaveProvider app={hexclaveClientApp}>
        <ConvexClientProvider>
          <HexclaveTheme>
            <ThemeProvider>
              <Toaster>
                <RouterProvider router={router} />
              </Toaster>
            </ThemeProvider>
          </HexclaveTheme>
        </ConvexClientProvider>
      </HexclaveProvider>
    </Suspense>
  </StrictMode>,
);
