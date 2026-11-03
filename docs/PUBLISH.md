# Publishing the SDK

This guide is for package maintainers. Consumers should follow the [integration guide](INTEGRATION.md). The hosted gateway is maintained and deployed separately; it is not published in the npm package or public SDK repository.

1. Check the changelog, package metadata, version, and supported platforms. npm versions are immutable; choose a new semantic version for each release.
2. Run `npm ci`, `npm test -- --runInBand --watchman=false`, and `npm run build`. Verify native changes in representative hosts.
3. Inspect `npm pack --dry-run` and the resulting tarball. Never include environment files, credentials, host app data, build caches, or private code.
4. Authenticate to `https://registry.npmjs.org/` using an account with publishing rights. npm may require two-factor authentication for publication. Keep tokens out of the repository.
5. Publish with `npm publish --access public --registry https://registry.npmjs.org/`. Verify the version, dist-tag, and artifact integrity in the registry, allowing for cache propagation.

If the registry reports a staged release, a maintainer must review and approve it before it is publicly installable. Follow [npm's staged publishing documentation](https://docs.npmjs.com/staged-publishing/).
