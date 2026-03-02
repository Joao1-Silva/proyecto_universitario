import { NextRequest, NextResponse } from "next/server"
import { mockApiRequest } from "@/lib/browser-mock-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ path?: string[] }> | { path?: string[] }
}

const readRequestBody = async (request: NextRequest): Promise<unknown> => {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined
  }

  const raw = await request.text()
  if (!raw.trim()) {
    return undefined
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

const routeToMockPath = async (request: NextRequest, context: RouteContext): Promise<string> => {
  const params = await Promise.resolve(context.params)
  const segments = Array.isArray(params.path) ? params.path : []
  const pathname = segments.length > 0 ? `/${segments.join("/")}` : "/"
  return `${pathname}${request.nextUrl.search}`
}

const toHeaderRecord = (request: NextRequest): Record<string, string> => {
  const authorization = request.headers.get("authorization")
  if (!authorization) {
    return {}
  }
  return { Authorization: authorization }
}

const handle = async (request: NextRequest, context: RouteContext) => {
  const path = await routeToMockPath(request, context)
  const body = await readRequestBody(request)
  const headers = toHeaderRecord(request)
  const result = await mockApiRequest(request.method, path, body, headers, { force: true })

  if (result.ok) {
    return NextResponse.json(result.data ?? { ok: true }, { status: result.statusCode })
  }

  return NextResponse.json(
    {
      error: result.error ?? `HTTP ${result.statusCode}`,
    },
    { status: result.statusCode || 500 },
  )
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle

