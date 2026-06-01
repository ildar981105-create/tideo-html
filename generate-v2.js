(function(){
'use strict';
const P=new URLSearchParams(location.search), promptText=P.get('prompt')||'';

/* ===== Model Config ===== */
const MODEL_MAP={
    kling:    {name:'Kling',   version:'3.0-Omni', label:'可灵 3.0-Omni'},
    vidu:     {name:'Vidu',    version:'q3-pro',   label:'Vidu Q3-Pro'},
    hailuo:   {name:'Hailuo',  version:'2.3',      label:'海螺 2.3'},
    pixverse: {name:'PixVerse',version:'v6',       label:'PixVerse V6'},
    jimeng:   {name:'Jimeng',  version:'3.0pro',   label:'即梦 3.0 Pro'},
    gv:       {name:'GV',      version:'3.1',      label:'GV 3.1'}
};
const selectedModelKey=P.get('model')||'kling';
const selectedModel=MODEL_MAP[selectedModelKey]||MODEL_MAP.kling;
const selectedRatio=P.get('ratio')||'16:9';
const selectedResolution=P.get('resolution')||'1080P';
const selectedDuration=parseInt(P.get('duration'))||5;
const selectedMultiShot=P.get('multiShot')||'auto';
const selectedEnhancePrompt=P.get('enhancePrompt')||'Enabled';
const selectedAudio=P.get('audio')||'Enabled';

/* ===== State ===== */
let phase='idle', clips=[], selectedClipIdx=0, totalDuration=0;
let playing=false, playTime=0, animFrame=null;
let inFinetune=false, lightsOff=false, _lightsOffTimer=null;
let taskStarted=false, chatCollapsed=false, unreadCount=0;
let currentPrompt='', realVideoUrl='';
const CC=['#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ffffff'];
const TITLES=['开场','铺垫','发展','转折','高潮','结尾','尾声','延伸','补充','过渡'];

const ROLES={
    director:{name:'导演',realName:'林雨晨',color:'#3b82f6',avatar:'assets/characters/linyuchen-director.png',cssClass:'role-di'},
    screenwriter:{name:'编剧',realName:'李明远',color:'#2563eb',avatar:'assets/characters/limingyuan-translator.png',cssClass:'role-sw'},
    artist:{name:'艺术指导',realName:'苏雅',color:'#7c3aed',avatar:'assets/characters/suya-voice.png',cssClass:'role-ar'},
    editor:{name:'后期',realName:'陈默',color:'#ec4899',avatar:'assets/characters/chenmo-postprod.png',cssClass:'role-ed'}
};

/* ===== Elements ===== */
const page=document.getElementById('g8Page'), chatFlow=document.getElementById('chatFlow');
const phaseEl=document.getElementById('phaseEl'), phaseDot=document.getElementById('phaseDot'), phaseLabel=document.getElementById('phaseLabel');
const board=document.getElementById('board');
const mainCanvas=document.getElementById('mainCanvas'), canvasLabel=document.getElementById('canvasLabel');
const chatPanel=document.getElementById('chatPanel'), chatFab=document.getElementById('chatFab'), fabBadge=document.getElementById('fabBadge');
const bgIndicator=document.getElementById('bgIndicator'), bgIndDot=document.getElementById('bgIndDot'), bgIndText=document.getElementById('bgIndText');
const playerOverlay=document.getElementById('playerOverlay');

/* ===== Background ===== */
const BG_MAP={default:{label:'综合工作室',color:'#94a3b8'},screenwriter:{label:'编剧房',color:'#2563eb'},artist:{label:'艺术指导室',color:'#7c3aed'},editor:{label:'后期室',color:'#ec4899'}};
let currentBg='default';
function switchBg(n){if(n===currentBg)return;currentBg=n;document.querySelectorAll('.g8-bg-layer').forEach(el=>el.classList.toggle('active',el.dataset.bg===n));const i=BG_MAP[n]||BG_MAP.default;bgIndDot.style.background=i.color;bgIndText.textContent=i.label;bgIndicator.classList.add('vis')}

/* ===== Utils ===== */
function rnd(a){return a[Math.floor(Math.random()*a.length)]}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function wait(ms){return new Promise(r=>setTimeout(r,ms))}

/* ===== Chat ===== */
function appendBubble(type,html,role){
    const el=document.createElement('div');
    if(type==='ai'&&role&&ROLES[role]){const r=ROLES[role];el.className='chat-bubble chat-bubble--ai '+r.cssClass;el.innerHTML='<div class="bubble-avatar"><img class="role-avatar-img" src="'+r.avatar+'" alt="'+r.realName+'"></div><div class="bubble-body"><div class="role-name-line">'+r.name+'–<strong>'+r.realName+'</strong></div><div class="role-msg">'+html+'</div></div>'}
    else if(type==='user'){el.className='chat-bubble chat-bubble--user';el.innerHTML=html}
    else if(type==='system'){el.className='chat-system-msg';el.innerHTML=html}
    else{const r=ROLES.director;el.className='chat-bubble chat-bubble--ai '+r.cssClass;el.innerHTML='<div class="bubble-avatar"><img class="role-avatar-img" src="'+r.avatar+'" alt="'+r.realName+'"></div><div class="bubble-body"><div class="role-name-line">'+r.name+'–<strong>'+r.realName+'</strong></div><div class="role-msg">'+html+'</div></div>'}
    chatFlow.appendChild(el);
    if(chatCollapsed&&el.classList.contains('chat-bubble')){unreadCount++;fabBadge.textContent=unreadCount;fabBadge.style.display='flex'}
    return el;
}
function scrollChat(){chatFlow.scrollTo({top:chatFlow.scrollHeight,behavior:'smooth'})}

/* ===== Draw ===== */
function drawClipPreview(canvas,clip,idx){
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    const hue1=(idx*85+180)%360,hue2=(hue1+50)%360;
    const grd=ctx.createLinearGradient(0,0,w,h);
    grd.addColorStop(0,'hsl('+hue1+',35%,12%)');grd.addColorStop(0.5,'hsl('+hue2+',30%,16%)');grd.addColorStop(1,'hsl('+((hue1+120)%360)+',25%,10%)');
    ctx.fillStyle=grd;ctx.fillRect(0,0,w,h);
    ctx.globalAlpha=0.15;for(let j=0;j<6;j++){ctx.beginPath();ctx.arc((Math.sin(idx*3+j*1.5)*.3+.5)*w,(Math.cos(idx*2+j*2.3)*.3+.5)*h,30+j*15,0,Math.PI*2);ctx.fillStyle=clip.color;ctx.fill()}
    ctx.globalAlpha=0.35;ctx.font='bold '+Math.min(w*0.08,32)+'px sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(clip.title,w/2,h/2);
    ctx.font=Math.min(w*0.04,14)+'px sans-serif';ctx.fillStyle=clip.color;ctx.globalAlpha=0.4;ctx.fillText(clip.duration+'s',w/2,h/2+22);ctx.globalAlpha=1;
}
function drawPlayerFrame(t){
    const ctx=mainCanvas.getContext('2d'),w=mainCanvas.width,h=mainCanvas.height;ctx.clearRect(0,0,w,h);if(!clips.length)return;
    // 找当前片段
    let elapsed=0,cur=clips[0],curIdx=0;
    for(let i=0;i<clips.length;i++){if(t<elapsed+clips[i].duration){cur=clips[i];curIdx=i;break}elapsed+=clips[i].duration}
    const localT=t-elapsed, pct=localT/cur.duration;

    // 丰富的渐变背景
    const hue1=(curIdx*65+200+t*2)%360,hue2=(hue1+40)%360,hue3=(hue1+120)%360;
    const grd=ctx.createLinearGradient(0,0,w,h);
    grd.addColorStop(0,'hsl('+hue1+',45%,8%)');grd.addColorStop(0.4,'hsl('+hue2+',40%,12%)');grd.addColorStop(1,'hsl('+hue3+',35%,6%)');
    ctx.fillStyle=grd;ctx.fillRect(0,0,w,h);

    // 大光圈（跟随时间漂移）
    ctx.globalAlpha=0.08;
    ctx.beginPath();ctx.arc(w*0.35+Math.sin(t*0.15)*120,h*0.4+Math.cos(t*0.12)*80,200+Math.sin(t*0.3)*40,0,Math.PI*2);
    ctx.fillStyle=cur.color;ctx.fill();
    ctx.beginPath();ctx.arc(w*0.65+Math.cos(t*0.18)*100,h*0.6+Math.sin(t*0.1)*60,160+Math.cos(t*0.25)*30,0,Math.PI*2);
    ctx.fillStyle='hsl('+hue2+',50%,40%)';ctx.fill();

    // 粒子点
    ctx.globalAlpha=0.3;
    for(let i=0;i<20;i++){
        const px=(Math.sin(t*0.08+i*3.7)*.45+.5)*w;
        const py=(Math.cos(t*0.06+i*2.9)*.45+.5)*h;
        const sz=1.5+Math.sin(t*0.4+i)*1;
        ctx.beginPath();ctx.arc(px,py,sz,0,Math.PI*2);
        ctx.fillStyle=i%2===0?cur.color:'#fff';ctx.fill();
    }

    // 横向光条（转场感）
    ctx.globalAlpha=0.03;
    for(let i=0;i<4;i++){
        const y=h*(0.2+i*0.2)+Math.sin(t*0.3+i)*20;
        ctx.fillStyle='#fff';ctx.fillRect(0,y,w,1.5);
    }

    // 片段标题（大号，居中）
    ctx.globalAlpha=0.25;ctx.font='bold '+Math.min(w*0.06,48)+'px sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(cur.title,w/2,h/2-12);
    // 描述（小号）
    ctx.globalAlpha=0.15;ctx.font=Math.min(w*0.022,16)+'px sans-serif';
    const descShort=cur.desc.length>30?cur.desc.substring(0,30)+'…':cur.desc;
    ctx.fillText(descShort,w/2,h/2+24);
    ctx.globalAlpha=1;ctx.textBaseline='alphabetic';

    // 更新播放器 UI
    const totalPct=(t/totalDuration)*100;
    const fill=document.getElementById('playerProgressFill');if(fill)fill.style.width=totalPct+'%';
    const badge=document.getElementById('playerClipBadge');if(badge){badge.textContent=cur.id;badge.style.background=cur.color}
    const title=document.getElementById('playerClipTitle');if(title)title.textContent=cur.title;
    const time=document.getElementById('playerTime');
    if(time){
        const cm=Math.floor(t/60),cs=Math.floor(t%60);
        const tm=Math.floor(totalDuration/60),ts=Math.floor(totalDuration%60);
        time.textContent=cm+':'+(cs<10?'0':'')+cs+' / '+tm+':'+(ts<10?'0':'')+ts;
    }
}

/* ===== Board: Storyboard Card Wall ===== */
function addScriptCard(clip,idx){
    const card=document.createElement('div');
    card.className='sb-card';card.id='sb-'+idx;card.dataset.idx=idx;
    card.innerHTML=
        '<div class="sb-script"><div class="sb-top"><span class="sb-num" style="background:'+clip.color+'">'+clip.id+'</span><span class="sb-title">'+esc(clip.title)+'</span><span class="sb-dur">'+clip.duration+'s</span></div><div class="sb-desc">'+esc(clip.desc)+'</div></div>'+
        '<div class="sb-canvas"><canvas width="320" height="180"></canvas><div class="sb-canvas-info"><span class="sb-num" style="background:'+clip.color+'">'+clip.id+'</span><span>'+esc(clip.title)+'</span><span class="sb-dur" style="margin-left:auto">'+clip.duration+'s</span></div><div class="sb-gen-overlay"><span class="sb-gen-text">画面生成中…</span></div></div>';
    card.addEventListener('click',()=>{
        selectedClipIdx=idx;
        board.querySelectorAll('.sb-card').forEach(c=>c.classList.remove('sb-active'));
        card.classList.add('sb-active');
        // 精调模式下联动
        if(inFinetune) selectFtClip(idx);
    });
    board.appendChild(card);
    setTimeout(()=>card.classList.add('vis'),50+idx*120);
    return card;
}

function setCardImage(idx){
    const card=document.getElementById('sb-'+idx);if(!card||!clips[idx])return;
    card.classList.remove('sb-generating');
    card.classList.add('sb-image');
    const cvs=card.querySelector('.sb-canvas canvas');
    if(cvs) drawClipPreview(cvs,clips[idx],idx);
}

function setCardGenerating(idx){
    const card=document.getElementById('sb-'+idx);if(!card)return;
    card.classList.add('sb-generating','sb-image');
}

/* ===== Parse ===== */
function parseTextToClips(text){
    const sentences=text.replace(/([。！？.!?；;])/g,'$1||').split('||').filter(s=>s.trim());
    const count=Math.max(3,Math.min(6,Math.ceil(sentences.length/2)));
    const chunkSize=Math.ceil(sentences.length/count);
    clips=[];
    for(let i=0;i<count;i++){
        const chunk=sentences.slice(i*chunkSize,i*chunkSize+chunkSize).join('');
        clips.push({id:i+1,title:TITLES[i]||'片段'+(i+1),duration:4+Math.floor(Math.random()*5),desc:chunk.trim()||'（AI 自动生成）',color:CC[i%CC.length],status:'pending',refs:[]});
    }
    totalDuration=clips.reduce((s,c)=>s+c.duration,0);
}

/* ===== Role Task Bubbles (参考图风格：角色台词+内嵌子任务列表) ===== */
const roleBubbles={};
const STEP_ROLE={assign:'director',storyboard:'screenwriter',generating:'artist',composing:'editor',review:'director'};

// 构建子任务列表HTML（✓/✕ 风格）
function buildTaskList(tasks){
    if(!tasks||!tasks.length)return'';
    let h='<div class="rtl-tasks">';
    tasks.forEach(t=>{
        const done=t.status==='done';
        const active=t.status==='active';
        const svgDone='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        const svgActive='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
        const svgPending='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>';
        const icon=done?svgDone:(active?svgActive:svgPending);
        const cls=done?'rtl-done':(active?'rtl-active':'rtl-pending');
        const label=done?(t.doneLabel||t.label):t.label;
        h+='<div class="rtl-task '+cls+'"><span class="rtl-icon">'+icon+'</span><span class="rtl-label">'+label+'</span></div>';
    });
    h+='</div>';
    return h;
}

// 创建角色消息（台词+子任务列表），返回气泡元素引用
function appendRoleBubble(role,line,tasks,stepKey){
    const html=line+buildTaskList(tasks);
    const el=appendBubble('ai',html,role);
    if(stepKey)roleBubbles[stepKey]=el;
    return el;
}

// 更新已有角色气泡的子任务列表
function updateRoleTasks(stepKey,tasks,extraHtml){
    const el=roleBubbles[stepKey];if(!el)return;
    const body=el.querySelector('.role-msg');if(!body)return;
    // 保留第一行文字，替换子任务列表
    const firstLine=body.childNodes[0];
    const textContent=firstLine&&firstLine.nodeType===3?firstLine.textContent:'';
    body.innerHTML=textContent+buildTaskList(tasks)+(extraHtml||'');
    el.scrollIntoView({behavior:'smooth',block:'nearest'});
}

/* ===== MAIN AUTO FLOW ===== */
async function startCreation(text){
    taskStarted=true;currentPrompt=text;chatFlow.innerHTML='';board.innerHTML='';
    phaseEl.classList.add('vis');phaseDot.className='g8-pd proc';phaseLabel.textContent='创作中…';
    parseTextToClips(text);
    saveGenTaskRecord('processing');

    // ====== 加入消息 ======
    const jm=document.createElement('div');jm.className='chat-join-msg';
    jm.innerHTML='林雨晨、李明远、苏雅、陈默 加入了工作坊';
    chatFlow.appendChild(jm);
    await wait(600);

    // ====== 用户消息 ======
    appendBubble('user',esc(text.substring(0,200))+(text.length>200?'...':''));scrollChat();
    await wait(1000);

    // ====== 导演开场 ======
    const dirTasks=[
        {label:'导演分析了你的视频需求并为你规划人员',doneLabel:'导演分析了你的视频需求并为你规划人员',status:'pending'}
    ];
    appendRoleBubble('director','收到视频创作任务了，大家准备开工',dirTasks,'dirOpen');scrollChat();
    await wait(1200);
    dirTasks[0].status='done';
    updateRoleTasks('dirOpen',dirTasks);scrollChat();
    await wait(800);

    // ====== 编剧接活 ======
    phase='storyboard';switchBg('screenwriter');
    phaseLabel.textContent='分镜编排中…';

    // 编剧的子任务：笼统描述
    const swTasks=[
        {label:'撰写视频脚本…',doneLabel:'视频脚本撰写完成',status:'pending'},
        {label:'拆分分镜脚本…',doneLabel:'分镜脚本已拆分',status:'pending'}
    ];

    appendRoleBubble('screenwriter','嘿，我来负责翻本',swTasks,'storyboard');scrollChat();
    await wait(800);

    // 逐个完成
    for(let i=0;i<swTasks.length;i++){
        swTasks[i].status='active';
        updateRoleTasks('storyboard',swTasks);
        await wait(1200+Math.random()*800);
        swTasks[i].status='done';
        updateRoleTasks('storyboard',swTasks);scrollChat();
        if(i<swTasks.length-1) await wait(300);
    }
    showFlash('parse');
    await wait(1000);

    // ====== 画师接活 ======
    phase='generating';switchBg('artist');
    phaseLabel.textContent='画面生成中 · '+selectedModel.label+'…';

    // 画师的子任务：笼统描述
    const artTasks=[
        {label:'逐帧生成分镜画面…',doneLabel:'分镜画面已生成',status:'pending'},
        {label:'画面质量检查…',doneLabel:'画面质量检查通过',status:'pending'}
    ];

    appendRoleBubble('artist','我来把控视觉方向',artTasks,'generating');scrollChat();
    await wait(800);

    // 判断是否有真实 API
    var hasAPI = typeof TideoAPI !== 'undefined' && TideoAPI.aigcVideo;

    if (hasAPI && clips.length > 0) {
        // === 方案A：真实 AIGC API ===
        artTasks[0].status='active';
        updateRoleTasks('generating',artTasks);
        try {
            // 检查模型是否支持分镜（通过 api-client MODEL_CAPS）
            var modelCaps = (TideoAPI.MODEL_CAPS && TideoAPI.MODEL_CAPS[selectedModel.name]) || { multiShot: false, maxDuration: 10 };
            var useMultiShot = modelCaps.multiShot && clips.length > 1 && selectedMultiShot !== 'off';

            var aigcOpts = {
                model: selectedModel.name, version: selectedModel.version, prompt: currentPrompt,
                enhancePrompt: selectedEnhancePrompt,
                output: { resolution: selectedResolution, aspectRatio: selectedRatio, audio: selectedAudio !== 'Disabled', storage: 'Permanent' }
            };

            if (useMultiShot) {
                if (selectedMultiShot === 'intelligence') {
                    // 智能分镜：让 AI 自动拆
                    aigcOpts.multiShot = { enabled: true, type: 'intelligence' };
                    aigcOpts.output.duration = Math.min(selectedDuration, modelCaps.maxDuration || 15);
                    console.log('[AIGC] 使用智能分镜模式, 时长 ' + aigcOpts.output.duration + 's');
                } else {
                    // 自定义分镜（auto 默认行为）
                    var multiPrompt = clips.map(function(c, i){
                        return { index: i+1, prompt: c.desc || c.title, duration: Math.min(c.duration, 5) };
                    });
                    var totalAigcDur = multiPrompt.reduce(function(s,p){return s+p.duration},0);
                    var maxDur = modelCaps.maxDuration || 15;
                    if(totalAigcDur > maxDur) {
                        var scale = maxDur / totalAigcDur;
                        multiPrompt.forEach(function(p){ p.duration = Math.max(2, Math.round(p.duration * scale)); });
                        totalAigcDur = multiPrompt.reduce(function(s,p){return s+p.duration},0);
                    }
                    aigcOpts.multiShot = { enabled: true, type: 'customize', shots: multiPrompt };
                    aigcOpts.output.duration = Math.min(totalAigcDur, maxDur);
                    console.log('[AIGC] 使用自定义分镜模式, ' + clips.length + ' 段, 总时长 ' + aigcOpts.output.duration + 's');
                }
            } else {
                // 不支持分镜 / 用户关闭分镜：单镜头
                var singleDur = Math.min(selectedDuration || 5, modelCaps.maxDuration || 10);
                aigcOpts.output.duration = singleDur;
                if (!useMultiShot && clips.length > 1) {
                    console.warn('[AIGC] 模型 ' + selectedModel.name + ' 不支持分镜，降级为单镜头模式');
                }
            }

            var aigcResult = await TideoAPI.aigcVideo(aigcOpts);
            console.log('[AIGC] 任务已提交:', aigcResult.taskId);

            var pollStartTime = Date.now();
            var aigcFinal = await TideoAPI.pollAigcTask(aigcResult.taskId, {
                interval: 6000, timeout: 600000,
                onProgress: function(task) {
                    var statusText = task.status || task.Status || 'PROCESSING';
                    var elapsed = Math.round((Date.now() - pollStartTime) / 1000);
                    phaseLabel.textContent = '画面生成中… (' + statusText + ' · ' + elapsed + 's)';
                }
            });

            console.log('[AIGC] 任务完成，结果:', JSON.stringify(aigcFinal));

            // 提取 fileUrl — 多路径兜底
            var outputUrl = '';
            if (aigcFinal.aigcVideo) {
                outputUrl = aigcFinal.aigcVideo.fileUrl || '';
                // rawOutput 兜底
                if (!outputUrl && aigcFinal.aigcVideo.rawOutput) {
                    var raw = aigcFinal.aigcVideo.rawOutput;
                    outputUrl = raw.FileUrl || (raw.FileInfos && raw.FileInfos.length && raw.FileInfos[0].FileUrl) || '';
                }
            }
            realVideoUrl = outputUrl;

            if (!outputUrl && aigcFinal._noFileUrl) {
                // 任务完成了但拿不到视频 URL
                var errInfo = '';
                if (aigcFinal.aigcVideo) errInfo = ' (ErrCode:' + (aigcFinal.aigcVideo.errCode||0) + ' ' + (aigcFinal.aigcVideo.message||'') + ')';
                appendBubble('ai','<span style="color:#fb923c">画面已生成但视频地址获取超时' + esc(errInfo) + '</span><br>请在作品页刷新查看，或重新生成。','artist');scrollChat();
            }

            for(let i=0;i<clips.length;i++){
                clips[i].status='done'; clips[i].videoUrl = outputUrl;
            }
            artTasks[0].status='done';
            artTasks[1].status='active';
            updateRoleTasks('generating',artTasks);
            await wait(600);
            artTasks[1].status='done';
            updateRoleTasks('generating',artTasks);scrollChat();

        } catch(aigcErr) {
            console.error('[AIGC] 生成失败:', aigcErr);
            // 区分错误类型，展示更明确的信息
            var errMsg = aigcErr.message || '未知错误';
            var isTimeout = errMsg.indexOf('超时') !== -1;
            var hint = isTimeout
                ? '生成时间过长，可能是服务繁忙，请稍后重试'
                : '请检查模型或参数是否正确，稍后重试';
            appendBubble('ai','<span style="color:#f87171">生成遇到问题: ' + esc(errMsg).slice(0,100) + '</span><br><span style="color:#94a3b8;font-size:.78rem">' + hint + '</span><br>已切换到演示模式继续。','artist');scrollChat();
            for(let i=0;i<clips.length;i++){
                clips[i].status='done';
            }
            artTasks[0].status='done'; artTasks[1].status='done';
            updateRoleTasks('generating',artTasks);scrollChat();
        }
    } else {
        // === 方案B：模拟生成 ===
        artTasks[0].status='active';
        updateRoleTasks('generating',artTasks);
        for(let i=0;i<clips.length;i++){
            clips[i].status='generating';
            await wait(1200+Math.random()*1200);
            clips[i].status='done';
        }
        artTasks[0].status='done';
        artTasks[1].status='active';
        updateRoleTasks('generating',artTasks);scrollChat();
        await wait(600);
        artTasks[1].status='done';
        updateRoleTasks('generating',artTasks);scrollChat();
    }
    showFlash('storyboard');
    await wait(1000);

    // ====== 剪辑接活 ======
    phase='composing';switchBg('editor');
    phaseLabel.textContent='视频合成中…';

    const compTasks=[
        {label:'拼接分镜视频',doneLabel:'已拼接全部分镜视频',status:'pending'},
        {label:'渲染转场效果',doneLabel:'转场效果已渲染',status:'pending'},
        {label:'合成背景音频',doneLabel:'背景音频已合成',status:'pending'},
        {label:'编码输出成片',doneLabel:'视频编码完成',status:'pending'}
    ];

    appendRoleBubble('editor','交给我来做后期合成',compTasks,'composing');scrollChat();
    await wait(800);

    for(let i=0;i<compTasks.length;i++){
        compTasks[i].status='active';
        updateRoleTasks('composing',compTasks);
        await wait(1000+Math.random()*800);
        compTasks[i].status='done';
        updateRoleTasks('composing',compTasks);scrollChat();
        await wait(300);
    }
    showFlash('synth');
    await wait(800);

    showResult();
}

/* ===== Result ===== */
function showResult(){
    phase='done';phaseDot.className='g8-pd done';phaseLabel.textContent='创作完成';
    playing=true;startPlayerLoop();
    saveGenTaskRecord('done');

    setTimeout(()=>{
        const lines=['完美！大家干得漂亮！让我们来看看成片','各环节都处理完毕，成片已就绪','创作完成，来看最终效果'];

        // 对话框内的视频预览：有真实URL用video，否则用canvas
        let previewHtml='';
        if(realVideoUrl){
            previewHtml='<div class="rtl-result-thumb" id="resultThumbCard">'+
                '<div class="rtl-thumb-inner">'+
                    '<video id="resultVideo" src="'+realVideoUrl+'" preload="metadata" playsinline muted loop style="width:100%;display:block;border-radius:10px 10px 0 0"></video>'+
                    '<div class="rtl-thumb-play" id="resultPlayOverlay"><svg width="36" height="36" viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="17" fill="rgba(0,0,0,0.45)" stroke="white" stroke-width="1.5"/><path d="M15 11L24 18L15 25V11Z" fill="white"/></svg></div>'+
                '</div>'+
                '<div class="rtl-thumb-info">'+
                    '<span>'+clips.length+' 个分镜 · 1080p · MP4</span>'+
                '</div>'+
            '</div>';
        } else {
            previewHtml='<div class="rtl-result-thumb" id="resultThumbCard">'+
                '<div class="rtl-thumb-inner">'+
                    '<canvas id="resultThumbCanvas" width="320" height="180"></canvas>'+
                    '<div class="rtl-thumb-play" id="resultPlayOverlay"><svg width="36" height="36" viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="17" fill="rgba(0,0,0,0.45)" stroke="white" stroke-width="1.5"/><path d="M15 11L24 18L15 25V11Z" fill="white"/></svg></div>'+
                '</div>'+
                '<div class="rtl-thumb-info">'+
                    '<span>'+clips.length+' 个分镜 · '+totalDuration+'s · 1080p</span>'+
                '</div>'+
            '</div>';
        }

        const actionsHtml='<div class="chat-result-actions"><div class="chat-result-actions-row">'+
            '<button class="ra-btn-refine" id="chatRefBtn"><span>手动精调</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 12L12 4M12 4H6M12 4V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'+
            '<button class="ra-btn-download" id="chatExportBtn"><span>导出视频</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2V10M8 10L11 7M8 10L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12V13C3 13.55 3.45 14 4 14H12C12.55 14 13 13.55 13 13V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>'+
            '</div></div>';

        const rc='<div class="rtl-line"><strong>'+rnd(lines)+'</strong></div>'+previewHtml+actionsHtml;

        appendBubble('ai',rc,'director');scrollChat();

        setTimeout(()=>{
            // canvas 模式：启动动画循环预览
            const cvs=document.getElementById('resultThumbCanvas');
            if(cvs&&clips.length){
                drawClipPreview(cvs,clips[0],0);
                // 持续动画让 canvas 看起来像在播放
                let thumbT=0, thumbAnim=null;
                function animThumb(){
                    thumbT+=1/60;
                    if(thumbT>=totalDuration) thumbT=0;
                    // 找当前片段
                    let elapsed=0,cur=clips[0],curIdx=0;
                    for(let i=0;i<clips.length;i++){if(thumbT<elapsed+clips[i].duration){cur=clips[i];curIdx=i;break}elapsed+=clips[i].duration}
                    drawClipPreview(cvs,cur,curIdx);
                    thumbAnim=requestAnimationFrame(animThumb);
                }
                animThumb();
            }

            // video 模式：自动播放静音预览
            const vid=document.getElementById('resultVideo');
            const playOvl=document.getElementById('resultPlayOverlay');
            if(vid){
                vid.addEventListener('loadeddata',()=>{
                    vid.play().catch(()=>{});
                    if(playOvl) playOvl.style.display='none';
                });
                vid.addEventListener('play',()=>{if(playOvl) playOvl.style.display='none'});
                vid.addEventListener('pause',()=>{if(playOvl) playOvl.style.display=''});
            }

            // 点击视频/缩略图 → 黑灯全屏播放
            const thumbCard=document.getElementById('resultThumbCard');
            if(thumbCard) thumbCard.addEventListener('click',()=>{
                // 如果有真实视频，把它也放到全屏播放器
                if(realVideoUrl){
                    injectRealVideoToPlayer(realVideoUrl);
                }
                turnLightsOff();
            });

            const rb=document.getElementById('chatRefBtn');if(rb)rb.addEventListener('click',()=>{turnLightsOn();enterFinetune()});
            const eb=document.getElementById('chatExportBtn');if(eb)eb.addEventListener('click',()=>{
                if(realVideoUrl){
                    // 真实下载
                    const a=document.createElement('a');a.href=realVideoUrl;a.download='tideo-output.mp4';a.target='_blank';document.body.appendChild(a);a.click();document.body.removeChild(a);
                    eb.innerHTML='已开始下载 ✓';eb.style.opacity='.7';eb.style.pointerEvents='none';
                } else {
                    eb.innerHTML='导出中…';eb.style.opacity='.7';eb.style.pointerEvents='none';setTimeout(()=>{eb.innerHTML='导出完成 ✓';eb.style.opacity='1'},2500);
                }
            });
        },100);
        // 不再自动黑灯 — 用户点击视频才触发
    },600);
}

// 把真实视频注入全屏播放器覆盖层
function injectRealVideoToPlayer(url){
    const wrap=document.querySelector('.g8-player-wrap');if(!wrap)return;
    // 隐藏 canvas，插入/更新 video
    const cvs=wrap.querySelector('canvas');if(cvs) cvs.style.display='none';
    let vid=wrap.querySelector('video');
    if(!vid){
        vid=document.createElement('video');
        vid.style.cssText='width:100%;aspect-ratio:16/9;display:block;background:#000';
        vid.controls=true;vid.autoplay=true;vid.playsInline=true;
        wrap.insertBefore(vid,wrap.firstChild);
    }
    vid.src=url;vid.play().catch(()=>{});
}

/* ===== Player ===== */
function startPlayerLoop(){if(animFrame)return;function tick(){if(playing&&clips.length){playTime+=1/60;if(playTime>=totalDuration)playTime=0;drawPlayerFrame(playTime)}animFrame=requestAnimationFrame(tick)}tick()}

/* ===== Flash ===== */
function showFlash(step){const fl=document.getElementById('stepFlash'),tx=document.getElementById('flashText'),dt=document.getElementById('flashDot');const lm={assign:'人员分配完成',parse:'分镜编排完成',storyboard:'画面生成完成',synth:'视频合成完成',review:'导演验收通过'};const cm={assign:'#3b82f6',parse:'#2563eb',storyboard:'#7c3aed',synth:'#ec4899',review:'#3b82f6'};tx.textContent=lm[step]||'完成';dt.style.background=cm[step]||'#a855f7';fl.classList.remove('active');void fl.offsetWidth;fl.classList.add('active');setTimeout(()=>fl.classList.remove('active'),1500)}

/* ===== Lights ===== */
function turnLightsOff(){
    if(lightsOff||inFinetune)return;lightsOff=true;
    page.classList.add('lights-off');
    document.getElementById('dimmer').classList.add('active');
    // 显示成片播放器，浮到暗幕之上
    playerOverlay.classList.add('active');
    canvasLabel.textContent='成片预览';
    playerOverlay.style.zIndex='54';
    // 如果有真实视频注入，确保播放
    const injVid=document.querySelector('.g8-player-wrap video');
    if(injVid) injVid.play().catch(()=>{});
}
function turnLightsOn(){
    if(!lightsOff)return;lightsOff=false;
    if(_lightsOffTimer){clearTimeout(_lightsOffTimer);_lightsOffTimer=null}
    page.classList.remove('lights-off');
    document.getElementById('dimmer').classList.remove('active');
    playerOverlay.classList.remove('active');
    playerOverlay.style.zIndex='';
    bgIndicator.classList.add('vis');
    // 暂停全屏播放器里的视频
    const injVid=document.querySelector('.g8-player-wrap video');
    if(injVid) injVid.pause();
}
function scheduleLightsOff(delay){if(_lightsOffTimer)clearTimeout(_lightsOffTimer);_lightsOffTimer=setTimeout(()=>{_lightsOffTimer=null;turnLightsOff()},delay||1500)}
document.getElementById('dimBg').addEventListener('click',turnLightsOn);
document.getElementById('dimLightBtn').addEventListener('click',turnLightsOn);
document.getElementById('dimRefBtn').addEventListener('click',()=>{turnLightsOn();enterFinetune()});
document.getElementById('dimExportBtn').addEventListener('click',()=>{
    if(realVideoUrl){
        const a=document.createElement('a');a.href=realVideoUrl;a.download='tideo-output.mp4';a.target='_blank';document.body.appendChild(a);a.click();document.body.removeChild(a);
    } else {
        appendBubble('ai','视频导出中…','editor');scrollChat();
    }
});
// 点击 playerOverlay 空白区域（非播放器本身）→ 关灯
playerOverlay.addEventListener('click',function(e){
    // 只有点到 overlay 自身（非 .g8-player-wrap 内部）才关灯
    if(e.target===playerOverlay || e.target.id==='canvasLabel') turnLightsOn();
});

/* ===== Finetune ===== */
let ftSplitCount=5;
let ftPlaying=false, ftPlayTime=0, ftAnimFrame=null;

function selectFtClip(idx){
    selectedClipIdx=idx;
    // 重启该片段播放
    ftPlayTime=0;
    const c=clips[idx];if(!c)return;
    drawFtPlayerFrame(0,c,idx);
    // 更新播放器 UI
    const badge=document.getElementById('ftPlayerBadge');if(badge){badge.textContent='F'+c.id;badge.style.background='rgba(255,255,255,0.15)'}
    const title=document.getElementById('ftPlayerTitle');if(title)title.textContent=c.title;
    const fill=document.getElementById('ftPlayerProgressFill');if(fill)fill.style.width='0%';
    const time=document.getElementById('ftPlayerTime');
    if(time) time.textContent='0:00 / 0:'+((c.duration<10?'0':'')+c.duration);
    // 高亮时间轴
    document.querySelectorAll('.g8-ft-seg').forEach((s,i)=>s.classList.toggle('selected',i===idx));
    // 高亮右侧卡片
    document.querySelectorAll('.g8-ftc').forEach((c,i)=>c.classList.toggle('active',i===idx));
}

function drawFtPlayerFrame(t,clip,idx){
    const canvas=document.getElementById('ftCanvas');if(!canvas||!clip)return;
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
    const pct=clip.duration>0?t/clip.duration:0;

    // 丰富渐变背景
    const hue1=(idx*65+200+t*3)%360,hue2=(hue1+40)%360,hue3=(hue1+120)%360;
    const grd=ctx.createLinearGradient(0,0,w,h);
    grd.addColorStop(0,'hsl('+hue1+',45%,8%)');grd.addColorStop(0.4,'hsl('+hue2+',40%,12%)');grd.addColorStop(1,'hsl('+hue3+',35%,6%)');
    ctx.fillStyle=grd;ctx.fillRect(0,0,w,h);

    // 光圈
    ctx.globalAlpha=0.08;
    ctx.beginPath();ctx.arc(w*0.35+Math.sin(t*0.15)*120,h*0.4+Math.cos(t*0.12)*80,200+Math.sin(t*0.3)*40,0,Math.PI*2);
    ctx.fillStyle=clip.color;ctx.fill();
    ctx.beginPath();ctx.arc(w*0.65+Math.cos(t*0.18)*100,h*0.6+Math.sin(t*0.1)*60,160+Math.cos(t*0.25)*30,0,Math.PI*2);
    ctx.fillStyle='hsl('+hue2+',50%,40%)';ctx.fill();

    // 粒子
    ctx.globalAlpha=0.3;
    for(let i=0;i<20;i++){
        const px=(Math.sin(t*0.08+i*3.7)*.45+.5)*w;
        const py=(Math.cos(t*0.06+i*2.9)*.45+.5)*h;
        const sz=1.5+Math.sin(t*0.4+i)*1;
        ctx.beginPath();ctx.arc(px,py,sz,0,Math.PI*2);
        ctx.fillStyle=i%2===0?clip.color:'#fff';ctx.fill();
    }

    // 光条
    ctx.globalAlpha=0.03;
    for(let i=0;i<4;i++){
        const y=h*(0.2+i*0.2)+Math.sin(t*0.3+i)*20;
        ctx.fillStyle='#fff';ctx.fillRect(0,y,w,1.5);
    }

    // 标题+描述
    ctx.globalAlpha=0.25;ctx.font='bold '+Math.min(w*0.06,48)+'px sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(clip.title,w/2,h/2-12);
    ctx.globalAlpha=0.15;ctx.font=Math.min(w*0.022,16)+'px sans-serif';
    const descShort=clip.desc.length>30?clip.desc.substring(0,30)+'…':clip.desc;
    ctx.fillText(descShort,w/2,h/2+24);
    ctx.globalAlpha=1;ctx.textBaseline='alphabetic';

    // 更新播放器进度
    const fillBar=document.getElementById('ftPlayerProgressFill');if(fillBar)fillBar.style.width=(pct*100)+'%';
    const timeEl=document.getElementById('ftPlayerTime');
    if(timeEl){
        const cm=Math.floor(t/60),cs=Math.floor(t%60);
        const dm=Math.floor(clip.duration/60),ds=Math.floor(clip.duration%60);
        timeEl.textContent=cm+':'+(cs<10?'0':'')+cs+' / '+dm+':'+(ds<10?'0':'')+ds;
    }
    // 更新时间轴播放头 + 时间显示
    let elapsed=0;for(let j=0;j<idx;j++) elapsed+=clips[j].duration;
    const globalT=elapsed+t;
    const ph=document.getElementById('ftPlayhead');
    if(ph&&totalDuration>0) ph.style.left=((globalT/totalDuration)*100)+'%';
    const tlTime=document.getElementById('ftTlTime');
    if(tlTime){
        const gm=Math.floor(globalT/60),gs=Math.floor(globalT%60);
        const tm=Math.floor(totalDuration/60),ts=Math.floor(totalDuration%60);
        tlTime.innerHTML='<span class="cur">'+String(gm).padStart(2,'0')+':'+String(gs).padStart(2,'0')+'</span> / '+String(tm).padStart(2,'0')+':'+String(ts).padStart(2,'0');
    }
}

function startFtPlayerLoop(){
    if(ftAnimFrame)return;
    function tick(){
        if(ftPlaying&&clips[selectedClipIdx]){
            ftPlayTime+=1/60;
            const c=clips[selectedClipIdx];
            if(ftPlayTime>=c.duration) ftPlayTime=0;
            drawFtPlayerFrame(ftPlayTime,c,selectedClipIdx);
        }
        ftAnimFrame=requestAnimationFrame(tick);
    }
    tick();
}
function stopFtPlayerLoop(){if(ftAnimFrame){cancelAnimationFrame(ftAnimFrame);ftAnimFrame=null}}
function toggleFtPlay(){
    ftPlaying=!ftPlaying;
    const btn=document.getElementById('ftPlayBtn');
    if(btn) btn.classList.toggle('playing',ftPlaying);
    if(ftPlaying) startFtPlayerLoop();
}

function renderFtTimeline(){
    const tl=document.getElementById('ftTimeline');if(!tl)return;
    // 时间信息
    const tlInfo=document.getElementById('ftTlInfo');
    if(tlInfo) tlInfo.textContent=clips.length+' 个片段 · '+totalDuration+'s';
    const tlTime=document.getElementById('ftTlTime');
    if(tlTime){
        const tm=Math.floor(totalDuration/60),ts=Math.floor(totalDuration%60);
        tlTime.innerHTML='<span class="cur">00:00</span> / '+String(tm).padStart(2,'0')+':'+String(ts).padStart(2,'0');
    }
    // 标尺
    const rulerInner=document.getElementById('ftRulerInner');
    if(rulerInner){
        let rh='';
        const step=totalDuration>60?30:totalDuration>20?10:5;
        for(let t=0;t<=totalDuration;t+=step){
            const pct=(t/totalDuration)*100;
            const m=Math.floor(t/60),s=Math.floor(t%60);
            rh+='<div class="g8-ft-rm" style="left:'+pct+'%"><span class="tl">'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'</span><span class="tick"></span></div>';
        }
        rulerInner.innerHTML=rh;
    }
    // 轨道色块 — absolute 定位在 trk-c 内
    let html='';
    let offset=0;
    clips.forEach((c,i)=>{
        const left=(offset/totalDuration)*100;
        const w=(c.duration/totalDuration)*100;
        html+='<div class="g8-ft-seg'+(i===selectedClipIdx?' selected':'')+'" data-tl-idx="'+i+'" style="left:'+left+'%;width:'+w+'%">'+
            '<div class="g8-ft-seg-label"><span class="g8-ft-seg-num">F'+c.id+'</span>'+esc(c.title)+'</div>'+
        '</div>';
        offset+=c.duration;
    });
    tl.innerHTML=html;
    // 点击事件
    tl.querySelectorAll('.g8-ft-seg').forEach(seg=>{
        seg.addEventListener('click',()=>{
            const idx=+seg.dataset.tlIdx;
            selectFtClip(idx);
            const target=document.querySelector('[data-ft-idx="'+idx+'"]');
            if(target) target.scrollIntoView({behavior:'smooth',block:'nearest'});
        });
    });
}
// hex 转 rgb
function hexToRgb(hex){
    const h=hex.replace('#','');
    const r=parseInt(h.substring(0,2),16);
    const g=parseInt(h.substring(2,4),16);
    const b=parseInt(h.substring(4,6),16);
    return r+','+g+','+b;
}
function renderFtCards(){
    const ftBody=document.getElementById('ftBody');
    ftBody.innerHTML=clips.map((c,i)=>{
        return '<div class="g8-ftc'+(i===selectedClipIdx?' active':'')+'" data-ft-idx="'+i+'">'+
            '<div class="g8-ftc-head" data-ft-select="'+i+'">'+
                '<span class="g8-ftc-badge">F'+c.id+'</span>'+
                '<span class="g8-ftc-head-name">'+esc(c.title)+'</span>'+
                '<button class="g8-ftc-edit-btn" data-ft-edit="'+i+'" title="编辑"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12.5 2.5L6 9L4 11L3 13L5 12L7 10L13.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 4.5L11.5 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>'+
                (clips.length>2?'<button class="g8-ftc-delete" data-ft-delete="'+i+'" title="删除"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 5V13C4 13.55 4.45 14 5 14H11C11.55 14 12 13.55 12 13V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 5H13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 5V3.5C6 3.22 6.22 3 6.5 3H9.5C9.78 3 10 3.22 10 3.5V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>':'')+
            '</div>'+
            '<div class="g8-ftc-preview" data-ft-select="'+i+'">'+
                '<div class="g8-ftc-thumb-mini"><canvas width="178" height="100" data-ftm-cvs="'+i+'"></canvas></div>'+
                '<div class="g8-ftc-desc">'+esc(c.desc)+'</div>'+
            '</div>'+
            '<div class="g8-ftc-body collapsed" data-ft-body="'+i+'">'+
                '<div class="g8-ftf"><span class="g8-ftf-label">画面描述</span><textarea class="g8-ftf-textarea" data-ft-desc="'+i+'">'+esc(c.desc)+'</textarea></div>'+
                '<div class="g8-ftf"><span class="g8-ftf-label">开始结束时间</span><div class="g8-ftf-dur"><div class="g8-ftf-num"><input type="number" class="g8-ftf-num-val" data-ft-dur="'+i+'" min="2" max="30" value="'+c.duration+'"><div class="g8-ftf-num-btns"><button class="g8-ftf-num-btn" data-ft-dur-up="'+i+'"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 10L8 6L12 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="g8-ftf-num-btn" data-ft-dur-down="'+i+'"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div><span class="g8-ftf-unit">s</span></div></div>'+
                '<div class="g8-ftf-actions"><button class="g8-ftf-cancel" data-ft-collapse="'+i+'">取消</button><button class="g8-ftf-regen" data-ft-regen="'+i+'"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8C2 4.68 4.68 2 8 2C10.04 2 11.84 3.04 12.88 4.64" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M14 8C14 11.32 11.32 14 8 14C5.96 14 4.16 12.96 3.12 11.36" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 2V5H9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14V11H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> 重新生成</button></div>'+
            '</div>'+
        '</div>';
    }).join('');
    // 绘制缩略图
    clips.forEach((c,i)=>{const cvs=ftBody.querySelector('[data-ftm-cvs="'+i+'"]');if(cvs)drawClipPreview(cvs,c,i)});
    // 点击卡片（非编辑/删除按钮区域）= 选中片段
    ftBody.querySelectorAll('[data-ft-select]').forEach(h=>{h.addEventListener('click',e=>{
        if(e.target.closest('.g8-ftc-edit-btn')||e.target.closest('.g8-ftc-delete'))return;
        const idx=+h.dataset.ftSelect;
        selectFtClip(idx);
        renderFtTimeline();
    })});
    // 编辑按钮 = 展开/收起编辑区
    ftBody.querySelectorAll('[data-ft-edit]').forEach(btn=>{btn.addEventListener('click',e=>{
        e.stopPropagation();
        const idx=+btn.dataset.ftEdit;
        const body=ftBody.querySelector('[data-ft-body="'+idx+'"]');
        if(body) body.classList.toggle('collapsed');
        selectFtClip(idx);
        renderFtTimeline();
    })});
    // 描述编辑
    ftBody.querySelectorAll('[data-ft-desc]').forEach(ta=>{ta.addEventListener('input',()=>{const i=+ta.dataset.ftDesc;if(clips[i])clips[i].desc=ta.value})});
    // 时长数字输入
    ftBody.querySelectorAll('[data-ft-dur]').forEach(inp=>{inp.addEventListener('change',()=>{const i=+inp.dataset.ftDur,v=Math.max(2,Math.min(30,+inp.value));inp.value=v;if(clips[i]){clips[i].duration=v;updateFtInfo()}})});
    // 时长上下按钮
    ftBody.querySelectorAll('[data-ft-dur-up]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const i=+btn.dataset.ftDurUp;if(!clips[i])return;const v=Math.min(30,clips[i].duration+1);clips[i].duration=v;const inp=ftBody.querySelector('[data-ft-dur="'+i+'"]');if(inp)inp.value=v;updateFtInfo()})});
    ftBody.querySelectorAll('[data-ft-dur-down]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const i=+btn.dataset.ftDurDown;if(!clips[i])return;const v=Math.max(2,clips[i].duration-1);clips[i].duration=v;const inp=ftBody.querySelector('[data-ft-dur="'+i+'"]');if(inp)inp.value=v;updateFtInfo()})});
    // 取消按钮 = 收起编辑区
    ftBody.querySelectorAll('[data-ft-collapse]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const i=+btn.dataset.ftCollapse;const body=ftBody.querySelector('[data-ft-body="'+i+'"]');if(body)body.classList.add('collapsed')})});
    // 重新生成
    ftBody.querySelectorAll('[data-ft-regen]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const i=+btn.dataset.ftRegen;const origHtml=btn.innerHTML;btn.innerHTML='生成中...';btn.style.opacity='.5';btn.disabled=true;setTimeout(()=>{btn.innerHTML='已重新生成';const cvs=ftBody.querySelector('[data-ftm-cvs="'+i+'"]');if(cvs)drawClipPreview(cvs,clips[i],i);selectFtClip(i);setTimeout(()=>{btn.innerHTML=origHtml;btn.style.opacity='';btn.disabled=false},1500)},2000)})});
    // 删除
    ftBody.querySelectorAll('[data-ft-delete]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const i=+btn.dataset.ftDelete;if(clips.length<=2)return;clips.splice(i,1);clips.forEach((c,j)=>{c.id=j+1;c.color=CC[j%CC.length]});totalDuration=clips.reduce((s,c)=>s+c.duration,0);ftSplitCount=clips.length;var sv=document.getElementById('ftConfirmSplitVal');if(sv)sv.textContent=ftSplitCount;renderFtCards();updateFtInfo();selectFtClip(0)})});
}
function updateFtInfo(){totalDuration=clips.reduce((s,c)=>s+c.duration,0);renderFtTimeline()}

function runRevealAnimation(onDone){
    const ftBody=document.getElementById('ftBody');ftBody.innerHTML='';
    updateFtInfo();renderFtTimeline();
    let revealed=0;
    function revealNext(){
        if(revealed>=clips.length){
            renderFtCards();renderFtTimeline();selectFtClip(0);
            if(onDone)onDone();
            return;
        }
        const c=clips[revealed],i=revealed;
        const card=document.createElement('div');
        card.className='g8-ftc ft-generating ft-pop-in';card.dataset.ftIdx=i;
        card.innerHTML=
            '<div class="g8-ftc-head"><span class="g8-ftc-badge">F'+c.id+'</span><span class="g8-ftc-head-name">'+esc(c.title)+'</span></div>'+
            '<div class="g8-ftc-preview"><div class="g8-ftc-thumb-mini"><canvas width="178" height="100" data-ftm-cvs="'+i+'"></canvas></div><div class="g8-ftc-desc" style="color:var(--text3)">生成中…</div></div>';
        ftBody.appendChild(card);
        selectFtClip(i);
        const cvs=card.querySelector('[data-ftm-cvs="'+i+'"]');if(cvs)drawClipPreview(cvs,c,i);
        setTimeout(()=>{
            card.classList.remove('ft-generating');
            const desc=card.querySelector('.g8-ftc-desc');
            if(desc){desc.style.color='';desc.textContent=c.desc.length>60?c.desc.substring(0,60)+'…':c.desc}
            revealed++;setTimeout(revealNext,150);
        },400);
    }
    setTimeout(revealNext,300);
}

function enterFinetune(){
    turnLightsOn();if(_lightsOffTimer){clearTimeout(_lightsOffTimer);_lightsOffTimer=null}
    inFinetune=true;page.classList.add('ft-mode');
    ftSplitCount=clips.length;var _sv=document.getElementById('ftConfirmSplitVal');if(_sv)_sv.textContent=ftSplitCount;
    renderFtCards();renderFtTimeline();updateFtInfo();selectFtClip(0);
    // 启动精调播放器
    ftPlaying=true;
    document.getElementById('ftPlayBtn').classList.add('playing');
    startFtPlayerLoop();
    // 播放按钮
    document.getElementById('ftPlayBtn').onclick=toggleFtPlay;
    // 时间轴播放按钮联动
    document.getElementById('ftTlPlayBtn').onclick=toggleFtPlay;
    // 进度条点击跳转
    document.getElementById('ftPlayerProgressTrack').onclick=function(e){
        const c=clips[selectedClipIdx];if(!c)return;
        const rect=this.getBoundingClientRect();
        const pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
        ftPlayTime=pct*c.duration;
        drawFtPlayerFrame(ftPlayTime,c,selectedClipIdx);
    };
    // 鼠标跟随亮光
    const glow=document.getElementById('ftGlow');
    const ftLayout=document.getElementById('ftLayout');
    if(glow&&ftLayout){
        ftLayout._glowHandler=function(e){
            glow.style.left=e.clientX+'px';
            glow.style.top=e.clientY+'px';
        };
        ftLayout.addEventListener('mousemove',ftLayout._glowHandler);
    }
    // 添加分镜
    document.getElementById('ftAddClipBtn').onclick=()=>{
        const idx=clips.length;clips.push({id:idx+1,title:TITLES[idx]||'片段'+(idx+1),duration:5,desc:'（新分镜）',color:CC[idx%CC.length],status:'done',refs:[]});
        totalDuration=clips.reduce((s,c)=>s+c.duration,0);ftSplitCount=clips.length;
        renderFtCards();updateFtInfo();selectFtClip(clips.length-1);
        const last=document.querySelector('[data-ft-idx="'+(clips.length-1)+'"]');if(last)last.scrollIntoView({behavior:'smooth',block:'center'});
    };
    phaseDot.className='g8-pd';phaseLabel.textContent='精调模式';
}
function exitFinetune(){
    inFinetune=false;page.classList.remove('ft-mode');
    // 停止精调播放器
    ftPlaying=false;stopFtPlayerLoop();
    totalDuration=clips.reduce((s,c)=>s+c.duration,0);
    appendBubble('ai','精调已保存！'+clips.length+' 个分镜 · '+totalDuration+'s','director');scrollChat();
    // 清理鼠标亮光
    const ftLayout=document.getElementById('ftLayout');
    if(ftLayout&&ftLayout._glowHandler){ftLayout.removeEventListener('mousemove',ftLayout._glowHandler);delete ftLayout._glowHandler}
}
document.getElementById('ftDoneBtn').addEventListener('click',exitFinetune);

/* ===== Chat Collapse ===== */
function collapseChat(){chatCollapsed=true;chatPanel.classList.add('collapsed');chatFab.classList.add('active');unreadCount=0;fabBadge.textContent='';fabBadge.style.display='none'}
function expandChat(){chatCollapsed=false;chatPanel.classList.remove('collapsed');chatFab.classList.remove('active');unreadCount=0;fabBadge.textContent='';fabBadge.style.display='none';scrollChat()}
document.getElementById('chatCollapseBtn').addEventListener('click',collapseChat);
chatFab.addEventListener('click',expandChat);

/* ===== Back ===== */
const backModal=document.getElementById('backModal');
document.getElementById('backBtn').addEventListener('click',e=>{e.preventDefault();if(!taskStarted||phase==='done'){location.href='create.html';return}backModal.classList.add('active')});
document.getElementById('backCancelBtn').addEventListener('click',()=>backModal.classList.remove('active'));
backModal.addEventListener('click',e=>{if(e.target===backModal)backModal.classList.remove('active')});
document.getElementById('backStopBtn').addEventListener('click',()=>{
    backModal.classList.remove('active');
    // 停止任务：记录为失败
    saveGenTaskRecord('failed');
    location.href='create.html';
});
document.getElementById('backBgBtn').addEventListener('click',()=>{
    backModal.classList.remove('active');
    // 收起任务到后台
    saveGenTaskRecord('processing');
    var taskInfo = {
        id: _genTaskId,
        name: (currentPrompt || '').slice(0, 30) || 'AI 生成',
        mode: 'generate',
        prompt: currentPrompt || '',
        phase: phase === 'done' ? 'done' : 'processing',
        time: new Date().toLocaleTimeString()
    };
    // 保存完整状态供恢复
    try {
        sessionStorage.setItem('tideo_gen_state', JSON.stringify({
            id: _genTaskId,
            phase: phase,
            prompt: currentPrompt,
            chatHTML: chatFlow.innerHTML,
            clips: clips.map(function(c){ return { id:c.id, title:c.title, desc:c.desc, duration:c.duration, color:c.color, status:c.status, videoUrl:c.videoUrl||'' }; }),
            realVideoUrl: realVideoUrl,
            taskStarted: taskStarted
        }));
    } catch(e) {}
    var bgTasks = [];
    try { bgTasks = JSON.parse(sessionStorage.getItem('tideo_minimized_tasks') || '[]'); } catch(e){}
    bgTasks.push(taskInfo);
    sessionStorage.setItem('tideo_minimized_tasks', JSON.stringify(bgTasks));
    location.href = 'create.html';
});

/* ===== 保存任务记录到作品页 ===== */
var _genTaskId = 'gen_' + Date.now();
function saveGenTaskRecord(status) {
    try {
        var records = JSON.parse(localStorage.getItem('tideo_results') || '[]');
        var record = {
            id: _genTaskId,
            name: (currentPrompt || '未命名视频').slice(0, 40),
            type: 'generate',
            mode: 'generate',
            features: ['AI 生成', selectedModel.label || 'Kling'],
            status: status,
            videoUrl: realVideoUrl || '',
            outputUrl: realVideoUrl || '',
            duration: totalDuration || 0,
            elapsed: 0,
            date: new Date().toISOString()
        };
        var idx = -1;
        for (var i = 0; i < records.length; i++) {
            if (records[i].id === _genTaskId) { idx = i; break; }
        }
        if (idx >= 0) { record.date = records[idx].date; records[idx] = record; }
        else records.unshift(record);
        if (records.length > 50) records = records.slice(0, 50);
        localStorage.setItem('tideo_results', JSON.stringify(records));
    } catch(e) {}
}

/* ===== Init ===== */
phaseEl.classList.add('vis');

// 尝试恢复后台任务状态
var _genRestore = P.get('restore') === '1';
var _genSaved = null;
if (_genRestore) {
    try { _genSaved = JSON.parse(sessionStorage.getItem('tideo_gen_state')); } catch(e) {}
}

if (_genSaved && _genRestore) {
    // 恢复已有任务
    phase = _genSaved.phase || 'idle';
    currentPrompt = _genSaved.prompt || '';
    taskStarted = _genSaved.taskStarted || false;
    realVideoUrl = _genSaved.realVideoUrl || '';
    if (_genSaved.clips && _genSaved.clips.length) {
        clips = _genSaved.clips;
        totalDuration = clips.reduce(function(s,c){ return s + (c.duration||5); }, 0);
    }
    // 恢复聊天
    if (_genSaved.chatHTML) chatFlow.innerHTML = _genSaved.chatHTML;
    // 恢复阶段指示
    if (phase === 'done') {
        phaseDot.className = 'g8-pd done'; phaseLabel.textContent = '创作完成';
        playing = true; startPlayerLoop();
    } else if (phase !== 'idle') {
        phaseDot.className = 'g8-pd proc'; phaseLabel.textContent = '创作中（已恢复）…';
        // 模拟后台继续处理：几秒后自动完成
        setTimeout(function(){ showResult(); }, 3000 + Math.random() * 4000);
    }
    // 重新绑定聊天中的精调/导出按钮
    var _rb = document.getElementById('chatRefBtn');
    if (_rb) _rb.addEventListener('click', function(){ if(clips.length) enterFinetune(0); });
    var _eb = document.getElementById('chatExportBtn');
    if (_eb) _eb.addEventListener('click', function(){ turnLightsOff(); });
    // 清除保存的状态
    sessionStorage.removeItem('tideo_gen_state');
    console.log('[Generate] 恢复任务:', _genSaved.id, '阶段:', phase);
} else if(promptText) {
    setTimeout(()=>startCreation(promptText),500);
} else if (P.get('finetune') === '1') {
    // 评审/预览：直接进入精调模式（生成 mock 分镜数据）
    taskStarted = true;
    currentPrompt = P.get('prompt') || '一段山海日出的电影级短片，多个镜头组合';
    phase = 'done';
    parseTextToClips(currentPrompt);
    clips.forEach(function(c){ c.status = 'done'; });
    totalDuration = clips.reduce(function(s,c){ return s + c.duration; }, 0);
    phaseDot.className = 'g8-pd done'; phaseLabel.textContent = '精调模式';
    setTimeout(function(){ enterFinetune(0); }, 200);
} else {
    phaseDot.className='g8-pd';phaseLabel.textContent='等待创作指令';
}

})();
