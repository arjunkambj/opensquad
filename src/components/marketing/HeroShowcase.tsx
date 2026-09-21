import {
  ArrowRight01Icon,
  AudioLinesIcon,
  Calendar03Icon,
  ChartLineData01Icon,
  InboxIcon,
  MailSend01Icon,
  StarIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Chip, type ChipVariant } from "@/components/kit/Chip"
import { FlameScore } from "@/components/kit/FlameScore"
import { FramedPanel } from "@/components/kit/FramedPanel"
import { StatCard } from "@/components/kit/StatCard"
import {
  AppPreview,
  PreviewMat,
  PreviewRow,
  PreviewShell,
  ScaledFrame,
} from "@/components/marketing/preview/AppPreview"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const stats = [
  { label: "Hot leads", icon: StarIcon, value: "12", sublabel: "Researched and scored 3 of 3" },
  { label: "Contacted", icon: MailSend01Icon, value: "48", sublabel: "61 emails accepted for delivery" },
  { label: "Conversations", icon: InboxIcon, value: "9", sublabel: "Threads someone replied in" },
  { label: "Meetings", icon: Calendar03Icon, value: "3", sublabel: "Confirmed by you · 2 proposed" },
] as const

const hotLeads = [
  { title: "VP Marketing", detail: "SaaS company, 200 people" },
  { title: "Head of Sales", detail: "Fintech startup, 50 people" },
  { title: "Founder", detail: "Software company, 30 people" },
] as const

const replies: { title: string; detail: string; label: string; variant: ChipVariant }[] = [
  { title: "Head of Growth", detail: "Analytics company · 2h ago", label: "Interested", variant: "accent" },
  { title: "COO", detail: "Logistics startup · 5h ago", label: "Question", variant: "accent" },
  { title: "VP Sales", detail: "HR software · Yesterday", label: "Not now", variant: "muted" },
]

/** Fourteen days of made-up activity, one point per day. */
const activity = {
  days: ["8 Sep", "", "", "", "", "", "", "15 Sep", "", "", "", "", "", "21 Sep"],
  series: [
    { label: "Leads created", line: "stroke-chart-1", area: "fill-chart-1/10", dot: "bg-chart-1", values: [4, 6, 5, 9, 8, 12, 10, 14, 13, 17, 15, 19, 18, 22] },
    { label: "Contacted", line: "stroke-chart-2", area: "fill-chart-2/10", dot: "bg-chart-2", values: [1, 2, 3, 3, 5, 4, 6, 7, 6, 9, 8, 10, 11, 12] },
    { label: "Replies", line: "stroke-chart-4", area: "fill-chart-4/10", dot: "bg-chart-4", values: [0, 0, 1, 0, 1, 2, 1, 1, 2, 3, 2, 3, 4, 4] },
  ],
} as const

const PLOT = { width: 600, height: 150, max: 24 }

function ActivityPreview() {
  const x = (index: number) =>
    (index / (activity.days.length - 1)) * PLOT.width
  const y = (value: number) => PLOT.height - (value / PLOT.max) * PLOT.height

  return (
    <FramedPanel
      icon={ChartLineData01Icon}
      title="Activity"
      action={
        <div className="flex items-center gap-4">
          {activity.series.map((series) => (
            <span
              key={series.label}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span className={`size-2 rounded-full ${series.dot}`} />
              {series.label}
            </span>
          ))}
        </div>
      }
      bodyClassName="gap-2"
    >
      <svg
        className="block h-48 w-full"
        preserveAspectRatio="none"
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
      >
        {[0, 8, 16, 24].map((tick) => (
          <line
            key={tick}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            x1={0}
            x2={PLOT.width}
            y1={y(tick)}
            y2={y(tick)}
          />
        ))}
        {activity.series.map((series) => {
          const points = series.values.map((value, index) => `${x(index)},${y(value)}`)
          return (
            <g key={series.label}>
              <polygon
                className={series.area}
                points={`0,${PLOT.height} ${points.join(" ")} ${PLOT.width},${PLOT.height}`}
              />
              <polyline
                className={series.line}
                fill="none"
                points={points.join(" ")}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between text-2xs text-muted-foreground">
        {activity.days
          .filter((day) => day !== "")
          .map((day) => (
            <span key={day}>{day}</span>
          ))}
      </div>
    </FramedPanel>
  )
}

export function HeroDashboardPreview() {
  return (
    <AppPreview className="overflow-hidden rounded-2xl">
      <ScaledFrame height={900} width={1440}>
      <PreviewShell
        active="/overview"
        badges={{ "/inbox": "4", "/billing": "240" }}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-heading text-2xl font-semibold text-foreground">
              Welcome back, Maya
            </p>
            <p className="text-sm text-muted-foreground">
              What your agent has been doing, in the window you pick.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline">
              <HugeiconsIcon
                className="text-primary"
                data-icon="inline-start"
                icon={AudioLinesIcon}
              />
              3 active signals
            </Button>
            <Button size="sm" variant="outline">
              <HugeiconsIcon
                className="text-primary"
                data-icon="inline-start"
                icon={InboxIcon}
              />
              Inbox connected
            </Button>
          </div>
        </header>

        <div className="flex justify-end">
          <Tabs defaultValue="14d">
            <TabsList>
              <TabsTrigger value="7d">7 days</TabsTrigger>
              <TabsTrigger value="14d">14 days</TabsTrigger>
              <TabsTrigger value="30d">30 days</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {stats.map((stat) => (
            <StatCard
              key={stat.label}
              icon={stat.icon}
              label={stat.label}
              sublabel={stat.sublabel}
              value={stat.value}
            />
          ))}
        </div>

        <ActivityPreview />

        <div className="grid grid-cols-2 gap-4">
          <FramedPanel
            icon={UserGroupIcon}
            title="Latest hot leads"
            action={
              <Button size="xs" variant="ghost">
                View more
                <HugeiconsIcon data-icon="inline-end" icon={ArrowRight01Icon} />
              </Button>
            }
            bodyClassName="p-0 py-1"
          >
            <ul className="flex flex-col">
              {hotLeads.map((lead) => (
                <PreviewRow
                  key={lead.title}
                  detail={lead.detail}
                  end={<FlameScore score={3} status="researched" />}
                  title={lead.title}
                />
              ))}
            </ul>
          </FramedPanel>
          <FramedPanel
            icon={InboxIcon}
            title="Latest replies"
            action={
              <Button size="xs" variant="ghost">
                Open inbox
              </Button>
            }
            bodyClassName="p-0 py-1"
          >
            <ul className="flex flex-col">
              {replies.map((reply) => (
                <PreviewRow
                  key={reply.title}
                  detail={reply.detail}
                  end={<Chip variant={reply.variant}>{reply.label}</Chip>}
                  title={reply.title}
                />
              ))}
            </ul>
          </FramedPanel>
        </div>
      </PreviewShell>
      </ScaledFrame>
    </AppPreview>
  )
}

export function HeroShowcase() {
  return (
    <figure className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-2xl bg-accent p-3 sm:p-8 lg:p-12">
        <img
          alt=""
          className="absolute inset-0 size-full object-cover object-bottom"
          decoding="async"
          loading="eager"
          src="/marketing/backgrounds/forest-peach.webp"
        />
        <PreviewMat className="relative">
          <HeroDashboardPreview />
        </PreviewMat>
      </div>
      <figcaption className="text-xs text-muted-foreground">
        The OpenIntent overview. Illustrative figures, not results.
      </figcaption>
    </figure>
  )
}
