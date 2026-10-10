#!/usr/bin/env bash
# Rebuilds the runtime textures in ../textures from the 8k source maps.
# Requires ImageMagick 7 and cwebp. Run from anywhere:  bash tools/build-textures.sh
#
# What it does, and why:
#  * Albedo: the source day map paints every ocean pixel the same srgb(30,59,117),
#    ~7x brighter than real water. Open-ocean reflectance is roughly
#    (0.002, 0.006, 0.025) in linear R,G,B (pi * Rrs for clear water, e.g. NASA
#    OBPG climatology). We scale ocean pixels by k = (0.13, 0.15, 0.14) in linear
#    light, which lands the flat ocean there and keeps shallow-bank turquoise
#    (Bahamas, reefs) at a plausible ~0.07-0.09. Sea ice (white under the water
#    mask) is excluded. Land is desaturated 12% (the source is boosted).
#    Alpha = water mask (1 = open water) used for sun glint.
#  * Clouds: stored as single-channel grey (the source is RGB grey: 3x the bytes).
#  * Lights: the Black Marble source has a navy base layer (~srgb(4..14,6..16,21..29))
#    that glowed across the whole night side. Keep only the red channel above that
#    floor; the shader tints it.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=.
OUT=textures
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

echo "albedo…"
magick "$SRC/8k_earth_daymap.jpg" -colorspace RGB "$TMP/D.miff"
magick "$SRC/8k_earth_specular_map.jpg" -colorspace Gray "$TMP/M.miff"
# ice = ramp on min(R,G,B) in linear light (white ice is bright in every channel, reefs are not)
magick "$TMP/D.miff" -separate -evaluate-sequence min -level 15%,45% "$TMP/ice.miff"
magick "$TMP/M.miff" \( "$TMP/ice.miff" -negate \) -compose multiply -composite "$TMP/W.miff"
magick "$TMP/D.miff" \( +clone -grayscale Rec709Luminance \) \
  -compose blend -define compose:args=12,88 -composite "$TMP/Dland.miff"
magick "$TMP/D.miff" -color-matrix "0.13 0 0  0 0.15 0  0 0 0.14" "$TMP/Docean.miff"
magick "$TMP/Dland.miff" "$TMP/Docean.miff" "$TMP/W.miff" -composite -colorspace sRGB "$TMP/rgb.miff"

for size in 8192 4096; do
  tag=$([ $size = 8192 ] && echo 8k || echo 4k)
  # Resize colour and mask separately: an alpha-weighted resize zeroes RGB under alpha=0.
  magick "$TMP/rgb.miff" -resize ${size}x$((size/2)) \
    \( "$TMP/W.miff" -resize ${size}x$((size/2)) \) -alpha off -compose CopyOpacity -composite \
    "$TMP/albedo_$tag.png"
  # cwebp -exact keeps RGB under alpha=0 (land); ImageMagick's WebP encoder zeroes it.
  cwebp -quiet -exact -q 90 -alpha_q 100 -m 6 "$TMP/albedo_$tag.png" -o "$OUT/albedo_$tag.webp"
  magick "$SRC/8k_earth_clouds.jpg" -colorspace Gray -resize ${size}x$((size/2)) \
    -quality 82 "$OUT/clouds_$tag.jpg"
  magick "$SRC/8k_earth_nightmap.jpg" -channel R -separate +channel -level 7%,100% \
    -resize ${size}x$((size/2)) -quality 90 "$OUT/lights_$tag.jpg"
done

echo "normal…"
magick "$SRC/8k_earth_normal_map.jpg" -resize 4096x2048 -quality 94 "$OUT/normal_4k.jpg"
magick "$SRC/8k_earth_normal_map.jpg" -resize 2048x1024 -quality 94 "$OUT/normal_2k.jpg"

echo "moon…"
magick "$SRC/8k_moon.jpg" -resize 2048x1024 -quality 88 "$OUT/moon_2k.jpg"

ls -la "$OUT"
