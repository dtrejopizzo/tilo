import { NextResponse, type NextRequest } from "next/server"
import { requireUser } from "./requireUser"

export class BadRequestError extends Error {}
export class NotFoundError extends Error {}
export class PaymentRequiredError extends Error {}

type Params = Record<string, string>

interface HandlerContext {
  uid: string
  req: NextRequest
  params: Params
}

// Wraps a /api handler: authenticates the caller and maps errors to JSON responses
export function apiRoute(handler: (ctx: HandlerContext) => Promise<unknown>, options: { allowApiToken?: boolean } = {}) {
  return async (req: NextRequest, { params }: { params: Promise<Params> }) => {
    try {
      const uid = await requireUser(req, options)
      if (uid instanceof NextResponse) return uid
      const result = await handler({ uid, req, params: await params })
      if (result instanceof Response) return result
      return NextResponse.json(result ?? { ok: true })
    } catch (error) {
      return errorResponse(error, `${req.method} ${req.nextUrl.pathname}`)
    }
  }
}

export function errorResponse(error: unknown, where: string) {
  if (error instanceof BadRequestError) return NextResponse.json({ error: error.message }, { status: 400 })
  if (error instanceof NotFoundError) return NextResponse.json({ error: error.message || "Not found" }, { status: 404 })
  if (error instanceof PaymentRequiredError) return NextResponse.json({ error: error.message }, { status: 402 })
  console.error(`[api] ${where} failed:`, error)
  return NextResponse.json({ error: "Internal error" }, { status: 500 })
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Clients send their local date (YYYY-MM-DD); the server runs in UTC
export function parseDate(value: unknown, fallback?: string): string {
  if (value === undefined || value === null || value === "") {
    if (fallback) return fallback
    throw new BadRequestError("date is required (YYYY-MM-DD, your local date)")
  }
  if (typeof value !== "string" || !DATE_RE.test(value)) throw new BadRequestError("date must be YYYY-MM-DD")
  return value
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (body && typeof body === "object" && !Array.isArray(body)) return body
  } catch {}
  throw new BadRequestError("Invalid JSON body")
}

export function str(body: Record<string, unknown>, key: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
  const v = body[key]
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new BadRequestError(`${key} is required`)
    return undefined
  }
  if (typeof v !== "string") throw new BadRequestError(`${key} must be a string`)
  const t = v.trim()
  if (opts.max && t.length > opts.max) throw new BadRequestError(`${key} is too long (max ${opts.max})`)
  return t
}

export function numb(body: Record<string, unknown>, key: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | undefined {
  const v = body[key]
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new BadRequestError(`${key} is required`)
    return undefined
  }
  if (typeof v !== "number" || !Number.isFinite(v)) throw new BadRequestError(`${key} must be a number`)
  if ((opts.min != null && v < opts.min) || (opts.max != null && v > opts.max)) {
    throw new BadRequestError(`${key} must be between ${opts.min ?? "-∞"} and ${opts.max ?? "∞"}`)
  }
  return v
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (!allowed.includes(value as T)) throw new BadRequestError(`${key} must be one of: ${allowed.join(", ")}`)
  return value as T
}
