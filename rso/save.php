<?php
date_default_timezone_set("UTC");

$root = __DIR__;
$archiveDir = $root . "/archive";
$currentFile = $root . "/scioly.json";

if (!is_dir($archiveDir)) {
    mkdir($archiveDir, 0755, true);
}

if (!file_exists($currentFile)) {
    file_put_contents($currentFile, json_encode([
        "events"=>[],
        "blog"=>[],
        "results"=>[],
        "resources"=>[]
    ], JSON_PRETTY_PRINT));
}

$timestamp = date("Y-m-d_H-i-s");
copy($currentFile, "$archiveDir/$timestamp.json");

$input = file_get_contents("php://input");
file_put_contents($currentFile, json_encode(json_decode($input), JSON_PRETTY_PRINT));

echo "OK";
