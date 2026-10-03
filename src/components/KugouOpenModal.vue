<script setup lang="ts">
import { ref, computed } from "vue";
import { DialogAPI } from "@ciderapp/pluginkit";
import type { SongInfo } from "../utils/song";
import { normalizeSong, resolveSongForShare } from "../utils/song";
import {
  searchKugou,
  rankKugou,
  buildLaunchLinks,
  openExternal,
  copyText,
  webSearchUrl,
  AUTO_MATCH_THRESHOLD,
  type KugouCandidate,
  type KugouLaunchLinks,
} from "../utils/kugou";

const props = defineProps<{
  /** Raw host item (right-click target) or now-playing object. */
  source: unknown;
}>();

type Phase =
  | "searching"
  | "pick" // low-confidence: user must choose
  | "ready" // exact/hash link ready (auto or user-picked)
  | "error";

const phase = ref<Phase>("searching");
const message = ref("正在酷狗搜索…");
const song = ref<SongInfo | null>(null);
const candidates = ref<KugouCandidate[]>([]);
const picked = ref<KugouCandidate | null>(null);
const links = ref<KugouLaunchLinks | null>(null);

const best = computed(() => candidates.value[0] ?? null);

function fmtDur(sec: number): string {
  if (!sec || sec <= 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

async function run(): Promise<void> {
  phase.value = "searching";
  message.value = "正在酷狗搜索…";
  picked.value = null;
  links.value = null;
  try {
    const s = resolveSongForShare(props.source) ?? normalizeSong(props.source);
    if (!s || s.title === "Unknown Title") {
      throw new Error("无法读取这首歌曲的信息");
    }
    song.value = s;
    const raw = await searchKugou(s.title, s.artist);
    const ranked = rankKugou(raw, s.title, s.artist);
    candidates.value = ranked;
    if (!ranked.length) throw new Error("酷狗搜不到这首歌");
    if ((ranked[0]?.score ?? 0) >= AUTO_MATCH_THRESHOLD) {
      // 混合策略:高分自动直达,列表仍保留供用户纠错.
      select(ranked[0]!, true);
    } else {
      phase.value = "pick";
      message.value = `找到 ${ranked.length} 个结果,请确认是哪一首`;
    }
  } catch (e) {
    phase.value = "error";
    message.value = e instanceof Error ? e.message : "搜索失败";
  }
}

function select(c: KugouCandidate, auto = false): void {
  picked.value = c;
  const s = song.value;
  links.value = buildLaunchLinks(c, s?.title ?? "", s?.artist ?? "");
  phase.value = "ready";
  message.value = auto
    ? `已匹配:${c.songName} — ${c.singerName} (${pct(c.score)})`
    : `${c.songName} — ${c.singerName}`;
}

function backToList(): void {
  picked.value = null;
  links.value = null;
  phase.value = "pick";
  message.value = `找到 ${candidates.value.length} 个结果,请确认是哪一首`;
}

/** android -> pc -> web 三级:默认按此顺序尝试. */
function launchAndroid(): void {
  if (!links.value) return;
  openExternal(links.value.androidIntent);
}

function launchPc(): void {
  if (!links.value) return;
  openExternal(links.value.playUrl);
}

function launchWebSearch(): void {
  const s = song.value;
  openExternal(
    links.value?.searchUrl ?? webSearchUrl(s?.title ?? "", s?.artist ?? "")
  );
}

async function copyLink(kind: "android" | "pc"): Promise<void> {
  if (!links.value) return;
  const text =
    kind === "android" ? links.value.androidIntent : links.value.playUrl;
  try {
    await copyText(text);
    await DialogAPI.createAlert("链接已复制到剪贴板", "在酷狗中打开");
  } catch {
    await DialogAPI.createAlert(text, "复制失败,请手动复制");
  }
}

defineExpose({ run });

run();
</script>

<template>
  <div class="kugou-modal plugin-base">
    <div class="kg-head">
      <div class="kg-title">在酷狗中打开</div>
      <div class="kg-sub">{{ message }}</div>
      <div v-if="song" class="kg-query">
        {{ song.title }} — {{ song.artist }}
      </div>
    </div>

    <!-- searching -->
    <div v-if="phase === 'searching'" class="kg-loading">搜索中…</div>

    <!-- error -->
    <div v-else-if="phase === 'error'" class="kg-error">
      <div>{{ message }}</div>
      <div class="kg-actions">
        <button class="c-btn" @click="run">重试</button>
        <button class="c-btn" @click="launchWebSearch">用关键词打开酷狗网页搜索</button>
      </div>
    </div>

    <!-- pick: 低分回退,用户选择 -->
    <div v-else-if="phase === 'pick'" class="kg-list">
      <button
        v-for="c in candidates"
        :key="c.hash"
        class="kg-item"
        @click="select(c)"
      >
        <div class="kg-item-main">
          <div class="kg-item-title">{{ c.songName }}</div>
          <div class="kg-item-sub">
            {{ c.singerName }} · {{ c.albumName || "未知专辑" }}
          </div>
        </div>
        <div class="kg-item-meta">
          <span class="kg-dur">{{ fmtDur(c.duration) }}</span>
          <span class="kg-score">{{ pct(c.score) }}</span>
        </div>
      </button>
      <div class="kg-actions">
        <button class="c-btn" @click="run">换关键词重试</button>
        <button class="c-btn" @click="launchWebSearch">酷狗网页搜索</button>
      </div>
    </div>

    <!-- ready: 已锁定 hash/album_id,三级启动 -->
    <div v-else class="kg-ready">
      <div v-if="picked" class="kg-picked">
        <div class="kg-item-title">{{ picked.songName }}</div>
        <div class="kg-item-sub">
          {{ picked.singerName }} · {{ picked.albumName || "未知专辑" }} ·
          {{ fmtDur(picked.duration) }} · 匹配度 {{ pct(picked.score) }}
        </div>
        <div class="kg-hash">hash={{ picked.hash }} album_id={{ picked.albumId }}</div>
      </div>
      <div class="kg-actions col">
        <button class="c-btn primary" @click="launchAndroid">
          ① Android 意图拉起 (intent://, 包 com.kugou.android)
        </button>
        <button class="c-btn" @click="launchPc">② PC / 网页播放页打开</button>
        <button class="c-btn" @click="launchWebSearch">③ 关键词网页搜索兜底</button>
      </div>
      <div class="kg-actions">
        <button class="c-btn" @click="() => copyLink('android')">复制意图链接</button>
        <button class="c-btn" @click="() => copyLink('pc')">复制播放页链接</button>
      </div>
      <div v-if="candidates.length > 1" class="kg-actions">
        <button class="c-btn" @click="backToList">
          不是这首?返回列表 ({{ candidates.length }})
        </button>
      </div>
      <div v-if="best && picked && best.hash !== picked.hash" class="kg-hint">
        自动最佳: {{ best.songName }} — {{ best.singerName }} ({{ pct(best.score) }})
      </div>
    </div>
  </div>
</template>

<style scoped>
.kugou-modal {
  width: min(440px, 88vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow: hidden;
}
.kg-title {
  font-size: 17px;
  font-weight: 700;
}
.kg-sub {
  font-size: 12px;
  opacity: 0.65;
  margin-top: 2px;
}
.kg-query {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kg-loading,
.kg-error {
  padding: 24px 8px;
  text-align: center;
  font-size: 13px;
  opacity: 0.8;
}
.kg-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 120px;
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
.kg-picked {
  padding: 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
}
.kg-hash {
  margin-top: 4px;
  font-size: 10px;
  opacity: 0.5;
  word-break: break-all;
  font-family: monospace;
}
.kg-actions {
  display: flex;
  gap: 8px;
}
.kg-actions.col {
  flex-direction: column;
}
.kg-actions .c-btn {
  flex: 1;
}
.kg-hint {
  font-size: 11px;
  opacity: 0.55;
}
</style>
