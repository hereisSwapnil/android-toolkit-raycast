<p align="center">
  <img src="assets/command-icon.png" width="128" alt="Android Toolkit Icon" />
</p>

<h1 align="center">Android Toolkit for Raycast</h1>

<p align="center">
  A powerful Raycast extension to manage Android devices via ADB — right from your keyboard.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Raycast-Extension-FF6363?style=flat-square&logo=raycast" />
  <img src="https://img.shields.io/badge/Platform-macOS-black?style=flat-square&logo=apple" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" />
</p>

---

## ✨ Features

| Command                   | Description                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| 🗂 **Manage Users & Apps** | List all device profiles (Personal, Work), browse & search installed apps with readable names             |
| 📦 **Install APK**        | Pick an `.apk` file from Finder and install it to any user profile                                        |
| 📸 **Take Screenshot**    | Capture the device screen and copy it directly to clipboard                                               |
| 📱 **Manage Devices**     | List connected ADB devices, pair Android 11+ devices with QR codes, connect via Wi-Fi, restart ADB server |

### App Management Actions

For each app in **Manage Users & Apps**, you can:

- **Open Logs in Terminal** — streams live logcat filtered by package name
- **Clear App Data** — wipe storage and cache (`Cmd+Shift+Backspace`)
- **Uninstall App** — removes app from the selected profile (`Ctrl+X`)

---

## 🚀 Installation

### Install from GitHub Releases

1. Open the latest release on GitHub
2. Download the attached `android-toolkit-raycast-v*.zip` file
3. Import or install the built extension from the Raycast extension workflow you use locally

### Install from Source

**Prerequisites:**

- [Raycast](https://raycast.com/) installed
- [Node.js](https://nodejs.org/) (v18+) and npm
- Android Debug Bridge (`adb`) installed — via [Android SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools)

**Steps:**

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/android-toolkit-raycast.git
cd android-toolkit-raycast

# Install dependencies
npm install

# Start development server (loads the extension into Raycast)
npm run dev
```

Raycast will automatically detect and load the extension. Search for any of the commands above!

---

## ⚙️ Configuration

Open Raycast Preferences (`Cmd + ,`) → **Extensions** → **Android Toolkit** to configure:

| Setting                  | Default | Description                                                             |
| ------------------------ | ------- | ----------------------------------------------------------------------- |
| **ADB Executable Path**  | `adb`   | Full path to `adb` binary if not in `$PATH` (e.g. `/usr/local/bin/adb`) |
| **Show System Profiles** | Off     | Show hidden profiles like Dual App (95), Secure Folder (150)            |

### Finding your ADB path

```bash
which adb
# Example output: /usr/local/bin/adb
# or: /Users/you/Library/Android/sdk/platform-tools/adb
```

---

## 🔌 ADB Setup

**Connect via USB:**

```bash
# Enable Developer Options on your device, then enable USB Debugging
adb devices  # Should list your device
```

**Pair wirelessly with QR code on Android 11+ (from Manage Devices command):**

1. Connect your Mac and Android device to the same Wi-Fi network
2. On Android, open **Developer Options** → **Wireless debugging**
3. In Raycast, open **Manage Devices** → **Pair with QR Code**
4. On Android, tap **Pair device with QR code** and scan the Raycast QR code
5. Raycast will detect the scan over mDNS, pair with `adb`, and connect the device

**Pair wirelessly with pairing code on Android 11+ (fallback):**

1. Connect your Mac and Android device to the same Wi-Fi network
2. On Android, open **Developer Options** → **Wireless debugging**
3. Tap **Pair device with pairing code**
4. In Raycast, open **Manage Devices** → **Pair with Pairing Code**
5. Enter the pairing address, pairing code, and optionally the device address shown by Android
6. If you skipped the device address, use **Connect to Paired Device** afterward

The QR flow uses the same Android wireless debugging QR payload format as Android Studio.

**Connect via Wi-Fi after an initial USB connection:**

1. Connect device via USB first
2. Open **Manage Devices** → select device → **Enable Wireless Debugging**
3. Disconnect USB
4. Use **Connect to Paired Device** with the device Wi-Fi IP and port `5555`

---

## 📄 License

MIT © [Swapnil](https://github.com/YOUR_USERNAME)
