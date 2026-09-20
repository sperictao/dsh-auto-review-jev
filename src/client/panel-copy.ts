/**
 * Locale copy for the quota panel: the `panel.jev` namespace both panel
 * registrations declare, plus the LocaleNamespaceMap merge that types the
 * renderer-bound `t` seat.
 *
 * @module dsh-auto-review-jev/client/panel-copy
 */

export const PANEL_LOCALE_NS = 'panel.jev'

export const PANEL_COPY_EN = {
  nav: 'Jev Usage',
  subtitle: 'Auto-review account quota and this host’s Jev consumption',
  footerTitle: 'Jev quota',
  open: 'Open the Jev usage dashboard',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  close: 'Close',
  closeHint: 'Back to the conversation',
  updated: 'Updated',
  loading: 'Loading usage…',
  noKey: 'No API key configured',
  noKeyHint: 'Set TYPESAFE_API_KEY or the plugin’s apiKey option, then refresh.',
  errorTitle: 'Usage is unavailable',
  errorGeneric: 'Refresh failed',
  account: 'Account',
  plan: 'Plan',
  balance: 'Balance',
  monthly: 'Period credits',
  monthlyUsed: 'Used',
  monthlyLimit: 'Limit',
  remaining: 'Remaining',
  tokenQuota: 'Token quota',
  resets: 'Resets',
  localTitle: 'This host (since restart)',
  localCalls: 'Review calls',
  localAllowed: 'Allowed',
  localDenied: 'Denied',
  localFailed: 'Failed',
  localTokens: 'Tokens (in / out)',
  localHint: 'Local counters reset when the host restarts.',
  noUsageEndpoint: 'No usage endpoint configured — showing local counters only.',
  noUsageEndpointHint: 'Set the plugin’s usageEndpoint option to poll account quota.',
  unavailable: '—',
} as const

export type PanelKey = keyof typeof PANEL_COPY_EN

export const PANEL_COPY_ZH: Record<PanelKey, string> = {
  nav: 'Jev 用量',
  subtitle: 'Auto 审查的账户额度与本机 Jev 消耗',
  footerTitle: 'Jev 额度',
  open: '打开 Jev 用量面板',
  refresh: '刷新',
  refreshing: '刷新中…',
  close: '关闭',
  closeHint: '返回会话',
  updated: '更新于',
  loading: '正在加载用量…',
  noKey: '未配置 API 密钥',
  noKeyHint: '设置 TYPESAFE_API_KEY 或插件配置 apiKey 后刷新。',
  errorTitle: '用量不可用',
  errorGeneric: '刷新失败',
  account: '账户',
  plan: '套餐',
  balance: '余额',
  monthly: '周期额度',
  monthlyUsed: '已用',
  monthlyLimit: '上限',
  remaining: '剩余',
  tokenQuota: 'Token 配额',
  resets: '重置时间',
  localTitle: '本机用量（自启动以来）',
  localCalls: '审查调用',
  localAllowed: '已允许',
  localDenied: '已拒绝',
  localFailed: '失败',
  localTokens: 'Token（输入 / 输出）',
  localHint: '本地计数器随宿主重启清零。',
  noUsageEndpoint: '未配置用量端点 —— 仅显示本地计数。',
  noUsageEndpointHint: '设置插件的 usageEndpoint 以轮询账户额度。',
  unavailable: '—',
}

/** English fallback when the renderer binds no `t` seat (missing locale face). */
export const panelTextEN: Record<PanelKey, string> = PANEL_COPY_EN

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'panel.jev': PanelKey
  }
}
