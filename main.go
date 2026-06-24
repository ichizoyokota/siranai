package main

import (
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
	appNameMenu.AddText("About SIRANAI", nil, nil)
	appNameMenu.AddSeparator()
	appNameMenu.AddText("Quit SIRANAI", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(app.ctx)
	})

	// File menu
	fileMenu := appMenu.AddSubmenu("File")
	fileMenu.AddText("Open", keys.CmdOrCtrl("o"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:open")
	})
	fileMenu.AddText("Save", keys.CmdOrCtrl("s"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:save")
	})
	fileMenu.AddText("Save As...", keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:saveAs")
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

	err := wails.Run(&options.App{
		Title:            "SIRANAI",
		Width:            1024,
		Height:           768,
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 255},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarDefault(),
			Appearance:           mac.DefaultAppearance,
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
		OnStartup: app.startup,
		Menu:      appMenu,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
