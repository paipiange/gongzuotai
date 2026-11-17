/**
 * 视频原型 · HTML 动画模板生成器
 *
 * 借鉴 dsh-video-workbench 的 HTML5/Canvas 引擎思路：一段「主题文案」被编译成
 * 一个自包含的 HTML 动画页面，页面暴露 `window.__seekToFrame(frame)` 让渲染器
 * 逐帧定位，同时用 `requestAnimationFrame` 驱动时间轴。
 *
 * 与参考实现的关键契约一致：
 *  - 页面声明 `window.__totalFrames`（总帧数），渲染器据此循环截图。
 *  - 页面实现 `window.__seekToFrame(n)`，把动画定位到第 n 帧（用于精确逐帧渲染）。
 *  - 动画完全确定性（不用 Math.random），保证每帧可复现。
 */

export interface VideoSpec {
  /** 视频主题标题（大字） */
  title: string
  /** 副标题 / 一句话说明 */
  subtitle: string
  /** 结尾落款 */
  footer: string
  /** 时长（秒） */
  durationSec: number
  /** 帧率 */
  fps: number
  /** 画布宽 */
  width: number
  /** 画布高 */
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
 * 生成一段确定性动画 HTML。全片分三幕：
 *   0) 淡入标题
 *   1) 副标题滑入
 *   2) 落款淡入并收尾
 * 时间轴统一用 `t = frame / fps`（秒）表达，逐帧可复现。
 */
export function generateHtmlTemplate(spec: VideoSpec): GeneratedTemplate {
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
  /* 背景柔光斑，纯 CSS 渐变，确定性 */
  .glow {
    position: absolute;
    border-radius: 50%;
    filter: blur(60px);
    opacity: 0.5;
  }
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

      // 三幕时间点（秒），整片总长 durationSec
      var dur = ${durationSec};
      var tTitleStart = 0.0;
      var tTitleEnd = 0.9;
      var tSubStart = dur * 0.30;
      var tSubEnd = dur * 0.55;
      var tFootStart = dur * 0.68;
      var tFootEnd = dur * 0.90;

      function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
      function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

      function setStyle(el, o, ty) {
        if (!el) return;
        el.style.opacity = String(o);
        el.style.transform = 'translateY(' + ty + 'px)';
      }

      function renderAt(t) {
        // 标题淡入
        var oTitle = clamp01((t - tTitleStart) / (tTitleEnd - tTitleStart));
        setStyle(title, oTitle, (1 - oTitle) * 24);

        // 分割线：标题后展开
        var dStart = tTitleEnd + 0.1;
        var dEnd = dStart + 0.5;
        var oDiv = clamp01((t - dStart) / (dEnd - dStart));
        if (divider) {
          divider.style.opacity = String(oDiv);
          divider.style.transform = 'scaleX(' + (0.2 + 0.8 * easeOutCubic(oDiv)) + ')';
        }

        // 副标题滑入
        var oSub = clamp01((t - tSubStart) / (tSubEnd - tSubStart));
        setStyle(subtitle, oSub, (1 - oSub) * 18);

        // 落款淡入
        var oFoot = clamp01((t - tFootStart) / (tFootEnd - tFootStart));
        setStyle(footer, oFoot, (1 - oFoot) * 10);
      }

      // 渲染器逐帧契约：把画面定位到第 n 帧
      window.__seekToFrame = function (n) {
        renderAt(n / fps);
      };
      window.__totalFrames = total;

      // 独立浏览器里播放时走 rAF 动画（渲染时由 __seekToFrame 精确驱动）
      var t0 = null;
      function loop(ts) {
        if (t0 === null) t0 = ts;
        var t = (ts - t0) / 1000;
        if (t >= dur) t = dur;
        renderAt(t);
        if (t < dur) requestAnimationFrame(loop);
      }
      // 初始定位到第 0 帧，避免首屏闪烁
      renderAt(0);
      // 默认不自动播放，避免无头截图时 rAF 与 seek 抢时间轴；
      // 仅当页面被真实打开（有用户手势）时才启动，这里保持静止由 seek 驱动。
    })();
  </script>
</body>
</html>`

  return { html, totalFrames, width, height, fps }
}
