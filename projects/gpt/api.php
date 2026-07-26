<?php
declare(strict_types=1);

require_once __DIR__ . '/server_common.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(false, 'Method not allowed.', 405);
}

enforce_rate_limit('api', 80, 300);

$body = read_json_body();
$token = normalize_token((string)($body['token'] ?? ''));
if ($token === '') {
    json_response(false, 'Invalid access token.', 401);
}

$action = (string)($body['action'] ?? 'chat');
$allowedModels = ['gpt-4o', 'gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5'];

if ($action === 'title') {
    handle_title($token, $body);
}

if ($action !== 'chat') {
    json_response(false, 'Unknown request action.', 400);
}

$model = (string)($body['model'] ?? 'gpt-4o');
if (!in_array($model, $allowedModels, true)) {
    json_response(false, 'Selected model is not available.', 400);
}

$messages = $body['messages'] ?? [];
if (!is_array($messages) || count($messages) === 0) {
    json_response(false, 'Message is empty.', 400);
}
$messages = array_slice($messages, -MAX_MESSAGES);

$input = [];
$content = [];
$system = 'You are a polished, helpful AI assistant inside a private GPT wrapper. Be clear, accurate, concise when possible, and format useful answers with readable Markdown.';
$input[] = [
    'role' => 'developer',
    'content' => [
        ['type' => 'input_text', 'text' => $system],
    ],
];

$messageCount = 0;
$imageCount = 0;
$transcript = "Use the following recent conversation as context. Answer the latest user message.\n\n";
foreach ($messages as $message) {
    if (!is_array($message)) {
        continue;
    }
    $role = ($message['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
    $text = trim((string)($message['content'] ?? ''));
    if (text_length($text) > MAX_USER_CHARS && $role === 'user') {
        json_response(false, 'Messages are limited to 1,000 characters.', 400);
    }
    if (text_length($text) > MAX_USER_CHARS) {
        $text = text_slice($text, 0, MAX_USER_CHARS);
    }
    $hasMessageContent = $text !== '';

    $label = $role === 'assistant' ? 'Assistant' : 'User';
    $transcript .= $label . ': ' . ($text !== '' ? $text : '[image upload]') . "\n\n";

    if ($role === 'user') {
        $images = $message['images'] ?? [];
        if (is_array($images)) {
            $images = array_slice($images, 0, MAX_IMAGES);
            foreach ($images as $image) {
                $dataUrl = is_array($image) ? (string)($image['dataUrl'] ?? '') : '';
                if ($dataUrl === '') {
                    continue;
                }
                $imageCount++;
                if ($imageCount > MAX_IMAGES) {
                    json_response(false, 'Maximum 4 uploaded images per request.', 400);
                }
                if (strlen($dataUrl) > MAX_IMAGE_DATA_URL) {
                    json_response(false, 'One uploaded image is too large.', 400);
                }
                if (!preg_match('#^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$#', $dataUrl)) {
                    json_response(false, 'Unsupported image upload.', 400);
                }
                $content[] = ['type' => 'input_image', 'image_url' => $dataUrl, 'detail' => 'auto'];
                $hasMessageContent = true;
            }
        }
    }

    if ($hasMessageContent) {
        $messageCount++;
    }
}

if ($messageCount === 0) {
    json_response(false, 'Message is empty.', 400);
}

$transcriptLength = text_length($transcript);
if ($transcriptLength > MAX_TRANSCRIPT_CHARS) {
    $transcript = text_slice($transcript, $transcriptLength - MAX_TRANSCRIPT_CHARS, MAX_TRANSCRIPT_CHARS);
}
array_unshift($content, ['type' => 'input_text', 'text' => trim($transcript)]);
$input[] = ['role' => 'user', 'content' => $content];

$reservation = reserve_request($token);
$result = openai_request([
    'model' => $model,
    'input' => $input,
    'store' => false,
    'max_output_tokens' => 1800,
]);

if (!$result['ok']) {
    refund_request($reservation['path']);
    json_response(false, $result['error'], $result['status'] === 0 ? 502 : 502);
}

$text = extract_output_text($result['data']);
if ($text === '') {
    refund_request($reservation['path']);
    json_response(false, 'The model returned an empty response.', 502);
}

json_response(true, null, 200, [
    'message' => $text,
    'model' => $model,
    'requests_left' => $reservation['requests_left'],
]);

function handle_title(string $token, array $body): void
{
    $messages = $body['messages'] ?? [];
    if (!is_array($messages) || count($messages) === 0) {
        json_response(false, 'Message is empty.', 400);
    }

    $summary = '';
    foreach (array_slice($messages, 0, 2) as $message) {
        if (is_array($message)) {
            $role = ($message['role'] ?? 'user') === 'assistant' ? 'Assistant' : 'User';
            $summary .= $role . ': ' . trim((string)($message['content'] ?? '')) . "\n";
        }
    }
    $summary = trim(text_slice($summary, 0, 1600));
    if ($summary === '') {
        json_response(false, 'Message is empty.', 400);
    }

    $reservation = reserve_request($token);
    $result = openai_request([
        'model' => 'gpt-5.4-mini',
        'input' => [[
            'role' => 'user',
            'content' => [[
                'type' => 'input_text',
                'text' => "Create a short chat title, 2 to 6 words. Return only the title.\n\n" . $summary,
            ]],
        ]],
        'store' => false,
        'max_output_tokens' => 24,
    ]);

    if (!$result['ok']) {
        refund_request($reservation['path']);
        json_response(false, $result['error'], 502);
    }

    $title = extract_output_text($result['data']);
    $title = trim(preg_replace('/["\'`]+/', '', $title));
    $title = trim(preg_replace('/\s+/', ' ', $title));
    if ($title === '') {
        refund_request($reservation['path']);
        json_response(false, 'Could not generate chat name.', 502);
    }

    json_response(true, null, 200, [
        'title' => text_slice($title, 0, 60),
        'requests_left' => $reservation['requests_left'],
    ]);
}
