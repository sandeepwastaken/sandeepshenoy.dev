<?php
/* ============================================================
   art.php — lists every image in /art as JSON for the gallery.
   Drop files into the art/ folder and the gallery updates itself.
   Name files like "03-blue-study.png" → ordered by prefix,
   titled "Blue Study".
   ============================================================ */

declare(strict_types=1);
header("Content-Type: application/json; charset=utf-8");

$dir  = __DIR__ . "/art";
$exts = ["jpg", "jpeg", "png", "webp", "avif", "gif", "svg"];
$out  = [];

$files = is_dir($dir) ? scandir($dir) : [];
natsort($files);

foreach ($files as $f) {
    $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
    if (!in_array($ext, $exts, true)) continue;

    $name  = pathinfo($f, PATHINFO_FILENAME);
    $name  = preg_replace('/^\d+[-_ ]*/', "", $name);   // strip ordering prefix
    $title = ucwords(str_replace(["-", "_"], " ", $name));

    $out[] = ["src" => "art/" . rawurlencode($f), "title" => $title];
}

echo json_encode(array_values($out));
