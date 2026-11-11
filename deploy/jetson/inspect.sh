#!/usr/bin/env bash
# Read-only inventory. No credentials or environment-file contents are printed.
set -u
printf '\n== Device ==\n'
uname -a
if [[ -r /proc/device-tree/model ]]; then tr -d '\0' </proc/device-tree/model; printf '\n'; fi
cat /etc/os-release
[[ ! -r /etc/nv_tegra_release ]] || cat /etc/nv_tegra_release
printf '\n== Resources ==\n'
free -h
df -h /
printf '\n== Network ==\n'
hostname -I
systemctl is-active ssh || true
printf '\n== Runtimes ==\n'
command -v python3 && python3 --version
command -v node && node --version
command -v npm && npm --version
command -v docker && docker --version
dpkg-query -W 'nvidia-jetpack' 'nvidia-l4t-core' 'cuda-toolkit-*' 2>/dev/null || true
printf '\n== System Python GPU check (project venv is checked separately) ==\n'
python3 - <<'PY'
try:
    import torch
    print('torch:', torch.__version__, 'compiled CUDA:', torch.version.cuda)
    print('CUDA available:', torch.cuda.is_available())
    if torch.cuda.is_available():
        print('device:', torch.cuda.get_device_name(0))
except Exception as exc:
    print(type(exc).__name__ + ': ' + str(exc))
PY
