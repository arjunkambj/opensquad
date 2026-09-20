import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * `/tour` is listed as public in PLAN §5 and stays a redirect on purpose.
 *
 * Everything a tour would carry now lives on the landing page and is told
 * once: the five stages with what you do, what the agent does and what each
 * one costs (`#how-it-works`), the controls (`#features`), the order of the
 * first run (`#first-run`), and free versus credits (`#trial`). A second page
 * repeating it would be padding, and two copies of the same claims are two
 * things to keep true. The path keeps working so old links land somewhere.
 */
export const Route = createFileRoute("/tour")({
  beforeLoad: () => {
    throw redirect({ to: "/" })
  },
})
