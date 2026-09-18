import { useUser } from "@hexclave/react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import { EmptyState, FormError, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { errorMessage } from "@/lib/convex-error"

/**
 * `/tour` — the P16 public demo surface. Everything renders from the
 * flag-gated `demo.tour` / `demo.executionStatus` read models: when the
 * deployment flags are off this page shows an honest "not enabled" state and
 * exposes no workspace data or controls. The opt-in button calls
 * `demo.optIn`, which creates the visitor's own isolated `demoMode`
 * workspace — quotas, the recipient allowlist and human approval still apply
 * there exactly as in a normal workspace.
 */
export const Route = createFileRoute("/_marketing/tour")({
  component: TourPage,
})

function TourPage() {
  const tour = useQuery(api.demo.tour)
  const status = useQuery(api.demo.executionStatus)

  if (tour === undefined || status === undefined) {
    return (
      <main className="flex w-full flex-col px-6 py-24">
        <LoadingState
          className="mx-auto w-full max-w-3xl"
          title="Loading the tour"
        />
      </main>
    )
  }

  if (!tour.enabled) {
    return (
      <main className="flex w-full flex-col px-6 py-24">
        <EmptyState
          className="mx-auto w-full max-w-3xl"
          title="The public tour isn't enabled on this deployment"
          description="This deployment hasn't opened its read-only demo. You can still sign in to your own workspace."
          action={<Button render={<Link to="/sign-in" />}>Sign in</Button>}
        />
      </main>
    )
  }

  return (
    <main className="flex w-full flex-col px-6 py-24">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <header className="flex flex-col gap-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Prepared demo data — sanitized read-only tour
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Watch a supervised sales squad work
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Scout discovers, the Researcher finds source-backed evidence,
            Outreach drafts — and a human approves every word before anything
            sends. This tour shows prepared, sanitized examples; no real
            workspace or customer data appears here.
          </p>
        </header>

        <ol className="flex flex-col gap-4">
          {tour.steps.map((step) => (
            <li key={step.stage}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{step.title}</CardTitle>
                  <CardDescription>
                    {step.route} · {step.stage}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">{step.body}</p>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg border border-dashed border-border bg-muted/40 p-4 text-xs sm:grid-cols-2">
                    {Object.entries(step.artifact).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <dt className="shrink-0 font-medium text-muted-foreground">
                          {key}
                        </dt>
                        <dd className="min-w-0 truncate">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Honest limits</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>At most {tour.limits.leadsPerCampaign} leads per campaign</li>
              <li>One shared inbox per workspace</li>
              <li>Meetings are confirmed by a human, never inferred</li>
              <li>No calendar synchronization</li>
            </ul>
          </CardContent>
        </Card>

        <DemoOptIn executionEnabled={status.executionEnabled} />
      </div>
    </main>
  )
}

function DemoOptIn({ executionEnabled }: { executionEnabled: boolean }) {
  const user = useUser()
  const navigate = useNavigate()
  const optIn = useMutation(api.demo.optIn)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!executionEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Try it live</CardTitle>
          <CardDescription>
            Hands-on demo execution is not enabled on this deployment — it
            needs a funded runtime and a release decision. Ask the team to
            open the opt-in when it is ready.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const start = async () => {
    setPending(true)
    setError(null)
    try {
      await optIn({})
      await navigate({ to: "/overview" })
    } catch (err) {
      setError(errorMessage(err, "Could not start the demo."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Try it live — isolated demo</CardTitle>
        <CardDescription>
          Opt in to get your own isolated demo workspace: strict send and run
          quotas, a fixed recipient allowlist, and a human approval before
          anything sends. Execution stays gated until a shared demo runtime
          is funded.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FormError message={error} />
        {user ? (
          <Button onClick={() => void start()} disabled={pending}>
            {pending ? "Preparing your demo workspace…" : "Start the isolated demo"}
          </Button>
        ) : (
          <Button render={<Link to="/sign-in" />}>
            Sign in to start the isolated demo
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
