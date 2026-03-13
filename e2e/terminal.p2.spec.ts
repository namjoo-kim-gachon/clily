import { expect, test, type Page } from "@playwright/test"

function parseActiveLabel(text: string) {
  const match = text.match(/Terminal\s+(\d+)\s*\/\s*(\d+)/)
  return {
    active: Number(match?.[1] ?? 0),
    total: Number(match?.[2] ?? 0),
  }
}

async function swipeShellHorizontally(page: Page, direction: "left" | "right") {
  const shellSelector = "[data-testid='terminal-viewport-shell']"
  const shell = page.getByTestId("terminal-viewport-shell")
  const box = await shell.boundingBox()
  expect(box).toBeTruthy()

  const y = (box?.y ?? 0) + (box?.height ?? 0) * 0.5
  const startX = direction === "left" ? (box?.x ?? 0) + (box?.width ?? 0) * 0.85 : (box?.x ?? 0) + (box?.width ?? 0) * 0.15
  const endX = direction === "left" ? (box?.x ?? 0) + (box?.width ?? 0) * 0.15 : (box?.x ?? 0) + (box?.width ?? 0) * 0.85

  await page.dispatchEvent(shellSelector, "touchstart", {
    touches: [{ identifier: 1, clientX: startX, clientY: y }],
  })
  await page.dispatchEvent(shellSelector, "touchend", {
    changedTouches: [{ identifier: 1, clientX: endX, clientY: y }],
  })
}

async function expectNoStandalonePercent(page: Page) {
  await expect.poll(async () => {
    const text = (await page.getByTestId("terminal-viewport").innerText()).trim()
    return /^%$/m.test(text)
  }).toBe(false)
}

test.describe("P2 persistent terminal", () => {
  test("keeps terminal UI and input sending after reconnect", async ({ page }) => {
    await page.goto("/")

    const input = page.getByTestId("terminal-input")
    await input.fill(`echo reconnect-${Date.now()}`)
    await page.getByTestId("terminal-submit").click()
    await expect(input).toHaveValue("")

    await page.reload()

    await expect(page.getByTestId("terminal-page")).toBeVisible()

    const afterReloadInput = page.getByTestId("terminal-input")
    await afterReloadInput.fill("after-reconnect")
    await page.getByTestId("terminal-submit").click()

    await expect(afterReloadInput).toHaveValue("")
  })

  test("removes the terminal when exit is entered", async ({ page }) => {
    let exitedTerminalId = ""

    await page.route("**/api/terminal/input/text", async (route) => {
      const body = route.request().postDataJSON() as { data?: string; terminalId?: string }
      if (body.data === "exit\r") {
        exitedTerminalId = body.terminalId ?? ""
      }
      await route.continue()
    })

    await page.goto("/")
    await page.getByTestId("terminal-add").click()

    const input = page.getByTestId("terminal-input")
    await input.fill("exit")
    await page.getByTestId("terminal-submit").click()

    await expect.poll(() => exitedTerminalId).not.toBe("")

    await expect.poll(async () => {
      const response = await page.request.get(`/api/terminal/sessions?t=${Date.now()}`)
      const payload = (await response.json()) as { terminalIds: string[] }
      return payload.terminalIds.includes(exitedTerminalId)
    }).toBe(false)
  })

  test("keeps one terminal after exit on the last terminal", async ({ page }) => {
    await page.goto("/")

    const input = page.getByTestId("terminal-input")
    await input.fill("exit")
    await page.getByTestId("terminal-submit").click()

    await expect.poll(async () => parseActiveLabel((await page.getByTestId("terminal-active-label").textContent()) ?? "").total).toBeGreaterThanOrEqual(1)
    await expect(page.getByTestId("terminal-viewport")).toBeVisible()
  })

  test("@mobile filters stray percent prompt noise after rotation and terminal switching", async ({ page, isMobile }) => {
    test.skip(!isMobile, "runs mobile rotation/switching percent-noise check only in mobile projects")

    await page.setViewportSize({ width: 393, height: 852 })
    await page.goto("/")

    const label = page.getByTestId("terminal-active-label")
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").total).toBeGreaterThan(0)

    await page.getByTestId("terminal-add").click()
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").total).toBeGreaterThanOrEqual(2)

    const input = page.getByTestId("terminal-input")
    await input.fill("printf '%\\n'")
    await page.getByTestId("terminal-submit").click()
    await expectNoStandalonePercent(page)

    await page.setViewportSize({ width: 852, height: 393 })
    await page.waitForTimeout(120)

    await swipeShellHorizontally(page, "left")
    await swipeShellHorizontally(page, "right")

    await input.fill("printf '%\\n'")
    await page.getByTestId("terminal-submit").click()
    await expectNoStandalonePercent(page)

    await page.setViewportSize({ width: 393, height: 852 })
    await page.waitForTimeout(120)

    await swipeShellHorizontally(page, "left")

    await input.fill("printf '%\\n'")
    await page.getByTestId("terminal-submit").click()
    await expectNoStandalonePercent(page)
  })
})
