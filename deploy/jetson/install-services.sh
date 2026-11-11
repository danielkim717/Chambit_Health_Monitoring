#!/usr/bin/env bash
# Run as the development user after installing a CUDA-capable project venv.
# --check validates prerequisites without changing services; --user avoids sudo.
set -euo pipefail
mode=install
scope=system
for arg in "$@"; do
    case "$arg" in
        --check) mode=--check ;;
        --user) scope=user ;;
        *) echo 'Usage: bash install-services.sh [--user] [--check]' >&2; exit 2 ;;
    esac
done
[[ $EUID -ne 0 ]] || { echo 'Run as the project owner, not with sudo.' >&2; exit 2; }
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
owner="$(id -un)"
node_bin="$(command -v node)"
python_bin="$root/.venv/bin/python"
# Keep systemd path/argument escaping unambiguous. Use ~/apps/Chambit_Health_Monitoring.
for value in "$root" "$node_bin" "$owner"; do
    [[ "$value" =~ ^[a-zA-Z0-9_./-]+$ ]] || { echo "Use a deployment path without spaces or special characters: $value" >&2; exit 2; }
done
[[ -x "$python_bin" ]] || { echo "Missing project Python: $python_bin" >&2; exit 1; }
"$node_bin" -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
cd "$root"
# Fail before touching services if CUDA, actual checkpoints, or browser assets fail.
INFERENCE_DEVICE=cuda "$python_bin" deploy/jetson/verify.py --local
tmp="$(mktemp -d)"
trap 'rm -f -- "$tmp/chambit-inference.service" "$tmp/chambit-web.service"; rmdir -- "$tmp"' EXIT
user_line="User=$owner"
network_line='After=network.target'
web_after='After=network.target chambit-inference.service'
wanted=multi-user.target
ctl=(systemctl)
analyze=(systemd-analyze)
if [[ "$scope" == user ]]; then
    user_line=''
    network_line=''
    web_after='After=chambit-inference.service'
    wanted=default.target
    ctl=(systemctl --user)
    analyze=(systemd-analyze --user)
fi
cat >"$tmp/chambit-inference.service" <<EOF
[Unit]
Description=Chambit health inference (Jetson)
$network_line
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
$user_line
WorkingDirectory=$root
Environment=INFERENCE_DEVICE=cuda
Environment=TORCH_THREADS=2
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=-$root/chambit_health_demo/.env
ExecStart=$python_bin -m uvicorn inference.app:app --host 127.0.0.1 --port 8000 --ws-max-size 60000 --ws-max-queue 8
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=$wanted
EOF
cat >"$tmp/chambit-web.service" <<EOF
[Unit]
Description=Chambit health web (Jetson)
Wants=chambit-inference.service
$web_after
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
$user_line
WorkingDirectory=$root/chambit_health_demo
EnvironmentFile=-$root/chambit_health_demo/.env
# Deployment ports stay fixed even if a PC .env was copied accidentally.
ExecStart=/usr/bin/env PORT=5500 INFERENCE_URL=http://127.0.0.1:8000 $node_bin server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=$wanted
EOF
"${analyze[@]}" verify "$tmp/chambit-inference.service" "$tmp/chambit-web.service"
if [[ "$mode" == --check ]]; then
    cat "$tmp/chambit-inference.service" "$tmp/chambit-web.service"
    exit 0
fi
stamp="$(date +%Y%m%dT%H%M%S)"
if [[ "$scope" == user ]]; then
    destination="$HOME/.config/systemd/user"
    mkdir -p -- "$destination"
    privileged=()
else
    sudo -v
    destination=/etc/systemd/system
    privileged=(sudo)
fi
for name in chambit-inference chambit-web; do
    target="$destination/$name.service"
    if "${privileged[@]}" test -e "$target"; then "${privileged[@]}" cp -a -- "$target" "$target.before-$stamp"; fi
    "${privileged[@]}" install -m 0644 -- "$tmp/$name.service" "$target"
done
"${privileged[@]}" "${ctl[@]}" daemon-reload
"${privileged[@]}" "${ctl[@]}" enable chambit-inference.service chambit-web.service
"${privileged[@]}" "${ctl[@]}" restart chambit-inference.service chambit-web.service
"$python_bin" deploy/jetson/verify.py --url http://127.0.0.1:5500 --wait 120
if [[ "$scope" == user ]] && [[ "$(loginctl show-user "$owner" -p Linger --value)" != yes ]]; then
    echo "Services run now. For boot startup without login, run: sudo loginctl enable-linger $owner"
fi
