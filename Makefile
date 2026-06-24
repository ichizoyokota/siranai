.PHONY: dev build dmg

dev:
	~/go/bin/wails dev

build:
	~/go/bin/wails build

dmg: build
	@echo "==> Creating DMG..."
	@rm -rf /tmp/siranai-dmg
	@mkdir -p /tmp/siranai-dmg
	@cp -R build/bin/SIRANAI.app /tmp/siranai-dmg/
	@ln -s /Applications /tmp/siranai-dmg/Applications
	@hdiutil create \
		-volname "SIRANAI" \
		-srcfolder /tmp/siranai-dmg \
		-ov \
		-format UDZO \
		-fs HFS+ \
		build/SIRANAI.dmg
	@rm -rf /tmp/siranai-dmg
	@echo "==> Done: build/SIRANAI.dmg"
