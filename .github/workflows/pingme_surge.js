// PingMe for Surge — capture + sniff + cron + on-demand DIRECT (ads) + wide-match + debug
// by oo226

/* =================== 存储键 =================== */
const K = {
  UA: 'pingme.ua',
  CK_URL: 'pingme.checkin.url', CK_MTD: 'pingme.checkin.method', CK_BDY: 'pingme.checkin.body',
  AD_URL: 'pingme.ad.url',      AD_MTD: 'pingme.ad.method',      AD_BDY: 'pingme.ad.body',
  FLAG_TS: 'pingme.flag.ts',    // 最近一次“正在使用 PingMe”的时间戳
};

/* =================== 工具 =================== */
const R = k => $persistentStore.read(k) || '';
const W = (k,v) => $persistentStore.write(String(v ?? ''), k);
const N = (t,s='',b='') => { try{$notification.post(t,s,b);}catch{} };
const brief = s => (s||'').length>220 ? (s||'').slice(0,220)+'…' : (s||'');
const nowStr = () => { const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const patchSignDate = url =>
  /[?&]signDate=/.test(url)
    ? url.replace(/([?&])signDate=[^&]*/i,(_,p)=>`${p}signDate=${encodeURIComponent(nowStr())}`)
    : url;
const J = s => { try{return JSON.parse(s)}catch{return null} };

/* =================== 参数 / 模式 =================== */
const ARG  = (()=>{ try{ return Object.fromEntries(new URLSearchParams($argument||'')); }catch{ return {}; } })();
const MODE = (ARG.mode||'').toLowerCase();
const DBG  = (ARG.dbg||'0')==='1';

/* ========== D) 按需直连广告域（仅窗口期内） ========== */
if (typeof $request!=='undefined' && MODE==='ads'){
  const winSec = Number(ARG.win||'180');             // 默认 180 秒，可用 &win=N 调整
  const ts = Number(R(K.FLAG_TS)||0);
  const ok = ts && (Date.now()-ts) < winSec*1000;
  if (DBG) N('PingMe Ads On-Demand', ok?'DIRECT（窗口内）':'不干预（窗口外）', $request.url||'');
  $done(ok ? { policy: 'DIRECT' } : {});
  return;
}

/* ========== E) 标记“正在使用 PingMe” ========== */
if (typeof $request!=='undefined' && MODE==='flag'){
  W(K.FLAG_TS, Date.now());
  if (DBG) N('PingMe Flag', '已刷新使用标记', $request.url||'');
  $done({});
  return;
}

/* ========== A) 捕获（请求阶段） ========== */
// 放宽匹配：/app/… 或 URL 中含 check|video|bonus|ad|reward|credit
if (typeof $request!=='undefined' && MODE==='capture'){
  const url = $request.url || '';
  const mtd = ($request.method||'GET').toUpperCase();
  const ua  = ($request.headers?.['User-Agent']||$request.headers?.['user-agent']||'')+'';
  if (ua) W(K.UA, ua);

  const isCheck = /\/app\/checkIn\b/i.test(url) || /[?&]check/i.test(url);
  const isVideo = /\/app\/videoBonus\b/i.test(url) || /bonus|ad|reward|credit/i.test(url);

  if (isCheck){
    W(K.CK_URL,url); W(K.CK_MTD,mtd); if(mtd!=='GET' && $request.body) W(K.CK_BDY,$request.body);
    N('✅ 已捕获【签到】请求','',url);
  } else if (isVideo){
    W(K.AD_URL,url); W(K.AD_MTD,mtd); if(mtd!=='GET' && $request.body) W(K.AD_BDY,$request.body);
    N('✅ 已捕获【视频奖励】请求','',url);
  } else if (/\/app\//i.test(url) || DBG){
    N('命中请求 (PingMe)', '', brief(url));
  }
  $done({});
  return;
}

/* ========== B) 嗅探（响应阶段，需要 MITM） ========== */
if (typeof $response!=='undefined' && MODE==='sniff'){
  try{
    const url=$request.url||'';
    const ct  = (''+($response.headers?.['Content-Type']||$response.headers?.['content-type']||'')).toLowerCase();
    const body= typeof $response.body==='string' ? $response.body : '';
    const isJ = ct.includes('application/json') || /^\s*[\{\[]/.test(body);
    if (isJ){
      const d=J(body)||{}; const r=d.result||{}; const hint=(r.bonusHint||'')+'';
      const looks = d.retcode===0 && (hint.includes('广告')||hint.includes('观看')||r.bonus!=null||r.aftercredit!=null||r.totalbonus!=null||r.allbonus!=null||r.checkintimes!=null);
      if (looks){
        const isCk = /check/i.test(url) || /checkin/i.test(url);
        W(isCk?K.CK_URL:K.AD_URL, url);
        N(`✅ 嗅探到${isCk?'签到':'视频奖励'}响应`, '', hint || brief(JSON.stringify(r)));
      } else if (DBG){
        N('Sniff JSON', '未识别为奖励/签到', brief(body));
      }
    } else if (DBG){
      N('Sniff 非 JSON', '', ct);
    }
  }catch(e){ if(DBG) N('Sniff 异常', '', String(e)); }
  $done({});
  return;
}

/* ========== C) 定时/手动执行 ========== */
if (typeof $request==='undefined' && typeof $response==='undefined'){
  const ua = R(K.UA);

  function runOne(which, done){
    const isCk = which==='checkin';
    const url  = R(isCk?K.CK_URL:K.AD_URL);
    const mtd  = (R(isCk?K.CK_MTD:K.AD_MTD)||'GET').toUpperCase();
    const bdy  = R(isCk?K.CK_BDY:K.AD_BDY)||'';

    if (!url){ N('PingMe 任务未捕获', isCk?'缺少“签到”URL':'缺少“视频奖励”URL', '请先在 App 各操作一次'); done&&done(new Error('no-url')); return; }

    // 先按原样请求
    http(mtd,url,ua,bdy,(e1,r1,d1)=>{
      let ok=false,msg=''; if(!e1){ const p1=J(d1)||{}; ok=p1.retcode===0; msg=p1.retmsg||p1.msg||''; }
      if(ok){ 
        N(`PingMe ${isCk?'签到':'视频奖励'}`,'成功',msg);
        if(!isCk){ W(K.FLAG_TS, Date.now()); } // 广告成功也刷新一次“使用标记”
        done&&done(null); return; 
      }
      // 改 signDate 再试（GET）
      const patched = patchSignDate(url);
      http('GET',patched,ua,'',(e2,r2,d2)=>{
        const p2=J(d2)||{}; const ok2=p2.retcode===0; const m2=p2.retmsg||p2.msg||'';
        N(`PingMe ${isCk?'签到':'视频奖励'}`, ok2?'成功(改signDate)':'失败', ok2?m2:(e1?String(e1):msg||''));
        if(ok2 && !isCk){ W(K.FLAG_TS, Date.now()); }
        done&&done(ok2?null:new Error('fail'));
      });
    });
  }

  if (MODE==='checkin'){ runOne('checkin', ()=> $done()); }
  else if (MODE==='ad'){ runOne('ad', ()=> $done()); }
  else if (MODE==='debug'){  // 诊断模式：打印当前存档
    const dump = `UA: ${brief(R(K.UA))}\n签到URL: ${brief(R(K.CK_URL))}\n广告URL: ${brief(R(K.AD_URL))}`;
    N('PingMe 存档', '当前保存的 UA/URL （节选）', dump); $done();
  }
  else { runOne('checkin', ()=> runOne('ad', ()=> $done())); }
}