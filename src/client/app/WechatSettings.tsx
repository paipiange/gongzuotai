import { CheckCircle, Eye, EyeSlash, FloppyDisk, Lightning, WechatLogo } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import {
  getWechatChannelConfig,
  saveWechatChannelConfig,
  testWechatChannel,
  type WechatChannelSummary,
} from './hostClient'

interface Toast {
  (message: string, tone?: 'info' | 'success' | 'warning'): void
}

export function WechatSettings({ onToast }: { onToast: Toast }) {
  const [summary, setSummary] = useState<WechatChannelSummary | null>(null)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [defaultAuthor, setDefaultAuthor] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    let cancelled = false
    getWechatChannelConfig()
      .then((config) => {
        if (cancelled) return
        setSummary(config)
        setAppId(config.appId)
        setDefaultAuthor(config.defaultAuthor)
      })
      .catch(() => { if (!cancelled) setSummary(null) })
    return () => { cancelled = true }
  }, [])

  const save = async () => {
    if (!appId.trim()) {
      onToast('请填写公众号 AppID', 'warning')
      return
    }
    if (!summary?.hasAppSecret && !appSecret.trim()) {
      onToast('请填写公众号 AppSecret', 'warning')
      return
    }
    setSaving(true)
    try {
      const next = await saveWechatChannelConfig({
        appId: appId.trim(),
        ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
        defaultAuthor: defaultAuthor.trim(),
      })
      setSummary(next)
      setAppSecret('')
      onToast('微信公众号配置已保存到 Host 私有存储', 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '公众号配置保存失败', 'warning')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const result = await testWechatChannel()
      onToast(result.message, 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '公众号连接测试失败', 'warning')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="pa-panel pa-setting-card pa-wechat-settings">
      <div className="pa-setting-card__icon"><WechatLogo aria-hidden="true" size={23} /></div>
      <div className="pa-wechat-settings__content">
        <div className="pa-wechat-settings__head">
          <div>
            <h2>微信公众号</h2>
            <p>连接公众号官方接口，漫画只同步到草稿箱，不会自动发表。</p>
          </div>
          <span className="pa-wechat-settings__status" data-configured={summary?.configured === true}>
            <CheckCircle aria-hidden="true" size={15} weight="fill" />
            {summary?.configured ? '已配置' : '未配置'}
          </span>
        </div>

        <div className="pa-wechat-settings__form">
          <label className="pa-field">
            <span>AppID</span>
            <input type="text" autoComplete="off" placeholder="wx..." value={appId} onChange={(event) => setAppId(event.target.value)} />
          </label>
          <label className="pa-field">
            <span>AppSecret</span>
            <span className="pa-input-with-toggle">
              <input
                type={showSecret ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder={summary?.hasAppSecret ? '已保存，留空表示不修改' : '仅保存在本机 Host 私有数据库'}
                value={appSecret}
                onChange={(event) => setAppSecret(event.target.value)}
              />
              <button type="button" className="pa-icon-button" aria-label={showSecret ? '隐藏 AppSecret' : '显示 AppSecret'} onClick={() => setShowSecret((value) => !value)}>
                {showSecret ? <EyeSlash aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
              </button>
            </span>
          </label>
          <label className="pa-field">
            <span>默认作者</span>
            <input type="text" maxLength={16} placeholder="可选" value={defaultAuthor} onChange={(event) => setDefaultAuthor(event.target.value)} />
          </label>
        </div>

        <p className="pa-wechat-settings__hint">AppSecret 不会写入前端包或提交到仓库。首次调用前，请在微信公众平台配置服务器 IP 白名单并确认账号拥有草稿接口权限。</p>
        <div className="pa-wechat-settings__actions">
          <button type="button" className="pa-secondary-button" disabled={testing || !summary?.configured} onClick={() => void test()}>
            <Lightning aria-hidden="true" size={16} />{testing ? '测试中…' : '测试连接'}
          </button>
          <button type="button" className="pa-primary-button" disabled={saving} onClick={() => void save()}>
            <FloppyDisk aria-hidden="true" size={16} />{saving ? '保存中…' : '保存配置'}
          </button>
        </div>
      </div>
    </section>
  )
}
