#!/usr/bin/env node
// Build pipeline for pet animation assets.
//
// 1. Normalizes the near-transparent background: source frames carry alpha=1
//    pixels behind the character. macOS/Web ignore that, but Windows'
//    color-key/layered rendering cannot; anything below MIN_ALPHA becomes
//    fully transparent (RGB zeroed too).
// 2. Re-encodes PNGs atomically when pixels changed.
// 3. Writes assets/animations/manifest.json with clip lengths, frame interval
//    and a content hash used for browser cache busting.
//
// Usage: node scripts/build-assets.mjs [--check]
//   --check  verify assets + manifest are up to date, exit 1 when stale.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
export const root = dirname(here)
export const animationsDir = join(root, 'assets', 'animations')
export const manifestPath = join(animationsDir, 'manifest.json')
export const FRAME_MS = 83
export const MIN_ALPHA = 8

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  return pb <= pc ? up : upLeft
}

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let colorType = -1
  let bitDepth = 0
  let interlace = 0
  let phys = null
  const idat = []
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + length)
    pos += length + 12
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'pHYs') {
      phys = Buffer.from(data)
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG (depth=${bitDepth} color=${colorType} interlace=${interlace})`)
  }
  const bpp = 4
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(stride * height)
  let prev = Buffer.alloc(stride)
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset]
    offset += 1
    const line = raw.subarray(offset, offset + stride)
    offset += stride
    const row = pixels.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0
      const up = prev[x]
      const upLeft = x >= bpp ? prev[x - bpp] : 0
      let value = line[x]
      if (filter === 1) value = (value + left) & 0xff
      else if (filter === 2) value = (value + up) & 0xff
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 0xff
      else if (filter === 4) value = (value + paeth(left, up, upLeft)) & 0xff
      else if (filter !== 0) throw new Error(`unsupported filter ${filter}`)
      row[x] = value
    }
    prev = row
  }
  return { width, height, pixels, phys }
}

export function encodePng({ width, height, pixels, phys = null }) {
  const bpp = 4
  const stride = width * bpp
  const raw = Buffer.alloc((stride + 1) * height)
  let out = 0
  let prev = Buffer.alloc(stride)
  const candidates = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)]
  for (let y = 0; y < height; y += 1) {
    const row = pixels.subarray(y * stride, (y + 1) * stride)
    let best = 0
    let bestScore = Infinity
    for (let filter = 0; filter < 5; filter += 1) {
      const target = candidates[filter]
      let score = 0
      for (let x = 0; x < stride; x += 1) {
        const left = x >= bpp ? row[x - bpp] : 0
        const up = prev[x]
        const upLeft = x >= bpp ? prev[x - bpp] : 0
        let predicted = 0
        if (filter === 1) predicted = left
        else if (filter === 2) predicted = up
        else if (filter === 3) predicted = (left + up) >> 1
        else if (filter === 4) predicted = paeth(left, up, upLeft)
        const value = (row[x] - predicted) & 0xff
        target[x] = value
        score += value < 128 ? value : 256 - value
      }
      if (score < bestScore) {
        bestScore = score
        best = filter
      }
    }
    raw[out] = best
    out += 1
    candidates[best].copy(raw, out)
    out += stride
    prev = row
  }
  const chunks = []
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  chunks.push(chunk('IHDR', ihdr))
  if (phys) chunks.push(chunk('pHYs', phys))
  chunks.push(chunk('IDAT', deflateSync(raw, { level: 9 })))
  chunks.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks])
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0)
  return Buffer.concat([head, data, crc])
}

export function normalizeAlpha(pixels) {
  let changedPixels = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < MIN_ALPHA) {
      if (pixels[i] || pixels[i + 1] || pixels[i + 2] || pixels[i + 3]) changedPixels += 1
      pixels[i] = 0
      pixels[i + 1] = 0
      pixels[i + 2] = 0
      pixels[i + 3] = 0
    }
  }
  return changedPixels
}

export function listClipFiles(dir = animationsDir) {
  const states = readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort()
  const clips = {}
  const files = []
  for (const state of states) {
    const names = readdirSync(join(dir, state))
      .filter((name) => name.endsWith('.png'))
      .sort()
    let expected = 1
    for (const name of names) {
      const frame = Number(name.slice(0, 3))
      if (!/^\d{3}\.png$/.test(name) || frame !== expected) {
        throw new Error(`unexpected frame ${state}/${name}; expected ${String(expected).padStart(3, '0')}.png`)
      }
      files.push(join(state, name))
      expected += 1
    }
    clips[state] = expected - 1
  }
  return { clips, files: files.sort() }
}

export function computeAssetVersion(files = listClipFiles().files, dir = animationsDir) {
  const hash = createHash('sha1')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(join(dir, file)))
  }
  return hash.digest('hex').slice(0, 12)
}

export function readManifest() {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

export function expectedManifest() {
  const { clips, files } = listClipFiles()
  return {
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    frameMs: FRAME_MS,
    assetVersion: computeAssetVersion(files),
    clips,
  }
}

export function build({ check = false } = {}) {
  const { files } = listClipFiles()
  let rewritten = 0
  let changedPixels = 0
  for (const file of files) {
    const path = join(animationsDir, file)
    const source = readFileSync(path)
    const image = decodePng(source)
    const changed = normalizeAlpha(image.pixels)
    if (!check) {
      const encoded = encodePng(image)
      if (!encoded.equals(source)) {
        writeFileSync(path, encoded)
        rewritten += 1
      }
      changedPixels += changed
    } else if (changed > 0) {
      rewritten += 1
      changedPixels += changed
    }
  }
  const manifest = expectedManifest()
  const existing = readManifest()
  const manifestStale = JSON.stringify(existing) !== JSON.stringify(manifest)
  if (check) {
    if (rewritten > 0) console.error(`${rewritten} frame(s) still carry near-transparent background pixels`)
    if (manifestStale) console.error('assets/animations/manifest.json is stale')
    if (rewritten > 0 || manifestStale) return { ok: false, rewritten, changedPixels, manifestStale }
    console.log(`assets ok: ${files.length} frames, clips ${JSON.stringify(manifest.clips)}, assetVersion ${manifest.assetVersion}`)
    return { ok: true, rewritten, changedPixels, manifestStale }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`rewrote ${rewritten} of ${files.length} frames (${changedPixels} near-transparent pixels cleaned)`)
  console.log(`manifest: clips ${JSON.stringify(manifest.clips)} assetVersion ${manifest.assetVersion}`)
  return { ok: true, rewritten, changedPixels, manifestStale }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (invokedDirectly) {
  const check = process.argv.includes('--check')
  const result = build({ check })
  if (!result.ok) process.exitCode = 1
}
