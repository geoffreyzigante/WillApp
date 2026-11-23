#!/bin/bash
# Lance l'app Will dans l'iPhone virtuel (iOS 26.5) et le serveur de code.
# Usage : cd ~/WillApp && ./sim-ios.sh
UDID="EEC6EA6B-588B-413F-B222-C1062391785B"   # iPhone 17, iOS 26.5
cd "$(dirname "$0")"
xcrun simctl boot "$UDID" 2>/dev/null
open -a "Device Hub" 2>/dev/null || open -a Simulator 2>/dev/null
# Une fois le serveur lance, on ouvre l'app directement dessus.
( sleep 12; xcrun simctl openurl "$UDID" "exp+willapp://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" ) &
npx expo start --dev-client
