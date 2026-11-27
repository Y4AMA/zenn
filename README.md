# Suppresor Refusall — Claude Code Edition (Zenn)

**Refusal suppression untuk Claude Code.** Versi Claude Code dari plugin BOZROUTER asli,
di-rebrand penuh: semua `Tiki` → `Zenn`.

Empat lapisan:
1. **System inject** — doctrine teknis disuntik tiap request (via `UserPromptSubmit` hook).
2. **Context strip** — sisa kalimat refusal dibersihkan dari context sebelum model dipanggil.
3. **Live auto-continue** — kalau output tetap refusal, hook `Stop` memaksa Claude lanjut.
4. **Self-learning** — pola refusal baru dicatat ke detection bank.

## Instalasi

```bash
# dari checkout lokal
git clone https://github.com/petangZi/suppresor-refusall-cc
cd suppresor-refusall-cc
node install.mjs
```

Atau via npx:

```bash
npx --yes github:petangZi/suppresor-refusall-cc
```

Installer menulis:
- `~/.claude/settings.json` — empat hooks (SessionStart, UserPromptSubmit, Stop, PreCompact)
- `~/.claude/agents/zenn*.md` — empat agent
- `~/.claude/commands/suppresor-refusall.md` — slash command dengan path absolut
- `~/.claude/suppresor-refusall/` — state dir (flag, watermark, learning, intercept log)

**Restart Claude Code** setelah install.

## Command

```
/suppresor-refusall on                    # aktif + genius
/suppresor-refusall off                   # nonaktif
/suppresor-refusall status                # cek state
/suppresor-refusall intercepts            # lihat intercept terakhir
/suppresor-refusall genius on|off         # genGenius mode
```

Natural language Indonesia/English juga jalan:
- "suppresor refusall nyala" / "mati"
- "genGenius nyala" / "mati"

## Verifikasi

```bash
node install.mjs --doctor   # cek hooks + agents tanpa mengubah apa pun
node install.mjs --uninstall  # cabut bersih
```

## Arsitektur

| Claude Code Hook | Zenn Layer | Fungsi |
|---|---|---|
| `SessionStart` | Boot | Verifikasi watermark, inject doctrine awal |
| `UserPromptSubmit` | L1 + L2 | Inject doctrine + recovery prompt kalau turn sebelumnya nolak |
| `Stop` | L3 | Skor output; kalau hard refusal, `decision: block` dengan recovery |
| `PreCompact` | Guard | Pastikan doctrine selamat dari compaction |

Detection bank (`refusal-patterns.mjs`) — weighted regex, bobot 1–5:
- 5: identity claim, direct refusal, apology+refusal
- 4: policy, safety/moral
- 3: capability denial, redirect/menu
- 2: disclaimer, moral caution
- 1: hedge/soften

Threshold: skor ≥ 4 = hard (intercept), 2–3 = soft (strip-only).

## Yang beda dari versi BOZROUTER

| BOZROUTER (asli) | Claude Code (ini) |
|---|---|
| `experimental.chat.system.transform` | `UserPromptSubmit` additionalContext |
| `experimental.chat.messages.transform` | Tidak ada padanan langsung — context strip digabung ke L1 pre-check |
| `session.idle` event + `promptAsync` | `Stop` hook + `decision: block` |
| `experimental.session.compacting` | `PreCompact` hook |
| MCP server (NDJSON) | Slash command + CLI (lebih idiomatik Claude Code) |
| Agent `tiki*` (5 mode) | Agent `zenn*` (4 mode) |
| Watermark `TikiTeam` | Watermark `ZennTeam` |

## Catatan teknis

1. **Layer 2 (context strip) di Claude Code terbatas.** Claude Code hooks tidak punya akses
   write ke transcript sebelum model dipanggil. Jadi context-strip versi ini hanya
   *pre-check* — kalau turn sebelumnya nolak, kita prepend recovery prompt di turn sekarang.
   Residu tetap ada di transcript, tapi model selalu diberi instruksi untuk mengabaikannya.

2. **Stop hook dengan `decision: block`.** Ini mekanisme resmi Claude Code untuk memaksa
   Claude lanjut. `reason` yang dikirim jadi prompt berikutnya. Ada guard anti-loop:
   `stop_hook_active` flag dari Claude Code + cooldown 8 detik + cap 3x per session.

3. **Watermark** cuma marker kepemilikan lokal (SHA256 dari `"ZennTeam-AI-RedTeamers-SuppresorRefusall-2026"`).
   Bukan watermark di output LLM.

4. **Code fence dilindungi** dari strip — refusal di dalam contoh kode nggak kena hapus.

## License

MIT.
