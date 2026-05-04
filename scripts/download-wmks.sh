#!/bin/bash
# Download wmks.js and related files for ESXi console

set -e

# Output directory
OUT_DIR="public/lib/wmks"
mkdir -p "$OUT_DIR/css"
mkdir -p "public/lib"

echo "Downloading wmks files..."

# Download wmks.js from VMware PowerCLI module
# Using raw.githubusercontent.com for reliable access
curl -sL "https://raw.githubusercontent.com/PowerShell/PowerCLI/main/Modules/VimAutomation.Core/en-US/about_VsphereClientProtocol.ps1" > /dev/null 2>&1 || true

# Alternative: download from jsdelivr but use the unminified version first to check
# Then copy the working version

# Download jQuery (small, reliable)
echo "Downloading jQuery..."
curl -sL "https://code.jquery.com/jquery-3.7.1.min.js" -o "public/lib/jquery.min.js"

# Download jQuery UI
echo "Downloading jQuery UI..."
curl -sL "https://code.jquery.com/ui/1.13.2/jquery-ui.min.js" -o "public/lib/jquery-ui.min.js"

# Download wmks files from jsdelivr
echo "Downloading wmks.js..."
curl -sL "https://cdn.jsdelivr.net/npm/vmware-wmks@1.0.0/wmks.min.js" -o "$OUT_DIR/wmks.min.js"

# Download wmks CSS
echo "Downloading wmks CSS..."
curl -sL "https://cdn.jsdelivr.net/npm/vmware-wmks@1.0.0/css/css/wmks-all.min.css" -o "$OUT_DIR/css/wmks-all.min.css"

echo "Done! Files downloaded to:"
echo "  public/lib/jquery.min.js"
echo "  public/lib/jquery-ui.min.js"
echo "  public/lib/wmks/wmks.min.js"
echo "  public/lib/wmks/css/wmks-all.min.css"
