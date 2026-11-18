# Releasing

1. Bump `version` in `apps/desktop/package.json` (and `apps/server/package.json` if the server changed).
2. Check everything passes: `pnpm test && pnpm typecheck`.
3. Build the app on an Apple Silicon Mac:

   ```sh
   pnpm --filter @prototyper/desktop dist
   ```

   This builds the app, checks the main bundle parses, and writes `apps/desktop/release/Prototyper-<version>-arm64.dmg`.
4. Smoke-test the packaged app before publishing: open `apps/desktop/release/mac-arm64/Prototyper.app`, open a demo, and check the preview builds.
5. Tag and publish:

   ```sh
   git tag v<version> && git push origin v<version>
   gh release create v<version> apps/desktop/release/Prototyper-<version>-arm64.dmg --title "Prototyper <version>" --notes-file <notes.md>
   ```

6. Update deployed share servers with `SSH_HOST=… ./deploy/deploy.sh` if the server or the overlay changed.

The app is not code-signed yet. Signing and notarization need an Apple Developer ID; when available, set `mac.identity` in `apps/desktop/electron-builder.yml` and add notarization.
