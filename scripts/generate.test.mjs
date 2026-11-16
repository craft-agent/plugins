import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { describe, test } from "node:test"
import { buildManifests, loadRelease, render } from "./generate.mjs"

const CATALOG = {
  name: "craft-agent",
  description: "Tool packages for coding agents by craft-agent.",
  owner: { name: "craftsamo", url: "https://github.com/craft-agent" },
  displayName: "craft-agent",
  packages: ["craft-agent/alpha-tools", "craft-agent/beta-tools", "craft-agent/gamma-tools"],
}

const SHAS = { "alpha-tools": "a".repeat(40), "beta-tools": "b".repeat(40) }
const TAGS = { "alpha-tools": "v1.2.0", "beta-tools": "v0.3.1" }

function files(name, overrides = {}) {
  return {
    ".claude-plugin/marketplace.json": {
      name: "craft-agent",
      plugins: [
        {
          name,
          source: "./",
          description: `${name} for Claude`,
          category: "development",
          version: "9.9.9",
          extra: true,
        },
      ],
    },
    ".agents/plugins/marketplace.json": {
      name: "craft-agent",
      plugins: [
        {
          name,
          source: { source: "local", path: "./" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Developer Tools",
        },
      ],
    },
    ".claude-plugin/plugin.json": { name, version: "1.0.0" },
    ...overrides,
  }
}

/** A GitHub stub holding alpha and beta, each with a release, and gamma without one. */
function stub(repoFiles = {}) {
  const answers = new Map()
  for (const repo of Object.keys(SHAS)) {
    const slug = `craft-agent/${repo}`
    answers.set(`repos/${slug}/releases/latest`, { tag_name: TAGS[repo] })
    answers.set(`repos/${slug}/commits/${TAGS[repo]}`, { sha: SHAS[repo] })
    for (const [file, value] of Object.entries(repoFiles[repo] ?? files(repo))) {
      const content = Buffer.from(JSON.stringify(value)).toString("base64")
      answers.set(`repos/${slug}/contents/${file}?ref=${SHAS[repo]}`, { content, encoding: "base64" })
    }
  }
  return (path) => answers.get(path) ?? null
}

function load(github) {
  return CATALOG.packages.map((slug) => loadRelease(slug, github))
}

describe("loadRelease", () => {
  test("reads the tag, its commit and the package's own files", () => {
    const released = loadRelease("craft-agent/alpha-tools", stub())
    assert.equal(released.tag, "v1.2.0")
    assert.equal(released.sha, SHAS["alpha-tools"])
    assert.equal(released.plugin.name, "alpha-tools")
  })

  test("returns no tag for a package without a release", () => {
    assert.deepEqual(loadRelease("craft-agent/gamma-tools", stub()), { slug: "craft-agent/gamma-tools", tag: null })
  })

  test("fails when a file is missing at the commit", () => {
    const github = stub({ "alpha-tools": { ".claude-plugin/marketplace.json": { plugins: [] } } })
    assert.throws(() => loadRelease("craft-agent/alpha-tools", github), /has no \.agents\/plugins\/marketplace\.json/)
  })
})

describe("buildManifests", () => {
  const { claude, codex, lines } = buildManifests(CATALOG, load(stub()))
  const source = (repo) => ({
    source: "url",
    url: `https://github.com/craft-agent/${repo}.git`,
    ref: TAGS[repo],
    sha: SHAS[repo],
  })

  test("pins each entry to the release url, keeping the entry's other fields", () => {
    assert.deepEqual(claude.plugins[0], {
      name: "alpha-tools",
      source: source("alpha-tools"),
      description: "alpha-tools for Claude",
      category: "development",
      extra: true,
    })
    assert.deepEqual(codex.plugins[1], {
      name: "beta-tools",
      source: source("beta-tools"),
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Developer Tools",
    })
  })

  test("drops version from every entry", () => {
    for (const entry of [...claude.plugins, ...codex.plugins]) assert.equal("version" in entry, false)
  })

  test("leaves out a package without a release", () => {
    assert.deepEqual(
      claude.plugins.map((entry) => entry.name),
      ["alpha-tools", "beta-tools"],
    )
    assert.equal(codex.plugins.length, 2)
  })

  test("summarises each package in catalog order", () => {
    assert.deepEqual(lines, [
      "alpha-tools v1.2.0 aaaaaaa",
      "beta-tools v0.3.1 bbbbbbb",
      "gamma-tools skipped: no release",
    ])
  })

  test("has the shape of each tool's marketplace", () => {
    assert.deepEqual(Object.keys(claude), ["$schema", "name", "description", "owner", "plugins"])
    assert.equal(claude.$schema, "https://anthropic.com/claude-code/marketplace.schema.json")
    assert.deepEqual(claude.owner, CATALOG.owner)
    assert.deepEqual(Object.keys(codex), ["name", "interface", "plugins"])
    assert.deepEqual(codex.interface, { displayName: "craft-agent" })
  })

  test("renders the same text every time, ending in a newline", () => {
    const again = buildManifests(CATALOG, load(stub()))
    assert.equal(render(claude), render(again.claude))
    assert.equal(render(codex), render(again.codex))
    assert.ok(render(claude).endsWith("}\n"))
  })
})

describe("name checks", () => {
  const build = (repoFiles) => buildManifests(CATALOG, load(stub(repoFiles)))

  test("fail when the plugin.json name differs", () => {
    const repoFiles = { "alpha-tools": files("alpha-tools", { ".claude-plugin/plugin.json": { name: "other" } }) }
    assert.throws(() => build(repoFiles), /alpha-tools: the names disagree/)
  })

  test("fail when an entry's name differs from the repository", () => {
    const codexOnly = files("alpha-tools")
    codexOnly[".agents/plugins/marketplace.json"].plugins[0].name = "renamed"
    assert.throws(() => build({ "alpha-tools": codexOnly }), /the names disagree/)
  })

  test("fail when a marketplace lists more than one plugin", () => {
    const two = files("alpha-tools")
    two[".claude-plugin/marketplace.json"].plugins.push({ name: "second", source: "./" })
    assert.throws(() => build({ "alpha-tools": two }), /must list exactly one plugin, found 2/)
  })

  test("fail when a marketplace lists no plugin", () => {
    const none = files("alpha-tools")
    delete none[".agents/plugins/marketplace.json"].plugins
    assert.throws(() => build({ "alpha-tools": none }), /must list exactly one plugin, found no/)
  })
})
