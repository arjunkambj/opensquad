import {
  AiSearchIcon,
  MailSend01Icon,
  Target01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type { EmployeeTemplate } from "../../../convex/lib/validators"
import {
  EMPLOYEE_STATUS_DESCRIPTIONS,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_STYLES,
  deriveEmployeeStatus,
} from "@/components/employees/employee-status"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import { cn } from "@/lib/utils"

const TEMPLATE_META: Record<
  EmployeeTemplate,
  { icon: IconSvgElement; role: string }
> = {
  scout: {
    icon: Target01Icon,
    role: "Finds candidate companies and requests qualified contact enrichment.",
  },
  researcher: {
    icon: AiSearchIcon,
    role: "Researches assigned prospects and records cited observations.",
  },
  outreach: {
    icon: MailSend01Icon,
    role: "Proposes exact drafts and reply classifications for your approval.",
  },
}

const CAPABILITY_LABELS: Record<string, string> = {
  "apollo.company_search": "Apollo company search",
  "apollo.contact_enrichment": "Apollo contact enrichment",
  "opensquad.web_research": "Web research",
  "opensquad.draft_compose": "Draft composing",
  "opensquad.reply_classify": "Reply classification",
}

type EmployeeForm = {
  name: string
  instructions: string
  enabled: boolean
}

function toForm(employee: Doc<"employees">): EmployeeForm {
  return {
    name: employee.name,
    instructions: employee.instructions,
    enabled: employee.enabled,
  }
}

export function EmployeeCard({
  workspaceId,
  employee,
  canEdit,
}: {
  workspaceId: Id<"workspaces">
  employee: Doc<"employees">
  /** owner/operator only — viewers read but never write. */
  canEdit: boolean
}) {
  const updateEmployee = useMutation(api.employees.update)

  const [form, setForm] = useState<EmployeeForm>(() => toForm(employee))
  const [syncedAt, setSyncedAt] = useState(employee.updatedAt)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resync when the record changes underneath us and nothing is being edited
  // (e.g. after a CONFLICT the reactive query delivers the newer record).
  // `updatedAt` is the signal: name/enabled edits don't bump the version.
  if (employee.updatedAt !== syncedAt && !dirty) {
    setSyncedAt(employee.updatedAt)
    setForm(toForm(employee))
  }

  // No runtime endpoint exists yet (P07); status is honestly "disconnected".
  const status = deriveEmployeeStatus(employee, "disconnected")
  const meta = TEMPLATE_META[employee.template]

  const update = (patch: Partial<EmployeeForm>) => {
    setDirty(true)
    setForm({ ...form, ...patch })
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateEmployee({
        workspaceId,
        employeeId: employee._id,
        expectedInstructionVersion: employee.instructionVersion,
        name: form.name,
        instructions: form.instructions,
        enabled: form.enabled,
      })
      setDirty(false)
      toast.add({ title: `${employee.name} updated`, type: "success" })
    } catch (cause) {
      if (isConflictError(cause)) {
        setDirty(false)
        setError(
          "Someone else updated these instructions. The latest version was loaded — review it and save again.",
        )
      } else {
        setError(errorMessage(cause, "Could not update this employee."))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HugeiconsIcon
            icon={meta.icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {employee.name}
        </CardTitle>
        <CardDescription>{meta.role}</CardDescription>
        <CardAction>
          <span
            title={EMPLOYEE_STATUS_DESCRIPTIONS[status]}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              EMPLOYEE_STATUS_STYLES[status],
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", {
                "bg-chart-2": status === "busy",
                "bg-destructive": status === "blocked",
                "bg-muted-foreground":
                  status === "idle" ||
                  status === "disconnected" ||
                  status === "disabled",
              })}
            />
            {EMPLOYEE_STATUS_LABELS[status]}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor={`emp-name-${employee._id}`}>Name</FieldLabel>
          <Input
            id={`emp-name-${employee._id}`}
            readOnly={!canEdit}
            disabled={!canEdit}
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`emp-instructions-${employee._id}`}>
            Instructions{" "}
            <span className="font-normal text-muted-foreground">
              v{employee.instructionVersion}
            </span>
          </FieldLabel>
          <Textarea
            id={`emp-instructions-${employee._id}`}
            readOnly={!canEdit}
            disabled={!canEdit}
            className="min-h-28"
            value={form.instructions}
            onChange={(event) =>
              update({ instructions: event.target.value })
            }
          />
        </Field>
        <label
          className="flex w-fit items-center gap-2 text-sm font-medium"
          htmlFor={`emp-enabled-${employee._id}`}
        >
          <Checkbox
            id={`emp-enabled-${employee._id}`}
            checked={form.enabled}
            disabled={!canEdit}
            onCheckedChange={(checked) =>
              update({ enabled: checked === true })
            }
          />
          Enabled
        </label>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Allowed tools</p>
          <div className="flex flex-wrap gap-1.5">
            {employee.allowedCapabilities.map((capability) => (
              <span
                key={capability}
                className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
              >
                {CAPABILITY_LABELS[capability] ?? capability}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Enforced host policy — read-only. Prompt edits cannot widen tool
            access.
          </p>
        </div>
        <FormError message={error} />
        {canEdit ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? <Spinner data-icon="inline-start" /> : null}
              Save changes
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
