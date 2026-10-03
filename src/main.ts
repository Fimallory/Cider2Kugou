import { defineCustomElement } from "vue";
import type { App } from "vue";
import { createPinia } from "pinia";
import {
  definePluginContext,
  addMainMenuEntry,
  addMediaItemContextMenuEntry,
  addImmersiveMenuEntry,
  addCustomButton,
  createModal,
  AppleMusic,
  DialogAPI,
} from "@ciderapp/pluginkit";
import SharePosterModal from "./components/SharePosterModal.vue";
import KugouOpenModal from "./components/KugouOpenModal.vue";
import PluginConfig from "./plugin.config";
import { resolveSongForShare, armMenuAnchorTracking } from "./utils/song";

/**
 * Initializing a Vue app instance so we can use things like Pinia.
 */
const pinia = createPinia();

/**
 * Function that configures the app instances of the custom elements
 */
function configureApp(app: App) {
  app.use(pinia);
}

/**
 * Custom Elements that will be registered in the app
 */
export const CustomElements = {
  "share-poster-modal": defineCustomElement(SharePosterModal, {
    /**
     * Disabling the shadow root DOM so that we can inject styles from the DOM
     */
    shadowRoot: false,
    configureApp,
  }),
  "kugou-open-modal": defineCustomElement(KugouOpenModal, {
    shadowRoot: false,
    configureApp,
  }),
};

/**
 * Open the poster modal for a raw host song object.
 * Resolution order (inside the modal): host item -> DOM scrape -> now playing.
 */
function openSharePoster(source: unknown) {
  if (!resolveSongForShare(source)) {
    void DialogAPI.createAlert(
      "无法读取这首歌曲的信息。请先播放一首歌，或在歌曲行上右键后重试。",
      "分享"
    );
    return;
  }
  const { openDialog, closeDialog, dialogElement } = createModal({
    escClose: true,
  });
  const content = document.createElement(customElementName("share-poster-modal"));
  // Pass the raw item through as a property; the modal normalizes + enriches via v3.
  (content as unknown as { source: unknown }).source = source;
  dialogElement.appendChild(content);
  // Close on backdrop click for convenience (keep escClose too).
  dialogElement.addEventListener("click", (e) => {
    if (e.target === dialogElement) closeDialog();
  });
  openDialog();
}

/**
 * Open the KuGou modal for a raw host song object.
 * Same song-resolution chain as the poster flow; the modal then
 * searches KuGou, fuzzy-matches, and offers android->pc->web launch.
 */
function openKugou(source: unknown) {
  if (!resolveSongForShare(source)) {
    void DialogAPI.createAlert(
      "无法读取这首歌曲的信息。请先播放一首歌，或在歌曲行上右键后重试。",
      "在酷狗中打开"
    );
    return;
  }
  const { openDialog, closeDialog, dialogElement } = createModal({
    escClose: true,
  });
  const content = document.createElement(customElementName("kugou-open-modal"));
  (content as unknown as { source: unknown }).source = source;
  dialogElement.appendChild(content);
  dialogElement.addEventListener("click", (e) => {
    if (e.target === dialogElement) closeDialog();
  });
  openDialog();
}

/** Fallback source: the currently playing item (immersive / top button). */
function nowPlayingSource(): unknown {
  try {
    return AppleMusic.nowPlayingItem ?? null;
  } catch {
    return null;
  }
}

/**
 * Defining the plugin context
 */
const { plugin, setupConfig, customElementName, useCPlugin } =
  definePluginContext({
    ...PluginConfig,
    CustomElements,
    setup() {
      /**
       * Registering the custom elements in the app
       */
      for (const [key, value] of Object.entries(CustomElements)) {
        const _key = key as keyof typeof CustomElements;
        customElements.define(customElementName(_key), value);
      }

      // Track the right-clicked row so the modal can scrape song info
      // even when the host passes a MenuItem descriptor instead of song data.
      armMenuAnchorTracking();

      // 1) Media item context menu (right-click a song) — primary entry.
      addMediaItemContextMenuEntry({
        label: "分享歌曲海报",
        onClick(item) {
          openSharePoster(item ?? nowPlayingSource());
        },
      });
      addMediaItemContextMenuEntry({
        label: "在酷狗中打开",
        onClick(item) {
          openKugou(item ?? nowPlayingSource());
        },
      });

      // 2) Immersive player menu — shares the current song.
      addImmersiveMenuEntry({
        label: "分享歌曲海报",
        onClick() {
          openSharePoster(nowPlayingSource());
        },
      });
      addImmersiveMenuEntry({
        label: "在酷狗中打开",
        onClick() {
          openKugou(nowPlayingSource());
        },
      });

      // 3) Main menu — shares the current song.
      addMainMenuEntry({
        label: "分享歌曲海报",
        onClick() {
          openSharePoster(nowPlayingSource());
        },
      });
      addMainMenuEntry({
        label: "在酷狗中打开",
        onClick() {
          openKugou(nowPlayingSource());
        },
      });

      // 4) Top chrome button — quick access to the current song.
      addCustomButton({
        element: "▦",
        location: "chrome-top/right",
        title: "分享歌曲海报",
        onClick() {
          openSharePoster(nowPlayingSource());
        },
      });
      addCustomButton({
        element: "♪K",
        location: "chrome-top/right",
        title: "在酷狗中打开",
        onClick() {
          openKugou(nowPlayingSource());
        },
      });
    },
  });

/**
 * No user-facing settings (zero-config per spec).
 */
export const cfg = setupConfig({});

export function useConfig() {
  return cfg.value;
}

/**
 * Exporting the plugin and functions
 */
export { setupConfig, customElementName, useCPlugin };

/**
 * Exporting the plugin, Cider will use this to load the plugin
 */
export default plugin;
