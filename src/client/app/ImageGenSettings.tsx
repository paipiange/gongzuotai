import { ImageSquare, Cpu, FloppyDisk } from '@phosphor-icons/react'
import { FormEvent, useEffect, useState } from 'react'
import { loadSettings, persistSettings, type ComfyUiConfig, type LlmImageConfig } from './imagegenStore'

type BackendTab = 'llm' | 'comfyui'

/**
 * Image generation settings form. Configures two backends:
 *  - LLM (OpenAI-compatible): baseUrl + apiKey + model
 *  - Local ComfyUI: server + split models (unet/clip/vae) or legacy checkpoint
 *
 * Persists through the Host's secure SettingsRepository (API key lives only in
 * Host SQLite); falls back to localStorage when the Host is unavailable.
 */
export function ImageGenSettings({ onToast }: { onToast: (message: string, tone?: 'info' | 'success' | 'warning') => void }) {
  const [tab, setTab] = useState<BackendTab>('llm')
  const [source, setSource] = useState<'host' | 'local' | 'loading'>('loading')
  const [llm, setLlm] = useState<LlmImageConfig>({ baseUrl: '', apiKey: '', model: '' })
  const [comfyui, setComfyui] = useState<ComfyUiConfig>({
    server: 'http://127.0.0.1:8188',
    unet: 'qwen_image_edit_2511_int8_convrot.safetensors',
    clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    vae: 'qwen_image_vae.safetensors',
    checkpoint: '',
  })

  useEffect(() => {
    let cancelled = false
    loadSettings().then(({ settings, source }) => {
      if (cancelled) return
      setSource(source)
      if (settings.llm) setLlm({ baseUrl: settings.llm.baseUrl, model: settings.llm.model, apiKey: settings.llm.apiKey })
      if (settings.comfyui) {
        setComfyui({
          server: settings.comfyui.server,
          unet: settings.comfyui.unet,
          clip: settings.comfyui.clip,
          vae: settings.comfyui.vae,
          checkpoint: settings.comfyui.checkpoint,
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (tab === 'llm') {
      const baseUrl = llm.baseUrl.trim().replace(/\/+$/, '')
      if (!baseUrl || !llm.apiKey.trim() || !llm.model.trim()) {
        onToast('请完整填写 Base URL、API Key 与模型名', 'warning')
        return
      }
      const { source } = await persistSettings({ llm: { baseUrl, apiKey: llm.apiKey.trim(), model: llm.model.trim() } })
      setSource(source)
      onToast(source === 'host' ? '大模型生图配置已保存到本地服务' : '大模型生图配置已保存到浏览器本地', 'success')
    } else {
      const server = comfyui.server.trim().replace(/\/+$/, '')
      if (!server) {
        onToast('请填写 ComfyUI 服务地址', 'warning')
        return
      }
      const hasSplit = comfyui.unet?.trim() && comfyui.clip?.trim() && comfyui.vae?.trim()
      const hasCheckpoint = comfyui.checkpoint?.trim()
      if (!hasSplit && !hasCheckpoint) {
        onToast('请填写 UNet/CLIP/VAE（分离式模型）或 checkpoint（单文件模型）', 'warning')
        return
      }
      const { source } = await persistSettings({
        comfyui: {
          server,
          unet: comfyui.unet?.trim() || undefined,
          clip: comfyui.clip?.trim() || undefined,
          vae: comfyui.vae?.trim() || undefined,
          checkpoint: comfyui.checkpoint?.trim() || undefined,
        },
      })
      setSource(source)
      onToast(source === 'host' ? 'ComfyUI 配置已保存到本地服务' : 'ComfyUI 配置已保存到浏览器本地', 'success')
    }
  }

  return (
    <section className="pa-panel pa-imagegen-settings">
      <div className="pa-imagegen-settings__head">
        <div className="pa-setting-card__icon"><ImageSquare aria-hidden="true" size={23} /></div>
        <div>
          <h2>图片 Provider</h2>
          <p>配置生图后端：大模型 API 或本机 ComfyUI。密钥仅保存在本地，不进入仓库。</p>
        </div>
      </div>

      <div className="pa-imagegen-settings__tabs" role="tablist" aria-label="生图后端类型">
        <button type="button" role="tab" aria-selected={tab === 'llm'} className={tab === 'llm' ? 'is-active' : ''} onClick={() => setTab('llm')}><Cpu aria-hidden="true" size={18} /> 大模型 API</button>
        <button type="button" role="tab" aria-selected={tab === 'comfyui'} className={tab === 'comfyui' ? 'is-active' : ''} onClick={() => setTab('comfyui')}><ImageSquare aria-hidden="true" size={18} /> 本机 ComfyUI</button>
      </div>

      <form onSubmit={handleSubmit} className="pa-imagegen-settings__form">
        {tab === 'llm' ? (
          <>
            <label>
              <span>Base URL</span>
              <input type="url" placeholder="https://api.example.com/v1" value={llm.baseUrl} onChange={(event) => setLlm({ ...llm, baseUrl: event.target.value })} />
            </label>
            <label>
              <span>API Key</span>
              <input type="password" autoComplete="off" placeholder="sk-..." value={llm.apiKey} onChange={(event) => setLlm({ ...llm, apiKey: event.target.value })} />
            </label>
            <label>
              <span>模型</span>
              <input type="text" placeholder="dall-e-3 或兼容模型名" value={llm.model} onChange={(event) => setLlm({ ...llm, model: event.target.value })} />
            </label>
          </>
        ) : (
          <>
            <label>
              <span>服务地址</span>
              <input type="url" placeholder="http://127.0.0.1:8188" value={comfyui.server} onChange={(event) => setComfyui({ ...comfyui, server: event.target.value })} />
            </label>
            <div className="pa-imagegen-settings__divider">分离式模型（推荐，如 Qwen-Image-Edit）</div>
            <label>
              <span>UNet（扩散模型）</span>
              <input type="text" placeholder="qwen_image_edit_2511_int8_convrot.safetensors" value={comfyui.unet ?? ''} onChange={(event) => setComfyui({ ...comfyui, unet: event.target.value })} />
            </label>
            <label>
              <span>CLIP（文本编码器）</span>
              <input type="text" placeholder="qwen_2.5_vl_7b_fp8_scaled.safetensors" value={comfyui.clip ?? ''} onChange={(event) => setComfyui({ ...comfyui, clip: event.target.value })} />
            </label>
            <label>
              <span>VAE</span>
              <input type="text" placeholder="qwen_image_vae.safetensors" value={comfyui.vae ?? ''} onChange={(event) => setComfyui({ ...comfyui, vae: event.target.value })} />
            </label>
            <div className="pa-imagegen-settings__divider">或单文件模型</div>
            <label>
              <span>Checkpoint（单文件，可选）</span>
              <input type="text" placeholder="sd.safetensors" value={comfyui.checkpoint ?? ''} onChange={(event) => setComfyui({ ...comfyui, checkpoint: event.target.value })} />
            </label>
          </>
        )}

        <div className="pa-imagegen-settings__actions">
          <button type="submit" className="pa-primary-button"><FloppyDisk aria-hidden="true" size={17} /> 保存配置</button>
          <span className="pa-imagegen-settings__hint">{source === 'host' ? '密钥保存在本地 Host 数据库，浏览器不落盘。' : source === 'loading' ? '正在读取配置…' : 'Host 未连接，配置暂存浏览器本地。'}</span>
        </div>
      </form>
    </section>
  )
}
