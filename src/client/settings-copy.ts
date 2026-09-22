/**
 * Locale copy for the "Auto Review Jev" settings page: the
 * `settings.jev-auto-review` namespace, plus the LocaleNamespaceMap merge
 * that types the renderer-bound `t` seat.
 *
 * @module @dsh-external/dsh-auto-review-jev/client/settings-copy
 */

export const SETTINGS_LOCALE_NS = 'settings.jev-auto-review'

export const SETTINGS_COPY_EN = {
  // The page name is a product name, deliberately identical in every locale:
  // the Chinese dict below repeats the same literal instead of translating it.
  nav: 'Auto Review Jev',
  title: 'Auto Review Jev',
  subtitle: 'TypeSafe Jev authorization reviewer for the Auto permission preset',
  apiKey: 'API key',
  apiKeyHint: 'Stored as the TYPESAFE_API_KEY credential. The env var wins when both are set.',
  apiKeyConfigured: 'Configured',
  apiKeyMissing: 'Not configured',
  apiKeyClear: 'Remove stored key',
  apiKeyClearStaged: 'Will be removed on save',
  endpoint: 'Evaluation endpoint',
  endpointHint: 'SystemOne HTTP endpoint. Leave empty for the official default.',
  usageEndpoint: 'Usage endpoint',
  usageEndpointHint: 'Optional account-quota endpoint the usage panel polls (GET, same key). Empty = local counters only.',
  model: 'Model',
  modelHint: 'Model id sent with every review request.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  savedFailed: 'Save failed — check the values and retry.',
  reset: 'Reset',
  overridden: 'Overridden',
  invalidUrl: 'Must be an absolute URL (or empty)',
} as const

export type SettingsKey = keyof typeof SETTINGS_COPY_EN

export const SETTINGS_COPY_ZH: Record<SettingsKey, string> = {
  // Same literal as the English dict: the page name is not translated.
  nav: 'Auto Review Jev',
  title: 'Auto Review Jev',
  subtitle: '为 Auto 权限预设提供 TypeSafe Jev 授权审查',
  apiKey: 'API 密钥',
  apiKeyHint: '保存为 TYPESAFE_API_KEY 凭据。两者同时设置时环境变量优先。',
  apiKeyConfigured: '已配置',
  apiKeyMissing: '未配置',
  apiKeyClear: '移除已存密钥',
  apiKeyClearStaged: '保存后移除',
  endpoint: '评估端点',
  endpointHint: 'SystemOne HTTP 端点。留空使用官方默认值。',
  usageEndpoint: '用量端点',
  usageEndpointHint: '用量面板轮询的账户额度端点（GET，同一把密钥）。留空 = 只显示本地计数。',
  model: '模型',
  modelHint: '每次审查请求携带的模型 id。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃',
  savedFailed: '保存失败 —— 请检查取值后重试。',
  reset: '重置',
  overridden: '已覆盖',
  invalidUrl: '必须是绝对 URL（或留空）',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.jev-auto-review': SettingsKey
  }
}
