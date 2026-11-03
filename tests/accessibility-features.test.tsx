import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { FaqEntry } from '@/lib/content/faq'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

const { FAQ_ENTRIES } = await import('@/lib/content/faq')
const { searchFaq } = await import('@/lib/faq-search')
const { shortcutFor } = await import('@/lib/shortcuts')
const { TEXT_SIZE_BOOT } = await import('@/lib/text-size')
const faqPage = await import('@/app/faq/page')
const { FaqSearch } = await import('@/components/faq/faq-search')
const { TextSizeControl } = await import('@/components/site/text-size-control')
const { KeyboardShortcuts } = await import('@/components/site/keyboard-shortcuts')

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, isComposing: false, ...mods })
const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget

describe('keyboard shortcuts', () => {
  it('maps / to search and ? to help on the page itself and on buttons', () => {
    expect(shortcutFor(key('/'), el('BODY'))).toBe('search')
    expect(shortcutFor(key('?'), el('A'))).toBe('help')
    expect(shortcutFor(key('/'), el('INPUT', { type: 'checkbox' }))).toBe('search')
    expect(shortcutFor(key('a'), el('BODY'))).toBeNull()
  })

  it('never fires while typing, with a modifier held, mid-composition or when already handled', () => {
    for (const target of [el('INPUT', { type: 'text' }), el('INPUT', { type: 'search' }), el('INPUT', {}), el('TEXTAREA'), el('SELECT'), el('DIV', { isContentEditable: true })])
      expect(shortcutFor(key('/'), target)).toBeNull()
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }]) expect(shortcutFor(key('/', mod), el('BODY'))).toBeNull()
  })

  it('renders a labelled footer button, a dialog and a switch to turn shortcuts off', () => {
    const html = renderToStaticMarkup(<KeyboardShortcuts />)
    expect(html).toContain('Keyboard shortcuts')
    expect(html).toContain('aria-labelledby="shortcuts-title"')
    expect(html).toMatch(/type="checkbox"[^>]*checked/)
  })
})

describe('text size', () => {
  const boot = (stored: string | null) => {
    const documentElement = { dataset: {} as Record<string, string> }
    new Function('localStorage', 'document', TEXT_SIZE_BOOT)({ getItem: () => stored }, { documentElement })
    return documentElement.dataset.textSize
  }

  it('applies only the two known sizes before paint, and survives blocked storage', () => {
    expect(boot('large')).toBe('large')
    expect(boot('larger')).toBe('larger')
    expect(boot('huge')).toBeUndefined()
    expect(boot('"><script>')).toBeUndefined()
    expect(boot(null)).toBeUndefined()
    expect(() => new Function('localStorage', 'document', TEXT_SIZE_BOOT)({ getItem: () => { throw new Error('blocked') } }, {})).not.toThrow()
  })

  it('renders a labelled, collapsed control with three pressed-state options', () => {
    const html = renderToStaticMarkup(<TextSizeControl />)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Text size: Standard')
    expect(html.match(/aria-pressed=/g)).toHaveLength(3)
    expect(html).toContain('role="group"')
  })
})

describe('FAQ', () => {
  const entries: FaqEntry[] = [
    { id: 'student-visa', topic: 'Visas', question: 'Do you apply for my student visa?', answer: ['Synthetic answer about the étude permit.'], approvedOn: '2026-11-01' },
    { id: 'fees', topic: 'Costs', question: 'Synthetic fee question?', answer: ['Synthetic.'], approvedOn: '2026-11-01' },
  ]

  it('holds only well-formed, approved entries (none yet)', () => {
    const ids = new Set<string>()
    for (const e of FAQ_ENTRIES) {
      expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(ids.has(e.id)).toBe(false)
      ids.add(e.id)
      expect(e.question.trim() && e.topic.trim()).toBeTruthy()
      expect(e.answer.length).toBeGreaterThan(0)
      expect(e.approvedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (e.source) expect(e.source.url).toMatch(/^https:\/\//)
    }
  })

  it('searches every word across topic, question and answer, ignoring case and accents', () => {
    expect(searchFaq(entries, '').map((e) => e.id)).toEqual(['student-visa', 'fees'])
    expect(searchFaq(entries, 'VISA').map((e) => e.id)).toEqual(['student-visa'])
    expect(searchFaq(entries, 'etude permit').map((e) => e.id)).toEqual(['student-visa'])
    expect(searchFaq(entries, 'visa fee')).toEqual([])
  })

  it('shows an honest empty state with no invented questions, and is not indexed while empty', async () => {
    const html = renderToStaticMarkup(await faqPage.default())
    expect(html).toContain('No answers are published yet.')
    expect(html).not.toContain('<details')
    expect(faqPage.generateMetadata().robots).toEqual({ index: false, follow: true })
  })

  it('renders approved entries as keyboard-operable details with their review date', () => {
    const html = renderToStaticMarkup(<FaqSearch entries={entries} />)
    expect(html.match(/<details/g)).toHaveLength(2)
    expect(html).toContain('id="student-visa"')
    expect(html).toContain('Reviewed 1 Nov 2026')
    expect(html).toContain('<label for="faq-q"')
  })
})
