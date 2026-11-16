/**
 * Export APIs: creation export (markdown/html/zip), platform-adapted text, and
 * graphic storyboard image ZIP.
 */

import { BASE, HostError } from './client'
import type { PublishPlatform } from './types'

export async function exportCreation(creationId: string, format: 'markdown' | 'html' | 'zip'): Promise<Blob> {
  const response = await fetch(`${BASE}.export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creationId, format }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `导出失败 (HTTP ${response.status})`, response.status)
  }
  return response.blob()
}

/** Export copy-paste-ready plain text adapted to a target platform. */
export async function exportForPlatform(creationId: string, platform: PublishPlatform): Promise<Blob> {
  const response = await fetch(`${BASE}.export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creationId, format: 'text', platform }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `导出失败 (HTTP ${response.status})`, response.status)
  }
  return response.blob()
}

/** Same as exportForPlatform but returns the adapted text as a string (for clipboard). */
export async function exportPlatformText(creationId: string, platform: PublishPlatform): Promise<string> {
  const blob = await exportForPlatform(creationId, platform)
  return blob.text()
}

/** Export generated graphic storyboard page images as a single ZIP bundle. */
export async function exportGraphicZip(input: { assetIds: string[]; title?: string }): Promise<Blob> {
  const response = await fetch(`${BASE}.graphic.export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `导出失败 (HTTP ${response.status})`, response.status)
  }
  return response.blob()
}
