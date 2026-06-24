# IdeaLiner（アイデアライナー）

執筆・思考整理・AI/Markdownノート管理に特化したデスクトップアプリです。
テキストを打ちながらリアルタイムでキーワードを抽出・強調し、アイデアを構造化・拡張します。

---

## 構想

「文字を打つ、新聞を読む」と入力すると、即座に「文字」「打つ」「新聞」「読む」がハイライトされます。
キーワードをクリックすれば「別章を作成」「関連文書検索」「AIに聞く」などのアクションが実行できます。

エンジニアが AI の Skill ノートや Markdown ドキュメントを効率よく作成・管理することを目指して開発されています。

### コアコンセプト

- **リアルタイム形態素解析** — 入力停止後 300〜500ms（debounce）でキーワードを抽出・ハイライト
- **クリックアクション** — キーワードから章作成・関連文書検索・AIへの質問を一発実行
- **AIとの連携** — Gemini / OpenAI / Claude に対してテキスト選択＋質問を送信
- **ローカルファースト** — データはすべてローカルの Markdown ファイルに保存

---

## 技術スタック

| 領域 | 技術 |
|------|------|
| デスクトップフレームワーク | [Wails v2](https://wails.io/) |
| バックエンド | Go 1.25 |
| フロントエンド | React 18 + TypeScript |
| ビルドツール | Vite |
| Markdown レンダリング | marked |
| エンコーディング処理 | golang.org/x/text（Shift-JIS / EUC-JP / UTF-16 対応） |
| AI プロバイダー | Gemini / OpenAI (GPT-4o) / Claude (Anthropic) |
| 設定ファイル | JSON（`~/Library/Application Support/SIRANAI/settings.json`） |

### 今後の予定

- 日本語形態素解析: [kagome](https://github.com/ikawaha/kagome)
- 全文検索: [Bleve](https://blevesearch.com/)
- グラフビュー（キーワード接続図）
- HTML / PDF エクスポート

---

## ロードマップ

| Phase | 内容 |
|-------|------|
| Phase 0 | Wails プロジェクト構築（完了） |
| Phase 1 | Markdown エディタ + ファイル管理（完了） |
| Phase 2 | リアルタイム形態素解析 + アンダーライン + クリックアクション |
| Phase 3 | Bleve 全文検索 + 大容量処理 |
| Phase 4 | AI 統合強化 + 閲覧モード・エクスポート |
| Phase 5 | Mac 配布準備（署名・Notarization） |

---

## セットアップ

### 必要なもの

- [Go](https://go.dev/) 1.21 以上
- [Node.js](https://nodejs.org/) 18 以上
- [Wails CLI](https://wails.io/docs/gettingstarted/installation)

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

---

## 起動

開発モードで起動します（ホットリロード有効）。

```bash
wails dev
```

ブラウザから Go バックエンドにアクセスする場合は http://localhost:34115 を開いてください。

---

## ビルド

配布用のネイティブアプリをビルドします。

```bash
wails build
```

ビルド成果物は `build/bin/` に出力されます。

---

## AI 設定

アプリ内の設定画面から各 AI プロバイダーの API キーとモデルを登録できます。
API キーはローカルの設定ファイル（`~/Library/Application Support/SIRANAI/settings.json`）にのみ保存されます。

| プロバイダー | デフォルトモデル |
|-------------|----------------|
| Gemini | gemini-2.0-flash |
| OpenAI | gpt-4o |
| Claude | claude-sonnet-4-6 |

---

## ファイル保存形式

- **標準 Markdown（`.md`）** を尊重
- YAML Frontmatter でメタデータ管理（title / created / updated / keywords / tags など）
- Obsidian / Logseq との互換性を維持
