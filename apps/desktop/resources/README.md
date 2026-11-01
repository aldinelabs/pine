# App icons

`icon.icon` is the native Icon Composer document. Its SVG layer comes from
`src/assets/pine-logo.svg` with its charcoal foreground. Icon Composer applies
the `#fbfbf9` near-white background and `#1d1d16` charcoal layer fill, with a
135% composition scale to compensate for the source SVG's transparent padding.
The artwork has no custom enclosure mask; macOS supplies the rounded-square
treatment.

Run `bun apps/desktop/resources/generate-icons.mjs` on macOS with Xcode 26+ to
regenerate the compatibility assets. Apple's `actool` produces the legacy ICNS,
including its mask and padding. The PNG and Windows ICO derive from that output.

Electron Packager resolves the `resources/icon` base path to `.icon` and `.icns`
on macOS and `.ico` on Windows. On macOS it compiles the document to `Assets.car`
and sets `CFBundleIconName`, allowing the OS to render the native app icon.

Development runs inside `Electron.app`, whose bundle has Electron's identity
and icon catalog. `dock.setIcon()` replaces its displayed image with the generated
compatibility PNG; this API does not compile an Icon Composer document. It must
not run in a packaged Pine app, where it would replace the native resource.

References: [Apple Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer),
[Electron Forge icons](https://www.electronforge.io/guides/create-and-add-icons),
[Electron Dock API](https://www.electronjs.org/docs/latest/api/dock).

`generate-web-icons.mjs` renders the browser interface's home-screen icons and
favicon into `public/web/` with the same logo and colours, using the installed
Google Chrome through Playwright: `bun apps/desktop/resources/generate-web-icons.mjs`.
