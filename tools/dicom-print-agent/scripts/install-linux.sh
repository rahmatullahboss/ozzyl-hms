#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Ozzyl HMS — DICOM Print Agent: Linux/macOS Service Installer
#
# Installs the agent as a systemd service (Linux) or launchd plist (macOS)
# ═══════════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"
NODE_PATH="$(which node)"
SERVICE_NAME="ozzyl-dicom-print"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   Ozzyl HMS — DICOM Print Agent Service Installer        ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Check for Node.js
if [ -z "$NODE_PATH" ]; then
    echo "[ERROR] Node.js is not installed."
    echo "Install with: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "$AGENT_DIR/node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    cd "$AGENT_DIR"
    npm install
fi

# Detect OS
if [ "$(uname)" = "Linux" ]; then
    # ─── Linux: systemd service ─────────────────────────────────────────────
    echo "[INFO] Creating systemd service..."

    sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=Ozzyl HMS DICOM Print Agent
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${AGENT_DIR}
# Note: The agent directory should be the dist output which contains agent.js
ExecStart=/usr/bin/env node ${AGENT_DIR}/agent.js
Restart=always
RestartSec=10
StandardOutput=append:${AGENT_DIR}/logs/service.log
StandardError=append:${AGENT_DIR}/logs/service-error.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable ${SERVICE_NAME}
    sudo systemctl start ${SERVICE_NAME}

    echo ""
    echo "[OK] Service installed and started!"
    echo ""
    echo "Manage the service with:"
    echo "  sudo systemctl status ${SERVICE_NAME}"
    echo "  sudo systemctl stop ${SERVICE_NAME}"
    echo "  sudo systemctl restart ${SERVICE_NAME}"
    echo "  journalctl -u ${SERVICE_NAME} -f  (view logs)"

elif [ "$(uname)" = "Darwin" ]; then
    # ─── macOS: launchd plist ───────────────────────────────────────────────
    PLIST_PATH="$HOME/Library/LaunchAgents/com.ozzyl.dicom-print-agent.plist"
    echo "[INFO] Creating macOS LaunchAgent..."

    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ozzyl.dicom-print-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${AGENT_DIR}/src/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${AGENT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${AGENT_DIR}/logs/service.log</string>
    <key>StandardErrorPath</key>
    <string>${AGENT_DIR}/logs/service-error.log</string>
</dict>
</plist>
EOF

    launchctl load "$PLIST_PATH"

    echo ""
    echo "[OK] LaunchAgent installed and started!"
    echo ""
    echo "Manage with:"
    echo "  launchctl list | grep ozzyl"
    echo "  launchctl unload $PLIST_PATH  (to stop)"
fi

echo ""
