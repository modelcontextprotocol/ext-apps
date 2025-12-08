# Contributing to MCP Apps SDK

We welcome contributions to the MCP Apps SDK! This document outlines the process for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/ext-apps.git`
3. Install dependencies: `npm install`
4. Build the project: `npm run build`
5. Run tests: `npm test`

## Development Process

1. Create a new branch for your changes
2. Make your changes
3. Run `npm run prettier` to ensure code style compliance
4. Run `npm test` to verify all tests pass
5. Submit a pull request

## Pull Request Guidelines

- Follow the existing code style
- Include tests for new functionality
- Update documentation as needed
- Keep changes focused and atomic
- Provide a clear description of changes

## Running Examples

Start the development environment with hot reloading:

```bash
npm run examples:dev
```

Or build and run examples:

```bash
npm run examples:start
```

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). Please review it before contributing.

## Reporting Issues

- Use the [GitHub issue tracker](https://github.com/modelcontextprotocol/ext-apps/issues)
- Search existing issues before creating a new one
- Provide clear reproduction steps

## Security Issues

Please review our [Security Policy](SECURITY.md) for reporting security vulnerabilities.

---

## For Maintainers

### Repository Setup

Before publishing releases, ensure the following are configured:

1. **NPM_TOKEN secret**: Add an npm automation token to the repository secrets
   - Go to Settings � Secrets and variables � Actions
   - Create a new secret named `NPM_TOKEN`
   - Value: an npm automation token with publish permissions for `@modelcontextprotocol/ext-apps`

2. **`release` environment** (optional): Create a protected environment for additional safeguards
   - Go to Settings � Environments � New environment
   - Name it `release`
   - Add required reviewers or other protection rules as needed

### Publishing a Release

Releases are published automatically via GitHub Actions when a GitHub Release is created.

#### Steps to publish:

1. **Update the version** in `package.json`:

   ```bash
   # For a regular release
   npm version patch  # or minor, or major

   # For a beta release
   npm version prerelease --preid=beta
   ```

2. **Commit the version bump** (if not done by `npm version`):

   ```bash
   git add package.json
   git commit -m "Bump version to X.Y.Z"
   git push origin main
   ```

3. **Create a GitHub Release**:
   - Go to [Releases](https://github.com/modelcontextprotocol/ext-apps/releases)
   - Click "Draft a new release"
   - Create a new tag matching the version (e.g., `v0.1.0`)
   - Set the target branch (usually `main`)
   - Write release notes describing the changes
   - Click "Publish release"

4. **Monitor the workflow**:
   - The [npm-publish workflow](https://github.com/modelcontextprotocol/ext-apps/actions/workflows/npm-publish.yml) will trigger automatically
   - It runs build and test jobs before publishing
   - On success, the package is published to npm with provenance

#### npm Tags

The workflow automatically determines the npm dist-tag:

| Version Pattern               | npm Tag       | Install Command                                          |
| ----------------------------- | ------------- | -------------------------------------------------------- |
| `X.Y.Z` (from main)           | `latest`      | `npm install @modelcontextprotocol/ext-apps`             |
| `X.Y.Z-beta.N`                | `beta`        | `npm install @modelcontextprotocol/ext-apps@beta`        |
| `X.Y.Z` (from release branch) | `release-X.Y` | `npm install @modelcontextprotocol/ext-apps@release-X.Y` |

#### Maintenance Releases

To release a patch for an older version:

1. Create a release branch from the tag: `git checkout -b release-0.1 v0.1.0`
2. Cherry-pick or apply fixes
3. Bump the patch version
4. Create a GitHub Release targeting the release branch
5. The package will be published with tag `release-0.1`

### Testing Pre-releases

Every commit and PR automatically publishes a preview package via [pkg-pr-new](https://github.com/pkg-pr-new/pkg-pr-new). Check the PR comments or workflow logs for the install command.

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
