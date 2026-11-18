# Releasing

1. Bump `version` in `apps/desktop/package.json` (and `apps/server/package.json` if the server changed).
2. Check everything passes: `pnpm test && pnpm typecheck`.
3. Build the app on an Apple Silicon Mac.

   - **Signed and notarized** (official releases): needs a "Developer ID Application" certificate in the keychain and notarization credentials stored once with

     ```sh
     xcrun notarytool store-credentials prototyper --apple-id <apple-id> --team-id <team-id>
     ```

     (it asks for an app-specific password, created at appleid.apple.com). Then:

     ```sh
     APPLE_KEYCHAIN_PROFILE=prototyper pnpm --filter @prototyper/desktop dist:release
     ```

   - **Local build**: `pnpm --filter @prototyper/desktop dist`. It is signed if a Developer ID certificate is available (choose one with `CSC_NAME`), unsigned otherwise, and never notarized.

   The output is `apps/desktop/release/Prototyper-<version>-arm64.dmg`. Both scripts check that the main bundle parses before packaging.
4. Smoke-test the packaged app before publishing: open `apps/desktop/release/mac-arm64/Prototyper.app`, open a demo, check the preview builds. For notarized builds, `spctl -a -vv apps/desktop/release/mac-arm64/Prototyper.app` must say `source=Notarized Developer ID`.
5. Tag and publish:

   ```sh
   git tag v<version> && git push origin v<version>
   gh release create v<version> apps/desktop/release/Prototyper-<version>-arm64.dmg --title "Prototyper <version>" --notes-file <notes.md>
   ```

6. Update deployed share servers with `SSH_HOST=… ./deploy/deploy.sh` if the server or the overlay changed.
