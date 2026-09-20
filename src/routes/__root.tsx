import { Outlet, createRootRoute } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import { RootErrorState } from "@/components/states/RootErrorState"
import { RootNotFoundState } from "@/components/states/RootNotFoundState"

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootErrorState,
  notFoundComponent: RootNotFoundState,
})

function RootLayout() {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
    </>
  )
}
