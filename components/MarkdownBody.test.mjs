import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { normalizeDisplayMath, educationDocumentBody, markdownPreviewRemarkPlugins, markdownPreviewRehypePlugins } = await jiti.import("../lib/markdown.ts");

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
    }, markdown),
  );
}

function renderMarkdownPreview(markdown) {
  return renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: markdownPreviewRemarkPlugins,
    rehypePlugins: markdownPreviewRehypePlugins,
  }, normalizeDisplayMath(educationDocumentBody(markdown))));
}

for (const [surface, render] of [["chat", renderMarkdown], ["file preview", renderMarkdownPreview]]) {
  test(`KaTeX renders fractions, roots and matrices through the actual ${surface} plugins`, () => {
    const html = render(String.raw`比值 \(\frac{1}{2}\)。

$$\sqrt{x}$$

\[\begin{pmatrix}1&2\\3&4\end{pmatrix}\]`);
    assert.match(html, /<mfrac>/);
    assert.match(html, /<msqrt>/);
    assert.match(html, /<mtable[^>]*>/);
    assert.equal((html.match(/xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/g) || []).length, 3);
    assert.match(html, /class="katex-display"/);
    assert.doesNotMatch(html, /katex-error/);
  });

  test(`KaTeX keeps HTML and trusted math commands blocked in ${surface}`, () => {
    const html = render(String.raw`<script>synthetic()</script><iframe src="https://synthetic.example.invalid/"></iframe><img src="javascript:alert(1)" onerror="synthetic()">

$\href{javascript:alert(1)}{synthetic}$

$\includegraphics{https://synthetic.example.invalid/unapproved.png}$

$\sqrt{4}$`);
    assert.doesNotMatch(html, /<script\b|<iframe\b|\bonerror=|href="javascript:|src="https:\/\/synthetic\.example\.invalid/);
    assert.match(html, /<msqrt>/);
  });
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("renders LaTeX parenthesis delimiters as inline math", () => {
  const html = renderMarkdown(String.raw`射线为 \(r_c = K^{-1}p\)。`);

  assert.match(html, /class="katex"/);
  assert.match(html, /r_c/);
});

test("renders paired LaTeX bracket delimiters as display math", () => {
  const html = renderMarkdown(String.raw`\[
P(\lambda)=o_b+\lambda r_b
\]`);
  const oneLineHtml = renderMarkdown(String.raw`\[P(\lambda)=o_b+\lambda r_b\]`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /lambda/);
  assert.match(oneLineHtml, /class="katex-display"/);
});

test("leaves an unmatched LaTeX bracket delimiter unchanged", () => {
  const markdown = String.raw`before
\[
x + y
after`;

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside Markdown code", () => {
  const markdown = "    \\(indented\\)\n\n`code\n\\(inline\\)`\n\n```text\n\\[\nfenced\n\\]\n```";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside raw HTML code", () => {
  const markdown = "<code>\\(inline\\)</code>\n\n<pre>\n\\(block\\)\n</pre>";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize escaped delimiters or link destinations", () => {
  const escaped = String.raw`Literal: \\(x+y\\).`;
  const link = String.raw`[docs](https://example.com/\(manual\))`;

  assert.equal(normalizeDisplayMath(escaped), escaped);
  assert.equal(normalizeDisplayMath(link), link);
});
