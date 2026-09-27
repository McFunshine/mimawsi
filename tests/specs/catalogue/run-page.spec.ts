import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '../../fixtures/test-options';

/**
 * TC-S07/TC-S08 — the Try page letterboxes a tool inside a fixed-height frame,
 * which is the wrong shape for a game and much the wrong shape on a phone. The
 * Full screen control exists to escape it.
 *
 * It has two implementations on purpose, and the fallback is the important one:
 * Safari on iPhone supports the Fullscreen API for video elements only, so
 * requestFullscreen on a div is either absent or rejects there. A phone is
 * exactly where escaping the frame matters most, so the CSS path is the one that
 * has to hold and the native call is an upgrade on top of it.
 *
 * TC-S07 asserts the outcome without caring which path ran, because that differs
 * by engine. TC-S08 removes the API outright and pins the fallback specifically.
 */

/**
 * The catalogue is re-read from disk on every attempt, and nothing is cached.
 *
 * Astro generates the /run/ routes from the *working* copy of published.json, and
 * the tracer rewrites that file during its journey — publishing its own tool,
 * then restoring the index from git. So which ids have a route depends entirely
 * on when you look:
 *
 *  - Reading once at module load latches onto whatever was true then. Firefox
 *    loaded mid-journey, saw a single transient tool, and asked for a page that
 *    had already gone.
 *  - Reading from HEAD instead is worse, not better: those are exactly the ids
 *    with no route while the tracer's transient index is in place. Every one 404s.
 *
 * So the only reliable question is "what is published right now", asked again
 * each time. A tool that 404s is not a failure of the control under test, so the
 * next one is tried, and the whole thing is retried while the index settles.
 */
const CATALOGUE = fileURLToPath(
  new URL('../../../packages/site/src/data/published.json', import.meta.url),
);

function publishedIds(): string[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw as { tools?: unknown[] }).tools;
    if (!Array.isArray(list)) return [];
    return list
      .map((entry) => (entry as { id?: { value?: string } })?.id?.value)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

/** Open the run page of some currently published tool, once its stage is there. */
async function openRunPage(page: import('@playwright/test').Page): Promise<void> {
  const tried: string[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const id of publishedIds().slice(0, 4)) {
      const res = await page.goto(`/run/${id}`);
      if (res && res.status() === 200 && (await page.locator('#stage').count())) return;
      tried.push(`${id.slice(0, 8)}:${res ? res.status() : 'none'}`);
    }
    await page.waitForTimeout(400);
  }
  throw new Error(
    'No published tool rendered a #stage on its run page. Either the Full screen ' +
      `control is gone, or every route 404s. Tried: ${tried.slice(0, 8).join(', ') || 'nothing, the index was empty'}`,
  );
}

test.describe('the Try page can fill the screen', () => {
  test('TC-S07: the Full screen control makes the frame fill the viewport @e2e', async ({
    page,
  }) => {
    await openRunPage(page);

    const frame = page.locator('#stage iframe');
    await expect(frame).toBeVisible();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error('No viewport size — every project sets one.');

    const before = await frame.boundingBox();
    expect(before, 'the frame should be laid out before expanding').not.toBeNull();
    expect(before?.height).toBeLessThan(viewport.height);

    await page.getByRole('button', { name: /full screen/i }).click();

    // Which path ran is an engine detail; the contract is that the tool now has
    // the screen. Polled, because entering fullscreen is not synchronous.
    await expect
      .poll(
        async () => {
          const box = await frame.boundingBox();
          return box ? Math.round(box.width) : 0;
        },
        { timeout: 4_000 },
      )
      .toBeGreaterThanOrEqual(viewport.width - 2);

    const after = await frame.boundingBox();
    // Not the whole height: the bar carrying Close stays on screen deliberately,
    // because a full-screen frame with no way out is a trap.
    expect(after?.height).toBeGreaterThan(viewport.height * 0.8);
    await expect(page.getByRole('button', { name: /^close$/i })).toBeVisible();
  });

  test('TC-S08: with no Fullscreen API the CSS fallback still fills the screen @e2e', async ({
    page,
  }) => {
    // What an iPhone actually presents: no fullscreen for anything but a video.
    await page.addInitScript(() => {
      // @ts-expect-error — removing a platform method is the point of the fixture
      delete Element.prototype.requestFullscreen;
      // @ts-expect-error — the WebKit-prefixed spelling goes too
      delete Element.prototype.webkitRequestFullscreen;
      Object.defineProperty(document, 'fullscreenElement', { get: () => null });
    });

    await openRunPage(page);

    const frame = page.locator('#stage iframe');
    await expect(frame).toBeVisible();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error('No viewport size — every project sets one.');

    await page.getByRole('button', { name: /full screen/i }).click();

    const stage = page.locator('#stage');
    await expect(stage).toHaveClass(/stage--filled/);

    await expect
      .poll(
        async () => {
          const box = await frame.boundingBox();
          return box ? Math.round(box.width) : 0;
        },
        { timeout: 4_000 },
      )
      .toBeGreaterThanOrEqual(viewport.width - 2);

    // And it must be possible to get back out by the button rather than by
    // reloading: in this mode the browser offers no exit gesture of its own.
    await page.getByRole('button', { name: /^close$/i }).click();
    await expect(stage).not.toHaveClass(/stage--filled/);
    await expect(page.getByRole('button', { name: /full screen/i })).toBeVisible();
  });
});
