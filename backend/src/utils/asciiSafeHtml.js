/**
 * asciiSafeHtml — rewrite an HTML email body so it contains only ASCII characters.
 *
 * Why: the AWS email relay builds the MIME message itself, and some mail apps (seen on a
 * phone client) ignore the <meta charset="UTF-8"> inside the HTML and read the body as
 * Western (Windows-1252). A raw "₹" then shows as "â‚¹", "€" as "â‚¬", "–" as "â€“".
 * Written as character references instead ("&#8377;"), the body is plain ASCII, so every
 * mail app shows the right character whatever encoding it assumes.
 *
 *   asciiSafeHtml('<p>from ₹7,000 – 🌴</p>')  →  '<p>from &#8377;7,000 &#8211; &#127796;</p>'
 *
 * Character references are not decoded inside <style> or <script>, so those blocks get the
 * escape form their own language understands (CSS "\20B9 ", JS "\u{20B9}").
 * Pure ASCII input is returned unchanged.
 */

const NON_ASCII = /[^\x00-\x7F]/gu;          // `u`: an emoji is one code point, not two halves
const RAW_TEXT_BLOCK = /<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const htmlRef = (ch) => `&#${ch.codePointAt(0)};`;
const cssEscape = (ch) => `\\${ch.codePointAt(0).toString(16).toUpperCase()} `;
const jsEscape = (ch) => `\\u{${ch.codePointAt(0).toString(16).toUpperCase()}}`;

export function asciiSafeHtml(html) {
  if (typeof html !== 'string' || !/[^\x00-\x7F]/.test(html)) return html;
  let out = '';
  let last = 0;
  for (const m of html.matchAll(RAW_TEXT_BLOCK)) {
    out += html.slice(last, m.index).replace(NON_ASCII, htmlRef);
    out += m[0].replace(NON_ASCII, m[1].toLowerCase() === 'style' ? cssEscape : jsEscape);
    last = m.index + m[0].length;
  }
  return out + html.slice(last).replace(NON_ASCII, htmlRef);
}

export default asciiSafeHtml;
