import { spawn } from 'child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
  unlinkSync
} from 'fs'
import { basename, dirname, extname, join } from 'path'
import { dialog, BrowserWindow } from 'electron'
import type {
  EncryptionAssetInfo,
  EncryptionRunResult,
  EncryptionSettings,
  EncryptionUploadResult
} from '../../shared/types'
import { getPaths, getSettings, setSettings } from '../db/database'
import { logInteraction } from '../db/history'

const SCRIPT_DIR = 'encryption'
const SCRIPT_STORED = 'custom_encrypt.py'
const KEY_STORED = 'encryption.key'

function encryptionDir(): string {
  const dir = join(getPaths().userData, SCRIPT_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getEncryptionAssetInfo(): EncryptionAssetInfo {
  const dir = encryptionDir()
  const settings = getSettings().encryption
  const scriptPath = settings.scriptPath || join(dir, SCRIPT_STORED)
  const keyPath = settings.keyPath || join(dir, KEY_STORED)
  return {
    encryptionDir: dir,
    scriptPath: existsSync(scriptPath) ? scriptPath : settings.scriptPath,
    scriptOriginalName: settings.scriptOriginalName,
    scriptExists: existsSync(scriptPath),
    keyPath: existsSync(keyPath) ? keyPath : settings.keyPath,
    keyOriginalName: settings.keyOriginalName,
    keyExists: existsSync(keyPath)
  }
}

function safeOriginalName(name: string, fallback: string): string {
  const base = basename(name || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
  return base || fallback
}

/** Store an uploaded script (bytes from renderer) under userData/encryption. */
export function saveEncryptionScript(
  data: Uint8Array | number[],
  originalName: string
): EncryptionUploadResult {
  try {
    const dir = encryptionDir()
    const dest = join(dir, SCRIPT_STORED)
    const buf = Buffer.from(data instanceof Uint8Array ? data : Uint8Array.from(data))
    writeFileSync(dest, buf)
    const name = safeOriginalName(originalName, 'encrypt.py')
    const enc = getSettings().encryption
    setSettings({
      ...getSettings(),
      encryption: {
        ...enc,
        scriptPath: dest,
        scriptOriginalName: name
      }
    })
    logInteraction('encryption_script_upload', { name, path: dest, bytes: buf.length })
    return { ok: true, path: dest, originalName: name }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Store an uploaded key file under userData/encryption. */
export function saveEncryptionKey(
  data: Uint8Array | number[],
  originalName: string
): EncryptionUploadResult {
  try {
    const dir = encryptionDir()
    const dest = join(dir, KEY_STORED)
    const buf = Buffer.from(data instanceof Uint8Array ? data : Uint8Array.from(data))
    writeFileSync(dest, buf)
    const name = safeOriginalName(originalName, 'key.bin')
    const enc = getSettings().encryption
    setSettings({
      ...getSettings(),
      encryption: {
        ...enc,
        keyPath: dest,
        keyOriginalName: name
      }
    })
    logInteraction('encryption_key_upload', { name, path: dest, bytes: buf.length })
    return { ok: true, path: dest, originalName: name }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Pick script via native dialog (alternative to drag-drop). */
export async function pickEncryptionScript(
  sender: Electron.WebContents
): Promise<EncryptionUploadResult> {
  const win = BrowserWindow.fromWebContents(sender) ?? BrowserWindow.getFocusedWindow()
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: 'Select encryption Python script',
        filters: [
          { name: 'Python', extensions: ['py'] },
          { name: 'All files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })
    : await dialog.showOpenDialog({
        title: 'Select encryption Python script',
        filters: [
          { name: 'Python', extensions: ['py'] },
          { name: 'All files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, error: 'Canceled' }
  }
  const src = result.filePaths[0]
  const dir = encryptionDir()
  const dest = join(dir, SCRIPT_STORED)
  copyFileSync(src, dest)
  const name = basename(src)
  const enc = getSettings().encryption
  setSettings({
    ...getSettings(),
    encryption: { ...enc, scriptPath: dest, scriptOriginalName: name }
  })
  return { ok: true, path: dest, originalName: name }
}

export async function pickEncryptionKey(
  sender: Electron.WebContents
): Promise<EncryptionUploadResult> {
  const win = BrowserWindow.fromWebContents(sender) ?? BrowserWindow.getFocusedWindow()
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: 'Select encryption key file',
        properties: ['openFile']
      })
    : await dialog.showOpenDialog({
        title: 'Select encryption key file',
        properties: ['openFile']
      })

  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, error: 'Canceled' }
  }
  const src = result.filePaths[0]
  const dir = encryptionDir()
  const dest = join(dir, KEY_STORED)
  copyFileSync(src, dest)
  const name = basename(src)
  const enc = getSettings().encryption
  setSettings({
    ...getSettings(),
    encryption: { ...enc, keyPath: dest, keyOriginalName: name }
  })
  return { ok: true, path: dest, originalName: name }
}

export function clearEncryptionScript(): void {
  const info = getEncryptionAssetInfo()
  if (info.scriptPath && existsSync(info.scriptPath)) {
    try {
      unlinkSync(info.scriptPath)
    } catch {
      /* ignore */
    }
  }
  const enc = getSettings().encryption
  setSettings({
    ...getSettings(),
    encryption: {
      ...enc,
      scriptPath: undefined,
      scriptOriginalName: undefined
    }
  })
}

export function clearEncryptionKey(): void {
  const info = getEncryptionAssetInfo()
  if (info.keyPath && existsSync(info.keyPath)) {
    try {
      unlinkSync(info.keyPath)
    } catch {
      /* ignore */
    }
  }
  const enc = getSettings().encryption
  setSettings({
    ...getSettings(),
    encryption: {
      ...enc,
      keyPath: undefined,
      keyOriginalName: undefined
    }
  })
}

/**
 * Build command from template.
 * Placeholders: {python} {script} {key} {input} {output}
 * {output} is optional — omit it if your script names the encrypted file itself.
 */
export function buildInvokeCommand(
  template: string,
  vars: {
    script: string
    key: string
    input: string
    output?: string
    python?: string
  }
): string {
  const python = vars.python || (process.platform === 'win32' ? 'python' : 'python3')
  const replaceToken = (s: string, token: string, value: string): string =>
    s.split(token).join(value)
  let cmd = template
  cmd = replaceToken(cmd, '{python}', python)
  cmd = replaceToken(cmd, '{script}', vars.script)
  cmd = replaceToken(cmd, '{key}', vars.key)
  cmd = replaceToken(cmd, '{input}', vars.input)
  // Only substitute {output} when present in the template; script may own naming entirely
  if (cmd.includes('{output}')) {
    cmd = replaceToken(cmd, '{output}', vars.output || defaultEncryptedOutputPath(vars.input))
  }
  return cmd
}

/** Naive shell-ish split that respects double quotes. */
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3])
  }
  return tokens.filter(Boolean)
}

export function defaultEncryptedOutputPath(inputPath: string): string {
  // Fallback suggestion only if invoke template includes {output}
  const base = inputPath.slice(0, inputPath.length - extname(inputPath).length)
  return `${base}.encrypted`
}

/** Basename without extension, e.g. C:\out\Orders.json → Orders */
export function fileStem(filePath: string): string {
  const name = basename(filePath)
  const ext = extname(name)
  return ext ? name.slice(0, -ext.length) : name
}

/**
 * After encryption, find the file the script wrote.
 * Contract: DataForge owns the base name (stem); the script only changes the extension.
 * Looks in the same directory for stem.* that is not the original input, preferably
 * created/modified at or after the run started.
 */
export function findExtensionChangedOutput(
  inputPath: string,
  runStartedMs: number
): string | undefined {
  const dir = dirname(inputPath)
  const stem = fileStem(inputPath)
  const inputBase = basename(inputPath)

  if (!existsSync(dir)) return undefined

  let candidates: Array<{ path: string; mtimeMs: number }> = []
  try {
    candidates = readdirSync(dir)
      .filter((name) => {
        if (name === inputBase) return false
        // Same stem, any other extension: Orders.json → Orders.enc / Orders.pgp / Orders.enc.json
        return name === stem || name.startsWith(`${stem}.`)
      })
      .map((name) => {
        const p = join(dir, name)
        try {
          return { path: p, mtimeMs: statSync(p).mtimeMs }
        } catch {
          return null
        }
      })
      .filter((x): x is { path: string; mtimeMs: number } => x !== null)
  } catch {
    return undefined
  }

  if (candidates.length === 0) return undefined

  // Prefer files touched during/after this encryption run (2s clock skew allowance)
  const fresh = candidates.filter((c) => c.mtimeMs >= runStartedMs - 2000)
  const pool = fresh.length > 0 ? fresh : candidates
  pool.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return pool[0]?.path
}

/**
 * Parse an optional path from script stdout (last non-empty line that looks like a path).
 */
function parsePathFromStdout(stdout: string): string | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].replace(/^['"]|['"]$/g, '')
    if (
      /^[A-Za-z]:[\\/]/.test(line) ||
      line.startsWith('/') ||
      line.startsWith('.\\') ||
      line.startsWith('./') ||
      (/[\\/]/.test(line) && /\.[A-Za-z0-9]+$/.test(line))
    ) {
      if (existsSync(line)) return line
      return line
    }
  }
  return undefined
}

/**
 * Run the user-configured Python encryption command against an input file.
 *
 * Naming contract:
 * - DataForge sets the base file name (export / archive name).
 * - The custom script only changes the file extension (e.g. Orders.json → Orders.enc).
 * - Success = exit code 0.
 * - We locate the result as same directory + same stem + different extension.
 */
export function runEncryptionOnFile(
  inputPath: string,
  outputPath?: string,
  override?: Partial<EncryptionSettings>
): Promise<EncryptionRunResult> {
  const settings = { ...getSettings().encryption, ...override }
  const assets = getEncryptionAssetInfo()
  const script = settings.scriptPath || assets.scriptPath
  const key = settings.keyPath || assets.keyPath

  if (!script || !existsSync(script)) {
    return Promise.resolve({
      ok: false,
      error: 'No encryption script uploaded. Add one in Settings.'
    })
  }
  if (!key || !existsSync(key)) {
    return Promise.resolve({
      ok: false,
      error: 'No encryption key uploaded. Add one in Settings.'
    })
  }
  if (!existsSync(inputPath)) {
    return Promise.resolve({ ok: false, error: `Input file not found: ${inputPath}` })
  }

  const suggestedOut = outputPath || defaultEncryptedOutputPath(inputPath)
  const template = settings.invokeCommand || ''
  const command = buildInvokeCommand(template, {
    script,
    key,
    input: inputPath,
    output: template.includes('{output}') ? suggestedOut : undefined
  })

  if (!command.trim()) {
    return Promise.resolve({ ok: false, error: 'Invoke command is empty' })
  }

  const tokens = tokenizeCommand(command)
  if (tokens.length === 0) {
    return Promise.resolve({ ok: false, error: 'Could not parse invoke command', command })
  }

  const [bin, ...args] = tokens
  const runStartedMs = Date.now()

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        DATAFORGE_INPUT: inputPath,
        DATAFORGE_KEY: key,
        DATAFORGE_SCRIPT: script,
        // Stem only — script should keep this base name and change extension
        DATAFORGE_STEM: fileStem(inputPath),
        DATAFORGE_DIR: dirname(inputPath),
        ...(template.includes('{output}')
          ? { DATAFORGE_OUTPUT: suggestedOut }
          : {})
      }
    })

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      resolve({
        ok: false,
        command,
        stdout,
        stderr: stderr + '\n(process timed out after 120s)',
        error: 'Encryption script timed out',
        exitCode: null
      })
    }, 120_000)

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({
        ok: false,
        command,
        stdout,
        stderr,
        error: err.message,
        exitCode: null
      })
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      const ok = code === 0

      // Resolve encrypted path: stdout → same-stem different extension → optional {output}
      let resolvedPath: string | undefined
      if (ok) {
        const fromStdout = parsePathFromStdout(stdout)
        if (fromStdout && existsSync(fromStdout)) {
          resolvedPath = fromStdout
        } else {
          resolvedPath = findExtensionChangedOutput(inputPath, runStartedMs)
        }
        if (
          !resolvedPath &&
          template.includes('{output}') &&
          existsSync(suggestedOut)
        ) {
          resolvedPath = suggestedOut
        }
      }

      logInteraction('encryption_run', {
        command,
        exitCode: code,
        ok,
        inputPath,
        outputPath: resolvedPath ?? null,
        stem: fileStem(inputPath),
        extensionOnlyRename: true
      })
      resolve({
        ok,
        command,
        stdout,
        stderr,
        outputPath: resolvedPath,
        exitCode: code,
        error: ok
          ? undefined
          : `Encryption script failed (exit ${code}).\n${stderr || stdout || 'No output'}`
      })
    })
  })
}

/** Whether export should encrypt, given optional override flag. */
export function shouldEncryptExport(requestEncrypt?: boolean): boolean {
  const enc = getSettings().encryption
  if (!enc.enabled) return false
  if (typeof requestEncrypt === 'boolean') return requestEncrypt
  return enc.encryptOnExport
}
