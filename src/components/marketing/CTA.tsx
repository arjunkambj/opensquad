import {
  ArrowUpRight01Icon,
  CoinsDollarIcon,
  StarIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import { Chip } from "@/components/kit/Chip"
import { FlameScore } from "@/components/kit/FlameScore"
import { StatCard } from "@/components/kit/StatCard"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/marketing/motion-variants"
import {
  AppPreview,
  ScaledFrame,
} from "@/components/marketing/preview/AppPreview"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const found = [
  { title: "VP Marketing", detail: "SaaS company, 200 people", score: 3, signal: "Hiring" },
  { title: "Head of Growth", detail: "Analytics company, 80 people", score: 3, signal: "Funded" },
  { title: "Founder", detail: "Software company, 30 people", score: 2, signal: "Headcount" },
  { title: "Head of Sales", detail: "Fintech startup, 50 people", score: 2, signal: "Hiring" },
  { title: "COO", detail: "Logistics startup, 120 people", score: 2, signal: "Funded" },
] as const

/**
 * The copy promises "see who it finds"; this is the first run's page, drawn
 * at full size and scaled so it bleeds off the frame like a real screen.
 */
function FoundPreview() {
  return (
    <AppPreview className="overflow-hidden rounded-2xl shadow-xl shadow-foreground/10">
      <ScaledFrame height={820} width={900}>
        <div className="flex size-full flex-col gap-6 bg-panel p-8 text-foreground">
          <div className="flex flex-col gap-1">
            <p className="font-heading text-2xl font-semibold">
              Found for yourcompany.com
            </p>
            <p className="text-sm text-muted-foreground">
              Your first run, researched and scored.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <StatCard icon={UserMultipleIcon} label="Leads found" value="25" />
            <StatCard icon={StarIcon} label="Hot leads" value="6" />
            <StatCard icon={CoinsDollarIcon} label="Credits left" value="260" />
          </div>
          <div className="overflow-hidden rounded-2xl bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Signal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {found.map((lead) => (
                  <TableRow key={lead.title}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{lead.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {lead.detail}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <FlameScore score={lead.score} status="researched" />
                    </TableCell>
                    <TableCell>
                      <Chip variant="accent">{lead.signal}</Chip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </ScaledFrame>
    </AppPreview>
  )
}

export function CTA() {
  const revealViewport = useRevealViewport()

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <motion.section
        className="grid overflow-hidden rounded-marketing-section bg-card text-card-foreground md:min-h-[28rem] md:grid-cols-[1.1fr_1fr]"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        <div className="flex flex-col items-start justify-center gap-4 p-8 sm:p-10 lg:p-12">
          <motion.p
            className="text-sm text-muted-foreground"
            variants={revealItemVariants}
          >
            Get started
          </motion.p>
          <motion.h2
            className="max-w-lg font-bold tracking-tight text-balance display-xs sm:display-sm lg:display-md"
            variants={revealItemVariants}
          >
            Give it your website and see who it finds.
          </motion.h2>
          <motion.p
            className="max-w-md text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg"
            variants={revealItemVariants}
          >
            300 free credits, no card. Nothing sends until you say so.
          </motion.p>
          <motion.div className="mt-2" variants={revealItemVariants}>
            <Button
              nativeButton={false}
              render={<Link to="/sign-in" />}
              size="cta"
            >
              Get started
              <HugeiconsIcon
                aria-hidden="true"
                data-icon="inline-end"
                icon={ArrowUpRight01Icon}
              />
            </Button>
          </motion.div>
        </div>
        <motion.div
          aria-hidden="true"
          className="relative min-h-[27rem] overflow-hidden md:min-h-0"
          variants={revealItemVariants}
        >
          <img
            alt=""
            className="absolute inset-0 size-full object-cover object-bottom"
            decoding="async"
            loading="lazy"
            src="/marketing/backgrounds/forest-peach.webp"
          />
          <div className="absolute top-10 left-10 w-[calc(100%+6rem)] rounded-t-marketing-preview bg-background/40 p-3 backdrop-blur-md sm:top-12 sm:left-14">
            <FoundPreview />
          </div>
        </motion.div>
      </motion.section>
    </div>
  )
}
