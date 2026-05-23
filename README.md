# 🎨 AutoIllustrator

> Automatic in-chat illustration for SillyTavern, driven by ComfyUI.

AutoIllustrator reads each character message, asks the LLM to split it into illustrated sections and write image prompts for them, then generates matching images through your local ComfyUI (or SwarmUI) instance — and inserts each one inline, right next to the text it depicts. It ships with prompt templates for most popular model families (Flux, Z-Image, Qwen, SD 1.5, Illustrious, NoobAI), a full **first-person POV** mode, multi-character avatar injection, automatic LoRA selection, per-preset workflows, and a persistent per-chat gallery.

---

## Features

- **Automatic scene splitting** — after each message the LLM divides the text into N sections and writes a tailored image prompt for every one, so illustrations land beside the passage they illustrate rather than all at the end
- **Per-model prompt formats** — built-in instruction templates for Flux, Flux 2 Klein, Z-Image, Qwen Image, SD 1.5, Illustrious, NoobAI, plus a free-form Custom mode; each carries sensible default resolution and negative prompts
- **👁️ First-person POV mode** — a parallel set of formats that frame every image through the viewer's own eyes: characters face the camera, the viewer's face/body is never drawn, hands appear only when interacting (`looking_at_viewer`, `pov_hands`, `from_above/below`, etc.)
- **Multi-character avatar injection** — collects character and user avatars (single char or group chat) and feeds them into your workflow via `%avatar_1%`…`%avatar_8%`, `%avatar_Name%`, `%char_avatar%` and `%user_avatar%` placeholders; missing slots get a safe blank 512×512 PNG (VAEEncode-safe)
- **LLM character detection** — the model reports which known characters are visually present in each section, so the right avatars are routed into the right image
- **Smart routing** — optionally hand any section that contains a character off to a *different* preset (e.g. a dedicated character-portrait workflow) while environment-only shots use the main one
- **Adaptive aspect ratio** — automatically widens or narrows the canvas based on how many people are in the scene (portrait for solo, wider for crowds)
- **LoRA auto-select** — give the LLM a labelled LoRA library and let it pick 0–N LoRAs per scene; selected LoRAs are injected as real `LoraLoader` nodes chained into your workflow, with trigger words appended to the prompt
- **Always-On LoRAs** — pin specific LoRAs (with trigger + weight) to every image in a preset
- **Character card descriptions** — feeds each character's card description/personality to the LLM as a visual reference so appearance stays consistent across images
- **Workflow presets** — save/load/duplicate/rename complete generation setups (workflow JSON, model, VAE, sampler, scheduler, steps, CFG, denoise, CLIP skip, format, LoRAs, routing)
- **Custom ComfyUI workflows** — paste any ComfyUI **API-format** workflow JSON; template variables are substituted at generation time
- **Persistent gallery** — every generated image is stored per-chat and survives reloads; a floating button opens a uniform grid with per-image and clear-all deletion
- **Inline controls** — a 🎨 button on each message to (re)illustrate it, a lightbox on click, click-to-copy prompts, a Cancel button on in-progress jobs, and a `/illustrate` slash command
- **VN-mode aware** — when used alongside an LLM-Tools VN reader, illustrating from a message button targets only the currently-visible chunk and places the image right after it
- **Direct or proxied** — talks to ComfyUI directly for speed, with the SillyTavern SD proxy as fallback
- **Image compression** — optionally downscale/recompress stored images to keep chat files small

---

## Requirements

| Requirement | Notes |
|---|---|
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | Latest stable recommended |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | Must be running and reachable (SwarmUI also works) |
| A diffusion model | Any checkpoint/UNET your workflow loads (Flux, SDXL, SD 1.5, Illustrious, etc.) |
| An LLM connection in SillyTavern | Used to split text and write image prompts via the quiet-generation API |

> AutoIllustrator does **not** ship a workflow — you supply your own ComfyUI API-format workflow JSON per preset and wire in the template variables below.

---

## Installation

1. Open SillyTavern → **Extensions** → **Install Extension**
2. Paste the URL of this repository and click Install
3. Reload the page — the **🎨 AutoIllustrator** panel will appear in the Extensions sidebar

Or install manually:

```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/virgilianshailer/AutoIllustrator
```

---

## Setup

1. Make sure ComfyUI is running (default: `http://127.0.0.1:8188`; SwarmUI is usually `:7821`)
2. Open the **AutoIllustrator** panel in SillyTavern's extension settings
3. Under **🔌 ComfyUI Endpoint**, leave the URL blank to auto-detect, or set it manually — then click **🔍 Detect** / **🧪 Test** to confirm the connection (a working test reports VRAM)
4. Click **➕ New** to create a preset and give it a name
5. Pick a **Prompt Format** matching your model (e.g. *Flux*, *Illustrious*, or a *POV* variant) — width/height auto-fill to that format's defaults
6. Click **🔄 Load from ComfyUI** to populate the Model / VAE / Sampler / Scheduler suggestion lists, then fill in **Generation Params**
7. Paste your ComfyUI **API-format** workflow JSON into the **ComfyUI Workflow** box and wire in the template variables (see below)
8. Enable the extension with the **Enable** checkbox and (optionally) **Auto-generate**
9. Send or open a message — illustrations generate automatically, or click the 🎨 button on any message / run `/illustrate`

---

## Settings Reference

### General

| Setting | Default | Description |
|---|---|---|
| **Enable** | off | Master on/off switch; also shows/hides the per-message 🎨 buttons |
| **Auto-generate** | on | Illustrate character messages automatically as they arrive |
| **Images per msg** | 2 | How many sections/images to request per message (1–10) |
| **Direct ComfyUI** | on | Talk to ComfyUI directly first; fall back to the ST proxy |
| **Compress** | on | Downscale & recompress stored images to save space |
| **Gallery btn** | on | Show the floating gallery button |
| **🙈 Hide image prompts** | off | Hide the prompt caption shown beneath each generated image |

### Preset (per-preset settings)

| Setting | Description |
|---|---|
| **Preset** | The active workflow preset; use ➕New / ✏️Ren / 📋Dup / 🗑️Del to manage them |
| **🔀 Smart Routing** | Route sections that contain a character to a different "Char preset"; environment-only sections use the current one |
| **📐 Adaptive Aspect** | Auto-adjust width/height based on the LLM's per-scene person count |
| **👤 Character card descriptions** | Send character card description/personality to the LLM as a visual reference for consistency |
| **Prompt Format** | Model-specific instruction template (Standard or 👁️ POV); sets default resolution & negatives |
| **Width / Height** | Base resolution (📐 button re-applies the format's defaults) |
| **Negative** | Negative prompt (falls back to the format default if blank) |
| **Custom LLM Instructions** | Override the format's built-in prompt-style instructions |
| **ComfyUI Workflow (API JSON)** | Your ComfyUI API-format workflow with template variables |

### Generation Params (per-preset)

| Setting | Description |
|---|---|
| **🔄 Load from ComfyUI** | Fetch available Models / VAEs / Samplers / Schedulers / LoRAs into the suggestion lists |
| **Model** | Checkpoint or UNET filename (`%model%`) |
| **VAE** | VAE filename (`%vae%` / `%vae_name%`) |
| **Sampler / Scheduler** | Sampler & scheduler names (`%sampler%` / `%scheduler%`) |
| **🔮 Always-On LoRAs** | LoRAs (file + trigger + weight) injected into every image of this preset |
| **Steps / CFG / Denoise / CLIP** | Standard sampler parameters (`%steps%`, `%cfg%`, `%denoise%`, `%clip_skip%`) |

### LoRA Auto-Select (per-preset)

| Setting | Description |
|---|---|
| **Enable** | Let the LLM choose LoRAs per scene from your library |
| **Max** | Maximum LoRAs selected per image (1–5) |
| **🔄 Fetch** | Pull the LoRA list from ComfyUI and append new entries to the library |
| **Library** | One LoRA per line: `# file \| tags \| trigger \| weight` (tags guide the LLM, trigger is appended to the prompt, weight defaults to 0.8) |

### Endpoint & Positions

| Setting | Default | Description |
|---|---|---|
| **ComfyUI URL** | auto-detect | Endpoint address; `:8188` ComfyUI, `:7821` SwarmUI |
| **🔍 Detect / 🧪 Test** | — | Scan common local ports / verify the connection |
| **Gallery position** | mid-right | Where the floating gallery button sits |
| **Msg button position** | bottom-right | Where the per-message 🎨 button sits |

### Action buttons

| Button | Description |
|---|---|
| **🎨 Go** | Illustrate the latest character message |
| **🔄 Redo** | Re-illustrate the most recently processed message |
| **🗑️ Clear** | Remove illustrations from the most recently illustrated message |

---

## Workflow Template Variables

Use these placeholders in your custom workflow JSON — they are replaced at generation time. String values are JSON-escaped automatically; numeric values may be written either bare or quoted (e.g. `"%steps%"`).

| Variable | Description |
|---|---|
| `%prompt%` | The LLM-generated image prompt for the section |
| `%negative_prompt%` | Negative prompt |
| `%model%` | Checkpoint / UNET filename |
| `%vae%` / `%vae_name%` | VAE filename |
| `%sampler%` | Sampler name |
| `%scheduler%` | Scheduler name |
| `%width%` / `%height%` | Image resolution (after adaptive-aspect adjustment, if enabled) |
| `%seed%` | Random seed |
| `%steps%` | Sampler step count |
| `%cfg%` / `%scale%` | CFG scale |
| `%denoise%` | Denoise strength |
| `%clip_skip%` | CLIP skip |
| `%batch%` / `%batch_size%` | Batch size (always 1) |
| `%clip_name%` / `%clip_name1%` / `%clip_name2%` | CLIP filenames (pulled from ST's SD settings, if present) |
| `%user_avatar%` | The user's avatar as base64 *(blank PNG if unavailable)* |
| `%char_avatar%` | The main character's avatar as base64 |
| `%avatar_1%` … `%avatar_8%` | Detected characters' avatars by scene order; unused slots get a blank PNG |
| `%avatar_Name%` | A specific character's avatar by name |

> Avatar placeholders are intended for reference/IP-Adapter/face-detailer style workflows. Any avatar slot the LLM doesn't fill is substituted with a black 512×512 PNG so VAEEncode-based nodes don't break.

---

## Prompt Formats

Each format injects model-appropriate instructions and ships with a default resolution and negative prompt.

| Format | Default size | Style |
|---|---|---|
| Flux | 1152×896 | Vivid natural-language prompt |
| Flux 2 Klein | 1024×768 | Concise 1–2 sentence prompt |
| Z-Image | 1024×768 | Natural language + quality tags |
| Qwen Image | 1024×768 | Structured: subject, setting, style, colours |
| SD 1.5 | 768×512 | Comma-separated tags with `(emphasis:1.3)` |
| Illustrious | 1216×832 | Danbooru tags |
| Noob AI | 1216×832 | Danbooru / Gelbooru tags |
| Custom | 1024×768 | Free-form (use Custom LLM Instructions) |

Every standard format has a **👁️ POV** counterpart. In POV mode the prompt is rewritten so the image shows exactly what the viewer (your persona) sees: characters face the camera, the viewer's face/hair/body are never drawn, hands appear only when physically interacting, and tags like `looking_at_viewer`, `pov_hands`, `from_above`/`from_below` and `eye_contact` are added where relevant.

---

## How It Works

```
Character message received
        ↓
LLM splits text into N sections + writes an image prompt for each
   (also: per-scene person count, visible characters, optional LoRA picks)
        ↓
For each section:
   resolve avatars → adapt aspect ratio → inject LoRA nodes → fill workflow
        ↓
Submit to ComfyUI (/prompt) → poll /history until done → fetch image
        ↓
Compress (optional) → store in message → render inline next to its text
        ↓
Saved per-chat → re-rendered on reload / swipe, browsable in the gallery
```

The per-message 🎨 button, **🎨 Go**, and the `/illustrate` slash command all run the same pipeline on demand. In-progress jobs can be cancelled from the spinner's Cancel button.

---

## Gallery

The floating 🖼️ button opens a uniform 4:3 grid of every image saved in the current chat, with a count badge.

- Click any thumbnail to open it full-size in the lightbox (with its prompt)
- Hover a thumbnail and click ✕ to delete that single image
- **🗑️ Clear All** removes every image in the chat after an inline confirmation

---

## Troubleshooting

**No images are generated**
- Check that ComfyUI is running and the URL is correct (use the 🧪 Test button — it should report VRAM)
- Confirm an active preset exists and its **ComfyUI Workflow** box contains valid API-format JSON
- Open your browser console and look for `[AutoIllustrator]` log lines

**"No active preset" warning**
- Create a preset with ➕ New and paste a workflow into it — the extension won't generate without one

**ComfyUI returns a node error**
- Node/queue errors are surfaced as toasts; verify your workflow's model, VAE, sampler and scheduler names match what ComfyUI actually has (use **🔄 Load from ComfyUI** to populate valid options)

**Images appear at the end of the message instead of inline**
- Inline placement matches section text to rendered HTML blocks; if matching fails it falls back to even spacing. Very heavily reformatted messages can reduce match accuracy

**Avatars aren't showing up in images**
- Avatar injection only does something if your workflow uses the `%avatar_*%` / `%char_avatar%` / `%user_avatar%` placeholders and has nodes that consume images (e.g. IP-Adapter, reference, face detailer)
- Unfilled slots are intentionally replaced with a blank PNG

**LoRAs aren't applied**
- Enable **LoRA Auto-Select** and make sure the library has entries; auto-selection silently disables itself if the library is empty
- LoRA injection requires a `CheckpointLoaderSimple`/`CheckpointLoader` or `UNETLoader` node in the workflow to chain from

**Images vanish or look low quality after reload**
- Stored images are recompressed when **Compress** is on; lower the compression aggressiveness via the stored-width/quality defaults if needed

---

## Version History

| Version | Changes |
|---|---|
| 3.3 | Gallery delete (single + clear-all) & uniform grid, POV prompt formats for all model types, VAEEncode-safe blank PNG, multi-character avatar system, per-scene LLM character detection, custom ComfyUI endpoint, real LoRA node injection |
| 3.x | Per-preset workflows, smart routing, adaptive aspect, LoRA auto-select & always-on LoRAs, character card descriptions, VN-mode aware illustration |

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

*AutoIllustrator is a third-party extension and is not affiliated with SillyTavern.*
