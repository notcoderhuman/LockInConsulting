import Image from 'next/image'

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 md:flex-row md:items-start md:justify-between md:px-8">
        <div className="flex items-center gap-3">
          <Image src="/images/logo-mark.webp" alt="" width={44} height={36} className="h-8 w-auto" />
          <div className="leading-none">
            <p className="font-serif text-lg tracking-[0.22em] text-foreground">LOCKIN</p>
            <p className="mt-1 text-[0.6rem] uppercase tracking-[0.42em] text-muted-foreground">Consulting</p>
          </div>
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          LockIn provides general study-abroad information, not legal or immigration advice. Admission, scholarships, visas and employment outcomes are never guaranteed. Always confirm details with the university or the official government source.
        </p>
      </div>
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="hairline-gold h-px opacity-40" aria-hidden />
        <p className="py-6 text-xs text-muted-foreground">{'© 2026 LockIn Consulting · Draft preview, not yet launched'}</p>
      </div>
    </footer>
  )
}
