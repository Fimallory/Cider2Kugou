/// <reference types="vite/client" />
/// <reference types="@ciderapp/pluginkit" />

interface ImportMetaEnv {
  // No plugin env vars (chain short links are cookie-free).
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
