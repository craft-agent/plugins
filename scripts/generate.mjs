import { execFileSync } from "node:child_process"
import { Buffer } from "node:buffer"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/**
 * Generates the two marketplaces of this repository, `.claude-plugin/marketplace.json`
 * (Claude Code) and `.agents/plugins/marketplace.json` (Codex), from `catalog.json`.
 * Each package in the catalog is pinned to the tag and commit of its latest GitHub
 * release; its own marketplace entries are copied as they are, with only `source`
 * replaced. A package with no release yet is left out.
 * `--check` writes nothing and fails when a file would change.
 */

const ROOT = new URL("../", import.meta.url)
const CATALOG_FILE = "catalog.json"
const CLAUDE_MARKETPLACE = ".claude-plugin/marketplace.json"
const CODEX_MARKETPLACE = ".agents/plugins/marketplace.json"
const CLAUDE_PLUGIN = ".claude-plugin/plugin.json"
const CLAUDE_SCHEMA = "https://anthropic.com/claude-code/marketplace.schema.json"
const SHORT_SHA_LENGTH = 7
const NOT_FOUND = /HTTP 404/

/**
 * @typedef {{ name: string, description: string, owner: object, displayName: string, packages: string[] }} Catalog
 * @typedef {(path: string) => unknown} GitHub Answers a GitHub REST path with its parsed JSON, or `null` on a 404.
 * @typedef {{ slug: string, tag: null }} Unreleased
 * @typedef {{ slug: string, tag: string, sha: string, claude: object, codex: object, plugin: object }} Released
 */

/**
 * Asks the GitHub REST API through `gh`, which the Actions runner has and
 * authenticates with `GH_TOKEN`.
 * @type {GitHub}
 */
export function ghApi(path) {
  try {
    const output = execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    return JSON.parse(output)
  } catch (error) {
    const stderr = String(error.stderr ?? "")
    if (NOT_FOUND.test(stderr)) return null
    throw new Error(`gh api ${path} failed: ${stderr.trim() || error.message}`, { cause: error })
  }
}

function repoName(slug) {
  return slug.split("/")[1]
}

function readJsonFile(github, slug, sha, file) {
  const answer = github(`repos/${slug}/contents/${file}?ref=${sha}`)
  if (answer === null) throw new Error(`${slug} at ${sha.slice(0, SHORT_SHA_LENGTH)} has no ${file}.`)
  return JSON.parse(Buffer.from(answer.content, "base64").toString("utf8"))
}

/**
 * Reads a package's latest release and, at the commit its tag names, the files
 * its entries are built from.
 * @param {string} slug `owner/repo`
 * @param {GitHub} github
 * @returns {Released | Unreleased}
 */
export function loadRelease(slug, github) {
  const release = github(`repos/${slug}/releases/latest`)
  if (release === null) return { slug, tag: null }
  const tag = release.tag_name
  const commit = github(`repos/${slug}/commits/${tag}`)
  if (commit === null) throw new Error(`${slug} has no commit for its release tag ${tag}.`)
  const { sha } = commit
  return {
    slug,
    tag,
    sha,
    claude: readJsonFile(github, slug, sha, CLAUDE_MARKETPLACE),
    codex: readJsonFile(github, slug, sha, CODEX_MARKETPLACE),
    plugin: readJsonFile(github, slug, sha, CLAUDE_PLUGIN),
  }
}

function onlyEntry(marketplace, slug, file) {
  const plugins = marketplace?.plugins
  if (!Array.isArray(plugins) || plugins.length !== 1) {
    const count = Array.isArray(plugins) ? plugins.length : "no"
    throw new Error(`${slug}: ${file} must list exactly one plugin, found ${count}.`)
  }
  return plugins[0]
}

function pinEntry(entry, slug, tag, sha) {
  const { version: _version, ...rest } = entry
  return { ...rest, source: { source: "url", url: `https://github.com/${slug}.git`, ref: tag, sha } }
}

/**
 * Pins a released package: checks that the repository, `plugin.json` and both
 * entries share one name (Codex refuses an install whose names differ), then
 * copies each entry with only `source` replaced.
 * @param {Released} released
 * @returns {{ claude: object, codex: object }}
 */
export function pinPackage({ slug, tag, sha, claude, codex, plugin }) {
  const claudeEntry = onlyEntry(claude, slug, CLAUDE_MARKETPLACE)
  const codexEntry = onlyEntry(codex, slug, CODEX_MARKETPLACE)
  const names = {
    repository: repoName(slug),
    [CLAUDE_PLUGIN]: plugin?.name,
    [CLAUDE_MARKETPLACE]: claudeEntry.name,
    [CODEX_MARKETPLACE]: codexEntry.name,
  }
  if (new Set(Object.values(names)).size !== 1) {
    const found = Object.entries(names)
      .map(([where, name]) => `${where}: ${JSON.stringify(name)}`)
      .join(", ")
    throw new Error(`${slug}: the names disagree (${found}); they must all be the repository name.`)
  }
  return { claude: pinEntry(claudeEntry, slug, tag, sha), codex: pinEntry(codexEntry, slug, tag, sha) }
}

/**
 * Builds both marketplaces from the catalog and what each package's release
 * holds. Pure: no GitHub access, no files.
 * @param {Catalog} catalog
 * @param {(Released | Unreleased)[]} packages in catalog order
 * @returns {{ claude: object, codex: object, lines: string[] }} the two manifests and one summary line per package
 */
export function buildManifests(catalog, packages) {
  const claudePlugins = []
  const codexPlugins = []
  const lines = []
  for (const released of packages) {
    if (released.tag === null) {
      lines.push(`${repoName(released.slug)} skipped: no release`)
      continue
    }
    const pinned = pinPackage(released)
    claudePlugins.push(pinned.claude)
    codexPlugins.push(pinned.codex)
    lines.push(`${repoName(released.slug)} ${released.tag} ${released.sha.slice(0, SHORT_SHA_LENGTH)}`)
  }
  return {
    claude: {
      $schema: CLAUDE_SCHEMA,
      name: catalog.name,
      description: catalog.description,
      owner: catalog.owner,
      plugins: claudePlugins,
    },
    codex: { name: catalog.name, interface: { displayName: catalog.displayName }, plugins: codexPlugins },
    lines,
  }
}

/**
 * Renders a manifest as the text written to disk.
 * @param {object} value
 */
export function render(value) {
  return JSON.stringify(value, null, 2) + "\n"
}

function readIfExists(url) {
  try {
    return readFileSync(url, "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
}

/**
 * Regenerates the marketplaces, or with `--check` only reports whether they are out of date.
 * @param {string[]} argv
 * @param {GitHub} [github]
 * @returns {number} the exit code
 */
export function main(argv, github = ghApi) {
  const check = argv.includes("--check")
  const catalog = JSON.parse(readFileSync(new URL(CATALOG_FILE, ROOT), "utf8"))
  const packages = catalog.packages.map((slug) => {
    if (!/^[^/\s]+\/[^/\s]+$/.test(slug)) throw new Error(`${CATALOG_FILE}: "${slug}" is not an owner/repo.`)
    const loaded = loadRelease(slug, github)
    if (loaded.tag === null) console.error(`warning: ${slug} has no release yet; left out of the marketplaces.`)
    return loaded
  })
  const { claude, codex, lines } = buildManifests(catalog, packages)
  for (const line of lines) console.log(line)

  const outOfDate = []
  for (const [file, manifest] of [
    [CLAUDE_MARKETPLACE, claude],
    [CODEX_MARKETPLACE, codex],
  ]) {
    const url = new URL(file, ROOT)
    const text = render(manifest)
    const changed = readIfExists(url) !== text
    console.log(`${file} ${changed ? "changed" : "unchanged"}`)
    if (!changed) continue
    outOfDate.push(file)
    if (check) continue
    mkdirSync(dirname(fileURLToPath(url)), { recursive: true })
    writeFileSync(url, text)
  }

  if (check && outOfDate.length > 0) {
    console.error(`${outOfDate.join(", ")} out of date; run \`pnpm run generate\` and commit the result.`)
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
