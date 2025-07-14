<?php

if (!isset($_GET['data'])) {
  http_response_code(400);
  exit("Missing data");
}

$hexValues = explode(".", $_GET['data']);
if (count($hexValues) !== 256) {
  http_response_code(400);
  exit("Expected 256 hex values");
}

$img = imagecreatetruecolor(16, 16);
imagesavealpha($img, true);
$transparent = imagecolorallocatealpha($img, 0, 0, 0, 127);
imagefill($img, 0, 0, $transparent);

foreach ($hexValues as $i => $hex) {
  $x = $i % 16;
  $y = intdiv($i, 16);
  $r = hexdec(substr($hex, 0, 2));
  $g = hexdec(substr($hex, 2, 2));
  $b = hexdec(substr($hex, 4, 2));
  $color = imagecolorallocate($img, $r, $g, $b);
  imagesetpixel($img, $x, $y, $color);
}

header("Content-Type: image/png");
imagepng($img);
imagedestroy($img);