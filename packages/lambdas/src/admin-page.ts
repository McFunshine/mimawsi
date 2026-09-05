/**
 * The approval page, as a string.
 *
 * Served by the Lambda rather than from a bucket, so the subdomain has exactly
 * one origin and CloudFront needs no path routing to decide which of two things
 * answers. There is little enough of it that a build step would cost more than it
 * saved.
 *
 * Nothing here is security. Every button it draws calls a route that checks the
 * allowlist server-side, and a person who is not an approver can open this page,
 * read all of it, and still be refused by every request it makes.
 */

const escapeJs = (value: string): string => JSON.stringify(value);

export function page(googleClientId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Approvals — mimawsi</title>
<style>
  :root { color-scheme: light dark; --line: #8883; --bad: #b3261e; --good: #1c6b3c; }
  * { box-sizing: border-box; }
  body { font: 16px/1.5 system-ui, -apple-system, sans-serif; margin: 0; padding: 2rem 1rem 4rem; max-width: 52rem; margin-inline: auto; }
  header { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; border-bottom: 1px solid var(--line); padding-bottom: .75rem; margin-bottom: 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0; }
  .who { margin-left: auto; opacity: .7; font-size: .9rem; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
  .card h2 { font-size: 1.05rem; margin: 0 0 .25rem; }
  .meta { font-size: .85rem; opacity: .7; margin: 0 0 .75rem; }
  .meta code { font-size: .95em; }
  .row { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
  button { font: inherit; padding: .45rem 1rem; border-radius: 6px; border: 1px solid var(--line); background: transparent; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .approve { border-color: var(--good); color: var(--good); }
  .deny { border-color: var(--bad); color: var(--bad); }
  textarea { font: inherit; width: 100%; min-height: 5rem; margin: .5rem 0; padding: .5rem; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: inherit; }
  .denybox { display: none; margin-top: .75rem; border-top: 1px dashed var(--line); padding-top: .75rem; }
  .denybox.open { display: block; }
  .warn { color: var(--bad); font-size: .85rem; }
  .status { margin: 1rem 0; min-height: 1.5rem; }
  a { color: inherit; }
  .empty { opacity: .7; }
</style>
</head>
<body>
<header>
  <h1>Approvals</h1>
  <span class="who" id="who"></span>
</header>

<div id="signin">
  <p>Sign in with the Google account on the approver list.</p>
  <div id="google-button"></div>
</div>

<p class="status" id="status" role="status" aria-live="polite"></p>
<div id="queue"></div>

<script src="https://accounts.google.com/gsi/client" async defer></script>
<script>
(function () {
  var CLIENT_ID = ${escapeJs(googleClientId)};
  var token = null;
  var statusEl = document.getElementById('status');
  var queueEl = document.getElementById('queue');
  var signinEl = document.getElementById('signin');
  var whoEl = document.getElementById('who');

  function say(message, bad) {
    statusEl.textContent = message;
    statusEl.style.color = bad ? 'var(--bad)' : '';
  }

  function api(path, options) {
    var opts = options || {};
    opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    if (token) { opts.headers.authorization = 'Bearer ' + token; }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) { throw new Error(body.error || ('request failed: ' + r.status)); }
        return body;
      });
    });
  }

  function text(tag, value, className) {
    var el = document.createElement(tag);
    el.textContent = value;
    if (className) { el.className = className; }
    return el;
  }

  function card(item) {
    var el = document.createElement('article');
    el.className = 'card';
    el.appendChild(text('h2', item.title || '(no title)'));
    el.appendChild(text('p', item.description || '(no description)'));

    var meta = text('p', '', 'meta');
    meta.textContent = item.sizeBytes + ' bytes · ' + item.sha256.slice(0, 12) + ' · maker ' + item.maker;
    el.appendChild(meta);

    var row = document.createElement('div');
    row.className = 'row';

    var view = document.createElement('button');
    view.textContent = 'View source';
    view.addEventListener('click', function () {
      // Opened as text/plain by the server, so an unreviewed submission is read
      // rather than run. Never rendered on this origin.
      window.open('/source?id=' + encodeURIComponent(item.id), '_blank', 'noopener');
    });

    var approve = document.createElement('button');
    approve.textContent = 'Approve and publish';
    approve.className = 'approve';

    var denyToggle = document.createElement('button');
    denyToggle.textContent = 'Deny…';
    denyToggle.className = 'deny';

    row.appendChild(view);
    row.appendChild(approve);
    row.appendChild(denyToggle);
    el.appendChild(row);

    var box = document.createElement('div');
    box.className = 'denybox';
    box.appendChild(text('label', 'Why is it not being published? The maker is sent this.'));
    var reason = document.createElement('textarea');
    reason.placeholder = 'It reaches the network — there is a fetch() on line 40.';
    box.appendChild(reason);
    box.appendChild(text('label', 'What would change that? (optional)'));
    var remedy = document.createElement('textarea');
    remedy.placeholder = 'Remove the call and inline the data, then submit again.';
    box.appendChild(remedy);

    if (!item.contactable) {
      box.appendChild(text('p', 'This maker left no verified address. The reason will be recorded but nobody will receive it.', 'warn'));
    }

    var confirm = document.createElement('button');
    confirm.textContent = 'Deny and tell the maker';
    confirm.className = 'deny';
    box.appendChild(confirm);
    el.appendChild(box);

    denyToggle.addEventListener('click', function () {
      box.classList.toggle('open');
      if (box.classList.contains('open')) { reason.focus(); }
    });

    function busy(on) {
      approve.disabled = on; denyToggle.disabled = on; confirm.disabled = on;
    }

    approve.addEventListener('click', function () {
      busy(true);
      say('Publishing ' + (item.title || item.id) + '…');
      api('/approve', { method: 'POST', body: JSON.stringify({ id: item.id }) })
        .then(function (body) {
          say('Published ' + (body.published && body.published.title || item.id) + '.');
          load();
        })
        .catch(function (e) { busy(false); say(e.message, true); });
    });

    confirm.addEventListener('click', function () {
      if (reason.value.trim() === '') { say('A reason is required.', true); reason.focus(); return; }
      busy(true);
      say('Denying ' + (item.title || item.id) + '…');
      api('/deny', {
        method: 'POST',
        body: JSON.stringify({ id: item.id, reason: reason.value, remedy: remedy.value }),
      })
        .then(function (body) {
          say(body.emailed ? 'Denied, and the maker has been emailed.' : 'Denied. No address on file, so nothing was sent.');
          load();
        })
        .catch(function (e) { busy(false); say(e.message, true); });
    });

    return el;
  }

  function load() {
    return api('/queue').then(function (body) {
      whoEl.textContent = 'Signed in as ' + body.approver.name;
      signinEl.style.display = 'none';
      queueEl.replaceChildren();
      if (!body.queue.length) {
        queueEl.appendChild(text('p', 'Nothing is waiting. The queue is empty.', 'empty'));
        return;
      }
      body.queue.forEach(function (item) { queueEl.appendChild(card(item)); });
    });
  }

  window.addEventListener('load', function () {
    if (!CLIENT_ID) { say('Google sign-in is not configured on this deployment.', true); return; }
    if (typeof google === 'undefined') { say('Could not reach Google to sign in.', true); return; }

    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: function (response) {
        if (!response.credential) { say('Google returned no credential.', true); return; }
        token = response.credential;
        say('Checking the approver list…');
        load().catch(function (e) {
          // A real account that is not on the list. Said plainly rather than
          // dressed up: they signed in fine, they are simply not an approver.
          say(e.message, true);
          signinEl.style.display = '';
        });
      },
    });
    google.accounts.id.renderButton(document.getElementById('google-button'), {
      theme: 'outline', size: 'large',
    });
  });
})();
</script>
</body>
</html>
`;
}
