# 本地 LLM 工具链 spike — 结果

[English](2026-09-24-local-llm-provider-spike-notes.md) | 中文

> `2026-09-24-local-llm-provider-deepseek-harness.md` 的 Task 1。2026-09-25 在 `/tmp/llm-local-spike` 中于 Fedora Linux x64（kernel/desktop 主机）、Node v26.8.2 上执行。

## 结果：通过 —— 但适配器必须偏离

**`node-llama-cpp@3.21.1` 在该工具链上可以加载 Qwen3.5 GGUF 并流式输出文本。** 计划中的草稿脚本产生了空回复且没有任何流式分片；模型文件本身没有问题（见下方完整性记录）。Task 6 必须照抄以下偏离：

```js
import { getLlama, LlamaChatSession, QwenChatWrapper } from 'node-llama-cpp'

const llama = await getLlama({ gpu: false })          // mandatory: see vulkan note
const model = await llama.loadModel({ modelPath: '/path/to/Qwen3.5-0.8B-Q4_0.gguf' })
const context = await model.createContext()
const session = new LlamaChatSession({
  contextSequence: context.getSequence(),
  chatWrapper: new QwenChatWrapper(),                 // mandatory: see chat-wrapper note
})

const reply = await session.prompt('...', {
  maxTokens: 600,                                     // plan's 24-token probe truncated thinking mid-stream
  onTextChunk: chunk => process.stderr.write(chunk),  // streams; 68 chunks on the OpenAI-style prompt below
})
```

## 为 Task 6 记录的事实

- **chat wrapper 是必需的。** 库的默认 wrapper 产生 `final=""` 且没有触发任何 `onTextChunk` 回调。根因是该 GGUF 带有 `tokenizer.chat_template` jinja 模板（Qwen3.5 多模态），但绑定的 3.21.1 无法识别它 —— `model.chatTemplate === undefined`。使用默认 wrapper 时模型退化（`seq.evaluate` 的原始输出重复 `"# 1.1. 1.1."`）。显式 `new QwenChatWrapper()` 产生了完整的流式回复，共 68 个分片并正常结束。0.8B/Q4_0 那次运行对 "Say \"spike ok\"" 提示词给出了切题的回复；小模型的回答质量不在本次 spike 范围内，并且**没有**测试思考块剥离（手动模板运行中的 `<think>` 段落）。
- **后端选择。** `getLlama()` 在该环境中默认选择 `vulkan` 后端并在初始化时挂起（首次运行从未到达第一个标记）；随后一次带 `vulkan: true` 的隔离探针能够完成，因此该挂起取决于环境与 GPU 驱动。纯 CPU 路径 —— `getLlama({ gpu: false })` —— 在该主机上加载与生成都很快。规格目标是纯 CPU：在生产适配器中固定 `gpu: false`，不要依赖默认值。
- **上下文大小。** `model.trainContextSize` 是 262144；`createContext()` 的默认值就按它预留。适配器必须显式传入 `contextSize`（例如 8192），否则仅 KV 预留一项就会吃掉内存推荐所依据的安全余量。
- **完整性（目录校验和，0.8B Q4_0）。** 下载文件的 sha256 为 `444406ddd926550c724ec18d5120a9d40ded44908a063b0e66e9a7e5464c652c`，大小 `507154688` B —— 与 `unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_0.gguf` 的 HF LFS oid 完全一致。Task 2 目录中的占位值可以填入该值。
- **安装脚本。** `node-llama-cpp` 附带一个 `postinstall`（`node ./dist/cli/cli.js postinstall`）用于拉取预编译二进制；工作区的 `strictDepBuilds` 会静默阻止它（Task 9 必须在 `apps/desktop/src/project-manager.ts` 的 project-manager 模板中加入 `allowBuilds: { 'node-llama-cpp': true }`，不能只加 `asarUnpack`）。内置的纯 CPU 原生产物位于 `@node-llama-cpp/linux-x64/bins/`（库文件与 `llama-addon.node`，没有 CLI 二进制）。
- **本次运行的 API 形态**（与计划草稿的 `getLlama`/`loadModel`/`createContext`/`LlamaChatSession` 调用顺序一致；上述两个必需选项是仅有的差异）。
- **maxTokens 语义。** 之前那次"空回复"运行使用了 `maxTokens: 24`；Qwen3.5 在答案文本之前就消耗这些 token，因此探针在思考过程中被截断。运行时做冒烟测试时使用数百个 token 以上。

## 清理

`/tmp/llm-local-spike` 保存着 483.7 MiB 的样本文件和临时 `node_modules`；Task 6 实现完成后即可安全删除（如果主机需要空间可以更早删除 —— 如再次需要，按 Task 1 步骤 1 重新下载）。
