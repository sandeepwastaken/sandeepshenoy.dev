<?php
declare(strict_types=1);

require_once __DIR__ . '/server_common.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(false, 'Method not allowed.', 405);
}

enforce_rate_limit('quota', 120, 300);

$body = read_json_body();
$token = normalize_token((string)($body['token'] ?? ''));
if ($token === '') {
    json_response(false, 'Invalid access token.', 401);
}

$quota = read_quota($token);
if ($quota === null) {
    json_response(false, 'Invalid access token.', 401);
}

json_response(true, null, 200, ['requests_left' => $quota]);
