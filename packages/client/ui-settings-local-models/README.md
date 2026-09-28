---
description: "Local models settings list the on-device Qwen3.5 catalog, manage downloads, activation, and deletion through the Host Remote, and offer a first-run user the model that fits their device."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-local-models

English | [中文](README.zh.md)

## Summary

Local models settings list the on-device Qwen3.5 catalog, manage downloads, activation, and deletion through the Host Remote, and offer a first-run user the model that fits their device.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The section registers through `settings.section` and appears in Settings for every client that loads the Web app roster, which covers Desktop and Web. One row per catalog entry shows the display name, the download size, and the state the Host reports: not downloaded, downloading with a percentage, ready, or in use. The row offers the actions its own state allows: Download for a model that is not on disk, Cancel while it downloads, Use this model once it is ready, and Delete for a model that is on disk.

Sizes use decimal units with one decimal place for gigabytes and whole megabytes below that. A download the Host rejected keeps the catalog and reports the failure text above the rows; a failed catalog read replaces the list with that same text and a Retry action. Deleting a model asks for confirmation first, and declining leaves the file on disk.

The plugin also registers a first-run step in `settings.onboarding`, after the official DeepSeek credential step. It offers the model the Host recommends for the machine's memory, with its size and a Download action; that download then runs in the section, which reports its progress. A machine short on memory is told the smallest model we offer and how much memory it needs, and a user who already has a model on disk is offered nothing. Every path completes the step, so declining never blocks first run.

Both entries own feature copy in English and Chinese, and they reach the Host only through the generated `llmLocal` Remote namespace: catalog, per-model status, recommendation, download, cancel, activation, and deletion.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin builds one `LocalModelsStore` from its own context and injects it into both registrations together with its snapshot as a hooks compartment member, which the renderer binds to `useLocalModels`. The store joins the Host catalog, the Host status list, and the Host's recommendation on every load, and it polls that status while any row reports a download in progress. One load at a time serves every caller. Each mutation refreshes the joined list and publishes its own failure text after the refresh, so a rejected write stays visible.

The step reads the same snapshot through a pure projection of the whole state, so its own next move is one value: wait, complete, offer a model, or explain the memory floor. The step completes itself for every outcome it cannot offer through, including a failed load, which keeps it from holding the first-run queue.

The store keeps no independent copy of the catalog, so no invariant companion is published.

<a id="further-exploration"></a>
## Further Exploration

The [settings subsystem](../../../docs/subsystems/settings.md) owns the section list; the [Web client architecture](../../../docs/subsystems/web-client.md) explains composition and the props shares a component receives.

<a id="model-experience"></a>
## Model Experience

None, as the section renders Host catalog and status data and issues Host mutations; it contributes nothing to a model request.

#### KV Cache effect

Independent of the prompt prefix cache: the section never enters a request, so it neither invalidates nor reuses a prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The first-run step has no launcher entry** — the settings launcher reopens the official DeepSeek credential step only, so a user who declines the local model offer reaches it through Settings, not from the launcher.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The store owns one in-flight load and one poll handle; a mutation runs before the refresh it triggers, and the poll interval is a protocol constant of the progress display. The first-run step's dialog is the shared `OnboardingModal` from `ui-primitives`, because two feature packages now need the same blocking step chrome. The Host side of the same feature is [@deepseek-ai/dsh-llm-local](../../llm/llm-local/README.md).

</details>

**Runtime invariant:** No companion is published. The section renders Host-owned catalog and status data and never keeps a second copy that could diverge.
