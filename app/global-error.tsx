'use client'

export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="bg-[#0b0a09] text-[#efe7d8] font-sans antialiased">
        <main className="mx-auto flex min-h-[60dvh] max-w-3xl flex-col items-start justify-center gap-6 px-6 py-24">
          <p className="font-mono text-xs uppercase tracking-widest text-[#d4b47a]">500</p>
          <h1 className="font-serif text-4xl font-medium text-[#efe7d8]">Something went wrong</h1>
          <p className="text-base leading-relaxed text-[#a89e8b]">
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex min-h-11 items-center rounded-full bg-[#d4b47a] px-5 text-sm font-medium text-[#0b0a09]"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
