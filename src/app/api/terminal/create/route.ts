import { NextResponse } from "next/server"

import { getTerminalRuntime } from "@/lib/terminal-runtime"

export async function POST() {
  const terminalId = getTerminalRuntime().createSession()
  return NextResponse.json({ terminalId })
}
