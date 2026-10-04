/// <reference types="vite/client" />
/// <reference types="@ciderapp/pluginkit" />

interface ImportMetaEnv {
  /** Local KuGou login cookie (git-ignored .env.local). */
  readonly VITE_KUGOU_COOKIE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
