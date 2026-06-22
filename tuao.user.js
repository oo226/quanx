// ==UserScript==
// @name         手写模拟器-全自动网络拦截完整多页版
// @version      7.0
// @description  常驻右下角，底层网络拦截 Fetch 响应，完美支持单页/多页 ZIP 以及图片直导，无需长按与激活码
// @author       YourFriend
// @match        *://www.autohanding.com/*
// @match        *://autohanding.com/*
// @run-at       document-start
// @grant        none
// @require      https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

(function() {
    'use strict';

    let caughtZipBlob = null; 

    // --- [1. 网络层 Fetch 拦截器] ---
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || "");
        
        if (url.includes('convert-cp-text-quark') || url.includes('deducted')) {
            return new Response(JSON.stringify({ code: 1, msg: "激活成功", data: true }), {
                status: 200, headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const response = await originalFetch.apply(this, args);
        
        if ((url.includes('/api/v1/handwrite-preview/convert') || url.includes('convert-text')) && response.ok) {
            try {
                const cloneResp = response.clone();
                const contentType = cloneResp.headers.get('Content-Type') || '';
                
                if (contentType.includes('octet-stream') || contentType.includes('zip')) {
                    const blob = await cloneResp.blob();
                    if (blob.size > 50000) {
                        caughtZipBlob = blob; 
                        updatePanel(true, blob.size);
                    }
                }
            } catch (err) {
                console.error("拦截数据失败:", err);
            }
        }
        return response;
    };

    // --- [2. UI 层：右下角多按钮面板] ---
    const panel = document.createElement('div');
    panel.id = 'fixed-action-panel';
    
    // 面板样式
    Object.assign(panel.style, {
        position: 'fixed', right: '15px', bottom: '100px', zIndex: '2147483647',
        display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px',
        background: '#ffffff', borderRadius: '8px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
        fontFamily: 'system-ui, sans-serif', fontSize: '13px'
    });

    const info = document.createElement('div');
    info.style.color = '#666';
    info.style.fontWeight = 'bold';
    info.textContent = '等待多页生成中...';
    panel.appendChild(info);

    // 创建按钮的通用函数
    function createBtn(text, color, onClick) {
        const b = document.createElement('button');
        b.textContent = text;
        Object.assign(b.style, {
            padding: '8px 14px', background: color, color: '#fff',
            border: 'none', borderRadius: '6px', cursor: 'not-allowed',
            fontWeight: 'bold', opacity: '0.4', transition: 'all 0.3s'
        });
        b.disabled = true;
        b.onclick = onClick;
        return b;
    }

    // 按钮 1：直接下载多张图片
    const btnImg = createBtn('直接导出图片', '#4e6ef2', saveImages);
    // 按钮 2：下载原始压缩包
    const btnZip = createBtn('下载原始 ZIP', '#6c757d', saveZip);

    panel.appendChild(btnImg);
    panel.appendChild(btnZip);
    document.body.appendChild(panel);

    function updatePanel(active, size) {
        info.textContent = active ? `已捕获文件: ${(size/1024).toFixed(0)}KB` : '等待多页生成中...';
        [btnImg, btnZip].forEach(b => {
            b.disabled = !active;
            b.style.opacity = active ? '1' : '0.4';
            b.style.cursor = active ? 'pointer' : 'not-allowed';
        });
    }

    // --- [3. 功能实现核心] ---
    
    // 功能 A：直接解压并保存所有图片
    async function saveImages() {
        if (!caughtZipBlob) return;
        info.textContent = '正在解压图片...';
        try {
            const zip = await JSZip.loadAsync(caughtZipBlob);
            // 过滤出压缩包里的图片文件
            const imageEntries = Object.values(zip.files).filter(entry => /\.(jpe?g|png|gif|webp)$/i.test(entry.name));
            
            for (let i = 0; i < imageEntries.length; i++) {
                const entry = imageEntries[i];
                const blob = await entry.async('blob');
                const url = URL.createObjectURL(blob);
                
                const link = document.createElement('a');
                link.href = url;
                // 保持原文件名或按页码排序命名
                link.download = `手写提取_${Date.now()}_页${i + 1}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                // 延迟 250 毫秒释放，防止手机浏览器并发下载时漏掉文件
                await new Promise(resolve => setTimeout(resolve, 250));
                URL.revokeObjectURL(url);
            }
            info.textContent = `成功导出 ${imageEntries.length} 张图！`;
            setTimeout(() => updatePanel(true, caughtZipBlob.size), 3000);
        } catch (e) {
            info.textContent = '解压失败，请尝试下载ZIP';
            setTimeout(() => updatePanel(true, caughtZipBlob.size), 3000);
        }
    }

    // 功能 B：直接导出原始 ZIP
    function saveZip() {
        if (!caughtZipBlob) return;
        const zipUrl = URL.createObjectURL(caughtZipBlob);
        const link = document.createElement('a');
        link.href = zipUrl;
        link.download = `手写模拟器_多页完整包_${Date.now()}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(zipUrl), 500);
    }

    // --- [4. 自动填码] ---
    setInterval(() => {
        const input = document.querySelector('input[placeholder*="激活码"], input[type="text"]');
        if (input && input.value.replace(/-/g, '').length !== 25) {
            input.value = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE";
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (window.ki) window.ki.value = true;
    }, 1000);

})();
