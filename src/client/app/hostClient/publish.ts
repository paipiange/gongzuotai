import { apiFetch, BASE, HostError } from './client'
import type { WechatChannelSummary, WechatDraftInput, WechatDraftResult, WechatStickerInput } from './types'

export async function getWechatChannelConfig(): Promise<WechatChannelSummary> {
  const response = await apiFetch<{ config: WechatChannelSummary }>('.wechat.config')
  return response.config
}

export async function saveWechatChannelConfig(input: { appId: string; appSecret?: string; defaultAuthor?: string }): Promise<WechatChannelSummary> {
  const response = await apiFetch<{ config: WechatChannelSummary }>('.wechat.config', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.config
}

export async function clearWechatChannelConfig(): Promise<WechatChannelSummary> {
  const response = await apiFetch<{ config: WechatChannelSummary }>('.wechat.config', { method: 'DELETE' })
  return response.config
}

export async function testWechatChannel(): Promise<{ ok: true; message: string }> {
  return apiFetch<{ ok: true; message: string }>('.wechat.test', { method: 'POST', body: '{}' })
}

export async function createWechatDraft(input: WechatDraftInput): Promise<WechatDraftResult> {
  const response = await apiFetch<{ result: WechatDraftResult }>('.wechat.draft', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.result
}

export async function createWechatSticker(input: WechatStickerInput): Promise<WechatDraftResult> {
  const response = await apiFetch<{ result: WechatDraftResult }>('.wechat.sticker', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.result
}

export async function exportComicPack(input: {
  title: string
  captions: string[]
  imageDataUrls: string[]
  coverDataUrl?: string
  publishItemId?: string
}): Promise<Blob> {
  const response = await fetch(`${BASE}.comic.export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `贴图包导出失败 (HTTP ${response.status})`, response.status)
  }
  return response.blob()
}
