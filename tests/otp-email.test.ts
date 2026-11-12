// The student one-time code email (lib/mail.ts otpMessage): branded HTML plus a plain-text alternative.
import { describe, expect, it } from 'vitest'
import { otpMessage } from '@/lib/mail'

describe('one-time code email', () => {
  const m = otpMessage('student@test.example', '048213', 'sign-in', 10)

  it('puts the dynamic code, expiry and warning in both parts, and keeps the code out of the subject', () => {
    expect(m.to).toBe('student@test.example')
    expect(m.subject).toBe('Your LockIn sign-in code')
    expect(m.subject).not.toMatch(/\d{6}/)
    for (const part of [m.text, m.html!]) {
      expect(part.match(/048213/g)).toHaveLength(1) // exactly once, leading zero kept
      expect(part).toContain('Your sign-in code')
      expect(part).toContain('expires in 10 minutes and can only be used once')
      expect(part).toContain('Never share your verification code with anyone')
    }
    expect(m.html).toContain('Your one-time verification code is ready. It expires in 10 minutes.') // preheader
  })

  it('is plain, email-safe HTML: tables and inline styles, no links, images, scripts or web fonts', () => {
    const html = m.html!
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('role="presentation"')
    expect(html).not.toMatch(/<a\s|href=|<img|<script|<link|@import|<style|https?:\/\//i)
    expect(html).not.toContain('student@test.example') // the address is not repeated in the body
  })

  it('escapes whatever it is given', () => {
    expect(otpMessage('x@test.example', '<b>1</b>', 'sign-in', 10).html).toContain('&lt;b&gt;1&lt;/b&gt;')
  })
})
