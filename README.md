# dsh-auto-review-jev

`@dsh-external/dsh-auto-review-jev` 为 DeepSeek Harness 的 **Auto** permission preset 提供基于 [TypeSafe Jev](https://docs.typesafe.ai) 的逐工具调用授权审查。

设计参考：

- DeepSeek Harness `packages/experimental/auto-review`：沿用 Auto preset、`tools/pre-execute` 审查点、PTC inner call 覆盖、权限生命周期与 fail-closed 语义。
- `y0usaf/pi-jev`：沿用 Jev typed questions、校准阈值、参数裁剪和短期结果缓存的思路。

与原版 Auto review 的主要区别是：**不要求 reviewer 生成 `risk/decision` 自由文本 JSON**。Jev 一次返回多个独立的 `noul` / `score` 数值，本插件在本地用固定规则组合为最终 `allow` / `deny`。

## 行为

当当前 Session 选择 `Auto` 时，每个支持的原生工具调用和每个已启动的 PTC inner call 在执行 body 之前都会经过 Jev 审查。

- 低风险：项目内普通读写、分析、格式化、测试、构建等，直接允许。
- 中风险：破坏已有状态、生产环境操作、外部写入、权限/安全控制变更、高影响操作。只有当前 human/direct-parent 指令明确授权动作、目标和必要范围，并且没有冲突/越界时才允许。
- 高风险：敏感数据跨信任边界泄露，始终拒绝。
- Jev 超时、限流重试后失败、响应异常、上下文/Schema 无法可靠重建：**拒绝（fail closed）**。

外层 `run_code` 只是 PTC transport，不单独审查；其每个 PTC inner tool call 会单独审查。与上游 Auto review 一样，`run_code` 程序内部绕过 DSH tool registry 的直接 Node.js 副作用不在本插件审查范围内。

## 安装

从源码目录安装到 Web profile：

```bash
pnpm dsh plugin --profile web add /path/to/dsh-auto-review-jev
```

配置 TypeSafe API Key：

```bash
export TYPESAFE_API_KEY="..."
```

然后在 DSH Web 的权限选择器中选择 `Auto`，或执行：

```text
/permission auto
```

没有 `TYPESAFE_API_KEY` 时插件仍可加载，但不会允许切换到 Auto；如果已有 Auto Session 在运行而 key 失效，相关工具调用会 fail closed。

`Auto` 是 DSH 的单一固定集成点；请不要同时加载官方 `@deepseek-ai/dsh-experimental-auto-review` 与本插件。`permissionPresets.registerAuto()` 只允许一个 Auto reviewer，重复注册会在插件加载阶段报错。

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
pnpm check
```

包通过 `dsh.bundle.patch` 声明 `cordis.patch.yml`，可作为独立 DSH plugin 安装。

## 安全边界

Auto review 是风险降低层，不是隔离沙箱。允许的调用最终仍以 Auto preset 对应的 Full access 执行。若需要强隔离，应同时使用 DSH 自身 sandbox / deployment boundary，而不是依赖分类器代替隔离。

## License

MIT。参考实现与归属说明见 [NOTICE.md](NOTICE.md)。
