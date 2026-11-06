import type { Metadata } from 'next'
import Link from 'next/link'
import { Fact, LegalPage } from '@/components/legal/legal-page'
import { BUSINESS, LEGAL_REVIEWED } from '@/lib/legal/notice'
import { PRIVACY_NOTICE_VERSION } from '@/lib/student/onboarding'

export const metadata: Metadata = {
  title: 'Privacy notice · LockIn Consulting',
  description: 'How LockIn Consulting handles personal data of students who use the student chat.',
  // Kept out of search until a lawyer has reviewed it (lib/legal/notice.ts).
  robots: { index: LEGAL_REVIEWED, follow: true },
}

// Student privacy notice (no legal review yet). Structure follows DPDP Act 2023 s.5 and DPDP Rules 2025 r.3
// (itemised data, purposes, withdrawal, rights, complaint to the Board), r.9 (contact) and r.14
// (how to exercise rights). Sources and open questions: docs/LEGAL-DRAFTS.md.
export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Student privacy notice" title="How LockIn handles your personal data" version={PRIVACY_NOTICE_VERSION}>
      <section className="flex flex-col gap-3">
        <h2>Who we are</h2>
        <p>
          LockIn Consulting (“LockIn”, “we”) runs lockinconsulting.com, which gives general study-abroad information. For the personal data described here, LockIn is the Data
          Fiduciary under the Digital Personal Data Protection Act, 2023 (“the Act”).
        </p>
        <ul>
          <li>
            Business name: <Fact value={BUSINESS.legalName} missing="business name" />
          </li>
          <li>
            Address: <Fact value={BUSINESS.address} missing="postal address" />
          </li>
          <li>
            Person who answers questions about your personal data (Act s.8(9), Rules r.9): <Fact value={BUSINESS.contactPerson} missing="name or role" />, <Fact value={BUSINESS.contactEmail} missing="email address" />, <Fact value={BUSINESS.contactPhone} missing="phone number" />
          </li>
        </ul>
        <p>This notice covers the student chat and student accounts. Browsing the public pages does not need an account, and LockIn does not use analytics or advertising cookies.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>What we collect and why</h2>
        <table>
          <thead>
            <tr>
              <th>Personal data</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Your full name, and your confirmation that you are 18 or older (with the time you gave it)</td>
              <td>To address you and to keep student services for adults only. We do not ask for your date of birth or check your identity.</td>
            </tr>
            <tr>
              <td>Your email address, and the sign-in method you use (an emailed code or Google). LockIn has no passwords for students.</td>
              <td>To create your account, sign you in, send you sign-in codes, and keep accounts separate.</td>
            </tr>
            <tr>
              <td>If you sign in with Google: the account identifier and the name and email Google shares. Only basic profile scopes (name and email) are requested.</td>
              <td>To sign you in. We do not read your mailbox, contacts, files or calendar.</td>
            </tr>
            <tr>
              <td>The messages you send and receive in the chat, with their times and read status</td>
              <td>To answer your questions about universities, courses, fees and admissions.</td>
            </tr>
            <tr>
              <td>Sign-in sessions (a session token and your browser’s user-agent), and security records such as attempt counters keyed by a scrambled form of your email</td>
              <td>To keep you signed in, let you sign out other devices, and protect accounts from guessing attacks.</td>
            </tr>
            <tr>
              <td>The version of this notice you accepted, and when</td>
              <td>To show what you agreed to.</td>
            </tr>
          </tbody>
        </table>
        <p>
          Our hosting provider’s servers record technical data such as IP addresses in their own logs, which Hostinger keeps under its own terms and privacy policy.
        </p>
        <p>We do not sell personal data, and we do not use it for advertising.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Consent, and how to withdraw it</h2>
        <p>
          We process this data on the basis of your consent, which you give when you create a student account (the 18+ step and the privacy step). You can withdraw it at any time,
          as easily as you gave it, by deleting your account (“Delete your account” on Your account or the chat page). After you withdraw, we stop processing your data and erase it as described
          under “Deleting your account”, except where a law requires us to keep it. Withdrawing does not make processing before it unlawful.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Derek, our AI assistant</h2>
        <p>
          Derek is LockIn’s AI assistant. <strong>At the moment Derek is not switched on, so nothing you write is sent to any AI service</strong>: your messages are read and answered by the
          LockIn team. LockIn plans to use Google’s Gemini service for Derek. Google’s free service, which is the one LockIn would use, may store and review what it receives and use it to
          improve its products, so LockIn will not switch Derek on until it sends Google only general questions without personal details. Before it does, LockIn will update this notice and
          ask you to accept it again. Every reply in the chat says who or what wrote it. Details: <Link href="/ai">AI disclosure</Link>.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Who else processes your data</h2>
        <ul>
          <li>Our hosting provider (Hostinger), which stores the website and database.</li>
          <li>Google, only if you choose to sign in with it. Google (Gemini API) would also process general questions if Derek is switched on, as described above.</li>
          <li>Hostinger’s email service, which sends your sign-in codes.</li>
        </ul>
        <p>
          Some of these providers may process data outside India, which the Act permits except to countries the Government restricts.
        </p>
      </section>

      <section className="flex flex-col gap-3" id="retention">
        <h2>How long we keep it</h2>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Kept for</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Your account, profile and conversations</td>
              <td>
                Until you delete your account or ask us to. LockIn does not delete inactive accounts automatically at present.
              </td>
            </tr>
            <tr>
              <td>An unfinished sign-up (you signed in but did not accept this notice)</td>
              <td>Deleted when you choose “cancel” or say you are under 18. LockIn does not currently delete abandoned sign-ups automatically.</td>
            </tr>
            <tr>
              <td>The 18+ confirmation with your typed name</td>
              <td>An unused confirmation expires after 15 minutes. The name moves to your profile when the account is created; the confirmation time stays with the account.</td>
            </tr>
            <tr>
              <td>Sign-in codes; attempt counters</td>
              <td>Codes expire after 10 minutes and work once. Counters are cleared about an hour after the last attempt.</td>
            </tr>
            <tr>
              <td>Sign-in sessions</td>
              <td>Up to 30 days, renewed while you keep using the site, or until you sign out.</td>
            </tr>
            <tr>
              <td>LockIn’s change log (which records that an account was created or deleted, without your name, email or messages)</td>
              <td>For as long as the service runs: it is append-only by design.</td>
            </tr>
            <tr>
              <td>Backups of the database</td>
              <td>Backups exist only for disaster recovery. Data you delete can remain in a backup until that backup is deleted; LockIn has not set a fixed backup period yet.</td>
            </tr>
          </tbody>
        </table>
        <p>
          When the DPDP Rules, 2025 rule 8(3) takes effect (eighteen months after they were published on 13 November 2025), we may have to keep certain personal data, traffic data and
          processing logs for at least one year for purposes set by law, even after an account is deleted. LockIn will review how this applies to it before then.
        </p>
      </section>

      <section className="flex flex-col gap-3" id="rights">
        <h2>Your rights</h2>
        <ul>
          <li>
            <strong>Access:</strong> a summary of your personal data and how it is processed, and who it has been shared with (Act s.11). Signed in, choose “Download my data” on Your account for a copy.
          </li>
          <li>
            <strong>Correction and updating:</strong> you can change the name the team sees yourself. For anything else, contact us (s.12).
          </li>
          <li>
            <strong>Erasure:</strong> delete your account yourself, or ask us to (s.12(3)).
          </li>
          <li>
            <strong>Nomination:</strong> name someone to exercise these rights if you die or cannot act (s.14).
          </li>
          <li>
            <strong>Grievance redressal:</strong> complain to us first (s.13). We aim to reply well within the 90-day maximum set by the Rules.
          </li>
        </ul>
        <p>
          To make a request, write from the email address on your account to <Fact value={BUSINESS.contactEmail} missing="contact email for privacy requests" /> or call <Fact value={BUSINESS.contactPhone} missing="phone" />. That email address is the
          identifier we use to find your account (Rules r.14).
        </p>
        <p>
          If you are not satisfied with our response, you can complain to the Data Protection Board of India through the Board’s own complaint process.
        </p>
        <p>
          Your duties under the Act (s.15) include giving accurate information, not impersonating anyone, and not filing false or frivolous complaints.
        </p>
      </section>

      <section className="flex flex-col gap-3" id="deletion">
        <h2>Deleting your account</h2>
        <p>
          Signed in, choose “Delete your account” on Your account or the chat page. This removes, at once and permanently: your account, sign-in methods and sessions, your profile name,
          every conversation and message (including Derek’s drafts), and your notifications. What remains is a record that a student account existed and was deleted on a given
          date, with no name, email or message content. LockIn’s Owner can carry out the same erasure on your request.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Children</h2>
        <p>
          Student accounts are only for people aged 18 or older. Anyone under 18 is a child under the Act, and we do not knowingly create accounts for children. If you are under 18,
          please do not create an account. If you tell us at the privacy step that you are under 18, the sign-in you just made is deleted.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Security and breaches</h2>
        <p>
          We use encrypted connections, hashed sign-in codes, encrypted sign-in tokens, access controls for staff, and an append-only change log. If a personal data breach
          affects you, we will tell you without delay what happened, what it may mean for you, what we are doing and what you can do, and we will report it to the Data Protection
          Board as the Rules require.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Cookies</h2>
        <p>
          We use only cookies needed for the site to work: your sign-in session, a sign-in protection cookie, and your language choice.
          Saved and recently viewed universities stay in your own browser’s storage and are never sent to us.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2>Language and changes</h2>
        <p>
          This notice is in English; LockIn has not yet prepared a Hindi version. If we change it in
          substance, we will show the new version and ask you to accept it before you use the chat again; you can download your data or delete your account instead.
        </p>
      </section>
    </LegalPage>
  )
}
