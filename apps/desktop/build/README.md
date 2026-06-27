# Build resources

electron-builder reads platform icons from this directory:

- `icon.ico` — Windows (256×256, multi-size)
- `icon.icns` — macOS
- `icon.png` — Linux (512×512)

`icon.svg` here is the source artwork. Generate the platform icons from it (CI does
this, or run locally):

```bash
# requires imagemagick + png2icons (or electron-icon-builder)
npx electron-icon-builder --input=build/icon.svg --output=build
```

If no platform icon is present, electron-builder falls back to the default Electron icon
— builds still succeed.
