---
description: "Local, no-cloud LLM provider: downloads Qwen3.5 GGUF weights on demand and runs CPU-only inference through node-llama-cpp."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-local

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-local` registers the fixed `local` provider route backed by two cataloged Qwen3.5 GGUF variants (0.8B and 4B, Q4_0). The plugin streams downloads from Hugging Face with sha256 verification before an atomic rename, recommends the largest variant that fits the machine's RAM plus a configurable safety margin, and runs inference in-process with CPU-only `node-llama-cpp`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when a composition must run without a cloud model provider. The route name is fixed (`local`), there are no credentials, and the model catalog is exactly the two entries in `src/catalog.ts`. Downloaded weights live under the configured `modelsDir`; the active model is chosen by passing its catalog id through the standard model selection seam.

```yaml
- name: '@deepseek-ai/dsh-llm-local'
  config:
    modelsDir: /var/lib/dsh/models
    ramSafetyMarginBytes: 2147483648
    contextSize: 8192
```

- `modelsDir` is created when missing; downloads stream to `<modelsDir>/<id>.gguf`.
- `ramSafetyMarginBytes` is the headroom a model's `minRamBytes` must clear before the recommendation offers it.
- `contextSize` caps the per-load KV reservation; Qwen3.5's default context (262144) would allocate far more RAM than the recommendation assumes (see the Task 1 spike notes in `docs/superpowers/plans/2026-09-24-local-llm-provider-spike-notes.md`).

### Model catalog

| id | Display name | Size | sha256 (first 12) | Min RAM |
|---|---|---|---|---|
| `qwen3.5-0.8b-q4_0` | Qwen3.5 0.8B | 507,154,688 B | `444406ddd926` | 2 GiB |
| `qwen3.5-4b-q4_0` | Qwen3.5 4B | 2,583,221,408 B | `298fcb5fe7a7` | 6 GiB |

Both checksums equal the files' published Hugging Face LFS oids. A download whose sha256 does not match is deleted and never lands at the destination.

## Model Experience

### Local model request

#### What the model sees

The selected catalog model receives the conversation's final message text rendered through Qwen's chat wrapper (`QwenChatWrapper`), with `maxTokens` bounded by `contextSize`. The wrapper is mandatory: `node-llama-cpp` 3.21.1 does not read the GGUF's embedded `tokenizer.chat_template`, and the default wrapper produces empty replies (Task 1 spike notes).

#### Token effect

Provider tokenization governs exact input. The adapter honors the request's `maxTokens`; Qwen3.5 emits thinking blocks before answer text, so small output caps truncate reasoning without visible answer text.

#### KV Cache effect

Each request loads the model fresh and builds one context of `contextSize` tokens; no state carries across requests, so every request pays the full prompt and no prefix is reused. Swapping the active model drops the previous model's memory at the next load.

## Known Limitations and Deferred Work

- **Text-only, no tool calls** — the adapter renders text content and emits text chunks only; tool-call chunks from `GenerateOptions.tools` are not produced, so sessions routed to `local` cannot drive the harness's tool surface.
- **History renders as labeled paragraphs** — non-system messages become `User: `/`Assistant: `/`Tool result: ` paragraphs; non-text content blocks contribute nothing.
- **Model reload per request** — every `stream` call loads the GGUF and allocates a fresh context; repeated requests pay model-load latency and no weights are cached in memory.
- **No usage accounting** — the adapter emits no `usage` chunk, so token metering attributes no cost to `local` requests.
- **No resumable downloads** — a failed or cancelled download restarts from zero (spec out-of-scope decision).
- **CPU-only inference** — `gpu: false` is pinned; the vulkan backend hung on init in the spike environment and GPU offload is out of scope.
