#!/bin/sh
# usage: mac/build.sh [hub-url]   ->  mac/SmartNotch.app
# the url is baked in, so double-clicking the app works with no arguments.
set -e
cd "$(dirname "$0")"
URL="${1:-http://localhost:3000}"
APP=SmartNotch.app
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS"
swiftc -O NotchApp.swift -o "$APP/Contents/MacOS/SmartNotch" -framework Cocoa -framework WebKit
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>SmartNotch</string>
  <key>CFBundleIdentifier</key><string>com.nighthack.smartnotch</string>
  <key>CFBundleExecutable</key><string>SmartNotch</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
  <key>NotchURL</key><string>$URL</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "built mac/$APP -> $URL"
