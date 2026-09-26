/// <reference types="vite/client" />

/** The repository CHANGELOG.md as text (vite.config.ts changelogModule). */
declare module "virtual:axom-changelog" {
  const changelog: string;
  export default changelog;
}
