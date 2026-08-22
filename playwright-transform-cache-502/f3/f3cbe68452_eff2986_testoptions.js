// 9afca5d480aab7fa97d091d2caf4cd47501933ee
import { test as base, expect } from '@playwright/test';
import { resetLocalState } from '../reset-local-state';
import { publishToDisk } from '../support/publish';

/**
 * Everything a CSP spec is allowed to believe.
 *
 * Three oracles, none of them the page's own API return values — ED-1 proved those
 * lie: Chrome returned `true` from `navigator.sendBeacon` for a request CSP had
 * blocked. RULE-18.
 *
 *  - `violations` — `securitypolicyviolation` events. The positive signal that the
 *                   browser refused something, and which directive did it.
 *  - `reached`    — non-`file://` URLs that came *back* with a response. This is the
 *                   "and not" oracle and it must stay empty. Deliberately NOT
 *                   `page.on('request')`: Chromium reports XHR and `<img>` requests
 *                   to Playwright before the CSP check runs, so a request event is
 *                   evidence of intent, never of egress.
 *  - `failures`   — what the browser said when it refused, per URL. Recorded so a
 *                   change in blocking mechanism shows up as a diff, not a silence.
 */

export const test = base.extend({
  /**
   * The tracer walks real state: it submits a file, approves it and publishes it.
   * globalSetup clears that once per run, which is not enough — a retry started
   * from whatever the failed attempt left behind. When an attempt got as far as
   * publishing, the retry re-submitted the same bytes, hit the duplicate-file
   * check and failed at a completely different step, hiding the original cause.
   *
   * Resetting per test makes a retry mean what it is supposed to mean. Scoped to
   * the tracer because only it touches this state; the CSP specs publish into
   * their own temp directories and must not be disturbed.
   */
  resetTracerState: [async ({}, use, testInfo) => {
    if (testInfo.project.name === 'tracer') {
      await resetLocalState();
    }
    await use();
  }, {
    auto: true
  }],
  // Never set `bypassCSP` on the context — it would switch off the thing under test.
  oracles: async ({
    page
  }, use) => {
    const violations = [];
    const reached = [];
    const failures = {};
    await page.exposeFunction('__mimawsiViolation', v => {
      violations.push(v);
    });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', event => {
        var _w$__mimawsiViolation;
        const w = window;
        (_w$__mimawsiViolation = w.__mimawsiViolation) === null || _w$__mimawsiViolation === void 0 || _w$__mimawsiViolation.call(w, {
          directive: event.effectiveDirective || event.violatedDirective,
          blockedURI: event.blockedURI
        });
      });
    });
    page.on('response', response => {
      if (!response.url().startsWith('file://')) {
        reached.push(response.url());
      }
    });
    page.on('requestfailed', request => {
      if (!request.url().startsWith('file://')) {
        var _request$failure$erro, _request$failure;
        failures[request.url()] = (_request$failure$erro = (_request$failure = request.failure()) === null || _request$failure === void 0 ? void 0 : _request$failure.errorText) !== null && _request$failure$erro !== void 0 ? _request$failure$erro : 'unknown';
      }
    });
    await use({
      violations,
      reached,
      failures
    });
  },
  violations: async ({
    oracles
  }, use) => {
    await use(oracles.violations);
  },
  reached: async ({
    oracles
  }, use) => {
    await use(oracles.reached);
  },
  failures: async ({
    oracles
  }, use) => {
    await use(oracles.failures);
  },
  openPublished: async ({
    page,
    oracles
  }, use) => {
    void oracles; // force oracle attachment before the first navigation
    await use(async toolHtml => {
      await page.goto(await publishToDisk(toolHtml));
    });
  }
});
export { expect };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJ0ZXN0IiwiYmFzZSIsImV4cGVjdCIsInJlc2V0TG9jYWxTdGF0ZSIsInB1Ymxpc2hUb0Rpc2siLCJleHRlbmQiLCJyZXNldFRyYWNlclN0YXRlIiwidXNlIiwidGVzdEluZm8iLCJwcm9qZWN0IiwibmFtZSIsImF1dG8iLCJvcmFjbGVzIiwicGFnZSIsInZpb2xhdGlvbnMiLCJyZWFjaGVkIiwiZmFpbHVyZXMiLCJleHBvc2VGdW5jdGlvbiIsInYiLCJwdXNoIiwiYWRkSW5pdFNjcmlwdCIsImRvY3VtZW50IiwiYWRkRXZlbnRMaXN0ZW5lciIsImV2ZW50IiwiX3ckX19taW1hd3NpVmlvbGF0aW9uIiwidyIsIndpbmRvdyIsIl9fbWltYXdzaVZpb2xhdGlvbiIsImNhbGwiLCJkaXJlY3RpdmUiLCJlZmZlY3RpdmVEaXJlY3RpdmUiLCJ2aW9sYXRlZERpcmVjdGl2ZSIsImJsb2NrZWRVUkkiLCJvbiIsInJlc3BvbnNlIiwidXJsIiwic3RhcnRzV2l0aCIsInJlcXVlc3QiLCJfcmVxdWVzdCRmYWlsdXJlJGVycm8iLCJfcmVxdWVzdCRmYWlsdXJlIiwiZmFpbHVyZSIsImVycm9yVGV4dCIsIm9wZW5QdWJsaXNoZWQiLCJ0b29sSHRtbCIsImdvdG8iXSwic291cmNlcyI6WyJ0ZXN0LW9wdGlvbnMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgdGVzdCBhcyBiYXNlLCBleHBlY3QgfSBmcm9tICdAcGxheXdyaWdodC90ZXN0JztcbmltcG9ydCB7IHJlc2V0TG9jYWxTdGF0ZSB9IGZyb20gJy4uL3Jlc2V0LWxvY2FsLXN0YXRlJztcbmltcG9ydCB7IHB1Ymxpc2hUb0Rpc2sgfSBmcm9tICcuLi9zdXBwb3J0L3B1Ymxpc2gnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFZpb2xhdGlvbiB7XG4gIGRpcmVjdGl2ZTogc3RyaW5nO1xuICBibG9ja2VkVVJJOiBzdHJpbmc7XG59XG5cbi8qKlxuICogRXZlcnl0aGluZyBhIENTUCBzcGVjIGlzIGFsbG93ZWQgdG8gYmVsaWV2ZS5cbiAqXG4gKiBUaHJlZSBvcmFjbGVzLCBub25lIG9mIHRoZW0gdGhlIHBhZ2UncyBvd24gQVBJIHJldHVybiB2YWx1ZXMg4oCUIEVELTEgcHJvdmVkIHRob3NlXG4gKiBsaWU6IENocm9tZSByZXR1cm5lZCBgdHJ1ZWAgZnJvbSBgbmF2aWdhdG9yLnNlbmRCZWFjb25gIGZvciBhIHJlcXVlc3QgQ1NQIGhhZFxuICogYmxvY2tlZC4gUlVMRS0xOC5cbiAqXG4gKiAgLSBgdmlvbGF0aW9uc2Ag4oCUIGBzZWN1cml0eXBvbGljeXZpb2xhdGlvbmAgZXZlbnRzLiBUaGUgcG9zaXRpdmUgc2lnbmFsIHRoYXQgdGhlXG4gKiAgICAgICAgICAgICAgICAgICBicm93c2VyIHJlZnVzZWQgc29tZXRoaW5nLCBhbmQgd2hpY2ggZGlyZWN0aXZlIGRpZCBpdC5cbiAqICAtIGByZWFjaGVkYCAgICDigJQgbm9uLWBmaWxlOi8vYCBVUkxzIHRoYXQgY2FtZSAqYmFjayogd2l0aCBhIHJlc3BvbnNlLiBUaGlzIGlzIHRoZVxuICogICAgICAgICAgICAgICAgICAgXCJhbmQgbm90XCIgb3JhY2xlIGFuZCBpdCBtdXN0IHN0YXkgZW1wdHkuIERlbGliZXJhdGVseSBOT1RcbiAqICAgICAgICAgICAgICAgICAgIGBwYWdlLm9uKCdyZXF1ZXN0JylgOiBDaHJvbWl1bSByZXBvcnRzIFhIUiBhbmQgYDxpbWc+YCByZXF1ZXN0c1xuICogICAgICAgICAgICAgICAgICAgdG8gUGxheXdyaWdodCBiZWZvcmUgdGhlIENTUCBjaGVjayBydW5zLCBzbyBhIHJlcXVlc3QgZXZlbnQgaXNcbiAqICAgICAgICAgICAgICAgICAgIGV2aWRlbmNlIG9mIGludGVudCwgbmV2ZXIgb2YgZWdyZXNzLlxuICogIC0gYGZhaWx1cmVzYCAgIOKAlCB3aGF0IHRoZSBicm93c2VyIHNhaWQgd2hlbiBpdCByZWZ1c2VkLCBwZXIgVVJMLiBSZWNvcmRlZCBzbyBhXG4gKiAgICAgICAgICAgICAgICAgICBjaGFuZ2UgaW4gYmxvY2tpbmcgbWVjaGFuaXNtIHNob3dzIHVwIGFzIGEgZGlmZiwgbm90IGEgc2lsZW5jZS5cbiAqL1xuaW50ZXJmYWNlIE9yYWNsZXMge1xuICB2aW9sYXRpb25zOiBWaW9sYXRpb25bXTtcbiAgcmVhY2hlZDogc3RyaW5nW107XG4gIGZhaWx1cmVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xufVxuXG5pbnRlcmZhY2UgRml4dHVyZXMgZXh0ZW5kcyBPcmFjbGVzIHtcbiAgLyoqIFB1Ymxpc2hlcyB0b29sIEhUTUwgdGhyb3VnaCB0aGUgaW5qZWN0b3IgYW5kIG9wZW5zIGl0IGFzIGEgZG93bmxvYWRlciB3b3VsZC4gKi9cbiAgb3BlblB1Ymxpc2hlZDogKHRvb2xIdG1sOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBjb25zdCB0ZXN0ID0gYmFzZS5leHRlbmQ8eyBvcmFjbGVzOiBPcmFjbGVzOyByZXNldFRyYWNlclN0YXRlOiB2b2lkIH0gJiBGaXh0dXJlcz4oe1xuICAvKipcbiAgICogVGhlIHRyYWNlciB3YWxrcyByZWFsIHN0YXRlOiBpdCBzdWJtaXRzIGEgZmlsZSwgYXBwcm92ZXMgaXQgYW5kIHB1Ymxpc2hlcyBpdC5cbiAgICogZ2xvYmFsU2V0dXAgY2xlYXJzIHRoYXQgb25jZSBwZXIgcnVuLCB3aGljaCBpcyBub3QgZW5vdWdoIOKAlCBhIHJldHJ5IHN0YXJ0ZWRcbiAgICogZnJvbSB3aGF0ZXZlciB0aGUgZmFpbGVkIGF0dGVtcHQgbGVmdCBiZWhpbmQuIFdoZW4gYW4gYXR0ZW1wdCBnb3QgYXMgZmFyIGFzXG4gICAqIHB1Ymxpc2hpbmcsIHRoZSByZXRyeSByZS1zdWJtaXR0ZWQgdGhlIHNhbWUgYnl0ZXMsIGhpdCB0aGUgZHVwbGljYXRlLWZpbGVcbiAgICogY2hlY2sgYW5kIGZhaWxlZCBhdCBhIGNvbXBsZXRlbHkgZGlmZmVyZW50IHN0ZXAsIGhpZGluZyB0aGUgb3JpZ2luYWwgY2F1c2UuXG4gICAqXG4gICAqIFJlc2V0dGluZyBwZXIgdGVzdCBtYWtlcyBhIHJldHJ5IG1lYW4gd2hhdCBpdCBpcyBzdXBwb3NlZCB0byBtZWFuLiBTY29wZWQgdG9cbiAgICogdGhlIHRyYWNlciBiZWNhdXNlIG9ubHkgaXQgdG91Y2hlcyB0aGlzIHN0YXRlOyB0aGUgQ1NQIHNwZWNzIHB1Ymxpc2ggaW50b1xuICAgKiB0aGVpciBvd24gdGVtcCBkaXJlY3RvcmllcyBhbmQgbXVzdCBub3QgYmUgZGlzdHVyYmVkLlxuICAgKi9cbiAgcmVzZXRUcmFjZXJTdGF0ZTogW1xuICAgIGFzeW5jICh7fSwgdXNlLCB0ZXN0SW5mbykgPT4ge1xuICAgICAgaWYgKHRlc3RJbmZvLnByb2plY3QubmFtZSA9PT0gJ3RyYWNlcicpIHtcbiAgICAgICAgYXdhaXQgcmVzZXRMb2NhbFN0YXRlKCk7XG4gICAgICB9XG4gICAgICBhd2FpdCB1c2UoKTtcbiAgICB9LFxuICAgIHsgYXV0bzogdHJ1ZSB9LFxuICBdLFxuXG4gIC8vIE5ldmVyIHNldCBgYnlwYXNzQ1NQYCBvbiB0aGUgY29udGV4dCDigJQgaXQgd291bGQgc3dpdGNoIG9mZiB0aGUgdGhpbmcgdW5kZXIgdGVzdC5cbiAgb3JhY2xlczogYXN5bmMgKHsgcGFnZSB9LCB1c2UpID0+IHtcbiAgICBjb25zdCB2aW9sYXRpb25zOiBWaW9sYXRpb25bXSA9IFtdO1xuICAgIGNvbnN0IHJlYWNoZWQ6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgZmFpbHVyZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblxuICAgIGF3YWl0IHBhZ2UuZXhwb3NlRnVuY3Rpb24oJ19fbWltYXdzaVZpb2xhdGlvbicsICh2OiBWaW9sYXRpb24pID0+IHtcbiAgICAgIHZpb2xhdGlvbnMucHVzaCh2KTtcbiAgICB9KTtcbiAgICBhd2FpdCBwYWdlLmFkZEluaXRTY3JpcHQoKCkgPT4ge1xuICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignc2VjdXJpdHlwb2xpY3l2aW9sYXRpb24nLCAoZXZlbnQpID0+IHtcbiAgICAgICAgY29uc3QgdyA9IHdpbmRvdyBhcyB1bmtub3duIGFzIHsgX19taW1hd3NpVmlvbGF0aW9uPzogKHY6IHVua25vd24pID0+IHZvaWQgfTtcbiAgICAgICAgdy5fX21pbWF3c2lWaW9sYXRpb24/Lih7XG4gICAgICAgICAgZGlyZWN0aXZlOiBldmVudC5lZmZlY3RpdmVEaXJlY3RpdmUgfHwgZXZlbnQudmlvbGF0ZWREaXJlY3RpdmUsXG4gICAgICAgICAgYmxvY2tlZFVSSTogZXZlbnQuYmxvY2tlZFVSSSxcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHBhZ2Uub24oJ3Jlc3BvbnNlJywgKHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoIXJlc3BvbnNlLnVybCgpLnN0YXJ0c1dpdGgoJ2ZpbGU6Ly8nKSkge1xuICAgICAgICByZWFjaGVkLnB1c2gocmVzcG9uc2UudXJsKCkpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcGFnZS5vbigncmVxdWVzdGZhaWxlZCcsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAoIXJlcXVlc3QudXJsKCkuc3RhcnRzV2l0aCgnZmlsZTovLycpKSB7XG4gICAgICAgIGZhaWx1cmVzW3JlcXVlc3QudXJsKCldID0gcmVxdWVzdC5mYWlsdXJlKCk/LmVycm9yVGV4dCA/PyAndW5rbm93bic7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBhd2FpdCB1c2UoeyB2aW9sYXRpb25zLCByZWFjaGVkLCBmYWlsdXJlcyB9KTtcbiAgfSxcblxuICB2aW9sYXRpb25zOiBhc3luYyAoeyBvcmFjbGVzIH0sIHVzZSkgPT4ge1xuICAgIGF3YWl0IHVzZShvcmFjbGVzLnZpb2xhdGlvbnMpO1xuICB9LFxuXG4gIHJlYWNoZWQ6IGFzeW5jICh7IG9yYWNsZXMgfSwgdXNlKSA9PiB7XG4gICAgYXdhaXQgdXNlKG9yYWNsZXMucmVhY2hlZCk7XG4gIH0sXG5cbiAgZmFpbHVyZXM6IGFzeW5jICh7IG9yYWNsZXMgfSwgdXNlKSA9PiB7XG4gICAgYXdhaXQgdXNlKG9yYWNsZXMuZmFpbHVyZXMpO1xuICB9LFxuXG4gIG9wZW5QdWJsaXNoZWQ6IGFzeW5jICh7IHBhZ2UsIG9yYWNsZXMgfSwgdXNlKSA9PiB7XG4gICAgdm9pZCBvcmFjbGVzOyAvLyBmb3JjZSBvcmFjbGUgYXR0YWNobWVudCBiZWZvcmUgdGhlIGZpcnN0IG5hdmlnYXRpb25cbiAgICBhd2FpdCB1c2UoYXN5bmMgKHRvb2xIdG1sOiBzdHJpbmcpID0+IHtcbiAgICAgIGF3YWl0IHBhZ2UuZ290byhhd2FpdCBwdWJsaXNoVG9EaXNrKHRvb2xIdG1sKSk7XG4gICAgfSk7XG4gIH0sXG59KTtcblxuZXhwb3J0IHsgZXhwZWN0IH07XG4iXSwibWFwcGluZ3MiOiJBQUFBLFNBQVNBLElBQUksSUFBSUMsSUFBSSxFQUFFQyxNQUFNLFFBQVEsa0JBQWtCO0FBQ3ZELFNBQVNDLGVBQWUsUUFBUSxzQkFBc0I7QUFDdEQsU0FBU0MsYUFBYSxRQUFRLG9CQUFvQjs7QUFPbEQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFZQSxPQUFPLE1BQU1KLElBQUksR0FBR0MsSUFBSSxDQUFDSSxNQUFNLENBQTBEO0VBQ3ZGO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRUMsZ0JBQWdCLEVBQUUsQ0FDaEIsT0FBTyxDQUFDLENBQUMsRUFBRUMsR0FBRyxFQUFFQyxRQUFRLEtBQUs7SUFDM0IsSUFBSUEsUUFBUSxDQUFDQyxPQUFPLENBQUNDLElBQUksS0FBSyxRQUFRLEVBQUU7TUFDdEMsTUFBTVAsZUFBZSxDQUFDLENBQUM7SUFDekI7SUFDQSxNQUFNSSxHQUFHLENBQUMsQ0FBQztFQUNiLENBQUMsRUFDRDtJQUFFSSxJQUFJLEVBQUU7RUFBSyxDQUFDLENBQ2Y7RUFFRDtFQUNBQyxPQUFPLEVBQUUsTUFBQUEsQ0FBTztJQUFFQztFQUFLLENBQUMsRUFBRU4sR0FBRyxLQUFLO0lBQ2hDLE1BQU1P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