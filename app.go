package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// AIProvider holds settings for one AI provider
type AIProvider struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
	Enabled bool   `json:"enabled"`
}

// Settings holds user-configurable app settings
type Settings struct {
	Providers []AIProvider `json:"providers"`
}

func defaultSettings() Settings {
	return Settings{
		Providers: []AIProvider{
			{ID: "gemini", Name: "Gemini", Model: "gemini-2.5-flash"},
			{ID: "openai", Name: "ChatGPT (OpenAI)", Model: "gpt-4o"},
			{ID: "claude", Name: "Claude (Anthropic)", Model: "claude-sonnet-4-6"},
		},
	}
}

func settingsPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(configDir, "SIRANAI")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return filepath.Join(dir, "settings.json"), nil
}

func logFilePath() string {
	usr, err := user.Current()
	if err != nil {
		return "/tmp/siranai.log"
	}
	logDir := filepath.Join(usr.HomeDir, "Library", "Logs", "SIRANAI")
	os.MkdirAll(logDir, 0700)
	return filepath.Join(logDir, "app.log")
}

func logMessage(msg string) {
	logFile, err := os.OpenFile(logFilePath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return
	}
	defer logFile.Close()
	logger := log.New(logFile, "", log.LstdFlags)
	logger.Println(msg)
}

// LoadSettings reads settings from disk
func (a *App) LoadSettings() Settings {
	path, err := settingsPath()
	if err != nil {
		return defaultSettings()
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return defaultSettings()
	}
	var s Settings
	if err := json.Unmarshal(data, &s); err != nil {
		return defaultSettings()
	}
	// Migration from old single-provider format
	if len(s.Providers) == 0 {
		var old struct {
			GeminiAPIKey string `json:"geminiApiKey"`
			GeminiModel  string `json:"geminiModel"`
		}
		d := defaultSettings()
		if json.Unmarshal(data, &old) == nil && old.GeminiAPIKey != "" {
			for i, p := range d.Providers {
				if p.ID == "gemini" {
					d.Providers[i].APIKey = old.GeminiAPIKey
					if old.GeminiModel != "" {
						d.Providers[i].Model = old.GeminiModel
					}
					d.Providers[i].Enabled = true
				}
			}
		}
		return d
	}
	return s
}

// SaveSettings writes settings to disk
func (a *App) SaveSettings(s Settings) error {
	path, err := settingsPath()
	if err != nil {
		return err
	}
	for i := range s.Providers {
		s.Providers[i].APIKey = strings.TrimSpace(s.Providers[i].APIKey)
		s.Providers[i].Model = strings.TrimSpace(s.Providers[i].Model)
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// ---- AI provider API calls ----

func doPost(url string, headers map[string]string, body []byte) (map[string]any, error) {
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func queryGemini(apiKey, model, prompt string) (string, error) {
	if model == "" {
		model = "gemini-2.0-flash"
	}
	body, _ := json.Marshal(map[string]any{
		"contents": []map[string]any{
			{"parts": []map[string]any{{"text": prompt}}},
		},
	})
	result, err := doPost(
		"https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",
		map[string]string{"x-goog-api-key": apiKey},
		body,
	)
	if err != nil {
		return "", err
	}
	if errObj, ok := result["error"].(map[string]any); ok {
		return "", fmt.Errorf("Gemini API error: %v", errObj["message"])
	}
	candidates, _ := result["candidates"].([]any)
	if len(candidates) == 0 {
		return "", fmt.Errorf("AIから応答がありませんでした")
	}
	content, _ := candidates[0].(map[string]any)["content"].(map[string]any)
	parts, _ := content["parts"].([]any)
	if len(parts) == 0 {
		return "", fmt.Errorf("応答の形式が不正です")
	}
	text, _ := parts[0].(map[string]any)["text"].(string)
	return text, nil
}

func queryOpenAI(apiKey, model, prompt string) (string, error) {
	if model == "" {
		model = "gpt-4o"
	}
	body, _ := json.Marshal(map[string]any{
		"model":    model,
		"messages": []map[string]any{{"role": "user", "content": prompt}},
	})
	result, err := doPost(
		"https://api.openai.com/v1/chat/completions",
		map[string]string{"Authorization": "Bearer " + apiKey},
		body,
	)
	if err != nil {
		return "", err
	}
	if errObj, ok := result["error"].(map[string]any); ok {
		return "", fmt.Errorf("OpenAI API error: %v", errObj["message"])
	}
	choices, _ := result["choices"].([]any)
	if len(choices) == 0 {
		return "", fmt.Errorf("AIから応答がありませんでした")
	}
	msg, _ := choices[0].(map[string]any)["message"].(map[string]any)
	text, _ := msg["content"].(string)
	return text, nil
}

func queryClaude(apiKey, model, prompt string) (string, error) {
	if model == "" {
		model = "claude-sonnet-4-6"
	}
	body, _ := json.Marshal(map[string]any{
		"model":      model,
		"max_tokens": 4096,
		"messages":   []map[string]any{{"role": "user", "content": prompt}},
	})
	result, err := doPost(
		"https://api.anthropic.com/v1/messages",
		map[string]string{
			"x-api-key":         apiKey,
			"anthropic-version": "2023-06-01",
		},
		body,
	)
	if err != nil {
		return "", err
	}
	if errObj, ok := result["error"].(map[string]any); ok {
		return "", fmt.Errorf("Claude API error: %v", errObj["message"])
	}
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		return "", fmt.Errorf("AIから応答がありませんでした")
	}
	text, _ := content[0].(map[string]any)["text"].(string)
	return text, nil
}

// QueryAI sends selectedText and question to the specified AI provider
func (a *App) QueryAI(selectedText, question, providerID string) (string, error) {
	s := a.LoadSettings()

	prompt := selectedText
	if question != "" {
		prompt = fmt.Sprintf("以下のテキストについて質問があります。\n\nテキスト:\n%s\n\n質問:\n%s", selectedText, question)
	}

	for _, p := range s.Providers {
		if p.ID != providerID {
			continue
		}
		if p.APIKey == "" {
			return "", fmt.Errorf("%s のAPIキーが設定されていません。設定画面から登録してください。", p.Name)
		}
		switch p.ID {
		case "gemini":
			return queryGemini(strings.TrimSpace(p.APIKey), p.Model, prompt)
		case "openai":
			return queryOpenAI(strings.TrimSpace(p.APIKey), p.Model, prompt)
		case "claude":
			return queryClaude(strings.TrimSpace(p.APIKey), p.Model, prompt)
		}
	}
	return "", fmt.Errorf("プロバイダー '%s' が見つかりません", providerID)
}

// App struct
type App struct {
	ctx             context.Context
	pendingFilePath string
	frontendReady   bool
	isDirty         bool
}

// SetDirty is called by the frontend to report unsaved-change state.
func (a *App) SetDirty(dirty bool) {
	a.isDirty = dirty
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// pendingFilePath is fetched by the frontend via GetPendingFilePath() on mount

	// Handle file drops from Finder/OS onto the app window.
	// The frontend decides open-vs-insert based on the Shift key it tracks.
	runtime.OnFileDrop(ctx, func(x, y int, paths []string) {
		if len(paths) == 0 {
			return
		}
		runtime.EventsEmit(ctx, "file:drop", paths)
	})
}

// GetPendingFilePath marks the frontend as ready and returns any file path
// queued before the frontend finished loading (e.g. Finder double-click at launch).
func (a *App) GetPendingFilePath() string {
	a.frontendReady = true
	path := a.pendingFilePath
	a.pendingFilePath = ""
	if path != "" {
		runtime.WindowShow(a.ctx)
	}
	return path
}

// readFileChecked reads a file with binary and size checks.
// If the file is binary, returns {"isBinary":"true"}.
// If the file exceeds maxFileSize, returns {"isTooLarge":"true"}.
// Otherwise returns the decoded content.
func readFileChecked(path string) (map[string]string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	// Check binary by reading only first 8 KB
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	checkBuf := make([]byte, 8192)
	n, _ := f.Read(checkBuf)
	f.Close()
	if isBinaryContent(checkBuf[:n]) {
		return map[string]string{"isBinary": "true"}, nil
	}

	// Hard limit: refuse files over maxFileSize
	if info.Size() > int64(maxFileSize) {
		return map[string]string{"isTooLarge": "true"}, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	encoding := detectEncoding(data)
	content, err := decodeBytes(data, encoding)
	if err != nil {
		content = string(data)
		encoding = "UTF-8"
	}
	return map[string]string{"path": path, "content": content, "encoding": encoding}, nil
}

// OpenFileByPath opens a file at the given path and returns its content
func (a *App) OpenFileByPath(path string) (map[string]string, error) {
	return readFileChecked(path)
}

// LogMessage records a message from frontend to the log file
func (a *App) LogMessage(msg string) error {
	logMessage(fmt.Sprintf("[Frontend] %s", msg))
	return nil
}

// ForceOpenFileByPath opens a file ignoring the large-file size limit.
// Reads in 4 MB chunks and emits "file:loadprogress" events (0-100) to the frontend.
func (a *App) ForceOpenFileByPath(path string) (map[string]string, error) {
	// Binary check on first 8 KB
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	checkBuf := make([]byte, 8192)
	n, _ := f.Read(checkBuf)
	f.Close()
	if isBinaryContent(checkBuf[:n]) {
		return map[string]string{"isBinary": "true"}, nil
	}

	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	totalSize := info.Size()

	f, err = os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	const chunkSize = 4 * 1024 * 1024 // 4 MB
	data := make([]byte, 0, totalSize)
	chunk := make([]byte, chunkSize)
	var readBytes int64
	lastPct := -1
	for {
		nr, rerr := f.Read(chunk)
		if nr > 0 {
			data = append(data, chunk[:nr]...)
			readBytes += int64(nr)
			// チャンク読み込みは 0〜70% に割り当て
			pct := int(readBytes * 70 / totalSize)
			if pct != lastPct {
				lastPct = pct
				runtime.EventsEmit(a.ctx, "file:loadprogress", pct)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return nil, rerr
		}
	}

	// デコード中: 70〜95%
	runtime.EventsEmit(a.ctx, "file:loadprogress", 70)
	encoding := detectEncoding(data)
	content, err := decodeBytes(data, encoding)
	if err != nil {
		content = string(data)
		encoding = "UTF-8"
	}
	runtime.EventsEmit(a.ctx, "file:loadprogress", 95)
	// 100% は Promise 解決後に JS 側で fileLoadProgress を null にセットして閉じる
	return map[string]string{"path": path, "content": content, "encoding": encoding}, nil
}

const maxFileSize = 100 * 1024 * 1024 // 100 MB → hard limit

// isBinaryContent returns true if the data appears to be binary (contains null bytes).
func isBinaryContent(data []byte) bool {
	check := data
	if len(check) > 8192 {
		check = check[:8192]
	}
	for _, b := range check {
		if b == 0x00 {
			return true
		}
	}
	return false
}

// ---- Encoding helpers ----

// detectEncoding guesses the file encoding from raw bytes.
func detectEncoding(data []byte) string {
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		return "UTF-8 BOM"
	}
	if len(data) >= 2 && data[0] == 0xFF && data[1] == 0xFE {
		return "UTF-16 LE"
	}
	if len(data) >= 2 && data[0] == 0xFE && data[1] == 0xFF {
		return "UTF-16 BE"
	}
	if utf8.Valid(data) {
		return "UTF-8"
	}
	return "Shift-JIS"
}

// normalizeLineEndings converts CRLF and CR to LF.
func normalizeLineEndings(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return s
}

// decodeBytes converts raw bytes to a UTF-8 string using the given encoding.
func decodeBytes(data []byte, encoding string) (string, error) {
	key := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(encoding, " ", ""), "_", "-"))
	switch key {
	case "shift-jis", "sjis", "cp932", "windows-31j":
		dec := japanese.ShiftJIS.NewDecoder()
		result, _, err := transform.Bytes(dec, data)
		if err != nil {
			return "", err
		}
		return normalizeLineEndings(string(result)), nil
	case "euc-jp", "eucjp":
		dec := japanese.EUCJP.NewDecoder()
		result, _, err := transform.Bytes(dec, data)
		if err != nil {
			return "", err
		}
		return normalizeLineEndings(string(result)), nil
	case "utf-16le":
		dec := unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder()
		result, _, err := transform.Bytes(dec, data)
		if err != nil {
			return "", err
		}
		return normalizeLineEndings(string(result)), nil
	case "utf-16be":
		dec := unicode.UTF16(unicode.BigEndian, unicode.IgnoreBOM).NewDecoder()
		result, _, err := transform.Bytes(dec, data)
		if err != nil {
			return "", err
		}
		return normalizeLineEndings(string(result)), nil
	default: // UTF-8, UTF-8 BOM
		s := string(data)
		if strings.HasPrefix(s, "\xEF\xBB\xBF") {
			s = s[3:]
		}
		return normalizeLineEndings(s), nil
	}
}

// encodeString converts a UTF-8 string to bytes in the given encoding.
func encodeString(text, encoding string) ([]byte, error) {
	key := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(encoding, " ", ""), "_", "-"))
	switch key {
	case "shift-jis", "sjis", "cp932", "windows-31j":
		text = strings.ReplaceAll(text, "\n", "\r\n") // Windows line endings
		enc := japanese.ShiftJIS.NewEncoder()
		result, _, err := transform.Bytes(enc, []byte(text))
		return result, err
	case "euc-jp", "eucjp":
		enc := japanese.EUCJP.NewEncoder()
		result, _, err := transform.Bytes(enc, []byte(text))
		return result, err
	case "utf-8bom":
		return append([]byte{0xEF, 0xBB, 0xBF}, []byte(text)...), nil
	default: // UTF-8
		return []byte(text), nil
	}
}

// ReopenWithEncoding re-reads an already opened file with a different encoding.
func (a *App) ReopenWithEncoding(path, encoding string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	content, err := decodeBytes(data, encoding)
	if err != nil {
		return nil, fmt.Errorf("デコードエラー (%s): %v", encoding, err)
	}
	return map[string]string{"path": path, "content": content, "encoding": encoding}, nil
}

// SaveFileWithEncoding saves content using the specified encoding.
func (a *App) SaveFileWithEncoding(path, content, encoding string) (string, error) {
	if path == "" {
		var err error
		path, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			Title:           "Save File",
			DefaultFilename: "untitled.md",
			Filters: []runtime.FileFilter{
				{DisplayName: "Markdown (*.md)", Pattern: "*.md"},
				{DisplayName: "Text (*.txt)", Pattern: "*.txt"},
				{DisplayName: "CSV (*.csv)", Pattern: "*.csv"},
				{DisplayName: "HTML (*.html)", Pattern: "*.html"},
				{DisplayName: "JSON (*.json)", Pattern: "*.json"},
				{DisplayName: "All Files", Pattern: "*"},
			},
		})
		if err != nil || path == "" {
			return "", err
		}
	}
	data, err := encodeString(content, encoding)
	if err != nil {
		return "", fmt.Errorf("エンコードエラー (%s): %v", encoding, err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", err
	}
	return path, nil
}

// OpenFile opens a file dialog and returns the file path and its contents
func (a *App) OpenFile() (map[string]string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open File",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown (*.md)", Pattern: "*.md"},
			{DisplayName: "Text (*.txt)", Pattern: "*.txt"},
			{DisplayName: "HTML (*.html)", Pattern: "*.html"},
			{DisplayName: "CSV (*.csv)", Pattern: "*.csv"},
			{DisplayName: "JSON (*.json)", Pattern: "*.json"},
			{DisplayName: "All Files", Pattern: "*"},
		},
	})
	if err != nil || path == "" {
		return nil, err
	}
	return readFileChecked(path)
}

// SaveFile saves content to the given path, or opens a save dialog if path is empty
func (a *App) SaveFile(path string, content string) (string, error) {
	fmt.Printf("[DEBUG SaveFile] INPUT: path=%q (len=%d, empty=%v), content_len=%d\n", path, len(path), path == "", len(content))
	if path == "" {
		fmt.Printf("[DEBUG SaveFile] path is empty, opening SaveFileDialog\n")
		var err error
		path, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			Title:           "Save File",
			DefaultFilename: "untitled.md",
			Filters: []runtime.FileFilter{
				{DisplayName: "Markdown (*.md)", Pattern: "*.md"},
				{DisplayName: "Text (*.txt)", Pattern: "*.txt"},
				{DisplayName: "HTML (*.html)", Pattern: "*.html"},
				{DisplayName: "CSV (*.csv)", Pattern: "*.csv"},
				{DisplayName: "JSON (*.json)", Pattern: "*.json"},
			},
		})
		if err != nil || path == "" {
			return "", err
		}
	}
	fmt.Printf("[DEBUG SaveFile] Writing to: %q\n", path)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return "", err
	}
	fmt.Printf("[DEBUG SaveFile] Success: %q\n", path)
	return path, nil
}

// Step 10: OpenNewWindow opens the app with the given file
func (a *App) OpenNewWindow(filePath string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}

	// Find the .app bundle path (exe is .app/Contents/MacOS/SIRANAI)
	appBundle := filepath.Dir(filepath.Dir(filepath.Dir(exe)))

	// Use 'open' command on macOS with -n flag to create a new window
	var cmd *exec.Cmd
	if filePath != "" {
		cmd = exec.Command("open", "-n", appBundle, "--args", filePath)
	} else {
		cmd = exec.Command("open", "-n", appBundle)
	}

	return cmd.Run()
}

// Step 10: ConfirmCloseTab shows a confirmation dialog for unsaved changes
func (a *App) ConfirmCloseTab(displayName string, isDirty bool) (bool, error) {
	if !isDirty {
		return true, nil
	}

	result, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         "Unsaved Changes",
		Message:       fmt.Sprintf(`"%s" has unsaved changes. Close anyway?`, displayName),
		Buttons:       []string{"Cancel", "Close"},
		DefaultButton: "Cancel",
	})

	return result == "Close", err
}
