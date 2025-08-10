<?php
// Set content type to PNG image
header('Content-Type: image/png');

// Get parameters with defaults
$cardType = isset($_GET['card']) ? $_GET['card'] : 'normal';
$character = isset($_GET['character']) ? $_GET['character'] : 'default';

// Define base directory
$baseDir = __DIR__;

// Determine which base card to use
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

// Check if base card exists, fallback to card.png if not
if (!file_exists($baseCardFile)) {
    $baseCardFile = $baseDir . '/card.png';
}

// Determine character image
$characterFile = $baseDir . '/media/' . $character . '.png';
if (!file_exists($characterFile)) {
    $characterFile = $baseDir . '/media/default.png';
}

// Check if files exist
if (!file_exists($baseCardFile)) {
    http_response_code(404);
    exit('Base card image not found');
}

if (!file_exists($characterFile)) {
    http_response_code(404);
    exit('Character image not found');
}

// Create canvas with base card dimensions (2500 x 3250)
$canvas = imagecreatetruecolor(2500, 3250);

// Load base card image
$baseCard = imagecreatefrompng($baseCardFile);
if (!$baseCard) {
    http_response_code(500);
    exit('Failed to load base card image');
}

// Copy base card to canvas
imagecopy($canvas, $baseCard, 0, 0, 0, 0, 2500, 3250);

// Load character image
$characterImg = imagecreatefrompng($characterFile);
if (!$characterImg) {
    http_response_code(500);
    exit('Failed to load character image');
}

// Get character image dimensions
$charWidth = imagesx($characterImg);
$charHeight = imagesy($characterImg);

// Create a 1000x1000 character image (resized)
$resizedChar = imagecreatetruecolor(1000, 1000);

// Enable alpha blending for transparency
imagealphablending($resizedChar, false);
imagesavealpha($resizedChar, true);
$transparent = imagecolorallocatealpha($resizedChar, 0, 0, 0, 127);
imagefill($resizedChar, 0, 0, $transparent);
imagealphablending($resizedChar, true);

// Resize character image to 1000x1000
imagecopyresampled($resizedChar, $characterImg, 0, 0, 0, 0, 1000, 1000, $charWidth, $charHeight);

// Calculate position to center the character image
// Canvas width: 2500, character width: 1000, so x = (2500 - 1000) / 2 = 750
// Y position: 420 pixels down from top
$charX = (2500 - 1000) / 2; // 750
$charY = 420;

// Enable alpha blending on canvas for transparency
imagealphablending($canvas, true);

// Copy character image to canvas at calculated position
imagecopy($canvas, $resizedChar, $charX, $charY, 0, 0, 1000, 1000);

// Output the final image
imagepng($canvas);

// Clean up memory
imagedestroy($canvas);
imagedestroy($baseCard);
imagedestroy($characterImg);
imagedestroy($resizedChar);
?>