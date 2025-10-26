// PingMe - 仅签到
// by oo226 + chatgpt

const isReq = typeof $request !== 'undefined';
const isResp = typeof $response !== 'undefined';

const Arg = (() => {
  const s = (typeof $argument === 'string' && $argument) ? $argument : '';
  const o = {}; s.split('&').forEach(p => { const [k, v] = p.split('='); if (k) o[k] = v ?? true; });
  return o;
})();

const K = {
  UA:       'pingme.ua',
  CK_URL:   'pingme.checkin.url',
  CK_MTD:   'pingme.checkin.method',
  CK_BDY:   'pingme.checkin.body'
};

const read  = k => $persistentStore.read(k) || '';
const write = (k,v) => { $persistentStore.write(String(v||''), k); };
const notify = (t, s = '', m = '') => { $notification.post(t, s, m); };

function parseJSON(s) { try { return JSON.parse(s); } catch { return null; } }

function req(method, opts, cb){
  const o = { url: opts.url, headers: opts.headers || {}, body: opts.body };
  if (method === 'POST') { $httpClient.post(o, cb); } else { $httpClient.get(o, cb); }
}

function doCapture() {
  const u = $request.url || '';
  if (/\/app\/checkIn\b/.test(u)) {
    const h = $request.headers || {};
    write(K.CK_URL, u);
    write(K.UA, h['User-Agent'] || h['user-agent'] || '');
    write(K.CK_MTD, $request.method || 'GET');
    write(K.CK_BDY, $request.body || '');
    notify('PingMe 已捕获“签到”URL', '', '后续将按计划自动签到');
  }
  $done({});
}

function doSniff() {
  const h = $response.headers || {};
  const ct = h['Content-Type'] || h['content-type'] || '';
  if (ct.includes('application/json')) {
    const j = parseJSON($response.body || '');
    if (j && (j.retcode === 0 || j.result)) {
      const r = j.result || {};
      const msg = r.bonusHint || (r.bonus ? `+${r.bonus}，余额≈${r.aftercredit}` : '');
      notify('PingMe 嗅探到签到返回', 'retcode=' + (j.retcode ?? ''), msg);
    }
  }
  $done({});
}

function doCheckin() {
  const url = read(K.CK_URL);
  let   ua  = read(K.UA);
  const mtd = (read(K.CK_MTD) || 'GET').toUpperCase();
  const bdy = read(K.CK_BDY) || '';

  if (!url) { notify('PingMe 签到', '缺少“签到”URL', '请先在 App 里手点一次“签到”'); return $done(); }
  if (!ua)   ua = 'PingMe/1.9.2 (tel.pingme; iOS)';

  const headers = { 'User-Agent': ua, 'Accept': 'application/json' };
  req(mtd, { url, headers, body: (mtd === 'POST' ? bdy : undefined) }, (e, r, d) => {
    if (e) { notify('PingMe 签到', '网络错误', String(e)); return $done(); }
    const j = parseJSON(d || '');
    if (!j) { notify('PingMe 签到', '解析失败', 'HTTP ' + (r?.status || '')); return $done(); }
    const ok = j.retcode === 0 || j.result;
    const rsl = j.result || {};
    const msg = rsl.bonusHint || (rsl.bonus ? `+${rsl.bonus}，余额≈${rsl.aftercredit}` : '') || ('HTTP ' + (r?.status || ''));
    notify('PingMe 签到', ok ? '成功' : '失败', msg);
    $done();
  });
}

// 路由
const mode = Arg.mode || (isReq ? 'capture' : (isResp ? 'sniff' : 'checkin'));
if (mode === 'capture' && isReq)        doCapture();
else if (mode === 'sniff' && isResp)    doSniff();
else if (mode === 'checkin' && !isReq && !isResp) doCheckin();
else $done({});