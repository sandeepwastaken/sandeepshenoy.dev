<?php
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);
// Only accept POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('Method Not Allowed');
}

// Validate and sanitize input
$name = isset($_POST['name']) ? strip_tags(trim($_POST['name'])) : '';
$email = isset($_POST['email']) ? filter_var(trim($_POST['email']), FILTER_VALIDATE_EMAIL) : '';
$subject = isset($_POST['subject']) ? strip_tags(trim($_POST['subject'])) : '';
$message = isset($_POST['message']) ? strip_tags(trim($_POST['message'])) : '';

if (!$name || !$email || !$subject || !$message) {
    http_response_code(400);
    exit('Please fill in all fields correctly.');
}

// Prepare email
$to = 'ask@sandeepshenoy.dev';
$mail_subject = 'Contact Form: ' . $subject;
$body = "Name: $name\nEmail: $email\nSubject: $subject\nMessage:\n$message";
$headers = "From: $email\r\nReply-To: $email\r\n";

// Send email
if (mail($to, $mail_subject, $body, $headers)) {
    echo 'Message sent successfully!';
} else {
    http_response_code(500);
    echo 'Failed to send message.';
}
?>
