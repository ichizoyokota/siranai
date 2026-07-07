package main

import (
	"context"
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	appMenu := menu.NewMenu()

	// macOS requires the first menu to be the app-name menu
	appNameMenu := appMenu.AddSubmenu("SIRANAI")
	appNameMenu.AddText("About SIRANAI", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:about")
	})
	appNameMenu.AddSeparator()
	appNameMenu.AddText("設定...", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:settings")
	})
	appNameMenu.AddSeparator()
	appNameMenu.AddText("Quit SIRANAI", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(app.ctx)
	})

	// File menu
	fileMenu := appMenu.AddSubmenu("File")
	fileMenu.AddText("新規作成", keys.CmdOrCtrl("n"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:new")
	})
	fileMenu.AddSeparator()
	fileMenu.AddText("Open", keys.CmdOrCtrl("o"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:open")
	})
	fileMenu.AddText("Save", keys.CmdOrCtrl("s"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:save")
	})
	fileMenu.AddText("Save As...", keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:saveAs")
	})
	fileMenu.AddSeparator()
	fileMenu.AddText("Print... (プレビュー)", keys.CmdOrCtrl("p"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:print")
	})
	fileMenu.AddText("Print... (テキスト)", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:printText")
	})

	// Edit menu
	editMenu := appMenu.AddSubmenu("Edit")
	editMenu.AddText("Undo", keys.CmdOrCtrl("z"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:undo")
	})
	editMenu.AddText("Redo", keys.Combo("z", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:redo")
	})
	editMenu.AddSeparator()
	editMenu.AddText("Cut", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:cut")
	})
	editMenu.AddText("Copy", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:copy")
	})
	editMenu.AddText("Paste", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:paste")
	})
	editMenu.AddText("Select All", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:selectAll")
	})

	// Search menu
	searchMenu := appMenu.AddSubmenu("Search")
	searchMenu.AddText("Find...", keys.CmdOrCtrl("f"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:find")
	})
	searchMenu.AddText("Find Next", keys.CmdOrCtrl("g"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:findNext")
	})
	searchMenu.AddText("Find & Replace...", keys.Combo("f", keys.CmdOrCtrlKey, keys.OptionOrAltKey), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:replace")
	})

	// View menu
	viewMenu := appMenu.AddSubmenu("表示")
	viewMenu.AddText("行番号を表示/非表示", keys.Combo("l", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:toggleLineNumbers")
	})
	viewMenu.AddText("プレビューを表示/非表示", keys.Combo("p", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:togglePreview")
	})

	err := wails.Run(&options.App{
		Title:            "SIRANAI",
		Width:            1024,
		Height:           768,
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 255},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarDefault(),
			Appearance:           mac.DefaultAppearance,
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			OnFileOpen: func(filePath string) {
				if app.frontendReady {
					// Frontend is loaded and listening — bring to front and emit directly
					runtime.WindowShow(app.ctx)
					runtime.EventsEmit(app.ctx, "file:open", filePath)
				} else {
					// App just launched via file association; frontend not ready yet.
					// Store the path and let GetPendingFilePath() deliver it on mount.
					app.pendingFilePath = filePath
				}
			},
		},
		OnStartup: app.startup,
		OnBeforeClose: func(ctx context.Context) bool {
			if !app.isDirty {
				return false // allow close
			}
			result, _ := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
				Type:          runtime.QuestionDialog,
				Title:         "未保存の変更があります",
				Message:       "保存されていない変更があります。閉じますか？",
				Buttons:       []string{"閉じる", "キャンセル"},
				DefaultButton: "キャンセル",
				CancelButton:  "キャンセル",
			})
			return result == "キャンセル" // true = prevent close
		},
		Menu: appMenu,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
