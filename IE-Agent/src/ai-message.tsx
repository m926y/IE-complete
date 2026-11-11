import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { Components } from 'react-markdown';

// Replies are untrusted text: render Markdown without enabling raw HTML.
const components: Components = {
  h1: ({ children }) => <h4>{children}</h4>,
  h2: ({ children }) => <h4>{children}</h4>,
  h3: ({ children }) => <h4>{children}</h4>,
  h4: ({ children }) => <h4>{children}</h4>,
  h5: ({ children }) => <h4>{children}</h4>,
  h6: ({ children }) => <h4>{children}</h4>,
  a: ({ href, children }) => href
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <span>{children}</span>,
  // Model-generated image URLs should not silently load third-party resources.
  img: ({ alt }) => <span>{alt || '图片'}</span>,
  table: ({ children }) => <div className="ai-table-scroll" role="region" aria-label="回复表格" tabIndex={0}><table>{children}</table></div>,
};

export function AiMessage({ content }: { content: string }) {
  return <div className="ai-message"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components} skipHtml>{content}</Markdown></div>;
}
