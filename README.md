# plugins

One plugin marketplace for Claude Code and Codex that lists every
[craft-agent](https://github.com/craft-agent) tool package. Each package is
pinned to its latest GitHub release, tag and commit, and a nightly workflow
moves the pins when a package releases.

## Install

Packages released before this marketplace named their own marketplace
`craft-agent` too. If you added one of them, remove it first
(`claude plugin marketplace remove craft-agent`, or
`codex plugin marketplace remove craft-agent`): a name can stand for only one
marketplace at a time.

### Claude Code

```sh
claude plugin marketplace add craft-agent/plugins
claude plugin install <package>@craft-agent
```

To update:

```sh
claude plugin marketplace update craft-agent
claude plugin update <package>@craft-agent
```

### Codex

```sh
codex plugin marketplace add craft-agent/plugins
codex plugin add <package>@craft-agent
```

To update, upgrade the marketplace, then add the package again:

```sh
codex plugin marketplace upgrade craft-agent
codex plugin add <package>@craft-agent
```

## Packages

| Package            | Repository                                                                      |
| ------------------ | ------------------------------------------------------------------------------- |
| `github-tools`     | [craft-agent/github-tools](https://github.com/craft-agent/github-tools)         |
| `git-tools`        | [craft-agent/git-tools](https://github.com/craft-agent/git-tools)               |
| `cloudflare-tools` | [craft-agent/cloudflare-tools](https://github.com/craft-agent/cloudflare-tools) |
| `discord-tools`    | [craft-agent/discord-tools](https://github.com/craft-agent/discord-tools)       |
| `telegram-tools`   | [craft-agent/telegram-tools](https://github.com/craft-agent/telegram-tools)     |
| `whatsapp-tools`   | [craft-agent/whatsapp-tools](https://github.com/craft-agent/whatsapp-tools)     |
| `signal-tools`     | [craft-agent/signal-tools](https://github.com/craft-agent/signal-tools)         |
| `google-tools`     | [craft-agent/google-tools](https://github.com/craft-agent/google-tools)         |
| `x-tools`          | [craft-agent/x-tools](https://github.com/craft-agent/x-tools)                   |

A package that has no release yet is left out until its first release.

## Pinning a version

This marketplace follows the latest release. To pin a package to a version,
install it from its own repository's marketplace as its README says, and do not
install the same package from both marketplaces: both tools would then load one
of its two copies of the MCP server or hooks.

## Maintaining

To list a package, add its repository to `packages` in `catalog.json`, the only
file edited by hand, run `pnpm run generate` and commit the result. The package
must list exactly one plugin in its `.claude-plugin/marketplace.json` and
`.agents/plugins/marketplace.json`, and name it as its repository.

The `Update catalog` workflow runs every night and commits the new pins to
`main`; it can also be run by hand from the Actions tab. `pnpm run generate`
needs an authenticated `gh`, and `node scripts/generate.mjs --check` fails when
the manifests are out of date.

## License

[MIT](LICENSE)
