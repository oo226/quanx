// PingMe 自动签到（免填写版）for Surge
// 第一次开启模块后，在 App 里手点一次签到用于“捕获URL/UA”，随后按 cron 自动执行。
// 如服务端把 sign 与日期强绑定，旧签名会失效；脚本会尝试仅更新 signDate 重试一次，仍失败就需要真实签名算法。

const KEY_URL = 'pingme.checkin.url';
const KEY_UA  = 'pingme.checkin.ua';

function nowStr() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function patchSignDate(u) {
  const enc = encodeURIComponent(nowStr());
  if (u.includes('signDate=')) return u.replace(/signDate=[^&]*/i, 'signDate=' + enc);
  return u + (u.includes('?') ? '&' : '?') + 'signDate=' + enc;
}
function notify(t, s, b){ try{$notification.post(t, s||'', b||'');}catch(_){} }
function get(url, ua, cb){
  const headers = {
    'Accept':'application/json','Accept-Language':'zh-Hans;q=1.0, en;q=0.9',
    'Accept-Encoding':'gzip, deflate, br','Connection':'keep-alive',
    'User-Agent': ua || 'PingMe/1.9.2 (tel.pingme; build:22; iOS) Alamofire/5',
    'Host':'api.pingmeapp.net',
  };
  $httpClient.get({url, headers, timeout:30}, cb);
}
function parseBody(body, status){
  let msg = `HTTP ${status}`;
  try{
    const data = typeof body === 'object' ? body : JSON.parse(body);
    if (data?.retcode === 0){
      const r = data.result || {};
      const hint = r.bonusHint || '签到成功';
      const bonus = r.bonus!=null ? `+${r.bonus}` : '';
      const bal   = r.aftercredit!=null ? `余额 ${r.aftercredit}` : '';
      const times = r.checkintimes!=null ? `次数 ${r.checkintimes}` : '';
      msg = [hint, bonus, bal, times].filter(Boolean).join(' | ');
      notify('PingMe 签到成功','',msg);
      return {ok:true,msg};
    } else {
      msg = `retcode=${data?.retcode} ${data?.retmsg||''}`;
      return {ok:false,msg};
    }
  }catch{
    return {ok:false,msg:(body||'').toString().slice(0,200)};
  }
}

// A) 捕获并保存（http-request 阶段）
if (typeof $request !== 'undefined'){
  const url = $request.url || '';
  const ua  = ($request.headers?.['User-Agent'] || $request.headers?.['user-agent'] || '').toString();
  if (/^https?:\/\/api\.pingmeapp\.net\/app\/checkIn\?/i.test(url)){
    $persistentStore.write(url, KEY_URL);
    if (ua) $persistentStore.write(ua, KEY_UA);
    notify('已捕获 PingMe 签到请求','已保存 URL/UA','后续将按计划自动签到');
  }
  return $done({});
}

// B) 定时签到
const savedUrl = $persistentStore.read(KEY_URL) || '';
const savedUa  = $persistentStore.read(KEY_UA)  || '';
if (!savedUrl){
  notify('PingMe 自动签到','未捕获到签到URL','请先在 App 里手动点一次签到');
  return $done();
}
// 先用原URL请求
get(savedUrl, savedUa, (e1, r1, b1)=>{
  if (e1){ notify('PingMe 签到失败','网络错误', String(e1)); return $done(); }
  const p1 = parseBody(b1, r1?.status||'');
  if (p1.ok) return $done();
  // 失败则仅更新 signDate 再试一次
  const patched = patchSignDate(savedUrl);
  if (patched === savedUrl){ notify('PingMe 签到失败','无法更新 signDate', p1.msg); return $done(); }
  get(patched, savedUa, (e2, r2, b2)=>{
    if (e2){ notify('PingMe 签到失败(重试)','网络错误', String(e2)); return $done(); }
    const p2 = parseBody(b2, r2?.status||'');
    if (p2.ok) return $done();
    notify('PingMe 签到失败','签名可能过期/校验失败', p2.msg + ' | 需要签名算法方可自动生成 sign');
    return $done();
  });
});