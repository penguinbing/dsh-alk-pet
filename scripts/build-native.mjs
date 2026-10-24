#!/usr/bin/env node
/**
 * Build the macOS native pet helper atomically into runtime/bin/darwin/.
 *
 * Plain swiftc is preferred. Some CommandLineTools installs ship an SDK built
 * by a slightly older beta compiler than the installed swiftc reports; that
 * combination aborts with "this SDK is not supported by the compiler". The
 * fallback clones the SDK (APFS copy-on-write where possible) into a temp dir,
 * rewrites the compiler version strings inside its .swiftinterface files to
 * match the installed compiler, and builds against that patched SDK.
 *
 * Usage: node scripts/build-native.mjs
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native/macos/Pet.swift')
const target = join(root, 'runtime/bin/darwin/dsh-alk-pet-helper')
const targetDir = dirname(target)
let buildOutput = ''
let stagingToClean = ''
const mismatchPattern = /SDK is not supported by the compiler|is not supported by the compiler|unsupported SDK|SDK.*not supported/i

function log(message) {
  console.log(`[build-native] ${message}`)
}

function fail(message) {
  console.error(`[build-native] error: ${message}`)
  process.exit(1)
}

process.on('exit', () => {
  if (stagingToClean) rmSync(stagingToClean, { recursive: true, force: true })
})

function removeStaleStagingDirs() {
  let entries = []
  try {
    entries = readdirSync(targetDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('.build-tmp-')) {
      rmSync(join(targetDir, entry.name), { recursive: true, force: true })
    }
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  }
}

function describe(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
}

function buildWithSwiftc(extraArgs, moduleCache) {
  const args = [
    'swiftc',
    ...extraArgs,
    '-module-cache-path',
    moduleCache,
    '-O',
    source,
    '-o',
    buildOutput,
  ]
  return run('xcrun', args, {
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: moduleCache,
    },
  })
}

function fileDescription(path) {
  const result = run('file', ['-b', path])
  return result.status === 0 ? result.stdout.trim() : ''
}

function verifyBinary(path, label) {
  if (!existsSync(path)) fail(`${label}: expected binary at ${path} was not produced`)
  const description = fileDescription(path)
  if (!/Mach-O/i.test(description)) fail(`${label}: output is not a Mach-O executable (${description || 'no file output'})`)
  const expectedArch = process.arch === 'x64' ? 'x86_64' : process.arch
  if (expectedArch && !description.includes(expectedArch)) {
    fail(`${label}: expected ${expectedArch} but got "${description}"`)
  }
  return description
}

function readSwiftInterfaceFiles(rootDir) {
  const files = []
  const walk = (directory) => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.swiftinterface')) files.push(path)
    }
  }
  walk(rootDir)
  return files
}

function compilerVersionTokens() {
  const result = run('xcrun', ['swiftc', '--version'])
  const output = describe(result)
  const swiftlang = output.match(/swiftlang-[0-9][0-9.]*/)?.[0]
  const clang = output.match(/clang-[0-9][0-9.]*/)?.[0]
  if (!swiftlang || !clang) fail(`unable to parse swiftc version from: ${output || 'empty output'}`)
  return { swiftlang, clang, output }
}

function patchedSdkBuild(moduleCache) {
  const { swiftlang, clang, output } = compilerVersionTokens()
  log(`compiler: ${output.split('\n')[0]} (${swiftlang}, ${clang})`)

  const sdkResult = run('xcrun', ['--show-sdk-path'])
  const sdkPath = sdkResult.stdout.trim()
  if (sdkResult.status !== 0 || !sdkPath || !existsSync(sdkPath)) fail('unable to locate the macOS SDK with: xcrun --show-sdk-path')
  const resolvedSdk = realpathSync(sdkPath)
  log(`patched-SDK fallback: cloning SDK ${resolvedSdk}`)

  const workRoot = mkdtempSync(join(tmpdir(), 'dsh-alk-pet-sdk-'))
  const patchedSdk = join(workRoot, 'sdk')
  try {
    let copied = run('cp', ['-cR', resolvedSdk, patchedSdk])
    if (copied.status !== 0) {
      log('APFS clone copy unavailable, falling back to a regular copy')
      copied = run('cp', ['-R', resolvedSdk, patchedSdk])
    }
    if (copied.status !== 0) fail(`failed to copy the SDK: ${describe(copied)}`)

    const swiftInterfaces = readSwiftInterfaceFiles(join(patchedSdk, 'usr/lib/swift'))
    if (swiftInterfaces.length === 0) fail('no .swiftinterface files found in the copied SDK')
    let patched = 0
    for (const file of swiftInterfaces) {
      const text = readFileSync(file, 'utf8')
      const next = text
        .replace(/swiftlang-[0-9][0-9.]*/g, swiftlang)
        .replace(/clang-[0-9][0-9.]*/g, clang)
      if (next !== text) {
        writeFileSync(file, next)
        patched += 1
      }
    }
    log(`patched ${patched}/${swiftInterfaces.length} swift interface files to ${swiftlang} / ${clang}`)

    const result = buildWithSwiftc(['-sdk', patchedSdk], moduleCache)
    if (result.status !== 0) fail(`patched-SDK swiftc build failed:\n${describe(result)}`)
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
  }
}

function main() {
  if (process.platform !== 'darwin') {
    log('skipping native helper build: macOS only (existing helper left untouched)')
    return
  }
  if (!existsSync(source)) fail(`source not found: ${source}`)
  mkdirSync(targetDir, { recursive: true })
  removeStaleStagingDirs()

  const staging = join(targetDir, `.build-tmp-${process.pid}-${Date.now()}`)
  stagingToClean = staging
  const moduleCache = join(staging, 'modulecache')
  mkdirSync(moduleCache, { recursive: true })
  buildOutput = join(staging, 'dsh-alk-pet-helper')

  const startedAt = Date.now()
  try {
    log(`building ${source}`)
    let result = buildWithSwiftc([], moduleCache)
    if (result.status !== 0) {
      const output = describe(result)
      if (!mismatchPattern.test(output)) fail(`swiftc build failed:\n${output}`)
      log('plain swiftc rejected this SDK/compiler combination; retrying with a patched SDK clone')
      patchedSdkBuild(moduleCache)
    } else {
      log('plain swiftc build succeeded')
    }

    const description = verifyBinary(buildOutput, 'fresh build')
    chmodSync(buildOutput, 0o755)
    renameSync(buildOutput, target)
    const finalDescription = verifyBinary(target, 'installed helper')
    const bytes = statSync(target).size
    log(`installed ${target}`)
    log(`  ${finalDescription}`)
    log(`  ${(bytes / 1024).toFixed(1)} KiB, verification: ${description === finalDescription ? 'ok' : 'changed during move'}`)
    log(`done in ${Date.now() - startedAt}ms`)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

main()
