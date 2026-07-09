# Windows Build Resources

このディレクトリには、siranai の Windows ビルドに必要なリソースが含まれています。

## ファイル構成

- **icon.ico** - アプリケーションアイコン (EXE と NSISインストーラー用)
- **info.json** - Windows EXE 用のファイル情報 (バージョン、企業名など)
- **wails.exe.manifest** - Windows マニフェストファイル
- **installer/** - NSIS インストーラー設定
  - `project.nsi` - メインインストーラースクリプト
  - `wails_tools.nsh` - Wails生成ツール (自動生成)

## ビルドコマンド

### EXE ビルド

```bash
# AMD64 (64-bit)
wails build -platform windows/amd64

# ARM64 (ARM 64-bit)
wails build -platform windows/arm64
```

### NSISインストーラーの作成

```bash
# AMD64 インストーラー
wails build -platform windows/amd64 -nsis

# ARM64 インストーラー
wails build -platform windows/arm64 -nsis

# 両方
wails build -platform windows/amd64 -nsis
wails build -platform windows/arm64 -nsis
```

## Makefile ターゲット

リポジトリのルートから以下が実行できます：

```bash
make build-windows-amd64      # AMD64 EXE のビルド
make build-windows-arm64      # ARM64 EXE のビルド
make build-windows            # 両方のビルド
make build-windows-nsis       # NSISインストーラー作成
make clean-windows            # Windows 成果物の削除
```

## 出力ファイル

- `build/bin/SIRANAI-amd64.exe` - AMD64 EXE
- `build/bin/SIRANAI-arm64.exe` - ARM64 EXE
- `build/bin/SIRANAI-amd64-installer.exe` - AMD64 インストーラー
- `build/bin/SIRANAI-arm64-installer.exe` - ARM64 インストーラー

## カスタマイズ

### アイコンの変更
新しい `icon.ico` で置き換えてください（256x256 推奨）。

### インストーラーの署名
`installer/project.nsi` のコメント行を有効化してください：
```nsi
!finalize 'signtool sign /f certificate.pfx /p password "%1"'
!uninstfinalize 'signtool sign /f certificate.pfx /p password "%1"'
```

## トラブルシューティング

- NSIS エラー: https://nsis.sourceforge.io/ からインストール
- WebView2 エラー: https://developer.microsoft.com/microsoft-edge/webview2/
- Wails エラー: `wails doctor` で診断

詳細は WINDOWS_BUILD.md を参照してください。
