import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { NextResponse } from "next/server"

const HOME = process.env.HOME ?? process.cwd()
const MAX_TEXT_BYTES = 1_000_000
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"])

function resolvePath(input: string, cwd?: string): string {
  if (input.startsWith("~/")) return resolve(HOME, input.slice(2))
  if (input.startsWith("/")) return input
  // Relative path: resolve against terminal cwd if available, otherwise HOME
  return resolve(cwd ?? HOME, input)
}

function isBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192)
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawPath = searchParams.get("path")
  const cwd = searchParams.get("cwd") ?? undefined

  if (!rawPath) {
    return NextResponse.json({ error: "path required" }, { status: 400 })
  }

  const filePath = resolvePath(rawPath, cwd)

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: `File not found: ${filePath}` }, { status: 404 })
  }

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
}

export async function POST(request: Request) {
  const body = (await request.json()) as { path?: string; content?: string }

  if (!body.path || typeof body.content !== "string") {
    return NextResponse.json({ error: "path and content required" }, { status: 400 })
  }

  const filePath = resolvePath(body.path)

  try {
    writeFileSync(filePath, body.content, "utf8")
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
