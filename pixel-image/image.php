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

// Fill with transparent background
$transparent = imagecolorallocatealpha($img, 0, 0, 0, 127);
imagefill($img, 0, 0, $transparent);

// Process each pixel
for ($i = 0; $i < 256; $i++) {
    $hex = $pixelData[$i];
    $x = $i % 16;
    $y = intval($i / 16);
    
    if ($hex === "TRANSPARENT") {
        // Skip transparent pixels (already filled with transparent background)
        continue;
    } else {
        // Check if hex includes alpha channel (8 characters instead of 6)
        if (strlen($hex) === 8) {
            // Extract RGBA values
            $r = hexdec(substr($hex, 0, 2));
            $g = hexdec(substr($hex, 2, 2));
            $b = hexdec(substr($hex, 4, 2));
            $a = hexdec(substr($hex, 6, 2));
            
            // Convert alpha from 0-255 to 0-127 (GD format)
            $alpha = intval((255 - $a) / 2);
            $color = imagecolorallocatealpha($img, $r, $g, $b, $alpha);
        } else {
            // Standard RGB (6 characters)
            $r = hexdec(substr($hex, 0, 2));
            $g = hexdec(substr($hex, 2, 2));
            $b = hexdec(substr($hex, 4, 2));
            
            $color = imagecolorallocate($img, $r, $g, $b);
        }
        
        imagesetpixel($img, $x, $y, $color);
    }
}

// Scale up the image by 20x
$scaledImg = imagecreatetruecolor(320, 320);
imagesavealpha($scaledImg, true);
$transparent = imagecolorallocatealpha($scaledImg, 0, 0, 0, 127);
imagefill($scaledImg, 0, 0, $transparent);

// Use nearest neighbor scaling (no interpolation)
imagecopyresized($scaledImg, $img, 0, 0, 0, 0, 320, 320, 16, 16);

// Output the image
imagepng($scaledImg);

// Clean up
imagedestroy($img);
imagedestroy($scaledImg);
?>
