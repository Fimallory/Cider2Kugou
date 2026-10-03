<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import type { SongInfo } from "../utils/song";
import { normalizeSong, resolveSongForShare } from "../utils/song";
import { fetchSongDetail } from "../utils/artwork";
import {
  renderPoster,
  randomPosterSeed,
  canvasToBlob,
  copyPngToClipboard,
  downloadPng,
  posterFileName,
} from "../utils/poster";
import {
  searchKugou,
  rankKugou,
  mixsongUrl,
  shareUrl,
  AUTO_MATCH_THRESHOLD,
  type KugouCandidate,
} from "../utils/kugou";
import { fetchEncodeId } from "../utils/shortlink";

const props = defineProps<{
  /** Raw host item (right-click target) or now-playing object. */
  source: unknown;
}>();

const previewUrl = ref("");
const status = ref<"idle" | "working" | "done" | "error">("idle");
const message = ref("正在生成海报…");

// KuGou match / list state (inline only, no dialogs).
const kgPhase = ref<"searching" | "matched" | "pick" | "none">("searching");
const kgLine = ref("正在匹配酷狗…");
const candidates = ref<KugouCandidate[]>([]);
const picked = ref<KugouCandidate | null>(null);
const listOpen = ref(false);

// Copy button feedback: idle -> ok (✓, auto-revert 0.5s) / fail (✗, sticky).
const copyState = ref<"idle" | "ok" | "fail">("idle");
let copyTimer: ReturnType<typeof setTimeout> | undefined;

let lastBlob: Blob | null = null;
let lastSong: SongInfo | null = null;
let lastSeed = 0;

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

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function fmtDur(sec: number): string {
  if (!sec || sec <= 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** picked candidate -> QR text. Short mixsong link when resolved, else generic H5. */
function qrTextFor(c: KugouCandidate | null): string {
  if (!c) return "";
  if (c.encodeId) return mixsongUrl(c.encodeId);
  return shareUrl(c);
}

/** Resolve the mixsong short code for the picked candidate (silent fallback). */
async function resolveShortLink(c: KugouCandidate): Promise<string> {
  if (!c || c.encodeId) return c?.encodeId ?? "";
  const code = await fetchEncodeId(c.hash);
  if (code) c.encodeId = code;
  return code;
}

async function loadKugou(song: SongInfo): Promise<void> {
  kgPhase.value = "searching";
  kgLine.value = "正在匹配酷狗…";
  picked.value = null;
  try {
    const raw = await searchKugou(song.title, song.artist);
    const ranked = rankKugou(raw, song.title, song.artist);
    candidates.value = ranked;
    if (!ranked.length) {
      kgPhase.value = "none";
      kgLine.value = "酷狗无匹配";
      return;
    }
    const best = ranked[0]!;
    if ((best.score ?? 0) >= AUTO_MATCH_THRESHOLD) {
      picked.value = best;
      kgPhase.value = "matched";
      kgLine.value = `已匹配：${best.songName} — ${best.singerName}（${pct(best.score)}）`;
      listOpen.value = false;
    } else {
      kgPhase.value = "pick";
      kgLine.value = `找到 ${ranked.length} 个结果，请确认是哪一首`;
      listOpen.value = true;
    }
  } catch {
    kgPhase.value = "none";
    kgLine.value = "酷狗无匹配";
    candidates.value = [];
    picked.value = null;
  }
}

async function bakePreview(canvas: HTMLCanvasElement): Promise<void> {
  lastBlob = await canvasToBlob(canvas);
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = URL.createObjectURL(lastBlob);
}

async function generate(): Promise<void> {
  status.value = "working";
  message.value = "正在生成海报…";
  copyState.value = "idle";
  if (copyTimer) {
    clearTimeout(copyTimer);
    copyTimer = undefined;
  }
  try {
    let song = resolveSong();
    if (!song) throw new Error("无法读取这首歌曲的信息");
    song = await enrich(song);
    lastSong = song;
    message.value = `${song.title} — ${song.artist}`;
    // Poster render and KuGou search run concurrently; QR needs the match.
    const kgPromise = loadKugou(song);
    lastSeed = randomPosterSeed();
    await kgPromise;
    if (picked.value) await resolveShortLink(picked.value);
    const canvas = await renderPoster(song, {
      qrText: qrTextFor(picked.value),
      seed: lastSeed,
    });
    await bakePreview(canvas);
    status.value = "done";
  } catch (e) {
    status.value = "error";
    message.value = e instanceof Error ? e.message : "生成失败";
  }
}

/** User corrects the match: re-render with the SAME flow seed, new QR. */
async function select(c: KugouCandidate): Promise<void> {
  picked.value = c;
  kgPhase.value = "matched";
  kgLine.value = `已匹配：${c.songName} — ${c.singerName}（${pct(c.score)}）`;
  listOpen.value = false;
  copyState.value = "idle";
  if (!lastSong) return;
  status.value = "working";
  try {
    await resolveShortLink(c);
    const canvas = await renderPoster(lastSong, {
      qrText: qrTextFor(c),
      seed: lastSeed,
    });
    await bakePreview(canvas);
    status.value = "done";
  } catch {
    status.value = "error";
  }
}

async function copy(): Promise<void> {
  if (!lastBlob) return;
  if (copyTimer) {
    clearTimeout(copyTimer);
    copyTimer = undefined;
  }
  try {
    await copyPngToClipboard(lastBlob);
    // Success: button becomes ✓, reverts after 0.5s. No dialogs.
    copyState.value = "ok";
    copyTimer = setTimeout(() => {
      copyState.value = "idle";
      copyTimer = undefined;
    }, 500);
  } catch {
    // Clipboard denied → silent download fallback, button becomes ✗ (sticky).
    if (lastSong) downloadPng(lastBlob, posterFileName(lastSong));
    copyState.value = "fail";
  }
}

defineExpose({ generate });

onUnmounted(() => {
  if (copyTimer) clearTimeout(copyTimer);
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
    <div class="kg-zone">
      <div class="kg-line">{{ kgLine }}</div>
      <div v-if="candidates.length > 1 && kgPhase === 'matched'" class="kg-toggle">
        <button
          class="c-btn flat"
          @click="listOpen = !listOpen"
          :disabled="status === 'working'"
        >
          {{ listOpen ? "收起列表" : `不是这首？从列表重选 (${candidates.length})` }}
        </button>
      </div>
      <div v-if="candidates.length > 0 && (kgPhase === 'pick' || listOpen)" class="kg-list">
        <button
          v-for="c in candidates"
          :key="c.hash"
          class="kg-item"
          :class="{ active: picked && picked.hash === c.hash }"
          @click="select(c)"
          :disabled="status === 'working'"
        >
          <div class="kg-item-main">
            <div class="kg-item-title">{{ c.songName }}</div>
            <div class="kg-item-sub">{{ c.singerName }} · {{ c.albumName || "未知专辑" }}</div>
          </div>
          <div class="kg-item-meta">
            <span class="kg-dur">{{ fmtDur(c.duration) }}</span>
            <span class="kg-score">{{ pct(c.score) }}</span>
          </div>
        </button>
      </div>
    </div>
    <div class="sp-actions">
      <button class="c-btn" @click="generate" :disabled="status === 'working'">重新生成</button>
      <button
        class="c-btn primary"
        @click="copy"
        :disabled="status !== 'done' || !previewUrl"
      >
        {{ copyState === "ok" ? "✓" : copyState === "fail" ? "✗" : "复制 PNG 到剪贴板" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.share-poster-modal {
  width: min(420px, 86vw);
  max-height: 88vh;
  display: grid;
  grid-template-rows: auto auto auto auto;
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
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
  max-height: 52vh;
  object-fit: contain;
  display: block;
}
.sp-loading {
  opacity: 0.6;
  font-size: 13px;
}
.kg-zone {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kg-line {
  font-size: 12px;
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kg-toggle .c-btn.flat {
  width: 100%;
  background: transparent;
  border: 1px dashed rgba(255, 255, 255, 0.18);
}
.kg-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  max-height: 22vh;
  min-height: 0;
}
.kg-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  color: inherit;
}
.kg-item:hover {
  background: rgba(255, 255, 255, 0.09);
}
.kg-item.active {
  border-color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.08);
}
.kg-item-main {
  min-width: 0;
  flex: 1;
}
.kg-item-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kg-item-sub {
  font-size: 12px;
  opacity: 0.65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kg-item-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 11px;
  opacity: 0.75;
  flex-shrink: 0;
}
.sp-actions {
  display: flex;
  gap: 8px;
}
.sp-actions .c-btn {
  flex: 1;
}
</style>
