import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '../../fixtures/test-options';

/**
 * TC-T01 — the tracer.
 *
 * One test, the whole path: browse a seeded tool, run it, download it, drop your
 * own, submit it, approve it, and see it published. It goes green at cp-0 against
 * fakes and must stay green at every checkpoint after that.
 *
 * It is written ONCE and never amended (RULE-47). Later phases replace what sits
 * beneath it — local directory becomes S3, stub identity becomes Google, the CLI
 * becomes an admin surface — and this file does not change. If it goes red, the
 * path is broken; do not update the test to match.
 *
 * It therefore also fixes the accessible names the UI must have. That is
 * deliberate: the test is written before the markup so the markup has to be
 * reachable, rather than the locators being fitted to whatever got built.
 */

const SEEDED_TOOL = 'Word Counter';

/** A tool a maker would plausibly write: local work, a download, no network. */
const makerTool = `<!doctype html>
<html lang="en">
  <head><title>Shouty Text</title></head>
  <body>
    <h1>Shouty Text</h1>
    <label for="in">Text</label>
    <input id="in" value="hello">
    <button id="go">Shout</button>
    <p id="out"></p>
    <script>
      document.getElementById('go').addEventListener('click', () => {
        document.getElementById('out').textContent =
          document.getElementById('in').value.toUpperCase();
      });
    </script>
  </body>
</html>`;

test('TC-T01: a tool travels the whole path — browse, run, download, share, approve, publish @tracer @e2e', async ({
  page,
  reached,
}) => {
  test.slow();

  // ---- 1. Browse -------------------------------------------------------
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const seeded = page.getByRole('article').filter({ hasText: SEEDED_TOOL });
  await expect(seeded).toBeVisible();

  // ---- 2. Run it -------------------------------------------------------
  // The runner is a separate origin. We assert the boundary exists and is
  // pointed at the tool — never anything inside it. Tool HTML is not ours.
  await seeded.getByRole('link', { name: `Try ${SEEDED_TOOL}` }).click();

  const runner = page.getByTitle(`Running ${SEEDED_TOOL}`);
  await expect(runner).toBeVisible();
  await expect(runner).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(runner).toHaveAttribute('src', /^https?:\/\/[^/]*:4322\//);

  // ---- 3. Download it --------------------------------------------------
  const [seededDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: `Download ${SEEDED_TOOL}` }).click(),
  ]);
  expect(seededDownload.suggestedFilename()).toMatch(/\.html$/);

  // ---- 4. Drop your own, and watch it run locally ----------------------
  await page.goto('/share');
  const catalogue = new URL(page.url()).origin;

  const dropped = join(await mkdtemp(join(tmpdir(), 'mimawsi-maker-')), 'shouty.html');
  await writeFile(dropped, makerTool, 'utf8');

  // Watch only the window between choosing the file and seeing it run. `reached`
  // accumulates from the start of the test, so an absolute assertion here would
  // be measuring step 2's runner load rather than this step's silence.
  const beforeDrop = reached.length;

  await page.getByLabel('Choose an HTML file').setInputFiles(dropped);

  const preview = page.getByTitle('Running Shouty Text');
  await expect(preview).toBeVisible();

  // Nothing was transmitted to run it. Responses, not requests — Chromium reports
  // CSP-blocked requests before the check runs (see behaviour doc §4).
  const duringDrop = reached.slice(beforeDrop).filter((url) => !url.startsWith(catalogue));
  expect(duringDrop).toEqual([]);

  // ---- 5. Submit it ----------------------------------------------------
  await page.getByLabel('Title').fill('Shouty Text');
  await page.getByLabel('Description').fill('Turns your text into shouting');
  await page.getByRole('button', { name: 'Submit' }).click();

  // Authentication is prompted at submit, never before — bytes must not reach
  // storage while anonymous.
  await page.getByRole('button', { name: 'Sign in with Google' }).click();

  await expect(page.getByText(/pending review/i)).toBeVisible();

  // ---- 6. Approve it ---------------------------------------------------
  // A CLI in phase 0; an admin surface from phase 5. Either way the journey is
  // the same, which is the point of driving it from outside.
  const approved = execFileSync('npm', ['run', '--silent', 'review', '--', 'approve', '--latest'], {
    cwd: join(process.cwd(), '..'),
    encoding: 'utf8',
  });
  expect(approved).toMatch(/approved/i);

  // ---- 7. See it published --------------------------------------------
  await page.goto('/');
  const published = page.getByRole('article').filter({ hasText: 'Shouty Text' });
  await expect(published).toBeVisible();

  const [publishedDownload] = await Promise.all([
    page.waitForEvent('download'),
    published.getByRole('link', { name: 'Download Shouty Text' }).click(),
  ]);
  expect(publishedDownload.suggestedFilename()).toMatch(/\.html$/);

  // The published file carries the policy. That it is *enforced* is TC-T03's
  // job, from file:// where it actually has to hold.
  const savedTo = await publishedDownload.path();
  expect(savedTo).toBeTruthy();
});
