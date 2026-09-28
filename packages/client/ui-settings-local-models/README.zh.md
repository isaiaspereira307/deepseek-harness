---
description: "Desktop 本地模型设置列出设备上的 Qwen3.5 目录，并通过 Host Remote 管理下载、启用与删除。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-local-models

[English](README.md) | 中文

## 概述

Desktop 本地模型设置列出设备上的 Qwen3.5 目录，并通过 Host Remote 管理下载、启用与删除。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

该分区通过 `settings.section` 注册，出现在所有加载 Web 应用名单的客户端的设置中，涵盖 Desktop 与 Web。目录中的每个条目占一行，显示名称、下载大小以及 Host 报告的状态：未下载、正在下载并带百分比、已就绪或使用中。每一行只提供该状态允许的操作：模型不在磁盘上时提供下载，下载中提供取消，就绪后提供使用该模型，已在磁盘上的模型提供删除。

大小使用十进制单位：GB 保留一位小数，更小的使用整 MB。Host 拒绝的下载会保留目录，并在各行上方报告失败文本；目录读取失败会用同样的文本替换列表，并提供重试操作。删除模型前先请求确认，放弃确认会把文件留在磁盘上。

该分区以英文和中文提供功能自身的文案，并且只通过生成的 `llmLocal` Remote 命名空间访问 Host：目录、每个模型的状态、下载、取消、启用与删除。

<a id="understand-the-implementation"></a>
## 理解实现

插件用自身上下文构建一个 `LocalModelsStore`，把它与该分区的快照一起注入 `settings.section`；快照位于 hooks 隔层中，渲染器将其绑定为 `useLocalModels`。每次加载时，store 都会把 Host 目录与 Host 状态列表合并；当任一行报告正在下载时，它会轮询该状态。同一时刻只进行一次加载。每次变更都会刷新合并后的列表，并在刷新之后发布自身的失败文本，因此被拒绝的写入仍然可见。

store 不保留目录的独立副本，因此不发布 invariant 伴随包。

<a id="further-exploration"></a>
## 深入探索

[settings 子系统](../../../docs/subsystems/settings.zh.md) 拥有分区列表；[Web 客户端架构](../../../docs/subsystems/web-client.zh.md) 说明组合方式以及组件接收的 props 共享层。

<a id="model-experience"></a>
## 模型体验

没有。该分区渲染 Host 的目录与状态数据并发出 Host 变更，不向模型请求贡献任何内容。

#### KV Cache effect

与提示词前缀缓存无关：该分区从不进入请求，因此既不会使前缀失效，也不会复用前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **首次运行的推荐还没有消费方** — store 为首次运行步骤导出 `localModelsReadiness` 投影，但在该步骤落地之前没有插件读取它，因此不会向新安装推荐任何模型。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

store 持有一个进行中的加载和一个轮询句柄；每次变更先执行自身操作，再触发刷新，轮询间隔是进度显示的协议常量。同一功能的 Host 侧是 [@deepseek-ai/dsh-llm-local](../../llm/llm-local/README.zh.md)。

</details>

**运行时不变量：** 不发布伴随包。该分区渲染 Host 拥有的目录与状态数据，不会保留可能产生分歧的第二份副本。
