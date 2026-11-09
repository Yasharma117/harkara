#!/bin/zsh
# Run a Python tool in the image-to-3D environment, which lives in an APFS image on the HOARDE SSD.
I=/Volumes/HOARDE/harkara-ml.sparseimage; export ML=/Volumes/harkara-ml
[ -d "$ML" ] || hdiutil attach -quiet "$I" || { echo "HOARDE isn't mounted"; exit 1; }
export HF_HOME=$ML/hf U2NET_HOME=$ML/u2net TMPDIR=$ML/tmp PYTORCH_ENABLE_MPS_FALLBACK=1; mkdir -p $TMPDIR
exec $ML/venv/bin/python "$@"
