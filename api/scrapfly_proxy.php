<?php

header('Content-Type: application/json');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(array( 'error' => 'Method Not Allowed' ));
  exit;
}

$raw = file_get_contents('php://input');
$input = json_decode($raw, true);
if (!is_array($input) || !isset($input['urls']) || !is_array($input['urls'])) {
  http_response_code(400);
  echo json_encode(array( 'error' => 'Invalid JSON body. Expect { "urls": [ ... ] }' ));
  exit;
}

$apiKey = getenv('SCRAPFLY_KEY');
if (!$apiKey || !is_string($apiKey) || $apiKey === '') {
  $secretsPath = __DIR__ . '/secrets.php';
  if (is_file($secretsPath)) {
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

if (!$apiKey || !is_string($apiKey) || $apiKey === '') {
  $parse_env = function ($path) {
    if (!is_file($path) || !is_readable($path)) return null;
    $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) return null;
    $vars = array();
    foreach ($lines as $line) {
      $line = trim($line);
      if ($line === '' || $line[0] === '#' || $line[0] === ';') continue;
      $eqPos = strpos($line, '=');
      if ($eqPos === false) continue;
      $key = trim(substr($line, 0, $eqPos));
      $val = trim(substr($line, $eqPos + 1));
      if ($val !== '' && (($val[0] === '"' && substr($val, -1) === '"') || ($val[0] === "'" && substr($val, -1) === "'"))) {
        $val = substr($val, 1, -1);
      }
      if ($key !== '') {
        $vars[$key] = $val;
      }
    }
    return $vars;
  };

  $rootEnv = dirname(__DIR__) . '/.env';
  $vars = $parse_env($rootEnv);
  if (is_array($vars) && isset($vars['SCRAPFLY_KEY']) && is_string($vars['SCRAPFLY_KEY']) && $vars['SCRAPFLY_KEY'] !== '') {
    $apiKey = $vars['SCRAPFLY_KEY'];
  }
  if (!$apiKey || !is_string($apiKey) || $apiKey === '') {
    $apiEnv = __DIR__ . '/.env';
    $vars = $parse_env($apiEnv);
    if (is_array($vars) && isset($vars['SCRAPFLY_KEY']) && is_string($vars['SCRAPFLY_KEY']) && $vars['SCRAPFLY_KEY'] !== '') {
      $apiKey = $vars['SCRAPFLY_KEY'];
    }
  }
}

if (!$apiKey || !is_string($apiKey) || $apiKey === '') {
  http_response_code(500);
  echo json_encode(array( 'error' => 'Scrapfly API key missing. Set environment variable SCRAPFLY_KEY, or provide api/secrets.php defining SCRAPFLY_KEY, or a file api/.scrapfly.key with the key.' ));
  exit;
}

function http_get($url, $timeout = 45, $headers = array()) {
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
  return array($httpCode, $body, $err);
}

function extract_content($respBody) {
  $json = json_decode($respBody, true);
  if (is_array($json)) {
    $paths = array(
      array('result','content'),
      array('result','response','content'),
      array('result','body'),
      array('content'),
      array('body'),
      array('result','result','content')
    );
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
  return $respBody;
}

$results = array();
foreach ($input['urls'] as $rawUrl) {
  $url = trim((string)$rawUrl);
  if ($url === '') {
    $results[] = array( 'ok' => false, 'url' => $rawUrl, 'error' => 'Empty URL' );
    continue;
  }

  $endpoint = 'https://api.scrapfly.io/scrape';
  $qs = http_build_query(array(
    'key' => $apiKey,
    'url' => $url,
    'render_js' => 'true',
    'asp' => 'true'
  ));
  $scrapflyUrl = $endpoint . '?' . $qs;

  list($code, $body, $err) = http_get($scrapflyUrl, 60, array( 'Accept: application/json' ));

  if ($err) {
    $results[] = array( 'ok' => false, 'url' => $url, 'error' => 'Network error: ' . $err );
    continue;
  }

  if ($code < 200 || $code >= 300) {
    $snippet = substr($body ?? '', 0, 500);
    $results[] = array( 'ok' => false, 'url' => $url, 'error' => 'Scrapfly HTTP ' . $code . ': ' . $snippet );
    continue;
  }

  $content = extract_content($body ?? '');
  $results[] = array(
    'ok' => true,
    'url' => $url,
    'response' => array( 'body' => $content )
  );
}

echo json_encode(array( 'results' => $results ));
