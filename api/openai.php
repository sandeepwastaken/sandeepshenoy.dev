<?php
// Allow CORS
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Display errors for debugging
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Autoload composer dependencies
require_once __DIR__ . '/../vendor/autoload.php';
use Dotenv\Dotenv;

// Load environment variables
try {
    $dotenv = Dotenv::createImmutable(__DIR__ . '/../');
    $dotenv->load();
} catch (Throwable $e) {
    http_response_code(500);
    echo "Dotenv load error: " . $e->getMessage();
    exit;
}

$openai_key = $_ENV['OPENAI_API_KEY'] ?? null;
if (!$openai_key) {
    http_response_code(500);
    echo "OpenAI API key not found in environment.";
    exit;
}

// Rate limiting: 3 seconds per request
$rateLimitFile = __DIR__ . '/.ratelimit';
$rateLimitSeconds = 3;
$lastRequest = file_exists($rateLimitFile) ? (float)file_get_contents($rateLimitFile) : 0;
if (microtime(true) - $lastRequest < $rateLimitSeconds) {
    http_response_code(429);
    echo "Rate limit exceeded. Please wait.";
    exit;
}
file_put_contents($rateLimitFile, microtime(true));

// Read and decode input
$rawInput = file_get_contents("php://input");
if (!$rawInput) {
    http_response_code(400);
    echo "No request body received";
    exit;
}

$input = json_decode($rawInput, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo "Invalid JSON input: " . json_last_error_msg();
    exit;
}

// Validate prompt
$prompt = $input["prompt"] ?? null;
if (!$prompt) {
    http_response_code(400);
    echo "Missing prompt";
    exit;
}

// Validate temperature
$temperature = $input["temperature"] ?? 0.7;
if (!is_numeric($temperature) || $temperature < 0 || $temperature > 2) {
    $temperature = 0.7;
}

// Validate max_tokens
$max_tokens = $input["max_tokens"] ?? 2500;
if (!is_int($max_tokens) && !ctype_digit(strval($max_tokens))) {
    $max_tokens = 2500;
} else {
    $max_tokens = (int)$max_tokens;
}
if ($max_tokens < 1 || $max_tokens > 4000) {
    $max_tokens = 2500;
}

// Optional: model selection (default gpt-4o-mini)
$model = $input["model"] ?? "gpt-4o-mini";
$allowed_models = ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"];
if (!in_array($model, $allowed_models)) {
    $model = "gpt-4o-mini";
}

// Prepare API request
$data = [
    "model" => $model,
    "messages" => [
        ["role" => "user", "content" => $prompt]
    ],
    "max_tokens" => $max_tokens,
    "temperature" => $temperature
];

// Send request to OpenAI
$ch = curl_init('https://api.openai.com/v1/chat/completions');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer $openai_key",
    "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
file_put_contents(__DIR__ . '/debug_response.log', $response);
curl_close($ch);

// Handle errors
if ($error) {
    http_response_code(500);
    echo "cURL error: " . $error;
    exit;
}

if ($http_code !== 200) {
    http_response_code($http_code);
    echo "API request failed with status $http_code\nResponse: " . $response;
    exit;
}

// Decode API response
$result = json_decode($response, true);
if (!$result || !isset($result["choices"][0]["message"]["content"])) {
    http_response_code(500);
    echo "Invalid API response: " . $response;
    exit;
}

// Return AI output
$output = $result["choices"][0]["message"]["content"];
header('Content-Type: text/plain');
echo $output;
