import { CheckCircle, Clock, Info, ListChecks, Sparkle, TextT, Warning } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { inspectContent } from './contentInspection'

/**
 * 内容质检卡片：对已生成的文字做本地规则分析（字数/段落/阅读时长/AI 腔/结构），
 * 生成完成后在结果区展示。纯本地计算，不调用模型、不上传内容。
 */
export function ContentInspectionPanel({ content }: { content: string }) {
  const report = useMemo(() => inspectContent(content), [content])

  if (report.charCount === 0) return null

  const scoreTone = report.score >= 80 ? 'good' : report.score >= 60 ? 'ok' : 'weak'

  return (
    <section className="pa-inspection" aria-label="内容质检">
      <div className="pa-inspection__head">
        <span className="pa-inspection__title"><ListChecks aria-hidden="true" size={16} />内容质检</span>
        <span className="pa-inspection__score" data-tone={scoreTone} title="综合评分，仅供参考">
          {report.score}<small>/100</small>
        </span>
      </div>

      <div className="pa-inspection__metrics">
        <div className="pa-inspection__metric"><TextT aria-hidden="true" size={15} /><span>{report.charCount}<small>字</small></span></div>
        <div className="pa-inspection__metric"><Clock aria-hidden="true" size={15} /><span>{report.readingMinutes}<small>分钟</small></span></div>
        <div className="pa-inspection__metric"><Sparkle aria-hidden="true" size={15} /><span>{report.paragraphCount}<small>段</small></span></div>
      </div>

      {report.suggestions.length > 0 && (
        <ul className="pa-inspection__list">
          {report.suggestions.map((suggestion, index) => (
            <li key={index} className="pa-inspection__item">
              {suggestion.includes('AI 腔') || suggestion.includes('套话') || suggestion.includes('偏长') || suggestion.includes('偏短')
                ? <Warning aria-hidden="true" size={15} weight="fill" />
                : suggestion.includes('小标题') || suggestion.includes('emoji')
                  ? <Info aria-hidden="true" size={15} />
                  : <CheckCircle aria-hidden="true" size={15} />}
              <span>{suggestion}</span>
            </li>
          ))}
        </ul>
      )}

      {report.suggestions.length === 0 && (
        <div className="pa-inspection__clean"><CheckCircle aria-hidden="true" size={15} weight="fill" /><span>内容结构良好，未发现明显问题</span></div>
      )}
    </section>
  )
}
