<?php
header('Content-Type: text/plain');
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo 'hello';
} else {
    http_response_code(405);
    echo 'Method not allowed';
}
?>