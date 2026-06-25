.PHONY: dev build bundle-libs sign dmg notarize release

# 署名・公証に必要な設定
TEAM_ID       := V888BAN3D8
APPLE_ID      := yokota@yeees.in
SIGN_IDENTITY := Developer ID Application: Ichizo Yokota ($(TEAM_ID))
APP_PATH      := build/bin/SIRANAI.app
DMG_PATH      := build/SIRANAI.dmg

# APPLE_PASSWORD は環境変数で渡す:
#   make release APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx

dev:
	~/go/bin/wails dev

build:
	~/go/bin/wails build

bundle-libs: build
	@echo "==> Bundling libmecab into app..."
	@mkdir -p $(APP_PATH)/Contents/Frameworks
	@cp /opt/homebrew/opt/mecab/lib/libmecab.2.dylib $(APP_PATH)/Contents/Frameworks/
	@chmod 755 $(APP_PATH)/Contents/Frameworks/libmecab.2.dylib
	@install_name_tool -change \
		/opt/homebrew/opt/mecab/lib/libmecab.2.dylib \
		@executable_path/../Frameworks/libmecab.2.dylib \
		$(APP_PATH)/Contents/MacOS/SIRANAI
	@echo "==> libmecab bundled."

sign: bundle-libs
	@echo "==> Signing bundled libraries..."
	@codesign --force --options runtime \
		--sign "$(SIGN_IDENTITY)" \
		--timestamp \
		$(APP_PATH)/Contents/Frameworks/libmecab.2.dylib
	@echo "==> Signing app..."
	@codesign --deep --force --options runtime \
		--sign "$(SIGN_IDENTITY)" \
		--timestamp \
		$(APP_PATH)
	@echo "==> Verifying signature..."
	@codesign --verify --deep --strict --verbose=2 $(APP_PATH)
	@echo "==> Signing done."

dmg: sign
	@echo "==> Creating DMG..."
	@rm -rf /tmp/siranai-dmg
	@mkdir -p /tmp/siranai-dmg
	@cp -R $(APP_PATH) /tmp/siranai-dmg/
	@ln -s /Applications /tmp/siranai-dmg/Applications
	@hdiutil create \
		-volname "SIRANAI" \
		-srcfolder /tmp/siranai-dmg \
		-ov \
		-format UDZO \
		-fs HFS+ \
		$(DMG_PATH)
	@rm -rf /tmp/siranai-dmg
	@echo "==> Signing DMG..."
	@codesign --sign "$(SIGN_IDENTITY)" --timestamp $(DMG_PATH)
	@echo "==> Done: $(DMG_PATH)"

notarize: dmg
	@echo "==> Submitting for notarization (this takes a few minutes)..."
	@xcrun notarytool submit $(DMG_PATH) \
		--apple-id "$(APPLE_ID)" \
		--password "$(APPLE_PASSWORD)" \
		--team-id "$(TEAM_ID)" \
		--wait
	@echo "==> Stapling notarization ticket..."
	@xcrun stapler staple $(DMG_PATH)
	@echo "==> Verifying..."
	@spctl --assess --verbose --type install $(DMG_PATH)
	@echo "==> Notarization complete: $(DMG_PATH)"

release: notarize
	@echo "==> $(DMG_PATH) is ready for distribution."
