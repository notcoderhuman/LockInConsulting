import type { Metadata } from 'next'
import Link from 'next/link'
import { Fact, LegalPage, OwnerToComplete } from '@/components/legal/legal-page'
import { BUSINESS, LEGAL_REVIEWED } from '@/lib/legal/notice'

export const metadata: Metadata = {
  title: 'Terms of use (draft) · LockIn Consulting',
  description: 'Terms for using lockinconsulting.com and the student chat. Draft pending legal review.',
  robots: { index: LEGAL_REVIEWED, follow: true },
}

const TERMS_VERSION = 'terms-2026-11-draft'

// Draft terms of use. Open questions (governing law, liability, paid services and the Consumer
// Protection (E-Commerce) Rules, 2020): docs/LEGAL-DRAFTS.md.
export default function TermsPage() {
  return (
    <LegalPage eyebrow="Terms of use" title="Using LockIn Consulting" version={TERMS_VERSION}>
      <section className="flex flex-col gap-3">
        <h2>About these terms</h2>
        <p>
          These terms apply to lockinconsulting.com and its student chat, run by LockIn Consulting (“LockIn”). Operator: <Fact value={BUSINESS.legalName} missing="registered legal name and form of entity" />, <Fact value={BUSINESS.address} missing="address" />.
          By creating a student account you accept them. How we handle personal data is set out in the <Link href="/privacy">privacy notice</Link>.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>What LockIn provides</h2>
        <p>
          LockIn provides general study-abroad information: university, course, fee and admission details, with links to official sources, and answers in the student chat. It is
          not legal or immigration advice. Admission, scholarships, visas and employment outcomes are never guaranteed. Always confirm details with the university or the official
          government source before you act on them.
        </p>
        <p>
          Fees, rankings and other figures can change and may contain errors. Each figure shows its source and when it was checked where we have one; the official source prevails.
        </p>
        <p>
          The student chat is currently free. <OwnerToComplete>whether any paid services will be offered online, their price, refund and cancellation terms</OwnerToComplete>
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Student accounts</h2>
        <ul>
          <li>You must be 18 or older to create an account.</li>
          <li>Give accurate information and do not impersonate anyone. Keep your sign-in methods and codes to yourself; LockIn will never ask you for a code.</li>
          <li>One person, one account. Team accounts and student accounts are kept separate.</li>
          <li>You can delete your account at any time from the chat page.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Using the chat</h2>
        <p>Please do not send:</p>
        <ul>
          <li>passwords, bank or card details, Aadhaar, passport or other government ID numbers, or health information;</li>
          <li>anything unlawful, abusive, or that infringes someone else’s rights;</li>
          <li>automated or bulk messages, or attempts to break, probe or overload the service.</li>
        </ul>
        <p>LockIn may suspend or close an account that breaks these rules. Where we can, we will tell you why.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>AI-assisted replies</h2>
        <p>
          Some replies are drafted or sent by Derek, LockIn’s AI assistant, and are labelled as such. AI replies can be wrong. Treat them as general information and check
          important facts with the official source. See the <Link href="/ai">AI disclosure</Link>.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Content and intellectual property</h2>
        <p>
          The site’s design, text and LockIn’s own content belong to LockIn. University names and official information belong to their owners, and third-party data such as
          rankings is shown only under the terms that allow it. You keep the rights in what you write in the chat and allow LockIn to use it to answer you.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Liability</h2>
        <p>
          <OwnerToComplete>limitation of liability wording, after legal review; nothing here limits rights that cannot be limited under Indian law, including under the Consumer Protection Act, 2019</OwnerToComplete>
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Complaints and contact</h2>
        <p>
          Contact: <Fact value={BUSINESS.contactEmail} missing="contact email" />, <Fact value={BUSINESS.contactPhone} missing="phone number" />. Grievances about personal data are handled as described in the{' '}
          <Link href="/privacy#rights">privacy notice</Link>.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Law and changes</h2>
        <p>
          These terms are governed by the laws of India. <OwnerToComplete>courts with jurisdiction</OwnerToComplete> We may update these terms; the version and date are shown at
          the top, and we will tell account holders about material changes before they apply.
        </p>
      </section>
    </LegalPage>
  )
}
