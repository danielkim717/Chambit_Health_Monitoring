#!/usr/bin/env bash
# User-local tools for the verified JetPack 6.2 / Python 3.10 deployment.
# Does not install/upgrade Ubuntu or replace system Python/CUDA.
set -euo pipefail
[[ "$(uname -m)" == aarch64 ]] || { echo 'This bootstrap targets Linux aarch64.' >&2; exit 1; }
python3 -c 'import sys; assert sys.version_info[:2] == (3, 10), "Expected Python 3.10"'
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cache="$HOME/.cache/chambit-setup"
mkdir -p -- "$cache" "$HOME/.local/lib" "$HOME/.local/bin"
fetch_checked() {
    local url="$1" file="$2" digest="$3"
    if [[ ! -f "$file" ]]; then
        curl --fail --location --retry 2 --connect-timeout 20 --max-time 1200 "$url" -o "$file.download"
        printf '%s  %s\n' "$digest" "$file.download" | sha256sum --check -
        mv -- "$file.download" "$file"
    fi
    printf '%s  %s\n' "$digest" "$file" | sha256sum --check -
}
node_version=v22.23.4
node_folder="node-$node_version-linux-arm64"
fetch_checked "https://nodejs.org/dist/$node_version/$node_folder.tar.xz" "$cache/$node_folder.tar.xz" \
    6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b
if [[ ! -d "$HOME/.local/lib/$node_folder" ]]; then
    tar -xJf "$cache/$node_folder.tar.xz" -C "$HOME/.local/lib"
fi
for command in node npm npx; do
    if [[ ! -e "$HOME/.local/bin/$command" && ! -L "$HOME/.local/bin/$command" ]]; then
        ln -s "$HOME/.local/lib/$node_folder/bin/$command" "$HOME/.local/bin/$command"
    fi
done
# PyPA's versioned-Python endpoint may change. A mismatch requires reviewing an update.
fetch_checked https://bootstrap.pypa.io/virtualenv/3.10/virtualenv.pyz "$cache/virtualenv.pyz" \
    596fdc9d21af010ac7570eafa144f6f4d4ff1c06f308ed0ca4fcd77e7595f077
if [[ ! -x "$root/.venv/bin/python" ]]; then
    python3 "$cache/virtualenv.pyz" --no-periodic-update "$root/.venv"
fi
"$root/.venv/bin/python" -m pip install --only-binary=:all: \
    -r "$root/inference/requirements-jetson.txt" -r "$root/inference/requirements-jetson-lock.txt"
wheel=torch-2.8.0-cp310-cp310-linux_aarch64.whl
fetch_checked "https://pypi.jetson-ai-lab.io/jp6/cu126/+f/62a/1beee9f2f1470/$wheel" "$cache/$wheel" \
    62a1beee9f2f147076a974d2942c90060c12771c94740830327cae705b2595fc
"$root/.venv/bin/python" -m pip install -c "$root/inference/requirements-jetson-lock.txt" "$cache/$wheel"
"$root/.venv/bin/python" - <<'PY'
import numpy as np
import torch
assert torch.cuda.is_available(), 'CUDA unavailable; do not use a CPU-only PyPI torch build.'
value = torch.from_numpy(np.ones(4, dtype=np.float32)).to('cuda').sum().item()
assert value == 4.0
print('GPU and NumPy interoperability OK:', torch.__version__, torch.cuda.get_device_name(0))
PY
echo 'Node and isolated CUDA Python environment ready. Next: install models and verify.py --local.'
