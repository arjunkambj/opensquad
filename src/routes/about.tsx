import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
  component: AboutPage,
})

function AboutPage() {
  return (
    <main className="page shell">
      <p className="eyebrow">About</p>
      <h1>A clean foundation for the next idea.</h1>
      <p className="lede">
        Routes live in the src/routes folder and are generated automatically by
        the TanStack Router Vite plugin.
      </p>
    </main>
  )
}
