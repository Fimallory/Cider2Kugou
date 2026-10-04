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
} from "@ciderapp/pluginkit";
import SharePosterModal from "./components/SharePosterModal.vue";
import PluginSettings from "./components/PluginSettings.vue";
import PluginConfig from "./plugin.config";
import { armMenuAnchorTracking } from "./utils/song";

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
};

/**
 * Open the poster modal for a raw host song object.
 * Resolution order (inside the modal): host item -> DOM scrape -> now playing.
 * No alerts: unreadable songs surface as an inline error inside the modal.
 */
function openSharePoster(source: unknown) {
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

      // Explicitly defining our settings element here to avoid issues with module load order
      customElements.define(
        customElementName("settings"),
        defineCustomElement(PluginSettings, {
          shadowRoot: false,
          configureApp,
        })
      );

      /**
       * Defining our custom settings element
       */
      this.SettingsElement = customElementName("settings");

      // Track the right-clicked row so the modal can scrape song info
      // even when the host passes a MenuItem descriptor instead of song data.
      armMenuAnchorTracking();

      // 1) Media item context menu (right-click a song) — single merged entry.
      addMediaItemContextMenuEntry({
        label: "分享歌曲海报",
        onClick(item) {
          openSharePoster(item ?? nowPlayingSource());
        },
      });

      // 2) Immersive player menu — shares the current song.
      addImmersiveMenuEntry({
        label: "分享歌曲海报",
        onClick() {
          openSharePoster(nowPlayingSource());
        },
      });

      // 3) Main menu — shares the current song.
      addMainMenuEntry({
        label: "分享歌曲海报",
        onClick() {
          openSharePoster(nowPlayingSource());
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
    },
  });

/**
 * Plugin settings. No user inputs: chain short links are cookie-free
 * (kept as an empty shell so the host settings entry still renders).
 */
export interface PluginSettings {
  _placeholder?: string;
}

export const cfg = setupConfig<PluginSettings>({});

export function useConfig(): PluginSettings {
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
