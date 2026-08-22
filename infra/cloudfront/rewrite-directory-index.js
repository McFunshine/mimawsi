/**
 * CloudFront viewer-request function: resolve directory URLs to their index.
 *
 * The catalogue is built as `run/word-counter/index.html`, but the link is
 * `/run/word-counter`. CloudFront resolves a default root object for `/` only,
 * and the S3 origin is a REST origin — required, because the bucket stays
 * private and is read through Origin Access Control (RULE-2) — so it cannot do
 * index-document resolution the way an S3 website endpoint would. Without this
 * every page below the root answers AccessDenied.
 *
 * Deliberately not a redirect: rewriting keeps the clean URL in the address bar
 * and costs no extra round trip.
 */
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (uri.lastIndexOf('.') <= uri.lastIndexOf('/')) {
    // No extension in the final segment, so it names a directory, not a file.
    request.uri = uri + '/index.html';
  }

  return request;
}
