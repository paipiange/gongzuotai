import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, relative, resolve, win32 } from 'node:path'

export interface StoragePaths {
  root: string
  database: string
  media: string
  images: string
  uploads: string
  articles: string
  exports: string
  backups: string
}

export function resolveStoragePaths(dataRoot?: string): StoragePaths {
  const root = resolve(dataRoot ?? process.env.DSH_HOME ?? resolve(homedir(), '.dsh'), 'paipiange')
  return {
    root,
    database: resolve(root, 'paipiange.sqlite'),
    media: resolve(root, 'media'),
    images: resolve(root, 'media', 'images'),
    uploads: resolve(root, 'media', 'uploads'),
    articles: resolve(root, 'articles'),
    exports: resolve(root, 'exports'),
    backups: resolve(root, 'backups'),
  }
}

export function ensureStorageDirectories(paths: StoragePaths) {
  for (const directory of [paths.root, paths.media, paths.images, paths.uploads, paths.articles, paths.exports, paths.backups]) {
    mkdirSync(directory, { recursive: true })
  }
}

export function resolvePrivatePath(root: string, relativePath: string) {
  const segments = relativePath.split(/[\\/]+/)
  if (!relativePath || posix.isAbsolute(relativePath) || win32.isAbsolute(relativePath) || relativePath.includes('\0') || segments.includes('..')) {
    throw new Error('Invalid relative path')
  }
  const target = resolve(root, relativePath)
  const relation = relative(root, target)
  if (!relation || relation.startsWith('..') || posix.isAbsolute(relation) || win32.isAbsolute(relation)) {
    throw new Error('Path escapes the private data root')
  }
  return target
}
