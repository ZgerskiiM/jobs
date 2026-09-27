# WebCheck (repo-local snapshot)

This repository vendors the MIT-licensed WebCheck CLI at version 0.1.0 because the
public npm package named `webcheck` is a different project. Runtime code has no
third-party dependencies. Do not use `npx webcheck` here: that resolves the public,
unrelated package instead of this CLI.

## Usage

```bash
npm ci --prefix tools/webcheck
npm test --prefix tools/webcheck
npm run webcheck:local
npm run webcheck:staging -- http://devver.ru
```

The CLI supports `--config <path>` (or `--config=<path>`) so each run can use its own
required-check list. The project keeps local requirements in `.webcheck.yml` and
deployed-site requirements in `.webcheck.staging.yml`.

The remote audit checks deployed HTML, resources, redirect behavior, and security headers. The local audit checks project files, git hygiene, obvious secrets, debug settings, and the production build when the project exposes a `build` script.

Use `.webcheck.yml` to enable or disable categories:

```yaml
preset: default

checks:
  seo: true
  security: true
  accessibility: true
  deployment: true
  web: true
  performance: true
```

The `web` category checks deployed availability, crawls up to 12 same-origin pages, and checks their links and resources. `deployment` covers local repository hygiene, build and tests. The security audit also runs `npm audit --omit=dev` when an npm lockfile is present, so only production dependencies affect this result. Registry or network failures are reported as errors because dependency status could not be confirmed.

The `strict` preset makes `audit --ci` fail on warnings as well as errors. You can also require specific checks to pass; a required check that is skipped or not selected by configuration makes `audit --ci` fail:

```yaml
preset: strict
required-checks: deployment.tests,security.dependency-audit
```

Add `deployment.production-build` to the required list when your test command does not already run the production build.

`audit --ci` exits with code `1` when a critical or error result is present, when strict mode finds a warning, or when a required check does not pass. Choose required check IDs for the kind of audit you run: local project checks are skipped during a deployed-site audit, and remote checks are skipped during a local audit. Configuration errors are reported with a line number instead of being silently ignored.

The accessibility audit includes static HTML checks. For a rendered audit with axe-core, install the optional browser tools in the project and install Chromium:

```bash
npm install --save-dev playwright axe-core
npx playwright install chromium
```

Without Playwright, the rendered audit is reported as skipped; without axe-core, it falls back to rendered DOM checks for image alternatives, form labels and action names.
