'use strict';

/**
 * The head, the chat widget and the bare page shell used by the client
 * services desk. Rendered at build time (scripts/build-pages.js) into static
 * HTML, so there is no layout flash.
 *
 * The public pages and the signed-in application have their own shells in
 * src/bank/site/layout.js.
 */

function head({ title, description, noindex = false, styles = [] }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />${noindex ? '\n  <meta name="robots" content="noindex, nofollow" />' : ''}
  <meta name="theme-color" content="#0d3b35" />
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" href="/favicon.png" type="image/png" sizes="512x512" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="stylesheet" href="/css/fonts.css" />
  <link rel="stylesheet" href="/css/styles.css" />
  <link rel="stylesheet" href="/css/bank.css" />
  ${styles.map((href) => `<link rel="stylesheet" href="${href}" />`).join('\n  ')}
</head>`;
}

function chatWidget() {
  return `
  <div class="chat" id="chat" aria-live="polite">
    <button class="chat-toggle" id="chat-toggle" aria-label="Open live chat" aria-expanded="false">
      <svg class="i-open" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/></svg>
      <svg class="i-close" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <div class="chat-panel" id="chat-panel" hidden>
      <div class="chat-head">
        <div class="chat-head-id">
          <span class="dot"></span>
          <div>
            <strong>Hedgestone Finance support</strong>
            <small>Typically replies in a few minutes</small>
          </div>
        </div>
        <button class="chat-min" id="chat-min" aria-label="Minimise chat">&minus;</button>
      </div>
      <div class="chat-log" id="chat-log"></div>
      <form class="chat-form" id="chat-form">
        <input type="text" id="chat-input" name="text" placeholder="Ask us about investing in Bitcoin" autocomplete="off" maxlength="2000" />
        <button type="submit" aria-label="Send message">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </form>
    </div>
  </div>`;
}

/**
 * Script tags. An entry may be a path, or `{ src, type }` when it needs to
 * load as a module (the admin dashboard imports the Supabase client).
 */
function scripts(list) {
  const tags = list
    .map((s) => (typeof s === 'string' ? { src: s } : s))
    .map(({ src, type }) => `<script${type ? ` type="${type}"` : ''} src="${src}"></script>`)
    .join('\n  ');
  return `  ${tags}\n</body>\n</html>`;
}

/**
 * Compose a bare page: the shell styling with none of the site furniture -
 * no nav, no footer and no chat widget. The client services desk is the one
 * page built this way, since a member of staff answering the chat should not
 * also be offered it. Every public page uses marketingPage() in
 * src/bank/site/layout.js instead.
 *
 * @param {{title,description,bodyClass,content,extraScripts,noindex,styles}} opts
 */
function page(opts) {
  const { bodyClass = '', content = '', extraScripts = [] } = opts;
  return [head(opts), `<body class="${bodyClass}">`, content, scripts(['/js/bankname.js', ...extraScripts])].join('\n');
}

module.exports = { page, chatWidget, head };
