# Placeholder Assets

## Required Images

The following images must be provided before running `flutter_launcher_icons` and `flutter_native_splash`:

1. `assets/images/app_icon.png` - 1024x1024 app icon (full square)
2. `assets/images/app_icon_foreground.png` - 1024x1024 adaptive icon foreground (Android)
3. `assets/images/splash_logo.png` - 1152x1152 splash screen logo

## Generate Icons

After placing the images, run:

```bash
cd apps/ozzyl_health
flutter pub get
flutter pub run flutter_launcher_icons:main
flutter pub run flutter_native_splash:create
```

## Brand Guidelines

- Primary color: `#0f172a` (dark navy)
- Accent color: `#088eaf` (teal)
- Background: `#0f172a` (dark) / `#ffffff` (light)
