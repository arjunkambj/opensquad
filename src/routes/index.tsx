import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="page shell">
      <p className="eyebrow">Convex All Gas Hackathon</p>
      <h1>Build together, in real time.</h1>
      <p className="lede">
        OpenSquad is ready for product work with Vite, React, TanStack Router,
        and Oxlint.
      </p>
    </main>
  )
}
