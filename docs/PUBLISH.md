# Publishing the SDK

This guide is for package maintainers. Consumers should follow the [integration guide](INTEGRATION.md). The gateway lives elsewhere in the monorepo and is deployed separately; it is never included in the npm package.

1. From the repository root, enter the package directory with `cd sdks/typescript`. Check the changelog, package metadata, version, and supported platforms. npm versions are immutable; choose a new semantic version for each release.
2. Run `npm ci` and `npm run build`; maintainers must also run the private test suite. Verify native changes in representative hosts.
3. Inspect `npm pack --dry-run` and the resulting tarball. Never include environment files, credentials, host app data, build caches, or private code.
4. Configure `NPM_TOKEN` in the repository root `.env`. The release script requires `npm whoami` to be exactly `intentcomputing`, pins npmjs, and never passes the token in command arguments. The root `.npmrc` must reference `${NPM_TOKEN}` rather than contain a literal token.
5. Run `npm run release -- /absolute/path/to/audited-package.tgz` to publish the inspected artifact. The script checks its package name, version, registry and wire-reported SDK version. Verify the public registry version, dist-tag and integrity, then reinstall the exact version in a clean consumer directory.

Run the repository's N/N-1/N-2 protocol matrix against the unpacked candidate
before release. Keep protocol, conformance, deployment/configuration docs and
the changelog aligned. A UI compatibility patch does not justify enabling a
minimum-version block or emergency force-update threshold.

If the registry reports a staged release, a maintainer must review and approve it before it is publicly installable. Follow [npm's staged publishing documentation](https://docs.npmjs.com/staged-publishing/).

The public source checkout is flat. The mirrored maintainer scripts run from
the maintained monorepo release workspace (`sdks/typescript` plus its sibling
gateway and root private configuration); do not invoke bare `npm publish`
from this source checkout.
