import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * `/tour` is a permanent redirect into the landing page's own tour, and not a
 * screen of its own.
 *
 * PLAN §5 lists it beside `/` as public marketing, which it still is — but
 * everything a tour would carry now lives on the landing page and is told
 * once: the five stages with what you do, what the agent does and what each
 * one costs (`#how-it-works`), the controls (`#features`), the order of the
 * first run (`#first-run`), and free versus credits (`#trial`). A second page
 * repeating it would be padding, and two copies of the same claims are two
 * things to keep true — the kind of drift items like "Review is the default"
 * come from.
 *
 * So the path keeps working and now lands on the tour itself rather than at
 * the top of the page, which is what someone following a `/tour` link asked
 * for. PLAN §5 should say `/tour` → `/#how-it-works` instead of implying a
 * separate screen.
 */
export const Route = createFileRoute("/tour")({
  beforeLoad: () => {
    throw redirect({ to: "/", hash: "how-it-works" })
  },
})
