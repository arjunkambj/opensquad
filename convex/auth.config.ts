import { getConvexProvidersConfig } from "@hexclave/react/convex-auth.config";

export default {
  providers: getConvexProvidersConfig({
    projectId: process.env.VITE_HEXCLAVE_PROJECT_ID!,
  }),
};
