# Spoor / 踪迹 宣传片 · AI 配乐提示词（Claude 风格）

**用途：** Suno / Udio / Stable Audio 等生成约 **58–60s** 横屏产品片配乐。  
**原则：** 氛围电影配乐，不是广告歌；无鼓点、无 drop、持续情绪。

---

## 通用 Negative Prompt（各平台「排除」栏粘贴）

```
drums, drum kit, percussion loop, beat drop, EDM, trap, hip hop, corporate upbeat, motivational anthem, ukulele startup, whistling, dramatic trailer hit, brass stabs, big climax, choir swell, dubstep, glitch hop, busy melody, catchy hook, advertising jingle, happy major pop
```

---

## 主提示词 · 英文版（推荐，直接粘贴）

**Suno / Udio 主 Prompt：**

```
Minimal ambient cinematic soundtrack for a 58 second product film.

Warm analog synth pads, soft felt piano fragments, gentle granular textures.
Slow evolving harmonic layers, very sparse notes, lots of negative space.
No aggressive percussion, no drum beat, no bass drop, no dramatic climax.

Mood: thoughtful, intelligent, calm, quietly futuristic, humane.
Feels like the soundtrack to a gentle AI thinking tool — a quiet canvas for memory and spatial thought.

Tempo: very slow, 60–72 BPM feel, sustained mood throughout.
Key: warm minor or modal (Dorian), soft consonance, no sudden modulations.

Structure: single continuous arc — soft opening breath, subtle mid-film brightness when ideas connect, gentle fade at the end. No sections that feel like "verse" or "chorus".

Mix: airy, wide stereo pads, piano buried slightly behind texture, -18 LUFS feel, never loud.
Instrumental only, no vocals, no lyrics.
Duration about 60 seconds.
```

**风格标签（若平台支持 Tags）：**

```
ambient, cinematic, minimal, textural, warm, cerebral, neo-classical ambient, sound design, film score, instrumental
```

---

## 主提示词 · 中文版（国产模型可用）

```
极简氛围电影配乐，约60秒，横屏科技产品宣传片。

温暖合成器铺底，柔和钢琴碎片，细腻纹理与环境声，大量留白。
极慢节奏，60–72拍体感，情绪平稳贯穿，无高潮段落。

不要鼓点，不要打击乐循环，不要电子舞曲，不要企业宣传片昂扬曲风，不要广告歌旋律。

气质：克制、聪明、安静、略带未来感的人文科技。
像一款温和AI思考工具的开机氛围——空间化记忆与便签画布，安静、私密、可信赖。

结构：一口气听完的连续氛围——开场轻呼吸感，中段极轻微提亮（像念头连上线），结尾自然收束，无副歌无drop。

仅器乐，无人声，无歌词。
```

---

## 与分镜弱对齐的「情绪弧线」版（可选，仍无鼓点）

若生成结果太平，可在主 Prompt 末尾追加：

```
0:00–0:10 near-silent pad, paper-like warmth
0:10–0:32 subtle harmonic motion, still no percussion
0:32–0:52 slightly more luminous pads, not louder — just clearer
0:52–0:58 dissolve to near silence, one soft piano note optional
```

---

## 三条变体（A/B/C 试听选一条）

### A · 最贴近 Claude Demo（最静）

```
Ultra-minimal ambient cinematic bed. Warm synth pads only, occasional soft piano single notes, barely perceptible tape hiss texture. 58 seconds, no drums, no pulse, no climax. Thoughtful, calm, humane AI atmosphere. Instrumental.
```

### B · 略多一点「空间感」（适合画布/连线镜头）

```
Ambient cinematic score with wide reverberant pads, soft piano, very subtle high-frequency shimmer like distant light. Slow 65 BPM feel, evolving texture, no percussion. Quietly futuristic, intelligent, warm. 60 second product film instrumental.
```

### C · 带一点「纸感 / 书房」（贴合踪迹米色 UI）

```
Warm minimal cinematic ambient. Felt piano, soft string pad synthesized, light room tone, parchment-warm mid frequencies. No beat, no drop, sustained contemplative mood. Memory, notes, and trace — gentle and private. 58s instrumental.
```

---

## 导出与成片合成建议

| 项目 | 建议 |
|------|------|
| 时长 | 生成 **60–65s**，在 DAW 或 Premiere 里裁到 **58s**，与视频硬切对齐 |
| 音量 | 配乐峰值约 **-20 ~ -24 LUFS**；旁白为主，音乐垫底 |
|  ducking | 有人声处再压 **2–4 dB**，不要与旁白抢频段（2–4 kHz） |
| 起止 | **0.5s fade in**，**最后 1.5s fade out**，避免音乐比画面先结束 |

---

## 与品牌视觉的对应（写 Prompt 时可默念）

- 背景：浅纸色、安静、非炫酷
- 产品：画布、便签、连线、本地优先
- 忌：昂扬、销售感、节奏驱动、记忆点旋律

配乐应像「系统在呼吸」，而不是「产品在吆喝」。
