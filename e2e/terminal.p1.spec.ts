import { expect, test } from "@playwright/test"

function parseActiveLabel(text: string) {
  const match = text.match(/Terminal\s+(\d+)[^\/]*\/\s*(\d+)/)
  return {
    active: Number(match?.[1] ?? 0),
    total: Number(match?.[2] ?? 0),
  }
}

test.describe("P1 terminal UI simplification", () => {
  test("does not render tmux-specific UI", async ({ page }) => {
    await page.goto("/")

    await expect(page.getByTestId("terminal-page")).toBeVisible()
    await expect(page.getByTestId("session-picker")).toHaveCount(0)
    await expect(page.getByTestId("window-tabs")).toHaveCount(0)
  })

  test("switches terminals with swipe on mobile viewport", async ({ page, isMobile }) => {
    test.skip(!isMobile, "runs swipe transition check only in mobile projects")

    await page.goto("/")

    const label = page.getByTestId("terminal-active-label")
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").total).toBeGreaterThan(0)

    const before = parseActiveLabel((await label.textContent()) ?? "")

    await page.getByTestId("terminal-add").click()

    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "")).toEqual({
      active: before.total + 1,
      total: before.total + 1,
    })

    const shell = page.getByTestId("terminal-viewport-shell")
    const box = await shell.boundingBox()
    expect(box).toBeTruthy()

    await page.dispatchEvent("[data-testid='terminal-viewport-shell']", "touchstart", {
      touches: [{ identifier: 1, clientX: (box?.x ?? 0) + (box?.width ?? 0) * 0.8, clientY: (box?.y ?? 0) + (box?.height ?? 0) * 0.5 }],
    })
    await page.dispatchEvent("[data-testid='terminal-viewport-shell']", "touchend", {
      changedTouches: [{ identifier: 1, clientX: (box?.x ?? 0) + (box?.width ?? 0) * 0.2, clientY: (box?.y ?? 0) + (box?.height ?? 0) * 0.5 }],
    })

    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").active).toBe(1)
  })

  test("creates only one terminal on rapid add taps", async ({ page }) => {
    await page.goto("/")

    const label = page.getByTestId("terminal-active-label")
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").total).toBeGreaterThan(0)

    const before = parseActiveLabel((await label.textContent()) ?? "")

    await page.getByTestId("terminal-add").click({ clickCount: 2, delay: 10 })

    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "")).toEqual({
      active: before.total + 1,
      total: before.total + 1,
    })
  })

  test("switches terminals with left/right buttons on desktop", async ({ page, isMobile }) => {
    test.skip(isMobile, "runs arrow-button transition check only in desktop projects")

    await page.goto("/")

    const label = page.getByTestId("terminal-active-label")
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").total).toBeGreaterThan(0)

    const before = parseActiveLabel((await label.textContent()) ?? "")

    await page.getByTestId("terminal-add").click()

    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "")).toEqual({
      active: before.total + 1,
      total: before.total + 1,
    })

    await expect(page.getByTestId("terminal-nav-prev")).toBeVisible()
    await expect(page.getByTestId("terminal-nav-next")).toBeVisible()

    await page.getByTestId("terminal-nav-prev").click()
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").active).toBe(before.total)

    await page.getByTestId("terminal-nav-next").click()
    await expect.poll(async () => parseActiveLabel((await label.textContent()) ?? "").active).toBe(before.total + 1)
  })
})
