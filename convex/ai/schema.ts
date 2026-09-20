/**
 * One schema source for every AI task (PLAN §4: "schema-constrained … and
 * re-validated with Convex validators before any write").
 *
 * A task declares the shape of its result ONCE, as a Convex validator. This
 * file derives the strict JSON Schema the gateway is given from that same
 * validator, and parses the model's answer back through it. Two shapes that
 * could drift apart never exist, and no schema library is added.
 *
 * What "strict" means on the wire, and why the mapping is not one to one:
 *   - every object lists ALL of its properties in `required` and sets
 *     `additionalProperties: false` — strict mode has no optional property;
 *   - so a `v.optional(x)` field is sent as required-and-NULLABLE, and the
 *     null is mapped back to *absent* in `parseStructured` before the Convex
 *     validator sees it. That is the only asymmetry, and it lives here.
 *
 * Anything the mapping cannot express throws — loudly, with the path that
 * caused it. Declare the result validator at module scope in the task file
 * and the throw happens when the module loads, not in front of a user.
 */
import type { JSONSchema7 } from "ai";
import { validate } from "convex-helpers/validators";
import type { GenericValidator, Infer, Validator } from "convex/values";

/** The JSON types this mapping produces. */
type SimpleType = "object" | "array" | "string" | "number" | "boolean" | "null";

/** A literal value a schema can pin with `enum`. */
type LiteralValue = string | number | boolean;

function unsupported(path: string, what: string): never {
  throw new Error(
    `convex/ai: ${path} cannot be expressed as a strict JSON schema — ${what}`,
  );
}

function literalNode(value: unknown, path: string): JSONSchema7 {
  if (typeof value === "string") {
    return { type: "string", enum: [value] };
  }
  if (typeof value === "number") {
    return { type: "number", enum: [value] };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", enum: [value] };
  }
  return unsupported(path, "a literal that is not a string, number or boolean");
}

/**
 * A union is only expressible as a JSON `enum`, so every member must be a
 * literal (or `v.null()`). A union of objects would need `anyOf`, which
 * strict mode accepts only in narrow forms — a task that needs one should say
 * so rather than get a schema that quietly means something else.
 */
function unionNode(members: readonly GenericValidator[], path: string): JSONSchema7 {
  if (members.length === 0) {
    return unsupported(path, "an empty union");
  }
  const values: Array<LiteralValue | null> = [];
  const types: SimpleType[] = [];
  for (const member of members) {
    if (member.kind === "null") {
      values.push(null);
      if (!types.includes("null")) {
        types.push("null");
      }
      continue;
    }
    if (member.kind !== "literal") {
      return unsupported(path, "a union whose members are not all literals");
    }
    const node = literalNode(member.value, path);
    const type = node.type;
    if (typeof type !== "string") {
      return unsupported(path, "a literal of an unmappable type");
    }
    values.push(member.value as LiteralValue);
    if (!types.includes(type as SimpleType)) {
      types.push(type as SimpleType);
    }
  }
  return { type: types.length === 1 ? types[0] : types, enum: values };
}

/** Widen a node so the model may answer `null` — how an OPTIONAL field is
 *  carried through a schema that has no optional properties. */
function nullableNode(node: JSONSchema7, path: string): JSONSchema7 {
  const type = node.type;
  if (type === "null") {
    return node;
  }
  if (typeof type !== "string") {
    return unsupported(
      path,
      "an optional value whose type is not a single JSON type",
    );
  }
  const widened: JSONSchema7 = { ...node, type: [type, "null"] };
  if (node.enum !== undefined) {
    widened.enum = [...node.enum, null];
  }
  return widened;
}

function objectNode(
  fields: Record<string, GenericValidator>,
  path: string,
): JSONSchema7 {
  const names = Object.keys(fields);
  if (names.length === 0) {
    return unsupported(path, "an object with no fields");
  }
  const properties: Record<string, JSONSchema7> = {};
  for (const name of names) {
    const field = fields[name];
    const childPath = `${path}.${name}`;
    const child = jsonSchemaNode(field, childPath);
    properties[name] =
      field.isOptional === "optional" ? nullableNode(child, childPath) : child;
  }
  return {
    type: "object",
    properties,
    // Strict mode: every property is required, and nothing else may appear.
    required: names,
    additionalProperties: false,
  };
}

function jsonSchemaNode(validator: GenericValidator, path: string): JSONSchema7 {
  switch (validator.kind) {
    case "string":
      return { type: "string" };
    case "float64":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "null":
      return { type: "null" };
    case "literal":
      return literalNode(validator.value, path);
    case "array":
      return {
        type: "array",
        items: jsonSchemaNode(validator.element, `${path}[]`),
      };
    case "object":
      return objectNode(validator.fields, path);
    case "union":
      return unionNode(validator.members, path);
    default:
      return unsupported(path, `${validator.kind} values`);
  }
}

/**
 * The strict JSON Schema for one AI task's result. The root must be an
 * object: the gateway's `json_schema` response format has no other root, and
 * a bare array or scalar answer is far harder for a model to keep on shape.
 */
export function strictJsonSchema(validator: GenericValidator): JSONSchema7 {
  if (validator.kind !== "object") {
    return unsupported("the result validator", "its root is not an object");
  }
  return objectNode(validator.fields, "result");
}

/** `null` back to absent, wherever the validator said the field is optional. */
function mapNullsToAbsent(validator: GenericValidator, value: unknown): unknown {
  if (validator.kind === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const source = value as Record<string, unknown>;
    const mapped: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(validator.fields)) {
      if (!(name in source)) {
        continue;
      }
      const child = source[name];
      if (field.isOptional === "optional" && child === null) {
        continue;
      }
      mapped[name] = mapNullsToAbsent(field, child);
    }
    return mapped;
  }
  if (validator.kind === "array") {
    if (!Array.isArray(value)) {
      return value;
    }
    const element = validator.element;
    return value.map((item) => mapNullsToAbsent(element, item));
  }
  return value;
}

/**
 * The gateway's object, re-validated with the SAME Convex validator that
 * produced the schema — the check PLAN §4 requires before any write. A model
 * that answers off-shape (or a gateway that ever stops enforcing the schema)
 * gets `null` here, never a half-typed object in the database.
 */
export function parseStructured<T extends Validator<unknown, "required", string>>(
  validator: T,
  raw: unknown,
): Infer<T> | null {
  const mapped = mapNullsToAbsent(validator, raw);
  try {
    return validate(validator, mapped) ? (mapped as Infer<T>) : null;
  } catch {
    return null;
  }
}
