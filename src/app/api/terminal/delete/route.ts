import { NextResponse } from "next/server"

import { getTerminalRuntime } from "@/lib/terminal-runtime"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const terminalId = typeof body?.terminalId === "string" ? body.terminalId : null

  if (!terminalId) {
    return NextResponse.json({ error: "terminalId required" }, { status: 400 })
  }

  getTerminalRuntime().deleteSession(terminalId)
  return NextResponse.json({ ok: true })
}
