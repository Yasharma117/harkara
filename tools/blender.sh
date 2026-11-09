#!/bin/zsh
# Run Blender headless from the HOARDE SSD, with its settings and caches kept on the SSD too.
#   tools/blender.sh --python tools/rig.py -- <args>
B=/Volumes/HOARDE/Applications/Blender.app/Contents/MacOS/Blender
[ -x "$B" ] || { echo "HOARDE isn't mounted (Blender lives on it)"; exit 1; }
export BLENDER_USER_CONFIG=/Volumes/HOARDE/blender-home/config BLENDER_USER_SCRIPTS=/Volumes/HOARDE/blender-home/scripts BLENDER_USER_DATAFILES=/Volumes/HOARDE/blender-home/datafiles TMPDIR=/Volumes/HOARDE/blender-home/tmp
mkdir -p "$TMPDIR"
exec "$B" --background --factory-startup "$@"
