/**
 * AutoIllustrator v3.25.2
 *  - The face of the moment: the Gemini and GPT prompt formats (and their POV
 *    pairs) ask for each character's expression derived from the text and
 *    described physically (mouth, brows, eyes), with "not smiling" unless the
 *    text implies a smile; character avatars are captioned "face, hair and
 *    build only — NOT the facial expression", because the engine copied the
 *    avatar's one face into every scene.
 *  - refImages role 'previous': the previous storyboard page, attached so
 *    wardrobe, faces, the location and the drawing style carry across sheets.
 *    It needs its OWN caption — of every reference this is the one the model
 *    is most tempted to imitate wholesale, because it looks exactly like the
 *    thing being asked for, so the caption says continuity and explicitly
 *    forbids reusing its layout.
 *  - A gutter's width cap is derived from the smallest CELL the detector
 *    accepts, not from the axis length. As a flat share of the axis it meant
 *    the same physical gutter passed on the long side and failed on the
 *    short one: a real 3x4 sheet with generous white gutters lost every ROW
 *    cut, so each "panel" came out a full-height column with three drawn
 *    panels inside it. Measured over the whole stored sheet corpus: the one
 *    misread sheet is fixed, the other fourteen read identically.
 *  - Storyboard analysis READS the grid the model actually drew instead of
 *    only verifying the one it was asked for: full-width horizontal gutters
 *    cut the sheet into rows, each row is scanned for its own column gutters
 *    (rows need not agree), and the result carries `panels` rects the caller
 *    crops by even when the model redrew the grid its own way. A cut must be
 *    white at the core — the edge of a white paper drawn INSIDE a panel
 *    peaks visibly dimmer and is further rejected by cross-row support.
 *  - illustrateStoryboard takes ANY preset with a backend (was Gemini-only);
 *    a backend that cannot hold a grid just lands in the whole-sheet tier.
 *    analyzeStoryboardSheet() re-reads already-stored sheets.
 *  - Storyboard crop geometry is a RANGE PER CELL, not a boundary line: the
 *    gutter (and any outer white frame the model drew anyway) is excluded
 *    from both neighbours. Cutting at the middle of a white gutter left half
 *    of it along the panel edge — visible as a white hairline.
 *  - getPresets() reports `usable` and `gemini` per preset — the storyboard
 *    picker offers every usable preset; `gemini` still tells a caller which
 *    backend actually holds strict grids reliably.
 *  - Link a preset to a CHAT: "🔗 Always use for this chat" stores the preset id
 *    in the chat's own metadata, so re-opening that chat activates the preset.
 *    The link lives IN the chat (not in a settings dictionary keyed by a name):
 *    it survives renaming, cannot collide with a chat of another character, and
 *    dies together with the chat. The chat is the narrower owner, so it wins
 *    over the per-character link; a link to a deleted preset falls back to it.
 *  - illustrateStoryboard({ panels, refImages }): one sheet, N panels in a
 *    strict grid, gutter-verified crop boundaries — the VN storyboard door.
 *  - illustrateText({ refImages }): reference pictures a CALLER supplies, each
 *    with a role ('character' | 'scene'). Until now the only way a picture
 *    reached the backend was avatarMap, and the Gemini branch captions every
 *    attachment as "the appearance of the character" — so a room sent that way
 *    was an instruction to draw the room AS a person. Roles caption themselves.
 *  - avatarsFor(names): avatars for EXACTLY the named cards, no "take the first
 *    one" fallback. collectAllAvatars() is for the open chat; a caller that
 *    knows who it is drawing must not be given somebody else's face.
 *  - Gemini preset: "Model speed" selector (Pro / Flash). Sent to the bridge
 *    as {mode} on every /prompt — it switches the bridge's WAITING timeouts
 *    (not the Gemini model, which is picked in the web UI). Flash also polls
 *    /history every 0.7s instead of 2s: on a 3-second generation the coarse
 *    step was itself most of the latency.
 *  - Per-LoRA weight rules: optional "Weight rule (for LLM)" text tells the LLM
 *    what low vs high w means for THAT LoRA (fallback: visual prominence)
 *  - Optional per-preset weight step (0.05/0.1/0.25/0.5): LLM weights snapped
 *    to the grid, anchored at each LoRA's range min
 *  - AI Describe also writes weight rules; fills only missing fields
 *  - Per-field "✨ AI" buttons in the LoRA editor: generate description or
 *    weight rule for one LoRA on demand (fills the box for review, no batch)
 *  - LoRA Library manager: modal grid with previews, categories, descriptions,
 *    per-LoRA weight ranges, enable/disable (replaces the pipe-text library)
 *  - Metadata auto-import from safetensors headers (ComfyUI /view_metadata)
 *  - Civitai import: trained words + preview image by URL
 *  - AI Describe: LLM batch-annotates LoRAs for better scene matching
 *  - Per-scene LoRA weight chosen by LLM, clamped to library range
 *  - Fuzzy matching of LLM-selected LoRA names (id / name / substring)
 *  - FIX: LoRA injection on UNETLoader (Flux) uses LoraLoaderModelOnly
 *  - FIX: full illustration no longer wipes stored VN-chunk illustrations
 *  - FIX: duplicate LoRAs (LLM-selected + always-on) are deduped
 *  - FIX: maxLorasPerImage enforced client-side
 *  - FIX: XSS — esc() now escapes quotes (title-attribute injection)
 *  - FIX: swipe aborts in-flight generation for that message
 *  - VN-chunk illustrations now appear in the gallery and can be deleted
 *  - Gallery: masonry layout, delete one / delete all
 *  - POV prompt formats for all model types
 *  - BLANK_PNG 512x512 (VAEEncode fix)
 *  - Multi-character avatar system
 *  - LLM detects characters per scene
 *  - Custom ComfyUI endpoint
 *  - Real LoRA node injection
 */
import {
    eventSource, event_types, getRequestHeaders,
    saveSettingsDebounced, generateQuietPrompt, generateRaw,
} from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

var M = 'auto_illustrator';
var L = '[AutoIllustrator]';
var AI_VERSION = '3.25.2';

function aiSlayOwnsScreen() {
    try {
        if (typeof window === 'undefined') return false;
        var standalone = window.MesugakiCampaign;
        if (standalone && standalone.isOpen && standalone.isOpen()) return true;
        var game = window.SlayCampaign;
        if (game && typeof game.isOpen === 'function' && game.isOpen()) return true;
        var lib = window.CharacterLibrary;
        var campaign = lib && typeof lib.getActiveCampaign === 'function' ? lib.getActiveCampaign() : null;
        return !!(campaign && ['slay-run', 'mesugaki-rpg'].includes(campaign.mode));
    } catch (e) { return false; }
}
var processing = new Set();
var controllers = new Map();

/* ====== BLANK_PNG: 512x512 — safe for VAEEncode ====== */
var BLANK_PNG = (function(){
    try {
        var c = document.createElement('canvas');
        c.width = 512; c.height = 512;
        var x = c.getContext('2d');
        x.fillStyle = '#000000';
        x.fillRect(0, 0, 512, 512);
        var d = c.toDataURL('image/png');
        var ci = d.indexOf(',');
        var b64 = ci >= 0 ? d.substring(ci + 1) : d;
        b64 = b64.replace(/[\s\r\n]/g, '');
        var pad = b64.length % 4;
        if (pad === 2) b64 += '==';
        else if (pad === 3) b64 += '=';
        else if (pad === 1) b64 = b64.substring(0, b64.length - 1);
        return b64;
    } catch(e) {
        return 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAADklEQVQI12NgGAWDEwAAAZAAASlMlecAAAAASUVORK5CYII=';
    }
})();

/* ============ FORMATS ============ */
/* v3.24.0: the face of the MOMENT. The web engines (Gemini, ChatGPT) left
   alone draw one stock face per character type — the seductive vampire
   always gets the same half-smile — and the attached avatar reinforces it.
   A named emotion ("seductive", "sad") is not enough to move them; a
   physical description of the face is. So the prompt writer derives the
   expression from what is happening in the text and spells it out muscle by
   muscle, and says "no smile" when the text has none. */
var EXPR_RULE=' FACIAL EXPRESSION: for every visible character, read what they feel at THIS moment of the text and describe the face physically — mouth (closed, parted, pressed thin, corners down), brows (raised, drawn together, relaxed), eyes (wide, narrowed, lowered, glancing away, tearful). Do NOT default to a smile or smirk: show one only if the text implies it, and otherwise write "not smiling". Two characters in one scene usually feel different things — give each their own face.';
var FORMATS = {
    flux:{l:'Flux',w:1152,h:896,neg:'',
        inst:'Vivid natural-language prompt. Subject, scene, lighting, mood, camera, style.'},
    flux2klein:{l:'Flux 2 Klein',w:1024,h:768,neg:'',
        inst:'Concise prompt (1-2 sentences).'},
    /* Krea 2 (v3.22): its text encoder reads sentences, not keyword lists, and
       it was trained up to 2K — a short tag-style prompt leaves lighting,
       camera and mood to chance and comes out generic. No negative prompt:
       Turbo is a distilled low-CFG checkpoint, where a negative does nothing. */
    krea2:{l:'Krea 2',w:1344,h:1024,neg:'',
        inst:'Detailed natural-language prompt for Krea 2. Write one flowing paragraph of 3-5 full sentences — NO comma-separated keyword lists, NO booru tags, NO quality keywords like "masterpiece" or "8k". Cover, in this order: the subject and what they are doing (appearance, clothing, expression, pose); the setting and what surrounds them; the light (source, direction, colour, time of day); the camera (shot size, angle, lens feel, depth of field); the mood; and the visual style or medium (photograph, film still, anime illustration, oil painting). Name concrete materials, textures and colours instead of adjectives like "beautiful".'},
    gemini:{l:'Gemini (nano banana)',w:1024,h:768,neg:'',
        inst:'Rich natural-language description for Google Gemini image generation. Write 2-4 flowing sentences as if describing a photograph or film still — NO comma-separated tags, NO booru tags, NO quality keywords like "masterpiece" or "8k". Describe: the subject and what they are doing, the setting and environment, lighting and time of day, mood and atmosphere, camera framing (close-up, full body, wide shot) and style (cinematic, photorealistic, painterly). Be specific and visual, like a vivid scene description.'+EXPR_RULE},
    /* GPT (v3.22): for the ChatGPT image engine of the web bridge. It follows
       a plain description literally and picks its OWN art style unless told
       one, so the style is asked for explicitly. It also refuses what a
       mainstream service will not draw, and a refusal means no image at all —
       hence the line about implying rather than showing. */
    gpt:{l:'GPT (ChatGPT image)',w:1024,h:768,neg:'',
        inst:'Plain natural-language description for ChatGPT image generation. Write 3-5 clear sentences — NO comma-separated tags, NO booru tags, NO quality keywords, NO weights or brackets. Always state the art style or medium explicitly (e.g. anime illustration, semi-realistic digital painting, photograph) — otherwise the model chooses its own. Describe: the subject and what they are doing, their appearance, clothing and expression, the setting, the lighting and time of day, the mood, and the framing (close-up, half body, full body, wide shot). Say what must stay out as a sentence, e.g. "No text, captions, speech bubbles or watermarks in the image." Keep it to what a mainstream image service will draw: no nudity and no graphic gore — convey intimacy or violence through pose, expression, light and aftermath rather than showing it, or the request is refused and no image comes back.'+EXPR_RULE},
    zimage:{l:'Z-Image',w:1024,h:768,neg:'low quality, blurry',
        inst:'Natural language + quality tags.'},
    qwen_image:{l:'Qwen Image',w:1024,h:768,neg:'',
        inst:'Structured: subject, setting, style, colours.'},
    sd15:{l:'SD 1.5',w:768,h:512,neg:'(worst quality:1.4), blurry, bad anatomy, text',
        inst:'Comma-separated tags, (emphasis:1.3).'},
    illustrious:{l:'Illustrious',w:1216,h:832,neg:'worst quality, low quality, bad anatomy',
        inst:'Danbooru tags: count, appearance, clothing, pose, background.'},
    noobai:{l:'Noob AI',w:1216,h:832,neg:'worst quality, low quality, extra fingers',
        inst:'Danbooru/Gelbooru tags.'},
    /* Anima (v3.22): an anime model that is NOT SDXL — tags are lowercase with
       SPACES (underscores only in score_N), the order of tag groups matters,
       and it also reads short natural-language sentences after the tags. The
       prefix, the order and the negative follow what guides quote from its
       model card (taken second-hand — the card itself was not read). */
    anima:{l:'Anima',w:1152,h:896,neg:'worst quality, low quality, score_1, score_2, score_3, artist name',
        inst:'Prompt for the Anima anime model: Danbooru-style tags, optionally followed by one or two short natural-language sentences. Tags are lowercase and comma-separated, written with SPACES instead of underscores (e.g. "long hair", "looking at viewer") — the only underscores are in score tags. Keep this ORDER: (1) quality and rating: start with "masterpiece, best quality, score_7" and then exactly one rating tag that fits the scene — safe, sensitive, nsfw or explicit; (2) subject count: 1girl, 1boy, 2girls, no humans, etc.; (3) character name and then the series it is from, only for a known existing character; (4) general tags: appearance, clothing, expression, pose, action, composition (close-up, upper body, full body, from above), background, lighting. Describe the appearance with tags even when a character name is given. After the tags you may add a short sentence for what tags express poorly (who does what to whom, spatial relations). Do NOT use (tag:1.2) weights.'},
    custom:{l:'Custom',w:1024,h:768,neg:'',inst:''},

    /* ——— POV ——— */
    pov_flux:{l:'POV — Flux',w:1152,h:896,neg:'',
        inst:'First-person POV vivid natural-language prompt. The image shows EXACTLY what the viewer (user/player) sees through their own eyes. '+
             'Characters FACE the viewer/camera and react to them. '+
             'Describe viewer\'s hands/arms ONLY if they physically interact — NEVER their face, hair, or full body. '+
             'Include: characters\' expressions directed at viewer, spatial depth, lighting, mood, camera angle (looking down=from_above, looking up=from_below). Style and atmosphere.'},
    pov_flux2klein:{l:'POV — Flux 2 Klein',w:1024,h:768,neg:'',
        inst:'Concise first-person POV prompt (1-2 sentences). Scene through viewer\'s eyes, characters face camera. No viewer face/body.'},
    pov_gemini:{l:'POV — Gemini (nano banana)',w:1024,h:768,neg:'',
        inst:'Rich natural-language first-person POV description for Google Gemini image generation. Write 2-4 flowing sentences as a vivid scene — NO tags, NO quality keywords. The image shows EXACTLY what the viewer sees through their own eyes: characters face the viewer/camera and react to them. Describe the viewer\'s hands or arms ONLY if they physically interact — NEVER the viewer\'s face, hair, or full body. Include the character\'s expression directed at the viewer, the setting, lighting, mood, spatial depth, camera angle (looking down = high angle, looking up = low angle), and photographic/cinematic style.'+EXPR_RULE},
    pov_zimage:{l:'POV — Z-Image',w:1024,h:768,neg:'low quality, blurry',
        inst:'First-person POV natural language + quality tags. Scene as seen through the viewer\'s eyes. Characters face camera. Viewer\'s hands only when touching/holding. Perspective depth, lighting, quality modifiers.'},
    pov_qwen:{l:'POV — Qwen Image',w:1024,h:768,neg:'',
        inst:'Structured first-person POV: subject facing viewer/camera, setting from viewer\'s position, interaction (viewer hands if touching), style, colours, mood.'},
    pov_sd15:{l:'POV — SD 1.5',w:768,h:512,neg:'(worst quality:1.4), blurry, bad anatomy, text, third person, full body of viewer',
        inst:'First-person POV comma-separated tags with (emphasis:1.3). MUST include: pov, looking at viewer. Add when relevant: pov hands, from above, from below, reaching towards viewer, eye contact. NEVER tag viewer face/hair/body. Tag character(s): appearance, expression, clothing, pose, background.'},
    pov_illustrious:{l:'POV — Illustrious',w:1216,h:832,neg:'worst quality, low quality, bad anatomy, third_person_view',
        inst:'First-person POV danbooru tags. ALWAYS start with: pov. Add: looking_at_viewer, pov_hands (if hands visible), from_above/from_below, reaching_towards_viewer, eye_contact, close-up. NEVER include viewer face/hair/body tags. Tag character(s): count (visible only), appearance, expression, clothing, pose facing viewer, background.'},
    pov_noobai:{l:'POV — Noob AI',w:1216,h:832,neg:'worst quality, low quality, extra fingers, third_person_view',
        inst:'First-person POV danbooru/gelbooru tags. ALWAYS include: pov, looking_at_viewer. Use: pov_hands, from_above, from_below, reaching_towards_viewer, eye_contact, depth_of_field. NEVER tag viewer face/hair/body. Tag characters: count (visible only), appearance, expression, clothing, pose, interaction, background.'},
    pov_krea2:{l:'POV — Krea 2',w:1344,h:1024,neg:'',
        inst:'Detailed natural-language first-person POV prompt for Krea 2. Write one flowing paragraph of 3-5 full sentences — NO keyword lists, NO tags, NO quality keywords. The image shows EXACTLY what the viewer sees through their own eyes: say so in the first sentence ("First-person view: ..."). Characters face the viewer/camera and react to them. Describe the viewer\'s hands or arms ONLY if they physically interact — NEVER the viewer\'s face, hair, or full body. Then cover: the character\'s appearance, clothing and expression directed at the viewer; the setting as seen from the viewer\'s position, with spatial depth; the light (source, direction, colour); the camera angle (looking down = high angle, looking up = low angle) and depth of field; the mood; and the visual style or medium.'},
    pov_gpt:{l:'POV — GPT (ChatGPT image)',w:1024,h:768,neg:'',
        inst:'Plain natural-language first-person POV description for ChatGPT image generation. Write 3-5 clear sentences — NO tags, NO quality keywords, NO weights. Open with "First-person point of view:" — the image shows EXACTLY what the viewer sees through their own eyes. Characters face the viewer/camera and react to them. Describe the viewer\'s hands or arms ONLY if they physically interact — NEVER the viewer\'s face, hair, or full body. Always state the art style or medium explicitly, otherwise the model chooses its own. Include the character\'s appearance, clothing and expression directed at the viewer, the setting, lighting, mood, spatial depth and camera angle (looking down = high angle, looking up = low angle). End with: "No text, captions, speech bubbles or watermarks in the image." Keep it to what a mainstream image service will draw: no nudity and no graphic gore — convey intimacy or violence through pose, expression and light rather than showing it, or the request is refused and no image comes back.'+EXPR_RULE},
    pov_anima:{l:'POV — Anima',w:1152,h:896,neg:'worst quality, low quality, score_1, score_2, score_3, artist name, third person',
        inst:'First-person POV prompt for the Anima anime model: Danbooru-style tags, optionally followed by one short natural-language sentence. Tags are lowercase and comma-separated, written with SPACES instead of underscores (e.g. "looking at viewer", "pov hands") — the only underscores are in score tags. Keep this ORDER: (1) "masterpiece, best quality, score_7" and then exactly one rating tag that fits the scene — safe, sensitive, nsfw or explicit; (2) count of VISIBLE characters only (1girl, 1boy, ...) — the viewer is not counted; (3) character name and series, only for a known existing character; (4) general tags, ALWAYS including: pov, looking at viewer. Add when relevant: pov hands (only if the viewer physically interacts), from above, from below, reaching towards viewer, eye contact, close-up. NEVER tag the viewer\'s face, hair or body. Then tag the character(s): appearance, clothing, expression, pose facing the viewer, background, lighting. Do NOT use (tag:1.2) weights.'},
};

var POSITIONS={'top-left':{l:'↖ Top Left',css:'top:8px;left:8px;bottom:auto;right:auto;'},'top-center':{l:'↑ Top Center',css:'top:8px;left:50%;transform:translateX(-50%);bottom:auto;right:auto;'},'top-right':{l:'↗ Top Right',css:'top:8px;right:8px;bottom:auto;left:auto;'},'mid-left':{l:'← Mid Left',css:'top:50%;left:8px;transform:translateY(-50%);bottom:auto;right:auto;'},'mid-right':{l:'→ Mid Right',css:'top:50%;right:8px;transform:translateY(-50%);bottom:auto;left:auto;'},'bottom-left':{l:'↙ Bot Left',css:'bottom:8px;left:8px;top:auto;right:auto;'},'bottom-center':{l:'↓ Bot Center',css:'bottom:8px;left:50%;transform:translateX(-50%);top:auto;right:auto;'},'bottom-right':{l:'↘ Bot Right',css:'bottom:8px;right:8px;top:auto;left:auto;'}};
var MSG_POSITIONS={'top-left':{l:'↖',css:'top:4px;left:4px;bottom:auto;right:auto;'},'top-right':{l:'↗',css:'top:4px;right:4px;bottom:auto;left:auto;'},'mid-right':{l:'→',css:'top:50%;right:4px;transform:translateY(-50%);bottom:auto;left:auto;'},'bottom-left':{l:'↙',css:'bottom:4px;left:4px;top:auto;right:auto;'},'bottom-right':{l:'↘',css:'bottom:4px;right:4px;top:auto;left:auto;'}};

/* ============ DEFAULTS ============ */
var DEFAULTS={enabled:false,autoGenerate:true,imagesPerMessage:2,preferDirectComfy:true,compressImages:true,compressionQuality:0.82,maxStoredImageWidth:1024,generateTimeoutMs:180000,minMessageLength:80,showGalleryButton:true,workflowPresets:[],activePresetId:'',galleryPosition:'mid-right',msgBtnPosition:'bottom-right',comfyUrl:'',hidePrompts:false,charPresetLinks:{},saveToGallery:true,prevFrameRef:false};
var PRESET_DEFAULTS={name:'Untitled',workflow:'',promptFormat:'flux',customInstructions:'',storyboardLayout:'',storyboardInstructions:'',storyboardAvatarWorkflow:'',negativePrompt:'',width:1024,height:768,model:'',vae:'',sampler:'',scheduler:'',steps:0,cfg:0,denoise:1,clipSkip:0,clipName:'',clipName1:'',clipName2:'',seed:0,batchSize:1,enableLoraMatching:false,loraLibraryText:'',loraLibrary:[],maxLorasPerImage:2,loraWeightStep:0,alwaysOnLoras:[],enableCharRouting:false,charPresetId:'',adaptiveAspect:true,useCharDescription:true,useGemini:false,bridgeEngine:'gemini',geminiPort:'7860',geminiMode:'pro',geminiHires:false,useCharAvatar:false,maxCharAvatars:2,promptPrefix:''};

function S(){return extension_settings[M];}
function loadSettings(){
    extension_settings[M]=extension_settings[M]||{};var s=extension_settings[M];
    for(var k in DEFAULTS)if(DEFAULTS.hasOwnProperty(k)&&s[k]===undefined)s[k]=DEFAULTS[k];
    (s.workflowPresets||[]).forEach(function(p){for(var pk in PRESET_DEFAULTS)if(PRESET_DEFAULTS.hasOwnProperty(pk)&&p[pk]===undefined)p[pk]=JSON.parse(JSON.stringify(PRESET_DEFAULTS[pk]));
        // Migration: pipe-text LoRA library → structured loraLibrary
        if((!p.loraLibrary||!p.loraLibrary.length)&&p.loraLibraryText&&p.loraLibraryText.trim()){
            p.loraLibrary=parseLoraLibrary(p.loraLibraryText).map(function(e){
                var ne=newLoraEntry(e.file);ne.tags=e.tags||'';ne.trigger=e.trigger||'';ne.weight=e.weight;
                return ne;
            });
            console.log(L,'Migrated',p.loraLibrary.length,'LoRAs from text library (preset "'+p.name+'")');
        }
    });
    if(s.charPresetId!==undefined){var ap=(s.workflowPresets||[]).find(function(p){return p.id===s.activePresetId;});if(ap&&!ap.charPresetId)ap.charPresetId=s.charPresetId;delete s.charPresetId;}
    ['enableCharRouting','adaptiveAspect','enableLoraMatching','loraLibraryText','maxLorasPerImage','alwaysOnLoras'].forEach(function(key){if(s[key]!==undefined){var a2=(s.workflowPresets||[]).find(function(p){return p.id===s.activePresetId;});if(a2&&a2[key]===PRESET_DEFAULTS[key])a2[key]=s[key];delete s[key];}});
}

/* ============ PRESET ============ */
function uid(){return'wp_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);}
function makePreset(name){var p={id:uid()};for(var k in PRESET_DEFAULTS)if(PRESET_DEFAULTS.hasOwnProperty(k))p[k]=JSON.parse(JSON.stringify(PRESET_DEFAULTS[k]));p.name=name||'Untitled';return p;}
function presets(){return S().workflowPresets||[];}
function activePreset(){return presets().find(function(p){return p.id===S().activePresetId;})||null;}
function savePreset(p){var list=presets(),idx=list.findIndex(function(x){return x.id===p.id;});if(idx>=0)list[idx]=p;else list.push(p);S().workflowPresets=list;saveSettingsDebounced();}
function deletePresetById(id){S().workflowPresets=presets().filter(function(p){return p.id!==id;});if(S().activePresetId===id)S().activePresetId=presets()[0]?.id||'';saveSettingsDebounced();}
function setActive(id){S().activePresetId=id;saveSettingsDebounced();}

async function installMossAvatarPreset(){
    var settings=S();
    if(settings.mossAvatarPresetInstalled)return;
    var id='wp_moss_storyboard_edit';
    try{
        if(!presets().some(function(p){return p.id===id;})){
            var url='/scripts/extensions/third-party/AutoIllustrator/moss-storyboard-edit.preset.json';
            var response=await fetch(url,{signal:AbortSignal.timeout(4000)});
            if(!response.ok)return;
            var preset=await response.json();
            if(preset.id!==id||!storyboardUsesCharacterAvatar(preset))return;
            settings.workflowPresets=presets().concat({...makePreset(preset.name),...preset});
        }
        settings.mossAvatarPresetInstalled=true;
        saveSettingsDebounced();
    }catch(error){console.warn(L,'MOSS Edit preset:',error.message);}
}

function syncUIToPreset(){var p=activePreset();if(!p)return;p.workflow=$('#ai_wf_json').val()||'';p.promptFormat=$('#ai_prompt_fmt').val()||'flux';p.customInstructions=$('#ai_custom_instr').val()||'';p.storyboardLayout=$('#ai_sb_layout').val().trim();p.storyboardInstructions=$('#ai_sb_instructions').val().trim();p.storyboardAvatarWorkflow=$('#ai_sb_avatar_workflow').val().trim();p.negativePrompt=$('#ai_neg').val()||'';p.width=parseInt($('#ai_w').val())||1024;p.height=parseInt($('#ai_h').val())||768;p.model=$('#ai_p_model').val()||'';p.vae=$('#ai_p_vae').val()||'';p.sampler=$('#ai_p_sampler').val()||'';p.scheduler=$('#ai_p_scheduler').val()||'';p.steps=parseInt($('#ai_p_steps').val())||0;p.cfg=parseFloat($('#ai_p_cfg').val())||0;p.denoise=parseFloat($('#ai_p_denoise').val());if(isNaN(p.denoise))p.denoise=1;p.clipSkip=parseInt($('#ai_p_clipskip').val())||0;p.clipName=$('#ai_p_clip').val()||'';p.clipName1=$('#ai_p_clip1').val()||'';p.clipName2=$('#ai_p_clip2').val()||'';p.seed=parseInt($('#ai_p_seed').val())||0;p.batchSize=parseInt($('#ai_p_batch').val())||1;p.enableLoraMatching=$('#ai_lora_on').prop('checked');p.maxLorasPerImage=parseInt($('#ai_lora_max').val())||2;p.loraWeightStep=parseFloat($('#ai_lora_wstep').val())||0;p.enableCharRouting=$('#ai_char_route').prop('checked');p.charPresetId=$('#ai_char_preset').val()||'';p.adaptiveAspect=$('#ai_adapt').prop('checked');p.useCharDescription=$('#ai_char_desc').prop('checked');p.useGemini=$('#ai_use_gemini').prop('checked');p.geminiPort=($('#ai_gemini_port').val()||'7860').trim()||'7860';p.geminiMode=$('#ai_gemini_mode').val()||'pro';p.bridgeEngine=$('#ai_bridge_engine').val()||'gemini';p.geminiHires=$('#ai_gemini_hires').prop('checked');p.useCharAvatar=$('#ai_gemini_charav').prop('checked');p.maxCharAvatars=parseInt($('#ai_gemini_maxav').val())||2;p.promptPrefix=$('#ai_prompt_prefix').val()||'';savePreset(p);}

function loadPresetToUI(){var p=activePreset();$('#ai_wf_json').val(p?p.workflow:'');$('#ai_prompt_fmt').val(p?p.promptFormat:'flux');$('#ai_custom_instr').val(p?p.customInstructions:'');$('#ai_sb_layout').val(p?p.storyboardLayout:'');$('#ai_sb_instructions').val(p?p.storyboardInstructions:'');$('#ai_sb_avatar_workflow').val(p?p.storyboardAvatarWorkflow:'');$('#ai_neg').val(p?p.negativePrompt:'');$('#ai_w').val(p?p.width:1024);$('#ai_h').val(p?p.height:768);$('#ai_p_model').val(p?p.model||'':'');$('#ai_p_vae').val(p?p.vae||'':'');$('#ai_p_sampler').val(p?p.sampler||'':'');$('#ai_p_scheduler').val(p?p.scheduler||'':'');$('#ai_p_steps').val(p&&p.steps?p.steps:'');$('#ai_p_cfg').val(p&&p.cfg?p.cfg:'');$('#ai_p_denoise').val(p?p.denoise:1);$('#ai_p_clipskip').val(p&&p.clipSkip?p.clipSkip:'');$('#ai_p_clip').val(p?p.clipName||'':'');$('#ai_p_clip1').val(p?p.clipName1||'':'');$('#ai_p_clip2').val(p?p.clipName2||'':'');$('#ai_p_seed').val(p&&p.seed?p.seed:'');$('#ai_p_batch').val(p?p.batchSize||1:1);$('#ai_lora_on').prop('checked',p?!!p.enableLoraMatching:false);$('#ai_lora_opts').toggle(p?!!p.enableLoraMatching:false);$('#ai_lora_count').text(p?(p.loraLibrary||[]).length:0);$('#ai_lora_max').val(p?p.maxLorasPerImage||2:2);$('#ai_lora_wstep').val(p&&p.loraWeightStep?String(p.loraWeightStep):'0');$('#ai_char_route').prop('checked',p?!!p.enableCharRouting:false);$('#ai_route_opts').toggle(p?!!p.enableCharRouting:false);rebuildCharPresetDD();$('#ai_char_preset').val(p?p.charPresetId||'':'');$('#ai_adapt').prop('checked',p?p.adaptiveAspect!==false:true);$('#ai_char_desc').prop('checked',p?p.useCharDescription!==false:true);$('#ai_use_gemini').prop('checked',p?!!p.useGemini:false);$('#ai_gemini_port').val(p?p.geminiPort||'7860':'7860');$('#ai_gemini_mode').val(p?p.geminiMode||'pro':'pro');$('#ai_bridge_engine').val(p?p.bridgeEngine||'gemini':'gemini');$('#ai_gemini_only').toggle(!(p&&p.bridgeEngine==='chatgpt'));$('#ai_gemini_hires').prop('checked',p?!!p.geminiHires:false);$('#ai_gemini_charav').prop('checked',p?!!p.useCharAvatar:false);$('#ai_gemini_maxav').val(p?p.maxCharAvatars||2:2);$('#ai_gemini_opts').toggle(p?!!p.useGemini:false);$('#ai_prompt_prefix').val(p?p.promptPrefix||'':'');renderAlwaysOnList();updateFmtInfo();syncCharLinkUI();syncChatLinkUI();}
function syncCharLinkUI(){var name=currentCharName();$('#ai_char_link_name').text(name||'—');var p=activePreset();var links=S().charPresetLinks||{};$('#ai_char_link').prop('checked',!!(name&&p&&links[name]===p.id)).prop('disabled',!name||!p);}
function syncChatLinkUI(){
    var chat=currentChatName(),p=activePreset(),pid=chatPresetLink();
    $('#ai_chat_link_name').text(chat?(chat.length>30?chat.substring(0,29)+'…':chat):'—').attr('title',chat||'');
    $('#ai_chat_link').prop('checked',!!(chat&&p&&pid===p.id)).prop('disabled',!chat||!p);
    /* The chat may be linked to a preset that is NOT the open one — an unchecked
       box would otherwise read as "this chat is free". */
    var other=(chat&&pid&&(!p||pid!==p.id))?presets().find(function(x){return x.id===pid;}):null;
    $('#ai_chat_link_note').text(other?('↳ this chat is linked to: '+other.name):'').toggle(!!other);
}

function rebuildPresetDD(){var sel=$('#ai_preset_sel');sel.empty();if(!presets().length)sel.append('<option value="">—</option>');presets().forEach(function(p){sel.append('<option value="'+p.id+'">'+esc(p.name)+'</option>');});sel.val(S().activePresetId||'');}
function rebuildCharPresetDD(){var sel=$('#ai_char_preset');sel.empty();sel.append('<option value="">— same —</option>');var a=activePreset();presets().forEach(function(p){if(a&&p.id===a.id)return;sel.append('<option value="'+p.id+'">'+esc(p.name)+'</option>');});if(a)sel.val(a.charPresetId||'');}

/* ============ UTIL ============ */
function esc(t){if(!t)return'';var e=document.createElement('span');e.textContent=t;return e.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function escJ(s){if(!s)return'';return s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t').replace(/[\x00-\x1f]/g,'');}
function extractJSON(t){if(!t)return null;var c=t.replace(/```(?:json)?\s*/gi,'').replace(/```/g,'');var f=c.indexOf('{'),l=c.lastIndexOf('}');if(f<0||l<=f)return null;var j=c.substring(f,l+1).replace(/,\s*([}\]])/g,'$1');try{return JSON.parse(j);}catch(e){}try{return JSON.parse(repairJSONQuotes(j));}catch(e){}try{return JSON.parse(j.replace(/'/g,'"'));}catch(e){}return null;}
/* v3.25.2: models copy roleplay text into "text" with its dialogue quotes
   unescaped ("text":"*smiles* "Hello," she said"), and web bridges that read
   the rendered page lose the backslash of \" even when the model wrote it.
   One stray quote made every message with dialogue fail as "could not split".
   Walk the JSON and keep a quote as the closing one only where JSON structure
   follows it (":" after a key; "," + next key, "}" or "]" after a value);
   every other quote inside a string is escaped. Raw newlines/tabs in strings
   are escaped too. Used only after a plain JSON.parse has failed. */
function repairJSONQuotes(s){
    var out='',stack=[],inStr=false,isKey=false,last='',i,ch;
    function closes(j){
        var r=s.substr(j,120).replace(/^\s+/,''),c=r.charAt(0),top=stack[stack.length-1];
        if(!c)return true;
        if(isKey)return c===':';
        if(c==='}'||c===']')return true;
        if(c===','){
            var r2=r.slice(1).replace(/^\s+/,'');
            if(top==='[')return /^["{\[\d\-tfn]/.test(r2);
            return /^"[A-Za-z_][\w ]{0,40}"\s*:/.test(r2)||/^[}\]]/.test(r2);
        }
        return false;
    }
    for(i=0;i<s.length;i++){
        ch=s.charAt(i);
        if(!inStr){
            if(ch==='"'){inStr=true;isKey=stack[stack.length-1]==='{'&&(last==='{'||last===',');}
            else if(ch==='{'||ch==='[')stack.push(ch);
            else if(ch==='}'||ch===']')stack.pop();
            if(!/\s/.test(ch))last=ch;
            out+=ch;continue;
        }
        if(ch==='\\'){out+=ch+s.charAt(i+1);i++;continue;}
        if(ch==='\n'){out+='\\n';continue;}
        if(ch==='\r')continue;
        if(ch==='\t'){out+='\\t';continue;}
        if(ch==='"'){if(closes(i+1)){inStr=false;last='"';out+=ch;}else out+='\\"';continue;}
        out+=ch;
    }
    return out;
}
function compressImage(b64,maxW,q){maxW=maxW||1024;q=q||0.82;return new Promise(function(resolve){var img=new Image();img.onload=function(){var w=img.width,h=img.height;if(w>maxW){var r=maxW/w;w=Math.round(w*r);h=Math.round(h*r);}var c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);resolve(c.toDataURL('image/jpeg',q).split(',')[1]);};img.onerror=function(){resolve(b64);};img.src=b64.startsWith('data:')?b64:'data:image/png;base64,'+b64;});}
function b2b64(blob){return new Promise(function(res,rej){var r=new FileReader();r.onloadend=function(){res(r.result.split(',')[1]);};r.onerror=rej;r.readAsDataURL(blob);});}

function ensureValidBase64(b64){
    if(!b64)return'';var ci=b64.indexOf(',');if(ci>=0&&ci<120)b64=b64.substring(ci+1);
    b64=b64.replace(/[\s\r\n]/g,'');var pad=b64.length%4;
    if(pad===2)b64+='==';else if(pad===3)b64+='=';else if(pad===1)b64=b64.substring(0,b64.length-1);return b64;
}

function getComfyUrl(){
    var custom=S().comfyUrl;if(custom&&custom.trim())return custom.trim().replace(/\/+$/,'');
    var sd=extension_settings.sd||{};if(sd.comfy_url)return sd.comfy_url.replace(/\/+$/,'');
    if(sd.comfyUrl)return sd.comfyUrl.replace(/\/+$/,'');if(sd.comfy_server_url)return sd.comfy_server_url.replace(/\/+$/,'');
    return'http://127.0.0.1:8188';
}

function isPOVFormat(fmtKey){return fmtKey&&fmtKey.indexOf('pov_')===0;}
function getUserName(){var ctx=getContext();try{return ctx.name1||ctx.user_name||'User';}catch(e){return'User';}}

/* ============ AVATAR SYSTEM ============ */
async function fetchAvatarBase64(avatarFile,type){
    if(!avatarFile)return null;var urls=[];
    if(type==='user')urls.push('/User Avatars/'+encodeURIComponent(avatarFile));
    else{urls.push('/characters/'+encodeURIComponent(avatarFile));urls.push('/thumbnail?type=avatar&file='+encodeURIComponent(avatarFile));}
    for(var i=0;i<urls.length;i++){try{var resp=await fetch(urls[i],{headers:getRequestHeaders()});if(!resp.ok)continue;var blob=await resp.blob();if(blob.size<100)continue;var raw=await b2b64(blob);if(!raw)continue;try{raw=await compressImage(raw,512,0.85);}catch(e){}return ensureValidBase64(raw);}catch(e){}}return null;
}
/* The persona avatar's FILE NAME — one owner (v3.22.1).
   Both avatar collectors below used to read `ctx.user_avatar || ctx.userAvatar`,
   and getContext() has NEVER had either key: the value is a module export of
   scripts/personas.js. So '__user__' was always empty — %user_avatar% got the
   blank pixel, and every caller that asked for the persona's face (Story
   Tracker's Visualize for the player's own character) drew the user from text
   alone. Nothing failed and nothing was logged, because an absent avatar is a
   legal answer; that is exactly why it went unnoticed.
   The context keys are still tried first, in case a future ST adds them. The
   import is dynamic so a moved or renamed personas.js costs the avatar, not the
   whole extension; `user_avatar` is a live binding, so it is read on every call
   and follows a persona switch. */
var _personasModule=null;
async function userAvatarFile(){
    var ctx=null;try{ctx=getContext();}catch(e){}
    var ua=ctx&&(ctx.user_avatar||ctx.userAvatar);
    if(ua)return String(ua);
    try{
        if(!_personasModule)_personasModule=await import('../../../personas.js');
        return String((_personasModule&&_personasModule.user_avatar)||'');
    }catch(e){console.warn(L,'persona avatar: personas.js not readable:',e&&e.message);return'';}
}
async function collectAllAvatars(){
    var ctx=getContext(),map={};try{var chId=ctx.characterId;if(chId!==undefined&&ctx.characters&&ctx.characters[chId]){var ch=ctx.characters[chId];if(ch.name&&ch.avatar){var b=await fetchAvatarBase64(ch.avatar,'char');if(b){map[ch.name]=b;console.log(L,'Avatar:',ch.name);}}}
    if(ctx.groupId&&ctx.groups){var group=ctx.groups.find(function(g){return g.id===ctx.groupId;});if(group&&group.members){for(var mi=0;mi<group.members.length;mi++){var memberId=group.members[mi],member=null;for(var ci=0;ci<(ctx.characters||[]).length;ci++){if(ctx.characters[ci].avatar===memberId||ctx.characters[ci].name===memberId){member=ctx.characters[ci];break;}}if(member&&member.name&&member.avatar&&!map[member.name]){var mb=await fetchAvatarBase64(member.avatar,'char');if(mb){map[member.name]=mb;console.log(L,'Avatar:',member.name);}}}}}
    var ua=await userAvatarFile();if(ua){var ub=await fetchAvatarBase64(ua,'user');if(ub)map['__user__']=ub;}}catch(e){console.error(L,'Avatar error:',e);}return map;
}

/* Avatars for EXACTLY the cards named — nothing else, and no substitute.
   collectAllAvatars() answers "who is in this chat", and its two fallbacks
   (the open character card first, then "any non-user entry" downstream) are
   right for that question and wrong for a caller that already knows whose
   picture it wants: in this stack the open card is often a LOCATION, and a
   miss on the name silently hands the caller a photograph of a building.
   A name that has no card is simply absent from the map — an absent avatar is
   a fact, and the caller can decide what to do about it. '__user__' asks for
   the persona avatar. */
async function avatarsForNames(names){
    var out={};if(!Array.isArray(names)||!names.length)return out;
    var ctx;try{ctx=getContext();}catch(e){return out;}
    var chars=(ctx&&ctx.characters)||[];
    for(var i=0;i<names.length;i++){
        var nm=names[i];if(!nm||out[nm])continue;
        if(nm==='__user__'){
            var ua=await userAvatarFile();
            if(ua){var ub=await fetchAvatarBase64(ua,'user');if(ub)out['__user__']=ub;}
            continue;
        }
        var card=null;
        for(var ci=0;ci<chars.length;ci++){if(chars[ci]&&chars[ci].name===nm){card=chars[ci];break;}}
        if(!card||!card.avatar)continue;
        var b=await fetchAvatarBase64(card.avatar,'char');
        if(b)out[nm]=b;
    }
    return out;
}

/* ============ CALLER REFERENCE IMAGES ============
   A reference picture that is NOT an avatar: the room the scene happens in, a
   prop, a previously drawn frame. It travels with a ROLE, because what the
   backend must be told about an attachment depends entirely on what it is —
   the same JPEG is "this is what she looks like" or "this is the place" and
   the two instructions are not interchangeable. */
var REF_ROLES={character:1,scene:1,object:1,previous:1,continuity:1};
var MAX_REF_IMAGES=4;
function normRefImages(list){
    if(!Array.isArray(list))return[];
    var out=[];
    for(var i=0;i<list.length&&out.length<MAX_REF_IMAGES;i++){
        var r=list[i];if(!r)continue;
        var img=(typeof r==='string')?r:r.image;
        if(!img)continue;
        var role=(r&&r.role&&REF_ROLES[r.role])?r.role:'scene';
        out.push({image:ensureValidBase64(img),role:role,name:(r&&r.name)||''});
    }
    return out;
}
/* What a character avatar contributes and what it must not (v3.24.0). One
   owner for both the per-reference list and the plain avatar sentence. */
var AVATAR_KEEP='face, hair and build only — NOT the facial expression, pose or framing shown there; the expression comes from the description';
/* One owner of "what does this attachment mean", in the order the backend
   receives them. Roles that name nobody stay generic rather than guessing. */
function refRoleText(role,name){
    /* v3.24.0: an avatar is a portrait with ONE face on it, and "appearance"
       let the engine copy that face whole — the same smirk in every scene.
       Identity carries over, the expression does not. */
    if(role==='character')return (name?('the appearance of '+name):'the appearance of a character in the scene')+' ('+AVATAR_KEEP+')';
    if(role==='object')return name?('the object '+name):'an object present in the scene';
    /* Continuity, not composition: the previous page is attached so wardrobe,
       faces, the room and the drawing style carry over. It is the one role
       whose picture the model would otherwise be most tempted to imitate
       WHOLESALE — it looks exactly like the thing being asked for. */
    /* v3.23.0: the last picture of the previous reply (the "continuity frame"
       option). Same purpose as "previous", but it is one picture, not a grid —
       and a scene that has moved on must not be dragged back to its room. */
    if(role==='continuity')return 'the PREVIOUS illustration of this same story — keep the same characters, their faces, clothing and hair, and the same drawing style; keep its location only if the scene has not moved; do NOT copy its composition, poses or framing';
    if(role==='previous')return 'the PREVIOUS page of this same picture sequence — keep the same characters, their clothing and hair, the same location and the same drawing style; do NOT reuse its panel layout or repeat its shots, and do NOT copy any lettering, captions or speech bubbles it may contain';
    return name?('the place itself — '+name+' — a setting reference, NOT a character'):'the place itself — a setting reference, NOT a character';
}

/* ============ ADAPTIVE ASPECT ============ */
function adaptDimensions(bW,bH,pc){var w=bW||1024,h=bH||768,a=w*h;if(pc<=1){w=Math.round(Math.sqrt(a*3/4));h=Math.round(Math.sqrt(a*4/3));}else if(pc>=4){w=Math.round(Math.sqrt(a*3/2));h=Math.round(Math.sqrt(a*2/3));}w=Math.round(w/64)*64;h=Math.round(h/64)*64;return{w:Math.max(256,w),h:Math.max(256,h)};}

/* ============ LORA ============ */
var LORA_CATEGORIES=['character','style','concept','anatomy','clothing','other'];
function stripLoraExt(f){return String(f||'').replace(/\.(safetensors|ckpt|pt|bin)$/i,'');}
function newLoraEntry(file){return{file:file,name:stripLoraExt(file),category:'concept',description:'',tags:'',trigger:'',weight:0.8,weightMin:0.2,weightMax:1.2,weightRule:'',preview:'',baseModel:'',enabled:true};}
function loraLib(p){p=p||activePreset();if(!p)return[];if(!p.loraLibrary)p.loraLibrary=[];return p.loraLibrary;}
function activeLoraEntries(p){return loraLib(p).filter(function(e){return e&&e.file&&e.enabled!==false;});}
/**
 * Entries actually offered to the LLM for auto-select:
 * enabled AND annotated (description or tags) — a bare filename tells the LLM
 * nothing and just burns context. Hard-capped to keep the prompt sane with
 * huge libraries.
 */
var LORA_PROMPT_CAP=120;
function promptableLoraEntries(p){
    var out=activeLoraEntries(p).filter(function(e){return(e.description||'').trim()||(e.tags||'').trim();});
    if(out.length>LORA_PROMPT_CAP){
        console.warn(L,'LoRA prompt cap: '+out.length+' annotated+enabled entries, only first '+LORA_PROMPT_CAP+' offered to the LLM. Disable irrelevant LoRAs in the Library.');
        out=out.slice(0,LORA_PROMPT_CAP);
    }
    return out;
}
function parseLoraLibrary(text){if(!text)return[];return text.split('\n').map(function(line){line=line.trim();if(!line||line.startsWith('#'))return null;var p=line.split('|').map(function(s){return s.trim();});if(p.length<2||!p[0])return null;var w=parseFloat(p[3]);return{file:p[0],tags:p[1]||'',trigger:p[2]||'',weight:isNaN(w)?0.8:w};}).filter(Boolean);}
function loraRange(e){
    var mn=parseFloat(e.weightMin),mx=parseFloat(e.weightMax);
    if(isNaN(mn))mn=0.2;if(isNaN(mx))mx=1.2;
    if(mn>mx){var t=mn;mn=mx;mx=t;}
    return{min:mn,max:mx};
}
function buildLoraPromptBlock(library,max,step){
    if(!library.length)return{block:'',field:''};
    var lines=library.map(function(l,i){
        var r=loraRange(l);
        var d=(l.description||'').trim()||(l.tags||'').trim()||stripLoraExt(l.file);
        if(d.length>220)d=d.substring(0,220)+'…';
        var rule=(l.weightRule||'').trim();
        if(rule.length>140)rule=rule.substring(0,140)+'…';
        return'L'+(i+1)+' ('+(l.category||'concept')+') "'+(l.name||stripLoraExt(l.file))+'": '+d+' [w '+r.min+'-'+r.max+(rule?' | w rule: '+rule:'')+']';
    });
    step=parseFloat(step)||0;
    return{block:'\nLORA SELECTION: pick 0-'+max+' per section, ONLY if the concept is clearly present in that section. '+
        'Set "w" (weight) per LoRA: if it has a "w rule", follow that rule strictly; otherwise by visual prominence: subtle/background = near range min, dominant/close-up = near range max.'+
        (step>0?' Use w increments of '+step+'.':'')+
        ' Never invent IDs.\n'+lines.join('\n')+'\nOutput format: "loras":[{"id":"L1","w":0.8}]\n',
        field:',"loras":[{"id":"L#","w":0.0}]'};
}
/**
 * Resolve the LLM's LoRA selection against the library.
 * Accepts new format [{id:"L1",w:0.7}] and legacy ["file.safetensors"].
 * Fuzzy match (id → exact name/file → substring), weight clamped to the
 * entry's range, dedup by file, max 1 style LoRA, hard cap at `max`.
 * LLM-chosen weights are snapped to the `step` grid (anchored at range min);
 * per-entry default weights are left as the user set them.
 * Returns [{file, weight, trigger}].
 */
function resolveLoraSelection(selected,lib,max,step){
    var out=[],used={},styleCount=0;
    max=parseInt(max)||2;
    step=parseFloat(step)||0;
    var norm=function(s){return stripLoraExt(String(s||'')).toLowerCase().trim();};
    (selected||[]).forEach(function(it){
        if(out.length>=max)return;
        var key='',w=null;
        if(typeof it==='string')key=it;
        else if(it&&typeof it==='object'){key=it.id||it.n||it.name||it.file||'';var wr=it.w!==undefined?it.w:it.weight;w=parseFloat(wr);if(isNaN(w))w=null;}
        if(!key)return;
        var e=null;
        var m=/^L(\d+)$/i.exec(String(key).trim());
        if(m){var idx=parseInt(m[1])-1;if(idx>=0&&idx<lib.length)e=lib[idx];}
        if(!e){var nk=norm(key);
            e=lib.find(function(l){return norm(l.file)===nk||norm(l.name)===nk;});
            if(!e&&nk.length>=4)e=lib.find(function(l){var nf=norm(l.file),nn=norm(l.name);return nf.indexOf(nk)>=0||nk.indexOf(nf)>=0||(nn&&(nn.indexOf(nk)>=0||nk.indexOf(nn)>=0));});
        }
        if(!e){console.warn(L,'LoRA not resolved:',key);return;}
        if(used[e.file])return;
        if((e.category||'')==='style'){if(styleCount>=1){console.log(L,'Style LoRA cap: skipped',e.file);return;}styleCount++;}
        var r=loraRange(e);
        var wt=(w!==null)?w:(parseFloat(e.weight)||0.8);
        if(step>0&&w!==null)wt=r.min+Math.round((wt-r.min)/step)*step;
        wt=Math.min(Math.max(wt,r.min),r.max);
        used[e.file]=1;
        out.push({file:e.file,weight:Math.round(wt*100)/100,trigger:e.trigger||''});
    });
    return out;
}
/**
 * Merge always-on LoRAs into an already-resolved selection, skipping
 * duplicates by file. Returns {loras, triggers} with deduped triggers.
 */
function mergeAlwaysOnLoras(resolved,alwaysOn){
    var loras=resolved.slice();
    var triggers=resolved.map(function(l){return l.trigger;}).filter(Boolean);
    (alwaysOn||[]).forEach(function(e){
        if(!e||!e.file)return;
        if(loras.some(function(x){return x.file===e.file;}))return;
        loras.push({file:e.file,weight:e.weight!==undefined?e.weight:0.8});
        if(e.trigger)triggers.push(e.trigger);
    });
    triggers=triggers.filter(function(t,i){return triggers.indexOf(t)===i;});
    return{loras:loras,triggers:triggers};
}
function injectLorasIntoWorkflow(wfObj,loras){
    if(!loras||!loras.length)return wfObj;var wf=JSON.parse(JSON.stringify(wfObj));
    // Find the model source. Checkpoint loaders expose MODEL(0)+CLIP(1);
    // UNET loaders (Flux/GGUF) expose MODEL only → must use LoraLoaderModelOnly,
    // otherwise the injected LoraLoader's clip:[src,1] input is invalid and
    // ComfyUI rejects the whole graph.
    var sourceId=null,modelOnly=false;
    for(var n in wf){var ct=wf[n].class_type;if(ct==='CheckpointLoaderSimple'||ct==='CheckpointLoader'){sourceId=n;break;}}
    if(!sourceId)for(var n2 in wf){var ct2=wf[n2].class_type;if(ct2==='UNETLoader'||ct2==='UnetLoaderGGUF'){sourceId=n2;modelOnly=true;break;}}
    if(!sourceId){console.warn(L,'No checkpoint/UNET loader — LoRA injection skipped');return wf;}
    var LT=['LoraLoader','LoraLoaderModelOnly'];function isL(id){return wf[id]&&LT.indexOf(wf[id].class_type)>=0;}
    function nextL(from){for(var id in wf){if(!isL(id))continue;var mi=wf[id].inputs.model;if(Array.isArray(mi)&&String(mi[0])===String(from))return id;}return null;}
    var end=sourceId,nx;while((nx=nextL(end))!==null)end=nx;
    // If the existing chain ends in a model-only loader, its output 1 doesn't
    // exist either — append model-only nodes and rewire only model consumers.
    var useModelOnly=modelOnly||(wf[end].class_type==='LoraLoaderModelOnly');
    var cons=[];for(var id in wf){if(id===end||isL(id))continue;var inp=wf[id].inputs;for(var k in inp){var v=inp[k];if(Array.isArray(v)&&v.length>=2&&String(v[0])===String(end)&&(v[1]===0||(!useModelOnly&&v[1]===1)))cons.push({nid:id,key:k,oi:v[1]});}}
    var mx=0;for(var id3 in wf){var nn=parseInt(id3);if(!isNaN(nn)&&nn>mx)mx=nn;}
    var prev=String(end),last=null;
    loras.forEach(function(lr,i){
        var nid=String(mx+5000+i);
        var w=lr.weight!==undefined?lr.weight:0.8;
        if(useModelOnly){
            wf[nid]={inputs:{lora_name:lr.file,strength_model:w,model:[prev,0]},class_type:'LoraLoaderModelOnly',_meta:{title:'AI-LoRA '+lr.file.substring(0,30)}};
        }else{
            wf[nid]={inputs:{lora_name:lr.file,strength_model:w,strength_clip:w,model:[prev,0],clip:[prev,1]},class_type:'LoraLoader',_meta:{title:'AI-LoRA '+lr.file.substring(0,30)}};
        }
        prev=nid;last=nid;
    });
    if(last)cons.forEach(function(c){wf[c.nid].inputs[c.key]=[last,c.oi];});
    return wf;
}

function renderAlwaysOnList(){var p=activePreset();var list=p?p.alwaysOnLoras||[]:[];var c=$('#ai_aon_list');c.empty();if(!list.length){c.html('<small style="color:#888;font-style:italic">None</small>');return;}list.forEach(function(e,idx){var name=e.file.replace(/\.(safetensors|ckpt|pt|bin)$/i,'');c.append('<div style="display:flex;gap:4px;align-items:center;margin:2px 0;padding:3px 6px;background:var(--SmartThemeBlurTintColor,rgba(50,50,50,0.3));border-radius:4px;font-size:.82em"><span style="flex:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(e.file)+'">🔮 '+esc(name)+'</span><span style="flex:1;color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(e.trigger||'—')+'</span><span style="width:40px;text-align:center;color:#8cf">'+e.weight+'</span><span class="ai-aon-remove" data-idx="'+idx+'" style="cursor:pointer;color:#f66;font-size:1.1em">✕</span></div>');});}
function addAlwaysOnLora(f,t,w){if(!f)return;var p=activePreset();if(!p)return;if(!p.alwaysOnLoras)p.alwaysOnLoras=[];if(p.alwaysOnLoras.some(function(e){return e.file===f;})){toastr.warning('Already added.');return;}p.alwaysOnLoras.push({file:f,trigger:t||'',weight:w||0.8});savePreset(p);renderAlwaysOnList();}
function removeAlwaysOnLora(i){var p=activePreset();if(!p||!p.alwaysOnLoras)return;if(i>=0&&i<p.alwaysOnLoras.length){p.alwaysOnLoras.splice(i,1);savePreset(p);renderAlwaysOnList();}}
async function fetchLoraList(){var base=getComfyUrl(),lr=[];async function t(n){try{var r=await fetch(base+'/object_info/'+n);if(r.ok){var d=await r.json();if(d[n])((d[n].input.required.lora_name||[[]])[0]||[]).forEach(function(l){if(lr.indexOf(l)<0)lr.push(l);});}}catch(e){}}await t('LoraLoader');await t('SwarmLoraLoader');await t('LoraLoaderModelOnly');return lr;}

/* ============ LORA METADATA / CIVITAI / AI-DESCRIBE ============ */
async function fetchLoraMetadata(file){
    var base=getComfyUrl();
    var paths=['/api/view_metadata/loras?filename=','/view_metadata/loras?filename='];
    for(var i=0;i<paths.length;i++){
        try{var r=await fetch(base+paths[i]+encodeURIComponent(file));if(r.ok)return await r.json();}catch(e){}
    }
    return null;
}
function metaTopTags(meta,n){
    n=n||18;
    try{
        var tf=meta.ss_tag_frequency;if(!tf)return[];
        if(typeof tf==='string')tf=JSON.parse(tf);
        var all={};for(var ds in tf){if(!tf.hasOwnProperty(ds))continue;var d=tf[ds];for(var t in d)if(d.hasOwnProperty(t))all[t]=(all[t]||0)+d[t];}
        return Object.keys(all).sort(function(a,b){return all[b]-all[a];}).slice(0,n).map(function(t){return t.trim();}).filter(Boolean);
    }catch(e){return[];}
}
function applyMetadataToEntry(e,meta){
    if(!meta)return false;var changed=false;
    var tags=metaTopTags(meta);
    if(tags.length&&!(e.tags||'').trim()){e.tags=tags.join(', ');changed=true;}
    var title=meta['modelspec.title']||meta.ss_output_name;
    if(title&&(!e.name||e.name===stripLoraExt(e.file))){e.name=String(title);changed=true;}
    var base=meta['modelspec.architecture']||meta.ss_base_model_version||meta.ss_sd_model_name;
    if(base&&!(e.baseModel||'').trim()){e.baseModel=String(base);changed=true;}
    return changed;
}
function parseCivitaiRef(u){
    u=String(u||'').trim();if(!u)return null;
    var mv=/modelVersionId=(\d+)/.exec(u);if(mv)return{versionId:mv[1]};
    var m=/civitai\.com\/models\/(\d+)/.exec(u);if(m)return{modelId:m[1]};
    if(/^\d+$/.test(u))return{modelId:u};
    return null;
}
async function fetchCivitaiInfo(ref){
    try{
        var url=ref.versionId
            ?'https://civitai.com/api/v1/model-versions/'+ref.versionId
            :'https://civitai.com/api/v1/models/'+ref.modelId;
        var r=await fetch(url);if(!r.ok)return null;
        var d=await r.json();
        var ver=ref.versionId?d:((d.modelVersions&&d.modelVersions[0])||null);
        var out={name:(ref.versionId?(d.model&&d.model.name):d.name)||'',trainedWords:(ver&&ver.trainedWords)||[],image:'',tags:(d.tags||[]).join(', ')};
        var imgs=(ver&&ver.images)||[];
        for(var i=0;i<imgs.length;i++){if(imgs[i]&&imgs[i].url&&imgs[i].type!=='video'){out.image=imgs[i].url;break;}}
        return out;
    }catch(e){console.warn(L,'Civitai fetch failed:',e);return null;}
}
async function urlToPreviewB64(url){
    // Try to bake a small local thumbnail; if CORS blocks the fetch, fall back
    // to storing the remote URL (img src works cross-origin without canvas).
    try{
        var r=await fetch(url);if(!r.ok)return url;
        var b64=await b2b64(await r.blob());
        b64=await compressImage(b64,192,0.8);
        return'data:image/jpeg;base64,'+b64;
    }catch(e){return url;}
}
async function fileToPreviewB64(file){
    var b64=await b2b64(file);
    b64=await compressImage(b64,192,0.8);
    return'data:image/jpeg;base64,'+b64;
}
async function aiDescribeLoras(entries){
    if(!entries.length)return 0;
    var list=entries.map(function(e,i){
        var r=loraRange(e);
        var hints=[];if(e.tags)hints.push('tags: '+e.tags.substring(0,300));if(e.trigger)hints.push('trigger: '+e.trigger);if(e.baseModel)hints.push('base: '+e.baseModel);
        return(i+1)+'. file "'+e.file+'" [w range '+r.min+'-'+r.max+']'+(hints.length?' ('+hints.join('; ')+')':'');
    });
    var prompt='You label LoRA models for an automatic image-generation LoRA selector.\n'+
        'For EACH LoRA below write:\n'+
        '- "category": one of character, style, concept, anatomy, clothing, other\n'+
        '- "description": ONE sentence starting with "Use when …" describing exactly when this LoRA should be applied to a scene. Infer from the filename and tags.\n'+
        '- "rule": ONE short weight rule — what a low vs high "w" inside the given range means for THIS LoRA and when to pick which. '+
        'Examples: style → "0.4 = light style hint, 0.9 = full stylization"; character → "0.7 = in group scenes (avoid face bleed), 1.0 = solo close-up"; '+
        'concept/detail → "low = subtle background element, high = main focus of the image". Stay inside the given w range. Max 15 words.\n'+
        'Respond with ONLY JSON: {"loras":[{"i":1,"category":"...","description":"...","rule":"..."}]}\n\n'+
        list.join('\n');
    var raw=null;
    try{raw=await generateQuietPrompt(prompt,false,false);}catch(e1){try{raw=await generateQuietPrompt(prompt,false,true);}catch(e2){return 0;}}
    var parsed=extractJSON(raw);
    if(!parsed||!parsed.loras||!parsed.loras.length)return 0;
    var applied=0;
    // Fill only MISSING fields — batches can now mix entries that already have
    // a hand-written description but lack a weight rule (or vice versa).
    parsed.loras.forEach(function(r){
        var idx=parseInt(r.i)-1;if(isNaN(idx)||idx<0||idx>=entries.length)return;
        var e=entries[idx],changed=false;
        if(r.description&&typeof r.description==='string'&&!(e.description||'').trim()){
            e.description=r.description.trim();
            if(r.category&&LORA_CATEGORIES.indexOf(String(r.category).toLowerCase())>=0)e.category=String(r.category).toLowerCase();
            changed=true;
        }
        if(r.rule&&typeof r.rule==='string'&&!(e.weightRule||'').trim()){e.weightRule=r.rule.trim().substring(0,200);changed=true;}
        if(changed)applied++;
    });
    return applied;
}
/**
 * On-demand annotation of a SINGLE entry-like object, for the requested
 * field(s) only (opts.description / opts.rule). Unlike the batch version this
 * always (re)generates — the caller clicked a per-field button — and returns
 * {category?, description?, rule?} (or null) WITHOUT writing to the entry, so
 * the editor can drop the value into the open textbox for review before Save.
 * Reads the passed-in (possibly unsaved) tags/trigger/base/category as hints.
 */
async function aiAnnotateEntry(entry,opts){
    opts=opts||{};var wantDesc=!!opts.description,wantRule=!!opts.rule;
    if(!wantDesc&&!wantRule)return null;
    var r=loraRange(entry);
    var hints=[];
    if(entry.tags)hints.push('tags: '+String(entry.tags).substring(0,300));
    if(entry.trigger)hints.push('trigger: '+entry.trigger);
    if(entry.baseModel)hints.push('base: '+entry.baseModel);
    if(entry.category)hints.push('category: '+entry.category);
    // When generating ONLY the weight rule, the existing description is a strong hint.
    if(wantRule&&!wantDesc&&entry.description)hints.push('description: '+String(entry.description).substring(0,200));
    var want=[];
    if(wantDesc){
        want.push('- "category": one of character, style, concept, anatomy, clothing, other');
        want.push('- "description": ONE sentence starting with "Use when …" describing exactly when this LoRA should be applied to a scene. Infer from the filename and tags.');
    }
    if(wantRule){
        want.push('- "rule": ONE short weight rule — what a low vs high "w" inside the range '+r.min+'-'+r.max+' means for THIS LoRA and when to pick which. '+
            'Examples: style → "0.4 = light style hint, 0.9 = full stylization"; character → "0.7 = group scene (avoid face bleed), 1.0 = solo close-up". Stay inside the range. Max 15 words.');
    }
    var shape=[];if(wantDesc){shape.push('"category":"..."');shape.push('"description":"..."');}if(wantRule)shape.push('"rule":"..."');
    var prompt='You label a single LoRA model for an automatic image-generation LoRA selector.\n'+
        'Write:\n'+want.join('\n')+'\n'+
        'Respond with ONLY JSON: {'+shape.join(',')+'}\n\n'+
        'LoRA: file "'+entry.file+'" [w range '+r.min+'-'+r.max+']'+(hints.length?' ('+hints.join('; ')+')':'');
    var raw=null;
    try{raw=await generateQuietPrompt(prompt,false,false);}catch(e1){try{raw=await generateQuietPrompt(prompt,false,true);}catch(e2){return null;}}
    var parsed=extractJSON(raw);
    if(!parsed||typeof parsed!=='object')return null;
    // Tolerate a model that wraps the object in {"loras":[{…}]}.
    if(!parsed.description&&!parsed.rule&&parsed.loras&&parsed.loras[0])parsed=parsed.loras[0];
    return parsed;
}
async function syncLorasFromComfy(){
    var p=activePreset();if(!p){toastr.warning('No active preset.');return 0;}
    toastr.info('Fetching LoRA list…');
    var lr=await fetchLoraList();
    if(!lr.length){toastr.warning('No LoRAs found on the ComfyUI server.');return 0;}
    populateDatalist('ai_dl_loras',lr);
    var lib=loraLib(p);var have={};lib.forEach(function(e){have[e.file]=1;});
    var added=0;
    lr.forEach(function(f){
        if(!have[f]){
            var ne=newLoraEntry(f);
            // New entries arrive DISABLED: with big collections you enable only
            // what fits the preset's base model (bulk-enable by folder/filter).
            ne.enabled=false;
            lib.push(ne);added++;
        }
    });
    if(added)savePreset(p);
    toastr.success(lr.length+' on server, '+added+' new added (disabled — enable the ones for this preset).');
    return added;
}
function updateLoraCount(){$('#ai_lora_count').text(loraLib().length);}

/* ============ LORA LIBRARY MANAGER (modal) ============ */
var LM_PAGE_SIZE=60;
var lmState={search:'',category:'',folder:'',page:0};
function lmCategoryOptions(sel){return LORA_CATEGORIES.map(function(c){return'<option value="'+c+'"'+(c===sel?' selected':'')+'>'+c+'</option>';}).join('');}
function lmFolderOf(file){var p=String(file||'').split(/[\\/]/);return p.length>1?p.slice(0,-1).join('/'):'';}
function lmPreviewHtml(e){
    if(e.preview)return'<img src="'+esc(e.preview)+'" loading="lazy" alt=""/>';
    return'<div class="ai-lm-noimg">🔮</div>';
}
function lmCardHtml(e,idx){
    var r=loraRange(e);
    var dis=e.enabled===false?' ai-lm-disabled':'';
    var desc=(e.description||e.tags||'').substring(0,90);
    return'<div class="ai-lm-card'+dis+'" data-idx="'+idx+'" title="'+esc(e.file)+'">'+
        '<div class="ai-lm-thumb">'+lmPreviewHtml(e)+
            '<span class="ai-lm-cat">'+esc(e.category||'concept')+'</span>'+
            '<label class="ai-lm-toggle" title="Enabled / disabled for auto-select"><input type="checkbox" class="ai-lm-enabled" data-idx="'+idx+'"'+(e.enabled!==false?' checked':'')+'/></label>'+
        '</div>'+
        '<div class="ai-lm-name">'+esc(e.name||stripLoraExt(e.file))+'</div>'+
        '<div class="ai-lm-meta"><span>w '+r.min+'–'+r.max+'</span>'+(e.trigger?'<span title="'+esc(e.trigger)+'">✳ trigger</span>':'')+'</div>'+
        (desc?'<div class="ai-lm-desc">'+esc(desc)+'</div>':'<div class="ai-lm-desc ai-lm-desc-empty">no description</div>')+
    '</div>';
}
function lmFilteredEntries(){
    var lib=loraLib();
    var q=lmState.search.toLowerCase(),cat=lmState.category,fol=lmState.folder;
    var out=[];
    lib.forEach(function(e,idx){
        if(cat&&(e.category||'concept')!==cat)return;
        if(fol&&lmFolderOf(e.file)!==fol)return;
        if(q){var hay=(e.file+' '+(e.name||'')+' '+(e.tags||'')+' '+(e.description||'')).toLowerCase();if(hay.indexOf(q)<0)return;}
        out.push({e:e,idx:idx});
    });
    return out;
}
function lmRebuildFolderFilter(){
    var sel=$('#ai_lm_folderfilter');if(!sel.length)return;
    var lib=loraLib(),fols={},any=false;
    lib.forEach(function(e){var f=lmFolderOf(e.file);if(f){fols[f]=(fols[f]||0)+1;any=true;}});
    var cur=lmState.folder;
    var html='<option value="">all folders</option>';
    Object.keys(fols).sort().forEach(function(f){
        html+='<option value="'+esc(f)+'"'+(f===cur?' selected':'')+'>'+esc(f)+' ('+fols[f]+')</option>';
    });
    sel.html(html).toggle(any);
}
function lmRenderGrid(){
    var grid=$('#ai_lm_grid');if(!grid.length)return;
    var lib=loraLib();
    var filtered=lmFilteredEntries();
    var pages=Math.max(1,Math.ceil(filtered.length/LM_PAGE_SIZE));
    if(lmState.page>=pages)lmState.page=pages-1;
    if(lmState.page<0)lmState.page=0;
    var start=lmState.page*LM_PAGE_SIZE;
    var slice=filtered.slice(start,start+LM_PAGE_SIZE);
    var html='';
    slice.forEach(function(it){html+=lmCardHtml(it.e,it.idx);});
    if(!lib.length)html='<div class="ai-lm-empty">Library is empty.<br/>Click <b>🔄 Sync ComfyUI</b> to import LoRAs from the server.</div>';
    else if(!filtered.length)html='<div class="ai-lm-empty">Nothing matches the filter.</div>';
    grid.html(html);
    grid.scrollTop(0);
    $('#ai_lm_count').text(lib.length);
    // How many will actually be offered to the LLM
    var promptable=lib.filter(function(e){return e&&e.file&&e.enabled!==false&&((e.description||'').trim()||(e.tags||'').trim());}).length;
    var capped=promptable>LORA_PROMPT_CAP;
    $('#ai_lm_promptable').html((capped?'<span style="color:#fbbf24">⚠ '+LORA_PROMPT_CAP+' of '+promptable+'</span>':promptable)+' in prompt')
        .attr('title',capped
            ?'More annotated+enabled LoRAs than the cap ('+LORA_PROMPT_CAP+') — only the first '+LORA_PROMPT_CAP+' are offered to the LLM. Disable what this preset does not need.'
            :'Enabled LoRAs with a description or tags — only these are offered to the LLM for auto-select.');
    // Pager
    var pager=$('#ai_lm_pager');
    if(pager.length){
        if(filtered.length<=LM_PAGE_SIZE){
            pager.html(filtered.length&&filtered.length!==lib.length?'<span class="ai-lm-pg-info">'+filtered.length+' matched</span>':'').toggle(!!filtered.length&&filtered.length!==lib.length);
        }else{
            var from=start+1,to=Math.min(start+LM_PAGE_SIZE,filtered.length);
            pager.show().html(
                '<span class="ai-lm-pg-btn'+(lmState.page<=0?' ai-lm-pg-off':'')+'" data-pg="first" title="First page">«</span>'+
                '<span class="ai-lm-pg-btn'+(lmState.page<=0?' ai-lm-pg-off':'')+'" data-pg="prev">‹ Prev</span>'+
                '<span class="ai-lm-pg-info">'+from+'–'+to+' of '+filtered.length+' &nbsp;·&nbsp; page '+(lmState.page+1)+'/'+pages+'</span>'+
                '<span class="ai-lm-pg-btn'+(lmState.page>=pages-1?' ai-lm-pg-off':'')+'" data-pg="next">Next ›</span>'+
                '<span class="ai-lm-pg-btn'+(lmState.page>=pages-1?' ai-lm-pg-off':'')+'" data-pg="last" title="Last page">»</span>'
            );
        }
    }
    updateLoraCount();
}
function lmCloseEditor(){$('#ai_lm_editor').remove();lmState.editIdx=-1;}
function lmOpenEditor(idx){
    lmCloseEditor();
    var lib=loraLib();var e=lib[idx];if(!e)return;
    lmState.editIdx=idx;
    var r=loraRange(e);
    var ed=$('<div id="ai_lm_editor" class="ai-lm-editor">'+
        '<div class="ai-lm-ed-box">'+
        '<div class="ai-lm-ed-head"><b>✏️ '+esc(e.name||stripLoraExt(e.file))+'</b><span class="ai-lm-ed-close" title="Close">✕</span></div>'+
        '<div class="ai-lm-ed-body">'+
        '<div class="ai-lm-ed-cols">'+
            '<div class="ai-lm-ed-left">'+
                '<div class="ai-lm-ed-preview">'+lmPreviewHtml(e)+'</div>'+
                '<div class="ai-lm-ed-prevbtns">'+
                    '<div id="ai_lm_ed_upload" class="menu_button" style="font-size:.76em">📁 Image…</div>'+
                    '<div id="ai_lm_ed_delprev" class="menu_button" style="font-size:.76em"'+(e.preview?'':' hidden')+'>🗑️</div>'+
                    '<input id="ai_lm_ed_file" type="file" accept="image/*" style="display:none"/>'+
                '</div>'+
                '<div class="ai-lm-ed-civ"><input id="ai_lm_ed_civurl" class="text_pole" placeholder="Civitai URL / model id" style="font-size:.8em"/><div id="ai_lm_ed_civfetch" class="menu_button" style="font-size:.76em">🌐 Fetch</div></div>'+
                '<div id="ai_lm_ed_meta" class="menu_button" style="font-size:.76em;margin-top:4px">📊 Read safetensors metadata</div>'+
            '</div>'+
            '<div class="ai-lm-ed-right">'+
                '<label>File</label><input class="text_pole" value="'+esc(e.file)+'" readonly style="opacity:.65;font-size:.82em"/>'+
                '<label>Display name</label><input id="ai_lm_ed_name" class="text_pole" value="'+esc(e.name||'')+'"/>'+
                '<div class="ai-lm-ed-row"><div style="flex:1"><label>Category</label><select id="ai_lm_ed_cat" class="text_pole">'+lmCategoryOptions(e.category||'concept')+'</select></div>'+
                '<div style="flex:1"><label title="Base model, informational">Base</label><input id="ai_lm_ed_base" class="text_pole" value="'+esc(e.baseModel||'')+'" placeholder="—"/></div></div>'+
                '<div style="display:flex;align-items:center;gap:6px;margin-top:5px"><label style="flex:1;margin:0" title="One sentence the LLM sees when deciding whether to apply this LoRA. Start with “Use when …”">Description (for LLM matching)</label><span id="ai_lm_ed_gendesc" class="menu_button" style="font-size:.72em;padding:2px 8px;flex-shrink:0" title="Generate category + description with the LLM. Fills the box below — review, then Save.">✨ AI</span></div>'+
                '<textarea id="ai_lm_ed_desc" class="text_pole" rows="3" placeholder="Use when a dragon or draconic creature is visually present…">'+esc(e.description||'')+'</textarea>'+
                '<label title="Fallback keywords used if description is empty">Tags</label>'+
                '<textarea id="ai_lm_ed_tags" class="text_pole" rows="2">'+esc(e.tags||'')+'</textarea>'+
                '<label title="Appended to the image prompt whenever this LoRA is applied">Trigger words</label>'+
                '<input id="ai_lm_ed_trigger" class="text_pole" value="'+esc(e.trigger||'')+'"/>'+
                '<div class="ai-lm-ed-row">'+
                    '<div style="flex:1"><label>Default w</label><input id="ai_lm_ed_w" type="number" step="0.05" class="text_pole" value="'+(parseFloat(e.weight)||0.8)+'"/></div>'+
                    '<div style="flex:1"><label>Min w</label><input id="ai_lm_ed_wmin" type="number" step="0.05" class="text_pole" value="'+r.min+'"/></div>'+
                    '<div style="flex:1"><label>Max w</label><input id="ai_lm_ed_wmax" type="number" step="0.05" class="text_pole" value="'+r.max+'"/></div>'+
                '</div>'+
                '<div style="display:flex;align-items:center;gap:6px;margin-top:5px"><label style="flex:1;margin:0" title="Rule the LLM follows when picking this LoRA\'s weight (w) inside Min–Max. Leave empty to fall back to the default rule (visual prominence: subtle = min, dominant = max).">Weight rule (for LLM)</label><span id="ai_lm_ed_genrule" class="menu_button" style="font-size:.72em;padding:2px 8px;flex-shrink:0" title="Generate a weight rule with the LLM, using the current w range + description. Fills the box below — review, then Save.">✨ AI</span></div>'+
                '<textarea id="ai_lm_ed_wrule" class="text_pole" rows="2" placeholder="e.g. 0.4 = light style hint, 0.8 = normal, 1.1 = full stylization / close-up">'+esc(e.weightRule||'')+'</textarea>'+
                '<label class="checkbox_label" style="margin-top:6px"><input id="ai_lm_ed_enabled" type="checkbox"'+(e.enabled!==false?' checked':'')+'/><span>Enabled for auto-select</span></label>'+
            '</div>'+
        '</div>'+
        '</div>'+
        '<div class="ai-lm-ed-foot">'+
            '<div id="ai_lm_ed_delete" class="menu_button" style="color:#f66;font-size:.8em">🗑️ Remove from library</div>'+
            '<span style="flex:1"></span>'+
            '<div id="ai_lm_ed_save" class="menu_button" style="font-size:.85em">💾 Save</div>'+
        '</div>'+
    '</div></div>');
    $('#ai_lora_manager').append(ed);
    function readFields(){
        e.name=$('#ai_lm_ed_name').val().trim();
        e.category=$('#ai_lm_ed_cat').val()||'concept';
        e.baseModel=$('#ai_lm_ed_base').val().trim();
        e.description=$('#ai_lm_ed_desc').val().trim();
        e.tags=$('#ai_lm_ed_tags').val().trim();
        e.trigger=$('#ai_lm_ed_trigger').val().trim();
        var w=parseFloat($('#ai_lm_ed_w').val());e.weight=isNaN(w)?0.8:w;
        var wmin=parseFloat($('#ai_lm_ed_wmin').val());e.weightMin=isNaN(wmin)?0.2:wmin;
        var wmax=parseFloat($('#ai_lm_ed_wmax').val());e.weightMax=isNaN(wmax)?1.2:wmax;
        e.weightRule=$('#ai_lm_ed_wrule').val().trim();
        e.enabled=$('#ai_lm_ed_enabled').prop('checked');
    }
    ed.find('.ai-lm-ed-close').on('click',lmCloseEditor);
    ed.find('#ai_lm_ed_save').on('click',function(){
        readFields();var p=activePreset();if(p)savePreset(p);
        lmCloseEditor();lmRenderGrid();toastr.success('Saved.');
    });
    ed.find('#ai_lm_ed_delete').on('click',function(){
        if(!confirm('Remove "'+e.file+'" from the library?'))return;
        lib.splice(idx,1);var p=activePreset();if(p)savePreset(p);
        lmCloseEditor();lmRenderGrid();
    });
    ed.find('#ai_lm_ed_upload').on('click',function(){$('#ai_lm_ed_file').trigger('click');});
    ed.find('#ai_lm_ed_file').on('change',async function(ev){
        var f=ev.target.files&&ev.target.files[0];if(!f)return;
        try{e.preview=await fileToPreviewB64(f);}catch(err){toastr.error('Could not read image.');return;}
        var p=activePreset();if(p)savePreset(p);
        ed.find('.ai-lm-ed-preview').html(lmPreviewHtml(e));
        ed.find('#ai_lm_ed_delprev').prop('hidden',false);
        lmRenderGrid();
    });
    ed.find('#ai_lm_ed_delprev').on('click',function(){
        e.preview='';var p=activePreset();if(p)savePreset(p);
        ed.find('.ai-lm-ed-preview').html(lmPreviewHtml(e));
        $(this).prop('hidden',true);lmRenderGrid();
    });
    ed.find('#ai_lm_ed_meta').on('click',async function(){
        var btn=$(this);btn.text('📊 Reading…');
        var meta=await fetchLoraMetadata(e.file);
        btn.text('📊 Read safetensors metadata');
        if(!meta){toastr.warning('No metadata (server too old, or file has none).');return;}
        var tags=metaTopTags(meta);
        if(tags.length)$('#ai_lm_ed_tags').val(tags.join(', '));
        var title=meta['modelspec.title']||meta.ss_output_name;
        if(title&&!$('#ai_lm_ed_name').val().trim())$('#ai_lm_ed_name').val(String(title));
        var base=meta['modelspec.architecture']||meta.ss_base_model_version;
        if(base)$('#ai_lm_ed_base').val(String(base));
        toastr.success(tags.length?tags.length+' tags extracted — review & Save.':'Metadata read (no tag frequency).');
    });
    // Per-field on-demand LLM generation. Reads the CURRENT (unsaved) editor
    // fields as hints, drops the result into the box for review — does not save.
    function currentEntryForAI(){
        return{file:e.file,
            tags:$('#ai_lm_ed_tags').val().trim(),
            trigger:$('#ai_lm_ed_trigger').val().trim(),
            baseModel:$('#ai_lm_ed_base').val().trim(),
            category:$('#ai_lm_ed_cat').val()||'',
            description:$('#ai_lm_ed_desc').val().trim(),
            weightMin:parseFloat($('#ai_lm_ed_wmin').val()),
            weightMax:parseFloat($('#ai_lm_ed_wmax').val())};
    }
    ed.find('#ai_lm_ed_gendesc').on('click',async function(){
        var btn=$(this),old=btn.html();btn.html('✨ …').css('pointer-events','none');
        var res=await aiAnnotateEntry(currentEntryForAI(),{description:true});
        btn.html(old).css('pointer-events','');
        if(!res||!res.description){toastr.warning('LLM did not return a usable description.');return;}
        $('#ai_lm_ed_desc').val(String(res.description).trim());
        if(res.category&&LORA_CATEGORIES.indexOf(String(res.category).toLowerCase())>=0)$('#ai_lm_ed_cat').val(String(res.category).toLowerCase());
        toastr.success('Description generated — review & Save.');
    });
    ed.find('#ai_lm_ed_genrule').on('click',async function(){
        var btn=$(this),old=btn.html();btn.html('✨ …').css('pointer-events','none');
        var res=await aiAnnotateEntry(currentEntryForAI(),{rule:true});
        btn.html(old).css('pointer-events','');
        if(!res||!res.rule){toastr.warning('LLM did not return a usable weight rule.');return;}
        $('#ai_lm_ed_wrule').val(String(res.rule).trim().substring(0,200));
        toastr.success('Weight rule generated — review & Save.');
    });
    ed.find('#ai_lm_ed_civfetch').on('click',async function(){
        var ref=parseCivitaiRef($('#ai_lm_ed_civurl').val());
        if(!ref){toastr.warning('Paste a civitai.com model URL or numeric id.');return;}
        var btn=$(this);btn.text('🌐 …');
        var info=await fetchCivitaiInfo(ref);
        if(info&&info.image){e.preview=await urlToPreviewB64(info.image);ed.find('.ai-lm-ed-preview').html(lmPreviewHtml(e));ed.find('#ai_lm_ed_delprev').prop('hidden',false);}
        btn.text('🌐 Fetch');
        if(!info){toastr.error('Civitai fetch failed (CORS / not found).');return;}
        if(info.trainedWords&&info.trainedWords.length)$('#ai_lm_ed_trigger').val(info.trainedWords.join(', '));
        if(info.name&&!$('#ai_lm_ed_name').val().trim())$('#ai_lm_ed_name').val(info.name);
        if(info.tags&&!$('#ai_lm_ed_tags').val().trim())$('#ai_lm_ed_tags').val(info.tags);
        var p=activePreset();if(p)savePreset(p);
        lmRenderGrid();
        toastr.success('Civitai data applied — review & Save.');
    });
}
function openLoraManager(){
    $('#ai_lora_manager').remove();
    var p=activePreset();
    if(!p){toastr.warning('Create/select a preset first.');return;}
    lmState.search='';lmState.category='';lmState.folder='';lmState.page=0;
    var catFilter='<option value="">all categories</option>'+LORA_CATEGORIES.map(function(c){return'<option value="'+c+'">'+c+'</option>';}).join('');
    var ov=$('<div id="ai_lora_manager">'+
        '<div class="ai-lm-header">'+
            '<span>📚 LoRA Library</span>'+
            '<span class="ai-gal-count" title="Preset">'+esc(p.name)+'</span>'+
            '<span class="ai-gal-count"><span id="ai_lm_count">0</span> LoRAs</span>'+
            '<span class="ai-gal-count" id="ai_lm_promptable">0 in prompt</span>'+
            '<input id="ai_lm_search" class="text_pole" placeholder="🔍 search…" style="width:170px;font-size:.85em"/>'+
            '<select id="ai_lm_catfilter" class="text_pole" style="width:130px;font-size:.85em">'+catFilter+'</select>'+
            '<select id="ai_lm_folderfilter" class="text_pole" style="width:170px;font-size:.85em;display:none"></select>'+
            '<span class="ai-gal-spacer"></span>'+
            '<div id="ai_lm_bulk_on" class="menu_button" style="font-size:.78em" title="Enable all LoRAs matching the current filter">✅ Enable filtered</div>'+
            '<div id="ai_lm_bulk_off" class="menu_button" style="font-size:.78em" title="Disable all LoRAs matching the current filter">🚫 Disable filtered</div>'+
            '<div id="ai_lm_sync" class="menu_button" style="font-size:.78em" title="Add LoRA files found on the ComfyUI server that are not in the library yet">🔄 Sync ComfyUI</div>'+
            '<div id="ai_lm_autometa" class="menu_button" style="font-size:.78em" title="Read safetensors metadata for every LoRA without tags (may take a while)">📊 Auto-tag</div>'+
            '<div id="ai_lm_aidesc" class="menu_button" style="font-size:.78em" title="Ask the connected LLM to write a “Use when …” description for every LoRA that lacks one">✨ AI Describe</div>'+
            '<span class="ai-gal-close" id="ai_lm_close">✕</span>'+
        '</div>'+
        '<div id="ai_lm_grid" class="ai-lm-grid"></div>'+
        '<div id="ai_lm_pager" class="ai-lm-pager" style="display:none"></div>'+
    '</div>');
    $('body').append(ov);
    lmRebuildFolderFilter();
    lmRenderGrid();
    ov.find('#ai_lm_close').on('click',function(){ov.remove();updateLoraCount();});
    var searchT=null;
    ov.find('#ai_lm_search').on('input',function(){
        var v=$(this).val();
        clearTimeout(searchT);
        searchT=setTimeout(function(){lmState.search=v;lmState.page=0;lmRenderGrid();},200);
    });
    ov.find('#ai_lm_catfilter').on('change',function(){lmState.category=$(this).val();lmState.page=0;lmRenderGrid();});
    ov.find('#ai_lm_folderfilter').on('change',function(){lmState.folder=$(this).val();lmState.page=0;lmRenderGrid();});
    ov.on('click','.ai-lm-pg-btn',function(){
        if($(this).hasClass('ai-lm-pg-off'))return;
        var a=$(this).data('pg');
        var pages=Math.max(1,Math.ceil(lmFilteredEntries().length/LM_PAGE_SIZE));
        if(a==='first')lmState.page=0;
        else if(a==='prev')lmState.page--;
        else if(a==='next')lmState.page++;
        else if(a==='last')lmState.page=pages-1;
        lmRenderGrid();
    });
    function lmBulkEnable(on){
        var f=lmFilteredEntries();
        if(!f.length){toastr.info('Nothing matches the filter.');return;}
        var scope=(lmState.search||lmState.category||lmState.folder)?'the current filter':'the ENTIRE library';
        if(!confirm((on?'Enable':'Disable')+' '+f.length+' LoRA(s) in '+scope+'?'))return;
        f.forEach(function(it){it.e.enabled=on;});
        var pp=activePreset();if(pp)savePreset(pp);
        lmRenderGrid();
        toastr.success(f.length+' LoRA(s) '+(on?'enabled':'disabled')+'.');
    }
    ov.find('#ai_lm_bulk_on').on('click',function(){lmBulkEnable(true);});
    ov.find('#ai_lm_bulk_off').on('click',function(){lmBulkEnable(false);});
    ov.on('click','.ai-lm-card',function(e2){
        if($(e2.target).closest('.ai-lm-toggle').length)return;
        lmOpenEditor(parseInt($(this).data('idx')));
    });
    ov.on('change','.ai-lm-enabled',function(){
        var idx=parseInt($(this).data('idx'));var lib=loraLib();
        if(!lib[idx])return;lib[idx].enabled=$(this).prop('checked');
        var pp=activePreset();if(pp)savePreset(pp);
        lmRenderGrid();
    });
    ov.find('#ai_lm_sync').on('click',async function(){await syncLorasFromComfy();lmRebuildFolderFilter();lmRenderGrid();});
    ov.find('#ai_lm_autometa').on('click',async function(){
        // Scope: current filter (search/category/folder) → so with 1000+ LoRAs
        // you can process one folder at a time.
        var todo=lmFilteredEntries().map(function(it){return it.e;}).filter(function(e){return!(e.tags||'').trim();});
        if(!todo.length){toastr.info('All LoRAs in the current filter already have tags.');return;}
        if(!confirm('Read safetensors metadata for '+todo.length+' LoRA(s) in the current filter?\n(~1 request per file, may take a while)'))return;
        var btn=$(this),ok=0,stop=false;
        btn.data('running',true).off('click.stop').on('click.stop',function(){stop=true;});
        for(var i=0;i<todo.length;i++){
            if(stop)break;
            btn.text('📊 '+(i+1)+'/'+todo.length+' (click to stop)');
            var meta=await fetchLoraMetadata(todo[i].file);
            if(applyMetadataToEntry(todo[i],meta))ok++;
            if(i%25===24)lmRenderGrid();
        }
        btn.text('📊 Auto-tag').removeData('running').off('click.stop');
        var pp2=activePreset();if(pp2)savePreset(pp2);
        lmRenderGrid();
        toastr.success((stop?'Stopped. ':'')+ok+' LoRA(s) updated from metadata.');
    });
    ov.find('#ai_lm_aidesc').on('click',async function(){
        var todo=lmFilteredEntries().map(function(it){return it.e;}).filter(function(e){return!(e.description||'').trim()||!(e.weightRule||'').trim();});
        if(!todo.length){toastr.info('All LoRAs in the current filter already have descriptions and weight rules.');return;}
        var calls=Math.ceil(todo.length/15);
        if(!confirm('Ask the LLM to annotate '+todo.length+' LoRA(s) in the current filter (missing description or weight rule)?\nOnly empty fields are filled. This will make ~'+calls+' LLM request(s).'))return;
        var btn=$(this),total=0,stop=false;
        btn.on('click.stop',function(){stop=true;});
        // Batch by 15 so long libraries don't blow the context / JSON quality.
        for(var i=0;i<todo.length;i+=15){
            if(stop)break;
            var batch=todo.slice(i,i+15);
            btn.text('✨ '+Math.min(i+15,todo.length)+'/'+todo.length+' (click to stop)');
            total+=await aiDescribeLoras(batch);
            var pmid=activePreset();if(pmid)savePreset(pmid);
        }
        btn.text('✨ AI Describe').off('click.stop');
        var pp3=activePreset();if(pp3)savePreset(pp3);
        lmRenderGrid();
        if(total)toastr.success((stop?'Stopped. ':'')+total+' LoRA(s) annotated (descriptions / weight rules). Review before trusting them.');
        else toastr.warning('LLM did not return usable annotations.');
    });
}

/* ============ CHARACTER DESCRIPTION ============ */
function getCharacterDescriptions(){var ctx=getContext(),d={};try{var chId=ctx.characterId;if(chId!==undefined&&ctx.characters&&ctx.characters[chId]){var ch=ctx.characters[chId],nm=ch.name||ctx.name2||'',ds='';if(ch.description)ds+=ch.description+'\n';if(ch.personality)ds+='Personality: '+ch.personality+'\n';if(nm&&ds.trim())d[nm]=ds.trim();}if(ctx.groupId&&ctx.groups){var g=ctx.groups.find(function(g){return g.id===ctx.groupId;});if(g&&g.members)g.members.forEach(function(mid){var m=null;for(var i=0;i<(ctx.characters||[]).length;i++){if(ctx.characters[i].avatar===mid||ctx.characters[i].name===mid){m=ctx.characters[i];break;}}if(m&&m.name&&m.description){var md=m.description;if(m.personality)md+='\nPersonality: '+m.personality;d[m.name]=md.trim();}});}}catch(e){}return d;}
function buildCharDescBlock(d){if(!d||!Object.keys(d).length)return'';var lines=[];for(var n in d)if(d.hasOwnProperty(n)){var t=d[n];if(t.length>800)t=t.substring(0,800)+'…';lines.push('CHARACTER "'+n+'":\n'+t);}return'\nCHARACTER VISUAL REFERENCES (BASE appearance — override ONLY what story explicitly changes):\n\n'+lines.join('\n\n')+'\n';}
function getAvailableCharNames(){var ctx=getContext(),names=[];try{if(ctx.characterId!==undefined&&ctx.characters&&ctx.characters[ctx.characterId])names.push(ctx.characters[ctx.characterId].name||ctx.name2||'');if(ctx.groupId&&ctx.groups){var g=ctx.groups.find(function(gr){return gr.id===ctx.groupId;});if(g&&g.members)g.members.forEach(function(mid){var m=null;for(var i=0;i<(ctx.characters||[]).length;i++){if(ctx.characters[i].avatar===mid||ctx.characters[i].name===mid){m=ctx.characters[i];break;}}if(m&&m.name&&names.indexOf(m.name)<0)names.push(m.name);});}}catch(e){}return names.filter(Boolean);}

/* ============ COMFYUI OPTIONS ============ */
var comfyOptionsCache=null;
async function fetchComfyOptions(){if(comfyOptionsCache)return comfyOptionsCache;var base=getComfyUrl();var o={models:[],samplers:[],schedulers:[],vaes:[],loras:[],clips:[]};async function ni(t){try{var r=await fetch(base+'/object_info/'+t);if(r.ok)return await r.json();}catch(e){}return null;}try{var ck=await ni('CheckpointLoaderSimple');if(ck&&ck.CheckpointLoaderSimple)o.models=(ck.CheckpointLoaderSimple.input.required.ckpt_name||[[]])[0]||[];var un=await ni('UNETLoader');if(un&&un.UNETLoader)((un.UNETLoader.input.required.unet_name||[[]])[0]||[]).forEach(function(m){if(o.models.indexOf(m)<0)o.models.push(m);});var ks=await ni('KSampler');if(ks&&ks.KSampler){o.samplers=(ks.KSampler.input.required.sampler_name||[[]])[0]||[];o.schedulers=(ks.KSampler.input.required.scheduler||[[]])[0]||[];}var sw=await ni('SwarmKSampler');if(sw&&sw.SwarmKSampler){((sw.SwarmKSampler.input.required.sampler_name||[[]])[0]||[]).forEach(function(s){if(o.samplers.indexOf(s)<0)o.samplers.push(s);});((sw.SwarmKSampler.input.required.scheduler||[[]])[0]||[]).forEach(function(s){if(o.schedulers.indexOf(s)<0)o.schedulers.push(s);});}var va=await ni('VAELoader');if(va&&va.VAELoader)o.vaes=(va.VAELoader.input.required.vae_name||[[]])[0]||[];var lr=await ni('LoraLoader');if(lr&&lr.LoraLoader)o.loras=(lr.LoraLoader.input.required.lora_name||[[]])[0]||[];var sl=await ni('SwarmLoraLoader');if(sl&&sl.SwarmLoraLoader)((sl.SwarmLoraLoader.input.required.lora_name||[[]])[0]||[]).forEach(function(l){if(o.loras.indexOf(l)<0)o.loras.push(l);});var cl=await ni('CLIPLoader');if(cl&&cl.CLIPLoader)o.clips=(cl.CLIPLoader.input.required.clip_name||[[]])[0]||[];var dc=await ni('DualCLIPLoader');if(dc&&dc.DualCLIPLoader){((dc.DualCLIPLoader.input.required.clip_name1||[[]])[0]||[]).forEach(function(c){if(o.clips.indexOf(c)<0)o.clips.push(c);});((dc.DualCLIPLoader.input.required.clip_name2||[[]])[0]||[]).forEach(function(c){if(o.clips.indexOf(c)<0)o.clips.push(c);});}comfyOptionsCache=o;}catch(e){}return o;}
function populateDatalist(id,items){var dl=$('#'+id);if(!dl.length){dl=$('<datalist id="'+id+'"></datalist>');$('body').append(dl);}dl.empty();items.forEach(function(i){dl.append('<option value="'+esc(i)+'"/>');});}
async function refreshComfyDropdowns(){comfyOptionsCache=null;toastr.info('Fetching…');var o=await fetchComfyOptions();populateDatalist('ai_dl_models',o.models);populateDatalist('ai_dl_samplers',o.samplers);populateDatalist('ai_dl_schedulers',o.schedulers);populateDatalist('ai_dl_vaes',o.vaes);populateDatalist('ai_dl_loras',o.loras);populateDatalist('ai_dl_clips',o.clips||[]);toastr.success(o.models.length+' models, '+o.loras.length+' LoRAs, '+(o.clips||[]).length+' CLIPs');}

/* ============ LLM ============ */
function buildPrompt(text,n,fmtKey,customInstr,charName,routing,adaptive,loraLib,maxLoras,charDesc,charNames,loraStep){
    var fmt=FORMATS[fmtKey]||FORMATS.flux;var pov=isPOVFormat(fmtKey);var userName=getUserName();
    var ib=customInstr&&customInstr.trim()?customInstr:fmt.inst?'STYLE ("'+fmt.l+'"): '+fmt.inst:'Create visual prompts.';
    var povBlock='';
    if(pov){povBlock='\n═══ POV (FIRST-PERSON VIEW) RULES ═══\nThe viewer is "'+userName+'". Every image prompt MUST be from their first-person perspective.\n• The image = what '+userName+' sees through their own eyes.\n• Characters FACE the viewer/camera.\n• NEVER describe '+userName+'\'s face, hair, or full body.\n• Hands/arms ONLY when physically interacting.\n• "person_count" = visible characters only — NOT the viewer.\n• "characters" = do NOT include '+userName+'.\n═══════════════════════════════════\n';}
    var cB='',cF='';if(routing&&charName){cB='\nCHARACTER ROUTING: "'+charName+'". "has_char":true if visually present.\n';cF=',"has_char":true/false';}
    var pB='',pF='';if(adaptive){pB='\nPERSON COUNT: "person_count":N'+(pov?' (NOT the viewer)':'')+'.\n';pF=',"person_count":N';}
    var lB='',lF='';if(loraLib&&loraLib.length){var lb=buildLoraPromptBlock(loraLib,maxLoras||2,loraStep);lB=lb.block;lF=lb.field;}
    var cdB=buildCharDescBlock(charDesc);
    var charDetect='',charField=',"characters":[]';
    if(charNames&&charNames.length){charDetect='\nCHARACTER DETECTION: Known: '+charNames.join(', ')+'\n"characters":["Name1","Name2"] — visually present only.'+(pov?'\nDo NOT list "'+userName+'" — they are the viewer.':'')+'\n';}
    var cR=pov?'\nCHARACTER+POV RULES:\n- Include base visual traits for visible characters.\n- Characters FACE the viewer.\n- Never describe '+userName+' as visible.\n':'\nCHARACTER RULES:\n- ALWAYS include base visual traits from references.\n- Story changes override ONLY that attribute.\n- Never omit appearance.\n';
    return'You are a specialist that splits text into illustrated sections with image prompts.\n\nTASK: '+n+' section(s).\n\n'+ib+'\n'+povBlock+cdB+cB+pB+charDetect+lB+cR+
        '\nRULES:\n1. "text"=EXACT VERBATIM. 2. All sections=entire text. 3. Natural splits. 4. Visual prompts. 5. ONLY JSON.\n'+
        /* §9.2: image prompts leave the language layer — checkpoints (and booru
           tag vocabularies in particular) only understand English. "text" is
           NOT covered: it must stay verbatim in the story's own language. */
        '6. Every "image_prompt" in ENGLISH ONLY, whatever language the story or these instructions are in. Never translate "text".\n\n'+
        'FORMAT: {"sections":[{"text":"...","image_prompt":"..."'+cF+pF+charField+lF+'}]}\n\n--- TEXT ---\n'+text+'\n--- END ---';
}

async function analyseMessage(text,n,fmtKey,customInstr,charName,routing,adaptive,loraLib,maxLoras,charDesc,charNames,loraStep){
    var prompt=buildPrompt(text,n,fmtKey,customInstr,charName,routing,adaptive,loraLib,maxLoras,charDesc,charNames,loraStep);
    var raw=null;try{raw=await generateQuietPrompt(prompt,false,false);}catch(e1){try{raw=await generateQuietPrompt(prompt,false,true);}catch(e2){toastr.error('LLM error.');return null;}}
    if(!raw){console.warn(L,'Analysis: the LLM returned an empty reply.');return null;}
    var parsed=extractJSON(raw);
    if(!parsed||!parsed.sections||!parsed.sections.length){console.warn(L,'Analysis: no {"sections":[…]} in the LLM reply ('+raw.length+' chars):\n'+raw.substring(0,2000));return null;}
    var valid=parsed.sections.filter(function(s){return s&&typeof s.text==='string'&&typeof s.image_prompt==='string';});
    var pov=isPOVFormat(fmtKey);
    valid.forEach(function(s,i){var info=[];if(pov)info.push('POV');if(s.characters&&s.characters.length)info.push('chars=['+s.characters.join(',')+']');if(s.person_count)info.push('p='+s.person_count);if(s.has_char!==undefined)info.push('route='+(s.has_char?'CHAR':'env'));if(s.loras&&s.loras.length)info.push('lora=['+s.loras.map(function(x){return typeof x==='string'?x:((x.id||x.n||x.name||x.file||'?')+(x.w!==undefined?':'+x.w:''));}).join(',')+']');console.log(L,'Sec '+(i+1)+':',(info.length?info.join(' '):''),'→ "'+s.image_prompt.substring(0,80)+'…"');});
    return valid.length?valid:null;
}

/* ============ WORKFLOW AUTO-PLACEHOLDERS ============ */
/**
 * Detect a ComfyUI API-format workflow and replace known node inputs with %placeholders%.
 *
 * @param {string} jsonStr - The workflow JSON text.
 * @param {string} [mode='all'] - Either 'all' (every known field, default) or
 *   'basic' (only %prompt%, %negative_prompt%, %width%, %height%, %seed%). The basic
 *   set is the minimum to drive a workflow dynamically while leaving the user's
 *   choices for model/sampler/scheduler/steps/cfg/etc. untouched.
 *
 * Recognises: KSampler/KSamplerAdvanced (seed, steps, cfg, sampler_name, scheduler, denoise),
 * CLIPTextEncode (positive/negative — traced via KSampler.positive/.negative links),
 * Checkpoint/UNET loaders (ckpt_name/unet_name → %model%),
 * VAELoader (vae_name → %vae%),
 * CLIPLoader/DualCLIPLoader (clip_name(1|2) → %clip_name(1|2)%),
 * CLIPSetLastLayer (stop_at_clip_layer → %clip_skip% — note: negative in Comfy convention),
 * EmptyLatentImage / EmptySD3LatentImage / ModelSamplingFlux (width/height/batch_size).
 *
 * Returns { json: pretty-printed string with placeholders, report: array of human-readable changes }.
 * Throws on invalid JSON or unrecognised structure (UI workflow format, not API format).
 */
function autoPlaceholderWorkflow(jsonStr, mode){
    mode = mode || 'all';
    var BASIC_ALLOWED = { '%prompt%':1, '%negative_prompt%':1, '%width%':1, '%height%':1, '%seed%':1 };

    var obj;
    try{ obj=JSON.parse(jsonStr); }
    catch(e){ throw new Error('Invalid JSON: '+e.message); }
    if(!obj||typeof obj!=='object'||Array.isArray(obj))
        throw new Error('Not an object — expected ComfyUI API-format workflow (with numeric node IDs).');
    // UI-format detection: has "nodes" array → not API format
    if(Array.isArray(obj.nodes)&&!Object.keys(obj).some(function(k){return obj[k]&&obj[k].class_type;}))
        throw new Error('This looks like a ComfyUI UI-format workflow. Please export via "Save (API Format)" in ComfyUI.');

    var report=[];
    var nodeIds=Object.keys(obj).filter(function(k){return obj[k]&&obj[k].class_type&&obj[k].inputs;});
    if(!nodeIds.length)
        throw new Error('No nodes with class_type/inputs found. Is this an API-format workflow?');

    // Pass 1: identify positive/negative CLIPTextEncode nodes by tracing KSampler links
    var positiveClipIds=new Set();
    var negativeClipIds=new Set();
    nodeIds.forEach(function(id){
        var n=obj[id];
        var ct=n.class_type||'';
        if(!/KSampler/i.test(ct)) return;
        var ins=n.inputs||{};
        // ComfyUI links look like ["upstream_node_id", output_index]
        function traceClip(linkVal){
            if(!Array.isArray(linkVal)||linkVal.length<1) return null;
            var upId=String(linkVal[0]);
            var up=obj[upId];
            if(!up) return null;
            var upCt=up.class_type||'';
            if(/CLIPTextEncode/i.test(upCt)) return upId;
            // Skip through one layer of ConditioningCombine/ConditioningConcat/ConditioningSetArea/etc.
            // by following the first conditioning-typed input we find.
            if(/Conditioning/i.test(upCt)&&up.inputs){
                for(var ik in up.inputs){
                    if(!up.inputs.hasOwnProperty(ik)) continue;
                    var r=traceClip(up.inputs[ik]);
                    if(r) return r;
                }
            }
            return null;
        }
        var pId=traceClip(ins.positive);
        var nId=traceClip(ins.negative);
        if(pId) positiveClipIds.add(pId);
        if(nId) negativeClipIds.add(nId);
    });

    // Pass 2: rewrite node inputs
    nodeIds.forEach(function(id){
        var n=obj[id];
        var ct=n.class_type||'';
        var ins=n.inputs;
        function set(field,placeholder,label){
            if(!ins.hasOwnProperty(field)) return;
            // Skip if value is already a link (array) — that field is wired from upstream
            if(Array.isArray(ins[field])) return;
            // Skip if already a placeholder
            if(typeof ins[field]==='string'&&/^%[a-z_0-9]+%$/i.test(ins[field])) return;
            // Basic mode: skip anything outside the allowlist
            if(mode==='basic'&&!BASIC_ALLOWED[placeholder]) return;
            var before=ins[field];
            ins[field]=placeholder;
            report.push('Node '+id+' ('+ct+'): '+field+' = '+JSON.stringify(before)+' → '+placeholder+(label?'  // '+label:''));
        }

        // CLIPTextEncode — positive/negative
        if(/^CLIPTextEncode/i.test(ct)){
            if(positiveClipIds.has(id))      set('text','%prompt%','positive prompt');
            else if(negativeClipIds.has(id)) set('text','%negative_prompt%','negative prompt');
            // If we couldn't trace which is which (no KSampler), leave it alone — safer.
            return;
        }

        // KSampler family
        if(/KSampler/i.test(ct)){
            set('seed','%seed%');
            set('noise_seed','%seed%'); // KSamplerAdvanced uses noise_seed
            set('steps','%steps%');
            set('cfg','%cfg%');
            set('sampler_name','%sampler%');
            set('scheduler','%scheduler%');
            set('denoise','%denoise%');
            return;
        }

        // Checkpoint / UNET / model loaders
        if(/^CheckpointLoader/i.test(ct)){ set('ckpt_name','%model%'); return; }
        if(/^UNETLoader/i.test(ct)||/^UnetLoaderGGUF/i.test(ct)){ set('unet_name','%model%'); return; }

        // VAE loader
        if(/^VAELoader/i.test(ct)){ set('vae_name','%vae%'); return; }

        // CLIP loaders
        if(/^DualCLIPLoader/i.test(ct)){
            set('clip_name1','%clip_name1%');
            set('clip_name2','%clip_name2%');
            return;
        }
        if(/^CLIPLoader/i.test(ct)){ set('clip_name','%clip_name%'); return; }

        // CLIP skip
        if(/^CLIPSetLastLayer/i.test(ct)){
            // Comfy's stop_at_clip_layer is conventionally negative (-1 = no skip, -2 = skip 1).
            // Our %clip_skip% number is positive, but doFillWorkflow inserts it as a number;
            // since most users want to skip exactly 1-2 layers we still expose it as a
            // placeholder and let the preset's CLIP value drive it.
            set('stop_at_clip_layer','%clip_skip%');
            return;
        }

        // Latent image — width/height/batch
        if(/^Empty.*Latent/i.test(ct)||/^ModelSamplingFlux/i.test(ct)||/^EmptySD3LatentImage/i.test(ct)){
            set('width','%width%');
            set('height','%height%');
            set('batch_size','%batch_size%');
            return;
        }

        // Sampler/Scheduler selector nodes used by Custom Advanced / Flux setups
        if(/^KSamplerSelect/i.test(ct)){ set('sampler_name','%sampler%'); return; }
        if(/^BasicScheduler/i.test(ct)||/^SDTurboScheduler/i.test(ct)||/^AlignYourStepsScheduler/i.test(ct)){
            set('scheduler','%scheduler%');
            set('steps','%steps%');
            set('denoise','%denoise%');
            return;
        }
        if(/^RandomNoise/i.test(ct)){ set('noise_seed','%seed%'); return; }
        if(/^FluxGuidance/i.test(ct)){ set('guidance','%cfg%'); return; }
    });

    // Pretty-print so the textarea is readable
    return { json: JSON.stringify(obj,null,2), report: report };
}

/* ============ FILL WORKFLOW ============ */
function doFillWorkflow(tplStr,promptText,negText,preset,avatarMap,detectedChars,overrideWH,refImages){
    var sd=extension_settings.sd||{},p=preset||{};var t=typeof tplStr==='string'?tplStr:JSON.stringify(tplStr);
    function v(pv,k1,k2,def){if(pv)return pv;if(k1&&sd[k1])return sd[k1];if(k2&&sd[k2])return sd[k2];return def||'';}
    var strMap={'%prompt%':escJ(promptText),'%negative_prompt%':escJ(negText),'%model%':escJ(v(p.model,'comfy_model','model','')),'%vae%':escJ(v(p.vae,'comfy_vae','vae','')),'%vae_name%':escJ(v(p.vae,'comfy_vae','vae','')),'%sampler%':escJ(v(p.sampler,'comfy_sampler','sampler','euler')),'%scheduler%':escJ(v(p.scheduler,'comfy_scheduler','scheduler','normal')),'%clip_name%':escJ(v(p.clipName,'comfy_clip','clip','')),'%clip_name1%':escJ(p.clipName1||sd.comfy_clip1||p.clipName||sd.comfy_clip||''),'%clip_name2%':escJ(p.clipName2||sd.comfy_clip2||'')};
    strMap['%user_avatar%']=(avatarMap&&avatarMap['__user__'])||BLANK_PNG;
    var mainCharB64=BLANK_PNG;if(avatarMap){for(var nm in avatarMap){if(nm!=='__user__'&&avatarMap[nm]){mainCharB64=avatarMap[nm];break;}}}strMap['%char_avatar%']=mainCharB64;
    if(avatarMap){for(var nm2 in avatarMap){if(nm2==='__user__')continue;strMap['%avatar_'+nm2+'%']=avatarMap[nm2]||BLANK_PNG;}}
    var dc=detectedChars||[];for(var ai=0;ai<8;ai++){var ph='%avatar_'+(ai+1)+'%';var cn=dc[ai];var ab=(cn&&avatarMap&&avatarMap[cn])||BLANK_PNG;if((!cn||!avatarMap||!avatarMap[cn])&&t.indexOf(ph)>=0)console.log(L,'Slot',ph,'→ BLANK');strMap[ph]=ab;}
    /* Caller references get their own slots. A workflow that never mentions
       them is untouched — the layer is inert until somebody wires it in, which
       is the only honest default for a user-authored graph we do not own. */
    var refsW=normRefImages(refImages);
    for(var rw=0;rw<MAX_REF_IMAGES;rw++){var rph='%ref_'+(rw+1)+'%';var rimg=refsW[rw]?refsW[rw].image:null;if(!rimg&&t.indexOf(rph)>=0)console.log(L,'Slot',rph,'→ BLANK');strMap[rph]=rimg||BLANK_PNG;}
    var sceneRef=null;for(var sr=0;sr<refsW.length;sr++){if(refsW[sr].role==='scene'){sceneRef=refsW[sr].image;break;}}
    if(!sceneRef&&t.indexOf('%scene_ref%')>=0)console.log(L,'Slot %scene_ref% → BLANK');
    strMap['%scene_ref%']=sceneRef||BLANK_PNG;
    var useW=(overrideWH&&overrideWH.w)||p.width||1024,useH=(overrideWH&&overrideWH.h)||p.height||768;
    var fixedSeed=(p.seed!==undefined&&p.seed!==null&&parseInt(p.seed)>0)?parseInt(p.seed):null;
    var useBatch=(p.batchSize&&parseInt(p.batchSize)>0)?parseInt(p.batchSize):1;
    var numMap={'%width%':useW,'%height%':useH,'%seed%':fixedSeed!==null?fixedSeed:Math.floor(Math.random()*2147483647),'%steps%':(p.steps||0)||sd.comfy_steps||sd.steps||20,'%cfg%':(p.cfg||0)||sd.comfy_cfg||sd.scale||7,'%scale%':(p.cfg||0)||sd.comfy_cfg||sd.scale||7,'%denoise%':(p.denoise!==undefined&&p.denoise!==null)?p.denoise:1,'%clip_skip%':(p.clipSkip||0)||sd.comfy_clip_skip||sd.clip_skip||1,'%batch%':useBatch,'%batch_size%':useBatch};
    /* Match the template once, so a placeholder mentioned in the prompt
       cannot expand to a reference image or alter the JSON. */
    var numericKeys=Object.keys(numMap);
    var tokenKeys=Object.keys(strMap).concat(numericKeys).map(function(key){
        return key.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
    });
    var tokens=new RegExp('"('+numericKeys.join('|')+')"|('+tokenKeys.join('|')+')','g');
    t=t.replace(tokens,function(_,quoted,key){
        if(quoted)return String(numMap[quoted]);
        return Object.hasOwn(numMap,key)?String(numMap[key]):strMap[key];
    });
    try{return JSON.parse(t);}catch(e){console.error(L,'Workflow JSON error:',e.message);return null;}
}

/* ============ COMFY GENERATE ============ */
async function comfyDirect(obj,signal){var base=getComfyUrl();var qr;try{qr=await fetch(base+'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},signal:signal,body:JSON.stringify({prompt:obj})});}catch(e){return null;}if(!qr.ok){var eb;try{eb=await qr.json();}catch(x){}if(eb&&eb.error)toastr.error('ComfyUI: '+(eb.error.message||''),'',{timeOut:12000});if(eb&&eb.node_errors)Object.keys(eb.node_errors).forEach(function(nid){var ne=eb.node_errors[nid];if(ne.errors)ne.errors.forEach(function(err){toastr.error('Node '+nid+': '+(err.message||''),'ComfyUI');});});return null;}var pid=(await qr.json()).prompt_id;var dl=Date.now()+(S().generateTimeoutMs||180000);while(Date.now()<dl){if(signal.aborted)throw new DOMException('','AbortError');await new Promise(function(r){setTimeout(r,2000);});var hist;try{var hr=await fetch(base+'/history/'+pid,{signal:signal});if(!hr.ok)continue;hist=await hr.json();}catch(x){continue;}if(!hist[pid])continue;var entry=hist[pid];if(entry.status){if(entry.status.status_str==='error'){if(entry.status.messages)entry.status.messages.forEach(function(m){if(m[0]==='execution_error')toastr.error((m[1].node_type||'')+': '+(m[1].exception_message||'').substring(0,200),'ComfyUI',{timeOut:15000});});return null;}if(entry.status.completed===false)continue;}var outs=entry.outputs;if(!outs||!Object.keys(outs).length){if(entry.status&&entry.status.completed)return null;continue;}var nids=Object.keys(outs);for(var ni=0;ni<nids.length;ni++){var imgs=outs[nids[ni]]&&outs[nids[ni]].images;if(!imgs||!imgs.length)continue;try{var ir=await fetch(base+'/view?'+new URLSearchParams({filename:imgs[0].filename,subfolder:imgs[0].subfolder||'',type:imgs[0].type||'output'}).toString(),{signal:signal});if(!ir.ok)continue;return ensureValidBase64(await b2b64(await ir.blob()));}catch(e){continue;}}return null;}return null;}
async function comfyProxy(obj,signal){var resp=await fetch('/api/sd/comfy/generate',{method:'POST',headers:getRequestHeaders(),signal:signal,body:JSON.stringify({url:getComfyUrl(),prompt:obj})});if(!resp.ok)return null;var d=await resp.json();var img=d.image||(d.images&&d.images[0])||null;if(!img&&d&&d.data)img='data:image/'+(d.format||'png')+';base64,'+d.data;/* ST proxy answers {format,data} */return img?ensureValidBase64(img):null;}

function geminiAspectFromWH(w,h){
    // Pick the nearest aspect ratio Gemini understands.
    if(!w||!h)return null;
    var r=w/h;
    var cands=[['1:1',1],['3:4',0.75],['4:3',1.333],['9:16',0.5625],['16:9',1.777]];
    var best=cands[0],bd=Math.abs(r-cands[0][1]);
    for(var i=1;i<cands.length;i++){var d=Math.abs(r-cands[i][1]);if(d<bd){bd=d;best=cands[i];}}
    return best[0];
}
/* v3.22.3. Fire and forget: the caller has already given up on this picture. */
function aiBridgeInterrupt(base,pid){
    try{fetch(base+'/interrupt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt_id:pid})}).catch(function(){});}catch(e){}
}
async function geminiDirect(promptText,negText,preset,signal,overrideWH,avatarMap,detectedChars,refImages){
    // Send a minimal pseudo-workflow to gemini-bridge: the prompt sits in
    // one CLIPTextEncode node (the bridge reads it from there). The preset's own
    // workflow is NOT needed. The negative goes into a second node.
    var port=(preset.geminiPort||'7860').toString().trim()||'7860';
    var base='http://127.0.0.1:'+port;
    // Aspect ratio: when adaptive is on and sizes were computed,
    // append the ratio as text to the end of the prompt (Gemini understands it).
    var finalPrompt=String(promptText||'');
    if(preset.adaptiveAspect!==false){
        var ar=null;
        if(overrideWH&&overrideWH.w&&overrideWH.h)ar=geminiAspectFromWH(overrideWH.w,overrideWH.h);
        else if(preset.width&&preset.height)ar=geminiAspectFromWH(preset.width,preset.height);
        if(ar)finalPrompt=finalPrompt.replace(/\s+$/,'')+'\n\nAspect ratio '+ar+'.';
    }
    // Char avatars (i2i): collect avatars of the characters in this paragraph.
    // One avatar per character in detectedChars, up to the limit.
    var avatars=[],attachDesc=[];
    /* Caller-supplied references are resolved FIRST because they decide how the
       whole attachment list is described: with a mixed list the old blanket
       sentence ("…for the appearance of the characters") would be a lie about
       every non-character picture in it. Without refImages nothing below
       changes a single byte of what existing callers already send. */
    var refs=normRefImages(refImages);
    if(preset.useCharAvatar&&avatarMap){
        var maxAv=parseInt(preset.maxCharAvatars)||2;
        var dc=detectedChars||[];
        for(var ci=0;ci<dc.length&&avatars.length<maxAv;ci++){
            var nm=dc[ci];if(nm&&avatarMap[nm]){avatars.push(avatarMap[nm]);attachDesc.push(refRoleText('character',nm));}
        }
        // if no characters were detected but the option is on, take the first
        // non-user avatar as a fallback
        if(!avatars.length){for(var k in avatarMap){if(k!=='__user__'&&avatarMap[k]){avatars.push(avatarMap[k]);attachDesc.push(refRoleText('character',''));break;}}}
        if(avatars.length&&!refs.length)finalPrompt=finalPrompt.replace(/\s+$/,'')+
            '\n\nUse the attached reference image'+(avatars.length>1?'s':'')+
            ' for the appearance of the character'+(avatars.length>1?'s':'')+': '+AVATAR_KEEP+'.';
    }
    /* refImages are NOT gated by preset.useCharAvatar and do NOT spend
       maxCharAvatars: that toggle and that budget are a preference about
       AVATARS, while these are an explicit contract from the caller. */
    for(var ri=0;ri<refs.length;ri++){avatars.push(refs[ri].image);attachDesc.push(refRoleText(refs[ri].role,refs[ri].name));}
    if(refs.length&&attachDesc.length){
        var manifest=attachDesc.map(function(d,i){return(i+1)+') '+d;}).join('; ');
        finalPrompt=finalPrompt.replace(/\s+$/,'')+
            '\n\nAttached reference image'+(attachDesc.length>1?'s':'')+', in order: '+manifest+
            '. Use them as references for what things look like — do not copy their framing or composition.';
    }
    var obj={
        '1':{class_type:'CLIPTextEncode',inputs:{text:finalPrompt}},
        '2':{class_type:'CLIPTextEncode',inputs:{text:String(negText||'')}},
        '3':{class_type:'KSampler',inputs:{positive:['1',0],negative:['2',0]}}
    };
    // Speed mode: the bridge switches ITS OWN wait timeouts by it
    // (Flash draws in seconds — no point sitting through pauses meant for Pro).
    // The same mode sets our own /history polling step: on Flash a coarse
    // 2 s step alone becomes half of the response time.
    var gMode=(preset.geminiMode==='flash')?'flash':'pro';
    var pollMs=(gMode==='flash')?700:2000;
    var reqBody={prompt:obj,hires:!!preset.geminiHires,mode:gMode};
    if(avatars.length)reqBody.avatars=avatars;
    /* Image engine (v3.21): the same bridge server draws with Gemini or with
       ChatGPT, and the request names which. The field is added ONLY for
       ChatGPT, so a Gemini preset sends byte for byte what it sent before —
       and an older bridge, which does not know the field, keeps working. */
    var eng=(preset.bridgeEngine==='chatgpt')?'chatgpt':'gemini';
    var who=(eng==='chatgpt')?'ChatGPT':'Gemini';
    if(eng==='chatgpt'){reqBody.engine='chatgpt';pollMs=2000;}
    var qr;
    try{qr=await fetch(base+'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},signal:signal,body:JSON.stringify(reqBody)});}
    catch(e){toastr.error(who+' bridge unreachable on '+base,'',{timeOut:10000});return null;}
    if(!qr.ok){var eb;try{eb=await qr.json();}catch(x){}toastr.error(who+' bridge: '+((eb&&eb.error&&(eb.error.message||eb.error))||qr.status),'',{timeOut:12000});return null;}
    var pid=(await qr.json()).prompt_id;
    /* v3.22.3: a cancelled request is cancelled AT THE BRIDGE too. Polling
       used to just stop while the bridge kept the Gemini tab busy — up to three
       attempts after a refusal, 200+ s — and the next picture queued behind it.
       An older bridge answers 404; that changes nothing. */
    var told=false,tell=function(){if(told||!pid)return;told=true;aiBridgeInterrupt(base,pid);};
    if(signal.aborted)tell();else if(typeof signal.addEventListener==='function')signal.addEventListener('abort',tell,{once:true});
    var dl=Date.now()+(S().generateTimeoutMs||180000);
    while(Date.now()<dl){
        if(signal.aborted){tell();throw new DOMException('','AbortError');}
        await new Promise(function(r){setTimeout(r,pollMs);});
        var hist;try{var hr=await fetch(base+'/history/'+pid,{signal:signal});if(!hr.ok)continue;hist=await hr.json();}catch(x){continue;}
        if(!hist[pid])continue;
        var entry=hist[pid];
        if(entry.status&&entry.status.status_str==='error'){if(entry.status.messages)entry.status.messages.forEach(function(m){if(m[0]==='execution_error')toastr.error(who+': '+((m[1]&&m[1].exception_message)||'').substring(0,200),'',{timeOut:15000});});return null;}
        var outs=entry.outputs;if(!outs||!Object.keys(outs).length){if(entry.status&&entry.status.completed)return null;continue;}
        var nids=Object.keys(outs);
        for(var ni=0;ni<nids.length;ni++){var imgs=outs[nids[ni]]&&outs[nids[ni]].images;if(!imgs||!imgs.length)continue;
            try{var ir=await fetch(base+'/view?'+new URLSearchParams({filename:imgs[0].filename,subfolder:imgs[0].subfolder||'',type:imgs[0].type||'output'}).toString(),{signal:signal});if(!ir.ok)continue;return ensureValidBase64(await b2b64(await ir.blob()));}catch(e){continue;}}
        return null;
    }
    return null;
}
async function generateOneImage(promptText,negText,preset,signal,overrideWH,lorasToInject,avatarMap,detectedChars,refImages,storyboardAvatar){
    var requestedPreset=preset;
    var adventure=window.RPGAdventure;
    if(adventure&&adventure.scope()){
        var selected=adventure.comfyPreset(presets(),preset&&preset.id);
        if(!selected)return null;
        if(selected!==preset)lorasToInject=[]; // LoRAs are specific to the original model.
        preset=selected;
        promptText=adventure.imagePrompt(promptText);
    }
    // Gemini preset mode: no workflow needed, the prompt goes straight to the bridge.
    if(preset&&preset.useGemini){try{return await geminiDirect(promptText,negText,preset,signal,overrideWH,avatarMap,detectedChars,refImages);}catch(e){if(e.name==='AbortError')throw e;return null;}}
    if(!preset||!preset.workflow)return null;
    var workflow=preset.workflow;
    if(storyboardAvatar&&(preset===requestedPreset||preset.id&&preset.id===requestedPreset?.id)&&storyboardUsesCharacterAvatar(preset)){
        workflow=preset.storyboardAvatarWorkflow;
        promptText=storyboardAvatar.instruction+'\n\n'+promptText;
        refImages=[storyboardAvatar.reference];
    }
    var obj=doFillWorkflow(workflow,promptText,negText,preset,avatarMap,detectedChars,overrideWH,refImages);if(!obj)return null;
    if(lorasToInject&&lorasToInject.length)obj=injectLorasIntoWorkflow(obj,lorasToInject);
    var img=null,useDirect=S().preferDirectComfy!==false;
    if(useDirect){try{img=await comfyDirect(obj,signal);if(img)return img;}catch(e){if(e.name==='AbortError')throw e;}}
    try{img=await comfyProxy(obj,signal);if(img)return img;}catch(e){if(e.name==='AbortError')throw e;}
    if(!useDirect){try{return await comfyDirect(obj,signal);}catch(e){if(e.name==='AbortError')throw e;}}
    return null;
}

/* ============ RENDERING ============ */
function illHtml(sec,i){if(!sec.image)return'';var src=aiImgSrc(sec.image);var cap=esc(sec.imagePrompt||'');var hp=S().hidePrompts?' ai-hide-caption':'';return'<div class="ai-illustration-wrapper'+hp+'" data-ai-sec="'+i+'"><img class="ai-illustration-img" src="'+src+'" title="Click to enlarge" loading="lazy"/><div class="ai-illustration-caption" title="'+cap+'">🖼️ '+cap+'</div></div>';}
function renderIll(mi){var ctx=getContext(),msg=ctx.chat[mi];if(!msg)return;var data=msg.extra&&msg.extra.autoIllustrator;if(!data||!data.sections)return;var mel=$('#chat .mes[mesid="'+mi+'"]');if(!mel.length)return;var txt=mel.find('.mes_text');if(!txt.length)return;txt.find('.ai-illustration-wrapper').remove();var blocks=txt.children(':not(.ai-illustration-wrapper)').toArray();if(!blocks.length){var raw=txt.html();if(raw&&raw.trim()){txt.html('<div>'+raw+'</div>');renderIll(mi);return;}return;}var withImg=data.sections.filter(function(s){return!!s.image;});if(!withImg.length)return;var pts=[],ok=true,si,bi;for(si=0;si<data.sections.length;si++){if(!data.sections[si].image)continue;if(si<data.sections.length-1){var nx=(data.sections[si+1].text||'').trim().substring(0,50).replace(/\s+/g,' ').toLowerCase();var found=false;for(bi=0;bi<blocks.length;bi++){if(nx&&$(blocks[bi]).text().replace(/\s+/g,' ').toLowerCase().indexOf(nx.substring(0,30))>=0){pts.push({si:si,bi:Math.max(0,bi-1)});found=true;break;}}if(!found){ok=false;break;}}else pts.push({si:si,bi:blocks.length-1});}if(!ok||pts.length!==withImg.length){pts=[];var iv=Math.max(1,Math.floor(blocks.length/withImg.length));var idx=0;for(si=0;si<data.sections.length;si++){if(!data.sections[si].image)continue;pts.push({si:si,bi:Math.min((idx+1)*iv-1,blocks.length-1)});idx++;}}pts.sort(function(a,b){return b.bi-a.bi;});pts.forEach(function(p){var h=illHtml(data.sections[p.si],p.si);if(h)$(blocks[p.bi]).after(h);});}
function reRenderAll(){var ctx=getContext();if(!ctx.chat)return;setTimeout(function(){for(var i=0;i<ctx.chat.length;i++){if(!ctx.chat[i]||!ctx.chat[i].extra||!ctx.chat[i].extra.autoIllustrator)continue;if(ctx.chat[i].extra.autoIllustrator.sections)renderIll(i);if(ctx.chat[i].extra.autoIllustrator.vnChunks&&ctx.chat[i].extra.autoIllustrator.vnChunks.length)renderVnIllustrations(i);}injectMsgButtons();},600);}
function checkMissing(){var ctx=getContext();if(!ctx.chat)return;for(var i=0;i<ctx.chat.length;i++){var m=ctx.chat[i];if(!m||!m.extra||!m.extra.autoIllustrator)continue;var ai=m.extra.autoIllustrator;var hasSecImg=ai.sections&&ai.sections.some(function(s){return!!s.image;});var hasVnImg=ai.vnChunks&&ai.vnChunks.length;if(!hasSecImg&&!hasVnImg)continue;var mel=$('#chat .mes[mesid="'+i+'"]');if(!mel.length)continue;if(mel.find('.mes_text .ai-illustration-wrapper').length===0){if(hasSecImg)renderIll(i);if(hasVnImg)renderVnIllustrations(i);}}}

/* Resolve any stored image reference to something an <img src> can use:
   a data: URL as-is, an http(s) URL or a server path (/user/images/…) as-is,
   and a bare base64 blob gets the jpeg data: prefix it was saved without. */
function aiImgSrc(v){
    v=String(v||'');
    if(!v)return'';
    if(v.indexOf('data:')===0)return v;
    if(/^https?:\/\//i.test(v))return v;
    /* CAREFUL: base64 JPEG always starts with '/9j/' (FF D8 FF encoded), so a
       leading slash alone means nothing. A server path is only recognised by a
       real image-file extension (e.g. /user/images/…/hook.jpeg). */
    if(v.charAt(0)==='/'&&/\.(png|jpe?g|webp|gif|avif|bmp)(\?.*)?$/i.test(v))return v;
    return'data:image/jpeg;base64,'+v;
}

/* ═══ CHARACTER GALLERY MIRROR (v3.8) ═══
   Illustrations live inside the chat file (msg.extra) — invisible to ST's own
   gallery and to Character Library's Gallery tab, both of which read the
   server folder user/images/<folder>. When saveToGallery is on, every
   generated image is also uploaded there, fire-and-forget: a failed upload
   never blocks or fails the illustration itself.
   Folder resolution mirrors ST's gallery (and Character Library):
   extension_settings.gallery.folders[avatar] override, else the char name. */
function aiGalleryFolder(){
    try{
        var ctx=getContext();
        var chId=ctx.characterId;
        if(chId===undefined||chId===null||!ctx.characters||!ctx.characters[chId])return null; /* group chat / no char */
        var ch=ctx.characters[chId];
        var g=extension_settings.gallery;
        return (g&&g.folders&&g.folders[ch.avatar])||ch.name||null;
    }catch(e){return null;}
}

function aiMirrorToGallery(b64,label){
    try{
        if(!S().saveToGallery)return;
        if(!b64||String(b64).indexOf('data:')===0&&b64.length<100)return;
        var folder=aiGalleryFolder();
        if(!folder)return;
        var raw=String(b64);
        if(raw.indexOf('data:')===0)raw=raw.split(',')[1]||'';
        if(!raw)return;
        var slug=String(label||'illustration').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'illustration';
        fetch('/api/images/upload',{
            method:'POST',headers:getRequestHeaders(),
            body:JSON.stringify({image:raw,format:'jpeg',ch_name:folder,filename:'ai-'+slug+'-'+Date.now()})
        }).then(function(r){if(!r.ok)console.warn(L,'gallery mirror HTTP',r.status);})
          .catch(function(e){console.warn(L,'gallery mirror:',e.message);});
    }catch(e){console.warn(L,'gallery mirror:',e.message);}
}

/* ============ GALLERY + DELETION ============ */
function galImages(){
    var ctx=getContext(),a=[];if(!ctx.chat)return a;
    for(var i=0;i<ctx.chat.length;i++){
        var d=ctx.chat[i].extra&&ctx.chat[i].extra.autoIllustrator;
        if(!d)continue;
        if(d.sections)for(var si=0;si<d.sections.length;si++)
            if(d.sections[si].image)a.push({kind:'sec',mi:i,si:si,prompt:d.sections[si].imagePrompt||'',image:d.sections[si].image});
        if(d.vnChunks)for(var vi=0;vi<d.vnChunks.length;vi++)
            if(d.vnChunks[vi].image)a.push({kind:'vn',mi:i,si:vi,prompt:d.vnChunks[vi].imagePrompt||'',image:d.vnChunks[vi].image});
    }return a;
}

function deleteOneImage(mi,si,kind){
    var ctx=getContext(),msg=ctx.chat[mi];
    if(!msg||!msg.extra||!msg.extra.autoIllustrator)return false;
    var data=msg.extra.autoIllustrator;
    if(kind==='vn'){
        if(!data.vnChunks||!data.vnChunks[si])return false;
        var rec=data.vnChunks.splice(si,1)[0];
        $('#chat .mes[mesid="'+mi+'"] .mes_text .ai-illustration-wrapper[data-vn-chunk="'+rec.chunkIndex+'"]').remove();
    }else{
        if(!data.sections||!data.sections[si])return false;
        // Clear image data from this section
        data.sections[si].image=null;
        data.sections[si].imagePrompt='';
        data.sections[si].finalPrompt='';
    }
    // If no images remain anywhere, clean up entirely
    var hasSec=data.sections&&data.sections.some(function(s){return!!s.image;});
    var hasVn=data.vnChunks&&data.vnChunks.length>0;
    if(!hasSec&&!hasVn){
        delete msg.extra.autoIllustrator;
        $('#chat .mes[mesid="'+mi+'"] .mes_text .ai-illustration-wrapper').remove();
    }else if(kind!=='vn'){
        renderIll(mi);
    }
    ctx.saveChat();
    updateGalBadge();
    console.log(L,'Deleted image: msg',mi,kind==='vn'?'vn':'sec',si);
    return true;
}

function deleteAllImages(){
    var ctx=getContext();if(!ctx.chat)return 0;
    var count=0;
    for(var i=0;i<ctx.chat.length;i++){
        if(ctx.chat[i].extra&&ctx.chat[i].extra.autoIllustrator){
            delete ctx.chat[i].extra.autoIllustrator;
            $('#chat .mes[mesid="'+i+'"] .mes_text .ai-illustration-wrapper').remove();
            count++;
        }
    }
    ctx.saveChat();
    updateGalBadge();
    console.log(L,'Deleted all images from',count,'messages');
    return count;
}

function openGallery(){
    $('#ai_gallery_overlay').remove(); // prevent duplicates
    var imgs=galImages();
    var grid='';
    if(!imgs.length){
        grid='<div style="text-align:center;padding:60px 20px;color:#666;font-size:1.1em">No images yet.</div>';
    }else{
        for(var i=0;i<imgs.length;i++){
            var src=aiImgSrc(imgs[i].image);
            grid+='<div class="ai-gal-item" data-idx="'+i+'" data-mi="'+imgs[i].mi+'" data-si="'+imgs[i].si+'" data-kind="'+(imgs[i].kind||'sec')+'" title="'+esc(imgs[i].prompt)+'">'+
                '<div class="ai-gal-item-delete" data-idx="'+i+'" title="Delete this image">✕</div>'+
                '<img src="'+src+'" loading="lazy"/>'+
                '<div class="ai-gal-label">'+(imgs[i].kind==='vn'?'VN · ':'')+'Msg '+(imgs[i].mi+1)+'</div>'+
                '</div>';
        }
    }

    var ov=$('<div id="ai_gallery_overlay">'+
        '<div class="ai-gal-header">'+
            '<span>🖼️ Gallery</span>'+
            '<span class="ai-gal-count">'+imgs.length+'</span>'+
            '<span class="ai-gal-spacer"></span>'+
            (imgs.length?'<span class="ai-gal-clear-all">🗑️ Clear All</span>':'')+
            '<span class="ai-gal-close">✕</span>'+
        '</div>'+
        '<div class="ai-gal-grid">'+grid+'</div>'+
    '</div>');

    $('body').append(ov);

    // Close
    ov.find('.ai-gal-close').on('click',function(){ov.remove();});

    // Click image → lightbox
    ov.find('.ai-gal-item').on('click',function(e){
        // Don't open lightbox if delete button was clicked
        if($(e.target).hasClass('ai-gal-item-delete'))return;
        var idx=parseInt($(this).data('idx')),img=imgs[idx];if(!img)return;
        var s2=aiImgSrc(img.image);
        var lb=$('<div class="ai-lightbox-overlay"><div class="ai-lightbox-close">✕</div><div class="ai-lightbox-info">'+esc(img.prompt)+'</div><img src="'+s2+'"/></div>');
        $('body').append(lb);lb.on('click',function(){lb.remove();});
    });

    // Delete single image
    ov.find('.ai-gal-item-delete').on('click',function(e){
        e.stopPropagation();
        var idx=parseInt($(this).data('idx'));
        var img=imgs[idx];if(!img)return;
        deleteOneImage(img.mi,img.si,img.kind);
        // Refresh gallery
        openGallery();
        toastr.info('Image deleted.');
    });

    // Clear All — with confirmation
    ov.find('.ai-gal-clear-all').on('click',function(){
        // Show inline confirmation
        var existing=ov.find('.ai-gal-confirm');
        if(existing.length){existing.remove();return;}
        var confirm=$('<div class="ai-gal-confirm">'+
            '<div class="ai-gal-confirm-text">🗑️ Delete ALL '+imgs.length+' images?</div>'+
            '<div class="ai-gal-confirm-sub">This removes images from all messages. Cannot be undone.</div>'+
            '<div class="ai-gal-confirm-btns">'+
                '<span class="ai-gal-confirm-yes">Yes, delete all</span>'+
                '<span class="ai-gal-confirm-no">Cancel</span>'+
            '</div>'+
        '</div>');
        ov.append(confirm);
        confirm.find('.ai-gal-confirm-no').on('click',function(){confirm.remove();});
        confirm.find('.ai-gal-confirm-yes').on('click',function(){
            var n=deleteAllImages();
            ov.remove();
            toastr.success(n+' message(s) cleared.');
        });
    });
}

function updateGalBadge(){var n=galImages().length;var b=$('#ai_gallery_float_btn .ai-gal-badge');b.text(n||'');n>0?b.show():b.hide();}
function applyGalPos(){var btn=$('#ai_gallery_float_btn');if(!btn.length)return;var pos=POSITIONS[S().galleryPosition]||POSITIONS['mid-right'];btn.attr('style','position:fixed;z-index:9990;width:42px;height:42px;border-radius:50%;background:var(--SmartThemeBlurTintColor,rgba(30,30,30,0.7));border:1px solid rgba(255,255,255,0.15);color:#fff;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.3);'+pos.css);}
function toggleGalBtn(){if(S().showGalleryButton){if(!$('#ai_gallery_float_btn').length){$('body').append('<div id="ai_gallery_float_btn" title="Gallery">🖼️<span class="ai-gal-badge" style="display:none;position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;display:flex;align-items:center;justify-content:center;"></span></div>');$('#ai_gallery_float_btn').on('click',openGallery);}applyGalPos();$('#ai_gallery_float_btn').show();updateGalBadge();}else $('#ai_gallery_float_btn').hide();}

/* ============ INDICATORS + MSG BTN ============ */
function showInd(mi,text){var el=$('#chat .mes[mesid="'+mi+'"]');if(!el.length)return;var ind=el.find('.ai-processing-indicator');if(!ind.length){ind=$('<div class="ai-processing-indicator"></div>');el.find('.mes_text').after(ind);}ind.html('<span class="ai-spinner"></span><span>'+esc(text)+'</span><span class="ai-cancel-btn" data-ai-cancel="'+mi+'">Cancel</span>').show();el.find('.ai-msg-btn').addClass('ai-generating');}
function hideInd(mi){$('#chat .mes[mesid="'+mi+'"] .ai-processing-indicator').remove();$('#chat .mes[mesid="'+mi+'"] .ai-msg-btn').removeClass('ai-generating');}
function injectMsgBtnCSS(){if($('#ai-msg-btn-css').length)return;$('head').append('<style id="ai-msg-btn-css">.mes .ai-msg-btn{position:absolute;width:28px;height:28px;border-radius:50%;background:var(--SmartThemeBlurTintColor,rgba(50,50,50,0.5));border:1px solid rgba(255,255,255,0.12);color:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s,transform 0.15s;z-index:15;}.mes:hover .ai-msg-btn{opacity:0.5;}.mes .ai-msg-btn:hover{opacity:1!important;background:var(--SmartThemeQuoteColor,#6366f1);transform:scale(1.15);}.mes .ai-msg-btn.ai-generating{opacity:1!important;background:#f59e0b;animation:ai-btn-pulse 1.5s infinite;}@keyframes ai-btn-pulse{0%,100%{opacity:.7}50%{opacity:1}}</style>');}
function getMsgBtnCSS(){return(MSG_POSITIONS[S().msgBtnPosition]||MSG_POSITIONS['bottom-right']).css;}
function injectMsgButtons(){if(!S().enabled){$('.ai-msg-btn').remove();return;}var ctx=getContext();if(!ctx.chat)return;var css=getMsgBtnCSS();$('#chat .mes').each(function(){var mel=$(this),mi=parseInt(mel.attr('mesid'));if(isNaN(mi))return;var msg=ctx.chat[mi];if(!msg||msg.is_user||msg.is_system)return;if(mel.css('position')==='static')mel.css('position','relative');var ex=mel.find('.ai-msg-btn');if(ex.length){ex.attr('style',css);return;}mel.append('<div class="ai-msg-btn" data-mi="'+mi+'" title="🎨 Illustrate" style="'+css+'">🎨</div>');});}
function refreshMsgBtnPos(){$('.ai-msg-btn').each(function(){$(this).attr('style',getMsgBtnCSS());});}

/* ============ PIPELINE ============
 * illustrateText() is the whole engine: text in → illustrated sections out.
 * It knows nothing about chats, messages or the DOM, so it can be driven by a
 * chat message (processMessage), by a slash command, or by another extension
 * through window.AutoIllustrator. processMessage() is now only the plumbing:
 * guards, the in-message indicator, msg.extra persistence and rendering.
 * ================================================================ */

async function illustrateText(opts){
    opts=opts||{};
    var s=S();
    var text=String(opts.text||'');
    if(!text.trim())throw new Error('Nothing to illustrate — the text is empty.');

    var preset=opts.preset||(opts.presetId?presets().find(function(p){return p.id===opts.presetId;}):activePreset());
    if(!preset||(!preset.workflow&&!preset.useGemini))throw new Error('No usable preset (needs a workflow or Gemini).');

    var n=Math.max(1,Math.min(10,parseInt(opts.count)||1));
    var signal=opts.signal||new AbortController().signal;
    var timeoutMs=opts.timeoutMs||s.generateTimeoutMs;
    var compress=opts.compress!==undefined?!!opts.compress:!!s.compressImages;
    var onStatus=typeof opts.onStatus==='function'?opts.onStatus:function(){};
    var onPart=typeof opts.onPart==='function'?opts.onPart:function(){};

    /* An explicit caller size (another extension's asset contract, e.g. a wide
       1280x512 battlefield ground) outranks the preset dimensions AND the
       adaptive person-count pass — otherwise the caller's aspect silently
       becomes whatever portrait the preset was tuned for. Snapped to /64 the
       same way adaptDimensions() snaps, since most backends require it. */
    var reqW=parseInt(opts.width)||0,reqH=parseInt(opts.height)||0;
    var callerWH=(reqW>0&&reqH>0)?{w:Math.max(256,Math.round(reqW/64)*64),h:Math.max(256,Math.round(reqH/64)*64)}:null;

    /* Character routing: the caller may name the character explicitly (a card
       browsed in another extension), otherwise we fall back to the open chat. */
    var routingEnabled=!!preset.enableCharRouting;
    var charName=opts.charName||'';
    if(routingEnabled&&!charName){
        try{var chId=getContext().characterId;var cx=getContext();
            charName=(chId!==undefined&&cx.characters&&cx.characters[chId])?(cx.characters[chId].name||cx.name2||''):(cx.name2||'');
        }catch(e){}
    }
    if(routingEnabled&&!charName)routingEnabled=false;

    var charPreset=null;
    if(routingEnabled&&preset.charPresetId){
        charPreset=presets().find(function(p){return p.id===preset.charPresetId;});
        if(!charPreset||!charPreset.workflow)charPreset=null;
    }

    var adaptive=preset.adaptiveAspect!==false;
    var useCharDesc=preset.useCharDescription!==false;
    var charDesc=opts.charDescriptions||(useCharDesc?getCharacterDescriptions():{});
    var charNames=opts.charNames||getAvailableCharNames();
    var pov=isPOVFormat(preset.promptFormat);

    onStatus('Loading avatars…');
    var avatarMap=opts.avatarMap||await collectAllAvatars();
    /* Normalised once, here, so every backend sees the same list and the cap
       is one rule instead of two. */
    var refImages=normRefImages(opts.refImages);

    onStatus('Analyzing…');
    var loraEnabled=!!preset.enableLoraMatching;
    var loraEntries=loraEnabled?promptableLoraEntries(preset):[];
    if(loraEnabled&&!loraEntries.length)loraEnabled=false;

    /* skipAnalysis: the caller ALREADY has an image prompt and does not want it
       rewritten. The analysis pass is an LLM round-trip per call, so a caller
       drawing a set of pictures (a card deck, a tileset) otherwise pays for one
       language-model call per image and waits for it before the image backend
       even starts. With this flag the text IS the prompt: no LLM, straight to
       the backend. Everything else — preset, LoRAs, dimensions, avatars — works
       exactly as before. */
    var secs;
    if(opts.skipAnalysis){
        var pc=parseInt(opts.personCount);
        secs=[{text:text,image_prompt:text,person_count:isFinite(pc)?pc:1,characters:opts.charNames||[],has_char:!!opts.hasChar,loras:[]}];
    }else{
        secs=await analyseMessage(text,n,preset.promptFormat,preset.customInstructions,charName,routingEnabled,adaptive,loraEnabled?loraEntries:null,preset.maxLorasPerImage||2,useCharDesc?charDesc:null,charNames,preset.loraWeightStep||0);
    }
    if(signal.aborted)throw new DOMException('','AbortError');
    if(!secs||!secs.length)throw new Error('The LLM could not split the text.');

    var parts=[];
    for(var i=0;i<secs.length;i++){
        if(signal.aborted)throw new DOMException('','AbortError');

        var usePreset=preset,routeLabel='default';
        if(routingEnabled&&charPreset&&secs[i].has_char){usePreset=charPreset;routeLabel='CHAR';}

        var fmt=FORMATS[usePreset.promptFormat]||FORMATS.flux;
        var neg=usePreset.negativePrompt||fmt.neg||'';

        var pc=parseInt(secs[i].person_count)||0;
        var overrideWH=callerWH||(adaptive?adaptDimensions(usePreset.width,usePreset.height,pc):null);

        var detectedChars=secs[i].characters||[];
        var finalPrompt=secs[i].image_prompt;
        if(usePreset.promptPrefix&&usePreset.promptPrefix.trim())finalPrompt=usePreset.promptPrefix.trim()+', '+finalPrompt;

        /* IMPORTANT: resolve against the library the LLM actually saw in its
           prompt (IDs L1..Ln index into it) — not the routed preset's library. */
        var usedLoraLib=loraEnabled?loraEntries:[];
        var resolved=usedLoraLib.length?resolveLoraSelection(secs[i].loras||[],usedLoraLib,usePreset.maxLorasPerImage||preset.maxLorasPerImage||2,preset.loraWeightStep||0):[];
        var merged=mergeAlwaysOnLoras(resolved,usePreset.alwaysOnLoras);
        var lorasToInject=merged.loras,triggerWords=merged.triggers;
        if(triggerWords.length)finalPrompt+=', '+triggerWords.join(', ');

        var sp=[];
        if(pov)sp.push('POV');
        if(callerWH)sp.push(callerWH.w+'x'+callerWH.h);
        else if(adaptive&&overrideWH)sp.push(pc+'p');
        if(routingEnabled)sp.push(routeLabel);
        if(detectedChars.length)sp.push(detectedChars.join('+'));
        if(refImages.length)sp.push(refImages.length+'ref');
        if(lorasToInject.length)sp.push(lorasToInject.length+'LoRA');
        onStatus('Image '+(i+1)+'/'+secs.length+(sp.length?' ['+sp.join('|')+']':'')+'…');

        var img=null;
        try{
            img=await Promise.race([
                generateOneImage(finalPrompt,neg,usePreset,signal,overrideWH,lorasToInject,avatarMap,detectedChars,refImages),
                new Promise(function(_,r){setTimeout(function(){r(new Error('Timeout'));},timeoutMs);})
            ]);
        }catch(e){if(e.name==='AbortError')throw e;}

        if(img&&compress)try{img=await compressImage(img,s.maxStoredImageWidth,s.compressionQuality);}catch(e){}
        if(img&&opts.mirrorToGallery!==false)aiMirrorToGallery(img,secs[i].image_prompt);

        parts.push({text:secs[i].text,imagePrompt:secs[i].image_prompt,finalPrompt:finalPrompt,image:img,hasChar:!!secs[i].has_char,personCount:pc,characters:detectedChars,loras:lorasToInject.map(function(l){return l.file;}),presetUsed:usePreset.name,pov:pov});
        onPart(parts,i,secs.length);
    }
    return{parts:parts,pov:pov,preset:preset,total:secs.length};
}

/* ============ STORYBOARD (v3.14, reworked v3.18) ============
 * One sheet, N panels in a strict grid — for llm-tools VN Mode, which shows
 * one panel per reading chunk by CSS-cropping the sheet. Inert: nothing
 * inside this extension calls the door.
 * Any preset with a backend may draw the sheet (v3.18): holding a strict
 * grid takes an instruction-following model — Gemini, or an API model driven
 * from inside a ComfyUI workflow — and a backend that cannot simply fails
 * the grid analysis, which the caller survives by showing the sheet whole.
 * generateOneImage() is called directly (NOT illustrateText): the storyboard
 * is ONE image from ONE already-built prompt, and a null from the backend
 * must become a thrown failure here, not a silently skipped section.
 */

/* Only full rectangles — a partly empty grid tempts the model to fill the
   hole with a bonus panel and every crop after it is off by one. */
var STORYBOARD_GRIDS={1:[1,1],2:[1,2],3:[1,3],4:[2,2],6:[2,3],8:[2,4],9:[3,3],12:[3,4]};

function presetWritesStoryboard(preset){
    return !!(!preset.useGemini&&preset.workflow&&String(preset.storyboardInstructions||'').trim());
}

function presetStoryboardGrid(preset){
    if(!presetWritesStoryboard(preset))return null;
    var layout=/^([1-4])\s*[x×]\s*([1-4])$/i.exec(String(preset.storyboardLayout||'').trim());
    if(!layout||!STORYBOARD_GRIDS[layout[1]*layout[2]])return null;
    return [Number(layout[1]),Number(layout[2])];
}

/* Auto pages cover every count through 12. A short row still uses the full
   sheet width so the model has no empty slots to interpret as extra panels. */
var STORYBOARD_AUTO_PORTRAIT=[null,[1],[1,1],[1,1,1],[2,2],[2,2,1],[2,2,2],[2,2,2,1],[2,2,2,2],[3,3,3],[3,3,2,2],[3,3,3,2],[3,3,3,3]];
var STORYBOARD_AUTO_LANDSCAPE=[null,[1],[2],[3],[2,2],[3,2],[3,3],[4,3],[4,4],[3,3,3],[4,3,3],[4,4,3],[4,4,4]];

/* `lettering` (v3.24.2): only the LLM-written path may letter a page — its
   storyboard instructions decide whether there are captions at all. The plain
   path (Gemini) forbids text, and "keep artwork AND LETTERING inside the
   panels" read to the model as permission: fed raw story prose as panel
   descriptions, it lettered the narration as captions under the rows and the
   spoken lines as speech bubbles. */
function autoStoryboardLayoutText(rowPanels,n,lettering){
    var keep=lettering?'Keep artwork and lettering inside the':'Keep the artwork inside the';
    if(n===1)return 'Exactly one full-page rectangular panel with a thin black frame. '+keep+' panel. No inset panels, dividing lines, page title, or panel number.';
    var firstRowCount=rowPanels[0];
    var uniform=rowPanels.every(function(count){return count===firstRowCount;});
    var rowDescription=rowPanels.length+' horizontal '+(rowPanels.length===1?'row':'rows');
    if(uniform)rowDescription+=', with exactly '+firstRowCount+' '+(firstRowCount===1?'panel':'panels')+' in each row';
    return 'Exactly '+n+' rectangular panels in '+rowDescription+
        '. Panel counts per row, from top to bottom: '+rowPanels.join(', ')+
        '. Each row has the same height and spans the full page width. Divide each row evenly into its specified number of panels. Draw one frame per assigned shot, in order from left to right and top to bottom. Never merge, split, add or omit panels. A thin black frame surrounds each panel. Clean white gutters separate the rows and the panels within each row. '+keep+' assigned panels. No inset panels, overlapping frames, page title, or panel numbers.';
}

function storyboardUsesRefImages(preset){
    return !!(preset.useGemini||/%(?:ref_[1-4]|scene_ref)%/.test(preset.workflow||''));
}

function storyboardUsesCharacterAvatar(preset){
    return presetWritesStoryboard(preset)&&(preset.storyboardAvatarWorkflow||'').includes('%ref_1%');
}

async function storyboardAvatarCandidates(){
    var ctx=getContext();
    var cards=ctx.characters||[];
    var active=cards[ctx.characterId];
    var group=ctx.groupId==null?null:(ctx.groups||[]).find(function(g){return String(g.id)===String(ctx.groupId);});
    var members=group?(group.members||[]).map(function(member){
        var exact=cards.find(function(card){return card&&card.avatar===member;});
        if(exact)return exact;
        var named=cards.filter(function(card){return card&&card.name===member;});
        return named.length===1?named[0]:null;
    }):[active];
    var seen=new Set(),candidates=[];
    members.forEach(function(card){
        if(!card?.name||!card.avatar||card.avatar==='none'||seen.has(card.avatar))return;
        seen.add(card.avatar);
        candidates.push({id:'C'+(candidates.length+1),name:card.name,file:card.avatar,type:'char'});
    });
    var persona=await userAvatarFile();
    if(persona&&ctx.name1)candidates.push({id:'P',name:ctx.name1,file:persona,type:'user'});
    return candidates;
}

function storyboardSpeakerId(candidates,speaker){
    if(!speaker)return null;
    var exact=speaker.avatar&&candidates.find(function(c){return c.type==='char'&&c.file===speaker.avatar;});
    if(exact)return exact.id;
    var named=candidates.filter(function(c){return c.type==='char'&&c.name===speaker.name;});
    return named.length===1?named[0].id:null;
}

var STORYBOARD_AVATAR_INSTRUCTIONS=
    'When avatarCandidates is present, also return avatar as null or as {"id":"C1","panels":[1,3]} using an actual candidate ID and the one-based panel numbers where that person is visibly present. Choose at most one person, favoring the main visible subject and shots where a likeness is recognizable. An off-screen voice, a mention, a name shared by a location, or a point-of-view shot that only shows the surroundings calls for avatar: null unless another candidate is visibly present. Use sourceSpeaker only to resolve first-person narration. The portrait supplies the selected person’s facial features and hair. Describe their on-page clothes, actions and framing from the excerpts. Each panel description must stand on its own and include the visible subjects and scene details it needs.';

async function resolveStoryboardAvatar(selection,candidates,count,signal){
    if(!selection||!Array.isArray(selection.panels))return null;
    var candidate=candidates.find(function(c){return c.id===selection.id;});
    var panels=Array.from(new Set(selection.panels.filter(function(n){return Number.isInteger(n)&&n>=1&&n<=count;}))).sort(function(a,b){return a-b;});
    if(!candidate||!panels.length)return null;
    var image=await fetchAvatarBase64(candidate.file,candidate.type);
    signal.throwIfAborted();
    if(!image)return null;
    return {
        reference:{image:image,role:'character',name:candidate.name},
        panels:panels,
        instruction:'Use the attached portrait as the likeness of '+JSON.stringify(candidate.name)+
            ' in the single new shot below. Match the face, hair, and distinguishing features. Draw the new pose, costume, setting, and camera angle described below.',
    };
}

async function writeStoryboardPrompt(panels,rows,cols,preset,opts,signal,rowPanels){
    signal.throwIfAborted();
    var groups=opts.panelSourceGroups;
    var excerpts=[];
    panels.forEach(function(text,i){
        var prev=excerpts[excerpts.length-1];
        if(groups&&i>0&&groups[i]===groups[i-1]&&text===panels[i-1]){
            prev.lastPanel=i+1;
        }else{
            excerpts.push({firstPanel:i+1,lastPanel:i+1,text:text});
        }
    });
    var layoutSpec={rows:rows,columns:cols,panelCount:panels.length};
    if(rowPanels)layoutSpec.rowPanelCounts=rowPanels;
    var input={
        layout:layoutSpec,
        style:preset.promptPrefix||'',
        previousContinuity:String(opts.previousContinuity||'').slice(0,1000),
        excerpts:excerpts,
    };
    var candidates=storyboardUsesCharacterAvatar(preset)?await storyboardAvatarCandidates():[];
    signal.throwIfAborted();
    if(candidates.length){
        input.avatarCandidates=candidates.map(function(c){return{id:c.id,name:c.name,role:c.type==='user'?'player persona':'character card'};});
        input.sourceSpeaker=storyboardSpeakerId(candidates,opts.speaker);
    }
    var raw=await generateRaw({
        systemPrompt:preset.storyboardInstructions+(candidates.length?'\n\n'+STORYBOARD_AVATAR_INSTRUCTIONS:''),
        prompt:JSON.stringify(input),
        responseLength:1800,
        trimNames:false,
    });
    signal.throwIfAborted();
    var result=extractJSON(raw);
    if(!result||typeof result.continuity!=='string'||!result.continuity.trim()
        ||!Array.isArray(result.panels)||result.panels.length!==panels.length
        ||result.panels.some(function(p){return typeof p!=='string'||!p.trim();})){
        throw new Error('The SillyTavern LLM must return continuity and exactly '+panels.length+' panel descriptions.');
    }
    var continuity=result.continuity.replace(/\s+/g,' ').trim().slice(0,1000);
    var layout=rowPanels?autoStoryboardLayoutText(rowPanels,panels.length,true):'Exactly '+panels.length+' equal rectangular panels in '+rows+' rows of '+cols+
        '. Read left to right, top to bottom. A thin black frame surrounds each panel. Straight, uninterrupted white gutters separate the panels. Keep panels and lettering inside their assigned cells. No inset panels, overlapping frames, page title, or panel numbers.';
    var shots=result.panels.map(function(p){return p.replace(/\s+/g,' ').trim();});
    var numberedShots=shots.map(function(p,i){return 'Panel '+(i+1)+': '+p;});
    var prompt=[String(preset.promptPrefix||'').trim(),layout,'Visual continuity: '+continuity,numberedShots.join('\n')].filter(Boolean).join('\n\n');
    var avatar=candidates.length?await resolveStoryboardAvatar(result.avatar,candidates,panels.length,signal):null;
    return {prompt:prompt,continuity:continuity,avatar:avatar,shots:shots};
}

/* Give each selected shot the reference independently, then lay the finished
   frames out in the requested grid. An edit model can repeat before/after
   variations when asked to create a multi-panel page in one pass. */
async function renderStoryboardFrames(draft,preset,neg,signal,overrideWH,rowPanels,rows,cols,onStatus){
    var w=overrideWH.w,h=overrideWH.h;
    var canvas=document.createElement('canvas');
    canvas.width=w;
    canvas.height=h;
    var ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,w,h);
    var gutter=Math.max(3,Math.round(Math.min(w,h)*0.005));
    var panels=[],index=0;
    var counts=rowPanels||Array(rows).fill(cols);
    var frameNegative=[neg,'collage, contact sheet, diptych, split screen, multiple panels'].filter(Boolean).join(', ');
    for(var r=0;r<counts.length;r++){
        for(var c=0;c<counts[r];c++){
            signal.throwIfAborted();
            var x=Math.round(c*w/counts[r])+gutter;
            var y=Math.round(r*h/rows)+gutter;
            var fw=Math.round((c+1)*w/counts[r])-x-gutter;
            var fh=Math.round((r+1)*h/rows)-y-gutter;
            var shotSize={w:Math.max(256,Math.round((fw-4)/64)*64),h:Math.max(256,Math.round((fh-4)/64)*64)};
            var avatar=draft.avatar.panels.includes(index+1)?draft.avatar:null;
            var prompt=[
                'A single full-bleed image of one shot. Keep only the people and objects specified for this shot. No contact sheet, collage, inset, title, or captions other than those requested.',
                preset.promptPrefix,
                avatar?'Continuity for subjects present in this shot: '+draft.continuity:'',
                draft.shots[index],
            ].filter(Boolean).join('\n\n');
            onStatus('Storyboard frame '+(index+1)+'/'+draft.shots.length+(avatar?' [avatar]':'')+'…');
            var frame=await generateOneImage(prompt,frameNegative,preset,signal,shotSize,null,null,[],[],avatar);
            if(!frame)throw new Error('Storyboard frame '+(index+1)+' could not be rendered.');
            var img=await new Promise(function(resolve,reject){
                var image=new Image();
                image.onload=function(){resolve(image);};
                image.onerror=function(){reject(new Error('Could not read storyboard frame '+(index+1)+'.'));};
                image.src=aiImgSrc(frame);
            });
            signal.throwIfAborted();
            var ratio=(fw-4)/(fh-4);
            var sw=Math.min(img.width,img.height*ratio),sh=Math.min(img.height,img.width/ratio);
            ctx.fillStyle='#111';
            ctx.fillRect(x,y,fw,fh);
            ctx.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,x+2,y+2,fw-4,fh-4);
            panels.push([x/w,y/h,(x+fw)/w,(y+fh)/h]);
            index++;
        }
    }
    return {image:ensureValidBase64(canvas.toDataURL('image/png')),panels:panels,verified:true,xs:sbEvenCells(cols),ys:sbEvenCells(rows)};
}

/* `style` (v3.25.0): the preset's Common Prompt Prefix. The field promises to
   start EVERY prompt of its preset, but this plain path (a Gemini preset) never
   read it — a storyboard had no style at all, so the word "storyboard" and the
   references (a drawn avatar, the previous sheet) decided it, and every sheet
   came out sketched. Said as an explicit art-style line that outranks the look
   of the attachments, or the previous sheet keeps the old style alive. */
function buildStoryboardPrompt(panels,rows,cols,rowPanels,style){
    var n=panels.length;
    style=String(style||'').replace(/\s+/g,' ').trim().replace(/[.,;\s]+$/,'');
    /* v3.25.1: never call it a "storyboard". To the model that word is a
       production template — a frame with a white description box under it —
       and with a photographic style it drew exactly that: every panel came
       back as a picture plus a strip of lettered shot notes, inside the frame,
       despite three no-text lines. The page is described as what it should
       look like, and the no-text rule leads instead of trailing. */
    var opener='One wordless image: a page of '+n+' separate pictures, each filling its own frame completely, edge to edge. '+
        'There is no text box, caption strip, notes area or blank band under, over or beside any picture — the pictures carry no writing of any kind.\n';
    var layout=rowPanels?opener+autoStoryboardLayoutText(rowPanels,n):
        opener+'Exactly '+n+' panels arranged in a strict grid of '+rows+' row'+(rows>1?'s':'')+' and '+cols+' column'+(cols>1?'s':'')+'.\n'+
        'All panels are exactly the same size. Never merge, split, add or omit panels, and never rearrange the grid: exactly '+rows+' row'+(rows>1?'s':'')+', each of exactly '+cols+' panel'+(cols>1?'s':'')+'. Panels are separated by thin, straight, uniform white gutters running edge to edge of the sheet.';
    var p=layout+'\n'+
        (style?'Art style of every panel: '+style+'. Draw in this style even where an attached reference picture is drawn in another one — take only people, clothing and places from the references, not their rendering.\n':'')+
        'One consistent art style, palette and lighting across all panels; recurring characters keep the same face, hair and clothing in every panel.\n'+
        'No text, no captions, no letters, no numbers, no logos, no speech bubbles, no outer border.\n'+
        /* v3.24.2: the panel texts are the story's own prose, quotes and all —
           say what they are, or the model letters them onto the page */
        'Each panel text below is an excerpt of the story that tells you what to DRAW. Never write its words on the page: show what is said through faces, gestures and body language, never as speech bubbles, captions, narration boxes or sound effects.\n\n'+
        'The panels, in reading order (left to right, top to bottom):\n';
    for(var i=0;i<n;i++)p+='Panel '+(i+1)+': '+String(panels[i]).replace(/\s+/g,' ').trim()+'\n';
    p+='\nPure artwork only: no lettering anywhere on the page — inside the pictures, under them or in the gutters; each frame holds only its picture.\n';
    return p;
}

/* Even cell RANGES: one [start,end] pair per cell rather than parts+1
   boundary points. A single boundary line cannot express the gutter's WIDTH,
   and a crop that lands on the middle of a white gutter shows half of it
   along the panel edge (v3.16 did exactly that). */
function sbEvenCells(n){var a=[],i;for(i=0;i<n;i++)a.push([i/n,(i+1)/n]);return a;}

/* Per-line luminance profile of one axis, restricted to a band of the other
   axis: for 'x' every column is sampled over y in [b0,b1). The band matters —
   a sheet whose rows disagree about where their columns sit (a real Gemini
   sheet did) hides every column gutter from a full-height scan, while a
   per-row scan sees them plainly. Works on the raw ImageData so the caller
   decodes the image exactly once. */
function sbLineStats(d,w,h,axis,b0,b1){
    var outer=axis==='x'?w:h;
    var step=Math.max(1,Math.floor((b1-b0)/64));
    var out=[],a,b,x,y,i,lum,sum,sum2,cnt,mean;
    for(a=0;a<outer;a++){
        sum=0;sum2=0;cnt=0;
        for(b=b0;b<b1;b+=step){
            x=axis==='x'?a:b;y=axis==='x'?b:a;
            i=(y*w+x)*4;
            lum=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
            sum+=lum;sum2+=lum*lum;cnt++;
        }
        mean=sum/cnt;
        out.push({mean:mean,sd:Math.sqrt(Math.max(0,sum2/cnt-mean*mean))});
    }
    return out;
}

/* Runs of consecutive gutter-looking lines (uniform along the line, bright),
   each carrying its PEAK line mean. The peak is what later separates a true
   gutter from the edge of something white drawn inside a panel: on real
   sheets every true gutter peaks at ~255 (one thin one at 219 after
   downscale mixing) while paper edges inside panels peak at 166–196. */
function sbBrightRuns(stats){
    var runs=[],s=-1,peak=0,x,on;
    for(x=0;x<=stats.length;x++){
        on=x<stats.length&&stats[x].sd<22&&stats[x].mean>135;
        if(on){if(s<0){s=x;peak=0;}if(stats[x].mean>peak)peak=stats[x].mean;}
        else if(s>=0){runs.push({start:s,len:x-s,peak:peak});s=-1;}
    }
    return runs;
}

/* The sheet's outer white frame (drawn often despite being asked not to):
   a narrow bright run touching an edge. Returns [lo,hi] with the frame
   excluded; an implausible trim keeps the whole span. Width is capped so a
   genuinely bright first panel is not eaten as a "frame". */
function sbTrimFrame(runs,L){
    var edgeMax=Math.max(2,L*0.06),lo=0,hi=L,r;
    for(r=0;r<runs.length;r++){
        if(runs[r].start===0&&runs[r].len<=edgeMax)lo=runs[r].len;
        if(runs[r].start+runs[r].len===L&&runs[r].len<=edgeMax)hi=L-runs[r].len;
    }
    if(hi-lo<L*0.5){lo=0;hi=L;}
    return[lo,hi];
}

/* A separator is thin relative to the CELLS it separates, so its width cap
   is derived from the smallest cell this detector will accept — at most 5
   parts per axis (see sbDetectLayout) — and a gutter is at most a third of
   one: L/5/3 ≈ L*0.06. Taking the cap as a flat fraction of the axis instead
   made it depend on WHICH WAY the sheet is read: a real 3x4 sheet with 13px
   gutters passed on the 640px axis (cap 19) and failed on the 357px one (cap
   10), so only the column cuts were found and each "panel" came out a
   full-height column with three drawn panels inside it. */
function sbCutWidthCap(L){return Math.max(3,L*0.06);}

/* Gutter CUT candidates inside [lo,hi]: thin (a wide bright region is
   content — an evenly lit sky must not pass for a gutter), white at the core
   (peak>=205, see sbBrightRuns) and clear of the trimmed edges. JPEG likes to
   shatter a thin gutter into touching fragments, so runs closer than 1% of
   the span are merged back into one candidate before any of that is judged. */
/* A CAPTION IN THE GUTTER (v3.24.1). Models letter a line of narration under
   a row, inside the white gap between rows. The text breaks that gap into two
   bright runs; the lower one alone passed for the gutter and the next row
   began with the caption of the row above. Two runs are one gutter when what
   lies between them is short and still mostly paper (every line's mean stays
   bright: dark strokes on white), and such a gutter may be twice as wide as a
   bare one — it is the text, not an evenly lit sky, that made it wide. */
function sbCaptionGap(stats,a,b,L){
    if(!stats||b-a>L*0.04)return false;
    for(var y=a;y<b;y++)if(!stats[y]||stats[y].mean<165)return false;
    return true;
}
function sbGutterCuts(runs,L,lo,hi,stats){
    var merged=[],cuts=[],i,r,prev,gap;
    for(i=0;i<runs.length;i++){
        r=runs[i];
        if(r.start<lo||r.start+r.len>hi)continue;
        prev=merged[merged.length-1];
        gap=prev?r.start-(prev.start+prev.len):0;
        if(prev&&(gap<=L*0.01||sbCaptionGap(stats,prev.start+prev.len,r.start,L))){
            if(gap>L*0.01)prev.captioned=true;
            prev.len=r.start+r.len-prev.start;
            if(r.peak>prev.peak)prev.peak=r.peak;
        }else merged.push({start:r.start,len:r.len,peak:r.peak});
    }
    for(i=0;i<merged.length;i++){
        r=merged[i];
        if(r.len>sbCutWidthCap(L)*(r.captioned?2:1))continue;
        if(r.peak<205)continue;
        cuts.push({start:r.start,len:r.len,peak:r.peak});
    }
    return cuts;
}

/* Enforces a minimum span between consecutive boundaries (cuts and the
   [lo,hi] edges). A violation means one of the two cuts around the sliver is
   the edge of something drawn INSIDE a panel: drop the one the other rows
   support less, then the less white one, then the wider one. Returns the
   surviving cuts sorted, or null when even the bare [lo,hi] span is short. */
function sbResolveCuts(cuts,lo,hi,minSpan,support){
    cuts=cuts.slice().sort(function(a,b){return a.start-b.start;});
    for(;;){
        var edges=[{p:lo,end:lo}],i,a,b,drop,sa,sb;
        for(i=0;i<cuts.length;i++)edges.push({p:cuts[i].start,end:cuts[i].start+cuts[i].len,cut:cuts[i]});
        edges.push({p:hi,end:hi});
        var bad=-1;
        for(i=1;i<edges.length;i++){
            if(edges[i].p-edges[i-1].end<minSpan){bad=i;break;}
        }
        if(bad<0)return cuts;
        a=edges[bad-1].cut;b=edges[bad].cut;
        if(!a&&!b)return null;
        if(!a)drop=b;
        else if(!b)drop=a;
        else{
            sa=support(a);sb=support(b);
            if(sa!==sb)drop=sa<sb?a:b;
            else if(a.peak!==b.peak)drop=a.peak<b.peak?a:b;
            else drop=a.len>=b.len?a:b;
        }
        cuts.splice(cuts.indexOf(drop),1);
    }
}

/* Boundaries -> the spans between them, gutters excluded from both sides. */
function sbSpansFromCuts(cuts,lo,hi){
    var spans=[],prev=lo,i;
    for(i=0;i<cuts.length;i++){spans.push([prev,cuts[i].start]);prev=cuts[i].start+cuts[i].len;}
    spans.push([prev,hi]);
    return spans;
}

/* Reads the grid the model ACTUALLY drew, with no faith in the grid it was
   ASKED for. The old verifier matched runs against expected cut positions
   with a half-cell window — wide enough that when Gemini answered a 2x4
   request with a 3x3 sheet, the 1/3 gutter "verified" as the 1/2 cut on one
   axis; only a missing cut on the other axis saved the crop from garbage.
   Detection first: full-width horizontal gutters split the sheet into row
   bands, then each band is scanned for its own column gutters — rows need
   not agree with each other (on a real sheet they did not). A column cut's
   cross-row SUPPORT (another row cutting within 2% of the same x) is what
   settles sliver conflicts: real sheet structure repeats across rows, a
   white paper edge inside one panel does not.
   Returns { panels:[[x1,y1,x2,y2]…], rows, cols, uniform, xs, ys } in
   reading order, normalised, gutters excluded — or null when nothing
   plausible is there. cols is the per-row count when uniform, else 0;
   xs only exists when uniform (a per-axis view of unaligned rows is a lie). */
function sbDetectLayout(d,w,h){
    var yStats=sbLineStats(d,w,h,'y',0,w),yRuns=sbBrightRuns(yStats);
    var ty=sbTrimFrame(yRuns,h),loY=ty[0],hiY=ty[1];
    var tx=sbTrimFrame(sbBrightRuns(sbLineStats(d,w,h,'x',0,h)),w),loX=tx[0],hiX=tx[1];
    var none=function(){return 0;};
    var yCuts=sbResolveCuts(sbGutterCuts(yRuns,h,loY,hiY,yStats),loY,hiY,(hiY-loY)*0.12,none);
    if(!yCuts||yCuts.length>4)return null;
    var bands=sbSpansFromCuts(yCuts,loY,hiY);
    /* every band's candidate cuts first — support cannot be known until all
       rows have spoken */
    var i,j,k,cand=[];
    for(i=0;i<bands.length;i++){
        var xStats=sbLineStats(d,w,h,'x',bands[i][0],bands[i][1]);
        cand.push(sbGutterCuts(sbBrightRuns(xStats),w,loX,hiX,xStats));
    }
    var support=function(self){return function(c){
        var cc=c.start+c.len/2,n=0,b,m,o;
        for(b=0;b<cand.length;b++){
            if(b===self)continue;
            for(m=0;m<cand[b].length;m++){
                o=cand[b][m];
                if(Math.abs(o.start+o.len/2-cc)<=w*0.02){n++;break;}
            }
        }
        return n;
    };};
    var rowsOut=[],total=0,uniform=true;
    for(i=0;i<bands.length;i++){
        var cuts=sbResolveCuts(cand[i],loX,hiX,(hiX-loX)*0.10,support(i));
        if(!cuts||cuts.length>5)return null;
        rowsOut.push({band:bands[i],cols:sbSpansFromCuts(cuts,loX,hiX)});
        total+=rowsOut[i].cols.length;
        if(rowsOut[i].cols.length!==rowsOut[0].cols.length)uniform=false;
    }
    if(total<1||total>16)return null;
    var panels=[];
    for(i=0;i<rowsOut.length;i++){
        for(j=0;j<rowsOut[i].cols.length;j++){
            panels.push([rowsOut[i].cols[j][0]/w,rowsOut[i].band[0]/h,
                         rowsOut[i].cols[j][1]/w,rowsOut[i].band[1]/h]);
        }
    }
    var nCols=rowsOut[0].cols.length;
    if(uniform){
        for(k=0;k<nCols&&uniform;k++){
            for(i=1;i<rowsOut.length;i++){
                if(Math.abs(rowsOut[i].cols[k][0]-rowsOut[0].cols[k][0])>w*0.02||
                   Math.abs(rowsOut[i].cols[k][1]-rowsOut[0].cols[k][1])>w*0.02){uniform=false;break;}
            }
        }
    }
    var xs=null,ys=[];
    for(i=0;i<bands.length;i++)ys.push([bands[i][0]/h,bands[i][1]/h]);
    if(uniform){
        xs=[];
        for(k=0;k<nCols;k++){
            var s1=0,s2=0;
            for(i=0;i<rowsOut.length;i++){s1+=rowsOut[i].cols[k][0];s2+=rowsOut[i].cols[k][1];}
            xs.push([s1/rowsOut.length/w,s2/rowsOut.length/w]);
        }
    }
    return{panels:panels,rows:bands.length,cols:uniform?nCols:0,uniform:uniform,xs:xs,ys:ys};
}

/* Detected layout -> the door's result. Three tiers: the drawn grid IS the
   requested grid -> verified, xs/ys refined to the real gutters; a DIFFERENT
   plausible layout -> verified:false but WITH panel rects, because the model
   changed the grid, not the panels, and cropping real panels in reading
   order still beats showing a sheet of stamps; nothing plausible -> the flat
   fallback. A 1x1 request only ever takes the first or last tier — "several
   panels detected" on a single-panel ask means bright content lines, not a
   grid worth believing. */
/* AN INSET IS NOT A PANEL OF ITS OWN (v3.24.1). Asked for 2+2, a model drew
   the second shot as a wide panel plus a narrow close-up beside it (a hand on
   a cup): five rects for four requested panels. The exact-count reader turned
   that down whole, and the window showed the full sheet. When the rows agree
   with the request and a row only holds MORE panels than asked, the extras
   are insets: the narrowest panel is merged into its narrower neighbour until
   the row has its count. A row with FEWER panels cannot be split back — null.
   Pure; rects are [x1,y1,x2,y2] in reading order, rows told apart by y1. */
function sbFitRows(panels,rowCounts){
    if(!Array.isArray(panels)||!Array.isArray(rowCounts)||!rowCounts.length)return null;
    var rowsOf=[],i,r,cur=null;
    for(i=0;i<panels.length;i++){
        if(!cur||Math.abs(panels[i][1]-cur[0][1])>0.01){cur=[];rowsOf.push(cur);}
        cur.push(panels[i].slice());
    }
    if(rowsOf.length!==rowCounts.length)return null;
    var out=[],changed=false;
    for(r=0;r<rowsOf.length;r++){
        var row=rowsOf[r];
        if(row.length<rowCounts[r])return null;
        while(row.length>rowCounts[r]){
            var k=0;
            for(i=1;i<row.length;i++)if(row[i][2]-row[i][0]<row[k][2]-row[k][0])k=i;
            var left=k>0?row[k-1]:null,right=k<row.length-1?row[k+1]:null;
            var j=!left?k+1:!right?k-1:(left[2]-left[0]<=right[2]-right[0]?k-1:k+1);
            var a=Math.min(k,j),m=[row[a][0],Math.min(row[a][1],row[a+1][1]),row[a+1][2],Math.max(row[a][3],row[a+1][3])];
            row.splice(a,2,m);
            changed=true;
        }
        out=out.concat(row);
    }
    return{panels:out,merged:changed};
}

function sbGridResult(lay,rows,cols){
    var even={verified:rows*cols===1,xs:sbEvenCells(cols),ys:sbEvenCells(rows)};
    if(!lay||!lay.panels.length)return even;
    if(rows*cols===1){
        if(lay.panels.length!==1)return even;
        var p=lay.panels[0];
        return{verified:true,xs:[[p[0],p[2]]],ys:[[p[1],p[3]]],panels:lay.panels};
    }
    if(lay.uniform&&lay.rows===rows&&lay.cols===cols)
        return{verified:true,xs:lay.xs,ys:lay.ys,panels:lay.panels};
    if(lay.rows===rows&&lay.panels.length>rows*cols){
        var want=[],q;for(q=0;q<rows;q++)want.push(cols);
        var fit=sbFitRows(lay.panels,want);
        if(fit)return{verified:false,xs:sbEvenCells(cols),ys:lay.ys,panels:fit.panels,mergedInsets:true};
    }
    /* ONE AXIS READ, THE OTHER NOT (v3.22.2). A 2x2 ChatGPT sheet had 4px
       gutters; shrunk to the 640px the detector reads at, the vertical one
       still peaked just above the "white at the core" bar and the horizontal
       one just below it. The detector reported one row of two columns, the
       tier below took that for "the model redrew the grid", and the window
       showed a full-height column with two drawn panels in it.
       When the axis that WAS read agrees with the request and the other axis
       produced nothing at all (a single band), nothing says the model merged
       panels — a gutter was simply not seen. The read axis is believed and the
       silent one falls back to the even split it was asked for. */
    var missed=sbAxisFallback(lay,rows,cols);
    if(missed)return missed;
    if(lay.panels.length>=2&&lay.panels.length<=rows*cols*2)even.panels=lay.panels;
    return even;
}
function sbAxisFallback(lay,rows,cols){
    if(!lay||!lay.uniform)return null;
    var xs=null,ys=null,r,c,panels=[];
    if(lay.cols===cols&&lay.rows===1&&rows>1&&lay.xs){xs=lay.xs;ys=sbEvenCells(rows).map(function(e){
        /* keep whatever frame was trimmed off the top and bottom */
        var lo=lay.ys[0][0],hi=lay.ys[0][1];return[lo+e[0]*(hi-lo),lo+e[1]*(hi-lo)];});}
    else if(lay.rows===rows&&lay.cols===1&&cols>1&&lay.xs){ys=lay.ys;xs=sbEvenCells(cols).map(function(e){
        var lo=lay.xs[0][0],hi=lay.xs[0][1];return[lo+e[0]*(hi-lo),lo+e[1]*(hi-lo)];});}
    else return null;
    for(r=0;r<ys.length;r++)for(c=0;c<xs.length;c++)panels.push([xs[c][0],ys[r][0],xs[c][1],ys[r][1]]);
    return{verified:false,xs:xs,ys:ys,panels:panels,guessedAxis:true};
}
/* THE SAME SHEET AT MORE THAN ONE SIZE (v3.22.2). The detector's numbers were
   tuned at 640px, where a thin gutter is already half-mixed with the panels on
   either side of it. Its first answer still stands whenever it is the grid
   that was asked for. When it is not, the sheet is read again larger — there a
   4px gutter is a 4px white line, not a 1.5px grey one — and a larger reading
   is taken ONLY if it is exactly the requested grid: a second opinion may
   confirm the request, it may not invent a new layout. `passes` are thunks
   returning {d,w,h} (or null), smallest first, so a sheet that verifies at
   640px costs exactly what it used to. Pure. */
var STORYBOARD_ANALYZER=3;   /* 3 = v3.24.1: captions in gutters, insets merged */
function sbAnalysisFallback(rows,cols,exactCount){
    var single=exactCount?exactCount===1:rows*cols===1;
    var result={verified:single,xs:sbEvenCells(cols),ys:sbEvenCells(rows)};
    if(exactCount===1)result.panels=[[0,0,1,1]];
    return result;
}

function sbAnalyzePasses(passes,rows,cols,exactCount,rowPanels){
    var first=null,merged=null,i,px,res,layout,fit;
    for(i=0;i<passes.length;i++){
        px=null;try{px=passes[i]();}catch(e){px=null;}
        if(!px)continue;
        layout=sbDetectLayout(px.d,px.w,px.h);
        if(exactCount){
            if(layout&&layout.panels.length===exactCount){
                return {verified:true,panels:layout.panels,
                    xs:layout.uniform&&layout.cols===cols?layout.xs:sbEvenCells(cols),
                    ys:layout.rows===rows?layout.ys:sbEvenCells(rows)};
            }
            /* an exact reading at a larger size still wins over a merged one */
            if(!merged&&layout&&layout.panels.length>exactCount&&(fit=sbFitRows(layout.panels,rowPanels))){
                merged={verified:true,mergedInsets:true,panels:fit.panels,xs:sbEvenCells(cols),
                    ys:layout.rows===rows?layout.ys:sbEvenCells(rows)};
            }
            continue;
        }
        res=sbGridResult(layout,rows,cols);
        if(res.verified)return res;
        if(!first)first=res;
    }
    return merged||first||sbAnalysisFallback(rows,cols,exactCount);
}

/* The rows an Auto page of `n` panels was asked to have — known from the
   count and the sheet's orientation, so a stored page can be re-read without
   the request that drew it. Null when it disagrees with the stored rows. */
function sbAutoRowsFor(n,w,h,rows){
    var t=(h>w?STORYBOARD_AUTO_PORTRAIT:STORYBOARD_AUTO_LANDSCAPE)[n];
    return t&&(!rows||t.length===rows)?t:null;
}

/* Reads the sheet against the grid it was asked for. Never rejects the
   image: the worst answer is {verified:false} with even ranges — the caller
   decides how to degrade. verified:false MAY still carry `panels` (see
   sbGridResult) and a caller that crops by them survives the model redrawing
   the grid its own way. A 1x1 sheet has no grid to fail, but it still goes
   through the analysis: that is what trims an unasked-for white frame. */
function analyzeStoryboardGrid(src,rows,cols,exactCount,rowPanels){
    return new Promise(function(resolve){
        var fallback=sbAnalysisFallback(rows,cols,exactCount);
        if(typeof document==='undefined'||typeof Image==='undefined'){resolve(fallback);return;}
        try{
            var img=new Image();
            img.onload=function(){
                try{
                    var w=img.width,h=img.height,big=Math.max(w,h),seen={};
                    var read=function(maxSide){return function(){
                        var scale=Math.min(1,maxSide/big);
                        var cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale));
                        if(seen[cw+'x'+ch])return null;          /* the sheet is smaller than this size: already read */
                        seen[cw+'x'+ch]=true;
                        var c=document.createElement('canvas');c.width=cw;c.height=ch;
                        var g=c.getContext('2d');g.drawImage(img,0,0,cw,ch);
                        return{d:g.getImageData(0,0,cw,ch).data,w:cw,h:ch};
                    };};
                    var rp=exactCount?(Array.isArray(rowPanels)?rowPanels:sbAutoRowsFor(exactCount,w,h,rows)):null;
                    resolve(sbAnalyzePasses([read(640),read(1280),read(2048)],rows,cols,exactCount,rp));
                }catch(e){resolve(fallback);}
            };
            img.onerror=function(){resolve(fallback);};
            img.src=src;
        }catch(e){resolve(fallback);}
    });
}

async function illustrateStoryboard(opts){
    opts=opts||{};
    var panels=Array.isArray(opts.panels)?opts.panels.map(function(p){return String(p||'').trim();}):[];
    if(!panels.length||panels.some(function(p){return!p;}))throw new Error('Storyboard needs a non-empty panels[] array.');
    var autoLayout=opts.autoLayout===true;
    var grid=STORYBOARD_GRIDS[panels.length];
    if(autoLayout&&panels.length>=STORYBOARD_AUTO_PORTRAIT.length)throw new Error('An Auto storyboard page accepts up to 12 panels.');
    if(!autoLayout&&!grid)throw new Error('Storyboard panel count must be one of 1, 2, 3, 4, 6, 8, 9, 12 — got '+panels.length+'. Group chunks into panels before calling.');
    var preset=opts.preset||(opts.presetId?presets().find(function(p){return p.id===opts.presetId;}):activePreset());
    if(!preset)throw new Error('No preset for the storyboard.');
    if(!preset.useGemini&&!preset.workflow)throw new Error('Storyboard preset "'+(preset.name||preset.id)+'" has no backend — enable Gemini mode or attach a ComfyUI workflow.');
    var customGrid=presetStoryboardGrid(preset);
    if(customGrid&&!autoLayout){
        if(panels.length!==customGrid[0]*customGrid[1])throw new Error('This storyboard preset needs '+(customGrid[0]*customGrid[1])+' panels.');
        grid=customGrid;
    }
    var signal=opts.signal||new AbortController().signal;
    var onStatus=typeof opts.onStatus==='function'?opts.onStatus:function(){};
    /* Landscape sheet by default so the cells of the common 2-3 column grids
       come out usable; snapped /64 the same way illustrateText snaps. */
    var usePresetSize=customGrid||(autoLayout&&!preset.useGemini);
    var reqW=parseInt(opts.width)||(usePresetSize&&preset.width)||1344;
    var reqH=parseInt(opts.height)||(usePresetSize&&preset.height)||768;
    var overrideWH={w:Math.max(256,Math.round(reqW/64)*64),h:Math.max(256,Math.round(reqH/64)*64)};
    var rowPanels=autoLayout?(overrideWH.h>overrideWH.w?STORYBOARD_AUTO_PORTRAIT:STORYBOARD_AUTO_LANDSCAPE)[panels.length]:null;
    var rows=rowPanels?rowPanels.length:grid[0],cols=rowPanels?Math.max.apply(null,rowPanels):grid[1];
    var label=autoLayout?panels.length+' '+(panels.length===1?'panel':'panels'):rows+'x'+cols;
    var refs=normRefImages(opts.refImages);
    var fmt=FORMATS[preset.promptFormat]||FORMATS.flux;
    var neg=preset.negativePrompt||fmt.neg||'';
    var draft;
    if(customGrid||(autoLayout&&presetWritesStoryboard(preset))){
        onStatus('Writing storyboard prompt…');
        draft=await writeStoryboardPrompt(panels,rows,cols,preset,opts,signal,rowPanels);
    }else{
        draft={prompt:buildStoryboardPrompt(panels,rows,cols,rowPanels,preset.promptPrefix)};
    }
    onStatus('Storyboard '+label+(draft.avatar?' [avatar]':refs.length?' ['+refs.length+'ref]':'')+'…');
    var ga=draft.avatar?await renderStoryboardFrames(draft,preset,neg,signal,overrideWH,rowPanels,rows,cols,onStatus):null;
    var img=ga?ga.image:await generateOneImage(draft.prompt,neg,preset,signal,overrideWH,null,null,[],refs);
    if(!img)throw new Error('Storyboard backend returned no image ('+(preset.name||preset.id)+'). Check the backend error in SillyTavern.');
    if(opts.compress)try{img=await compressImage(img,S().maxStoredImageWidth,S().compressionQuality);}catch(e){}
    if(opts.mirrorToGallery!==false)aiMirrorToGallery(img,'storyboard '+label);
    var exactCount=autoLayout?panels.length:null;
    if(!ga){
        onStatus('Verifying grid…');
        try{ga=await analyzeStoryboardGrid(aiImgSrc(img),rows,cols,exactCount,rowPanels);}catch(e){}
    }
    if(!ga)ga=autoLayout?sbAnalysisFallback(rows,cols,exactCount):{verified:false,xs:sbEvenCells(cols),ys:sbEvenCells(rows)};
    return{image:img,rows:rows,cols:cols,verified:!!ga.verified,xs:ga.xs,ys:ga.ys,panels:ga.panels||null,continuity:draft.continuity};
}

/* ═══ CONTINUITY FRAME (v3.23.0) ═══
   An option: every illustration of a reply also gets, as a reference, the
   last picture of the reply before it — so the same people keep the same
   faces, clothes and hair, and the pictures keep one drawing style, instead
   of every reply being drawn from words alone. The storyboard of LLM Tools
   has done this for its sheets since 3.19 (role "previous"); this is the
   same idea for the ordinary illustrations. Only a reply within the last
   CONT_LOOKBACK messages counts: an older picture is another scene. */
var CONT_LOOKBACK=8,CONT_REF_MAX=1024;

/* Pure. The picture to continue from, for message `mi`: of the nearest earlier
   reply that has one — its latest VN-chunk picture, else its last section
   picture, else LLM Tools' storyboard sheet of it. {image,mi} or null. */
function aiPrevFrameOf(chat,mi){
    if(!Array.isArray(chat))return null;
    for(var i=mi-1,seen=0;i>=0&&seen<CONT_LOOKBACK;i--,seen++){
        var m=chat[i];
        if(!m||m.is_user||m.is_system)continue;
        var d=m.extra&&m.extra.autoIllustrator,best=null,t=-1,k;
        if(d&&Array.isArray(d.vnChunks)){
            for(k=0;k<d.vnChunks.length;k++){var c=d.vnChunks[k];if(c&&c.image&&(c.timestamp||0)>=t){best=c.image;t=c.timestamp||0;}}
        }
        if(!best&&d&&Array.isArray(d.sections)){
            for(k=d.sections.length-1;k>=0;k--)if(d.sections[k]&&d.sections[k].image){best=d.sections[k].image;break;}
        }
        var storyboard=m.extra&&m.extra.llmtStoryboard;
        if(!best&&storyboard){
            var pages=storyboard.additionalPages;
            var lastPage=Array.isArray(pages)?pages[pages.length-1]:null;
            best=(lastPage&&lastPage.image)||storyboard.image;
        }
        if(best)return{image:best,mi:i};
    }
    return null;
}

/* A stored picture (base64 or a server path) as a downscaled JPEG base64 —
   a reference does not need the full size, and the request should stay light. */
function aiDownscaleRef(v,maxDim){
    return new Promise(function(resolve){
        try{
            var im=new Image();
            im.onload=function(){
                try{
                    var k=Math.min(1,maxDim/Math.max(im.naturalWidth||1,im.naturalHeight||1));
                    var w=Math.max(1,Math.round(im.naturalWidth*k)),h=Math.max(1,Math.round(im.naturalHeight*k));
                    var c=document.createElement('canvas');c.width=w;c.height=h;
                    c.getContext('2d').drawImage(im,0,0,w,h);
                    resolve(c.toDataURL('image/jpeg',0.85).split(',')[1]);
                }catch(e){resolve(null);}
            };
            im.onerror=function(){resolve(null);};
            im.src=aiImgSrc(v);
        }catch(e){resolve(null);}
    });
}

/* The continuity reference for message `mi`, as refImages — [] when the option
   is off or there is nothing to continue from. Never throws. */
async function aiContinuityRefs(mi){
    try{
        if(!S().prevFrameRef)return[];
        var f=aiPrevFrameOf(getContext().chat,mi);
        if(!f)return[];
        var img=await aiDownscaleRef(f.image,CONT_REF_MAX);
        return img?[{image:img,role:'continuity'}]:[];
    }catch(e){return[];}
}

async function processMessage(mi){
    var s=S(),ctx=getContext();if(!s.enabled||processing.has(mi))return;
    var msg=ctx.chat[mi];if(!msg||msg.is_user||msg.is_system)return;
    if(msg.extra&&msg.extra.autoIllustrator&&msg.extra.autoIllustrator.processed)return;
    var mt=msg.mes;if(!mt||mt.trim().length<(s.minMessageLength||80))return;
    var preset=activePreset();if(!preset||(!preset.workflow&&!preset.useGemini)){toastr.warning("No active preset.");return;}

    processing.add(mi);var ctrl=new AbortController();controllers.set(mi,ctrl);
    try{
        var res=await illustrateText({
            text:mt,
            count:Math.max(1,Math.min(10,s.imagesPerMessage||2)),
            preset:preset,
            signal:ctrl.signal,
            /* v3.23.0: the previous reply's last picture, when the option is on */
            refImages:await aiContinuityRefs(mi),
            onStatus:function(t){showInd(mi,t);},
            onPart:function(parts){
                msg.extra=msg.extra||{};
                var prevAI=msg.extra.autoIllustrator||{};
                msg.extra.autoIllustrator={processed:false,preset:preset.id,timestamp:Date.now(),sections:parts.slice(),vnChunks:prevAI.vnChunks||[]};
                renderIll(mi);
            }
        });
        msg.extra=msg.extra||{};
        if(!msg.extra.autoIllustrator)msg.extra.autoIllustrator={processed:false,preset:preset.id,timestamp:Date.now(),sections:res.parts.slice(),vnChunks:[]};
        msg.extra.autoIllustrator.processed=true;renderIll(mi);ctx.saveChat();
        toastr.success(res.parts.filter(function(p){return!!p.image;}).length+'/'+res.total+' done.'+(res.pov?' (POV)':''));
        updateGalBadge();
    }catch(e){if(e.name==='AbortError')toastr.info('Cancelled.');else{toastr.error(e.message);console.error(L,e);}}
    finally{hideInd(mi);processing.delete(mi);controllers.delete(mi);}
}

/* ============ VN CHUNK ILLUSTRATION ============
 * Generates a single illustration for the currently-visible VN chunk text
 * and inserts it directly after the matching DOM block — instead of running
 * the multi-section flow over the whole message (which would put the image
 * at the very end of the text).
 */
async function processVnChunk(mi, chunkText, chunkIndex){
    var s=S(),ctx=getContext();
    if(!s.enabled) return;
    if(processing.has(mi)) return;
    var msg=ctx.chat[mi];
    if(!msg||msg.is_user||msg.is_system) return;
    if(!chunkText||!chunkText.trim()) { toastr.warning('No chunk text to illustrate'); return; }

    var preset=activePreset();
    if(!preset||(!preset.workflow&&!preset.useGemini)){ toastr.warning("No active preset."); return; }

    var routingEnabled=!!preset.enableCharRouting, charName='';
    if(routingEnabled){
        try{
            var chId=ctx.characterId;
            charName=(chId!==undefined&&ctx.characters&&ctx.characters[chId])
                ? ctx.characters[chId].name||ctx.name2||''
                : ctx.name2||'';
        }catch(e){}
        if(!charName) routingEnabled=false;
    }
    var charPreset=null;
    if(routingEnabled&&preset.charPresetId){
        charPreset=presets().find(function(p){return p.id===preset.charPresetId;});
        if(!charPreset||!charPreset.workflow) charPreset=null;
    }
    var adaptive=preset.adaptiveAspect!==false;
    var useCharDesc=preset.useCharDescription!==false;
    var charDesc=useCharDesc?getCharacterDescriptions():{};
    var charNames=getAvailableCharNames();
    var pov=isPOVFormat(preset.promptFormat);

    processing.add(mi);
    var ctrl=new AbortController();
    controllers.set(mi,ctrl);

    try{
        showInd(mi,'Loading avatars…');
        var avatarMap=await collectAllAvatars();
        var contRefs=await aiContinuityRefs(mi);     /* v3.23.0 */
        showInd(mi,'Analyzing chunk…');

        var loraEnabled=!!preset.enableLoraMatching;
        var loraEntries=loraEnabled?promptableLoraEntries(preset):[];
        if(loraEnabled&&!loraEntries.length) loraEnabled=false;

        // Run analyseMessage on JUST the chunk text, asking for exactly 1 image.
        var secs=await analyseMessage(
            chunkText, 1, preset.promptFormat, preset.customInstructions,
            charName, routingEnabled, adaptive,
            loraEnabled?loraEntries:null, preset.maxLorasPerImage||2,
            useCharDesc?charDesc:null, charNames
        );
        if(ctrl.signal.aborted) throw new DOMException('','AbortError');
        if(!secs||!secs.length){ toastr.warning('LLM could not analyze chunk.'); return; }

        var sec=secs[0];
        var usePreset=preset, routeLabel='default';
        if(routingEnabled&&charPreset&&sec.has_char){ usePreset=charPreset; routeLabel='CHAR'; }
        var fmt=FORMATS[usePreset.promptFormat]||FORMATS.flux;
        var neg=usePreset.negativePrompt||fmt.neg||'';
        var pc=parseInt(sec.person_count)||0;
        var overrideWH=adaptive?adaptDimensions(usePreset.width,usePreset.height,pc):null;
        var detectedChars=sec.characters||[];
        var finalPrompt=sec.image_prompt;
        if(usePreset.promptPrefix&&usePreset.promptPrefix.trim())finalPrompt=usePreset.promptPrefix.trim()+', '+finalPrompt;
        var selectedLoras=sec.loras||[];
        // Resolve against the library the LLM actually saw (IDs L1..Ln index into it).
        var usedLoraLib=loraEnabled?loraEntries:[];
        var resolved=usedLoraLib.length?resolveLoraSelection(selectedLoras,usedLoraLib,usePreset.maxLorasPerImage||preset.maxLorasPerImage||2):[];
        var merged=mergeAlwaysOnLoras(resolved,usePreset.alwaysOnLoras);
        var lorasToInject=merged.loras, triggerWords=merged.triggers;
        if(triggerWords.length) finalPrompt+=', '+triggerWords.join(', ');

        var sp=[]; if(pov) sp.push('POV'); sp.push('VN#'+chunkIndex);
        if(adaptive&&overrideWH) sp.push(pc+'p');
        if(routingEnabled) sp.push(routeLabel);
        if(detectedChars.length) sp.push(detectedChars.join('+'));
        if(lorasToInject.length) sp.push(lorasToInject.length+'LoRA');
        if(contRefs.length) sp.push('prev');
        showInd(mi,'VN image ['+sp.join('|')+']…');

        var img=null;
        try{
            img=await Promise.race([
                generateOneImage(finalPrompt,neg,usePreset,ctrl.signal,overrideWH,lorasToInject,avatarMap,detectedChars,contRefs),
                new Promise(function(_,r){ setTimeout(function(){ r(new Error('Timeout')); },s.generateTimeoutMs); })
            ]);
        }catch(e){ if(e.name==='AbortError') throw e; }
        if(img&&s.compressImages) try{ img=await compressImage(img,s.maxStoredImageWidth,s.compressionQuality); }catch(e){}

        if(!img){ toastr.warning('Image generation failed.'); return; }

        // Persist this VN-illustration in msg.extra so it survives swipes/reloads.
        msg.extra=msg.extra||{};
        msg.extra.autoIllustrator=msg.extra.autoIllustrator||{
            processed:false, preset:preset.id, timestamp:Date.now(), sections:[]
        };
        var aiData=msg.extra.autoIllustrator;
        aiData.vnChunks=aiData.vnChunks||[];
        if(img)aiMirrorToGallery(img,(sec&&sec.image_prompt)||'vn');
        aiData.vnChunks.push({
            chunkIndex:chunkIndex,
            chunkText:chunkText.slice(0,200),
            imagePrompt:sec.image_prompt,
            finalPrompt:finalPrompt,
            image:img,
            timestamp:Date.now(),
            characters:detectedChars,
            pov:pov
        });
        ctx.saveChat();

        // Insert into DOM after the matching text chunk.
        insertVnChunkIllustration(mi, chunkIndex, {
            image:img,
            imagePrompt:sec.image_prompt
        });

        toastr.success('VN chunk illustrated'+(pov?' (POV)':''));
        updateGalBadge();
    }catch(e){
        if(e.name==='AbortError') toastr.info('Cancelled.');
        else { toastr.error(e.message||'VN illustrate failed'); console.error(L,e); }
    }finally{
        hideInd(mi);
        processing.delete(mi);
        controllers.delete(mi);
    }
}

/**
 * Inserts an illustration wrapper directly after the Nth non-aux text chunk
 * inside the message's .mes_text element. Uses LLM Tools' getVnTextChunks
 * helper if available, otherwise falls back to children-not-illustration-wrapper.
 */
function insertVnChunkIllustration(mi, chunkIndex, data){
    var $mes=$('#chat .mes[mesid="'+mi+'"]');
    if(!$mes.length) return;
    var $text=$mes.find('.mes_text');
    if(!$text.length) return;

    var chunks;
    if(window.LLMTools&&typeof window.LLMTools.getVnTextChunks==='function'){
        chunks=window.LLMTools.getVnTextChunks($mes);
    } else {
        chunks=$text.children(':not(.ai-illustration-wrapper)').toArray();
    }
    if(!chunks.length) return;
    var idx=Math.max(0,Math.min(chunkIndex,chunks.length-1));
    var anchor=chunks[idx];

    // Remove any existing VN wrapper for this same chunk index, so re-clicking
    // the button replaces rather than stacks.
    $text.find('.ai-illustration-wrapper[data-vn-chunk="'+chunkIndex+'"]').remove();

    var src=aiImgSrc(data.image);
    var cap=esc(data.imagePrompt||'');
    var hp=S().hidePrompts?' ai-hide-caption':'';
    var html='<div class="ai-illustration-wrapper'+hp+'" data-vn-chunk="'+chunkIndex+'">'+
        '<img class="ai-illustration-img" src="'+src+'" title="Click to enlarge" loading="lazy"/>'+
        '<div class="ai-illustration-caption" title="'+cap+'">🖼️ '+cap+'</div>'+
        '</div>';
    $(anchor).after(html);

    // Nudge LLM Tools to re-run its VN view so the new wrapper is shown
    // alongside its associated chunk.
    try{
        if(window.LLMTools&&typeof window.LLMTools.isVnMode==='function'&&window.LLMTools.isVnMode()){
            // Trigger a tiny DOM change to wake the observer; or call directly
            // if exposed.
            $(anchor).trigger('vn-illustration-added');
        }
    }catch(e){}
}

/**
 * Re-attaches stored VN-chunk illustrations after re-renders (swipes, reloads).
 */
function renderVnIllustrations(mi){
    var ctx=getContext();
    var msg=ctx.chat&&ctx.chat[mi];
    if(!msg||!msg.extra||!msg.extra.autoIllustrator) return;
    var vn=msg.extra.autoIllustrator.vnChunks;
    if(!vn||!vn.length) return;
    vn.forEach(function(rec){
        insertVnChunkIllustration(mi, rec.chunkIndex, {
            image:rec.image, imagePrompt:rec.imagePrompt
        });
    });
}

/* ============ EVENTS ============ */
/* GM Turn (§9.1): while the Game Shell drives the turn it generates the scene
   image from the <gm> block's own English prompt (zero LLM) and pins it with
   attachImageToMessage. The guard sits INSIDE the timer and wraps ONLY
   processMessage — putting it on the first line would also skip
   injectMsgButtons and the manual 🎨 button would vanish from every message. */
function onMsg(mi){if(aiSlayOwnsScreen()||!S().enabled||!S().autoGenerate)return;if(mi==null)mi=getContext().chat.length-1;setTimeout(function(){if(!aiSlayOwnsScreen()&&!(typeof window!=='undefined'&&window.RPGShellDriving))processMessage(mi);injectMsgButtons();},1200);}
function currentCharName(){var ctx=getContext();try{var chId=ctx.characterId;return(chId!==undefined&&ctx.characters&&ctx.characters[chId])?ctx.characters[chId].name||ctx.name2||'':ctx.name2||'';}catch(e){return ctx.name2||'';}}
/* ——— Preset links ———
   Two owners can ask for a preset when a chat opens: the CHARACTER (a name in
   settings.charPresetLinks) and the CHAT itself. The chat link is kept in the
   chat's own metadata, not in a settings dictionary: a chat file name is not an
   identity — it is renameable and unique only inside one character's folder —
   while metadata travels with the chat, survives renaming and disappears with
   it. The chat is the narrower owner, so it wins; if it points at a preset that
   no longer exists the character link still gets its turn. */
var CHAT_LINK_KEY='autoIllustratorPreset';
function currentChatName(){var ctx;try{ctx=getContext();}catch(e){return'';}try{return ctx.chatId||(ctx.getCurrentChatId?ctx.getCurrentChatId():'')||'';}catch(e){return'';}}
function chatPresetLink(){var ctx;try{ctx=getContext();}catch(e){return'';}var m=ctx.chatMetadata;return(m&&m[CHAT_LINK_KEY])||'';}
function setChatPresetLink(id){var ctx;try{ctx=getContext();}catch(e){return false;}var m=ctx.chatMetadata;if(!m||!currentChatName())return false;if(id)m[CHAT_LINK_KEY]=id;else delete m[CHAT_LINK_KEY];try{ctx.saveMetadataDebounced();}catch(e){console.warn(L,'chat link not saved:',e);}return true;}
function presetExists(pid){return!!pid&&presets().some(function(p){return p.id===pid;});}
/* No syncUIToPreset() before the switch, deliberately: this runs on
   CHAT_CHANGED, which also fires before the settings drawer exists, and reading
   empty inputs back into the preset would blank the workflow. */
function applyPresetLinks(){
    var pid=chatPresetLink();
    if(!presetExists(pid)){var name=currentCharName();pid=name?((S().charPresetLinks||{})[name]||''):'';}
    if(!presetExists(pid)||S().activePresetId===pid)return;
    setActive(pid);rebuildPresetDD();loadPresetToUI();
}
function onChat(){controllers.forEach(function(c){c.abort();});controllers.clear();processing.clear();applyPresetLinks();syncCharLinkUI();syncChatLinkUI();reRenderAll();setTimeout(updateGalBadge,800);}
function updateFmtInfo(){var k=$('#ai_prompt_fmt').val()||'flux',f=FORMATS[k];if(f){var desc=f.inst?f.inst.substring(0,120)+'…':'Custom';if(isPOVFormat(k))desc='👁️ POV | '+desc;$('#ai_fmt_desc').text(desc);$('#ai_fmt_res').text('⊞ '+f.w+'×'+f.h);}}

/* ============ UI ============ */
function buildUI(){
    var fo='<optgroup label="── Standard ──">';
    var stdKeys=['flux','flux2klein','krea2','gemini','gpt','zimage','qwen_image','sd15','illustrious','noobai','anima','custom'];
    var povKeys=['pov_flux','pov_flux2klein','pov_krea2','pov_gemini','pov_gpt','pov_zimage','pov_qwen','pov_sd15','pov_illustrious','pov_noobai','pov_anima'];
    stdKeys.forEach(function(k){if(FORMATS[k])fo+='<option value="'+k+'">'+esc(FORMATS[k].l)+'</option>';});
    fo+='</optgroup><optgroup label="── 👁️ POV (First Person) ──">';
    povKeys.forEach(function(k){if(FORMATS[k])fo+='<option value="'+k+'">'+esc(FORMATS[k].l)+'</option>';});
    fo+='</optgroup>';
    var gpo='';for(var gk in POSITIONS)if(POSITIONS.hasOwnProperty(gk))gpo+='<option value="'+gk+'">'+esc(POSITIONS[gk].l)+'</option>';
    var mpo='';for(var mk in MSG_POSITIONS)if(MSG_POSITIONS.hasOwnProperty(mk))mpo+='<option value="'+mk+'">'+esc(MSG_POSITIONS[mk].l)+'</option>';
    return'<div id="auto_illustrator_settings"><div class="inline-drawer">'+
        '<div class="inline-drawer-toggle inline-drawer-header"><b>🎨 AutoIllustrator v3.25.2</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>'+
        '<div class="inline-drawer-content" style="display:none;">'+
        '<label class="checkbox_label"><input id="ai_on" type="checkbox"/><span>Enable</span></label>'+
        '<label class="checkbox_label"><input id="ai_auto" type="checkbox"/><span>Auto-generate</span></label>'+
        '<div class="ai-sg"><label>Images per msg: <b id="ai_cnt_v">2</b></label><input id="ai_cnt" type="range" min="1" max="10" step="1"/></div>'+
        '<hr class="sysHR"/>'+
        '<div class="ai-sg"><label><b>📦 Preset</b></label><select id="ai_preset_sel" class="text_pole"></select>'+
        '<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap"><div id="ai_p_new" class="menu_button" style="font-size:.8em">➕New</div><div id="ai_p_ren" class="menu_button" style="font-size:.8em">✏️Ren</div><div id="ai_p_dup" class="menu_button" style="font-size:.8em">📋Dup</div><div id="ai_p_del" class="menu_button" style="font-size:.8em;color:#f66">🗑️Del</div></div>'+
        '<label class="checkbox_label" style="margin-top:4px" title="When checked, switching to this character in chat automatically activates this preset."><input id="ai_char_link" type="checkbox"/><span>📌 Always use for character: <b id="ai_char_link_name">—</b></span></label>'+
        '<label class="checkbox_label" style="margin-top:2px" title="When checked, opening THIS chat automatically activates this preset. The link is stored inside the chat itself — it survives renaming and outranks the per-character link."><input id="ai_chat_link" type="checkbox"/><span>🔗 Always use for this chat: <b id="ai_chat_link_name">—</b></span></label>'+
        '<small class="ai-desc" id="ai_chat_link_note" style="display:none"></small>'+
        '</div>'+
        '<hr class="sysHR"/>'+
        '<div style="border-left:3px solid var(--SmartThemeQuoteColor,#6366f1);padding-left:8px;margin:4px 0">'+
        '<small style="color:var(--SmartThemeQuoteColor,#6366f1)">⬇ Per-preset</small>'+
        '<label class="checkbox_label" style="margin-top:4px"><input id="ai_char_route" type="checkbox"/><span>🔀 Smart Routing</span></label>'+
        '<div id="ai_route_opts" style="margin-left:20px;margin-bottom:4px"><label style="font-size:.82em">Char preset:</label><select id="ai_char_preset" class="text_pole" style="font-size:.85em"><option value="">— same —</option></select></div>'+
        '<label class="checkbox_label"><input id="ai_adapt" type="checkbox"/><span>📐 Adaptive Aspect</span></label>'+
        '<label class="checkbox_label"><input id="ai_char_desc" type="checkbox"/><span>👤 Character card descriptions</span></label>'+
        '<div class="ai-sg" style="margin-top:4px"><label style="font-size:.82em">✏️ Common Prompt Prefix</label><textarea id="ai_prompt_prefix" class="text_pole" rows="2" placeholder="e.g. style tags or fixed subject description, prepended to every generated prompt" style="font-size:.85em"></textarea><small class="ai-desc">Always inserted at the very start of the image prompt for this preset — useful for locking in a character or art style.</small></div>'+
        '<hr class="sysHR"/>'+
        '<div class="ai-sg"><label>Prompt Format:</label><select id="ai_prompt_fmt" class="text_pole">'+fo+'</select><small class="ai-desc" id="ai_fmt_desc"></small><small class="ai-desc" id="ai_fmt_res"></small></div>'+
        '<div style="display:flex;gap:8px"><div style="flex:1"><label>Width:</label><input id="ai_w" type="number" class="text_pole" min="256" max="2048" step="64"/></div><div style="flex:1"><label>Height:</label><input id="ai_h" type="number" class="text_pole" min="256" max="2048" step="64"/></div><div><label>&nbsp;</label><div id="ai_res_apply" class="menu_button" style="font-size:.78em">📐</div></div></div>'+
        '<div class="ai-sg"><label>Negative:</label><textarea id="ai_neg" class="text_pole" rows="2"></textarea></div>'+
        '<div class="ai-sg"><label>Custom LLM Instructions:</label><textarea id="ai_custom_instr" class="text_pole" rows="2"></textarea></div>'+
        '<div class="ai-sg"><label for="ai_sb_layout">Storyboard grid (rows × columns)</label>'+
        '<input id="ai_sb_layout" class="text_pole" placeholder="e.g. 3x2"/>'+
        '<label for="ai_sb_instructions">Storyboard LLM instructions</label>'+
        '<textarea id="ai_sb_instructions" class="text_pole" rows="5"></textarea>'+
        '<small class="ai-desc">Fill both fields to rewrite the shots with the SillyTavern text model before drawing through this workflow. This storyboard uses the preset size and Common Prompt Prefix.</small></div>'+
        '<details class="ai-sg"><summary>Storyboard avatar workflow</summary>'+
        '<label for="ai_sb_avatar_workflow">ComfyUI API JSON</label>'+
        '<textarea id="ai_sb_avatar_workflow" class="text_pole" rows="5" spellcheck="false"></textarea>'+
        '<small class="ai-desc">Optional. Use %ref_1% for the avatar. The storyboard uses this workflow when the text model identifies a visible character with an avatar.</small></details>'+
        '<div class="ai-sg" style="border:1px solid rgba(120,120,255,.25);border-radius:8px;padding:6px 8px;margin-bottom:6px">'+
        '<label class="checkbox_label"><input id="ai_use_gemini" type="checkbox"/><span>🌐 Use web bridge (Gemini / ChatGPT)</span></label>'+
        '<div id="ai_gemini_opts" style="margin-top:5px;display:none">'+
        '<label style="font-size:.85em;display:block;margin-bottom:5px">Image engine: <select id="ai_bridge_engine" class="text_pole" style="width:190px;font-size:.85em"><option value="gemini">Gemini (nano banana)</option><option value="chatgpt">ChatGPT (image generation)</option></select></label>'+
        '<small class="ai-desc">Which site the bridge draws with. Both go through the same gemini-bridge server and port; the site must be open and signed in inside the bridge Chrome. ChatGPT takes noticeably longer per image and has per-account limits.</small>'+
        '<label style="font-size:.85em">Bridge port: <input id="ai_gemini_port" class="text_pole" style="width:90px;font-size:.85em" placeholder="7860"/></label>'+
        '<div id="ai_gemini_only">'+
        '<label style="font-size:.85em;display:block;margin-top:5px">Model speed: <select id="ai_gemini_mode" class="text_pole" style="width:130px;font-size:.85em"><option value="pro">Pro (slow)</option><option value="flash">Flash (fast)</option></select></label>'+
        '<small class="ai-desc">Set the same model that is selected in Gemini itself. This does NOT switch the model — it switches the bridge timeouts. On Flash an image is ready in seconds, and the bridge stops waiting out pauses meant for Pro (saves ~15 s per image).</small>'+
        '<label class="checkbox_label" style="margin-top:5px"><input id="ai_gemini_hires" type="checkbox"/><span>Hi-res (download the original)</span></label>'+
        '<small class="ai-desc">Hi-res fetches the full-size file through the Download button instead of the preview. Slightly slower, higher quality. When off, the visible image is used.</small>'+
        '</div>'+
        '<label class="checkbox_label" style="margin-top:5px"><input id="ai_gemini_charav" type="checkbox"/><span>Use char avatar (i2i)</span></label>'+
        '<label style="font-size:.85em;display:block">Max avatars: <input id="ai_gemini_maxav" class="text_pole" style="width:60px;font-size:.85em" type="number" min="1" max="4" placeholder="2"/></label>'+
        '<small class="ai-desc">Sends the avatars of the characters in the scene to Gemini as an appearance reference, one per character in the paragraph (up to the limit), so Gemini draws the same characters as in the chat.</small>'+
        '<small class="ai-desc">When enabled, this preset draws through gemini-bridge on the given port. The workflow below is ignored — only Prompt Format and the instructions for the LLM prompt are used. The bridge itself must be running (image mode or both).</small>'+
        '</div></div>'+
        '<div class="ai-sg"><label>ComfyUI Workflow (API JSON):</label>'+
        '<div style="display:flex;gap:4px;margin-bottom:4px;flex-wrap:wrap">'+
        '<div id="ai_wf_load" class="menu_button" style="font-size:.78em" title="Load workflow JSON from a ComfyUI API-format file">📂 Load JSON…</div>'+
        '<div id="ai_wf_autoph_basic" class="menu_button" style="font-size:.78em" title="Replace only essential fields: %prompt%, %negative_prompt%, %width%, %height%, %seed%. Leaves model, sampler, scheduler, steps, cfg, denoise, CLIPs etc. as they are in the source workflow.">🎯 Auto: Basic</div>'+
        '<div id="ai_wf_autoph" class="menu_button" style="font-size:.78em" title="Replace every recognised field: prompts, model, VAE, CLIPs, sampler, scheduler, steps, cfg, denoise, seed, dimensions, batch, clip_skip">✨ Auto: All</div>'+
        '<input id="ai_wf_file" type="file" accept=".json,application/json" style="display:none"/>'+
        '<small id="ai_wf_status" style="color:#888;align-self:center;font-size:.78em;margin-left:4px"></small>'+
        '</div>'+
        '<textarea id="ai_wf_json" class="text_pole" rows="5" placeholder="%avatar_1% %avatar_2% %char_avatar% %user_avatar% %prompt%"></textarea>'+
        '<div style="display:flex;gap:4px;margin-top:3px;align-items:center;flex-wrap:wrap">'+
        '<div id="ai_wf_show_ph" class="menu_button" style="font-size:.78em" title="Open a floating, draggable widget with all placeholders. Click to open or close — drag the header to move it aside while editing.">ℹ️ Placeholders</div>'+
        '<small class="ai-desc" style="margin:0;flex:1;min-width:0">Click for the full list — text, numeric, avatars &amp; per-character slots.</small>'+
        '</div></div>'+
        '<hr class="sysHR"/>'+
        '<div class="ai-sg"><label><b>⚙️ Generation Params</b></label>'+
        '<div id="ai_refresh_opts" class="menu_button" style="font-size:.78em;margin-bottom:4px">🔄 Load from ComfyUI</div>'+
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><div style="flex:2;min-width:120px"><label style="font-size:.8em">Model:</label><input id="ai_p_model" class="text_pole" list="ai_dl_models" style="font-size:.85em"/></div><div style="flex:1;min-width:80px"><label style="font-size:.8em">VAE:</label><input id="ai_p_vae" class="text_pole" list="ai_dl_vaes" style="font-size:.85em"/></div></div>'+
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><div style="flex:1"><label style="font-size:.8em">Sampler:</label><input id="ai_p_sampler" class="text_pole" list="ai_dl_samplers" style="font-size:.85em"/></div><div style="flex:1"><label style="font-size:.8em">Scheduler:</label><input id="ai_p_scheduler" class="text_pole" list="ai_dl_schedulers" style="font-size:.85em"/></div></div>'+
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><div style="flex:1;min-width:100px" title="%clip_name% — for single-CLIP loaders (SD1.5, SDXL)"><label style="font-size:.8em">CLIP:</label><input id="ai_p_clip" class="text_pole" list="ai_dl_clips" placeholder="auto" style="font-size:.85em"/></div><div style="flex:1;min-width:100px" title="%clip_name1% — first CLIP for DualCLIPLoader (Flux/SD3, e.g. t5xxl)"><label style="font-size:.8em">CLIP 1:</label><input id="ai_p_clip1" class="text_pole" list="ai_dl_clips" placeholder="auto" style="font-size:.85em"/></div><div style="flex:1;min-width:100px" title="%clip_name2% — second CLIP for DualCLIPLoader (Flux/SD3, e.g. clip_l)"><label style="font-size:.8em">CLIP 2:</label><input id="ai_p_clip2" class="text_pole" list="ai_dl_clips" placeholder="auto" style="font-size:.85em"/></div></div>'+
        '<div style="margin-top:6px;padding:6px;background:rgba(99,102,241,0.08);border-radius:6px"><label style="font-size:.82em"><b>🔮 Always-On LoRAs</b></label><div id="ai_aon_list"></div>'+
        '<div style="display:flex;gap:4px;margin-top:4px;align-items:center"><input id="ai_aon_lora_input" class="text_pole" list="ai_dl_loras" placeholder="LoRA…" style="flex:2;font-size:.85em"/><input id="ai_aon_trigger_input" class="text_pole" placeholder="trigger" style="flex:1;font-size:.85em"/><input id="ai_aon_weight_input" type="number" step="0.05" min="0" max="2" value="0.8" class="text_pole" style="width:55px;font-size:.85em"/><div id="ai_aon_add" class="menu_button" style="font-size:.78em">➕</div></div></div>'+
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><div style="flex:1;min-width:60px"><label style="font-size:.8em">Steps:</label><input id="ai_p_steps" type="number" class="text_pole" style="font-size:.85em"/></div><div style="flex:1;min-width:60px"><label style="font-size:.8em">CFG:</label><input id="ai_p_cfg" type="number" step="0.5" class="text_pole" style="font-size:.85em"/></div><div style="flex:1;min-width:60px"><label style="font-size:.8em">Denoise:</label><input id="ai_p_denoise" type="number" step="0.05" class="text_pole" style="font-size:.85em"/></div><div style="flex:1;min-width:60px" title="CLIP skip — value used for %clip_skip% and CLIPSetLastLayer.stop_at_clip_layer"><label style="font-size:.8em">CLIP skip:</label><input id="ai_p_clipskip" type="number" class="text_pole" style="font-size:.85em"/></div></div>'+
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><div style="flex:2;min-width:120px" title="%seed% — set 0 (or empty) for a random seed every generation, otherwise this fixed value is used"><label style="font-size:.8em">Seed (0 = random):</label><input id="ai_p_seed" type="number" min="0" step="1" class="text_pole" style="font-size:.85em" placeholder="0"/></div><div style="flex:1;min-width:60px" title="%batch% / %batch_size%"><label style="font-size:.8em">Batch:</label><input id="ai_p_batch" type="number" min="1" max="16" step="1" class="text_pole" style="font-size:.85em" placeholder="1"/></div></div></div>'+
        '<hr class="sysHR"/>'+
        '<div class="ai-sg"><label><b>🔮 LoRA Auto-Select</b></label><label class="checkbox_label"><input id="ai_lora_on" type="checkbox"/><span>Enable</span></label>'+
        '<div id="ai_lora_opts"><div style="display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap"><label style="font-size:.82em">Max/img:</label><input id="ai_lora_max" type="number" min="1" max="5" class="text_pole" style="width:50px;font-size:.85em"/><label style="font-size:.82em" title="Snap LLM-chosen LoRA weights to this grid (anchored at each LoRA\'s Min w). Off = LLM picks any value inside the range.">w step:</label><select id="ai_lora_wstep" class="text_pole" style="width:64px;font-size:.85em"><option value="0">off</option><option value="0.05">0.05</option><option value="0.1">0.1</option><option value="0.25">0.25</option><option value="0.5">0.5</option></select><div id="ai_lora_manager_btn" class="menu_button" style="font-size:.78em">📚 Library (<span id="ai_lora_count">0</span>)</div></div>'+
        '<small class="ai-desc">Only <b>enabled</b> LoRAs that have a description or tags are offered to the LLM (cap 120). Sync adds new files disabled — bulk-enable the folder that matches this preset\'s base model in the Library. Per-LoRA <b>weight rules</b> (Library → edit) tell the LLM when to pick low vs high w.</small></div></div>'+
        '</div>'+
        '<hr class="sysHR"/>'+
        '<div class="ai-sg"><label style="font-size:.82em"><b>🔌 ComfyUI Endpoint</b></label>'+
        '<input id="ai_comfy_url" class="text_pole" placeholder="auto-detect (blank)" style="font-size:.85em"/>'+
        '<small class="ai-desc"><code>:8188</code> ComfyUI &nbsp; <code>:7821</code> SwarmUI</small>'+
        '<div style="display:flex;gap:4px;margin-top:3px;align-items:center"><div id="ai_url_detect" class="menu_button" style="font-size:.76em">🔍 Detect</div><div id="ai_url_test" class="menu_button" style="font-size:.76em">🧪 Test</div><small id="ai_url_status" style="color:#888"></small></div></div>'+
        '<div class="ai-sg"><label><b>🎯 Positions</b></label><div style="display:flex;gap:8px;flex-wrap:wrap"><div style="flex:1"><label style="font-size:.82em">Gallery:</label><select id="ai_gal_pos" class="text_pole" style="font-size:.85em">'+gpo+'</select></div><div style="flex:1"><label style="font-size:.82em">Msg:</label><select id="ai_msg_pos" class="text_pole" style="font-size:.85em">'+mpo+'</select></div></div></div>'+
        '<label class="checkbox_label"><input id="ai_direct" type="checkbox"/><span>Direct ComfyUI</span></label>'+
        '<label class="checkbox_label"><input id="ai_comp" type="checkbox"/><span>Compress</span></label>'+
        '<label class="checkbox_label" title="Also save every generated image into the character\'s gallery folder (user/images) — visible in ST\'s gallery and Character Library"><input id="ai_savegal" type="checkbox"/><span>Save to gallery</span></label>'+
        '<label class="checkbox_label"><input id="ai_galbtn" type="checkbox"/><span>Gallery btn</span></label>'+
        '<label class="checkbox_label" title="Attach the last picture of the previous reply as a reference, so characters, clothing and drawing style stay consistent from picture to picture. One more image per request."><input id="ai_prevframe" type="checkbox"/><span>🎞 Continue from the previous picture</span></label>'+
        '<label class="checkbox_label" title="Hide the prompt caption shown beneath each generated image"><input id="ai_hide_prompts" type="checkbox"/><span>🙈 Hide image prompts</span></label>'+
        '<hr class="sysHR"/>'+
        '<div style="display:flex;gap:4px;flex-wrap:wrap"><div id="ai_go" class="menu_button" style="flex:1;font-size:.82em">🎨 Go</div><div id="ai_redo" class="menu_button" style="flex:1;font-size:.82em">🔄 Redo</div><div id="ai_clr" class="menu_button" style="flex:1;font-size:.82em">🗑️ Clear</div></div>'+
        '</div></div></div>';
}

/* ============ BIND ============ */
function settingsToUI(){var s=S();$('#ai_on').prop('checked',s.enabled);$('#ai_auto').prop('checked',s.autoGenerate);$('#ai_cnt').val(s.imagesPerMessage);$('#ai_cnt_v').text(s.imagesPerMessage);$('#ai_direct').prop('checked',s.preferDirectComfy);$('#ai_comp').prop('checked',s.compressImages);$('#ai_savegal').prop('checked',s.saveToGallery!==false);$('#ai_prevframe').prop('checked',!!s.prevFrameRef);$('#ai_galbtn').prop('checked',s.showGalleryButton);$('#ai_hide_prompts').prop('checked',!!s.hidePrompts);$('#ai_gal_pos').val(s.galleryPosition||'mid-right');$('#ai_msg_pos').val(s.msgBtnPosition||'bottom-right');$('#ai_comfy_url').val(s.comfyUrl||'');rebuildPresetDD();loadPresetToUI();toggleGalBtn();applyHidePrompts();}

function applyHidePrompts(){$('.ai-illustration-wrapper').toggleClass('ai-hide-caption',!!S().hidePrompts);}

/* ============ PLACEHOLDER REFERENCE FLOATING WIDGET ============ */
/**
 * Toggle a floating, draggable widget listing every placeholder this extension
 * recognises, grouped by category. Unlike a modal, it does NOT block the page —
 * the user can drag it aside, keep it open, and copy placeholders into the
 * workflow textarea while editing.
 *
 * State persisted to localStorage:
 *   - ai_ph_widget_pos:        { left, top }
 *   - ai_ph_widget_collapsed:  boolean
 *
 * Avatar slots are populated dynamically from the current chat when possible.
 */
var PH_WIDGET_ID='ai_ph_widget';
var PH_POS_KEY='ai_ph_widget_pos';
var PH_COLLAPSED_KEY='ai_ph_widget_collapsed';

function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

function togglePlaceholderWidget(){
    var existing=document.getElementById(PH_WIDGET_ID);
    if(existing){ existing.remove(); return; }

    // Try to discover named avatar slots from the current chat context
    var namedAvatars=[];
    try{
        var ctx=getContext();
        var seen={};
        (ctx.chat||[]).forEach(function(m){
            if(!m||m.is_user||m.is_system) return;
            var n=m.name||m.original_name;
            if(n&&!seen[n]){ seen[n]=true; namedAvatars.push(n); }
        });
    }catch(e){}

    var groups=[
        { title:'📝 Prompts (text)', items:[
            ['%prompt%','Positive prompt for the current scene'],
            ['%negative_prompt%','Negative prompt (preset → Negative field)']
        ]},
        { title:'🧠 Model / Loaders (text)', items:[
            ['%model%','Checkpoint or UNET filename'],
            ['%vae%','VAE filename'],
            ['%vae_name%','Alias for %vae%'],
            ['%clip_name%','CLIP filename for single-CLIP loaders'],
            ['%clip_name1%','First CLIP for DualCLIPLoader (e.g. t5xxl)'],
            ['%clip_name2%','Second CLIP for DualCLIPLoader (e.g. clip_l)']
        ]},
        { title:'⚙️ Sampling (text)', items:[
            ['%sampler%','Sampler name (e.g. euler, dpmpp_2m)'],
            ['%scheduler%','Scheduler name (e.g. normal, karras, simple)']
        ]},
        { title:'🔢 Numeric', items:[
            ['%width%','Image width — adaptive aspect may override per scene'],
            ['%height%','Image height — adaptive aspect may override per scene'],
            ['%seed%','Random seed each call, unless Seed field is > 0'],
            ['%steps%','Sampler steps'],
            ['%cfg%','CFG / guidance value'],
            ['%scale%','Alias for %cfg%'],
            ['%denoise%','Denoise strength (0–1)'],
            ['%clip_skip%','CLIP skip layer value'],
            ['%batch%','Batch count (alias)'],
            ['%batch_size%','Batch size']
        ]},
        { title:'🖼️ Avatars (base64, for image-to-image / character routing)', items:[
            ['%char_avatar%','Main detected character avatar (first non-user)'],
            ['%user_avatar%','User\'s persona avatar'],
            ['%avatar_1%','Detected character slot 1'],
            ['%avatar_2%','Detected character slot 2'],
            ['%avatar_3%','Detected character slot 3'],
            ['%avatar_4%','Detected character slot 4'],
            ['%avatar_5%','Detected character slot 5'],
            ['%avatar_6%','Detected character slot 6'],
            ['%avatar_7%','Detected character slot 7'],
            ['%avatar_8%','Detected character slot 8']
        ]}
    ];
    if(namedAvatars.length){
        groups.push({
            title:'👤 Named avatars detected in this chat',
            items: namedAvatars.map(function(n){
                return ['%avatar_'+n+'%','Avatar for "'+n+'" (by character name)'];
            })
        });
    } else {
        groups.push({
            title:'👤 Named avatars',
            items:[
                ['%avatar_CharacterName%','Replace CharacterName with the exact display name of any character in the chat']
            ]
        });
    }

    var html='<div id="'+PH_WIDGET_ID+'" class="ai-ph-widget">'+
        '<div class="ai-ph-w-header" title="Drag to move">'+
            '<span class="ai-ph-w-grip">⋮⋮</span>'+
            '<b class="ai-ph-w-title">📋 Placeholders</b>'+
            '<span class="ai-ph-w-spacer"></span>'+
            '<span class="ai-ph-w-collapse" title="Collapse / expand">–</span>'+
            '<span class="ai-ph-w-close" title="Close">✕</span>'+
        '</div>'+
        '<div class="ai-ph-w-body">'+
            '<div class="ai-ph-w-hint">Click any pill to copy it, then paste into the workflow.</div>';
    groups.forEach(function(g){
        html+='<div class="ai-ph-group"><div class="ai-ph-group-title">'+esc(g.title)+'</div><div class="ai-ph-list">';
        g.items.forEach(function(it){
            var ph=it[0],desc=it[1];
            html+='<div class="ai-ph-row"><code class="ai-ph-pill" data-ph="'+esc(ph)+'" title="Click to copy">'+esc(ph)+'</code>'+
                  '<span class="ai-ph-desc">'+esc(desc)+'</span></div>';
        });
        html+='</div></div>';
    });
    html+='</div></div>';

    var $w=$(html);
    $('body').append($w);
    var widget=$w[0];

    // Restore saved position, clamping to viewport so it can't be off-screen
    var saved=null;
    try{ saved=JSON.parse(lsGet(PH_POS_KEY)||'null'); }catch(e){}
    var defaultLeft=Math.max(20,window.innerWidth-440);
    var defaultTop=80;
    var left=saved&&typeof saved.left==='number'?saved.left:defaultLeft;
    var top=saved&&typeof saved.top==='number'?saved.top:defaultTop;
    // Clamp into viewport (use widget's approximate width — measure after attach)
    var W=widget.offsetWidth||420, H=widget.offsetHeight||500;
    left=Math.min(Math.max(0,left), Math.max(0,window.innerWidth-W));
    top=Math.min(Math.max(0,top), Math.max(0,window.innerHeight-Math.min(H,80)));
    widget.style.left=left+'px';
    widget.style.top=top+'px';

    // Restore collapsed state
    if(lsGet(PH_COLLAPSED_KEY)==='1') $w.addClass('ai-ph-w-collapsed');

    // Close button
    $w.find('.ai-ph-w-close').on('click',function(e){ e.stopPropagation(); $w.remove(); });

    // Collapse toggle
    $w.find('.ai-ph-w-collapse').on('click',function(e){
        e.stopPropagation();
        $w.toggleClass('ai-ph-w-collapsed');
        lsSet(PH_COLLAPSED_KEY, $w.hasClass('ai-ph-w-collapsed')?'1':'0');
    });

    // Click-to-copy on pills (don't initiate drag from these)
    $w.find('.ai-ph-pill').on('mousedown touchstart',function(e){ e.stopPropagation(); });
    $w.find('.ai-ph-pill').on('click',function(e){
        e.stopPropagation();
        var ph=$(this).data('ph');
        var el=this;
        function flash(){ $(el).addClass('ai-ph-copied'); setTimeout(function(){ $(el).removeClass('ai-ph-copied'); },800); }
        try{
            if(navigator.clipboard&&navigator.clipboard.writeText){
                navigator.clipboard.writeText(ph).then(flash,function(){ flash(); });
            } else {
                var ta=document.createElement('textarea');
                ta.value=ph; document.body.appendChild(ta); ta.select();
                try{ document.execCommand('copy'); }catch(e2){}
                document.body.removeChild(ta); flash();
            }
        }catch(e3){ flash(); }
    });

    // Drag handling — works on mouse and touch
    var dragging=false,dx=0,dy=0;
    var header=$w.find('.ai-ph-w-header')[0];

    function onDown(ev){
        // Ignore drags initiated on the close/collapse controls
        var t=ev.target;
        if($(t).closest('.ai-ph-w-close,.ai-ph-w-collapse').length) return;
        dragging=true;
        var p=ev.touches?ev.touches[0]:ev;
        var r=widget.getBoundingClientRect();
        dx=p.clientX-r.left;
        dy=p.clientY-r.top;
        widget.classList.add('ai-ph-w-dragging');
        ev.preventDefault();
    }
    function onMove(ev){
        if(!dragging) return;
        var p=ev.touches?ev.touches[0]:ev;
        var nl=p.clientX-dx;
        var nt=p.clientY-dy;
        // Keep at least 40px of the header on-screen so user can always grab it back
        var ww=widget.offsetWidth, hh=widget.offsetHeight;
        nl=Math.min(Math.max(-ww+40, nl), window.innerWidth-40);
        nt=Math.min(Math.max(0, nt), window.innerHeight-30);
        widget.style.left=nl+'px';
        widget.style.top=nt+'px';
        if(ev.cancelable) ev.preventDefault();
    }
    function onUp(){
        if(!dragging) return;
        dragging=false;
        widget.classList.remove('ai-ph-w-dragging');
        // Persist position
        var r=widget.getBoundingClientRect();
        lsSet(PH_POS_KEY, JSON.stringify({ left:Math.round(r.left), top:Math.round(r.top) }));
    }

    header.addEventListener('mousedown',onDown);
    header.addEventListener('touchstart',onDown,{passive:false});
    document.addEventListener('mousemove',onMove);
    document.addEventListener('touchmove',onMove,{passive:false});
    document.addEventListener('mouseup',onUp);
    document.addEventListener('touchend',onUp);
    document.addEventListener('touchcancel',onUp);

    // Detach global listeners when widget is removed (avoid leaks across open/close)
    var mo=new MutationObserver(function(){
        if(!document.body.contains(widget)){
            document.removeEventListener('mousemove',onMove);
            document.removeEventListener('touchmove',onMove);
            document.removeEventListener('mouseup',onUp);
            document.removeEventListener('touchend',onUp);
            document.removeEventListener('touchcancel',onUp);
            mo.disconnect();
        }
    });
    mo.observe(document.body,{childList:true,subtree:true});
}

function bindUI(){
    var s=S();
    $('#ai_on').on('change',function(){s.enabled=$(this).prop('checked');saveSettingsDebounced();injectMsgButtons();});
    $('#ai_auto').on('change',function(){s.autoGenerate=$(this).prop('checked');saveSettingsDebounced();});
    $('#ai_direct').on('change',function(){s.preferDirectComfy=$(this).prop('checked');saveSettingsDebounced();});
    $('#ai_comp').on('change',function(){s.compressImages=$(this).prop('checked');saveSettingsDebounced();});
    $('#ai_savegal').on('change',function(){s.saveToGallery=$(this).prop('checked');saveSettingsDebounced();});
    $('#ai_prevframe').on('change',function(){s.prevFrameRef=$(this).prop('checked');saveSettingsDebounced();});
    $('#ai_galbtn').on('change',function(){s.showGalleryButton=$(this).prop('checked');toggleGalBtn();saveSettingsDebounced();});
    $('#ai_hide_prompts').on('change',function(){s.hidePrompts=$(this).prop('checked');applyHidePrompts();saveSettingsDebounced();});
    $('#ai_cnt').on('input',function(){s.imagesPerMessage=parseInt($(this).val());$('#ai_cnt_v').text(s.imagesPerMessage);saveSettingsDebounced();});
    $('#ai_gal_pos').on('change',function(){s.galleryPosition=$(this).val();applyGalPos();saveSettingsDebounced();});
    $('#ai_msg_pos').on('change',function(){s.msgBtnPosition=$(this).val();refreshMsgBtnPos();saveSettingsDebounced();});
    $('#ai_comfy_url').on('change',function(){s.comfyUrl=$(this).val().trim();comfyOptionsCache=null;saveSettingsDebounced();});

    $('#ai_url_detect').on('click',async function(){var st=$('#ai_url_status');st.text('Scanning…').css('color','#f59e0b');var urls=['http://127.0.0.1:7821','http://127.0.0.1:8188','http://localhost:7821','http://localhost:8188'];var sd2=extension_settings.sd||{};if(sd2.comfy_url)urls.unshift(sd2.comfy_url.replace(/\/+$/,''));var found=null;for(var i=0;i<urls.length;i++){try{var r=await fetch(urls[i]+'/system_stats',{signal:AbortSignal.timeout(3000)});if(r.ok){found=urls[i];break;}}catch(e){}}if(found){$('#ai_comfy_url').val(found);s.comfyUrl=found;comfyOptionsCache=null;saveSettingsDebounced();st.text('✅ '+found).css('color','#22c55e');}else st.text('❌ Not found').css('color','#ef4444');});
    $('#ai_url_test').on('click',async function(){var url=getComfyUrl();var st=$('#ai_url_status');st.text('Testing…').css('color','#f59e0b');try{var r=await fetch(url+'/system_stats',{signal:AbortSignal.timeout(5000)});if(r.ok){var d=await r.json();var info=[];if(d.system&&d.system.vram)info.push(Math.round(d.system.vram.total/1073741824)+'GB');st.text('✅ OK'+(info.length?' — '+info.join(', '):'')).css('color','#22c55e');}else st.text('❌ '+r.status).css('color','#ef4444');}catch(e){st.text('❌ '+e.message).css('color','#ef4444');}});

    $('#ai_preset_sel').on('change',function(){syncUIToPreset();setActive($(this).val());loadPresetToUI();});
    $('#ai_p_new').on('click',function(){var nm=prompt('Name:','New');if(!nm)return;var p=makePreset(nm);savePreset(p);setActive(p.id);rebuildPresetDD();loadPresetToUI();});
    $('#ai_p_ren').on('click',function(){var p=activePreset();if(!p)return;var nm=prompt('Name:',p.name);if(!nm)return;p.name=nm;savePreset(p);rebuildPresetDD();rebuildCharPresetDD();});
    $('#ai_p_dup').on('click',function(){var p=activePreset();if(!p)return;var np=JSON.parse(JSON.stringify(p));np.id=uid();np.name=p.name+' copy';np.charPresetId='';savePreset(np);setActive(np.id);rebuildPresetDD();loadPresetToUI();});
    $('#ai_p_del').on('click',function(){var p=activePreset();if(!p||!confirm('Delete "'+p.name+'"?'))return;if(chatPresetLink()===p.id)setChatPresetLink('');deletePresetById(p.id);rebuildPresetDD();loadPresetToUI();});

    var as=function(){syncUIToPreset();};
    $('#ai_prompt_fmt').on('change',function(){var k=$(this).val(),f=FORMATS[k];if(f){$('#ai_w').val(f.w);$('#ai_h').val(f.h);}updateFmtInfo();syncUIToPreset();});
    $('#ai_res_apply').on('click',function(){var k=$('#ai_prompt_fmt').val(),f=FORMATS[k];if(f){$('#ai_w').val(f.w);$('#ai_h').val(f.h);syncUIToPreset();}});
    $('#ai_w,#ai_h,#ai_p_model,#ai_p_vae,#ai_p_sampler,#ai_p_scheduler,#ai_p_steps,#ai_p_cfg,#ai_p_denoise,#ai_p_clipskip,#ai_p_clip,#ai_p_clip1,#ai_p_clip2,#ai_p_seed,#ai_p_batch').on('change',as);
    $('#ai_neg,#ai_custom_instr,#ai_sb_layout,#ai_sb_instructions,#ai_sb_avatar_workflow,#ai_wf_json').on('change',as);
    $('#ai_char_route').on('change',function(){syncUIToPreset();$('#ai_route_opts').toggle($(this).prop('checked'));});
    $('#ai_char_preset,#ai_adapt,#ai_char_desc').on('change',as);
    $('#ai_prompt_prefix').on('change',as);
    $('#ai_char_link').on('change',function(){
        var name=currentCharName(),p=activePreset();
        if(!name||!p)return;
        S().charPresetLinks=S().charPresetLinks||{};
        if($(this).prop('checked'))S().charPresetLinks[name]=p.id;
        else if(S().charPresetLinks[name]===p.id)delete S().charPresetLinks[name];
        saveSettingsDebounced();
    });
    $('#ai_chat_link').on('change',function(){
        var p=activePreset(),want=$(this).prop('checked');
        /* Unchecking only releases OUR link — a box that was never checked for
           this preset must not steal the link away from another one. */
        if(!p||(!want&&chatPresetLink()!==p.id)||!setChatPresetLink(want?p.id:''))$(this).prop('checked',false);
        syncChatLinkUI();
    });
    $('#ai_lora_on').on('change',function(){syncUIToPreset();$('#ai_lora_opts').toggle($(this).prop('checked'));});
    $('#ai_use_gemini').on('change',function(){syncUIToPreset();$('#ai_gemini_opts').toggle($(this).prop('checked'));});
    /* Speed profile and hi-res download are Gemini mechanics; hide them for ChatGPT. */
    $('#ai_bridge_engine').on('change',function(){syncUIToPreset();$('#ai_gemini_only').toggle($(this).val()!=='chatgpt');});
    $('#ai_gemini_port').on('change',as);
    $('#ai_gemini_mode').on('change',as);
    $('#ai_gemini_hires').on('change',as);
    $('#ai_gemini_charav').on('change',as);
    $('#ai_gemini_maxav').on('change',as);
    $('#ai_lora_max').on('change',as);
    $('#ai_lora_wstep').on('change',as);
    $('#ai_lora_manager_btn').on('click',openLoraManager);$('#ai_refresh_opts').on('click',refreshComfyDropdowns);

    // Load workflow JSON from a file
    $('#ai_wf_load').on('click',function(){$('#ai_wf_file').trigger('click');});
    $('#ai_wf_show_ph').on('click',togglePlaceholderWidget);
    $('#ai_wf_file').on('change',function(e){
        var file=e.target.files&&e.target.files[0]; if(!file) return;
        var status=$('#ai_wf_status');
        status.text('Reading…').css('color','#f59e0b');
        var reader=new FileReader();
        reader.onload=function(ev){
            var text=ev.target.result||'';
            try{
                // Validate JSON and warn if it looks like the UI-format
                var parsed=JSON.parse(text);
                var prettyStr;
                var isApiFmt=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&
                    Object.keys(parsed).some(function(k){return parsed[k]&&parsed[k].class_type;});
                if(!isApiFmt&&Array.isArray(parsed.nodes)){
                    status.text('⚠ UI format — use "Save (API Format)" in ComfyUI').css('color','#ef4444');
                    toastr.warning('This file is the ComfyUI UI workflow format. In ComfyUI, enable "Dev mode" in settings, then use "Save (API Format)" to export a workflow this extension can use.','AutoIllustrator',{timeOut:10000});
                    // Still drop the raw text into the textarea so the user can inspect it
                    prettyStr=JSON.stringify(parsed,null,2);
                } else {
                    prettyStr=JSON.stringify(parsed,null,2);
                    status.text('✅ Loaded '+file.name+' ('+Object.keys(parsed).length+' nodes)').css('color','#22c55e');
                }
                $('#ai_wf_json').val(prettyStr);
                syncUIToPreset();
            }catch(err){
                status.text('❌ '+err.message).css('color','#ef4444');
                toastr.error('Could not parse JSON: '+err.message,'AutoIllustrator');
            }
            // Reset input so loading the same file twice still triggers change
            $('#ai_wf_file').val('');
        };
        reader.onerror=function(){
            status.text('❌ Read failed').css('color','#ef4444');
        };
        reader.readAsText(file);
    });

    // Auto-place %placeholders% by detecting known ComfyUI node classes.
    // 'basic' replaces only %prompt%, %negative_prompt%, %width%, %height%, %seed%.
    // 'all' replaces every recognised field.
    function runAutoPlaceholders(mode){
        var current=$('#ai_wf_json').val()||'';
        var status=$('#ai_wf_status');
        var label=mode==='basic'?'Basic':'All';
        if(!current.trim()){
            status.text('No workflow loaded').css('color','#ef4444');
            toastr.warning('Load a workflow JSON first.','AutoIllustrator');
            return;
        }
        try{
            var result=autoPlaceholderWorkflow(current, mode);
            $('#ai_wf_json').val(result.json);
            syncUIToPreset();
            if(result.report.length){
                status.text('✅ '+label+': '+result.report.length+' placeholder'+(result.report.length===1?'':'s')+' applied').css('color','#22c55e');
                console.log(L,'Auto-placeholder ('+mode+') changes:\n'+result.report.join('\n'));
                toastr.success(label+' — '+result.report.length+' field'+(result.report.length===1?'':'s')+' replaced. See console for details.','AutoIllustrator',{timeOut:6000});
            } else {
                status.text(label+': no replaceable fields found').css('color','#f59e0b');
                toastr.info('No replaceable inputs detected for '+label+' mode — workflow may already use placeholders, or its node types are not recognised.','AutoIllustrator');
            }
        }catch(err){
            status.text('❌ '+err.message).css('color','#ef4444');
            toastr.error(err.message,'AutoIllustrator',{timeOut:10000});
        }
    }
    $('#ai_wf_autoph').on('click',function(){ runAutoPlaceholders('all'); });
    $('#ai_wf_autoph_basic').on('click',function(){ runAutoPlaceholders('basic'); });

    $('#ai_aon_add').on('click',function(){var f=$('#ai_aon_lora_input').val().trim(),t=$('#ai_aon_trigger_input').val().trim(),w=parseFloat($('#ai_aon_weight_input').val())||0.8;if(!f)return;addAlwaysOnLora(f,t,w);$('#ai_aon_lora_input').val('');$('#ai_aon_trigger_input').val('');$('#ai_aon_weight_input').val('0.8');});
    $(document).on('click','.ai-aon-remove',function(){removeAlwaysOnLora(parseInt($(this).data('idx')));});

    $('#ai_go').on('click',async function(){var ctx=getContext();for(var i=ctx.chat.length-1;i>=0;i--)if(!ctx.chat[i].is_user&&!ctx.chat[i].is_system){if(ctx.chat[i].extra&&ctx.chat[i].extra.autoIllustrator)ctx.chat[i].extra.autoIllustrator.processed=false;await processMessage(i);return;}});
    $('#ai_redo').on('click',async function(){var ctx=getContext();for(var i=ctx.chat.length-1;i>=0;i--)if(ctx.chat[i].extra&&ctx.chat[i].extra.autoIllustrator&&ctx.chat[i].extra.autoIllustrator.processed){ctx.chat[i].extra.autoIllustrator.processed=false;await processMessage(i);return;}});
    $('#ai_clr').on('click',function(){var ctx=getContext();for(var i=ctx.chat.length-1;i>=0;i--)if(ctx.chat[i].extra&&ctx.chat[i].extra.autoIllustrator){delete ctx.chat[i].extra.autoIllustrator;$('#chat .mes[mesid="'+i+'"] .mes_text .ai-illustration-wrapper').remove();ctx.saveChat();updateGalBadge();return;}});

    $(document).on('click','.ai-msg-btn',function(e){
        e.stopPropagation();
        e.preventDefault();
        if(!S().enabled) return;
        var mi=parseInt($(this).data('mi'));
        if(isNaN(mi)||processing.has(mi)) return;
        var ctx=getContext();

        // VN mode: illustrate ONLY the currently-visible chunk and place the
        // image directly after it, instead of running the multi-section
        // analyser over the whole message (which puts the image at the end).
        try{
            if(window.LLMTools&&typeof window.LLMTools.isVnMode==='function'&&window.LLMTools.isVnMode()){
                var chunkText=window.LLMTools.getCurrentVnChunkText&&window.LLMTools.getCurrentVnChunkText();
                var chunkIdx=window.LLMTools.getCurrentVnChunkIndex&&window.LLMTools.getCurrentVnChunkIndex();
                if(chunkText&&typeof chunkIdx==='number'){
                    processVnChunk(mi, chunkText, chunkIdx);
                    return;
                }
            }
        }catch(err){ console.warn(L,'VN detection failed, falling back:',err); }

        if(ctx.chat[mi]&&ctx.chat[mi].extra&&ctx.chat[mi].extra.autoIllustrator)
            ctx.chat[mi].extra.autoIllustrator.processed=false;
        processMessage(mi);
    });
    $(document).on('click','.ai-cancel-btn',function(){var c=controllers.get(parseInt($(this).data('ai-cancel')));if(c)c.abort();});
    $(document).on('click','.ai-illustration-img',function(e){e.stopPropagation();var lb=$('<div class="ai-lightbox-overlay"><div class="ai-lightbox-close">✕</div><img src="'+$(this).attr('src')+'"/></div>');$('body').append(lb);lb.on('click',function(){lb.remove();});});
    $(document).on('click','.ai-illustration-caption',function(){navigator.clipboard.writeText($(this).attr('title')||$(this).text());});
}

/* ============ INIT ============ */
jQuery(async function(){
    var tgt=$('#extensions_settings2').length?$('#extensions_settings2'):$('#extensions_settings');
    tgt.append(buildUI());loadSettings();await installMossAvatarPreset();settingsToUI();bindUI();injectMsgBtnCSS();
    eventSource.on(event_types.MESSAGE_RECEIVED,onMsg);eventSource.on(event_types.CHAT_CHANGED,onChat);
    try{eventSource.on(event_types.MESSAGE_SWIPED,function(mi){
        // Abort any in-flight generation for the swiped message — otherwise it
        // finishes against the OLD swipe's text and attaches mismatched images.
        var n=typeof mi==='number'?mi:parseInt(mi);
        if(!isNaN(n)){var c=controllers.get(n);if(c)c.abort();}
        setTimeout(reRenderAll,800);
    });}catch(e){}
    try{if(typeof SlashCommandParser!=='undefined'&&typeof SlashCommand!=='undefined')SlashCommandParser.addCommandObject(SlashCommand.fromProps({name:'illustrate',callback:async function(){var c=getContext(),i=c.chat.length-1;if(i>=0){if(c.chat[i].extra&&c.chat[i].extra.autoIllustrator)c.chat[i].extra.autoIllustrator.processed=false;await processMessage(i);}return'';},helpString:'Illustrate last msg.'}));}catch(e){}
    toggleGalBtn();reRenderAll();
    var chatEl=document.getElementById('chat');
    if(chatEl){var t=null;new MutationObserver(function(){setTimeout(injectMsgButtons,300);if(t)clearTimeout(t);t=setTimeout(checkMissing,800);}).observe(chatEl,{childList:true,subtree:true});}
    setTimeout(function(){injectMsgButtons();fetchComfyOptions().then(function(o){populateDatalist('ai_dl_models',o.models);populateDatalist('ai_dl_samplers',o.samplers);populateDatalist('ai_dl_schedulers',o.schedulers);populateDatalist('ai_dl_vaes',o.vaes);populateDatalist('ai_dl_loras',o.loras);populateDatalist('ai_dl_clips',o.clips||[]);});},2000);
    setInterval(checkMissing,5000);

    /* ── v3.7: public API. Other extensions (Character Library's Hook Forge,
       Character Creator, Scene Director…) can illustrate arbitrary text with
       the user's own presets/LoRAs without owning an image pipeline. ── */
    window.AutoIllustrator=window.AutoIllustrator||{};
    window.AutoIllustrator.version=AI_VERSION;
    window.AutoIllustrator.isReady=function(){var p=activePreset();return !!(p&&(p.workflow||p.useGemini));};
    /* `usable` ("has some backend") is what a storyboard preset picker wants
       since v3.18 — the door takes any preset that can draw at all. `gemini`
       stays published for callers that still want to KNOW which backend they
       are getting (an instruction-following model holds a strict grid far
       more reliably than a diffusion workflow). */
    window.AutoIllustrator.getPresets=function(){
        return presets().map(function(p){
            var grid=presetStoryboardGrid(p);
            return {id:p.id,name:p.name,active:p.id===S().activePresetId,usable:!!(p.workflow||p.useGemini),gemini:!!p.useGemini,
                storyboardPanelCount:grid?grid[0]*grid[1]:null,storyboardUsesRefImages:storyboardUsesRefImages(p),
                storyboardUsesCharacterAvatar:storyboardUsesCharacterAvatar(p)};
        });
    };
    /* avatarsFor(['Vergil','Lauryl','__user__']) -> { name: base64 }
       Only the cards actually named, only if they exist. Prefer this over
       letting illustrateText collect avatars itself whenever you already know
       who is in the picture: collectAllAvatars() leads with the open chat's
       card, which in a location/narrator chat is a building. */
    window.AutoIllustrator.avatarsFor=function(names){return avatarsForNames(names);};
    /* illustrateText({ text, count, presetId, charName, charDescriptions, charNames, signal, onStatus, width, height, skipAnalysis, avatarMap, refImages })
       width+height (both, in px): explicit output size — outranks the preset
       dimensions and the adaptive aspect pass, snapped to /64.
       skipAnalysis: text IS the image prompt; no LLM round-trip. For callers
       that already know exactly what they want drawn.
       refImages: [{ image, role, name }] — reference pictures that are not
       avatars. role is 'character' | 'scene' | 'object' | 'previous' (the
       previous storyboard page: continuity of wardrobe/place/style, explicitly
       NOT a layout to copy) and decides what the
       backend is TOLD the picture is; up to 4, never gated by the preset's
       avatar toggle. Gemini gets them as extra attachments with an ordered
       manifest; a ComfyUI workflow gets %ref_1%…%ref_4% and %scene_ref%
       (inert unless the workflow mentions them).
       resolves to an array of parts: { imagePrompt, finalPrompt, image (base64), characters, loras, … } */
    window.AutoIllustrator.illustrateText=async function(opts){
        opts=opts||{};
        /* external callers (Hook Forge etc.) store results themselves —
           don't double-post to the gallery unless they ask for it */
        if(opts.mirrorToGallery===undefined)opts.mirrorToGallery=false;
        var res=await illustrateText(opts);
        return res.parts;
    };
    window.AutoIllustrator.illustrateMessage=function(mi){return processMessage(mi);};
    /* illustrateStoryboard({ panels, refImages, presetId, width, height,
       signal, onStatus, compress, mirrorToGallery, autoLayout }) — ONE sheet.
       Auto uses 1–12 panels with a layout based on the page aspect ratio.
       Fixed layouts use full rectangles of 1, 2, 3, 4, 6, 8, 9, or 12 panels. Any preset
       with a backend (v3.18; before that, Gemini only) — but only an
       instruction-following model reliably HOLDS a grid, so anything else
       tends to land in the verified:false tier below. refImages are the
       caller's likeness contract; the sheet collects NO avatars on its own.
       Resolves to { image (base64), rows, cols, verified, xs, ys, panels }:
       - In Auto mode verified=true means exactly panels.length rects were detected
         for the requested panel count, and cropping always uses those rects.
       - With fixed layouts verified=true means the sheet holds the requested grid. xs/ys are one
         normalised [start,end] RANGE PER CELL (v3.17; before that, boundary
         points) with the gutter and any outer white frame excluded — crop to
         the range, do not split at a line, or half the gutter shows along
         the panel edge. xs has `cols` entries, ys has `rows`.
       - panels (v3.18): [[x1,y1,x2,y2]…] normalised rects in reading order —
         the layout ACTUALLY drawn. May be present even when verified=false:
         the model redrew the grid its own way (a real Gemini answered a 2x4
         request with a 3x3 sheet), and cropping these rects still shows one
         real panel per index. Prefer panels over xs/ys whenever present.
       - verified=false with no panels: nothing croppable was found — show
         the whole sheet. */
    window.AutoIllustrator.illustrateStoryboard=function(opts){return illustrateStoryboard(opts);};
    window.AutoIllustrator.storyboardAutoLayout=true;
    /* analyzeStoryboardSheet(src, rows, cols) — the grid analysis alone, for
       a sheet that already exists (src: anything an <img src> takes). Same
       result fields as illustrateStoryboard minus `image`. Lets a caller
       re-read sheets it stored before v3.18 and pick up `panels` without
       regenerating anything. v3.24.1: opts.exactCount re-reads an Auto page
       (exactly that many panels; its rows are derived from the count and the
       sheet's orientation unless opts.rowPanels gives them). */
    window.AutoIllustrator.analyzeStoryboardSheet=function(src,rows,cols,opts){
        var n=opts&&parseInt(opts.exactCount,10)>0?parseInt(opts.exactCount,10):null;
        return analyzeStoryboardGrid(src,rows,cols,n,n&&opts&&opts.rowPanels);
    };
    /* Which generation of the grid reader this is — so a caller holding a
       sheet that an OLDER reader misjudged knows a re-read is worth asking
       for (2 = v3.22.2: several sizes, one-axis fallback; 3 = v3.24.1:
       captions inside gutters, inset panels merged into their neighbour). */
    window.AutoIllustrator.storyboardAnalyzer=STORYBOARD_ANALYZER;
    /* attachImageToMessage(mi, { image, prompt, text }) — pin an already
       generated image (base64, data: URL or /user/images path) onto a message
       so it renders exactly like an auto-illustration: zoomable, saved with the
       chat, self-healing via checkMissing. Used by Character Library's Story
       Hooks to place the hook art on the opening message. */
    window.AutoIllustrator.attachImageToMessage=function(mi,opts){
        opts=opts||{};if(!opts.image)return false;
        try{
            var ctx=getContext();var msg=ctx.chat&&ctx.chat[mi];if(!msg)return false;
            msg.extra=msg.extra||{};
            var ai=msg.extra.autoIllustrator||{processed:true,preset:'external',timestamp:Date.now(),sections:[],vnChunks:[]};
            ai.sections=ai.sections||[];
            ai.sections.push({
                text:opts.text||msg.mes||'',
                imagePrompt:opts.prompt||'',
                finalPrompt:opts.prompt||'',
                image:opts.image,
                hasChar:false,personCount:0,characters:[],loras:[],external:true
            });
            ai.processed=true;
            msg.extra.autoIllustrator=ai;
            renderIll(mi);
            try{ctx.saveChat();}catch(e){}
            updateGalBadge();
            return true;
        }catch(e){console.error(L,'attachImageToMessage',e);return false;}
    };

    /* §4.0: this extension loads at 200, later than almost everything that
       wants to draw through it. A consumer that asked once on its own init
       decided forever that there is no illustrator — so the facade announces
       itself, exactly like auto-background does. */
    try{if(typeof document!=='undefined'&&typeof CustomEvent==='function')document.dispatchEvent(new CustomEvent('autoillustrator:ready',{detail:{version:AI_VERSION}}));}catch(e){}

    console.log(L,'v'+AI_VERSION+' loaded — storyboard reads the drawn grid, takes any usable preset, and keeps continuity from the previous page');
});
