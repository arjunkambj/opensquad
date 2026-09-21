import { ArrowUp02Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { useReducedMotion } from "motion/react"
import { useEffect, useState } from "react"
import { FlameScore } from "@/components/kit/FlameScore"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const examplePrompts = [
  "Which companies hiring marketers match my profile?",
  "Find recently funded SaaS companies hiring for sales.",
  "Show me this week's replies and what needs my approval.",
] as const

function ChatPreview() {
  const [promptIndex, setPromptIndex] = useState(0)
  const [prompt, setPrompt] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [hasEdited, setHasEdited] = useState(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (reduceMotion || isFocused || hasEdited) return
    const fullPrompt = examplePrompts[promptIndex]
    if (!fullPrompt) return

    const isComplete = prompt === fullPrompt
    const delay = isComplete && !isDeleting ? 2400 : isDeleting ? 24 : 55
    const timeout = window.setTimeout(() => {
      if (isDeleting && prompt.length === 0) {
        setIsDeleting(false)
        setPromptIndex((promptIndex + 1) % examplePrompts.length)
      } else if (isDeleting) {
        setPrompt(prompt.slice(0, -1))
      } else if (isComplete) {
        setIsDeleting(true)
      } else {
        setPrompt(fullPrompt.slice(0, prompt.length + 1))
      }
    }, delay)

    return () => window.clearTimeout(timeout)
  }, [hasEdited, isDeleting, isFocused, prompt, promptIndex, reduceMotion])

  function showNextPrompt() {
    setPromptIndex((promptIndex + 1) % examplePrompts.length)
    setPrompt("")
    setIsDeleting(false)
    setHasEdited(false)
  }

  return (
    <div className="relative flex h-[480px] flex-col justify-end overflow-hidden rounded-2xl p-5 pb-12 sm:p-8 sm:pb-15">
      <img
        alt=""
        className="absolute inset-0 size-full object-cover object-bottom"
        decoding="async"
        loading="eager"
        src="/marketing/backgrounds/forest-peach.webp"
      />
      <div
        aria-hidden="true"
        className="absolute inset-3 rounded-xl border border-background/40"
      />
      <div className="relative flex flex-col gap-3">
        <div className="relative rounded-marketing-panel bg-popover p-2 text-popover-foreground panel-shadow">
          <Textarea
            aria-label="Example sales prompt"
            onBlur={() => setIsFocused(false)}
            onChange={(event) => {
              setPrompt(event.target.value)
              setHasEdited(true)
            }}
            onFocus={() => setIsFocused(true)}
            placeholder="Ask about your leads…"
            rows={2}
            value={reduceMotion && !hasEdited ? examplePrompts[promptIndex] : prompt}
          />
          <div className="flex items-center gap-2 px-1 pt-1 pb-1">
            <Button
              aria-label="Show another example prompt"
              onClick={showNextPrompt}
              size="icon-sm"
              variant="ghost"
            >
              <HugeiconsIcon icon={PlusSignIcon} />
            </Button>
            <span className="text-xs text-muted-foreground">
              Nothing sends without your approval
            </span>
            <Button
              aria-label="Get started"
              className="ml-auto"
              nativeButton={false}
              render={<Link to="/sign-in" />}
              size="icon-sm"
            >
              <HugeiconsIcon icon={ArrowUp02Icon} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const stats: { highlight?: boolean; label: string; value: string }[] = [
  { label: "Found", value: "25" },
  { label: "Researched", value: "8" },
  { highlight: true, label: "Replies", value: "3" },
]

const leads = [
  {
    company: "at a 200-person SaaS company",
    role: "VP Marketing",
    score: 3,
    signal: "Hiring marketers",
    status: "Review",
  },
  {
    company: "at a 50-person SaaS company",
    role: "Head of Sales",
    score: 2,
    signal: "Recently funded",
    status: "Approved",
  },
  {
    company: "at a 30-person software company",
    role: "Founder",
    score: 2,
    signal: "Hiring marketers",
    status: "Review",
  },
] as const

export function HeroDashboardPreview() {
  return (
    <div className="w-full overflow-hidden rounded-2xl bg-background text-foreground shadow-xl shadow-foreground/10">
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-2xl tracking-tight">
            Leads this week
          </h3>
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Schematic
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {stats.map((stat) => (
            <Card key={stat.label} size="sm">
              <CardHeader>
                <CardTitle>{stat.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <span
                  className={cn(
                    "font-semibold text-2xl leading-none sm:text-3xl",
                    stat.highlight && "text-illustration-positive",
                  )}
                >
                  {stat.value}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
        <Table aria-label="Schematic pipeline: anonymous example leads">
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead className="hidden sm:table-cell">Signal</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.role}>
                <TableCell>
                  <p className="font-medium">{lead.role}</p>
                  <p className="text-xs text-muted-foreground">
                    {lead.company}
                  </p>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant="secondary">{lead.signal}</Badge>
                </TableCell>
                <TableCell>
                  <FlameScore status="researched" score={lead.score} />
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      lead.status === "Approved" ? "default" : "secondary"
                    }
                  >
                    {lead.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          Illustrative figures, not results.
        </p>
      </div>
    </div>
  )
}

export function HeroShowcase() {
  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.7fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <ChatPreview />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="relative overflow-hidden rounded-2xl bg-accent p-5 pt-12 sm:h-[480px] sm:pt-15 sm:pl-12">
          <img
            alt=""
            className="absolute inset-0 size-full object-cover object-bottom"
            decoding="async"
            loading="eager"
            src="/marketing/backgrounds/forest-peach.webp"
          />
          <div className="relative rounded-t-marketing-preview bg-background/40 p-3 backdrop-blur-md sm:translate-x-3 lg:w-[calc(100%+5rem)]">
            <HeroDashboardPreview />
          </div>
        </div>
      </div>
    </div>
  )
}
