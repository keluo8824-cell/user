(function(){
'use strict';

if(window.__VIDEO_APP_STARTED__)return;
window.__VIDEO_APP_STARTED__=true;

setTimeout(injectMobileOptimize,0);
setTimeout(function(){
  try{
    if(!document.getElementById('smartSourceStyle')){
      const st=document.createElement('style');
      st.id='smartSourceStyle';
      st.textContent=`
      #sourceModal .modal-box{max-width:420px;width:92%;border-radius:14px;padding:16px;background:#151515;color:#fff}
      #sourceModal .source-item{height:48px;margin:8px 0;width:100%;display:flex;justify-content:space-between;align-items:center;border-radius:8px;padding:0 14px;background:#222;color:#ddd;border:1px solid #333}
      #sourceModal .source-item.active{border-color:#e33;color:#fff}
      #sourceModal .source-item[data-status="error"]{opacity:.45}
      `;
      document.head.appendChild(st);
    }
  }catch(e){}
},10);


const CONFIG_URLS=[
  atob('aHR0cHM6Ly9jZG4uY2xvdWRmaWFyZS50b3Avc291cmNlLmpzb24='),
  atob('aHR0cHM6Ly9naC1wcm94eS5vcmcvaHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL2tlbHVvODgyNC1jZWxsL3VzZXIvcmVmcy9oZWFkcy9tYWluL3NvdXJjZS5qc29u')
];
const FALLBACK_BACKENDS=[];

const FALLBACK_SOURCE_JSON_URLS=[
  'https://cdn.cloudfiare.top/jx.json'
];
const DEFAULT_AD='http://tu.ix99.top/tu.png';
const CACHE_PREFIX='video_static_v1_';
const app=document.getElementById('app');
const state={remote:{},backends:[],backend:'',secret:'',cacheEnabled:false,boot:null,sources:[],fallbackSources:[],directMode:false,sourceId:0,categories:[],typeId:0,page:1,view:'home',keyword:'',detail:null,episode:0,hls:null,trialStopped:false,user:null,token:localStorage.getItem(CACHE_PREFIX+'token')||''};
let handlingPopState=false;

function injectMobileOptimize(){
  if(document.getElementById('mobileOptimizeStyle'))return;
  const st=document.createElement('style');
  st.id='mobileOptimizeStyle';
  st.textContent=`
  .player-page{padding-top:48px;padding-bottom:65px;}
  .player-page .back{position:fixed;top:0;left:0;z-index:99998;height:44px;}
  .video-wrap{position:relative;width:100%;aspect-ratio:16/9;background:#000;z-index:1;}
  .video-wrap video{width:100%;height:100%;object-fit:contain;}
  .bottom-nav{z-index:99998!important;}
  .live-view{touch-action:pan-y;overscroll-behavior:none;}
  .live-item{height:auto;min-height:calc(100svh - 120px);position:relative;touch-action:pan-y;padding-top:60px;padding-bottom:60px;}
  .live-item video{width:100%;aspect-ratio:16/9;height:auto;object-fit:contain;background:#000;}
  `;
  document.head.appendChild(st);
}

function pushRoute(view,data={}){
  if(handlingPopState)return;
  history.pushState(Object.assign({videoApp:true,view:view},data),'');
}
function replaceRoute(view,data={}){
  history.replaceState(Object.assign({videoApp:true,view:view},data),'');
}

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function pick(o,keys,d=''){for(const k of keys)if(o&&o[k]!=null&&o[k]!=='')return o[k];return d;}
function image(v){const u=pick(v,['vod_pic','vod_pic_thumb','vod_pic_slide','vod_pic_url','pic','pic_url','cover']);return /^\/\//.test(u)?location.protocol+u:u;}
function normalizeUrl(u){
    if(!u)return '';
    if(/^\/\//.test(u))return location.protocol+u;
    return u;
}
function timeoutFetch(url,opt={},ms=5500){
  if(typeof AbortController==='undefined'){
    return Promise.race([
      fetch(url,opt),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('请求超时')),ms))
    ]);
  }
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  return fetch(url,Object.assign({},opt,{signal:c.signal})).then(r=>{clearTimeout(t);return r},e=>{clearTimeout(t);throw e});
}
function cacheGet(key,maxAge=0){try{const x=JSON.parse(localStorage.getItem(CACHE_PREFIX+key)||'null');if(!x)return null;if(maxAge&&Date.now()-x.time>maxAge)return null;return x.data}catch(e){return null}}
function cacheSet(key,data){try{localStorage.setItem(CACHE_PREFIX+key,JSON.stringify({time:Date.now(),data}))}catch(e){}}
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add('hidden'),2300)}
function modal(id,show=true){document.getElementById(id).classList.toggle('hidden',!show);document.body.classList.toggle('lock',show)}

function sourceApiUrl(x){
  if(!x)return '';
  if(typeof x==='string')return normalizeUrl(x.trim());
  return normalizeUrl(String(x.url||x.api||x.api_url||x.vod_url||x.endpoint||x.address||'').trim());
}
function looksLikeVodApi(url){
  return /(?:api\.php\/provide\/vod|provide\/vod|ac=(?:list|detail)|\/vod\/?(?:\?|$))/i.test(String(url||''));
}
function normalizeFallbackSources(j){
  if(!j||typeof j!=='object')return [];
  let raw=[];
  ['vod_sources','resource_sources','resources','fallback_sources','sites'].forEach(k=>{if(Array.isArray(j[k]))raw=raw.concat(j[k]);});
  // 兼容最常见的 {sources:[{name,url}]}。只有明显像资源站 API 的对象才进入直连列表，避免把后台地址误当资源站。
  if(Array.isArray(j.sources)){
    raw=raw.concat(j.sources.filter(x=>{
      if(!x||typeof x!=='object'||x.backend)return false;
      return /^https?:\/\//i.test(sourceApiUrl(x));
    }));
  }
  const out=[];
  raw.forEach((x,i)=>{
    const url=sourceApiUrl(x);
    if(!/^https?:\/\//i.test(url))return;
    const name=(x&&typeof x==='object'&&(x.name||x.title||x.label))||('备用线路'+(i+1));
    const id=Number(x&&typeof x==='object'&&x.id)||900001+i;
    if(!out.some(a=>a.url===url))out.push({id,name:String(name),url:url,direct:true});
  });
  return out;
}
async function remoteConfig(){
  const saved=cacheGet('remote',300000);
  state.backends=[];
  state.fallbackSources=[];
  state.cacheEnabled=false;
  if(saved){
    applyRemote(saved,true);
    state.fallbackSources=normalizeFallbackSources(saved);
  }

  const urls=[...new Set([...CONFIG_URLS,...FALLBACK_SOURCE_JSON_URLS])];
  const tasks=urls.map(url=>
    timeoutFetch(url+(url.includes('?')?'&':'?')+'t='+Date.now(),{cache:'no-store'},2500)
      .then(r=>r.ok?r.json():null)
      .catch(()=>null)
  );

  const configs=[];
  const results=await Promise.all(tasks);
  for(const j of results){
    if(!j||typeof j!=='object')continue;
    configs.push(j);
    applyRemote(j,true);
    const fs=normalizeFallbackSources(j);
    state.fallbackSources=[...state.fallbackSources,...fs].filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i);
  }

  if(configs.length){
    const merged=Object.assign({},configs[0],{
      backends:state.backends,
      fallback_sources:state.fallbackSources,
      cache_enabled:state.cacheEnabled
    });
    state.remote=merged;
    cacheSet('remote',merged);
    return merged;
  }

  if(saved&&(state.backends.length||state.fallbackSources.length))return saved;
  const fallback={backends:FALLBACK_BACKENDS,fallback_sources:state.fallbackSources};
  applyRemote(fallback,true);
  return fallback;
}
function applyRemote(j,append=false){
  if(!j||typeof j!=='object')return false;
  let bs=Array.isArray(j.backends)?j.backends:[];
  // 旧格式只有 sources 且内容是字符串/后台根地址时，继续兼容为后台列表。
  if(!bs.length&&Array.isArray(j.sources)){
    bs=j.sources.filter(x=>typeof x==='string'||(x&&typeof x==='object'&&x.backend)).map(x=>typeof x==='string'?x:x.backend).filter(Boolean);
  }
  bs=bs.map(x=>typeof x==='string'?x:(x&&x.url||x&&x.backend||'')).map(x=>{try{return new URL(String(x),location.href).href.replace(/\/+$/,'')}catch(e){return''}}).filter(x=>/^https?:\/\//i.test(x));
  state.remote=j;
  if(j.api_secret)state.secret=j.api_secret;
  if(j.cache_enabled===true)state.cacheEnabled=true;
  state.backends=(append?[...state.backends,...bs]:bs).filter((x,i,a)=>a.indexOf(x)===i);
  return bs.length>0;
}
function headers(){const h={'Content-Type':'application/json'};if(state.secret)h['X-API-Key']=state.secret;return h}
async function callAt(base,action,data={}){
  const r=await timeoutFetch(base+'/api.php?action='+encodeURIComponent(action),{method:'POST',headers:headers(),body:JSON.stringify(data)},action==='vod'?30000:20000);
  const text=await r.text();let j;try{j=JSON.parse(text)}catch(e){throw new Error('后台返回内容不是JSON')}
  if(!r.ok||(action==='bootstrap'&&j.ok!==true)||(action==='vod'&&Number(j.code)>=500))throw new Error(j.msg||'后台请求失败');return j;
}
async function api(action,data={}){
  let saved=localStorage.getItem(CACHE_PREFIX+'backend');
  const order=[saved,state.backend,...state.backends].filter((x,i,a)=>x&&a.indexOf(x)===i);

  // 优先尝试上次最快后台
  if(saved){
    try{
      const j=await callAt(saved,action,data);
      state.backend=saved;
      return j;
    }catch(e){}
  }

  // 多后台并发竞速，最快成功者优先
  return new Promise((resolve,reject)=>{
    let finished=false,errors=0,last;
    const list=order.length?order:state.backends;
    if(!list.length){reject(new Error('后台暂时无法连接'));return;}

    list.forEach(base=>{
      callAt(base,action,data).then(j=>{
        if(finished)return;
        finished=true;
        state.backend=base;
        localStorage.setItem(CACHE_PREFIX+'backend',base);
        resolve(j);
      }).catch(e=>{
        last=e;
        errors++;
        if(errors>=list.length&&!finished){
          reject(last||new Error('全部后台暂时无法连接'));
        }
      });
    });
  });
}
function currentSourceObject(){return (state.sources||[]).find(x=>Number(x.id)===Number(state.sourceId))||null;}
function directSourceForCurrent(){
  const cur=currentSourceObject();
  const curUrl=sourceApiUrl(cur);
  if(curUrl&&/^https?:\/\//i.test(curUrl))return Object.assign({},cur,{url:curUrl,direct:true});
  if(cur&&cur.name){
    const m=(state.fallbackSources||[]).find(x=>String(x.name||'').trim()===String(cur.name||'').trim());
    if(m)return m;
  }
  const remembered=Number(localStorage.getItem(CACHE_PREFIX+'direct_source')||0);
  return (state.fallbackSources||[]).find(x=>Number(x.id)===remembered)||(state.fallbackSources||[])[0]||null;
}
function buildVodUrl(base,params={}){
  const u=new URL(base,location.href);
  Object.keys(params||{}).forEach(k=>{
    const v=params[k];
    if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v));
  });
  return u.href;
}
async function fetchDirectSource(src,params={}){
  if(!src||!src.url)throw new Error('备用 JSON 中没有可用资源站');
  const p=Object.assign({},params);delete p.source;if(!p.ac)p.ac=(p.ids?'detail':'list');
  const url=buildVodUrl(src.url,p);
  const r=await timeoutFetch(url,{method:'GET',cache:'no-store',headers:{'Accept':'application/json,text/plain,*/*'}},12000);
  if(!r.ok)throw new Error('备用资源站请求失败：HTTP '+r.status);
  const text=await r.text();let j;try{j=JSON.parse(text)}catch(e){throw new Error('备用资源站返回的不是 JSON');}
  if(!j||typeof j!=='object')throw new Error('备用资源站数据错误');
  return j;
}
function activateDirectMode(src){
  state.directMode=true;
  if((state.fallbackSources||[]).length){
    state.sources=state.fallbackSources.slice();
    const preferred=src&&state.sources.find(x=>x.url===src.url);
    state.sourceId=Number((preferred||state.sources[0]||{}).id)||0;
  }else if(src){state.sourceId=Number(src.id)||state.sourceId;}
  localStorage.setItem(CACHE_PREFIX+'direct_source',String(state.sourceId||''));
  renderSources();
}
function hasUsefulVodData(j,params={}){
  if(!j||typeof j!=='object')return false;
  if(Number(j.code)>=400)return false;
  const list=listOf(j),classes=classesOf(j);
  if(params.ids||params.ac==='detail')return list.length>0;
  if(params.wd||params.t)return true;
  return list.length>0||classes.length>0;
}
async function directVod(params={},sourceOverride=null){
  const preferred=sourceOverride||directSourceForCurrent();
  const pool=[];
  if(preferred)pool.push(preferred);
  (state.fallbackSources||[]).forEach(x=>{if(!pool.some(y=>sourceApiUrl(y)===sourceApiUrl(x)))pool.push(x);});
  if(!pool.length)throw new Error('备用 JSON 中没有可用资源站');
  let lastErr=null;
  for(const src of pool){
    try{
      const j=await fetchDirectSource(src,params);
      if(!hasUsefulVodData(j,params))throw new Error('资源站没有返回有效数据');
      activateDirectMode(src);
      state.sourceId=Number(src.id)||state.sourceId;
      localStorage.setItem(CACHE_PREFIX+'direct_source',String(state.sourceId||''));
      return j;
    }catch(e){lastErr=e;}
  }
  throw lastErr||new Error('全部备用资源站暂时不可用');
}
function fallbackBootstrap(){
  const fs=(state.fallbackSources||[]).slice();
  if(!fs.length)return null;
  state.directMode=true;
  const siteName=(state.remote&&state.remote.settings&&state.remote.settings.site_name)||(state.remote&&state.remote.site_name)||'影视中心';
  return {ok:true,direct_mode:true,settings:{site_name:siteName},sources:fs};
}
async function loadBootstrap(){
  const cached=cacheGet('boot',60000);if(cached)setBoot(cached);
  try{
    const j=await api('bootstrap');
    if(!j.ok)throw new Error(j.msg||'初始化失败');
    state.directMode=false;setBoot(j);cacheSet('boot',j);return j;
  }catch(e){
    const fb=fallbackBootstrap();
    if(fb){setBoot(fb);toast('后台连接失败，已自动切换备用资源站');return fb;}
    if(cached)return cached;
    throw e;
  }
}
function setBoot(j){
  state.boot=j;state.sources=Array.isArray(j.sources)?j.sources:[];
  if(j.direct_mode)state.directMode=true;
  const rememberKey=state.directMode?'direct_source':'source';
  const remembered=Number(localStorage.getItem(CACHE_PREFIX+rememberKey)||0);state.sourceId=state.sources.some(x=>Number(x.id)===remembered)?remembered:Number(state.sources[0]&&state.sources[0].id||0);
  const name=j.settings&&j.settings.site_name||'影视中心';document.getElementById('siteName').textContent=name;document.title=name;if(j.settings&&j.settings.analytics_code){document.body.insertAdjacentHTML('beforeend',j.settings.analytics_code);}
  state.user=cacheGet('user',0);renderSources();checkSourceHealth(state.sources).then(x=>{state.sources=x;renderSources();});
}


// v4 resource health optimization
async function checkSourceHealth(list){
  const old=cacheGet('source_health',3600000);
  if(old&&Array.isArray(old)&&old.length===(list||[]).length) return old;
  const arr=await Promise.all((list||[]).map(async s=>{
    const t=Date.now();
    try{
      const directUrl=sourceApiUrl(s);
      if(state.directMode||directUrl){
        await fetchDirectSource(Object.assign({},s,{url:directUrl}),{ac:'list',pg:1,pagesize:1});
      }else{
        await timeoutFetch(state.backend+'/api.php?action=bootstrap&source='+encodeURIComponent(s.id||''),{cache:'no-store'},1800);
      }
      return Object.assign({},s,{ok:true,speed:Date.now()-t});
    }catch(e){
      return Object.assign({},s,{ok:false,speed:9999});
    }
  }));
  arr.sort((a,b)=>Number(b.ok)-Number(a.ok)||a.speed-b.speed);
  cacheSet('source_health',arr);
  return arr;
}
function vodCacheKey(p){let raw;try{raw=btoa(unescape(encodeURIComponent(JSON.stringify(p))))}catch(e){raw=JSON.stringify(p)}return 'vod_'+state.sourceId+'_'+raw.replace(/=+$/,'').slice(-80)}
async function vod(params,allowStale=true){
  const key=vodCacheKey(params),fresh=state.cacheEnabled?cacheGet(key,10*60*1000):null;if(fresh)return fresh;
  try{
    let j,lastErr=null;
    if(state.directMode){
      j=await directVod(params);
    }else{
      const sourceOrder=[state.sourceId].concat((state.sources||[]).map(x=>Number(x.id))).filter((x,i,a)=>x&&a.indexOf(x)===i);
      for(const sid of sourceOrder){
        try{
          j=await api('vod',Object.assign({source:sid},params));
          if(!hasUsefulVodData(j,params))throw new Error('资源站没有返回有效数据');
          if(Number(sid)!==Number(state.sourceId)){
            state.sourceId=Number(sid);
            localStorage.setItem(CACHE_PREFIX+'source',String(state.sourceId));
            renderSources();
            toast('当前资源站不可用，已自动切换线路');
          }
          break;
        }catch(e){lastErr=e;j=null;}
      }
      if(!j){
        try{
          toast('后台资源站不可用，正在调用备用资源站');
          j=await api('fallback_vod',params);
          if(!hasUsefulVodData(j,params))throw new Error('备用资源站无有效数据');
        }catch(proxyErr){
          if((state.fallbackSources||[]).length)j=await directVod(params);
          else throw lastErr||proxyErr||new Error('全部资源站暂时不可用');
        }
      }
    }
    if(!hasUsefulVodData(j,params))throw new Error('资源站数据错误');
    if(state.cacheEnabled)cacheSet(key,j);
    return j;
  }catch(e){
    const old=state.cacheEnabled?cacheGet(key,0):null;
    if(allowStale&&old){toast('网络不可用，正在显示缓存内容');return old}
    throw e;
  }
}
function listOf(j){if(Array.isArray(j))return j;return j&&((Array.isArray(j.list)&&j.list)||(j.data&&Array.isArray(j.data.list)&&j.data.list)||(Array.isArray(j.data)&&j.data))||[]}
function classesOf(j){return j&&((Array.isArray(j.class)&&j.class)||(j.data&&Array.isArray(j.data.class)&&j.data.class))||[]}
function totalPages(j){return Number(pick(j,['pagecount','page_count','totalpage'],pick(j&&j.data,['pagecount','page_count','totalpage'],1)))||1}

async function fillImages(list){

    let arr=list||[];

    await Promise.all(
        arr.map(async v=>{

            if(!image(v) && v.vod_id){

                try{

                    let j=await vod({
                        ac:'detail',
                        ids:v.vod_id
                    });

                    let d=listOf(j)[0];

                    if(d){

                        v.vod_pic = d.vod_pic ||
                                    d.vod_pic_thumb ||
                                    d.vod_pic_slide ||
                                    d.vod_pic_url ||
                                    d.pic ||
                                    d.pic_url ||
                                    d.cover ||
                                    '';

                    }

                }catch(e){}

            }

        })
    );

    return arr;
}


async function loadPlayRecommend(){

  const box=document.getElementById('playRecommend');
  if(!box || !state.detail) return;

  const typeId=state.detail.type_id || state.detail.typeId || state.typeId || 0;

  try{

    const j=await vod({
      ac:'list',
      t:typeId,
      pg:1,
      pagesize:9
    });

    let arr=listOf(j).filter(v=>String(v.vod_id)!==String(state.detail.vod_id));

    arr=arr.slice(0,6);
    arr=await fillImages(arr);

    box.innerHTML='<h2>推荐作品</h2><div class="grid">'+cards(arr)+'</div>';

    // 播放页推荐动态生成后重新绑定点击
    bindContent();

    if(!arr.length){
      box.innerHTML='';
    }

  }catch(e){
    box.innerHTML='';
  }

}

function card(v){
  const id=pick(v,['vod_id','id']),name=pick(v,['vod_name','name','title'],'未命名'),note=pick(v,['vod_remarks','remarks','note','vod_year']);
  return '<article class="card" data-play="'+esc(id)+'"><div class="poster"><img loading="lazy" src="'+esc(normalizeUrl(image(v)))+'" alt="'+esc(name)+'" onerror="this.style.opacity=.2;this.dataset.fail=1;">'+(note?'<span class="badge">'+esc(note)+'</span>':'')+'</div><div class="card-name">'+esc(name)+'</div></article>';
}
function cards(list,empty='暂无影片'){return list.length?list.map(card).join(''):'<div class="empty">'+esc(empty)+'</div>'}
function categoriesHtml(active=0){
  const all=[{type_id:0,type_name:'首页'},...state.categories];let shown=all;
  if(matchMedia('(max-width:600px)').matches)shown=all.slice(0,10);
  let s=shown.map(c=>'<button class="cat '+(String(pick(c,['type_id','id']))===String(active)?'active':'')+'" data-type="'+esc(pick(c,['type_id','id']))+'">'+esc(pick(c,['type_name','name'],'分类'))+'</button>').join('');
  if(shown.length<all.length)s+='<button class="cat more" id="moreCats">更多分类</button>';return '<div class="categories">'+s+'</div>';
}
function banner(position){const list=state.boot&&state.boot.ads&&state.boot.ads[position]||[];const a=list[0]||{image_url:DEFAULT_AD,link_url:''};const img='<img class="banner '+(position==='player'?'player-ad':'')+'" src="'+esc(normalizeUrl(a.image_url||DEFAULT_AD))+'" alt="'+esc(a.title||'广告')+'">';return a.link_url?'<a href="'+esc(a.link_url)+'" target="_blank" rel="noopener">'+img+'</a>':img}
function section(title,list,typeId){return '<section class="section"><div class="section-head"><h2>'+esc(title)+'</h2>'+(typeId?'<button class="more-link" data-type="'+esc(typeId)+'">查看更多 ›</button>':'')+'</div><div class="grid">'+cards(list)+'</div></section>'}

async function ensureCategories(seed){
  let cs=classesOf(seed);if(!cs.length&&state.cacheEnabled)cs=cacheGet('classes_'+state.sourceId,0)||[];
  if(!cs.length){try{const j=await vod({ac:'list',pg:1,pagesize:1});cs=classesOf(j)}catch(e){}}
  state.categories=cs;if(state.cacheEnabled)cacheSet('classes_'+state.sourceId,cs);renderAllCategories();
}

// v6 home fast cache optimization
function homeCacheGet(){
  try{
    const x=JSON.parse(localStorage.getItem(CACHE_PREFIX+'home_fast')||'null');
    if(x&&x.data)return x;
  }catch(e){}
  return null;
}
function homeCacheSet(data){
  try{
    localStorage.setItem(CACHE_PREFIX+'home_fast',JSON.stringify({
      time:Date.now(),
      data:data
    }));
  }catch(e){}
}

async function renderHome(){
  state.view='home';state.typeId=0;setNav('home');
  const oldHome=homeCacheGet();
  if(oldHome&&oldHome.data){
    try{
      app.innerHTML=oldHome.data;
      bindContent();
    }catch(e){}
  }else{
    app.innerHTML=categoriesHtml(0)+'<div class="loading">正在加载热门推荐…</div>';
  }
  try{
    const top=await vod({ac:'list',pg:1,pagesize:12});await ensureCategories(top);
    app.innerHTML=categoriesHtml(0)+banner('home')+section('热门推荐',await fillImages(listOf(top)),0)+'<div id="categorySections"></div>';bindContent();
    const target=document.getElementById('categorySections');
    for(const c of state.categories.slice(0,4)){
      const id=pick(c,['type_id','id']),name=pick(c,['type_name','name'],'分类');
      try{const j=await vod({ac:'list',t:id,pg:1,pagesize:6});target.insertAdjacentHTML('beforeend',section(name,await fillImages(listOf(j).slice(0,6)),id))}catch(e){target.insertAdjacentHTML('beforeend',section(name,[],id))}
    }
    bindContent();
    homeCacheSet(app.innerHTML);
  }catch(e){app.innerHTML=categoriesHtml(0)+'<div class="empty">'+esc(e.message||'内容加载失败')+'<br><button class="primary" onclick="location.reload()">重新加载</button></div>';bindContent()}
}
async function renderList(typeId,page=1,keyword=''){
  state.view=keyword?'search':'category';state.typeId=Number(typeId)||0;state.page=page;state.keyword=keyword;setNav('home');
  app.innerHTML=categoriesHtml(state.typeId)+'<div class="loading">正在加载影片…</div>';bindContent();
  const size=matchMedia('(max-width:600px)').matches?9:24;const p={ac:'list',pg:page,pagesize:size};if(typeId)p.t=typeId;if(keyword)p.wd=keyword;
  try{const j=await vod(p);await ensureCategories(j);const found=state.categories.find(c=>String(pick(c,['type_id','id']))===String(typeId))||{};const label=keyword?'搜索：'+keyword:pick(found,['type_name','name'],'全部影片');app.innerHTML=categoriesHtml(state.typeId)+section(label,await fillImages(listOf(j)),0)+pagination(page,totalPages(j));bindContent();scrollTo({top:0,behavior:'smooth'})}catch(e){app.innerHTML=categoriesHtml(state.typeId)+'<div class="empty">'+esc(e.message||'加载失败')+'</div>';bindContent()}
}
function pagination(page,total){if(total<=1)return'';let start=Math.max(1,page-2),end=Math.min(total,start+4);start=Math.max(1,end-4);let h='<div class="pagination">';for(let i=start;i<=end;i++)h+='<button data-page="'+i+'" class="'+(i===page?'active':'')+'">'+i+'</button>';if(page<total)h+='<button data-page="'+(page+1)+'">下一页</button>';return h+'</div>'}
function bindContent(){
  app.querySelectorAll('[data-play]').forEach(x=>x.onclick=()=>{pushRoute('play',{id:x.dataset.play,episode:0});openPlay(x.dataset.play)});
  app.querySelectorAll('[data-type]').forEach(x=>x.onclick=()=>{if(Number(x.dataset.type)){pushRoute('category',{typeId:Number(x.dataset.type),page:1,keyword:''});renderList(x.dataset.type,1,'')}else{pushRoute('home');renderHome()}});
  app.querySelectorAll('[data-page]').forEach(x=>x.onclick=()=>{const pg=Number(x.dataset.page);pushRoute(state.keyword?'search':'category',{typeId:state.typeId,page:pg,keyword:state.keyword});renderList(state.typeId,pg,state.keyword)});
  const more=document.getElementById('moreCats');if(more)more.onclick=()=>modal('categoryModal',true);
}
function renderAllCategories(){document.getElementById('allCategories').innerHTML=[{type_id:0,type_name:'首页'},...state.categories].map(c=>'<button class="cat" data-all-type="'+esc(pick(c,['type_id','id']))+'">'+esc(pick(c,['type_name','name']))+'</button>').join('');document.querySelectorAll('[data-all-type]').forEach(x=>x.onclick=()=>{modal('categoryModal',false);if(Number(x.dataset.allType)){pushRoute('category',{typeId:Number(x.dataset.allType),page:1,keyword:''});renderList(x.dataset.allType)}else{pushRoute('home');renderHome()}})}
function renderSources(){
  const list=(state.sources||[]).slice().sort((a,b)=>{
    if(a.ok===false && b.ok!==false)return 1;
    if(a.ok!==false && b.ok===false)return -1;
    return (a.speed||999999)-(b.speed||999999);
  });
  const box=document.getElementById('sourceList');
  if(!box)return;
  box.innerHTML=list.length?list.map((s,i)=>{
    const bad=s.ok===false;
    const text=bad?'✕ 暂不可用':(s.speed?('✓ '+s.speed+'ms'):(Number(s.id)===state.sourceId?'当前线路':'检测中'));
    return '<button class="source-item '+(Number(s.id)===state.sourceId?'active':'')+'" '+(bad?'data-status="error"':'')+' data-source="'+esc(s.id)+'"><span>'+esc(s.name||('线路'+(i+1)))+'</span><span>'+text+'</span></button>';
  }).join(''):'<div class="empty">后台还没有添加资源站</div>';
  document.querySelectorAll('[data-source]').forEach(x=>x.onclick=()=>{
    state.sourceId=Number(x.dataset.source);
    const chosen=(state.sources||[]).find(s=>Number(s.id)===state.sourceId);
    if(chosen&&sourceApiUrl(chosen))state.directMode=true;
    localStorage.setItem(CACHE_PREFIX+(state.directMode?'direct_source':'source'),state.sourceId);
    state.categories=[];
    renderSources();
    modal('sourceModal',false);
    renderHome();
  });
}


function parseEpisodes(detail){
  const raw=String(pick(detail,['vod_play_url','play_url','url'],''));if(!raw)return[];
  const lines=raw.split('###').map(x=>x.trim()).filter(Boolean);let best=lines.find(x=>/m3u8|mp4/i.test(x))||lines[0]||'';
  return best.split('#').map((x,i)=>{const p=x.split('$');return p.length>1?{name:p.shift()||('第'+(i+1)+'集'),url:p.join('$')}:{name:'第'+(i+1)+'集',url:x}}).filter(x=>/^https?:|^\/\//i.test(x.url));
}
async function openPlay(id,episode=0){
  state.view='play';setNav('home');app.innerHTML='<div class="player-page"><button class="back" id="backHome">‹ 返回</button><div class="loading">正在读取影片…</div></div>';document.getElementById('backHome').onclick=historyBack;
  try{const j=await vod({ac:'detail',ids:id});const d=listOf(j)[0]||(j.data&&j.data[0]);if(!d)throw new Error('没有找到影片详情');state.detail=d;state.episode=episode;renderPlayer(d,episode)}catch(e){app.innerHTML='<div class="empty">'+esc(e.message||'影片加载失败')+'<br><button class="primary" id="backHome">返回首页</button></div>';document.getElementById('backHome').onclick=renderHome}
}
function historyBack(){destroyPlayer();if(history.state&&history.state.videoApp&&history.state.view==='play'&&history.length>1){history.back()}else{renderHome()}}
function renderPlayer(d,ep){
  const eps=parseEpisodes(d),current=eps[ep]||eps[0],name=pick(d,['vod_name','name','title'],'影片');
  app.innerHTML='<div class="player-page"><button class="back" id="backHome">‹ 返回首页</button><h1 class="video-title">'+esc(name)+'</h1><div class="video-wrap"><video id="video" controls playsinline webkit-playsinline x5-video-player-type="h5" preload="auto"></video><button class="custom-fullscreen" id="fullScreenBtn">全屏</button><div class="trial-tip hidden" id="trialTip"></div></div>'+banner('player')+'<div class="episodes">'+eps.map((x,i)=>'<button class="episode '+(i===ep?'active':'')+'" data-episode="'+i+'">'+esc(x.name)+'</button>').join('')+'</div><div class="recommend-box" id="playRecommend"><h2>推荐作品</h2></div><div class="info"><div><b>类型：</b>'+esc(pick(d,['vod_class','type_name'],'未知'))+'</div><div><b>年份：</b>'+esc(pick(d,['vod_year','year'],'未知'))+'</div><div><b>主演：</b>'+esc(pick(d,['vod_actor','actor'],'未知'))+'</div><div><b>简介：</b>'+esc(String(pick(d,['vod_content','vod_blurb','content'],'暂无简介')).replace(/<[^>]*>/g,''))+'</div></div></div>';
  document.getElementById('backHome').onclick=historyBack;document.querySelectorAll('[data-episode]').forEach(x=>x.onclick=()=>{destroyPlayer();renderPlayer(d,Number(x.dataset.episode))});
  if(!current){toast('没有可播放的地址');return}startVideo(normalizeUrl(current.url));loadPlayRecommend();
}

// ===== 智能换源 V10 =====
function smartSourceKey(){
  return CACHE_PREFIX+'smart_source_score';
}
function loadSourceScore(){
  try{return JSON.parse(localStorage.getItem(smartSourceKey())||'{}')}catch(e){return {}}
}
function saveSourceScore(data){
  try{localStorage.setItem(smartSourceKey(),JSON.stringify(data))}catch(e){}
}
async function testPlayLine(url){
  const t=Date.now();
  try{
    await timeoutFetch(url,{method:'HEAD',mode:'no-cors'},3000);
    return Date.now()-t;
  }catch(e){
    return 9999;
  }
}
async function smartPickEpisode(lines){
  if(!lines||!lines.length)return null;
  let score=loadSourceScore();
  let result=[];
  for(const item of lines){
    let old=score[item.url]||{};
    result.push({
      ...item,
      speed:old.speed||9999,
      ok:old.fail?false:true
    });
  }
  let best=result.sort((a,b)=>a.speed-b.speed)[0];

  // 后台检测最快线路
  Promise.all(lines.map(async item=>{
    const speed=await testPlayLine(item.url);
    score[item.url]={
      speed:speed,
      fail:speed>=9000,
      time:Date.now()
    };
    saveSourceScore(score);
  }));

  return best;
}
function smartPlayFailed(url){
  const score=loadSourceScore();
  if(score[url]){
    score[url].fail=true;
    saveSourceScore(score);
  }
}

function startVideo(url){
  const video=document.getElementById('video');state.trialStopped=false;
  const fs=document.getElementById('fullScreenBtn');
  if(fs)fs.onclick=()=>{try{if(video.requestFullscreen)video.requestFullscreen();else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();else if(video.webkitRequestFullscreen)video.webkitRequestFullscreen();}catch(e){}};

  let failed=false;
  video.onerror=function(){
    if(failed)return;
    failed=true;
    smartPlayFailed(url);
    toast('当前线路失败，正在尝试备用线路');
  };

  if(window.Hls&&Hls.isSupported()&&/\.m3u8(?:$|\?)/i.test(url)){
    state.hls=new Hls({enableWorker:true,maxBufferLength:30});
    state.hls.on(Hls.Events.ERROR,function(event,data){
      if(data&&data.fatal){
        smartPlayFailed(url);
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR){
          try{
            state.hls.startLoad();
            toast('网络波动，正在恢复播放');
            return;
          }catch(e){}
        }
        if(data.type===Hls.ErrorTypes.MEDIA_ERROR){
          try{
            state.hls.recoverMediaError();
            toast('正在恢复视频');
            return;
          }catch(e){}
        }
        toast('播放线路异常，请尝试换源');
      }
    });
    state.hls.loadSource(url);
    state.hls.attachMedia(video);
  }else video.src=url;
  video.play().catch(()=>{});
  setupTrial(video);
  setupPlaybackMemory(video);
}
function destroyPlayer(){if(state.hls){state.hls.destroy();state.hls=null}const v=document.getElementById('video');if(v){v.pause();v.removeAttribute('src');v.load()}}
function userVip(){return !!(state.user&&state.user.vip&&state.user.vip_until&&new Date(state.user.vip_until).getTime()>Date.now())}

function setupPlaybackMemory(video){
  try{
    const id=String(state.detail&&pick(state.detail,['vod_id','id'],''));
    const ep=String(new URLSearchParams(location.search).get('ep')||0);
    if(!id)return;
    const key='video_history_'+id+'_'+ep;
    const old=localStorage.getItem(key);
    if(old){
      const t=Number(old);
      if(t>10 && t<video.duration){
        video.addEventListener('loadedmetadata',function(){
          if(video.currentTime<5){
            video.currentTime=t;
            toast('继续播放');
          }
        },{once:true});
      }
    }
    let last=0;
    video.addEventListener('timeupdate',function(){
      if(video.currentTime-last>5){
        localStorage.setItem(key,String(Math.floor(video.currentTime)));
        last=video.currentTime;
      }
    });
    video.addEventListener('ended',function(){
      const next=document.querySelector('[data-episode="'+(Number(ep)+1)+'"]');
      if(next){
        toast('即将播放下一集');
        setTimeout(function(){next.click()},3000);
      }
    });
  }catch(e){}
}

function setupTrial(video){
  const settings=state.boot&&state.boot.settings||{};
  if(settings.charge_mode==='free'||userVip()||(state.detail&&state.detail.is_free))return;

  const min=Math.max(1,Number(settings.trial_minutes||6));
  const limit=min*60;
  const tip=document.getElementById('trialTip');

  if(tip){
    tip.classList.remove('hidden');
    tip.textContent='试看剩余 '+min+' 分钟';
  }

  video.addEventListener('timeupdate',function(){
    if(state.trialStopped)return;

    const left=Math.max(0,limit-video.currentTime);

    if(tip){
      tip.textContent='试看剩余 '+Math.ceil(left/60)+' 分钟';
    }

    if(video.currentTime>=limit){
      state.trialStopped=true;
      video.pause();
      showVipPayBox();
    }
  });
}

async function showVipPayBox(){
  let box=document.getElementById('vipPayBox');

  if(!box){
    box=document.createElement('div');
    box.id='vipPayBox';
    box.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px';
    box.innerHTML='<div style="background:#151515;color:#fff;width:100%;max-width:380px;border-radius:12px;padding:20px"><h3>试看结束</h3><p>开通会员继续观看</p><div id="vipPlans"></div><button id="vipClose" style="margin-top:15px;width:100%;height:40px">关闭</button></div>';
    document.body.appendChild(box);
    document.getElementById('vipClose').onclick=function(){box.remove()};
  }

  const area=document.getElementById('vipPlans');
  if(!area)return;

  area.innerHTML='加载套餐...';

  try{
    const token=localStorage.getItem('token')||'';
    const res=await api('plans',{token:token});
    const plans=res.plans||[];

    area.innerHTML=plans.map(function(p){
      return '<button style="width:100%;margin-top:10px;height:42px" data-plan="'+esc(p.code)+'">'+
      esc(p.name)+' '+esc(p.price)+'元</button>';
    }).join('');

    area.querySelectorAll('[data-plan]').forEach(function(btn){
      btn.onclick=async function(){
        // 未登录：先关闭试看套餐层，再打开登录/注册窗口
        if(!state.user || !state.token){
          const payBox=document.getElementById('vipPayBox');
          if(payBox)payBox.remove();
          renderMember();
          modal('memberModal',true);
          return;
        }

        const r=await api('create_payment',{
          token:state.token,
          plan:btn.dataset.plan,
          pay_type:'alipay',
          return_url:location.href
        });

        if(r&&r.pay_url){
          location.href=r.pay_url;
        }else{
          toast((r&&r.msg)||'创建订单失败');
        }
      };
    });

  }catch(e){
    area.innerHTML='获取套餐失败';
  }
}

function setNav(name){document.querySelectorAll('[data-nav]').forEach(x=>x.classList.toggle('active',x.dataset.nav===name))}
function openLive(){
  const list=state.boot&&state.boot.live||[];if(!list.length){toast('后台暂无直播内容');return}destroyPlayer();setNav('live');
  const box=document.createElement('div');box.className='live-view';box.id='liveView';box.innerHTML='<button class="live-close" id="liveClose">×</button><div class="live-hint">上下滑动切换</div>'+list.map((x,i)=>'<section class="live-item" data-live="'+i+'"><video playsinline webkit-playsinline x5-video-player-type="h5" x5-video-player-fullscreen="false" x5-playsinline loop preload="none" poster="'+esc(normalizeUrl(x.cover||''))+'" data-src="'+esc(normalizeUrl(x.playUrl||x.play_url||''))+'"></video><div class="live-info"><b>'+esc(x.title||'直播')+'</b><div>'+esc(x.tag||'')+'</div></div><div class="live-actions"><button data-sound>声音</button><button data-live-play>暂停</button></div></section>').join('');document.body.appendChild(box);document.getElementById('liveClose').onclick=closeLive;
  const observer=new IntersectionObserver(entries=>entries.forEach(e=>{const v=e.target.querySelector('video');if(e.isIntersecting&&e.intersectionRatio>.65){loadLive(v);v.play().catch(()=>{});}else v.pause()}),{root:box,threshold:[.65]});box.querySelectorAll('.live-item').forEach(x=>observer.observe(x));box._observer=observer;
  box.querySelectorAll('[data-sound]').forEach(b=>b.onclick=()=>{const v=b.closest('.live-item').querySelector('video');v.muted=!v.muted;b.textContent=v.muted?'声音':'静音';v.play().catch(()=>{})});box.querySelectorAll('[data-live-play]').forEach(b=>b.onclick=()=>{const v=b.closest('.live-item').querySelector('video');if(v.paused){v.play().catch(()=>{});b.textContent='暂停'}else{v.pause();b.textContent='播放'}});
  let sy=0;
  box.addEventListener('touchstart',e=>{sy=e.touches[0].clientY},{passive:true});
  box.addEventListener('touchend',e=>{const dy=e.changedTouches[0].clientY-sy;if(Math.abs(dy)>80){const step=dy<0?1:-1;const items=[...box.querySelectorAll('.live-item')];const now=items.findIndex(x=>x.querySelector('video')===document.activeElement);let idx=now>=0?now:items.findIndex(x=>x.getBoundingClientRect().top>=0);const target=Math.max(0,Math.min(items.length-1,idx+step));items[target].scrollIntoView({behavior:'smooth'});}}, {passive:true});
  const first=box.querySelector('video');first.muted=true;loadLive(first);
}
function loadLive(v){if(v.src||v._hls||!v.dataset.src)return;const u=v.dataset.src;if(window.Hls&&Hls.isSupported()&&/\.m3u8(?:$|\?)/i.test(u)){v._hls=new Hls({enableWorker:true,maxBufferLength:15});v._hls.loadSource(u);v._hls.attachMedia(v)}else{v.src=u;v.load()}}
function closeLive(){const box=document.getElementById('liveView');if(!box)return;box._observer&&box._observer.disconnect();box.querySelectorAll('video').forEach(v=>{v.pause();if(v._hls){v._hls.destroy();v._hls=null}v.removeAttribute('src')});box.remove();setNav('home')}

function updateDesktopMemberButton(){
  const btn=document.getElementById('desktopMemberButton');
  if(!btn)return;
  btn.textContent=state.user?'会员中心':'登录/注册';
}

function renderMember(){
  updateDesktopMemberButton();
  const root=document.getElementById('memberContent');
  if(state.user){
    const vip=userVip()?'会员到期：'+esc(state.user.vip_until):'当前为普通用户',plans=state.boot&&state.boot.plans||[];
    root.innerHTML='<div class="dialog-head"><h2>会员中心</h2><button class="close" data-close="memberModal">×</button></div><div><b>'+esc(state.user.username)+'</b><p style="color:#aaa">'+vip+'</p></div><div id="memberMsg" class="msg"></div>'+plans.map(p=>'<form class="plan pay-form"><input type="hidden" name="plan" value="'+esc(p.code)+'"><div class="plan-row"><b>'+esc(p.name)+'</b><span class="price">¥'+esc(p.price)+'</span></div><div class="form"><select name="pay_type"><option value="alipay">支付宝</option><option value="wxpay">微信支付</option></select><button class="primary">立即充值</button></div></form>').join('')+'<button class="logout" id="logout">退出登录</button>';
    root.querySelectorAll('.pay-form').forEach(f=>f.onsubmit=pay);document.getElementById('logout').onclick=logout;
  }else{
    root.innerHTML='<div class="dialog-head"><h2>登录 / 注册</h2><button class="close" data-close="memberModal">×</button></div><div id="memberMsg" class="msg"></div><div class="member-tabs"><button class="active" data-member-tab="login">登录</button><button data-member-tab="register">注册</button></div><form class="form" id="memberForm"><input name="username" placeholder="账号（至少3位）" required><input type="password" name="password" placeholder="密码（至少6位）" required><button class="primary">登录</button></form>';
  }
  bindModalClosers();root.querySelectorAll('[data-member-tab]').forEach(b=>b.onclick=()=>{root.querySelectorAll('[data-member-tab]').forEach(x=>x.classList.toggle('active',x===b));root.dataset.mode=b.dataset.memberTab;root.querySelector('#memberForm button').textContent=b.dataset.memberTab==='login'?'登录':'注册'});const f=document.getElementById('memberForm');if(f)f.onsubmit=auth;
}
async function auth(e){e.preventDefault();const root=document.getElementById('memberContent'),mode=root.dataset.mode||'login',btn=e.target.querySelector('button'),data=Object.fromEntries(new FormData(e.target));btn.disabled=true;btn.textContent='请稍候…';try{const j=await api(mode,data);if(!j.ok)throw new Error(j.msg||'操作失败');state.token=j.token;state.user=j.user;localStorage.setItem(CACHE_PREFIX+'token',state.token);cacheSet('user',state.user);renderMember();toast(mode==='login'?'登录成功':'注册成功')}catch(x){document.getElementById('memberMsg').textContent=x.message}finally{if(btn.isConnected)btn.disabled=false}}
async function pay(e){e.preventDefault();const msg=document.getElementById('memberMsg'),data=Object.fromEntries(new FormData(e.target));data.token=state.token;data.return_url=location.href.split('#')[0];data.notify_url=state.backend+'/api.php?action=payment_notify';try{msg.textContent='正在创建支付订单…';const j=await api('create_payment',data);if(!j.ok||!j.pay_url)throw new Error(j.msg||'支付创建失败');location.href=j.pay_url}catch(x){msg.textContent=x.message}}
function logout(){state.token='';state.user=null;localStorage.removeItem(CACHE_PREFIX+'token');localStorage.removeItem(CACHE_PREFIX+'user');renderMember();toast('已退出登录')}
async function refreshMember(){if(!state.token)return;const saved=state.user;if(saved&&saved.vip_until&&new Date(saved.vip_until).getTime()>Date.now())return;const last=Number(localStorage.getItem(CACHE_PREFIX+'me_time')||0);if(saved&&Date.now()-last<6*3600e3)return;try{const j=await api('me',{token:state.token});if(j.ok){state.user=j.user;cacheSet('user',j.user);localStorage.setItem(CACHE_PREFIX+'me_time',Date.now())}else logout()}catch(e){}}

function bindModalClosers(){document.querySelectorAll('[data-close]').forEach(x=>x.onclick=()=>modal(x.dataset.close,false))}
function bindGlobal(){
  document.getElementById('sourceButton').onclick=()=>modal('sourceModal',true);
  const desktopMemberButton=document.getElementById('desktopMemberButton');
  if(desktopMemberButton)desktopMemberButton.onclick=()=>{renderMember();modal('memberModal',true)};
  document.getElementById('searchForm').onsubmit=e=>{e.preventDefault();const q=document.getElementById('searchInput').value.trim();if(q){pushRoute('search',{typeId:0,page:1,keyword:q});renderList(0,1,q)}};
  document.querySelectorAll('[data-nav]').forEach(x=>x.onclick=()=>{
    if(x.dataset.nav==='home'){closeLive();pushRoute('home');renderHome()}
    if(x.dataset.nav==='live'){pushRoute('live');openLive()}
    if(x.dataset.nav==='member'){renderMember();modal('memberModal',true)}
    if(x.dataset.nav==='app'){
      const u=state.boot&&state.boot.settings&&state.boot.settings.app_download_url||'';
      if(u){window.location.href=normalizeUrl(u)}else toast('后台暂未设置APP下载链接');
    }
  });
  document.getElementById('openMemberFromPaywall').onclick=()=>{modal('paywallModal',false);renderMember();modal('memberModal',true)};bindModalClosers();
  addEventListener('popstate',e=>{
    const r=e.state;
    if(!r||!r.videoApp)return;
    handlingPopState=true;
    destroyPlayer();
    closeLive();
    modal('sourceModal',false);modal('categoryModal',false);modal('memberModal',false);modal('paywallModal',false);
    if(r.view==='play'&&r.id)openPlay(r.id,Number(r.episode)||0);
    else if(r.view==='category'||r.view==='search')renderList(Number(r.typeId)||0,Number(r.page)||1,r.keyword||'');
    else if(r.view==='live')openLive();
    else renderHome();
    setTimeout(()=>{handlingPopState=false},0);
  });document.addEventListener('contextmenu',e=>e.preventDefault());document.addEventListener('keydown',e=>{if(e.key==='F12'||(e.ctrlKey&&'usijc'.includes(e.key.toLowerCase())))e.preventDefault()});
}

async function start(){
  bindGlobal();replaceRoute('home');state.backend=localStorage.getItem(CACHE_PREFIX+'backend')||'';
  try{await remoteConfig();await loadBootstrap();await refreshMember();updateDesktopMemberButton();if(!state.categories.length)await ensureCategories(null);renderHome();const s=state.boot.settings||{};if(String(s.announcement_enabled)==='1'&&s.announcement)setTimeout(()=>toast(s.announcement),600)}catch(e){const cached=cacheGet('boot',0);if(cached){setBoot(cached);renderHome();toast('后台暂时无法连接，使用本地缓存')}else app.innerHTML='<div class="empty">'+esc(e.message||'初始化失败')+'<br><button class="primary" onclick="location.reload()">重新加载</button></div>'}
}
start();
})();