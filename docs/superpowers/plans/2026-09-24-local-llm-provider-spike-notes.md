# Local LLM toolchain spike — outcome

English | [中文](2026-09-24-local-llm-provider-spike-notes.zh.md)

> Task 1 of `2026-09-24-local-llm-provider-deepseek-harness.md`. Executed 2026-09-25 in `/tmp/llm-local-spike` on Fedora Linux x64 (kernel/desktop host), Node v26.8.2.

## Result: PASS — with mandatory adapter deviations

**`node-llama-cpp@3.21.1` loads a Qwen3.5 GGUF and streams text on this toolchain.** The plan's draft script produced an empty reply with zero stream chunks; the model file itself is fine (see integrity below). Deviations Task 6 must copy:

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

## Facts recorded for Task 6

- **Chat wrapper is mandatory.** The library's default wrapper produced `final=""` and zero `onTextChunk` callbacks. Root cause: the GGUF carries a `tokenizer.chat_template` jinja (Qwen3.5 multimodal), but binding 3.21.1 does not recognize it — `model.chatTemplate === undefined`. With the default wrapper the model degenerates (raw `seq.evaluate` output repeats `"# 1.1. 1.1."`). An explicit `new QwenChatWrapper()` produced a complete, streamed reply of 68 chunks ending in normal termination. The 0.8B/Q4_0 run answered the "Say \"spike ok\"" prompt with on-topic content; small-model answer quality is out of scope for the spike, and thinking-block stripping (the `<think>` sections in the manual-template run) was NOT tested.
- **Backend choice.** `getLlama()` defaulted to the `vulkan` backend and hung during init in this environment (first run never reached the first marker); a later isolated probe with `vulkan: true` resolved, so the hang is environment/GPU-driver dependent. The CPU-only path — `getLlama({ gpu: false })` — loads and generates fast on this host. Spec targets CPU-only: pin `gpu: false` in the production adapter and do not rely on the default.
- **Context size.** `model.trainContextSize` is 262144; `createContext()` default reserves for that. The adapter must pass an explicit `contextSize` (e.g. 8192) or the RAM recommendation's safety margin is blown by the KV reservation alone.
- **Integrity (catalog checksum, 0.8B Q4_0).** Downloaded file sha256 `444406ddd926550c724ec18d5120a9d40ded44908a063b0e66e9a7e5464c652c`, size `507154688` B — matches the HF LFS oid for `unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_0.gguf` exactly. Task 2's catalog placeholder can be filled with this value.
- **Install scripts.** `node-llama-cpp` ships a `postinstall` (`node ./dist/cli/cli.js postinstall`) that fetches prebuilt binaries; the workspace's `strictDepBuilds` blocks it silently (Task 9 must add `allowBuilds: { 'node-llama-cpp': true }` in the project-manager template at `apps/desktop/src/project-manager.ts`, not only `asarUnpack`). The vendored CPU-only native assets live under `@node-llama-cpp/linux-x64/bins/` (libs + `llama-addon.node`, no CLI binary).
- **API shape from this run** (matches the plan's draft `getLlama`/`loadModel`/`createContext`/`LlamaChatSession` call sequence; the two mandatory options above are the only deltas).
- **maxTokens semantics.** The earlier "empty reply" run used `maxTokens: 24`; Qwen3.5 spends those on reasoning before answer text, so the probe truncated inside thinking. Use ≥ several hundred tokens when smoke-testing at runtime.

## Cleanup

`/tmp/llm-local-spike` holds the 483.7 MiB fixture and scratch `node_modules`; safe to delete once Task 6 is implemented (delete earlier if the host needs the space — re-download per Task 1 Step 1 if needed again).
