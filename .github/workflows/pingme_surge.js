// pingme_cap.js —— 单脚本：请求捕获 + 响应嗅探
const K = {
  UA: 'pingme.ua',
  CK_URL: 'pingme.checkin.url',
  AD_URL: 'pingme.ad.url',
};
const w = (k,v)=>$persistentStore.write(v,k);
const n = (t,s,b)=>$notification.post(t,s,b||'');
const brief = s => (s||'').length>160 ? s.slice(0,160)+'…' : (s||'');

if (typeof $request !== 'undefined') {
  // —— 请求阶段：命中就保存/通知（无需解密）
  const url = $request.url || '';
  const ua  = ( $request.headers?.['User-Agent'] || $request.headers?.['user-agent'] || '' ) + '';
  if (ua) w(K.UA, ua);
  n('命中请求 (PingMe)', url, brief(ua));
  if (/\/app\/checkIn\?/i.test(url))  { w(K.CK_URL, url); n('✅ 已捕获【签到】请求', '', url); }
  if (/\/app\/videoBonus\?/i.test(url)){ w(K.AD_URL, url);  n('✅ 已捕获【视频奖励】请求', '', url); }
  $done({});
} else if (typeof $response !== 'undefined') {
  // —— 响应阶段：JSON 里出现 bonusHint/bonus 等也保存/通知（需要 MITM）
  try {
    const url = $request.url || '';
    const ct  = (''+($response.headers?.['Content-Type']||$response.headers?.['content-type']||'')).toLowerCase();
    const body= typeof $response.body==='string' ? $response.body : '';
    if (ct.includes('application/json') || /^\s*[\{\[]/.test(body)) {
      const d = JSON.parse(body); const r = d?.result || {};
      const hint = (r.bonusHint||'')+'';
      const ok = d?.retcode===0 && (hint.includes('广告')||hint.includes('观看')||r.bonus!=null||r.aftercredit!=null||r.allbonus!=null);
      if (ok) {
        const kind = /checkIn/i.test(url) ? '签到' : '视频奖励';
        const key  = /checkIn/i.test(url) ? K.CK_URL : K.AD_URL;
        w(key, url);
        n(`✅ 嗅探到${kind}响应`, '', hint || brief(JSON.stringify(r)));
      }
    }
  } catch(e) {}
  $done({});
} else {
  n('PingMe 捕获脚本', '运行环境异常','既不是请求也不是响应');
  $done({});
}