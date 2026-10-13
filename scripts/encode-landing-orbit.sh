#!/bin/sh
# Original Blender still -> periodic, silent hero fallback. Run from repository root.
set -eu
poster=${1:?Pass the absolute path to the Blender poster.png}
output=web/public/landing
mkdir -p "$output"
cwebp -quiet -q 85 "$poster" -o "$output/orbit-poster.webp"
cwebp -quiet -q 82 -crop 950 0 950 1080 -resize 760 864 "$poster" -o "$output/orbit-mobile.webp"
ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$poster" -vf "zoompan=z='1.015+0.012*sin(2*PI*on/192)':x='iw-iw/zoom':y='(ih-ih/zoom)/2':d=1:s=1920x1080:fps=24,format=yuv420p" -frames:v 192 -c:v libx264 -preset fast -crf 21 -threads 2 -an -movflags +faststart "$output/orbit-1080.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$output/orbit-1080.mp4" -c:v libvpx-vp9 -b:v 0 -crf 32 -row-mt 1 -threads 2 -an "$output/orbit-1080.webm"
ffmpeg -hide_banner -loglevel error -y -i "$output/orbit-1080.mp4" -vf 'scale=1280:720' -c:v libvpx-vp9 -b:v 0 -crf 33 -row-mt 1 -threads 2 -an "$output/orbit-720.webm"
