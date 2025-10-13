<?php

$scale = isset($_GET['scale']) ? floatval($_GET['scale']) : 0.2;

$scale = max(0.1, min(2.0, $scale));

header('Content-Type: image/png');
$cardType = isset($_GET['card']) ? $_GET['card'] : 'normal';
$character = isset($_GET['character']) ? $_GET['character'] : 'default';
$baseDir = __DIR__;
$baseCardFile = '';
switch ($cardType) {
    case 'gold':
        $baseCardFile = $baseDir . '/goldCard.png';
        break;
    case 'rainbow':
        $baseCardFile = $baseDir . '/rainbowCard.png';
        break;
    case 'normal':
    default:
        $baseCardFile = $baseDir . '/card.png';
        break;
}
if (!file_exists($baseCardFile)) {
    $baseCardFile = $baseDir . '/card.png';
}
$characterFile = $baseDir . '/media/' . $character . '.png';
if (!file_exists($characterFile)) {
    $characterFile = $baseDir . '/media/default.png';
}
if (!file_exists($baseCardFile)) {
    http_response_code(404);
    exit('Base card image not found');
}
if (!file_exists($characterFile)) {
    http_response_code(404);
    exit('Character image not found');
}


$targetWidth = 2500 * $scale;
$targetHeight = 3250 * $scale;

$canvas = imagecreatetruecolor($targetWidth, $targetHeight);

imagealphablending($canvas, false);
imagesavealpha($canvas, true);
$transparent = imagecolorallocatealpha($canvas, 0, 0, 0, 127);
imagefill($canvas, 0, 0, $transparent);
imagealphablending($canvas, true);

$baseCard = imagecreatefrompng($baseCardFile);
if (!$baseCard) {
    http_response_code(500);
    exit('Failed to load base card image');
}


$baseCardWidth = imagesx($baseCard);
$baseCardHeight = imagesy($baseCard);


imagecopyresampled($canvas, $baseCard, 0, 0, 0, 0, $targetWidth, $targetHeight, $baseCardWidth, $baseCardHeight);
$characterImg = imagecreatefrompng($characterFile);
if (!$characterImg) {
    http_response_code(500);
    exit('Failed to load character image');
}

$charWidth = imagesx($characterImg);
$charHeight = imagesy($characterImg);


$scaledCharWidth = 1000 * $scale;
$scaledCharHeight = 1000 * $scale;

$resizedChar = imagecreatetruecolor($scaledCharWidth, $scaledCharHeight);
imagealphablending($resizedChar, false);
imagesavealpha($resizedChar, true);
$transparent = imagecolorallocatealpha($resizedChar, 0, 0, 0, 127);
imagefill($resizedChar, 0, 0, $transparent);
imagealphablending($resizedChar, true);


imagecopyresampled($resizedChar, $characterImg, 0, 0, 0, 0, $scaledCharWidth, $scaledCharHeight, $charWidth, $charHeight);


$charX = ($targetWidth - $scaledCharWidth) / 2;
$charY = 420 * $scale;


imagealphablending($canvas, true);
imagecopy($canvas, $resizedChar, $charX, $charY, 0, 0, $scaledCharWidth, $scaledCharHeight);
imagepng($canvas);
imagedestroy($canvas);
imagedestroy($baseCard);
imagedestroy($characterImg);
imagedestroy($resizedChar);
?>