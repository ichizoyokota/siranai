# Windows ビルドガイド

siranaiをWindowsアプリケーション（EXE/インストーラー）としてビルドする方法です。

## 必要な環境

### 必須
- **Go 1.20以上** - https://golang.org/dl/
- **wails** - `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

### オプション（インストーラー作成用）
- **NSIS 3.0以上** - https://nsis.sourceforge.io/
- **signtool**（署名用、Windows SDK付属）

## ビルド手順

### 1. 単一バイナリのビルド

#### AMD64（64-bit）
```bash
make build-windows-amd64
# または
wails build -platform windows/amd64
```
出力: `build/bin/SIRANAI-amd64.exe`

#### ARM64（ARM 64-bit）
```bash
make build-windows-arm64
# または
wails build -platform windows/arm64
```
出力: `build/bin/SIRANAI-arm64.exe`

#### 両方をビルド
```bash
make build-windows
```

### 2. NSISインストーラーの作成

NSISがインストール済みの場合：
```bash
make build-windows-nsis
```

手動でビルドする場合：
```bash
wails build -platform windows/amd64 -nsis
wails build -platform windows/arm64 -nsis
```

### 3. クリーンアップ

Windowsビルド成果物を削除：
```bash
make clean-windows
```

## インストーラーのカスタマイズ

インストーラー設定ファイル:
- `build/windows/icon.ico` - アプリケーションアイコン
- `build/windows/info.json` - バージョン情報
- `build/windows/installer/project.nsi` - NSISスクリプト

### インストーラーの署名

（オプション）コード署名証明書を使用してインストーラーに署名：

`build/windows/installer/project.nsi` 内のコメント行を有効化：
```nsi
!uninstfinalize 'signtool sign /f certificate.pfx /p password /t http://timestamp.server.com "%1"'
!finalize 'signtool sign /f certificate.pfx /p password /t http://timestamp.server.com "%1"'
```

## リソース

- [Wails クロスコンパイルドキュメント](https://wails.io/docs/reference/cli/build)
- [NSIS ドキュメント](https://nsis.sourceforge.io/Docs/)
- [Windows アプリケーション開発ベストプラクティス](https://docs.microsoft.com/ja-jp/windows/win32/appdev)

## トラブルシューティング

### WebView2 ランタイムエラー
Windows 11以降は標準で含まれます。Windows 10の場合、インストーラーは自動的にダウンロード・インストールを試みます。

### ビルド失敗
1. Go のインストール確認: `go version`
2. wails のインストール確認: `wails version`
3. `wails doctor` を実行してトラブルシューティング情報を確認

### NSISがない場合
インストーラーなしで単純な EXE ファイルを配布する場合は、NSISは不要です。
