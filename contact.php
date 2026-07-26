<?php
/* ============================================================
   contact.php — handles the "Let's talk!" form.
   Works on Hostinger (or any PHP host with mail() enabled).
   Change $TO to the address where you want to receive messages.
   ============================================================ */

declare(strict_types=1);

$TO      = "sandeepshenoy09@gmail.com";   // ← where messages are delivered
$SUBJECT = "New message from your portfolio";

header("Content-Type: application/json; charset=utf-8");

/* only accept POST */
if (($_SERVER["REQUEST_METHOD"] ?? "") !== "POST") {
    http_response_code(405);
    echo json_encode(["ok" => false, "message" => "Method not allowed."]);
    exit;
}

/* honeypot — bots fill hidden fields, humans don't */
if (!empty($_POST["company"] ?? "")) {
    echo json_encode(["ok" => true, "message" => "Thanks!"]); // silently accept
    exit;
}

$name    = trim((string)($_POST["name"] ?? ""));
$email   = trim((string)($_POST["email"] ?? ""));
$message = trim((string)($_POST["message"] ?? ""));

$errors = [];
if ($name === "" || mb_strlen($name) > 120)            $errors[] = "a valid name";
if (!filter_var($email, FILTER_VALIDATE_EMAIL))        $errors[] = "a valid email";
if ($message === "" || mb_strlen($message) > 5000)     $errors[] = "a message";

if ($errors) {
    http_response_code(422);
    echo json_encode(["ok" => false, "message" => "Please provide " . implode(", ", $errors) . "."]);
    exit;
}

/* strip header-injection attempts from the reply-to */
$safeEmail = preg_replace('/[\r\n]+/', "", $email);
$safeName  = preg_replace('/[\r\n]+/', "", $name);

$body = "Name:  {$safeName}\n"
      . "Email: {$safeEmail}\n\n"
      . "Message:\n{$message}\n";

$headers = "From: Portfolio <no-reply@" . ($_SERVER["SERVER_NAME"] ?? "localhost") . ">\r\n"
         . "Reply-To: {$safeName} <{$safeEmail}>\r\n"
         . "Content-Type: text/plain; charset=utf-8\r\n";

/* mail() is disabled on the CLI dev server; treat that as success locally */
$sent = @mail($TO, $SUBJECT, $body, $headers);

if ($sent || php_sapi_name() === "cli-server") {
    echo json_encode(["ok" => true, "message" => "Thanks — I'll get back to you soon."]);
} else {
    http_response_code(500);
    echo json_encode(["ok" => false, "message" => "Mail could not be sent. Please email me directly."]);
}
