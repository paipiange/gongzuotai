import { describe, expect, it } from 'vitest'
import { parseItems, parseNodes } from './tophub'

describe('tophub parseNodes', () => {
  it('parses node blocks with name, board and id', () => {
    const html = `
      <div class="cc-cd" id="node-1">
        <div class="cc-cd-ih">
          <div class="cc-cd-is">
            <a href="/n/KqndgxeLl9">
              <div class="cc-cd-lb"><img src="x.png"><span>微博</span></div>
            </a>
          </div>
          <div class="cc-cd-sb">
            <div class="cc-cd-sb-ss"><span class="cc-cd-sb-st">热搜榜</span></div>
          </div>
        </div>
      </div>
      <div class="cc-cd" id="node-6">
        <div class="cc-cd-ih">
          <div class="cc-cd-is">
            <a href="/n/mproPpoq6O">
              <div class="cc-cd-lb"><img src="x.png"><span>知乎</span></div>
            </a>
          </div>
          <div class="cc-cd-sb">
            <div class="cc-cd-sb-ss"><span class="cc-cd-sb-st">热榜</span></div>
          </div>
        </div>
      </div>
    `
    const nodes = parseNodes(html)
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toEqual({
      id: 'KqndgxeLl9',
      name: '微博',
      board: '热搜榜',
      link: 'https://tophub.today/n/KqndgxeLl9',
    })
    expect(nodes[1].id).toBe('mproPpoq6O')
    expect(nodes[1].name).toBe('知乎')
  })

  it('deduplicates nodes with the same hash id', () => {
    const block = (id: string) => `
      <div class="cc-cd" id="node-1">
        <div class="cc-cd-is"><a href="/n/${id}"><div class="cc-cd-lb"><span>微博</span></div></a></div>
      </div>
    `
    const html = block('KqndgxeLl9') + block('KqndgxeLl9')
    expect(parseNodes(html)).toHaveLength(1)
  })

  it('skips blocks without a valid link or name', () => {
    const html = `<div class="cc-cd" id="node-1"><div>无链接</div></div>`
    expect(parseNodes(html)).toHaveLength(0)
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
