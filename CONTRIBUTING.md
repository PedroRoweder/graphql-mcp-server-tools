# Contributing to graphql-mcp-server-tools

## Getting Started

```bash
git clone https://github.com/pedroroweder/graphql-mcp-server-tools.git
cd graphql-mcp-server-tools
npm install
npm run build
npm test
```

## Development Workflow

1. Create a branch from `master`
2. Make your changes
3. Run `npm run build` then `npm test` to verify everything passes (CLI tests require the build output)
4. Open a pull request against `master`

## Commit Messages

This project follows conventional commits:

```
feat(scope): add new feature
fix(scope): correct a bug
docs(scope): update documentation
test(scope): add or update tests
refactor(scope): restructure without behavior change
```

## Running Tests

```bash
npm run build        # required before tests -- CLI tests depend on dist/
npm test             # run all tests
npm run test:watch   # re-run on file changes
```

## Code Style

- TypeScript with strict mode
- ESM modules (`"type": "module"`)
- Target: Node >= 18

## Pull Request Guidelines

- PRs require passing CI and at least one review before merging
- Keep PRs focused -- one feature or fix per PR
