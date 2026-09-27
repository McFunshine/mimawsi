import { expect, test } from '@fixtures/test-options';

/**
 * TC-C08/TC-C09 — collections.
 *
 * A collection is a curated set of published tools with a URL of its own. It is
 * deliberately not a tag: a tag is descriptive and comes from whoever made the
 * tool, a collection is editorial and lives in the repository. See `Collection` in
 * packages/domain.
 *
 * `/dina` is the first one and is unlisted, so it is also the case that pins what
 * unlisted means here. Both assertions below are written to survive the page being
 * filled — nothing asserts that it is empty, only that it is coherent — because a
 * test that has to be rewritten the day content arrives is a test that will be
 * deleted instead.
 *
 * What unlisted is NOT: private. The tools in an unlisted collection are in the
 * main catalogue, have run pages and download like any other. Nothing in this file
 * should be read as testing an access control, because there isn't one.
 */

const UNLISTED = '/dina';

test.describe('an unlisted collection', () => {
  /**
   * TC-C08 — the page renders itself: its own heading and blurb, and either the
   * cards of its members or an empty state, never neither and never both.
   *
   * That either/or is the invariant worth pinning. The bug it guards against is a
   * curated page rendering nothing at all — no cards, no explanation — which is
   * what a resolver silently dropping members looks like from the outside.
   */
  test('TC-C08: a collection page renders its heading, its blurb, and exactly one of cards or an empty state @e2e', async ({
    page,
  }) => {
    await page.goto(UNLISTED);

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('For Dina');

    // The blurb is the paragraph the collection supplies. Located by its text
    // rather than a class, because a class is not something a reader can see.
    await expect(page.getByText(/runs in the page/i)).toBeVisible();

    const cards = page.getByRole('article');
    const empty = page.getByText(/nothing here yet/i);
    const cardCount = await cards.count();

    if (cardCount === 0) {
      await expect(empty).toBeVisible();
    } else {
      await expect(empty).toHaveCount(0);
      // Every card is a real tool card, so it offers both of the things a
      // catalogue entry offers.
      await expect(cards.first().getByRole('link', { name: /^Try / })).toBeVisible();
      await expect(cards.first().getByRole('link', { name: /^Download / })).toBeVisible();
    }

    // A way back. A collection reached from a link somebody sent is a dead end
    // otherwise, and the front page is the only other thing to offer.
    await expect(page.getByRole('link', { name: 'All of mimawsi' })).toBeVisible();
  });

  /**
   * TC-C09 — unlisted means absent from the front page and asking not to be
   * indexed. Both halves matter: omitting the link while leaving the page
   * indexable makes "unlisted" last until the first crawl.
   *
   * noindex is a meta tag rather than a robots.txt rule on purpose — robots.txt is
   * public, and a Disallow line advertises the path it is trying to keep quiet.
   */
  test('TC-C09: an unlisted collection is absent from the front page and asks not to be indexed @e2e', async ({
    page,
  }) => {
    await page.goto(UNLISTED);
    // A selector, and the one place it is right to use one: <meta> has no role, no
    // label and no text. This is document metadata, not mimawsi's UI.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    await page.goto('/');
    // By accessible name, not by href: the rule against CSS selectors applies, and
    // the name is what a reader would actually look for. A collection that is
    // absent by construction has no link to find.
    await expect(page.getByRole('link', { name: 'For Dina' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Collections' })).toHaveCount(0);

    // And the front page itself stays indexable — the noindex belongs to the
    // unlisted page, not to the layout it shares with everything else.
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });
});
