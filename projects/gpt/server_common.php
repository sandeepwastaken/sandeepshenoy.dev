<?php
declare(strict_types=1);

const MAX_USER_CHARS = 1000;
const MAX_MESSAGES = 16;
const MAX_IMAGES = 4;
const MAX_IMAGE_DATA_URL = 8000000;
const MAX_REQUEST_BYTES = 36000000;
const MAX_TRANSCRIPT_CHARS = 12000;

function json_response(bool $ok, ?string $error = null, int $status = 200, array $extra = []): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    echo json_encode(array_merge(['ok' => $ok], $error !== null ? ['error' => $error] : [], $extra), JSON_UNESCAPED_SLASHES);
    exit;
}

function read_json_body(): array
{
    $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($contentLength > MAX_REQUEST_BYTES) {
        json_response(false, 'Request is too large.', 413);
    }

    $raw = file_get_contents('php://input');
    if (strlen((string)$raw) > MAX_REQUEST_BYTES) {
        json_response(false, 'Request is too large.', 413);
    }

    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) {
        json_response(false, 'Invalid JSON request.', 400);
    }
    return $data;
}

function normalize_token(string $token): string
{
    $token = trim($token);
    if (!preg_match('/^[A-Za-z0-9_-]{3,128}$/', $token)) {
        return '';
    }
    return $token;
}

function client_ip(): string
{
    return preg_replace('/[^A-Fa-f0-9:\.]/', '', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown')) ?: 'unknown';
}

function enforce_rate_limit(string $bucket, int $limit, int $windowSeconds): void
{
    $dir = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'gpt_console_rate';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        json_response(false, 'Server rate limiter unavailable.', 503);
    }

    $file = $dir . DIRECTORY_SEPARATOR . hash('sha256', client_ip() . '|' . $bucket) . '.json';
    $handle = @fopen($file, 'c+');
    if (!$handle) {
        json_response(false, 'Server rate limiter unavailable.', 503);
    }

    flock($handle, LOCK_EX);
    rewind($handle);
    $now = time();
    $raw = trim((string)stream_get_contents($handle));
    $data = json_decode($raw ?: '{}', true);
    if (!is_array($data) || !isset($data['start'], $data['count']) || ($now - (int)$data['start']) >= $windowSeconds) {
        $data = ['start' => $now, 'count' => 0];
    }

    $data['count'] = (int)$data['count'] + 1;
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($data));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    if ($data['count'] > $limit) {
        json_response(false, 'Too many requests. Please wait a moment and try again.', 429);
    }
}

function keys_dir(): string
{
    return __DIR__ . '/keys';
}

function ensure_private_keys_dir(): void
{
    $dir = keys_dir();
    if (!is_dir($dir) || !is_writable($dir)) {
        return;
    }

    $htaccess = $dir . '/.htaccess';
    if (!is_file($htaccess)) {
        @file_put_contents($htaccess, "Options -Indexes\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
    }

    $index = $dir . '/index.html';
    if (!is_file($index)) {
        @file_put_contents($index, '');
    }
}

function key_path(string $token): string
{
    return keys_dir() . '/' . $token . '.txt';
}

function resolve_key_path(string $token): ?string
{
    ensure_private_keys_dir();
    $dir = realpath(keys_dir());
    if ($dir === false) {
        return null;
    }

    $expected = $dir . DIRECTORY_SEPARATOR . $token . '.txt';
    $real = realpath($expected);
    if ($real === false || $real !== $expected) {
        return null;
    }
    return $real;
}

function read_quota(string $token): ?int
{
    $path = resolve_key_path($token);
    if ($path === null || !is_file($path) || !is_readable($path)) {
        return null;
    }
    $value = trim((string)file_get_contents($path));
    if (!preg_match('/^\d+$/', $value)) {
        return null;
    }
    return (int)$value;
}

function reserve_request(string $token): array
{
    $path = resolve_key_path($token);
    if ($path === null || !is_file($path) || !is_readable($path) || !is_writable($path)) {
        json_response(false, 'Invalid access token.', 401);
    }

    $handle = fopen($path, 'c+');
    if (!$handle) {
        json_response(false, 'Could not validate access token.', 500);
    }
    flock($handle, LOCK_EX);
    rewind($handle);
    $raw = trim((string)stream_get_contents($handle));
    $quota = preg_match('/^\d+$/', $raw) ? (int)$raw : -1;
    if ($quota < 1) {
        flock($handle, LOCK_UN);
        fclose($handle);
        json_response(false, 'No requests remaining, please wait for a top-up.', 402);
    }

    $quota--;
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, (string)$quota);
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    return ['path' => $path, 'requests_left' => $quota];
}

function refund_request(string $path): void
{
    if (!is_file($path) || !is_writable($path)) {
        return;
    }
    $handle = fopen($path, 'c+');
    if (!$handle) {
        return;
    }
    flock($handle, LOCK_EX);
    rewind($handle);
    $raw = trim((string)stream_get_contents($handle));
    $quota = preg_match('/^\d+$/', $raw) ? (int)$raw : 0;
    $quota++;
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, (string)$quota);
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
}

function load_openai_key(): string
{
    $paths = [
        __DIR__ . '/.env',
        dirname(__DIR__) . '/.env',
        dirname(__DIR__, 2) . '/.env',
    ];

    foreach ($paths as $envPath) {
        if (!is_file($envPath) || !is_readable($envPath)) {
            continue;
        }

        $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || strpos($line, '#') === 0 || strpos($line, '=') === false) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            if (trim($key) === 'OPENAI_API_KEY') {
                return trim($value, " \t\n\r\0\x0B\"'");
            }
        }
    }

    json_response(false, 'Server is missing API configuration.', 500);
}

function text_length(string $text): int
{
    return function_exists('mb_strlen') ? mb_strlen($text) : strlen($text);
}

function text_slice(string $text, int $start, int $length): string
{
    return function_exists('mb_substr') ? mb_substr($text, $start, $length) : substr($text, $start, $length);
}

function openai_request(array $payload): array
{
    $apiKey = load_openai_key();
    $ch = curl_init('https://api.openai.com/v1/responses');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $apiKey,
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_SLASHES),
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 120,
    ]);
    $raw = curl_exec($ch);
    $curlError = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false || $curlError !== '') {
        return ['ok' => false, 'status' => 0, 'error' => 'Lost connection!'];
    }

    $data = json_decode((string)$raw, true);
    if (!is_array($data)) {
        return ['ok' => false, 'status' => $status, 'error' => 'Unexpected response from OpenAI.'];
    }
    if ($status < 200 || $status >= 300) {
        if ($status === 429) {
            $message = 'The AI service is temporarily rate limited. Please try again soon.';
        } elseif ($status === 401 || $status === 403) {
            $message = 'Server API configuration rejected the request.';
        } elseif ($status === 400) {
            $message = 'The AI request was rejected. Try a shorter message or smaller images.';
        } else {
            $message = 'AI request failed.';
        }
        return ['ok' => false, 'status' => $status, 'error' => $message];
    }
    return ['ok' => true, 'status' => $status, 'data' => $data];
}

function extract_output_text(array $response): string
{
    if (isset($response['output_text']) && is_string($response['output_text'])) {
        return trim($response['output_text']);
    }
    $parts = [];
    foreach (($response['output'] ?? []) as $item) {
        foreach (($item['content'] ?? []) as $content) {
            if (($content['type'] ?? '') === 'output_text' && isset($content['text'])) {
                $parts[] = $content['text'];
            }
        }
    }
    return trim(implode("\n", $parts));
}
