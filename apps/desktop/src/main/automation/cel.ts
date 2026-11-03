import { Environment } from "@marcbachmann/cel-js";
import path from "node:path";
import type { PineJsonValue } from "../../shared/agent";
import { formatDate, isWorkday } from "./time";

const MAX_RESULT_BYTES = 256 * 1024;
const TIMESTAMP = "google.protobuf.Timestamp";

export interface CelContext {
  events: PineJsonValue[];
  state: PineJsonValue;
  now: Date;
  automation: { id: string; name: string };
}

function createEnvironment(): Environment {
  return new Environment({
    homogeneousAggregateLiterals: false,
    limits: {
      maxAstNodes: 2_000,
      maxDepth: 40,
      maxListElements: 200,
      maxMapEntries: 200,
      maxCallArguments: 8,
    },
  })
    .registerVariable("events", "list")
    .registerVariable("state", "map")
    .registerVariable("now", TIMESTAMP)
    .registerVariable("automation", "map")
    .registerFunction(
      "glob(string, string): bool",
      (target: string, pattern: string) =>
        path.posix.matchesGlob(target, pattern),
    )
    .registerFunction(`isWorkday(${TIMESTAMP}): bool`, (instant: Date) =>
      isWorkday(instant),
    )
    .registerFunction(
      `formatDate(${TIMESTAMP}, string): string`,
      (instant: Date, pattern: string) => formatDate(instant, pattern),
    );
}

const environment = createEnvironment();

/** JSON numbers that are integers become CEL ints, so `size > 0` checks. */
function toCelValue(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isSafeInteger(value) ? BigInt(value) : value;
  if (Array.isArray(value)) return value.map(toCelValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toCelValue(entry)]),
    );
  }
  return value;
}

function fromCelValue(value: unknown): PineJsonValue {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (value instanceof Map)
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [
        String(key),
        fromCelValue(entry),
      ]),
    );
  if (Array.isArray(value)) return value.map(fromCelValue);
  if (value && typeof value === "object") {
    // Durations and optional values have no JSON form; keep their text.
    const record = value as Record<string, unknown>;
    const prototype: unknown = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null)
      return Object.prototype.toString.call(value);
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, fromCelValue(entry)]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return value;
  return null;
}

function celContext(context: CelContext): Record<string, unknown> {
  return {
    events: toCelValue(context.events),
    state: toCelValue(context.state ?? {}),
    now: context.now,
    automation: context.automation,
  };
}

/** A parse and type error, or undefined when the expression checks. */
export function checkCel(
  expression: string,
  expected?: "bool",
): string | undefined {
  try {
    const result = environment.check(expression) as {
      valid: boolean;
      type?: string;
      error?: { message?: string };
    };
    if (!result.valid) return result.error?.message ?? "Invalid expression.";
    if (
      expected === "bool" &&
      result.type &&
      !["bool", "dyn"].includes(result.type)
    )
      return `The expression must return bool, not ${result.type}.`;
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function evaluateWhen(expression: string, context: CelContext): boolean {
  const result = environment.evaluate(expression, celContext(context));
  if (typeof result !== "boolean")
    throw new Error("`when` must evaluate to true or false.");
  return result;
}

export function evaluatePayload(
  payload: Record<string, string> | undefined,
  context: CelContext,
): Record<string, PineJsonValue> {
  if (!payload) return {};
  const variables = celContext(context);
  const result: Record<string, PineJsonValue> = {};
  for (const [key, expression] of Object.entries(payload)) {
    try {
      result[key] = fromCelValue(environment.evaluate(expression, variables));
    } catch (error) {
      throw new Error(
        `payload.${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RESULT_BYTES)
    throw new Error("The payload is larger than 256 KiB.");
  return result;
}
