<?php
header('Content-Type: image/png');
header('Cache-Control: public, max-age=3600');

// Get the data parameter
$data = $_GET['data'] ?? '';
$pixelData = explode('.', $data);

if (count($pixelData) !== 256) {
    // Return a 1x1 transparent pixel for invalid data
    $img = imagecreate(1, 1);
    imagecolortransparent($img, imagecolorallocate($img, 0, 0, 0));
    imagepng($img);
    imagedestroy($img);
    exit;
}

// Create a 16x16 image
$img = imagecreatetruecolor(16, 16);
imagesavealpha($img, true);

// Fill with white background
$white = imagecolorallocate($img, 255, 255, 255);
imagefill($img, 0, 0, $white);

// Process each pixel
for ($i = 0; $i < 256; $i++) {
    $hex = $pixelData[$i];
    $x = $i % 16;
    $y = intval($i / 16);
    
    if ($hex === "TRANSPARENT") {
        // Skip transparent pixels (keep white background)
        continue;
    } else if (strlen($hex) === 8) {
        // RRGGBBAA format
        $r = hexdec(substr($hex, 0, 2));
        $g = hexdec(substr($hex, 2, 2));
        $b = hexdec(substr($hex, 4, 2));
        $a = hexdec(substr($hex, 6, 2));
        
        if ($a === 0) {
            // Fully transparent, keep white background
            continue;
        } else if ($a === 255) {
            // Fully opaque
            $color = imagecolorallocate($img, $r, $g, $b);
        } else {
            // Blend with white background
            $blendR = intval(($r * $a + 255 * (255 - $a)) / 255);
            $blendG = intval(($g * $a + 255 * (255 - $a)) / 255);
            $blendB = intval(($b * $a + 255 * (255 - $a)) / 255);
            $color = imagecolorallocate($img, $blendR, $blendG, $blendB);
        }
    } else if (strlen($hex) === 6) {
        // RRGGBB format (full opacity)
        $r = hexdec(substr($hex, 0, 2));
        $g = hexdec(substr($hex, 2, 2));
        $b = hexdec(substr($hex, 4, 2));
        $color = imagecolorallocate($img, $r, $g, $b);
    } else {
        // Invalid format, default to white
        $color = imagecolorallocate($img, 255, 255, 255);
    }
    
    imagesetpixel($img, $x, $y, $color);
}

// Scale up the image by 20x
$scaledImg = imagecreatetruecolor(320, 320);
$white = imagecolorallocate($scaledImg, 255, 255, 255);
imagefill($scaledImg, 0, 0, $white);

// Use nearest neighbor scaling (no interpolation)
imagecopyresized($scaledImg, $img, 0, 0, 0, 0, 320, 320, 16, 16);

// Output the image
imagepng($scaledImg);

// Clean up
imagedestroy($img);
imagedestroy($scaledImg);
?>
