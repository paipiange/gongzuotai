import { CheckCircle, Eye, EyeSlash, FloppyDisk, Lightning, Plus, Trash, WechatLogo } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import {
  activateWechatAccount,
  getWechatChannelConfig,
  listWechatAccounts,
  removeWechatAccount,
  saveWechatAccount,
  testWechatChannel,
  type WechatAccountSummary,
} from './hostClient'

interface Toast {
  (message: string, tone?: 'info' | 'success' | 'warning'): void
}

export function WechatSettings({ onToast }: { onToast: Toast }) {
  const [accounts, setAccounts] = useState<WechatAccountSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hasActiveSecret, setHasActiveSecret] = useState(false)
  // 编辑态：null 表示新增；否则为编辑已有账号（id 非空）。
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [defaultAuthor, setDefaultAuthor] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getWechatChannelConfig()
      .then((config) => {
        if (cancelled) return
        setAccounts(config.accounts)
        setActiveId(config.activeId)
        setHasActiveSecret(config.hasAppSecret)
      })
      .catch(() => { if (!cancelled) { setAccounts([]); setActiveId(null) } })
    return () => { cancelled = true }
  }, [])

  const startNew = () => {
    setEditingId(null)
    setName('')
    setAppId('')
    setAppSecret('')
    setDefaultAuthor('')
  }

  const startEdit = (account: WechatAccountSummary) => {
    setEditingId(account.id)
    setName(account.name)
    setAppId(account.appId)
    setAppSecret('')
    setDefaultAuthor(account.defaultAuthor)
  }

  const save = async () => {
    if (!appId.trim()) {
      onToast('请填写公众号 AppID', 'warning')
      return
    }
    if (!editingId && !appSecret.trim()) {
      onToast('请填写公众号 AppSecret', 'warning')
      return
    }
    setSaving(true)
    try {
      const result = await saveWechatAccount({
        ...(editingId ? { id: editingId } : {}),
        name: name.trim() || `公众号 ${appId.trim().slice(0, 6)}`,
        appId: appId.trim(),
        ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
        defaultAuthor: defaultAuthor.trim(),
      })
      setAccounts(result.accounts)
      setActiveId(result.activeId)
      setHasActiveSecret(true)
      startNew()
      onToast('公众号账号已保存到 Host 私有存储', 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '公众号账号保存失败', 'warning')
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

  const activate = async (id: string) => {
    setBusyId(id)
    try {
      const result = await activateWechatAccount(id)
      setAccounts(result.accounts)
      setActiveId(result.activeId)
      setHasActiveSecret(true)
      onToast('已切换当前公众号账号', 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '切换账号失败', 'warning')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: string) => {
    setBusyId(id)
    try {
      const result = await removeWechatAccount(id)
      setAccounts(result.accounts)
      setActiveId(result.activeId)
      if (editingId === id) startNew()
      onToast('公众号账号已移除', 'info')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '移除账号失败', 'warning')
    } finally {
      setBusyId(null)
    }
  }

  const activeAccount = accounts.find((a) => a.id === activeId) ?? null

  return (
    <section className="pa-panel pa-setting-card pa-wechat-settings">
      <div className="pa-setting-card__icon"><WechatLogo aria-hidden="true" size={23} /></div>
      <div className="pa-wechat-settings__content">
        <div className="pa-wechat-settings__head">
          <div>
            <h2>微信公众号（多账号）</h2>
            <p>管理多个公众号账号，漫画只同步到草稿箱，不会自动发表。</p>
          </div>
          <span className="pa-wechat-settings__status" data-configured={accounts.length > 0}>
            <CheckCircle aria-hidden="true" size={15} weight="fill" />
            {accounts.length > 0 ? `已配置 ${accounts.length} 个账号` : '未配置'}
          </span>
        </div>

        {accounts.length > 0 && (
          <div className="pa-wechat-accounts" role="list" aria-label="公众号账号列表">
            {accounts.map((account) => (
              <div key={account.id} className="pa-wechat-account" data-active={account.id === activeId}>
                <div className="pa-wechat-account__info">
                  <strong>{account.name}</strong>
                  <span>{account.appId}{account.defaultAuthor ? ` · 作者 ${account.defaultAuthor}` : ''}</span>
                </div>
                <div className="pa-wechat-account__actions">
                  {account.id === activeId ? (
                    <span className="pa-wechat-account__active-badge">当前</span>
                  ) : (
                    <button type="button" className="pa-secondary-button" disabled={busyId === account.id} onClick={() => void activate(account.id)}>切换</button>
                  )}
                  <button type="button" className="pa-secondary-button" disabled={busyId === account.id} onClick={() => startEdit(account)}>编辑</button>
                  <button type="button" className="pa-icon-button pa-danger-button" aria-label={`移除 ${account.name}`} title="移除账号" disabled={busyId === account.id} onClick={() => void remove(account.id)}>
                    <Trash aria-hidden="true" size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pa-wechat-settings__form">
          <label className="pa-field">
            <span>账号名称</span>
            <input type="text" autoComplete="off" placeholder="例如：主号 / 生活小号" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
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
                placeholder={editingId ? '已保存，留空表示不修改' : '仅保存在本机 Host 私有数据库'}
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

        <p className="pa-wechat-settings__hint">
          AppSecret 不会写入前端包或提交到仓库。首次调用前，请在微信公众平台配置服务器 IP 白名单并确认账号拥有草稿接口权限。
          {activeAccount && <>当前发布使用账号：<strong>{activeAccount.name}</strong>。</>}
        </p>
        <div className="pa-wechat-settings__actions">
          <button type="button" className="pa-secondary-button" disabled={testing || accounts.length === 0} onClick={() => void test()}>
            <Lightning aria-hidden="true" size={16} />{testing ? '测试中…' : '测试连接'}
          </button>
          <button type="button" className="pa-secondary-button" onClick={startNew}>
            <Plus aria-hidden="true" size={16} />新增账号
          </button>
          <button type="button" className="pa-primary-button" disabled={saving} onClick={() => void save()}>
            <FloppyDisk aria-hidden="true" size={16} />{saving ? '保存中…' : editingId ? '保存修改' : '添加账号'}
          </button>
        </div>
      </div>
    </section>
  )
}
