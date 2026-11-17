/**
 * 视频生成 · 内置兜底动画模板
 *
 * 当 LLM 生成 HTML 失败或质检不通过时，降级使用这段确定性动画，保证用户始终能出片。
 * 页面暴露 `window.__seekToFrame(n)` / `window.__totalFrames` 供渲染器逐帧驱动，
 * 完全确定性（无 Math.random），保证逐帧可复现。
 */

export interface FallbackVideoSpec {
  title: string
  subtitle: string
  footer: string
  durationSec: number
  fps: number
  width: number
  height: number
}

export interface GeneratedTemplate {
  html: string
  totalFrames: number
  width: number
  height: number
  fps: number
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 生成一段确定性动画 HTML。全片分三幕：淡入标题 → 副标题滑入 → 落款淡入收尾。
 */
export function generateFallbackHtml(spec: FallbackVideoSpec): GeneratedTemplate {
  const { title, subtitle, footer, durationSec, fps, width, height } = spec
  const totalFrames = Math.max(1, Math.round(durationSec * fps))

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${width}" />
<style>
  :root {
    --bg0: #1d140e;
    --bg1: #291a13;
    --gold: #e5b77e;
    --gold-light: #f2cc95;
    --text: #f4e9db;
    --muted: #b89c85;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: linear-gradient(160deg, var(--bg0), var(--bg1));
    color: var(--text);
    font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  .glow { position: absolute; border-radius: 50%; filter: blur(60px); opacity: 0.5; }
  .glow-a { width: 46%; height: 46%; top: -8%; left: -6%; background: radial-gradient(circle, rgba(229,183,126,0.55), transparent 70%); }
  .glow-b { width: 40%; height: 40%; bottom: -10%; right: -5%; background: radial-gradient(circle, rgba(244,233,219,0.35), transparent 70%); }
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 48px;
  }
  .frame-line {
    position: absolute;
    inset: 26px;
    border: 1px solid rgba(229,183,126,0.35);
    border-radius: 20px;
    pointer-events: none;
  }
  .title {
    font-size: 64px;
    line-height: 1.25;
    letter-spacing: 0.06em;
    font-weight: 700;
    color: var(--gold-light);
    opacity: 0;
    transform: translateY(24px);
  }
  .subtitle {
    margin-top: 28px;
    font-size: 30px;
    line-height: 1.5;
    color: var(--muted);
    opacity: 0;
    transform: translateY(18px);
  }
  .footer {
    margin-top: 56px;
    font-size: 22px;
    letter-spacing: 0.28em;
    color: var(--gold);
    opacity: 0;
  }
  .divider {
    width: 120px;
    height: 2px;
    margin: 0 auto 26px;
    background: linear-gradient(90deg, transparent, var(--gold), transparent);
    opacity: 0;
    transform: scaleX(0.2);
  }
</style>
</head>
<body>
  <div class="glow glow-a"></div>
  <div class="glow glow-b"></div>
  <div class="stage">
    <div class="frame-line"></div>
    <div class="title" id="title">${escapeHtml(title)}</div>
    <div class="divider" id="divider"></div>
    <div class="subtitle" id="subtitle">${escapeHtml(subtitle)}</div>
    <div class="footer" id="footer">${escapeHtml(footer)}</div>
  </div>
  <script>
    (function () {
      var fps = ${fps};
      var total = ${totalFrames};
      var title = document.getElementById('title');
      var divider = document.getElementById('divider');
      var subtitle = document.getElementById('subtitle');
      var footer = document.getElementById('footer');
      var dur = ${durationSec};
      var tTitleStart = 0.0;
      var tTitleEnd = 0.9;
      var tSubStart = dur * 0.30;
      var tSubEnd = dur * 0.55;
      var tFootStart = dur * 0.68;
      var tFootEnd = dur * 0.90;

      function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
      function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
      function setStyle(el, o, ty) { if (!el) return; el.style.opacity = String(o); el.style.transform = 'translateY(' + ty + 'px)'; }

      function renderAt(t) {
        var oTitle = clamp01((t - tTitleStart) / (tTitleEnd - tTitleStart));
        setStyle(title, oTitle, (1 - oTitle) * 24);
        var dStart = tTitleEnd + 0.1;
        var dEnd = dStart + 0.5;
        var oDiv = clamp01((t - dStart) / (dEnd - dStart));
        if (divider) { divider.style.opacity = String(oDiv); divider.style.transform = 'scaleX(' + (0.2 + 0.8 * easeOutCubic(oDiv)) + ')'; }
        var oSub = clamp01((t - tSubStart) / (tSubEnd - tSubStart));
        setStyle(subtitle, oSub, (1 - oSub) * 18);
        var oFoot = clamp01((t - tFootStart) / (tFootEnd - tFootStart));
        setStyle(footer, oFoot, (1 - oFoot) * 10);
      }

      window.__seekToFrame = function (n) { renderAt(n / fps); };
      window.__totalFrames = total;
      renderAt(0);
    })();
  </script>
</body>
</html>`

  return { html, totalFrames, width, height, fps }
}
