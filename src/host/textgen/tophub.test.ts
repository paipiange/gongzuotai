import { describe, expect, it } from 'vitest'
import { listTophubNodes, parseItems } from './tophub'

describe('tophub listTophubNodes', () => {
  it('returns the builtin node list with name, board and link', () => {
    const nodes = listTophubNodes()
    expect(nodes.length).toBeGreaterThan(50)
    // 前几个是主流平台
    const names = nodes.map((n) => n.name)
    expect(names).toContain('微博')
    expect(names).toContain('知乎')
    expect(names).toContain('微信')
    expect(names).toContain('抖音')
    expect(names).toContain('哔哩哔哩')
  })

  it('builds the detail link from the node id', () => {
    const weibo = listTophubNodes().find((n) => n.name === '微博' && n.board === '热搜榜')
    expect(weibo).toBeDefined()
    expect(weibo!.id).toBe('KqndgxeLl9')
    expect(weibo!.link).toBe('https://tophub.today/n/KqndgxeLl9')
  })
})

describe('tophub parseItems', () => {
  it('parses rank, title, heat and link from table rows', () => {
    const html = `
      <table class="table">
        <tbody>
          <tr>
            <td align="center">1.</td>
            <td><a href="https://s.weibo.com/weibo?q=%E6%B5%8B%E8%AF%95" target="_blank" rel="nofollow" itemid="123">测试标题</a></td>
            <td class="ws">188万</td>
            <td align="right"><a href="x" title="查看详细"><i class="m-n">&#xe652;</i></a></td>
          </tr>
          <tr>
            <td align="center">2.</td>
            <td><a href="https://s.weibo.com/weibo?q=abc" target="_blank" rel="nofollow" itemid="124">第二 &amp; 条目</a></td>
            <td class="ws">177万</td>
            <td align="right"><a href="x" title="查看详细"><i class="m-n">&#xe652;</i></a></td>
          </tr>
        </tbody>
      </table>
    `
    const items = parseItems(html, 'KqndgxeLl9')
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      id: 'KqndgxeLl9-1',
      title: '测试标题',
      rank: 1,
      heat: '188万',
      link: 'https://s.weibo.com/weibo?q=%E6%B5%8B%E8%AF%95',
      node: 'KqndgxeLl9',
    })
    expect(items[1].rank).toBe(2)
    expect(items[1].title).toBe('第二 & 条目')
  })

  it('decodes numeric html entities in titles', () => {
    const html = `
      <tr>
        <td align="center">1.</td>
        <td><a href="https://x" target="_blank" rel="nofollow" itemid="1">&#x4E2D;&#x6587;</a></td>
        <td class="ws">1.2亿</td>
      </tr>
    `
    const items = parseItems(html, 'node')
    expect(items[0].title).toBe('中文')
    expect(items[0].heat).toBe('1.2亿')
  })

  it('returns empty array when no rows match', () => {
    expect(parseItems('<div>no table</div>', 'node')).toHaveLength(0)
  })
})
