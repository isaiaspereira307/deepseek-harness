---
description: "本地、无云端的 LLM provider：按需下载 Qwen3.5 GGUF 权重，并通过 node-llama-cpp 以纯 CPU 推理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-local

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-llm-local` 注册固定的 `local` provider 路由，后端是目录中的两个 Qwen3.5 GGUF 变体（0.8B 与 4B，Q4_0）。该插件从 Hugging Face 流式下载权重，校验 sha256 后再原子重命名；按机器内存加上可配置的安全余量推荐能容纳的最大变体；并在进程内以纯 CPU 的 `node-llama-cpp` 运行推理。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

当某个组合必须不依赖云端模型 provider 时挂载此插件。路由名固定为 `local`，没有凭据，模型目录恰好是 `src/catalog.ts` 中的两个条目。下载的权重存放在配置的 `modelsDir` 下；启用哪个模型由标准模型选择接缝传入其目录 id 决定。

```yaml
- name: '@deepseek-ai/dsh-llm-local'
  config:
    modelsDir: /var/lib/dsh/models
    ramSafetyMarginBytes: 2147483648
    contextSize: 8192
```

- `modelsDir` 缺失时创建；下载流式写入 `<modelsDir>/<id>.gguf`。
- `ramSafetyMarginBytes` 是模型的 `minRamBytes` 必须超过的余量，推荐才会提供该模型。
- `contextSize` 限制每次加载的 KV 预留；Qwen3.5 的默认上下文（262144）会分配远多于推荐所假设的内存（见 `docs/superpowers/plans/2026-09-24-local-llm-provider-spike-notes.md` 中的 Task 1 spike 记录）。

### 模型目录

| id | 显示名 | 大小 | sha256（前 12 位） | 最低内存 |
|---|---|---|---|---|
| `qwen3.5-0.8b-q4_0` | Qwen3.5 0.8B | 507,154,688 B | `444406ddd926` | 2 GiB |
| `qwen3.5-4b-q4_0` | Qwen3.5 4B | 2,583,221,408 B | `298fcb5fe7a7` | 6 GiB |

两个校验和都等于对应文件公开的 Hugging Face LFS oid。sha256 不匹配的下载会被删除，绝不会落到目标位置。

<a id="model-experience"></a>
## 模型体验

### 本地模型请求

#### 模型看到什么

选中的目录模型会收到经过 Qwen chat 包装器（`QwenChatWrapper`）渲染的会话最后一条消息文本，`maxTokens` 受 `contextSize` 限制。该包装器是必需的：`node-llama-cpp` 3.21.1 不读取 GGUF 内嵌的 `tokenizer.chat_template`，默认包装器会产生空回复（Task 1 spike 记录）。

#### Token 影响

具体输入由 provider 的分词决定。适配器遵循请求中的 `maxTokens`；Qwen3.5 在答案文本之前先输出思考块，因此较小的输出上限会在没有可见答案文本的情况下截断推理。

#### KV Cache 影响

每个请求都重新加载模型并构建一个 `contextSize` token 的上下文；没有状态跨请求保留，因此每个请求都完整承担提示词开销，不复用任何前缀。切换启用模型会在下次加载时释放上一个模型的内存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅文本，不支持工具调用** — 适配器只渲染文本内容并只发出文本块；不产生 `GenerateOptions.tools` 的工具调用块，因此路由到 `local` 的会话无法驱动 harness 的工具面。
- **历史记录渲染为带标签的段落** — 非 system 消息变成 `User: `/`Assistant: `/`Tool result: ` 段落；非文本内容块不产生任何内容。
- **每个请求都重新加载模型** — 每次 `stream` 调用都加载 GGUF 并分配全新上下文；连续请求要承担模型加载延迟，且内存中不缓存权重。
- **没有用量统计** — 适配器不发出 `usage` 块，因此 token 计量不会为 `local` 请求归集任何成本。
- **下载不可续传** — 失败或取消的下载从零重新开始（规格中判定为范围外）。
- **纯 CPU 推理** — 固定 `gpu: false`；spike 环境中 vulkan 后端在初始化时挂起，GPU 卸载不在范围内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

`node-llama-cpp` 是懒加载的：插件构造时不带原生插件，第一个需要权重的请求才加载它。`src/catalog.ts` 中的目录是这两个已发布变体的唯一来源；新增变体需要其公开的 Hugging Face LFS oid、`minRamBytes`，以及下载在原子重命名前校验的校验和。

该路由固定且无凭据，因此此包不注册设置分区，也不写入凭据存储。它的客户端一侧是 [@deepseek-ai/dsh-client-ui-settings-local-models](../../client/ui-settings-local-models/README.zh.md)。

</details>

**运行时不变量：** 不发布伴随包。该服务拥有自己的目录、下载记录与启用模型指针，读取这些值的读者都通过服务自身的方法访问。
