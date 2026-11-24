import React from 'react'

const WHATSAPP_TOKEN_REGEX =
  /```([\s\S]+?)```|`([^`\n]+?)`|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'\]])|(?:^|(?<=[^\wÀ-ÿ*]))\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?=[^\wÀ-ÿ*]|$)|(?:^|(?<=[^\wÀ-ÿ]))_([^\s_](?:[^_\n]*?[^\s_])?)_(?=[^\wÀ-ÿ]|$)|(?:^|(?<=[^\wÀ-ÿ~]))~([^\s~](?:[^~\n]*?[^\s~])?)~(?=[^\wÀ-ÿ~]|$)/g

/**
 * Formatea el texto de un mensaje de WhatsApp a nodos React:
 * *negrita*, _cursiva_, ~tachado~, `código`, ```bloque``` y enlaces http(s).
 */
export function formatWhatsAppMessageText(
  text: string | undefined | null,
  depth = 0
): React.ReactNode {
  if (!text) return null
  if (depth > 4) return text

  const nodes: React.ReactNode[] = []
  const regex = new RegExp(WHATSAPP_TOKEN_REGEX.source, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null
  let keyIdx = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const [, codeBlock, inlineCode, url, bold, italic, strike] = match

    if (codeBlock !== undefined) {
      nodes.push(
        <code
          key={`cb-${depth}-${keyIdx++}`}
          className="font-mono text-[11px] bg-black/5 px-1.5 py-0.5 rounded inline-block"
        >
          {codeBlock}
        </code>
      )
    } else if (inlineCode !== undefined) {
      nodes.push(
        <code
          key={`ic-${depth}-${keyIdx++}`}
          className="font-mono text-[11px] bg-black/5 px-1 py-0.5 rounded"
        >
          {inlineCode}
        </code>
      )
    } else if (url !== undefined) {
      nodes.push(
        <a
          key={`url-${depth}-${keyIdx++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-sky-700 underline break-all hover:text-sky-800"
        >
          {url}
        </a>
      )
    } else if (bold !== undefined) {
      nodes.push(
        <strong key={`b-${depth}-${keyIdx++}`} className="font-bold">
          {formatWhatsAppMessageText(bold, depth + 1)}
        </strong>
      )
    } else if (italic !== undefined) {
      nodes.push(
        <em key={`i-${depth}-${keyIdx++}`} className="italic">
          {formatWhatsAppMessageText(italic, depth + 1)}
        </em>
      )
    } else if (strike !== undefined) {
      nodes.push(
        <del key={`s-${depth}-${keyIdx++}`} className="line-through">
          {formatWhatsAppMessageText(strike, depth + 1)}
        </del>
      )
    }

    lastIndex = regex.lastIndex
  }

  if (lastIndex === 0) return text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}
