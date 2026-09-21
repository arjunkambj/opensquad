# Agent instructions

After making changes, run `pnpm lint` and fix all errors.

## Design system lint (`@shadcn/lint`)

Rules live in `.oxlintrc.json`. Components in `src/components/ui` own their
appearance: outside that directory, pass only layout classes to them and use
their variants and sizes instead of restyling with `className`. If a design
needs a new appearance that repeats, add a variant in `src/components/ui`
(or a token in `src/index.css`) rather than overriding it at the call site.
