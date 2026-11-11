import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('AI replies render readable Markdown without executing model content', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await mkdir(root + '/.runtime-tmp', { recursive: true });
  const tmp = await mkdtemp(root + '/.runtime-tmp/ai-message-');
  try {
    const outfile = tmp + '/component.mjs';
    await build({ entryPoints: [root + '/src/ai-message.tsx'], outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic' });
    const { AiMessage } = await import(pathToFileURL(outfile).href);
    const render = content => renderToStaticMarkup(React.createElement(AiMessage, { content }));
    await t.test('Headings, emphasis, ordered lists and line breaks are readable', () => {
      const html = render('## 车队概况\n\n**平均分** 85 分\n下一步建议\n\n1. 核查风险\n2. 安排培训');
      assert.match(html, /<h4>车队概况<\/h4>/);
      assert.match(html, /<strong>平均分<\/strong>/);
      assert.match(html, /<br\/>/);
      assert.match(html, /<ol>[\s\S]*<li>核查风险<\/li>/);
      assert(!html.includes('##') && !html.includes('**'));
    });
    await t.test('GFM tables, task lists and nested lists retain structure', () => {
      const html = render('| 等级 | 数量 |\n| --- | --- |\n| D | 50 |\n\n- [x] 已核查\n- 待处理\n  - 联系司机');
      assert.match(html, /class="ai-table-scroll"/);
      assert.match(html, /<th>等级<\/th>/);
      assert.match(html, /<td>50<\/td>/);
      assert.match(html, /type="checkbox"/);
      assert.match(html, /<li>联系司机<\/li>/);
    });
    await t.test('Code and meaningful symbols survive without global stripping', () => {
      const html = render('保留 C#、2 * 3、车辆1。\n\n```js\nconst pattern = "#*";\n```');
      assert.match(html, /C#、2 \* 3、车辆1/);
      assert.match(html, /<pre><code class="language-js">/);
      assert.match(html, /#\*/);
    });
    await t.test('Raw HTML, dangerous links and images cannot execute or load', () => {
      const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险链接](javascript:alert%281%29)\n\n![图片说明](https://example.com/tracker.png)');
      assert(!/<script|<img|onerror=|href="javascript:/i.test(html));
      assert.match(html, /<span>危险链接<\/span>/);
      assert.match(html, /图片说明/);
      assert(!html.includes('tracker.png'));
    });
    await t.test('Valid source links open safely and plain text still displays', () => {
      assert.match(render('[来源](https://example.com/report)'), /href="https:\/\/example.com\/report" target="_blank" rel="noopener noreferrer"/);
      assert.match(render('车辆1当前需要重点关注。'), /<p>车辆1当前需要重点关注。<\/p>/);
    });
  } finally {
    // mkdtemp creates this checked child directory inside the repository only.
    assert(tmp.startsWith(root + '/.runtime-tmp/ai-message-'));
    await rm(tmp, { recursive: true, force: true });
  }
});
