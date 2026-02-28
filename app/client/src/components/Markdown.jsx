import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark-dimmed.min.css";
import { Copy, CopyCheck } from "lucide-react";

function CodeBlock({ className, children }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace(/^(language-|hljs )*/g, "").split(" ")[0] || "";
  const code = String(children).replace(/\n$/, "");

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code]);

  return (
    <div className="group/code relative my-2 rounded-lg border border-white/[0.06] bg-black/40 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.03] border-b border-white/[0.06]">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 select-none">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
          title="Copy code"
        >
          {copied ? (
            <><CopyCheck className="h-3 w-3" /> Copied</>
          ) : (
            <><Copy className="h-3 w-3 opacity-0 group-hover/code:opacity-100 transition-opacity" /> <span className="opacity-0 group-hover/code:opacity-100 transition-opacity">Copy</span></>
          )}
        </button>
      </div>
      {/* Code content */}
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export default function Markdown({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children }) {
          // Block code: <pre><code>...</code></pre> in markdown AST
          // Extract the inner <code> element's props and render as CodeBlock
          const codeChild = Array.isArray(children) ? children[0] : children;
          const codeProps = codeChild?.props || {};
          return (
            <CodeBlock className={codeProps.className}>
              {codeProps.children}
            </CodeBlock>
          );
        },
        code({ children }) {
          // Inline code only — block code is handled by the pre component above
          // Simple monospace styling without code block chrome
          return (
            <code className="rounded-[4px] bg-white/[0.08] px-1.5 py-0.5 text-[13px] font-mono text-primary/90 border border-white/[0.06]">
              {children}
            </code>
          );
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80 underline decoration-primary/30 underline-offset-2 hover:decoration-primary/60 transition-colors"
            >
              {children}
            </a>
          );
        },
        table({ children }) {
          return (
            <div className="my-3 overflow-x-auto rounded-lg border border-white/[0.06]">
              <table className="min-w-full text-[13px]">{children}</table>
            </div>
          );
        },
        thead({ children }) {
          return <thead className="bg-white/[0.04]">{children}</thead>;
        },
        th({ children }) {
          return (
            <th className="border-b border-white/[0.06] px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="border-b border-white/[0.04] px-3 py-2 text-foreground/90">
              {children}
            </td>
          );
        },
        tr({ children }) {
          return (
            <tr className="hover:bg-white/[0.02] transition-colors">
              {children}
            </tr>
          );
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground italic">
              {children}
            </blockquote>
          );
        },
        hr() {
          return <hr className="my-4 border-white/[0.08]" />;
        },
        img({ src, alt }) {
          return (
            <img
              src={src}
              alt={alt || ""}
              className="my-2 max-w-full rounded-lg border border-white/[0.06]"
            />
          );
        },
      }}
      className={[
        "prose-sm prose-invert max-w-none leading-relaxed",
        // Remove top/bottom margins from first/last children
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        // Paragraphs
        "[&_p]:my-2 [&_p]:leading-relaxed",
        // Headings
        "[&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-foreground [&_h1]:border-b [&_h1]:border-white/[0.06] [&_h1]:pb-1.5",
        "[&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-foreground",
        "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-foreground/90",
        "[&_h4]:text-sm [&_h4]:font-medium [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-foreground/80",
        // Lists
        "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-0.5",
        "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-0.5",
        "[&_li]:text-foreground/90 [&_li]:leading-relaxed",
        "[&_li_p]:my-0.5",
        // Nested lists
        "[&_ul_ul]:my-0.5 [&_ol_ol]:my-0.5 [&_ul_ol]:my-0.5 [&_ol_ul]:my-0.5",
        // Strong / emphasis
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_em]:text-foreground/80",
      ].join(" ")}
    >
      {children}
    </ReactMarkdown>
  );
}
