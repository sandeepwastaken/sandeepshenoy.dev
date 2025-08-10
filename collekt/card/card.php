<?php
$scale = 0.2;
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
$canvas = imagecreatetruecolor(2500 * $scale, 3250 * $scale);

$baseCard = imagecreatefrompng($baseCardFile);
if (!$baseCard) {
    http_response_code(500);
    exit('Failed to load base card image');
}
imagecopy($canvas, $baseCard, 0, 0, 0, 0, 2500 * $scale, 3250 * $scale);
$characterImg = imagecreatefrompng($characterFile);
if (!$characterImg) {
    http_response_code(500);
    exit('Failed to load character image');
}
$charWidth = imagesx($characterImg);
$charHeight = imagesy($characterImg);
$resizedChar = imagecreatetruecolor(1000 * $scale, 1000 * $scale);
imagealphablending($resizedChar, false);
imagesavealpha($resizedChar, true);
$transparent = imagecolorallocatealpha($resizedChar, 0, 0, 0, 127);
imagefill($resizedChar, 0, 0, $transparent);
imagealphablending($resizedChar, true);
imagecopyresampled($resizedChar, $characterImg, 0, 0, 0, 0, 1000 * $scale, 1000 * $scale, $charWidth, $charHeight);
$charX = (2500 * $scale - 1000 * $scale) / 2;
$charY = 420 * $scale;
imagealphablending($canvas, true);
imagecopy($canvas, $resizedChar, $charX, $charY, 0, 0, 1000 * $scale, 1000 * $scale);
imagepng($canvas);
imagedestroy($canvas);
imagedestroy($baseCard);
imagedestroy($characterImg);
imagedestroy($resizedChar);
?>