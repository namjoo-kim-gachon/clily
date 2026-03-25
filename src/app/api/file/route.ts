import { readFileSync, statSync } from "node:fs"

import { NextResponse } from "next/server"

import { formatBytes, IMAGE_EXTS, resolvePath } from "@/lib/file-utils"

const MAX_TEXT_BYTES = 1_000_000

function isBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192)
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawPath = searchParams.get("path")

  if (!rawPath) {
    return NextResponse.json({ error: "path required" }, { status: 400 })
  }

  const filePath = resolvePath(rawPath)

  try {
    const stat = statSync(filePath)

    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 400 })
    }

    const ext = filePath.split(".").pop()?.toLowerCase() ?? ""

    if (IMAGE_EXTS.has(ext)) {
      return NextResponse.json({ type: "image", size: stat.size, sizeLabel: formatBytes(stat.size) })
    }

    const buf = readFileSync(filePath)

    if (isBinary(buf)) {
      return NextResponse.json({ type: "binary", size: stat.size, sizeLabel: formatBytes(stat.size) })
    }

    const truncated = stat.size > MAX_TEXT_BYTES
    const content = buf.subarray(0, MAX_TEXT_BYTES).toString("utf8")

    return NextResponse.json({
      type: "text",
      content,
      size: stat.size,
      sizeLabel: formatBytes(stat.size),
      truncated,
    })
  } catch {
    return NextResponse.json({ error: `File not found: ${filePath}` }, { status: 404 })
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as { path?: string; content?: string }

  if (!body.path || typeof body.content !== "string") {
    return NextResponse.json({ error: "path and content required" }, { status: 400 })
  }

  const filePath = resolvePath(body.path)

  try {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(filePath, body.content, "utf8")
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
