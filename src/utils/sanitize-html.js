import DOMPurify from 'isomorphic-dompurify';

// allowed tags + attrs ตรงกับ Tiptap output (StarterKit + Link extension)
//   + ฝั่ง frontend ก็ sanitize ซ้ำตอน render (defense-in-depth)
//   keep config sync กับ frontend/components/RichTextContent.tsx
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    's',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'blockquote',
    'a',
    'span',
  ],
  ALLOWED_ATTR: ['href', 'rel', 'class', 'target'],
  ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:|tel:|#)/i,
};

// sanitize HTML จาก rich text editor — กัน XSS ถึงแม้ user จะเลี่ยง frontend แล้ว POST raw HTML
//   - คืน string ว่างถ้า input เป็น null/undefined/empty
//   - keep แต่ tags ใน PURIFY_CONFIG; strip <script>, <iframe>, on*=, javascript: URLs ฯลฯ
export function sanitizeRichText(html) {
  if (!html || typeof html !== 'string') return '';
  const trimmed = html.trim();
  if (!trimmed) return '';
  return DOMPurify.sanitize(trimmed, PURIFY_CONFIG);
}
