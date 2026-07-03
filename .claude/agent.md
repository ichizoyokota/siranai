Explore project structure
Perfect! I have all the information needed. Let me create a comprehensive summary.

SIRANAI Project Exploration Report
1. PROJECT OVERVIEW
   SIRANAI (思考・質問・整理 - Think · Ask · Organize) is a desktop writing/thinking assistant application that combines a Markdown editor with AI integration. It's designed for writers, engineers, and knowledge workers to:

Write and organize thoughts in Markdown format
Query multiple AI providers (Gemini, OpenAI, Claude) with selected text
Manage different text encodings (UTF-8, Shift-JIS, EUC-JP, UTF-16)
Search/replace functionality with undo/redo support
2. TECHNOLOGY STACK
   Component	Technology
   Desktop Framework	Wails v2 (Go + React with embedded WebView)
   Backend	Go 1.25
   Frontend	React 18 + TypeScript
   Build Tool	Vite
   Markdown Rendering	marked.js
   Encoding Support	golang.org/x/text (Shift-JIS, EUC-JP, UTF-16 support)
   App Distribution	macOS (DMG with code signing & notarization)
3. KEY PROJECT FILES AND THEIR PURPOSE
   Backend (Go)
   File	Lines	Purpose
   /Users/ichizoyokota/IdeaProjects/siranai/main.go	112	Wails app initialization, menu definition, window config
   /Users/ichizoyokota/IdeaProjects/siranai/app.go	458	Core app logic: file I/O, encoding handling, AI API calls
   /Users/ichizoyokota/IdeaProjects/siranai/go.mod	40	Go dependencies (Wails v2, encoding libraries)
   Key Backend Functions in app.go:

LoadSettings() / SaveSettings() - Persist AI provider configs
OpenFile() / SaveFile() / SaveFileWithEncoding() - File operations
ReopenWithEncoding() - Re-read files with different encodings
QueryAI() - Route queries to Gemini, OpenAI, or Claude APIs
queryGemini(), queryOpenAI(), queryClaude() - Individual API handlers
Encoding detection and conversion functions
Frontend (React/TypeScript)
File	Size	Purpose
/Users/ichizoyokota/IdeaProjects/siranai/frontend/src/App.tsx	~699 lines	Main app component with complete UI and state management
/Users/ichizoyokota/IdeaProjects/siranai/frontend/src/App.css	59 lines	Basic styling
/Users/ichizoyokota/IdeaProjects/siranai/frontend/src/main.tsx	15 lines	React entry point
/Users/ichizoyokota/IdeaProjects/siranai/frontend/src/style.css	-	Global styles
/Users/ichizoyokota/IdeaProjects/siranai/frontend/package.json	-	Dependencies (React, marked, TypeScript, Vite)
/Users/ichizoyokota/IdeaProjects/siranai/frontend/vite.config.ts	8 lines	Vite config with React plugin
Wails/Configuration
File	Purpose
/Users/ichizoyokota/IdeaProjects/siranai/wails.json	Wails v2 configuration (name, version, build commands)
/Users/ichizoyokota/IdeaProjects/siranai/Makefile	Build/signing/notarization targets for macOS distribution
/Users/ichizoyokota/IdeaProjects/siranai/build/darwin/Info.plist	macOS app bundle metadata
Auto-generated Bindings
File	Purpose
/Users/ichizoyokota/IdeaProjects/siranai/frontend/wailsjs/go/main/App.d.ts	TypeScript definitions for Go backend methods
/Users/ichizoyokota/IdeaProjects/siranai/frontend/wailsjs/go/models.ts	TypeScript models for AIProvider and Settings
/Users/ichizoyokota/IdeaProjects/siranai/frontend/wailsjs/runtime/runtime.d.ts	Wails runtime API definitions
4. MENU STRUCTURE
   The application menu is defined in main.go (lines 21-85) using Wails' menu API. Menu events are emitted from Go and handled in React:

SIRANAI Menu (macOS app menu)
About SIRANAI → emits menu:about event
設定... (Settings, Cmd+,) → emits menu:settings
Quit SIRANAI (Cmd+Q) → quits app
File Menu
新規作成 (New, Cmd+N) → menu:new
Open (Cmd+O) → menu:open
Save (Cmd+S) → menu:save
Save As... (Cmd+Shift+S) → menu:saveAs
Edit Menu
Undo (Cmd+Z) → menu:undo
Redo (Cmd+Shift+Z) → menu:redo
Cut → menu:cut
Copy → menu:copy
Paste → menu:paste
Select All → menu:selectAll
Search Menu
Find... (Cmd+F) → menu:find
Find Next (Cmd+G) → menu:findNext
Find & Replace... (Cmd+Option+F) → menu:replace
Frontend Event Listeners
In App.tsx (lines 380-399), all menu events are connected via EventsOn() from Wails runtime:

EventsOn('menu:about',     () => setShowAbout(true)),
EventsOn('menu:new',       () => handleNew()),
EventsOn('menu:open',      () => handleOpen()),
EventsOn('menu:settings',  () => setShowSettings(true)),
EventsOn('menu:save',      () => handleSave()),
EventsOn('menu:saveAs',    () => handleSaveAs()),
EventsOn('menu:undo',      () => doUndo()),
EventsOn('menu:redo',      () => doRedo()),
EventsOn('menu:cut',       () => doCut()),
EventsOn('menu:copy',      () => doCopy()),
EventsOn('menu:paste',     () => doPaste()),
EventsOn('menu:selectAll', () => doSelectAll()),
EventsOn('menu:find',      () => openFind()),
EventsOn('menu:findNext',  () => findNext()),
EventsOn('menu:replace',   () => openReplace()),
5. HOW THE APP IS BUILT
   Framework: Wails v2 (Go + WebView)

Wails combines:

Backend (Go): Native performance for file I/O, encoding, AI API calls
Frontend (React + Vite): Modern UI framework compiled to HTML/CSS/JS
Desktop Integration: Automatic code signing, native menus, file dialogs
Build Process:

wails dev          # Development mode with hot reload
wails build        # Production build for native app
make bundle-libs   # Bundle libmecab library
make sign          # Code sign the app
make dmg           # Create DMG installer
make notarize      # Submit for Apple notarization
Output: /Users/ichizoyokota/IdeaProjects/siranai/build/bin/SIRANAI.app (macOS app bundle)

6. EDITOR & PREVIEW PANE STRUCTURE
   The UI is split into 2 main panels:

Left Panel: Editor
Large textarea for Markdown input
Text selection triggers a popup with AI provider buttons
Real-time character count visible at bottom
Character encoding menu (UTF-8, Shift-JIS, EUC-JP, UTF-16 LE)
Find/Replace bar (appears when Cmd+F is pressed)
Key State Variables:

markdown - current editor content
filePath - path to open file
fileEncoding - current file encoding
undoStack / redoStack - undo/redo history (max 100 items)
Editor Features:

Text selection → shows popup with "AIに聞く" (Ask AI) buttons
Tab key inserts 4 spaces
Supports keyboard shortcuts from menu (Cmd+C, Cmd+V, etc.)
Synced scroll between editor and syntax highlight overlay
Right Panel: Preview/AI
Tab 1: Preview - Markdown rendered as HTML using marked.js
Tab 2: AI - AI response pane with loading/error states
Shows which AI provider responded
Copy button for responses
Displays AI output or error messages
Shows "テキストを選択して「AIに聞く」を押すと結果がここに表示されます" (instructions) when empty
AI Query Flow:

User selects text in editor
Popup appears with enabled AI provider buttons
Click button → handleAIQuery(providerID)
QueryAI(selectedText, question, providerID) sent to Go backend
Backend calls appropriate API (Gemini, OpenAI, or Claude)
Response displayed in AI pane with Markdown rendering
Key State Variables:

viewMode - 'preview' or 'ai'
aiResponse - Response text from AI
aiError - Error message if query failed
aiLoading - Loading state while query in progress
aiProviderName - Name of provider that responded
popup - Selection popup position and text
7. POPUP & AI INTERACTION
   Text Selection Popup (lines 325-345 in App.tsx):

Appears when user selects text and releases mouse
Positioned near cursor, constrained to viewport
Shows buttons for each enabled AI provider
Contains optional "Question" input field
Closes when clicking outside
AI Provider Configuration Modal (lines 447-550):

Checkbox to enable/disable each provider
API Key input field
Model selector dropdown (using PROVIDER_MODELS constant)
Save/Cancel buttons
Settings persisted to ~/Library/Application Support/SIRANAI/settings.json
Available AI Providers:

Provider	Models
Gemini	gemini-2.5-flash, gemini-2.5-pro, gemini-2.5-flash-lite, gemini-2.0-flash, gemini-2.0-flash-lite
OpenAI	gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo, o1, o1-mini
Claude	claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
8. KEY APP CONSTANTS & CONFIGURATION
   const APP_VERSION = '0.1.0';
   const INITIAL_CONTENT = "# Hello SIRANAI\n\nStart typing your markdown here...";
   const MAX_UNDO = 100;

const PROVIDER_MODELS: Record<string, string[]> = {
gemini: ['gemini-2.5-flash', ...],
openai: ['gpt-4o', ...],
claude: ['claude-opus-4-6', ...],
};

type ViewMode = 'preview' | 'ai';
9. IMPORTANT FILE PATHS & DIRECTORIES
   /Users/ichizoyokota/IdeaProjects/siranai/
   ├── main.go                          # Wails entry point & menu definition
   ├── app.go                           # Backend logic (file I/O, AI queries)
   ├── wails.json                       # Wails config
   ├── Makefile                         # Build targets for macOS
   ├── go.mod, go.sum                   # Go dependencies
   ├── frontend/
   │   ├── src/
   │   │   ├── App.tsx                  # Main React component (699 lines)
   │   │   ├── App.css                  # Component styles
   │   │   ├── main.tsx                 # React entry point
   │   │   ├── style.css                # Global styles
   │   │   ├── vite-env.d.ts
   │   │   └── assets/
   │   │       ├── images/appicon.png
   │   │       └── fonts/nunito-v16-latin-regular.woff2
   │   ├── wailsjs/                     # Auto-generated Wails bindings
   │   │   ├── go/main/App.d.ts         # TypeScript definitions for Go methods
   │   │   ├── go/models.ts             # Go struct definitions (AIProvider, Settings)
   │   │   └── runtime/runtime.d.ts     # Wails runtime API
   │   ├── vite.config.ts               # Vite bundler config
   │   ├── tsconfig.json                # TypeScript config
   │   ├── package.json                 # Frontend dependencies
   │   ├── dist/                        # Built frontend (generated)
   │   └── index.html                   # HTML entry point
   ├── build/
   │   ├── darwin/Info.plist            # macOS app metadata
   │   ├── appicon.png
   │   └── bin/SIRANAI.app/             # Compiled app bundle
   └── README.md
   Settings Storage:

~/Library/Application Support/SIRANAI/settings.json - AI provider configs & API keys
10. BACKEND API EXPORTS (Go → React)
    These are the methods available to the React frontend via Wails bindings:

File Operations:

OpenFile() → {path, content, encoding}
SaveFile(path, content) → savedPath
SaveFileWithEncoding(path, content, encoding) → savedPath
ReopenWithEncoding(path, encoding) → {path, content, encoding}
Settings:

LoadSettings() → {providers: AIProvider[]}
SaveSettings(settings) → void
AI Integration:

QueryAI(selectedText, question, providerID) → responseText
11. FRONTEND STATE MANAGEMENT
    No external state management (Redux/Context) is used. All state is local to the App component using React hooks:

const [markdown, setMarkdown]               // Editor content
const [filePath, setFilePath]               // Current file path
const [viewMode, setViewMode]               // 'preview' or 'ai'
const [aiResponse, setAiResponse]           // AI response text
const [aiError, setAiError]                 // Error from AI query
const [aiLoading, setAiLoading]             // Loading state
const [searchText, setSearchText]           // Find/Replace text
const [showSearch, setShowSearch]           // Show find bar
const [popup, setPopup]                     // Selection popup data
const [fileEncoding, setFileEncoding]       // Current file encoding
const [showSettings, setShowSettings]       // Settings modal visibility
const [settingsProviders, setSettingsProviders]  // AI config array
Refs for DOM access:

const textareaRef          // Main editor textarea
const searchInputRef       // Find/Replace input
const popupRef             // Popup container
const overlayRef           // Syntax highlight overlay
const filePathRef, markdownRef    // Keep in sync with state
const undoStack, redoStack        // Undo/redo history
SUMMARY
SIRANAI is a well-architected Wails v2 desktop app with:

Clean separation between Go backend (file I/O, APIs) and React frontend (UI)
Comprehensive menu system with keyboard shortcuts
Dual-pane layout: editor + preview/AI response
Multi-provider AI integration (Gemini, OpenAI, Claude)
Full text encoding support for Japanese documents
macOS-native distribution with code signing
The app is in Phase 1 (editor + file management complete) heading toward Phase 2 (keyword extraction & morphological analysis with mecab library - already referenced in Makefile).