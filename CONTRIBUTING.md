# Contributing

Issues and pull requests are welcome. Explain the host environment, expected behavior, actual behavior, and reproduction steps. Use synthetic accounts and placeholder values in examples, logs, and screenshots; never include passwords, account-recovery data, private authentication material, access tokens, or customer data.

Use Node.js 20 or later. Install dependencies with `npm ci`, run `npm test -- --runInBand --watchman=false`, and run `npm run build`. For native changes, build a representative iOS or Android host and describe the platform and device tested. Tests must not require live production accounts, production credentials, or a model provider.

Keep changes host-agnostic and update documentation for public API changes. SDK native changes require a host rebuild. The hosted gateway is maintained separately and is not part of this repository.

By submitting a contribution, you agree it can be distributed under the [MIT license](LICENSE). Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
