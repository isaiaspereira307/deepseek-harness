---
description: "Desktop Local models settings list the on-device Qwen3.5 catalog and manage downloads, activation, and deletion through the Host Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-local-models

English | [中文](README.zh.md)

## Summary

Desktop Local models settings list the on-device Qwen3.5 catalog and manage downloads, activation, and deletion through the Host Remote.

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

The section owns feature copy in English and Chinese, and it reaches the Host only through the generated `llmLocal` Remote namespace: catalog, per-model status, download, cancel, activation, and deletion.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin builds one `LocalModelsStore` from its own context and injects it into `settings.section` together with the section's snapshot as a hooks compartment member, which the renderer binds to `useLocalModels`. The store joins the Host catalog with the Host status list on every load, and it polls that status while any row reports a download in progress. One load at a time serves every caller. Each mutation refreshes the joined list and publishes its own failure text after the refresh, so a rejected write stays visible.

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

- **First-run recommendation has no consumer yet** — the store exports a `localModelsReadiness` projection for the first-run step, but no plugin reads it until that step lands, so nothing recommends a model to a new installation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The store owns one in-flight load and one poll handle; a mutation runs before the refresh it triggers, and the poll interval is a protocol constant of the progress display. The Host side of the same feature is [@deepseek-ai/dsh-llm-local](../../llm/llm-local/README.md).

</details>

**Runtime invariant:** No companion is published. The section renders Host-owned catalog and status data and never keeps a second copy that could diverge.
