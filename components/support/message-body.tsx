import { Fragment, type ReactNode } from 'react'

// How a Derek answer is shown in the student chat: readable paragraphs, a few Markdown-style touches (**bold**, bullet and
// numbered lists, [descriptive links](https://…)) and clean links in place of long raw addresses. Built from React nodes only,
// so nothing the model writes can inject markup; only http(s) links are made clickable. Student and team messages stay plain.

const LINK = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"”’])|\*\*([^*\n]+)\*\*/g
const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/

/** "https://www.massey.ac.nz/study/…/master-of-information-sciences-PMINS/" → "massey.ac.nz: Master of information sciences". */
export function friendlyLink(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const last = u.pathname.split('/').filter(Boolean).at(-1) ?? ''
    const words = decodeURIComponent(last)
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[-_]+[A-Z]{2,}\d*[A-Z0-9]*$/, '') // a trailing programme code (…-PMINS)
      .replace(/[-_]+/g, ' ')
      .trim()
    const suffix = /regulations/i.test(u.pathname) && !/regulation/i.test(words) ? ' regulations' : ''
    return words && /[a-z]{3}/i.test(words) ? `${host}: ${words.charAt(0).toUpperCase()}${words.slice(1)}${suffix}` : host
  } catch {
    return 'official page'
  }
}

function link(href: string, label: string, key: string): ReactNode {
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-4 hover:text-foreground">
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

/** One line of text with its bold parts and links. */
export function inline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const key = `${keyPrefix}${n++}`
    if (m[2]) out.push(link(m[2], m[1], key))
    else if (m[3]) out.push(link(m[3], friendlyLink(m[3]), key))
    else
      out.push(
        <strong key={key} className="font-semibold">
          {m[4]}
        </strong>,
      )
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] }

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  // A blank line starts a new paragraph; inside a chunk, consecutive lines of one kind stay together.
  for (const chunk of text.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/)) {
    let current: Block | null = null
    for (const raw of chunk.split('\n')) {
      if (!raw.trim()) continue
      const bullet = raw.match(BULLET)
      const numbered = raw.match(NUMBERED)
      const kind = bullet ? 'ul' : numbered ? 'ol' : 'p'
      const content = bullet ? bullet[1] : numbered ? numbered[1] : raw.trim()
      if (current && current.kind === kind) {
        if (current.kind === 'p') current.lines.push(content)
        else current.items.push(content)
      } else {
        current = kind === 'p' ? { kind, lines: [content] } : { kind, items: [content] }
        blocks.push(current)
      }
    }
  }
  return blocks
}

export function MessageBody({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-relaxed break-words text-foreground">
      {blocks.map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {inline(l, `p${i}.${j}.`)}
              </Fragment>
            ))}
          </p>
        ) : b.kind === 'ul' ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `u${i}.${j}.`)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `o${i}.${j}.`)}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  )
}
