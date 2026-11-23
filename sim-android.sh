#!/bin/bash
# Cree (la premiere fois) et lance un Android virtuel, puis installe l'app Will.
# Usage : cd ~/WillApp && ./sim-android.sh
cd "$(dirname "$0")"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
AVD="will-pixel"

for outil in emulator adb; do
  command -v "$outil" >/dev/null || { echo "Manque : $outil (Android Studio > Settings > Android SDK > SDK Tools : coche Android Emulator et Platform-Tools)."; exit 1; }
done

# Un Android virtuel existe deja (cree dans Android Studio) : on le reutilise.
EXISTANT=$(emulator -list-avds 2>/dev/null | head -1)
if [ -n "$EXISTANT" ]; then
  AVD="$EXISTANT"
  echo "Android virtuel utilise : $AVD"
else
  for outil in sdkmanager avdmanager; do
    command -v "$outil" >/dev/null || { echo "Aucun Android virtuel et pas d'outil pour en creer un. Dans Android Studio : Settings > Android SDK > SDK Tools > coche 'Android SDK Command-line Tools (latest)', puis relance. Ou cree-en un dans Device Manager."; exit 1; }
  done
  IMG=$(ls -d "$ANDROID_HOME"/system-images/*/google_apis*/arm64-v8a 2>/dev/null | sort | tail -1)
  if [ -n "$IMG" ]; then
    PKG="system-images;$(basename "$(dirname "$(dirname "$IMG")")");$(basename "$(dirname "$IMG")");arm64-v8a"
  else
    PKG="system-images;android-35;google_apis;arm64-v8a"
    yes | sdkmanager --licenses >/dev/null 2>&1
    sdkmanager "$PKG" || exit 1
  fi
  echo "Creation de l'Android virtuel avec $PKG"
  echo no | avdmanager create avd -n "$AVD" -k "$PKG" -d pixel_8 --force || exit 1
fi

# Lancement de l'emulateur (en arriere-plan) puis attente du demarrage complet.
adb devices | grep -q emulator || (nohup emulator -avd "$AVD" >/dev/null 2>&1 &)
echo "Demarrage de l'emulateur..."
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
echo "Emulateur pret. Installation de l'app..."
if lsof -i :8081 >/dev/null 2>&1; then
  # Un serveur tourne deja (lance par sim-ios.sh) : on s'y branche au lieu d'en demarrer un second.
  adb reverse tcp:8081 tcp:8081
  npx expo run:android --no-bundler
  adb shell am start -a android.intent.action.VIEW -d "exp+willapp://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null
else
  npx expo run:android
fi
