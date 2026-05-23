/**
 * AutoIllustrator v3.3
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
    saveSettingsDebounced, generateQuietPrompt,
} from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

var M = 'auto_illustrator';
var L = '[AutoIllustrator]';
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
var FORMATS = {
    flux:{l:'Flux',w:1152,h:896,neg:'',
        inst:'Vivid natural-language prompt. Subject, scene, lighting, mood, camera, style.'},
    flux2klein:{l:'Flux 2 Klein',w:1024,h:768,neg:'',
        inst:'Concise prompt (1-2 sentences).'},
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
    custom:{l:'Custom',w:1024,h:768,neg:'',inst:''},

    /* ——— POV ——— */
    pov_flux:{l:'POV — Flux',w:1152,h:896,neg:'',
        inst:'First-person POV vivid natural-language prompt. The image shows EXACTLY what the viewer (user/player) sees through their own eyes. '+
             'Characters FACE the viewer/camera and react to them. '+
             'Describe viewer\'s hands/arms ONLY if they physically interact — NEVER their face, hair, or full body. '+
             'Include: characters\' expressions directed at viewer, spatial depth, lighting, mood, camera angle (looking down=from_above, looking up=from_below). Style and atmosphere.'},
    pov_flux2klein:{l:'POV — Flux 2 Klein',w:1024,h:768,neg:'',
        inst:'Concise first-person POV prompt (1-2 sentences). Scene through viewer\'s eyes, characters face camera. No viewer face/body.'},
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
};

var POSITIONS={'top-left':{l:'↖ Top Left',css:'top:8px;left:8px;bottom:auto;right:auto;'},'top-center':{l:'↑ Top Center',css:'top:8px;left:50%;transform:translateX(-50%);bottom:auto;right:auto;'},'top-right':{l:'↗ Top Right',css:'top:8px;right:8px;bottom:auto;left:auto;'},'mid-left':{l:'← Mid Left',css:'top:50%;left:8px;transform:translateY(-50%);bottom:auto;right:auto;'},'mid-right':{l:'→ Mid Right',css:'top:50%;right:8px;transform:translateY(-50%);bottom:auto;left:auto;'},'bottom-left':{l:'↙ Bot Left',css:'bottom:8px;left:8px;top:auto;right:auto;'},'bottom-center':{l:'↓ Bot Center',css:'bottom:8px;left:50%;transform:translateX(-50%);top:auto;right:auto;'},'bottom-right':{l:'↘ Bot Right',css:'bottom:8px;right:8px;top:auto;left:auto;'}};
var MSG_POSITIONS={'top-left':{l:'↖',css:'top:4px;left:4px;bottom:auto;right:auto;'},'top-right':{l:'↗',css:'top:4px;right:4px;bottom:auto;left:auto;'},'mid-right':{l:'→',css:'top:50%;right:4px;transform:translateY(-50%);bottom:auto;left:auto;'},'bottom-left':{l:'↙',css:'bottom:4px;left:4px;top:auto;right:auto;'},'bottom-right':{l:'↘',css:'bottom:4px;right:4px;top:auto;left:auto;'}};

/* ============ DEFAULTS ============ */
var DEFAULTS={enabled:false,autoGenerate:true,imagesPerMessage:2,preferDirectComfy:true,compressImages:true,compressionQuality:0.82,maxStoredImageWidth:1024,generateTimeoutMs:180000,minMessageLength:80,showGalleryButton:true,workflowPresets:[],activePresetId:'',galleryPosition:'mid-right',msgBtnPosition:'bottom-right',comfyUrl:'',hidePrompts:false};
var PRESET_DEFAULTS={name:'Untitled',workflow:'',promptFormat:'flux',customInstructions:'',negativePrompt:'',width:1024,height:768,model:'',vae:'',sampler:'',scheduler:'',steps:0,cfg:0,denoise:1,clipSkip:0,clipName:'',clipName1:'',clipName2:'',seed:0,batchSize:1,enableLoraMatching:false,loraLibraryText:'',maxLorasPerImage:2,alwaysOnLoras:[],enableCharRouting:false,charPresetId:'',adaptiveAspect:true,useCharDescription:true};

function S(){return extension_settings[M];}
function loadSettings(){
    extension_settings[M]=extension_settings[M]||{};var s=extension_settings[M];
    for(var k in DEFAULTS)if(DEFAULTS.hasOwnProperty(k)&&s[k]===undefined)s[k]=DEFAULTS[k];
    (s.workflowPresets||[]).forEach(function(p){for(var pk in PRESET_DEFAULTS)if(PRESET_DEFAULTS.hasOwnProperty(pk)&&p[pk]===undefined)p[pk]=JSON.parse(JSON.stringify(PRESET_DEFAULTS[pk]));});
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

function syncUIToPreset(){var p=activePreset();if(!p)return;p.workflow=$('#ai_wf_json').val()||'';p.promptFormat=$('#ai_prompt_fmt').val()||'flux';p.customInstructions=$('#ai_custom_instr').val()||'';p.negativePrompt=$('#ai_neg').val()||'';p.width=parseInt($('#ai_w').val())||1024;p.height=parseInt($('#ai_h').val())||768;p.model=$('#ai_p_model').val()||'';p.vae=$('#ai_p_vae').val()||'';p.sampler=$('#ai_p_sampler').val()||'';p.scheduler=$('#ai_p_scheduler').val()||'';p.steps=parseInt($('#ai_p_steps').val())||0;p.cfg=parseFloat($('#ai_p_cfg').val())||0;p.denoise=parseFloat($('#ai_p_denoise').val());if(isNaN(p.denoise))p.denoise=1;p.clipSkip=parseInt($('#ai_p_clipskip').val())||0;p.clipName=$('#ai_p_clip').val()||'';p.clipName1=$('#ai_p_clip1').val()||'';p.clipName2=$('#ai_p_clip2').val()||'';p.seed=parseInt($('#ai_p_seed').val())||0;p.batchSize=parseInt($('#ai_p_batch').val())||1;p.enableLoraMatching=$('#ai_lora_on').prop('checked');p.loraLibraryText=$('#ai_lora_lib').val()||'';p.maxLorasPerImage=parseInt($('#ai_lora_max').val())||2;p.enableCharRouting=$('#ai_char_route').prop('checked');p.charPresetId=$('#ai_char_preset').val()||'';p.adaptiveAspect=$('#ai_adapt').prop('checked');p.useCharDescription=$('#ai_char_desc').prop('checked');savePreset(p);}

function loadPresetToUI(){var p=activePreset();$('#ai_wf_json').val(p?p.workflow:'');$('#ai_prompt_fmt').val(p?p.promptFormat:'flux');$('#ai_custom_instr').val(p?p.customInstructions:'');$('#ai_neg').val(p?p.negativePrompt:'');$('#ai_w').val(p?p.width:1024);$('#ai_h').val(p?p.height:768);$('#ai_p_model').val(p?p.model||'':'');$('#ai_p_vae').val(p?p.vae||'':'');$('#ai_p_sampler').val(p?p.sampler||'':'');$('#ai_p_scheduler').val(p?p.scheduler||'':'');$('#ai_p_steps').val(p&&p.steps?p.steps:'');$('#ai_p_cfg').val(p&&p.cfg?p.cfg:'');$('#ai_p_denoise').val(p?p.denoise:1);$('#ai_p_clipskip').val(p&&p.clipSkip?p.clipSkip:'');$('#ai_p_clip').val(p?p.clipName||'':'');$('#ai_p_clip1').val(p?p.clipName1||'':'');$('#ai_p_clip2').val(p?p.clipName2||'':'');$('#ai_p_seed').val(p&&p.seed?p.seed:'');$('#ai_p_batch').val(p?p.batchSize||1:1);$('#ai_lora_on').prop('checked',p?!!p.enableLoraMatching:false);$('#ai_lora_opts').toggle(p?!!p.enableLoraMatching:false);$('#ai_lora_lib').val(p?p.loraLibraryText||'':'');$('#ai_lora_max').val(p?p.maxLorasPerImage||2:2);$('#ai_char_route').prop('checked',p?!!p.enableCharRouting:false);$('#ai_route_opts').toggle(p?!!p.enableCharRouting:false);rebuildCharPresetDD();$('#ai_char_preset').val(p?p.charPresetId||'':'');$('#ai_adapt').prop('checked',p?p.adaptiveAspect!==false:true);$('#ai_char_desc').prop('checked',p?p.useCharDescription!==false:true);renderAlwaysOnList();updateFmtInfo();}

function rebuildPresetDD(){var sel=$('#ai_preset_sel');sel.empty();if(!presets().length)sel.append('<option value="">—</option>');presets().forEach(function(p){sel.append('<option value="'+p.id+'">'+esc(p.name)+'</option>');});sel.val(S().activePresetId||'');}
function rebuildCharPresetDD(){var sel=$('#ai_char_preset');sel.empty();sel.append('<option value="">— same —</option>');var a=activePreset();presets().forEach(function(p){if(a&&p.id===a.id)return;sel.append('<option value="'+p.id+'">'+esc(p.name)+'</option>');});if(a)sel.val(a.charPresetId||'');}

/* ============ UTIL ============ */
function esc(t){if(!t)return'';var e=document.createElement('span');e.textContent=t;return e.innerHTML;}
function escJ(s){if(!s)return'';return s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t').replace(/[\x00-\x1f]/g,'');}
function extractJSON(t){if(!t)return null;var c=t.replace(/```(?:json)?\s*/gi,'').replace(/```/g,'');var f=c.indexOf('{'),l=c.lastIndexOf('}');if(f<0||l<=f)return null;var j=c.substring(f,l+1).replace(/,\s*([}\]])/g,'$1');try{return JSON.parse(j);}catch(e){}try{return JSON.parse(j.replace(/'/g,'"'));}catch(e){}return null;}
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
async function collectAllAvatars(){
    var ctx=getContext(),map={};try{var chId=ctx.characterId;if(chId!==undefined&&ctx.characters&&ctx.characters[chId]){var ch=ctx.characters[chId];if(ch.name&&ch.avatar){var b=await fetchAvatarBase64(ch.avatar,'char');if(b){map[ch.name]=b;console.log(L,'Avatar:',ch.name);}}}
    if(ctx.groupId&&ctx.groups){var group=ctx.groups.find(function(g){return g.id===ctx.groupId;});if(group&&group.members){for(var mi=0;mi<group.members.length;mi++){var memberId=group.members[mi],member=null;for(var ci=0;ci<(ctx.characters||[]).length;ci++){if(ctx.characters[ci].avatar===memberId||ctx.characters[ci].name===memberId){member=ctx.characters[ci];break;}}if(member&&member.name&&member.avatar&&!map[member.name]){var mb=await fetchAvatarBase64(member.avatar,'char');if(mb){map[member.name]=mb;console.log(L,'Avatar:',member.name);}}}}}
    var ua=ctx.user_avatar||ctx.userAvatar;if(ua){var ub=await fetchAvatarBase64(ua,'user');if(ub)map['__user__']=ub;}}catch(e){console.error(L,'Avatar error:',e);}return map;
}

/* ============ ADAPTIVE ASPECT ============ */
function adaptDimensions(bW,bH,pc){var w=bW||1024,h=bH||768,a=w*h;if(pc<=1){w=Math.round(Math.sqrt(a*3/4));h=Math.round(Math.sqrt(a*4/3));}else if(pc>=4){w=Math.round(Math.sqrt(a*3/2));h=Math.round(Math.sqrt(a*2/3));}w=Math.round(w/64)*64;h=Math.round(h/64)*64;return{w:Math.max(256,w),h:Math.max(256,h)};}

/* ============ LORA ============ */
function parseLoraLibrary(text){if(!text)return[];return text.split('\n').map(function(line){line=line.trim();if(!line||line.startsWith('#'))return null;var p=line.split('|').map(function(s){return s.trim();});if(p.length<2||!p[0])return null;return{file:p[0],tags:p[1]||'',trigger:p[2]||'',weight:parseFloat(p[3])||0.8};}).filter(Boolean);}
function buildLoraPromptBlock(library,max){if(!library.length)return{block:'',field:''};var lines=library.map(function(l,i){return(i+1)+'. "'+l.file+'" ['+l.tags+']';});return{block:'\nLORA SELECTION: 0-'+max+' per scene. "loras":["filename"].\n'+lines.join('\n')+'\n',field:',"loras":[]'};}
function injectLorasIntoWorkflow(wfObj,loras){
    if(!loras||!loras.length)return wfObj;var wf=JSON.parse(JSON.stringify(wfObj));
    var sourceId=null;for(var n in wf){var ct=wf[n].class_type;if(ct==='CheckpointLoaderSimple'||ct==='CheckpointLoader'){sourceId=n;break;}}
    if(!sourceId)for(var n2 in wf)if(wf[n2].class_type==='UNETLoader'){sourceId=n2;break;}
    if(!sourceId){console.warn(L,'No checkpoint');return wf;}
    var LT=['LoraLoader','LoraLoaderModelOnly'];function isL(id){return wf[id]&&LT.indexOf(wf[id].class_type)>=0;}
    function nextL(from){for(var id in wf){if(!isL(id))continue;var mi=wf[id].inputs.model;if(mi&&String(mi[0])===String(from))return id;}return null;}
    var end=sourceId,nx;while((nx=nextL(end))!==null)end=nx;
    var cons=[];for(var id in wf){if(id===end||isL(id))continue;var inp=wf[id].inputs;for(var k in inp){var v=inp[k];if(Array.isArray(v)&&v.length>=2&&String(v[0])===String(end)&&(v[1]===0||v[1]===1))cons.push({nid:id,key:k,oi:v[1]});}}
    var mx=0;for(var id in wf){var nn=parseInt(id);if(!isNaN(nn)&&nn>mx)mx=nn;}
    var prev=String(end),last=null;
    loras.forEach(function(lr,i){var nid=String(mx+5000+i);wf[nid]={inputs:{lora_name:lr.file,strength_model:lr.weight!==undefined?lr.weight:0.8,strength_clip:lr.weight!==undefined?lr.weight:0.8,model:[prev,0],clip:[prev,1]},class_type:'LoraLoader',_meta:{title:'AI-LoRA '+lr.file.substring(0,30)}};prev=nid;last=nid;});
    if(last)cons.forEach(function(c){wf[c.nid].inputs[c.key]=[last,c.oi];});return wf;
}

function renderAlwaysOnList(){var p=activePreset();var list=p?p.alwaysOnLoras||[]:[];var c=$('#ai_aon_list');c.empty();if(!list.length){c.html('<small style="color:#888;font-style:italic">None</small>');return;}list.forEach(function(e,idx){var name=e.file.replace(/\.(safetensors|ckpt|pt|bin)$/i,'');c.append('<div style="display:flex;gap:4px;align-items:center;margin:2px 0;padding:3px 6px;background:var(--SmartThemeBlurTintColor,rgba(50,50,50,0.3));border-radius:4px;font-size:.82em"><span style="flex:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(e.file)+'">🔮 '+esc(name)+'</span><span style="flex:1;color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(e.trigger||'—')+'</span><span style="width:40px;text-align:center;color:#8cf">'+e.weight+'</span><span class="ai-aon-remove" data-idx="'+idx+'" style="cursor:pointer;color:#f66;font-size:1.1em">✕</span></div>');});}
function addAlwaysOnLora(f,t,w){if(!f)return;var p=activePreset();if(!p)return;if(!p.alwaysOnLoras)p.alwaysOnLoras=[];if(p.alwaysOnLoras.some(function(e){return e.file===f;})){toastr.warning('Already added.');return;}p.alwaysOnLoras.push({file:f,trigger:t||'',weight:w||0.8});savePreset(p);renderAlwaysOnList();}
function removeAlwaysOnLora(i){var p=activePreset();if(!p||!p.alwaysOnLoras)return;if(i>=0&&i<p.alwaysOnLoras.length){p.alwaysOnLoras.splice(i,1);savePreset(p);renderAlwaysOnList();}}
async function fetchLoraList(){var base=getComfyUrl(),lr=[];async function t(n){try{var r=await fetch(base+'/object_info/'+n);if(r.ok){var d=await r.json();if(d[n])((d[n].input.required.lora_name||[[]])[0]||[]).forEach(function(l){if(lr.indexOf(l)<0)lr.push(l);});}}catch(e){}}await t('LoraLoader');await t('SwarmLoraLoader');await t('LoraLoaderModelOnly');return lr;}
async function onFetchLoras(){toastr.info('Fetching…');var lr=await fetchLoraList();if(!lr.length){toastr.warning('No LoRAs.');return;}populateDatalist('ai_dl_loras',lr);var p=activePreset();if(!p)return;var ex=parseLoraLibrary(p.loraLibraryText);var ef=ex.map(function(l){return l.file;});var cur=(p.loraLibraryText||'').trim(),nc=0;lr.forEach(function(n){if(ef.indexOf(n)<0){cur+=(cur?'\n':'')+n+' |  |  | 0.8';nc++;}});p.loraLibraryText=cur;$('#ai_lora_lib').val(cur);savePreset(p);toastr.success(lr.length+' LoRAs, '+nc+' new.');}

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
function buildPrompt(text,n,fmtKey,customInstr,charName,routing,adaptive,loraLib,maxLoras,charDesc,charNames){
    var fmt=FORMATS[fmtKey]||FORMATS.flux;var pov=isPOVFormat(fmtKey);var userName=getUserName();
    var ib=customInstr&&customInstr.trim()?customInstr:fmt.inst?'STYLE ("'+fmt.l+'"): '+fmt.inst:'Create visual prompts.';
    var povBlock='';
    if(pov){povBlock='\n═══ POV (FIRST-PERSON VIEW) RULES ═══\nThe viewer is "'+userName+'". Every image prompt MUST be from their first-person perspective.\n• The image = what '+userName+' sees through their own eyes.\n• Characters FACE the viewer/camera.\n• NEVER describe '+userName+'\'s face, hair, or full body.\n• Hands/arms ONLY when physically interacting.\n• "person_count" = visible characters only — NOT the viewer.\n• "characters" = do NOT include '+userName+'.\n═══════════════════════════════════\n';}
    var cB='',cF='';if(routing&&charName){cB='\nCHARACTER ROUTING: "'+charName+'". "has_char":true if visually present.\n';cF=',"has_char":true/false';}
    var pB='',pF='';if(adaptive){pB='\nPERSON COUNT: "person_count":N'+(pov?' (NOT the viewer)':'')+'.\n';pF=',"person_count":N';}
    var lB='',lF='';if(loraLib&&loraLib.length){var lb=buildLoraPromptBlock(loraLib,maxLoras||2);lB=lb.block;lF=lb.field;}
    var cdB=buildCharDescBlock(charDesc);
    var charDetect='',charField=',"characters":[]';
    if(charNames&&charNames.length){charDetect='\nCHARACTER DETECTION: Known: '+charNames.join(', ')+'\n"characters":["Name1","Name2"] — visually present only.'+(pov?'\nDo NOT list "'+userName+'" — they are the viewer.':'')+'\n';}
    var cR=pov?'\nCHARACTER+POV RULES:\n- Include base visual traits for visible characters.\n- Characters FACE the viewer.\n- Never describe '+userName+' as visible.\n':'\nCHARACTER RULES:\n- ALWAYS include base visual traits from references.\n- Story changes override ONLY that attribute.\n- Never omit appearance.\n';
    return'You are a specialist that splits text into illustrated sections with image prompts.\n\nTASK: '+n+' section(s).\n\n'+ib+'\n'+povBlock+cdB+cB+pB+charDetect+lB+cR+
        '\nRULES:\n1. "text"=EXACT VERBATIM. 2. All sections=entire text. 3. Natural splits. 4. Visual prompts. 5. ONLY JSON.\n\n'+
        'FORMAT: {"sections":[{"text":"...","image_prompt":"..."'+cF+pF+charField+lF+'}]}\n\n--- TEXT ---\n'+text+'\n--- END ---';
}

async function analyseMessage(text,n,fmtKey,customInstr,charName,routing,adaptive,loraLib,maxLoras,charDesc,charNames){
    var prompt=buildPrompt(text,n,fmtKey,customInstr,charName,routing,adaptive,loraLib,maxLoras,charDesc,charNames);
    var raw=null;try{raw=await generateQuietPrompt(prompt,false,false);}catch(e1){try{raw=await generateQuietPrompt(prompt,false,true);}catch(e2){toastr.error('LLM error.');return null;}}
    if(!raw)return null;var parsed=extractJSON(raw);if(!parsed||!parsed.sections||!parsed.sections.length)return null;
    var valid=parsed.sections.filter(function(s){return s&&typeof s.text==='string'&&typeof s.image_prompt==='string';});
    var pov=isPOVFormat(fmtKey);
    valid.forEach(function(s,i){var info=[];if(pov)info.push('POV');if(s.characters&&s.characters.length)info.push('chars=['+s.characters.join(',')+']');if(s.person_count)info.push('p='+s.person_count);if(s.has_char!==undefined)info.push('route='+(s.has_char?'CHAR':'env'));if(s.loras&&s.loras.length)info.push('lora=['+s.loras.join(',')+']');console.log(L,'Sec '+(i+1)+':',(info.length?info.join(' '):''),'→ "'+s.image_prompt.substring(0,80)+'…"');});
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
function doFillWorkflow(tplStr,promptText,negText,preset,avatarMap,detectedChars,overrideWH){
    var sd=extension_settings.sd||{},p=preset||{};var t=typeof tplStr==='string'?tplStr:JSON.stringify(tplStr);
    function v(pv,k1,k2,def){if(pv)return pv;if(k1&&sd[k1])return sd[k1];if(k2&&sd[k2])return sd[k2];return def||'';}
    var strMap={'%prompt%':escJ(promptText),'%negative_prompt%':escJ(negText),'%model%':escJ(v(p.model,'comfy_model','model','')),'%vae%':escJ(v(p.vae,'comfy_vae','vae','')),'%vae_name%':escJ(v(p.vae,'comfy_vae','vae','')),'%sampler%':escJ(v(p.sampler,'comfy_sampler','sampler','euler')),'%scheduler%':escJ(v(p.scheduler,'comfy_scheduler','scheduler','normal')),'%clip_name%':escJ(v(p.clipName,'comfy_clip','clip','')),'%clip_name1%':escJ(p.clipName1||sd.comfy_clip1||p.clipName||sd.comfy_clip||''),'%clip_name2%':escJ(p.clipName2||sd.comfy_clip2||'')};
    strMap['%user_avatar%']=(avatarMap&&avatarMap['__user__'])||BLANK_PNG;
    var mainCharB64=BLANK_PNG;if(avatarMap){for(var nm in avatarMap){if(nm!=='__user__'&&avatarMap[nm]){mainCharB64=avatarMap[nm];break;}}}strMap['%char_avatar%']=mainCharB64;
    if(avatarMap){for(var nm2 in avatarMap){if(nm2==='__user__')continue;strMap['%avatar_'+nm2+'%']=avatarMap[nm2]||BLANK_PNG;}}
    var dc=detectedChars||[];for(var ai=0;ai<8;ai++){var ph='%avatar_'+(ai+1)+'%';var cn=dc[ai];var ab=(cn&&avatarMap&&avatarMap[cn])||BLANK_PNG;if((!cn||!avatarMap||!avatarMap[cn])&&t.indexOf(ph)>=0)console.log(L,'Slot',ph,'→ BLANK');strMap[ph]=ab;}
    var useW=(overrideWH&&overrideWH.w)||p.width||1024,useH=(overrideWH&&overrideWH.h)||p.height||768;
    var fixedSeed=(p.seed!==undefined&&p.seed!==null&&parseInt(p.seed)>0)?parseInt(p.seed):null;
    var useBatch=(p.batchSize&&parseInt(p.batchSize)>0)?parseInt(p.batchSize):1;
    var numMap={'%width%':useW,'%height%':useH,'%seed%':fixedSeed!==null?fixedSeed:Math.floor(Math.random()*2147483647),'%steps%':(p.steps||0)||sd.comfy_steps||sd.steps||20,'%cfg%':(p.cfg||0)||sd.comfy_cfg||sd.scale||7,'%scale%':(p.cfg||0)||sd.comfy_cfg||sd.scale||7,'%denoise%':(p.denoise!==undefined&&p.denoise!==null)?p.denoise:1,'%clip_skip%':(p.clipSkip||0)||sd.comfy_clip_skip||sd.clip_skip||1,'%batch%':useBatch,'%batch_size%':useBatch};
    var key;for(key in strMap)if(strMap.hasOwnProperty(key))t=t.split(key).join(strMap[key]);
    for(key in numMap)if(numMap.hasOwnProperty(key)){var val=String(numMap[key]);t=t.split('"'+key+'"').join(val);t=t.split(key).join(val);}
    try{return JSON.parse(t);}catch(e){console.error(L,'Workflow JSON error:',e.message);return null;}
}

/* ============ COMFY GENERATE ============ */
async function comfyDirect(obj,signal){var base=getComfyUrl();var qr;try{qr=await fetch(base+'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},signal:signal,body:JSON.stringify({prompt:obj})});}catch(e){return null;}if(!qr.ok){var eb;try{eb=await qr.json();}catch(x){}if(eb&&eb.error)toastr.error('ComfyUI: '+(eb.error.message||''),'',{timeOut:12000});if(eb&&eb.node_errors)Object.keys(eb.node_errors).forEach(function(nid){var ne=eb.node_errors[nid];if(ne.errors)ne.errors.forEach(function(err){toastr.error('Node '+nid+': '+(err.message||''),'ComfyUI');});});return null;}var pid=(await qr.json()).prompt_id;var dl=Date.now()+(S().generateTimeoutMs||180000);while(Date.now()<dl){if(signal.aborted)throw new DOMException('','AbortError');await new Promise(function(r){setTimeout(r,2000);});var hist;try{var hr=await fetch(base+'/history/'+pid,{signal:signal});if(!hr.ok)continue;hist=await hr.json();}catch(x){continue;}if(!hist[pid])continue;var entry=hist[pid];if(entry.status){if(entry.status.status_str==='error'){if(entry.status.messages)entry.status.messages.forEach(function(m){if(m[0]==='execution_error')toastr.error((m[1].node_type||'')+': '+(m[1].exception_message||'').substring(0,200),'ComfyUI',{timeOut:15000});});return null;}if(entry.status.completed===false)continue;}var outs=entry.outputs;if(!outs||!Object.keys(outs).length){if(entry.status&&entry.status.completed)return null;continue;}var nids=Object.keys(outs);for(var ni=0;ni<nids.length;ni++){var imgs=outs[nids[ni]]&&outs[nids[ni]].images;if(!imgs||!imgs.length)continue;try{var ir=await fetch(base+'/view?'+new URLSearchParams({filename:imgs[0].filename,subfolder:imgs[0].subfolder||'',type:imgs[0].type||'output'}).toString(),{signal:signal});if(!ir.ok)continue;return ensureValidBase64(await b2b64(await ir.blob()));}catch(e){continue;}}return null;}return null;}
async function comfyProxy(obj,signal){var resp=await fetch('/api/sd/comfy/generate',{method:'POST',headers:getRequestHeaders(),signal:signal,body:JSON.stringify({url:getComfyUrl(),prompt:obj})});if(!resp.ok)return null;var d=await resp.json();var img=d.image||(d.images&&d.images[0])||null;return img?ensureValidBase64(img):null;}

async function generateOneImage(promptText,negText,preset,signal,overrideWH,lorasToInject,avatarMap,detectedChars){
    if(!preset||!preset.workflow)return null;var obj=doFillWorkflow(preset.workflow,promptText,negText,preset,avatarMap,detectedChars,overrideWH);if(!obj)return null;
    if(lorasToInject&&lorasToInject.length)obj=injectLorasIntoWorkflow(obj,lorasToInject);
    var img=null,useDirect=S().preferDirectComfy!==false;
    if(useDirect){try{img=await comfyDirect(obj,signal);if(img)return img;}catch(e){if(e.name==='AbortError')throw e;}}
    try{img=await comfyProxy(obj,signal);if(img)return img;}catch(e){if(e.name==='AbortError')throw e;}
    if(!useDirect){try{return await comfyDirect(obj,signal);}catch(e){if(e.name==='AbortError')throw e;}}
    return null;
}

/* ============ RENDERING ============ */
function illHtml(sec,i){if(!sec.image)return'';var src=sec.image.startsWith('data:')?sec.image:'data:image/jpeg;base64,'+sec.image;var cap=esc(sec.imagePrompt||'');var hp=S().hidePrompts?' ai-hide-caption':'';return'<div class="ai-illustration-wrapper'+hp+'" data-ai-sec="'+i+'"><img class="ai-illustration-img" src="'+src+'" title="Click to enlarge" loading="lazy"/><div class="ai-illustration-caption" title="'+cap+'">🖼️ '+cap+'</div></div>';}
function renderIll(mi){var ctx=getContext(),msg=ctx.chat[mi];if(!msg)return;var data=msg.extra&&msg.extra.autoIllustrator;if(!data||!data.sections)return;var mel=$('#chat .mes[mesid="'+mi+'"]');if(!mel.length)return;var txt=mel.find('.mes_text');if(!txt.length)return;txt.find('.ai-illustration-wrapper').remove();var blocks=txt.children(':not(.ai-illustration-wrapper)').toArray();if(!blocks.length){var raw=txt.html();if(raw&&raw.trim()){txt.html('<div>'+raw+'</div>');renderIll(mi);return;}return;}var withImg=data.sections.filter(function(s){return!!s.image;});if(!withImg.length)return;var pts=[],ok=true,si,bi;for(si=0;si<data.sections.length;si++){if(!data.sections[si].image)continue;if(si<data.sections.length-1){var nx=(data.sections[si+1].text||'').trim().substring(0,50).replace(/\s+/g,' ').toLowerCase();var found=false;for(bi=0;bi<blocks.length;bi++){if(nx&&$(blocks[bi]).text().replace(/\s+/g,' ').toLowerCase().indexOf(nx.substring(0,30))>=0){pts.push({si:si,bi:Math.max(0,bi-1)});found=true;break;}}if(!found){ok=false;break;}}else pts.push({si:si,bi:blocks.length-1});}if(!ok||pts.length!==withImg.length){pts=[];var iv=Math.max(1,Math.floor(blocks.length/withImg.length));var idx=0;for(si=0;si<data.sections.length;si++){if(!data.sections[si].image)continue;pts.push({si:si,bi:Math.min((idx+1)*iv-1,blocks.length-1)});idx++;}}pts.sort(function(a,b){return b.bi-a.bi;});pts.forEach(function(p){var h=illHtml(data.sections[p.si],p.si);if(h)$(blocks[p.bi]).after(h);});}
function reRenderAll(){var ctx=getContext();if(!ctx.chat)return;setTimeout(function(){for(var i=0;i<ctx.chat.length;i++){if(!ctx.chat[i]||!ctx.chat[i].extra||!ctx.chat[i].extra.autoIllustrator)continue;if(ctx.chat[i].extra.autoIllustrator.sections)renderIll(i);if(ctx.chat[i].extra.autoIllustrator.vnChunks&&ctx.chat[i].extra.autoIllustrator.vnChunks.length)renderVnIllustrations(i);}injectMsgButtons();},600);}
function checkMissing(){var ctx=getContext();if(!ctx.chat)return;for(var i=0;i<ctx.chat.length;i++){var m=ctx.chat[i];if(!m||!m.extra||!m.extra.autoIllustrator)continue;var ai=m.extra.autoIllustrator;var hasSecImg=ai.sections&&ai.sections.some(function(s){return!!s.image;});var hasVnImg=ai.vnChunks&&ai.vnChunks.length;if(!hasSecImg&&!hasVnImg)continue;var mel=$('#chat .mes[mesid="'+i+'"]');if(!mel.length)continue;if(mel.find('.mes_text .ai-illustration-wrapper').length===0){if(hasSecImg)renderIll(i);if(hasVnImg)renderVnIllustrations(i);}}}

/* ============ GALLERY + DELETION ============ */
function galImages(){
    var ctx=getContext(),a=[];if(!ctx.chat)return a;
    for(var i=0;i<ctx.chat.length;i++){
        var d=ctx.chat[i].extra&&ctx.chat[i].extra.autoIllustrator;
        if(!d||!d.sections)continue;
        for(var si=0;si<d.sections.length;si++)
            if(d.sections[si].image)a.push({mi:i,si:si,prompt:d.sections[si].imagePrompt||'',image:d.sections[si].image});
    }return a;
}

function deleteOneImage(mi,si){
    var ctx=getContext(),msg=ctx.chat[mi];
    if(!msg||!msg.extra||!msg.extra.autoIllustrator)return false;
    var data=msg.extra.autoIllustrator;
    if(!data.sections||!data.sections[si])return false;
    // Clear image data from this section
    data.sections[si].image=null;
    data.sections[si].imagePrompt='';
    data.sections[si].finalPrompt='';
    // If no images remain, clean up entirely
    var hasAny=data.sections.some(function(s){return!!s.image;});
    if(!hasAny){
        delete msg.extra.autoIllustrator;
        $('#chat .mes[mesid="'+mi+'"] .mes_text .ai-illustration-wrapper').remove();
    }else{
        renderIll(mi);
    }
    ctx.saveChat();
    updateGalBadge();
    console.log(L,'Deleted image: msg',mi,'sec',si);
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
            var src=imgs[i].image.startsWith('data:')?imgs[i].image:'data:image/jpeg;base64,'+imgs[i].image;
            grid+='<div class="ai-gal-item" data-idx="'+i+'" data-mi="'+imgs[i].mi+'" data-si="'+imgs[i].si+'" title="'+esc(imgs[i].prompt)+'">'+
                '<div class="ai-gal-item-delete" data-idx="'+i+'" title="Delete this image">✕</div>'+
                '<img src="'+src+'" loading="lazy"/>'+
                '<div class="ai-gal-label">Msg '+(imgs[i].mi+1)+'</div>'+
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
        var s2=img.image.startsWith('data:')?img.image:'data:image/jpeg;base64,'+img.image;
        var lb=$('<div class="ai-lightbox-overlay"><div class="ai-lightbox-close">✕</div><div class="ai-lightbox-info">'+esc(img.prompt)+'</div><img src="'+s2+'"/></div>');
        $('body').append(lb);lb.on('click',function(){lb.remove();});
    });

    // Delete single image
    ov.find('.ai-gal-item-delete').on('click',function(e){
        e.stopPropagation();
        var idx=parseInt($(this).data('idx'));
        var img=imgs[idx];if(!img)return;
        deleteOneImage(img.mi,img.si);
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

/* ============ PIPELINE ============ */
async function processMessage(mi){
    var s=S(),ctx=getContext();if(!s.enabled||processing.has(mi))return;
    var msg=ctx.chat[mi];if(!msg||msg.is_user||msg.is_system)return;
    if(msg.extra&&msg.extra.autoIllustrator&&msg.extra.autoIllustrator.processed)return;
    var mt=msg.mes;if(!mt||mt.trim().length<(s.minMessageLength||80))return;
    var preset=activePreset();if(!preset||!preset.workflow){toastr.warning('No active preset.');return;}
    var routingEnabled=!!preset.enableCharRouting,charName='';
    if(routingEnabled){try{var chId=ctx.characterId;charName=(chId!==undefined&&ctx.characters&&ctx.characters[chId])?ctx.characters[chId].name||ctx.name2||'':ctx.name2||'';}catch(e){}if(!charName)routingEnabled=false;}
    var charPreset=null;if(routingEnabled&&preset.charPresetId){charPreset=presets().find(function(p){return p.id===preset.charPresetId;});if(!charPreset||!charPreset.workflow)charPreset=null;}
    var adaptive=preset.adaptiveAspect!==false,useCharDesc=preset.useCharDescription!==false;
    var charDesc=useCharDesc?getCharacterDescriptions():{},charNames=getAvailableCharNames();
    var pov=isPOVFormat(preset.promptFormat);
    processing.add(mi);var ctrl=new AbortController();controllers.set(mi,ctrl);
    try{
        showInd(mi,'Loading avatars…');var avatarMap=await collectAllAvatars();
        showInd(mi,'Analyzing…');var n=Math.max(1,Math.min(10,s.imagesPerMessage||2));
        var loraEnabled=!!preset.enableLoraMatching,loraLib=loraEnabled?parseLoraLibrary(preset.loraLibraryText):[];if(loraEnabled&&!loraLib.length)loraEnabled=false;
        var secs=await analyseMessage(mt,n,preset.promptFormat,preset.customInstructions,charName,routingEnabled,adaptive,loraEnabled?loraLib:null,preset.maxLorasPerImage||2,useCharDesc?charDesc:null,charNames);
        if(ctrl.signal.aborted)throw new DOMException('','AbortError');
        if(!secs){toastr.warning('LLM could not split.');return;}
        var parts=[];
        for(var i=0;i<secs.length;i++){
            if(ctrl.signal.aborted)throw new DOMException('','AbortError');
            var usePreset=preset,routeLabel='default';if(routingEnabled&&charPreset&&secs[i].has_char){usePreset=charPreset;routeLabel='CHAR';}
            var fmt=FORMATS[usePreset.promptFormat]||FORMATS.flux,neg=usePreset.negativePrompt||fmt.neg||'';
            var overrideWH=null,pc=parseInt(secs[i].person_count)||0;if(adaptive)overrideWH=adaptDimensions(usePreset.width,usePreset.height,pc);
            var detectedChars=secs[i].characters||[],finalPrompt=secs[i].image_prompt;
            var triggerWords=[],lorasToInject=[],selectedLoras=secs[i].loras||[];
            var usedLoraLib=loraEnabled?loraLib:[];if(usePreset!==preset&&usePreset.enableLoraMatching)usedLoraLib=parseLoraLibrary(usePreset.loraLibraryText);
            if(selectedLoras.length&&usedLoraLib.length)selectedLoras.forEach(function(file){var e=usedLoraLib.find(function(l){return l.file===file;});if(e){if(e.trigger)triggerWords.push(e.trigger);lorasToInject.push({file:e.file,weight:e.weight});}});
            (usePreset.alwaysOnLoras||[]).forEach(function(e){if(e.trigger)triggerWords.push(e.trigger);lorasToInject.push({file:e.file,weight:e.weight});});
            if(triggerWords.length)finalPrompt+=', '+triggerWords.join(', ');
            var sp=[];if(pov)sp.push('POV');if(adaptive&&overrideWH)sp.push(pc+'p');if(routingEnabled)sp.push(routeLabel);if(detectedChars.length)sp.push(detectedChars.join('+'));if(lorasToInject.length)sp.push(lorasToInject.length+'LoRA');
            showInd(mi,'Image '+(i+1)+'/'+secs.length+(sp.length?' ['+sp.join('|')+']':'')+'…');
            var img=null;
            try{img=await Promise.race([generateOneImage(finalPrompt,neg,usePreset,ctrl.signal,overrideWH,lorasToInject,avatarMap,detectedChars),new Promise(function(_,r){setTimeout(function(){r(new Error('Timeout'));},s.generateTimeoutMs);})]);
            }catch(e){if(e.name==='AbortError')throw e;}
            if(img&&s.compressImages)try{img=await compressImage(img,s.maxStoredImageWidth,s.compressionQuality);}catch(e){}
            parts.push({text:secs[i].text,imagePrompt:secs[i].image_prompt,finalPrompt:finalPrompt,image:img,hasChar:!!secs[i].has_char,personCount:pc,characters:detectedChars,loras:lorasToInject.map(function(l){return l.file;}),presetUsed:usePreset.name,pov:pov});
            msg.extra=msg.extra||{};msg.extra.autoIllustrator={processed:false,preset:preset.id,timestamp:Date.now(),sections:parts.slice()};renderIll(mi);
        }
        msg.extra.autoIllustrator.processed=true;renderIll(mi);ctx.saveChat();
        toastr.success(parts.filter(function(p){return!!p.image;}).length+'/'+secs.length+' done.'+(pov?' (POV)':''));updateGalBadge();
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
    if(!preset||!preset.workflow){ toastr.warning('No active preset.'); return; }

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
        showInd(mi,'Analyzing chunk…');

        var loraEnabled=!!preset.enableLoraMatching;
        var loraLib=loraEnabled?parseLoraLibrary(preset.loraLibraryText):[];
        if(loraEnabled&&!loraLib.length) loraEnabled=false;

        // Run analyseMessage on JUST the chunk text, asking for exactly 1 image.
        var secs=await analyseMessage(
            chunkText, 1, preset.promptFormat, preset.customInstructions,
            charName, routingEnabled, adaptive,
            loraEnabled?loraLib:null, preset.maxLorasPerImage||2,
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
        var triggerWords=[], lorasToInject=[];
        var selectedLoras=sec.loras||[];
        var usedLoraLib=loraEnabled?loraLib:[];
        if(usePreset!==preset&&usePreset.enableLoraMatching) usedLoraLib=parseLoraLibrary(usePreset.loraLibraryText);
        if(selectedLoras.length&&usedLoraLib.length){
            selectedLoras.forEach(function(file){
                var e=usedLoraLib.find(function(l){return l.file===file;});
                if(e){ if(e.trigger) triggerWords.push(e.trigger); lorasToInject.push({file:e.file,weight:e.weight}); }
            });
        }
        (usePreset.alwaysOnLoras||[]).forEach(function(e){
            if(e.trigger) triggerWords.push(e.trigger);
            lorasToInject.push({file:e.file,weight:e.weight});
        });
        if(triggerWords.length) finalPrompt+=', '+triggerWords.join(', ');

        var sp=[]; if(pov) sp.push('POV'); sp.push('VN#'+chunkIndex);
        if(adaptive&&overrideWH) sp.push(pc+'p');
        if(routingEnabled) sp.push(routeLabel);
        if(detectedChars.length) sp.push(detectedChars.join('+'));
        if(lorasToInject.length) sp.push(lorasToInject.length+'LoRA');
        showInd(mi,'VN image ['+sp.join('|')+']…');

        var img=null;
        try{
            img=await Promise.race([
                generateOneImage(finalPrompt,neg,usePreset,ctrl.signal,overrideWH,lorasToInject,avatarMap,detectedChars),
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

    var src=data.image.toString().indexOf('data:')===0 ? data.image : 'data:image/jpeg;base64,'+data.image;
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
function onMsg(mi){if(!S().enabled||!S().autoGenerate)return;if(mi==null)mi=getContext().chat.length-1;setTimeout(function(){processMessage(mi);injectMsgButtons();},1200);}
function onChat(){controllers.forEach(function(c){c.abort();});controllers.clear();processing.clear();reRenderAll();setTimeout(updateGalBadge,800);}
function updateFmtInfo(){var k=$('#ai_prompt_fmt').val()||'flux',f=FORMATS[k];if(f){var desc=f.inst?f.inst.substring(0,120)+'…':'Custom';if(isPOVFormat(k))desc='👁️ POV | '+desc;$('#ai_fmt_desc').text(desc);$('#ai_fmt_res').text('⊞ '+f.w+'×'+f.h);}}

/* ============ UI ============ */
function buildUI(){
    var fo='<optgroup label="── Standard ──">';
    var stdKeys=['flux','flux2klein','zimage','qwen_image','sd15','illustrious','noobai','custom'];
    var povKeys=['pov_flux','pov_flux2klein','pov_zimage','pov_qwen','pov_sd15','pov_illustrious','pov_noobai'];
    stdKeys.forEach(function(k){if(FORMATS[k])fo+='<option value="'+k+'">'+esc(FORMATS[k].l)+'</option>';});
    fo+='</optgroup><optgroup label="── 👁️ POV (First Person) ──">';
    povKeys.forEach(function(k){if(FORMATS[k])fo+='<option value="'+k+'">'+esc(FORMATS[k].l)+'</option>';});
    fo+='</optgroup>';
    var gpo='';for(var gk in POSITIONS)if(POSITIONS.hasOwnProperty(gk))gpo+='<option value="'+gk+'">'+esc(POSITIONS[gk].l)+'</option>';
    var mpo='';for(var mk in MSG_POSITIONS)if(MSG_POSITIONS.hasOwnProperty(mk))mpo+='<option value="'+mk+'">'+esc(MSG_POSITIONS[mk].l)+'</option>';
    return'<div id="auto_illustrator_settings"><div class="inline-drawer">'+
        '<div class="inline-drawer-toggle inline-drawer-header"><b>🎨 AutoIllustrator v3.3</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>'+
        '<div class="inline-drawer-content" style="display:none;">'+
        '<label class="checkbox_label"><input id="ai_on" type="checkbox"/><span>Enable</span></label>'+
        '<label class="checkbox_label"><input id="ai_auto" type="checkbox"/><span>Auto-generate</span></label>'+
        '<div class="ai-sg"><label>Images per msg: <b id="ai_cnt_v">2</b></label><input id="ai_cnt" type="range" min="1" max="10" step="1"/></div>'+
        '<hr class="sysHR"/>'+
        '<div class="ai-sg"><label><b>📦 Preset</b></label><select id="ai_preset_sel" class="text_pole"></select>'+
        '<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap"><div id="ai_p_new" class="menu_button" style="font-size:.8em">➕New</div><div id="ai_p_ren" class="menu_button" style="font-size:.8em">✏️Ren</div><div id="ai_p_dup" class="menu_button" style="font-size:.8em">📋Dup</div><div id="ai_p_del" class="menu_button" style="font-size:.8em;color:#f66">🗑️Del</div></div></div>'+
        '<hr class="sysHR"/>'+
        '<div style="border-left:3px solid var(--SmartThemeQuoteColor,#6366f1);padding-left:8px;margin:4px 0">'+
        '<small style="color:var(--SmartThemeQuoteColor,#6366f1)">⬇ Per-preset</small>'+
        '<label class="checkbox_label" style="margin-top:4px"><input id="ai_char_route" type="checkbox"/><span>🔀 Smart Routing</span></label>'+
        '<div id="ai_route_opts" style="margin-left:20px;margin-bottom:4px"><label style="font-size:.82em">Char preset:</label><select id="ai_char_preset" class="text_pole" style="font-size:.85em"><option value="">— same —</option></select></div>'+
        '<label class="checkbox_label"><input id="ai_adapt" type="checkbox"/><span>📐 Adaptive Aspect</span></label>'+
        '<label class="checkbox_label"><input id="ai_char_desc" type="checkbox"/><span>👤 Character card descriptions</span></label>'+
        '<hr class="sysHR"/>'+
        '<div class="ai-sg"><label>Prompt Format:</label><select id="ai_prompt_fmt" class="text_pole">'+fo+'</select><small class="ai-desc" id="ai_fmt_desc"></small><small class="ai-desc" id="ai_fmt_res"></small></div>'+
        '<div style="display:flex;gap:8px"><div style="flex:1"><label>Width:</label><input id="ai_w" type="number" class="text_pole" min="256" max="2048" step="64"/></div><div style="flex:1"><label>Height:</label><input id="ai_h" type="number" class="text_pole" min="256" max="2048" step="64"/></div><div><label>&nbsp;</label><div id="ai_res_apply" class="menu_button" style="font-size:.78em">📐</div></div></div>'+
        '<div class="ai-sg"><label>Negative:</label><textarea id="ai_neg" class="text_pole" rows="2"></textarea></div>'+
        '<div class="ai-sg"><label>Custom LLM Instructions:</label><textarea id="ai_custom_instr" class="text_pole" rows="2"></textarea></div>'+
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
        '<div id="ai_lora_opts"><div style="display:flex;gap:6px;align-items:center;margin:4px 0"><label style="font-size:.82em">Max:</label><input id="ai_lora_max" type="number" min="1" max="5" class="text_pole" style="width:50px;font-size:.85em"/><div id="ai_lora_fetch" class="menu_button" style="font-size:.76em">🔄 Fetch</div></div>'+
        '<textarea id="ai_lora_lib" class="text_pole" rows="4" placeholder="# file | tags | trigger | weight"></textarea></div></div>'+
        '</div>'+
        '<hr class="sysHR"/>'+
        '<div class="ai-sg"><label style="font-size:.82em"><b>🔌 ComfyUI Endpoint</b></label>'+
        '<input id="ai_comfy_url" class="text_pole" placeholder="auto-detect (blank)" style="font-size:.85em"/>'+
        '<small class="ai-desc"><code>:8188</code> ComfyUI &nbsp; <code>:7821</code> SwarmUI</small>'+
        '<div style="display:flex;gap:4px;margin-top:3px;align-items:center"><div id="ai_url_detect" class="menu_button" style="font-size:.76em">🔍 Detect</div><div id="ai_url_test" class="menu_button" style="font-size:.76em">🧪 Test</div><small id="ai_url_status" style="color:#888"></small></div></div>'+
        '<div class="ai-sg"><label><b>🎯 Positions</b></label><div style="display:flex;gap:8px;flex-wrap:wrap"><div style="flex:1"><label style="font-size:.82em">Gallery:</label><select id="ai_gal_pos" class="text_pole" style="font-size:.85em">'+gpo+'</select></div><div style="flex:1"><label style="font-size:.82em">Msg:</label><select id="ai_msg_pos" class="text_pole" style="font-size:.85em">'+mpo+'</select></div></div></div>'+
        '<label class="checkbox_label"><input id="ai_direct" type="checkbox"/><span>Direct ComfyUI</span></label>'+
        '<label class="checkbox_label"><input id="ai_comp" type="checkbox"/><span>Compress</span></label>'+
        '<label class="checkbox_label"><input id="ai_galbtn" type="checkbox"/><span>Gallery btn</span></label>'+
        '<label class="checkbox_label" title="Hide the prompt caption shown beneath each generated image"><input id="ai_hide_prompts" type="checkbox"/><span>🙈 Hide image prompts</span></label>'+
        '<hr class="sysHR"/>'+
        '<div style="display:flex;gap:4px;flex-wrap:wrap"><div id="ai_go" class="menu_button" style="flex:1;font-size:.82em">🎨 Go</div><div id="ai_redo" class="menu_button" style="flex:1;font-size:.82em">🔄 Redo</div><div id="ai_clr" class="menu_button" style="flex:1;font-size:.82em">🗑️ Clear</div></div>'+
        '</div></div></div>';
}

/* ============ BIND ============ */
function settingsToUI(){var s=S();$('#ai_on').prop('checked',s.enabled);$('#ai_auto').prop('checked',s.autoGenerate);$('#ai_cnt').val(s.imagesPerMessage);$('#ai_cnt_v').text(s.imagesPerMessage);$('#ai_direct').prop('checked',s.preferDirectComfy);$('#ai_comp').prop('checked',s.compressImages);$('#ai_galbtn').prop('checked',s.showGalleryButton);$('#ai_hide_prompts').prop('checked',!!s.hidePrompts);$('#ai_gal_pos').val(s.galleryPosition||'mid-right');$('#ai_msg_pos').val(s.msgBtnPosition||'bottom-right');$('#ai_comfy_url').val(s.comfyUrl||'');rebuildPresetDD();loadPresetToUI();toggleGalBtn();applyHidePrompts();}

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
    $('#ai_p_del').on('click',function(){var p=activePreset();if(!p||!confirm('Delete "'+p.name+'"?'))return;deletePresetById(p.id);rebuildPresetDD();loadPresetToUI();});

    var as=function(){syncUIToPreset();};
    $('#ai_prompt_fmt').on('change',function(){var k=$(this).val(),f=FORMATS[k];if(f){$('#ai_w').val(f.w);$('#ai_h').val(f.h);}updateFmtInfo();syncUIToPreset();});
    $('#ai_res_apply').on('click',function(){var k=$('#ai_prompt_fmt').val(),f=FORMATS[k];if(f){$('#ai_w').val(f.w);$('#ai_h').val(f.h);syncUIToPreset();}});
    $('#ai_w,#ai_h,#ai_p_model,#ai_p_vae,#ai_p_sampler,#ai_p_scheduler,#ai_p_steps,#ai_p_cfg,#ai_p_denoise,#ai_p_clipskip,#ai_p_clip,#ai_p_clip1,#ai_p_clip2,#ai_p_seed,#ai_p_batch').on('change',as);
    $('#ai_neg,#ai_custom_instr,#ai_wf_json').on('change',as);
    $('#ai_char_route').on('change',function(){syncUIToPreset();$('#ai_route_opts').toggle($(this).prop('checked'));});
    $('#ai_char_preset,#ai_adapt,#ai_char_desc').on('change',as);
    $('#ai_lora_on').on('change',function(){syncUIToPreset();$('#ai_lora_opts').toggle($(this).prop('checked'));});
    $('#ai_lora_max,#ai_lora_lib').on('change',as);
    $('#ai_lora_fetch').on('click',onFetchLoras);$('#ai_refresh_opts').on('click',refreshComfyDropdowns);

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
    tgt.append(buildUI());loadSettings();settingsToUI();bindUI();injectMsgBtnCSS();
    eventSource.on(event_types.MESSAGE_RECEIVED,onMsg);eventSource.on(event_types.CHAT_CHANGED,onChat);
    try{eventSource.on(event_types.MESSAGE_SWIPED,function(){setTimeout(reRenderAll,800);});}catch(e){}
    try{if(typeof SlashCommandParser!=='undefined'&&typeof SlashCommand!=='undefined')SlashCommandParser.addCommandObject(SlashCommand.fromProps({name:'illustrate',callback:async function(){var c=getContext(),i=c.chat.length-1;if(i>=0){if(c.chat[i].extra&&c.chat[i].extra.autoIllustrator)c.chat[i].extra.autoIllustrator.processed=false;await processMessage(i);}return'';},helpString:'Illustrate last msg.'}));}catch(e){}
    toggleGalBtn();reRenderAll();
    var chatEl=document.getElementById('chat');
    if(chatEl){var t=null;new MutationObserver(function(){setTimeout(injectMsgButtons,300);if(t)clearTimeout(t);t=setTimeout(checkMissing,800);}).observe(chatEl,{childList:true,subtree:true});}
    setTimeout(function(){injectMsgButtons();fetchComfyOptions().then(function(o){populateDatalist('ai_dl_models',o.models);populateDatalist('ai_dl_samplers',o.samplers);populateDatalist('ai_dl_schedulers',o.schedulers);populateDatalist('ai_dl_vaes',o.vaes);populateDatalist('ai_dl_loras',o.loras);populateDatalist('ai_dl_clips',o.clips||[]);});},2000);
    setInterval(checkMissing,5000);
    console.log(L,'v3.3 loaded — gallery delete + masonry + POV');
});
