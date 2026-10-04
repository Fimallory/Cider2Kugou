<script setup lang="ts">
import { ref } from "vue";
import { useConfig } from "../main";
import { fetchEncodeId } from "../utils/shortlink";

const cfg = useConfig();
// Short-link status: idle -> ok (valid, short code resolved) / fail.
const checkState = ref<"idle" | "working" | "ok" | "fail">("idle");
const checkNote = ref("");

async function verify(): Promise<void> {
  const cookie = String(cfg.kugouCookie ?? "").trim();
  if (!cookie) {
    checkState.value = "fail";
    checkNote.value = "请先粘贴 Cookie";
    return;
  }
  checkState.value = "working";
  checkNote.value = "正在用已知歌曲验证…";
  // Well-known track: G.E.M. 邓紫棋 - 喜欢你 (expect encode gr4tu0a).
  const code = await fetchEncodeId(
    "426d6bc62a73df288f55cb3fca8d2a62",
    cookie
  );
  if (code) {
    checkState.value = "ok";
    checkNote.value = `有效，短码示例：${code}`;
  } else {
    checkState.value = "fail";
    checkNote.value = "无效或已过期，请重新登录后复制";
  }
}
</script>

<template>
  <div class="q-px-lg plugin-base">
    <div class="shelf-title">酷狗短链 Cookie</div>
    <div class="text-caption">
      粘贴 m.kugou.com 登录后的 Cookie，用于把二维码换成官方 mixsong
      短链。只存本机 Cider 配置，不会进代码仓库。失效时二维码自动回退为通用
      H5 页。
    </div>
    <div>
      <label>
        Cookie
        <input
          v-model="cfg.kugouCookie"
          placeholder="t=...; KugooID=...; mid=...; dfid=...; a_id=...;"
        />
      </label>
    </div>
    <div>
      <button @click="verify" :disabled="checkState === 'working'">
        {{
          checkState === "working"
            ? "验证中…"
            : checkState === "ok"
              ? "✓ 有效"
              : checkState === "fail"
                ? "✗ 重新验证"
                : "验证 Cookie"
        }}
      </button>
    </div>
    <div v-if="checkNote">{{ checkNote }}</div>
  </div>
</template>

<style scoped></style>
