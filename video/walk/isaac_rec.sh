#!/usr/bin/env bash
# Record the Isaac Lab window, maximized in front (its viewport fills it: the sink runs with --/app/window/hideUi=true),
# through desktop duplication (gdigrab reads a stale frame from DX12 windows), cropped to the viewport, at 30 fps, near
# lossless, into build/walk/isaac.mkv (Matroska survives being stopped). The wall-clock start goes to isaac_start.txt
# so cut.mjs can line it up with the browser's frames. Stop it with: touch build/walk/ISAAC_STOP
FF=/c/Users/dhrce/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg
B="$(dirname "$0")/../build/walk"
mkdir -p "$B"; rm -f "$B/ISAAC_STOP"
T=$(date +%s.%N); echo "$T" > "$B/isaac_start_${T%.*}.txt"
"$FF" -v error -y -f lavfi -i "ddagrab=output_idx=0:framerate=30" -vf "hwdownload,format=bgra,crop=2400:1350:80:32,format=yuv420p" -c:v libx264 -preset ultrafast -crf 14 "$B/isaac_${T%.*}.mkv" &
pid=$!
while [ ! -f "$B/ISAAC_STOP" ] && kill -0 $pid 2>/dev/null; do sleep 0.5; done
kill -INT $pid 2>/dev/null; wait $pid
echo "isaac recording stopped"
