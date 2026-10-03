<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import { DialogAPI } from "@ciderapp/pluginkit";
import type { SongInfo } from "../utils/song";
import { normalizeSong, resolveSongForShare } from "../utils/song";
import { fetchSongDetail } from "../utils/artwork";
import {
  renderPoster,
  canvasToBlob,
  copyPngToClipboard,
  downloadPng,
  posterFileName,
} from "../utils/poster";

const props = defineProps<{
  /** Raw host item (right-click target) or now-playing object. */
  source: unknown;
}>();

const previewUrl = ref("");
const status = ref<"idle" | "working" | "done" | "error">("idle");
const message = ref("正在生成海报…");

let lastBlob: Blob | null = null;
let lastSong: SongInfo | null = null;

function resolveSong(): SongInfo | null {
  // Item payload first, then DOM scrape at the click point, then now playing.
  return resolveSongForShare(props.source) ?? normalizeSong(props.source);
}

async function enrich(song: SongInfo): Promise<SongInfo> {
  // List rows usually have a title but no artwork: backfill via v3
  // (library route for i.xxx ids, catalog route for numeric ids).
  // fetchSongDetail never hangs (10s timeout per route, null on failure).
  if (song.title === "Unknown Title" || !song.artworkTemplate) {
    const detail = await fetchSongDetail(song.id, song.type, song.catalogId);
    if (detail) {
      return {
        title: detail.title ?? song.title,
        artist: detail.artist ?? song.artist,
        album: detail.album ?? song.album,
        artworkTemplate: detail.artworkTemplate ?? song.artworkTemplate,
        id: detail.id ?? song.id,
        type: detail.type ?? song.type,
        catalogId: detail.catalogId ?? song.catalogId,
      };
    }
  }
  return song;
}

async function generate(): Promise<void> {
  status.value = "working";
  message.value = "正在生成海报…";
  try {
    let song = resolveSong();
    if (!song) throw new Error("无法读取这首歌曲的信息");
    song = await enrich(song);
    lastSong = song;
    const canvas = await renderPoster(song);
    lastBlob = await canvasToBlob(canvas);
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(lastBlob);
    status.value = "done";
    message.value = `${song.title} — ${song.artist}`;
  } catch (e) {
    status.value = "error";
    message.value = e instanceof Error ? e.message : "生成失败";
  }
}

async function copy(): Promise<void> {
  if (!lastBlob) return;
  status.value = "working";
  message.value = "正在复制到剪贴板…";
  try {
    // Pass the blob directly (already resolved keeps the gesture chain short).
    await copyPngToClipboard(lastBlob);
    status.value = "done";
    message.value = "已复制到剪贴板，可直接粘贴";
    await DialogAPI.createAlert("海报 PNG 已复制到剪贴板", "分享");
  } catch {
    // Clipboard denied (unfocused window, permissions) → download instead.
    if (lastSong) downloadPng(lastBlob, posterFileName(lastSong));
    status.value = "done";
    message.value = "剪贴板不可用，已改为下载 PNG";
  }
}

defineExpose({ generate });

onUnmounted(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});

generate();
</script>

<template>
  <div class="share-poster-modal plugin-base">
    <div class="sp-head">
      <div class="sp-title">分享歌曲海报</div>
      <div class="sp-sub">{{ message }}</div>
    </div>
    <div class="sp-body">
      <img v-if="previewUrl" :src="previewUrl" class="sp-preview" alt="song poster" />
      <div v-else class="sp-loading">绘制中…</div>
    </div>
    <div class="sp-actions">
      <button class="c-btn" @click="generate" :disabled="status === 'working'">重新生成</button>
      <button
        class="c-btn primary"
        @click="copy"
        :disabled="status !== 'done' || !previewUrl"
      >
        复制 PNG 到剪贴板
      </button>
    </div>
  </div>
</template>

<style scoped>
.share-poster-modal {
  width: min(420px, 86vw);
  max-height: 88vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 12px;
  padding: 16px;
}
.sp-title {
  font-size: 17px;
  font-weight: 700;
}
.sp-sub {
  font-size: 12px;
  opacity: 0.65;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-body {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  overflow: hidden;
}
.sp-preview {
  width: 100%;
  height: auto;
  max-height: 58vh;
  object-fit: contain;
  display: block;
}
.sp-loading {
  opacity: 0.6;
  font-size: 13px;
}
.sp-actions {
  display: flex;
  gap: 8px;
}
.sp-actions .c-btn {
  flex: 1;
}
</style>
