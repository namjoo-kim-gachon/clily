import { NextResponse } from "next/server"

import { getTerminalRuntime } from "@/lib/terminal-runtime"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const cols = typeof body?.cols === "number" && body.cols > 0 ? Math.round(body.cols) : undefined
  const rows = typeof body?.rows === "number" && body.rows > 0 ? Math.round(body.rows) : undefined
  const terminalId = getTerminalRuntime().createSession(cols, rows)
  return NextResponse.json({ terminalId })
}
