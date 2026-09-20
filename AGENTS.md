# OpenSquad working instructions

- Do not write tests unless the user asks. Use the existing lint/build commands
  and manual acceptance scenarios.
- Write idiomatic TypeScript: explicit domain unions, typed functions, generated
  Convex references, and normal React composition. Avoid `any`, loose dictionaries,
  Python-style abstractions, or classes where a small typed function suffices.
- Keep Vite, React, TanStack Router, Convex, Hexclave, pnpm, shadcn/Base UI and
  Hugeicons.
- AI calls go through Convex AI Gateway (`@convex-dev/ai-sdk-provider`) with
  OpenAI models from Convex actions.
- Never mark a planned integration as working merely because its documentation
  exists. Record actual acceptance evidence.
- Update `hackathon.md` with the existing `convex-hackathon-skill` after meaningful
  work. Keep secrets, personal data and real email addresses out of public logs.

- always do featues wise commit, not big commits and Dont co auther COmmits
