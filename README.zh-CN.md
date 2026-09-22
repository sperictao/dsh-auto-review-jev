# @dsh-external/dsh-auto-review-jev

[English](README.md) | **中文**

`@dsh-external/dsh-auto-review-jev` 为 DeepSeek Harness 的 **Auto** permission preset 提供基于 [TypeSafe Jev](https://docs.typesafe.ai) 的逐工具调用授权审查。

设计参考：

- DeepSeek Harness `packages/experimental/auto-review`：沿用 Auto preset、`tools/pre-execute` 审查点、PTC inner call 覆盖、权限生命周期与 fail-closed 语义。
- `y0usaf/pi-jev`：沿用 Jev typed questions、校准阈值、参数裁剪和短期结果缓存的思路。

与原版 Auto review 的主要区别是：**不要求 reviewer 生成 `risk/decision` 自由文本 JSON**。Jev 一次返回多个独立的 `noul` / `score` 数值，本插件在本地用固定规则组合为最终 `allow` / `deny`。

各版本的改动记录见 [CHANGELOG.md](CHANGELOG.md)。

## 行为

当当前 Session 选择 `Auto` 时，每个支持的原生工具调用和每个已启动的 PTC inner call 在执行 body 之前都会经过 Jev 审查。

- 低风险：项目内普通读写、分析、格式化、测试、构建等，直接允许。
- 中风险：破坏已有状态、生产环境操作、外部写入、权限/安全控制变更、高影响操作。只有当前 human/direct-parent 指令明确授权动作、目标和必要范围，并且没有冲突/越界时才允许。
- 高风险：敏感数据跨信任边界泄露，始终拒绝。
- Jev 超时、限流重试后失败、响应异常、上下文/Schema 无法可靠重建：**拒绝（fail closed）**。
- 拒绝文案会带上原因：风险判定显示 `risk: …`，评审本身的故障显示 `review_error: …`（例如 `review_error: HTTP 401 (missing or invalid API key)`）。原因同时写进可见文案和结构化 `info.reason`，因此「密钥失效导致的全面拒绝」不会再被误读成「风险裁决」。

外层 `run_code` 只是 PTC transport，不单独审查；其每个 PTC inner tool call 会单独审查。与上游 Auto review 一样，`run_code` 程序内部绕过 DSH tool registry 的直接 Node.js 副作用不在本插件审查范围内。

## 安装

`@dsh-external` 不是 npm 上的可发布 scope，本包通过 tarball 或源码目录安装到 Web profile：

```bash
# 从任一 Release 的附件 tarball 安装（无需构建、无需 pnpm 放行）
dsh plugin --profile web add ./dsh-external-dsh-auto-review-jev-<version>.tgz
```

或从源码目录安装（开发用）：

```bash
dsh plugin --profile web add /path/to/dsh-auto-review-jev
```

配置 TypeSafe API Key：

```bash
export TYPESAFE_API_KEY="..."
```

也可以在 DSH Web 的 **设置 → Auto Review Jev** 页面里粘贴密钥（写入凭据域，密钥不会回显）。

然后在权限选择器中选择对应预设：默认是 `Auto`；若按「与 DSH 自带 auto review 共存」一节绑定到独立预设，则选择该预设的名字（示例中是 **Auto Reviewer Jev**）。

没有 `TYPESAFE_API_KEY` 时插件仍可加载，但不会允许切换到该预设；如果已有会话在该预设下运行而 key 失效，相关工具调用会 fail closed。

`Auto` 是 DSH 的单一固定集成点；请不要同时加载官方 `@deepseek-ai/dsh-experimental-auto-review` 与本插件（后者会把本插件挤下插槽并让它进入 INACTIVE 状态）。`permissionPresets.registerAuto()` 只允许一个 Auto reviewer。

如果你需要两者**同时**安装，请把本插件绑定到自己的预设名（`preset: auto-jev`，显示为 "Auto Reviewer Jev"）——见下节「与 DSH 自带 auto review 共存」。

### 从 GitHub 源码安装：pnpm 会拦截构建脚本（allowBuilds）

```bash
dsh plugin --profile web add github:sperictao/dsh-auto-review-jev
```

在 pnpm ≥ 10 上这条命令会失败：

```text
[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] Failed to prepare git-hosted package fetched from
"https://codeload.github.com/sperictao/dsh-auto-review-jev/tar.gz/<sha>": The git-hosted
package "@dsh-external/dsh-auto-review-jev@0.2.4" needs to execute build scripts but is
not in the "allowBuilds" allowlist.
```

原因不是本包做了什么出格的事，而是**产物不入库 + pnpm 默认不信任依赖的构建脚本**：包用 `prepare`（`tsdown`）产出 `lib/`，而 `lib/` 按 `.gitignore` 不入库，所以 git 来源的安装必须现场构建一次。pnpm 的供应链防线默认不放行第三方依赖的生命周期脚本——registry 来源会报 `Ignored build scripts: …`（`strictDepBuilds` 默认为 true），git 来源则直接硬失败。

三条出路，按推荐顺序：

**1. 装预构建的 tarball（推荐，无需任何放行）**

```bash
dsh plugin --profile web add ./dsh-external-dsh-auto-review-jev-<version>.tgz
```

tarball 里已经包含构建好的 `lib/`，安装不触发 `prepare`，因此不会遇到该拦截。

**2. 用 DSH Pro Max 启动器安装（一键放行）**

在市场页 **Custom install** 里填 `github:sperictao/dsh-auto-review-jev`（`owner/repo` 形态亦可）。被 pnpm 拦截时启动器会弹出 **Allow build scripts?** 审批框并列出需要放行的精确键；点 **Approve & install** 后启动器把键写进 profile 的 `pnpm-workspace.yaml` 并自动重跑安装，不需要手工编辑文件。DSH Pro Max v0.8.26 起，`name@git+https://…#<sha>` 与 `name@https://codeload.github.com/…/tar.gz/<sha>` 两种键形态都能识别。

**3. 手工放行**

把 pnpm 报错里 `allowBuilds:` 示例块打印的键**原样**写进 profile 的 `pnpm-workspace.yaml`：

- macOS / Linux：`~/.dsh/profiles/web/pnpm-workspace.yaml`
- Windows：`%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml`

```yaml
allowBuilds:
  # 键以 @ 开头必须加引号：@ 是 YAML 保留字符，裸写会让整个 profile 配置解析失败
  '@dsh-external/dsh-auto-review-jev@git+https://github.com/sperictao/dsh-auto-review-jev.git#<sha>': true
# pnpm 10 用这个列表键；pnpm 11 起改用上面的 allowBuilds，旧键不再生效
onlyBuiltDependencies:
  - '@dsh-external/dsh-auto-review-jev'
```

然后重跑安装。在该 profile 目录下跑 `pnpm approve-builds` 也可以，它把放行的包写进同一份 `allowBuilds`；交互没走完时该键可能留成占位值（`set this to true or false`），需要改成 `true`（启动器的审批流程会自动覆盖占位值）。

三点值得知道：

- **pnpm 打印的键是提交钉定的**：它指向本次解析到的具体来源（`#<sha>`，经 codeload 拉取时是 `/tar.gz/<sha>`），仓库有新提交后再装会打印新键、需要再放行一次。
- **想一次放行、长期有效**，手工写**仓库形态**的键（不带 `#<sha>`）：`'@dsh-external/dsh-auto-review-jev@git+https://github.com/sperictao/dsh-auto-review-jev.git': true`。pnpm ≥ 11.19.0 下它同时覆盖克隆与 codeload tarball 两条拉取路径，之后的新提交无需重新放行。
- **放行是 profile 级的**：条目对该 profile 内所有安装生效，删掉即回到被拦状态。

## 与 DSH 自带 auto review 共存

DSH 的 `auto` 预设**只允许一个集成**：第二个调用 `permissionPresets.registerAuto()` 的插件会抛 `preset "auto" is already registered`。为避免与官方 auto review 抢同一个插槽，本插件支持把审查器绑定到**自己的预设名**：

```yaml
- id: permission
  config:
    presets:
      # 注意：id 定向覆盖会替换整行 config，需原样保留已发布的预设
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
      auto-jev:
        sandbox: danger-full-access
        approval: never
        name: Auto Reviewer Jev
        description: TypeSafe Jev 逐工具调用授权审查（替代人工确认）

- id: auto-review-jev
  config:
    preset: auto-jev
```

`auto-jev` 的 sandbox/approval 与内置 `auto` 一致（`danger-full-access` + `never`）——审查器本身就是替代人工确认的那一环。

行为约定：

- `preset: auto`（默认）：占用 DSH 固定的 Auto 插槽。若该插槽已被其他集成占用，本插件**不会导致加载失败**，而是自动退出（纯放行、不做任何判定）并打印一条明确指向修复方式的警告——绝不会出现两个审查器同时判定同一个预设。
- `preset: <其他名字>`：完全不碰 Auto 插槽，与官方 auto review 并存；若该预设未在 `permission-presets` 中声明，同样只警告不崩溃。

## 账户用量与设置页

在 DSH Web 界面中，本插件只挂载**一个**界面（参考 `Mars-Sea/dsh-commandcode-provider` 的实现模式）：

- **设置页**：Settings 导航中的 "Auto Review Jev" 一节（`settings.section`，页面名在中文界面下也保持这个英文写法，不做翻译）。页面自上而下是：用量面板 → API 密钥（写入凭据域的 `TYPESAFE_API_KEY` 引用，密钥永不回显）→ 评估端点 → 用量端点 → 模型。
- **用量面板**（内联在设置页顶部，API 密钥上方）：账户快照（头像、套餐、额度条、余额、重置时间）与本机计数的完整明细，带手动刷新与「更新于」时间戳；文案跟随界面语言。

> 侧边栏额度卡片与中间栏用量面板已移除：用量改在设置页内联呈现，侧边栏、composer 与 layout 服务不再被本插件改动。

用量数据分两层：

1. **本机计数**（始终可用）：插件在 Host 侧累计每次审查的调用数、允许/拒绝/失败次数以及响应里的 `usage.input_tokens` / `usage.output_tokens`。计数器为内存态，随宿主重启清零，卡片上已明确标注。
2. **账户额度**（可选）:TypeSafe 公开 API 没有官方额度查询端点，因此本插件支持一个**可配置的用量端点** `usageEndpoint`。配置后，Host 会以同一把 Bearer 密钥定期 `GET` 该端点（默认每 300 秒），并按宽松规则解析响应：字段在常见别名（`balance`/`limit`/`used`/`remaining`/`token_used`/`resets_at` 等，snake_case 与 camelCase 均可）下探测，`data`/`account`/`usage`/`quota` 等一层包裹会被展开，缺失的字段直接不显示。

浏览器永远不持有 API 密钥：所有事实通过 `jev/report` Typert Remote 由 Host 侧供给。

密钥按以下优先级解析（每次审查调用重新解析，改动无需重启）：

1. 凭据域的 `TYPESAFE_API_KEY` 引用 —— 设置页保存的密钥写在这里；导出的同名环境变量也会经由凭据域的环境层被优先命中（只读来源会遮蔽已存记录）。
2. 插件配置的 `apiKey` 字段（部署层面的兜底）。

```yaml
- id: auto-review-jev
  name: '@dsh-external/dsh-auto-review-jev'
  config:
    # 账户额度端点（可选；留空则用量面板只显示本机计数）
    usageEndpoint: https://api.typesafe.ai/v1/usage
    # 后台轮询间隔（秒，最小 30）
    usageRefreshSeconds: 300
```

## 默认审查维度

| 维度 | 类型 | 默认阈值 | 处理 |
|---|---|---:|---|
| sensitive_exfiltration | noul | 0.70 | 高风险，始终拒绝 |
| destructive | noul | 0.90 | 中风险；同 Session 精确清理可豁免 |
| production_effect | noul | 0.80 | 中风险 |
| external_write | noul | 0.80 | 中风险 |
| security_change | noul | 0.80 | 中风险 |
| beyond_scope | noul | 0.85 | 直接拒绝 |
| explicit_authorization | noul | 0.85 | 中风险允许所需 |
| authorization_conflict | noul | 0.50 | 达阈值则中风险拒绝 |
| session_created_cleanup | noul | 0.80 | 仅抵消 destructive 分类 |
| impact | score 0-3 | 2.50 | 中风险，最低 confidence 0.50 |

`destructive=0.90` 与 `beyond_scope=0.85` 延续 `pi-jev` 的实测思路：普通、明确要求的编辑可能获得偏高的 destructive/beyond-scope 分值，阈值不能简单设成 0.5 或 0.7。

## 配置

Cordis 配置可覆盖以下字段；通常只需要设置 `TYPESAFE_API_KEY`：

```yaml
- id: auto-review-jev
  name: '@dsh-external/dsh-auto-review-jev'
  config:
    model: jev-latest
    endpoint: https://api.typesafe.ai/v1/systemone
    timeoutMs: 20000
    retries: 2
    maxStateChars: 12000
    argumentChars: 600
    cacheSeconds: 120
```

风险阈值也可通过同名 `*Threshold` 配置覆盖。建议在建立自己的标注集并校准前保持默认值。

## Jev 会收到什么

每次审查最多发送：

- 当前工作目录与平台；
- 当前可见的项目指令（标记为 constraint）；
- 当前可见历史中的 human/direct-parent 指令、checkpoint/fact，以及历史工具调用事实；
- 待执行工具的名称、描述、参数 Schema；
- 待执行参数，长字符串按 `argumentChars` 截断；
- 固定的 authority-source 元数据，明确只有 human/direct-parent 可以授权中风险动作。

不会发送 assistant 正文或 reasoning，也不会把历史 tool result 作为授权依据。整体 state 超过 `maxStateChars` 时优先丢弃最旧历史，然后进一步裁剪项目指令。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

构建产出两个 bundle:`lib/index.js`(Host 侧，ESM）与 `lib/client.js`（浏览器侧，CJS 通过 `window.__ModuleLoader__` 装载）。包通过 `dsh.bundle.patch` 声明 `cordis.patch.yml`，并通过 `dsh.client` + `exports["./client"]` 声明浏览器端入口，可作为独立 DSH plugin 安装。

## 安全边界

Auto review 是风险降低层，不是隔离沙箱。允许的调用最终仍以 Auto preset 对应的 Full access 执行。若需要强隔离，应同时使用 DSH 自身 sandbox / deployment boundary，而不是依赖分类器代替隔离。

## License

MIT。参考实现与归属说明见 [NOTICE.md](NOTICE.md)。
