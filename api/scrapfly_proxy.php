<?php
// api/scrapfly_proxy.php
// Minimal proxy to Scrapfly API. Accepts POST JSON: { "urls": ["https://..."] }
// Environment: set SCRAPFLY_KEY with your Scrapfly API key.
// Returns: { results: [ { ok, url, response:{ body }, error? } ] }

header('Content-Type: application/json');
header('Cache-Control: no-store');

// Allow only POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode([ 'error' => 'Method Not Allowed' ]);
  exit;
}

$raw = file_get_contents('php://input');
$input = json_decode($raw, true);
if (!is_array($input) || !isset($input['urls']) || !is_array($input['urls'])) {
  http_response_code(400);
  echo json_encode([ 'error' => 'Invalid JSON body. Expect { "urls": [ ... ] }' ]);
  exit;
}

$apiKey = getenv('SCRAPFLY_KEY');
// Fallback 1: a local secrets.php that defines SCRAPFLY_KEY constant (not committed)
if (!$apiKey || !is_string($apiKey) || $apiKey === '') {
  $secretsPath = __DIR__ . '/secrets.php';
  if (is_file($secretsPath)) {
    // phpcs:ignore
    include_once $secretsPath;
    if (defined('SCRAPFLY_KEY') && is_string(SCRAPFLY_KEY) && SCRAPFLY_KEY !== '') {
      $apiKey = SCRAPFLY_KEY;
    }
  }
}
// Fallback 2: a plain text file with the key
if (!$apiKey || !is_string($apiKey) || $apiKey === '') {
  $keyFile = __DIR__ . '/.scrapfly.key';
  if (is_file($keyFile)) {
    $apiKey = trim((string)@file_get_contents($keyFile));
  }
}
// Final check
if (!$apiKey || !is_string($apiKey) || $apiKey === '') {
  http_response_code(500);
  echo json_encode([ 'error' => 'Scrapfly API key missing. Set environment variable SCRAPFLY_KEY, or provide api/secrets.php defining SCRAPFLY_KEY, or a file api/.scrapfly.key with the key.' ]);
  exit;
}

function http_get($url, $timeout = 45, $headers = []) {
  $ch = curl_init();
  curl_setopt($ch, CURLOPT_URL, $url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
  curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
  curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
  if (!empty($headers)) curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
  $body = curl_exec($ch);
  $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err = null;
  if ($body === false) {
    $err = curl_error($ch);
  }
  curl_close($ch);
  return [ $httpCode, $body, $err ];
}

function extract_content($respBody) {
  // Try to decode JSON and extract common Scrapfly shapes
  $json = json_decode($respBody, true);
  if (is_array($json)) {
    // Possible shapes to try in order
    $paths = [
      ['result','content'],
      ['result','response','content'],
      ['result','body'],
      ['content'],
      ['body'],
      ['result','result','content'] // in case of nested wraps
    ];
    foreach ($paths as $path) {
      $node = $json;
      $ok = true;
      foreach ($path as $key) {
        if (is_array($node) && array_key_exists($key, $node)) {
          $node = $node[$key];
        } else {
          $ok = false; break;
        }
      }
      if ($ok && is_string($node)) return $node;
    }
  }
  // Fallback to raw response
  return $respBody;
}

$results = [];
foreach ($input['urls'] as $rawUrl) {
  $url = trim((string)$rawUrl);
  if ($url === '') {
    $results[] = [ 'ok' => false, 'url' => $rawUrl, 'error' => 'Empty URL' ];
    continue;
  }

  // Build Scrapfly request
  $endpoint = 'https://api.scrapfly.io/scrape';
  $qs = http_build_query([
    'key' => $apiKey,
    'url' => $url,
    'render_js' => 'true', // enable JS rendering when needed
    'asp' => 'true'        // anti scraping protection bypass
  ]);
  $scrapflyUrl = $endpoint . '?' . $qs;

  list($code, $body, $err) = http_get($scrapflyUrl, 60, [ 'Accept: application/json' ]);

  if ($err) {
    $results[] = [ 'ok' => false, 'url' => $url, 'error' => 'Network error: ' . $err ];
    continue;
  }

  if ($code < 200 || $code >= 300) {
    $snippet = substr($body ?? '', 0, 500);
    $results[] = [ 'ok' => false, 'url' => $url, 'error' => 'Scrapfly HTTP ' . $code . ': ' . $snippet ];
    continue;
  }

  $content = extract_content($body ?? '');
  $results[] = [
    'ok' => true,
    'url' => $url,
    'response' => [ 'body' => $content ]
  ];
}

echo json_encode([ 'results' => $results ]);
