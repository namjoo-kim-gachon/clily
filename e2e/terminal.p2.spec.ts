import { expect, test, type Page } from "@playwright/test"

async function submitTerminalInput(page: Page) {
  const submitButton = page.getByTestId("terminal-submit")
  if (await submitButton.isVisible()) {
    await submitButton.click()
    return
  }

  await page.getByTestId("terminal-input").press("Enter")
}

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

async function getTerminalPageHeight(page: Page) {
  return await page.getByTestId("terminal-page").evaluate((element) => Math.round(element.getBoundingClientRect().height))
}

test.describe("P2 persistent terminal", () => {
  test("keeps terminal UI and input sending after reconnect", async ({ page, isMobile }) => {
    test.skip(!isMobile, "runs only on mobile project")
    await page.goto("/")

    const input = page.getByTestId("terminal-input")
    await input.fill(`echo reconnect-${Date.now()}`)
    await submitTerminalInput(page)
    await expect(input).toHaveValue("")

    await page.reload()

    await expect(page.getByTestId("terminal-page")).toBeVisible()

    const afterReloadInput = page.getByTestId("terminal-input")
    await afterReloadInput.fill("after-reconnect")
    await submitTerminalInput(page)

    await expect(afterReloadInput).toHaveValue("")
  })

  test("removes the terminal when exit is entered", async ({ page, isMobile }) => {
    test.skip(!isMobile, "runs only on mobile project")
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
    await submitTerminalInput(page)

    await expect.poll(() => exitedTerminalId).not.toBe("")

    await expect.poll(async () => {
      const response = await page.request.get(`/api/terminal/sessions?t=${Date.now()}`)
      const payload = (await response.json()) as { terminalIds: string[] }
      return payload.terminalIds.includes(exitedTerminalId)
    }).toBe(false)
  })

  test("keeps one terminal after exit on the last terminal", async ({ page, isMobile }) => {
    test.skip(!isMobile, "runs only on mobile project")
    await page.goto("/")

    const input = page.getByTestId("terminal-input")
    await input.fill("exit")
    await submitTerminalInput(page)

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
    await submitTerminalInput(page)
    await expectNoStandalonePercent(page)

    const heightBeforeFocus = await getTerminalPageHeight(page)
    await input.focus()
    await page.waitForTimeout(120)
    const heightWithFocus = await getTerminalPageHeight(page)
    expect(Math.abs(heightWithFocus - heightBeforeFocus)).toBeLessThanOrEqual(2)

    await page.evaluate(() => {
      const active = document.activeElement
      if (active instanceof HTMLElement) {
        active.blur()
      }
    })
    await page.waitForTimeout(200)

    const heightAfterBlur = await getTerminalPageHeight(page)
    expect(Math.abs(heightAfterBlur - heightBeforeFocus)).toBeLessThanOrEqual(2)

    await input.fill("printf '%\\n'")
    await submitTerminalInput(page)
    await expectNoStandalonePercent(page)

    await page.setViewportSize({ width: 852, height: 393 })
    await page.waitForTimeout(120)

    await swipeShellHorizontally(page, "left")
    await swipeShellHorizontally(page, "right")

    await input.fill("printf '%\\n'")
    await submitTerminalInput(page)
    await expectNoStandalonePercent(page)

    await page.setViewportSize({ width: 393, height: 852 })
    await page.waitForTimeout(120)

    await swipeShellHorizontally(page, "left")

    await input.fill("printf '%\\n'")
    await submitTerminalInput(page)
    await expectNoStandalonePercent(page)
  })

  test("sends one idle notification and deduplicates identical state", async ({ page, isMobile }) => {
    test.skip(isMobile, "runs only on desktop project")
    test.setTimeout(130_000)

    await page.addInitScript(() => {
      const notifications: Array<{ title: string; body?: string; tag?: string }> = []
      ;(window as typeof window & { __idleNotifications?: typeof notifications }).__idleNotifications = notifications

      class MockNotification {
        static permission: NotificationPermission = "granted"

        static requestPermission() {
          return Promise.resolve<NotificationPermission>("granted")
        }

        constructor(title: string, options?: NotificationOptions) {
          notifications.push({ title, body: options?.body, tag: options?.tag })
        }
      }

      Object.defineProperty(window, "Notification", {
        configurable: true,
        writable: true,
        value: MockNotification,
      })
    })

    await page.goto("/")

    const input = page.getByTestId("terminal-input")
    if (await input.isVisible()) {
      await input.fill("echo idle-check")
      await submitTerminalInput(page)
    } else {
      const viewport = page.getByTestId("terminal-viewport")
      await viewport.click()
      await page.keyboard.type("echo idle-check")
      await page.keyboard.press("Enter")
    }

    await expect.poll(async () => {
      return await page.evaluate(() => {
        return (window as typeof window & { __idleNotifications?: Array<unknown> }).__idleNotifications?.length ?? 0
      })
    }).toBe(0)

    await page.waitForTimeout(31_000)

    await expect.poll(async () => {
      return await page.evaluate(() => {
        return (window as typeof window & { __idleNotifications?: Array<unknown> }).__idleNotifications?.length ?? 0
      })
    }).toBe(1)

    await page.waitForTimeout(31_000)

    await expect.poll(async () => {
      return await page.evaluate(() => {
        return (window as typeof window & { __idleNotifications?: Array<unknown> }).__idleNotifications?.length ?? 0
      })
    }).toBe(1)

    const viewport = page.viewportSize()
    await page.setViewportSize({ width: (viewport?.width ?? 1280) - 120, height: viewport?.height ?? 720 })

    await page.waitForTimeout(31_000)

    await expect.poll(async () => {
      return await page.evaluate(() => {
        return (window as typeof window & { __idleNotifications?: Array<unknown> }).__idleNotifications?.length ?? 0
      })
    }).toBe(2)
  })
})
