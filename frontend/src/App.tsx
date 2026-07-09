import {useEffect, useMemo, useRef, useState} from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import appIcon from './assets/images/appicon.png';
import {marked} from 'marked';
marked.setOptions({ gfm: true, breaks: false });
import {ConfirmCloseTab, GetDisplayName, GetPendingFilePath, LoadSettings, LogMessage, OpenFile, OpenFileByPath, OpenNewWindow, PrintHTML, PrintText, QueryAI, ReopenWithEncoding, SaveFile, SaveFileWithEncoding, SaveSettings, SetDirty} from '../wailsjs/go/main/App';
import {ClipboardGetText, ClipboardSetText, EventsOn, WindowSetTitle} from '../wailsjs/runtime/runtime';
import './App.css';

type ViewMode = 'preview' | 'ai';
type ColorTheme = 'default' | 'dark' | 'gruvbox';

const FONT_FAMILIES = [
    { label: 'Monospace', value: 'monospace' },
    { label: 'Menlo', value: 'Menlo, monospace' },
    { label: 'Monaco', value: 'Monaco, monospace' },
    { label: 'Courier New', value: '"Courier New", monospace' },
    { label: 'SF Mono', value: '"SF Mono", monospace' },
    { label: 'Fira Code', value: '"Fira Code", monospace' },
    { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
];

const THEMES: Record<ColorTheme, Record<string, string>> = {
    default: {
        '--top-bar-bg': '#f3f4f6', '--top-bar-border': '#e5e7eb', '--top-bar-color': '#9ca3af',
        '--line-num-bg': '#f9fafb', '--line-num-border': '#e5e7eb', '--line-num-color': '#9ca3af',
        '--editor-bg': '#ffffff', '--editor-text': '#111827',
        '--tab-bar-bg': '#fafafa', '--tab-bar-border': '#eee',
        '--status-bg': '#e5e7eb', '--status-border': '#d1d5db', '--status-color': '#6b7280',
        '--encoding-bg': '#f3f4f6', '--encoding-border': '#e5e7eb',
        '--resize-bg': '#e5e7eb', '--resize-border': '#d1d5db',
        '--search-bg': '#fffbe6', '--search-border': '#d1d5db',
        '--modal-bg': '#ffffff', '--modal-text': '#111827', '--modal-border': '#e5e7eb',
        '--modal-secondary': '#f9fafb', '--modal-secondary-text': '#555555',
        '--input-bg': '#ffffff', '--input-border': '#d1d5db', '--input-text': '#374151',
    },
    dark: {
        '--top-bar-bg': '#252526', '--top-bar-border': '#3c3c3c', '--top-bar-color': '#9d9d9d',
        '--line-num-bg': '#1e1e1e', '--line-num-border': '#3c3c3c', '--line-num-color': '#858585',
        '--editor-bg': '#1e1e1e', '--editor-text': '#d4d4d4',
        '--tab-bar-bg': '#2d2d2d', '--tab-bar-border': '#3c3c3c',
        '--status-bg': '#007acc', '--status-border': '#005f9e', '--status-color': '#ffffff',
        '--encoding-bg': '#252526', '--encoding-border': '#3c3c3c',
        '--resize-bg': '#3c3c3c', '--resize-border': '#3c3c3c',
        '--search-bg': '#2d2d2d', '--search-border': '#4c4c4c',
        '--modal-bg': '#2d2d2d', '--modal-text': '#d4d4d4', '--modal-border': '#4c4c4c',
        '--modal-secondary': '#252526', '--modal-secondary-text': '#9d9d9d',
        '--input-bg': '#3c3c3c', '--input-border': '#5a5a5a', '--input-text': '#d4d4d4',
    },
    gruvbox: {
        '--top-bar-bg': '#3c3836', '--top-bar-border': '#504945', '--top-bar-color': '#a89984',
        '--line-num-bg': '#282828', '--line-num-border': '#504945', '--line-num-color': '#928374',
        '--editor-bg': '#282828', '--editor-text': '#ebdbb2',
        '--tab-bar-bg': '#32302f', '--tab-bar-border': '#504945',
        '--status-bg': '#504945', '--status-border': '#3c3836', '--status-color': '#bdae93',
        '--encoding-bg': '#3c3836', '--encoding-border': '#504945',
        '--resize-bg': '#504945', '--resize-border': '#504945',
        '--search-bg': '#3c3836', '--search-border': '#665c54',
        '--modal-bg': '#32302f', '--modal-text': '#ebdbb2', '--modal-border': '#665c54',
        '--modal-secondary': '#282828', '--modal-secondary-text': '#a89984',
        '--input-bg': '#3c3836', '--input-border': '#665c54', '--input-text': '#ebdbb2',
    },
};

interface AIProviderConfig {
    id: string;
    name: string;
    apiKey: string;
    model: string;
    enabled: boolean;
}

const APP_VERSION = '0.1.5';

const PROVIDER_MODELS: Record<string, string[]> = {
    gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini'],
    claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
};

const DEFAULT_PROVIDERS: AIProviderConfig[] = [
    { id: 'gemini', name: 'Gemini', apiKey: '', model: 'gemini-2.5-flash', enabled: false },
    { id: 'openai', name: 'ChatGPT (OpenAI)', apiKey: '', model: 'gpt-4o', enabled: false },
    { id: 'claude', name: 'Claude (Anthropic)', apiKey: '', model: 'claude-sonnet-4-6', enabled: false },
];

const INITIAL_CONTENT = "# Hello SIRANAI\n\nStart typing your markdown here...";
// Preview rendering limit: avoid marked() freezing on large files
const PREVIEW_CHAR_LIMIT = 100_000;

// Apply theme vars immediately (before first render) to avoid flash
{
    const saved = (localStorage.getItem('siranai-theme') as ColorTheme) ?? 'default';
    const vars = THEMES[saved] ?? THEMES.default;
    Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
}

// Step 1: Tab State Interface & Helper Functions
interface TabState {
    id: string;
    filePath: string;
    displayName: string;
    content: string;
    fileEncoding: string;
    isDirty: boolean;
    cursorLine: number;
    charCount: number;
    sectionCount: number;
}

function makeTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getNextUntitledNumber(currentTabs: TabState[]): number {
    let maxNum = 0;
    currentTabs.forEach(tab => {
        if (tab.displayName.match(/^Untitled(\s\d+)?$/)) {
            if (tab.displayName === 'Untitled') {
                maxNum = Math.max(maxNum, 1);
            } else {
                const match = tab.displayName.match(/^Untitled (\d+)$/);
                if (match) {
                    maxNum = Math.max(maxNum, parseInt(match[1]));
                }
            }
        }
    });
    return maxNum + 1;
}

function getDisplayName(tabs: TabState[], filePath: string): string {
    if (filePath) {
        return filePath.split('/').pop() || 'File';
    }
    const nextNum = getNextUntitledNumber(tabs);
    return nextNum === 1 ? 'Untitled' : `Untitled ${nextNum}`;
}

function makeInitialTab(existingTabs?: TabState[]): TabState {
    const displayName = getDisplayName(existingTabs || [], '');
    return {
        id: makeTabId(),
        filePath: '',
        displayName,
        content: INITIAL_CONTENT,
        fileEncoding: 'UTF-8',
        isDirty: false,
        cursorLine: 1,
        charCount: INITIAL_CONTENT.length,
        sectionCount: 1,
    };
}

function toMonacoTheme(colorTheme: ColorTheme): string {
    if (colorTheme === 'dark') return 'vs-dark';
    if (colorTheme === 'gruvbox') return 'gruvbox-dark';
    return 'vs';
}

function App() {
    // Step 1: Tab state
    const [tabs, setTabs] = useState<TabState[]>([makeInitialTab()]);
    const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
    
    // For maintaining backward compatibility with existing code
    const [markdown, setMarkdown] = useState(INITIAL_CONTENT);
    const [filePath, setFilePath] = useState("");
    const [displayPath, setDisplayPath] = useState<string | null>(null);

    const [viewMode, setViewMode] = useState<ViewMode>('preview');

    // AI
    const [aiResponse, setAiResponse] = useState('');
    const [aiError, setAiError] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiProviderName, setAiProviderName] = useState('');
    const [aiHighlight, setAiHighlight] = useState<{ start: number; end: number } | null>(null);
    const [popup, setPopup] = useState<{ x: number; y: number; text: string } | null>(null);
    const [popupQuestion, setPopupQuestion] = useState('');
    const [aiSelectedText, setAiSelectedText] = useState('');
    const [aiQuestion, setAiQuestion] = useState('');
    const [aiProviderId, setAiProviderId] = useState('');
    const [aiHistory, setAiHistory] = useState<{providerName: string; response: string; error: string; selectedText: string; question: string}[]>([]);

    // Right pane resize
    const [rightPaneWidth, setRightPaneWidth] = useState<number | null>(null);

    // Encoding
    const [fileEncoding, setFileEncoding] = useState('UTF-8');
    const [showEncodingMenu, setShowEncodingMenu] = useState(false);

    // About modal
    const [showAbout, setShowAbout] = useState(false);

    // File warning dialog (binary / too large file)
    type FileWarningState = { type: 'binary' } | { type: 'tooLarge' };
    const [fileWarning, setFileWarning] = useState<FileWarningState | null>(null);

    // Settings modal
    const [showSettings, setShowSettings] = useState(false);
    const [settingsProviders, setSettingsProviders] = useState<AIProviderConfig[]>(DEFAULT_PROVIDERS);

    // View options
    const [showLineNumbers, setShowLineNumbers] = useState(true);
    const [showPreview, setShowPreview] = useState(true);

    // Status bar
    const [cursorLine, setCursorLine] = useState(1);
    const [charCount, setCharCount] = useState(INITIAL_CONTENT.length);
    const [sectionCount, setSectionCount] = useState(1);
    const [isDragOver, setIsDragOver] = useState(false);
    const [shiftDuringDrag, setShiftDuringDrag] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    // Editor appearance
    const [colorTheme, setColorTheme] = useState<ColorTheme>(() => (localStorage.getItem('siranai-theme') as ColorTheme) ?? 'default');
    const [fontSize, setFontSize] = useState<number>(() => parseInt(localStorage.getItem('siranai-fontsize') ?? '16'));
    const [fontFamily, setFontFamily] = useState<string>(() => localStorage.getItem('siranai-fontfamily') ?? 'monospace');

    // Table insert dialog
    const [showTableDialog, setShowTableDialog] = useState(false);
    const [tableRows, setTableRows] = useState(3);
    const [tableCols, setTableCols] = useState(3);

    // Settings tab
    const [settingsTab, setSettingsTab] = useState<'ai' | 'editor'>('ai');

    const filePathRef = useRef(filePath);
    const shiftPressedRef = useRef(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const replaceTextRef = useRef<HTMLInputElement>(null);
    const popupQuestionRef = useRef<HTMLInputElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const isSelectingRef = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const isDraggingRef2 = useRef(false);
    const aiResponseAreaRef = useRef<HTMLDivElement>(null);
    const dragStartXRef = useRef(0);
    const dragStartWidthRef = useRef(0);

    // Monaco refs
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);
    const decorationIdsRef = useRef<string[]>([]);
    const previewRef = useRef<HTMLDivElement>(null);
    const previewUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Step 1: Tab refs
    const tabModelsRef = useRef<Map<string, Monaco.editor.ITextModel>>(new Map());
    const activeTabIdRef = useRef<string>(activeTabId);
    const tabDragDataRef = useRef<{ tabId: string } | null>(null);
    const newTabIdRef = useRef<string | null>(null);

    useEffect(() => { filePathRef.current = filePath; }, [filePath]);
    useEffect(() => { void SetDirty(isDirty); }, [isDirty]);
    useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);
    
    // When a new tab ID is pending, switch to it
    useEffect(() => {
        if (newTabIdRef.current) {
            setActiveTabId(newTabIdRef.current);
            newTabIdRef.current = null;
        }
    }, [tabs]);
    
    // Step 2-3: When active tab changes, switch Monaco model and update state
    useEffect(() => {
        const editor = editorRef.current;
        const M = monacoRef.current;
        const activeTab = tabs.find(t => t.id === activeTabId);
        
        if (!activeTab || !editor || !M) return;
        
        // Ensure model exists
        if (!tabModelsRef.current.has(activeTab.id)) {
            const model = M.editor.createModel(activeTab.content, 'markdown');
            tabModelsRef.current.set(activeTab.id, model);
        }
        
        // Switch to this tab's model
        const model = tabModelsRef.current.get(activeTab.id);
        if (model) {
            editor.setModel(model);
            editor.focus();
        }
        
        // Update state variables for display
        setFilePath(activeTab.filePath);
        setFileEncoding(activeTab.fileEncoding);
        setMarkdown(activeTab.content.length > PREVIEW_CHAR_LIMIT
            ? activeTab.content.substring(0, PREVIEW_CHAR_LIMIT)
            : activeTab.content);
        setCharCount(activeTab.charCount);
        setSectionCount(activeTab.sectionCount);
        setCursorLine(activeTab.cursorLine);
        setIsDirty(activeTab.isDirty);
    }, [activeTabId, tabs]);
    // Apply color theme CSS variables to document root
    useEffect(() => {
        localStorage.setItem('siranai-theme', colorTheme);
        const vars = THEMES[colorTheme];
        Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    }, [colorTheme]);
    useEffect(() => { localStorage.setItem('siranai-fontsize', String(fontSize)); }, [fontSize]);
    useEffect(() => { localStorage.setItem('siranai-fontfamily', fontFamily); }, [fontFamily]);

    // Auto-scroll AI response area to bottom when response updates
    useEffect(() => {
        const el = aiResponseAreaRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [aiResponse, aiHistory.length]);

    // Sync colorTheme changes to Monaco
    useEffect(() => {
        monacoRef.current?.editor.setTheme(toMonacoTheme(colorTheme));
    }, [colorTheme]);

    // AI highlight decorations
    useEffect(() => {
        const editor = editorRef.current;
        const M = monacoRef.current;
        if (!editor || !M) return;
        const model = editor.getModel();
        if (!model) return;
        if (!aiHighlight) {
            decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
            return;
        }
        const startPos = model.getPositionAt(aiHighlight.start);
        const endPos = model.getPositionAt(aiHighlight.end);
        decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, [{
            range: new M.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
            options: { inlineClassName: 'ai-highlight-decoration' },
        }]);
    }, [aiHighlight]);

    // Load settings on mount
    useEffect(() => {
        LoadSettings().then(s => {
            if (s?.providers && s.providers.length > 0) {
                setSettingsProviders(s.providers as AIProviderConfig[]);
            }
        });
        // Open file passed at launch via Finder double-click
        GetPendingFilePath().then(path => {
            if (path) handleOpenPath(path);
        });
    }, []);

    const previewHtml = useMemo(() => marked(markdown) as string, [markdown]); // markdown is already limited to PREVIEW_CHAR_LIMIT
    useEffect(() => {
        if (!filePath) {
            setDisplayPath(null);
            WindowSetTitle('SIRANAI');
            return;
        }
        GetDisplayName(filePath).then(name => {
            setDisplayPath(name || null);
            WindowSetTitle(name ? `SIRANAI — ${name}` : 'SIRANAI');
        });
    }, [filePath]);

    // Called by Monaco onDidChangeModelContent — debounces expensive preview/section updates
    function getActiveTab(): TabState | undefined {
        return tabs.find(t => t.id === activeTabId);
    }

    function switchToTab(tabId: string) {
        setActiveTabId(tabId);
        // Model switching will happen in useEffect (lines 263-280)
    }

    function closeTab(tabId: string) {
        // Check if this is the last tab
        if (tabs.length === 1) {
            // Last tab — create new tab instead
            handleNew();
            return;
        }
        
        const tabToClose = tabs.find(t => t.id === tabId);
        if (!tabToClose) return;
        
        console.log(`closeTab: tabId=${tabId}, isDirty=${tabToClose.isDirty}, displayName=${tabToClose.displayName}`);
        
        if (tabToClose.isDirty) {
            const confirmed = window.confirm(`"${tabToClose.displayName || 'Untitled'}" has unsaved changes. Close anyway?`);
            if (!confirmed) return;
        }
        
        // Destroy model
        const model = tabModelsRef.current.get(tabId);
        if (model) {
            model.dispose();
            tabModelsRef.current.delete(tabId);
        }
        
        // Remove from tabs list and switch if needed
        setTabs(prev => {
            const newTabs = prev.filter(t => t.id !== tabId);
            console.log(`setTabs: removed ${tabId}, remaining tabs: ${newTabs.length}`);
            
            // If no tabs left, create new one
            if (newTabs.length === 0) {
                const newTab = makeInitialTab();
                const M = monacoRef.current;
                if (M) {
                    const model = M.editor.createModel(newTab.content, 'markdown');
                    tabModelsRef.current.set(newTab.id, model);
                }
                newTabIdRef.current = newTab.id;
                return [newTab];
            }
            
            // If the closed tab was active, switch to another tab
            if (activeTabId === tabId) {
                const nextTab = newTabs[0];
                console.log(`activeTab was closed, switching to: ${nextTab?.id}`);
                if (nextTab) {
                    newTabIdRef.current = nextTab.id;
                }
            }
            
            return newTabs;
        });
    }

    function schedulePreviewUpdate() {
        if (previewUpdateTimer.current) clearTimeout(previewUpdateTimer.current);
        previewUpdateTimer.current = setTimeout(() => {
            const editor = editorRef.current;
            if (!editor) return;
            const val = editor.getValue();
            setMarkdown(val.length > PREVIEW_CHAR_LIMIT ? val.substring(0, PREVIEW_CHAR_LIMIT) : val);
            const lines = editor.getModel()?.getLinesContent() ?? [];
            setSectionCount(lines.filter(l => /^#{1,6}\s/.test(l)).length);
        }, 300);
    }

    function doUndo() { editorRef.current?.trigger('keyboard', 'undo', null); }
    function doRedo() { editorRef.current?.trigger('keyboard', 'redo', null); }

    function handleNew() {
        // Use functional update to get the latest tabs
        let newTabId = '';
        
        setTabs(prev => {
            const newTab = makeInitialTab(prev);
            newTabId = newTab.id;
            newTabIdRef.current = newTabId;
            
            // Create model first
            const M = monacoRef.current;
            if (M) {
                const model = M.editor.createModel(newTab.content, 'markdown');
                tabModelsRef.current.set(newTab.id, model);
            }
            
            return [...prev, newTab];
        });
    }

    function applyFileResult(result: { path: string; content: string; encoding: string }) {
        editorRef.current?.setValue(result.content);
        // Limit preview content to prevent marked() freeze on large files
        setMarkdown(result.content.length > PREVIEW_CHAR_LIMIT
            ? result.content.substring(0, PREVIEW_CHAR_LIMIT)
            : result.content);
        setCharCount(result.content.length);
        setSectionCount(result.content.split('\n').filter(l => /^#{1,6}\s/.test(l)).length);
        setFilePath(result.path);
        setFileEncoding(result.encoding ?? 'UTF-8');
        setIsDirty(false);
    }

    function applyFileResultToTab(tabId: string, result: { path: string; content: string; encoding: string }) {
        // For file tabs, displayName should be just the filename
        const displayName = result.path.split('/').pop() || 'File';
        const updatedTabs = tabs.map(t => {
            if (t.id === tabId) {
                return {
                    ...t,
                    filePath: result.path,
                    content: result.content,
                    fileEncoding: result.encoding ?? 'UTF-8',
                    isDirty: false,
                    displayName,
                    charCount: result.content.length,
                    sectionCount: result.content.split('\n').filter(l => /^#{1,6}\s/.test(l)).length,
                };
            }
            return t;
        });
        setTabs(updatedTabs);
        
        // Update Monaco model
        const model = tabModelsRef.current.get(tabId);
        if (model) {
            model.setValue(result.content);
        }
        
        // Update current view if this is the active tab
        if (tabId === activeTabId) {
            setMarkdown(result.content.length > PREVIEW_CHAR_LIMIT
                ? result.content.substring(0, PREVIEW_CHAR_LIMIT)
                : result.content);
            setCharCount(result.content.length);
            setSectionCount(result.content.split('\n').filter(l => /^#{1,6}\s/.test(l)).length);
            setFilePath(result.path);
            setFileEncoding(result.encoding ?? 'UTF-8');
            setIsDirty(false);
        }
    }


    async function handleOpen() {
        const result = await OpenFile();
        if (!result) return;
        if (result.isBinary === 'true') { setFileWarning({ type: 'binary' }); return; }
        if (result.isTooLarge === 'true') { setFileWarning({ type: 'tooLarge' }); return; }
        
        // Always open in new tab
        const tabId = makeTabId();
        const displayName = result.path.split('/').pop() || 'File';
        const newTab: TabState = {
            id: tabId,
            filePath: result.path,
            displayName,
            content: result.content,
            fileEncoding: result.encoding ?? 'UTF-8',
            isDirty: false,
            cursorLine: 1,
            charCount: result.content.length,
            sectionCount: result.content.split('\n').filter(l => /^#{1,6}\s/.test(l)).length,
        };
        
        // Create model
        const M = monacoRef.current;
        if (M) {
            const model = M.editor.createModel(result.content, 'markdown');
            tabModelsRef.current.set(tabId, model);
        }
        
        // Add tab and switch, removing empty Untitled if present
        newTabIdRef.current = tabId;
        setTabs(prev => {
            // Remove empty Untitled tab if it exists and no files are open
            let updatedTabs = prev;
            if (prev.length === 1) {
                const lastTab = prev[0];
                if (!lastTab.filePath && (lastTab.displayName === 'Untitled' || lastTab.displayName.match(/^Untitled \d+$/))) {
                    // Remove the empty Untitled tab
                    const model = tabModelsRef.current.get(lastTab.id);
                    if (model) {
                        model.dispose();
                        tabModelsRef.current.delete(lastTab.id);
                    }
                    updatedTabs = [];
                }
            }
            return [...updatedTabs, newTab];
        });
    }

    async function handleSave() {
        // Use ref to get current activeTabId, then find in current tabs state
        const currentActiveTabId = activeTabIdRef.current;
        
        // Use functional update to get latest tabs
        let targetTab: TabState | undefined;
        setTabs(prev => {
            targetTab = prev.find(t => t.id === currentActiveTabId);
            return prev; // No change yet
        });
        
        if (!targetTab) {
            alert('No active tab found');
            return;
        }
        
        // If no filePath or empty string, use SaveAs instead
        if (!targetTab.filePath || targetTab.filePath.trim() === '') {
            await handleSaveAs();
            return;
        }
        
        const content = editorRef.current?.getValue() ?? '';
        const enc = targetTab.fileEncoding === 'UTF-8' ? '' : targetTab.fileEncoding;
        
        const savedPath = enc
            ? await SaveFileWithEncoding(targetTab.filePath, content, enc)
            : await SaveFile(targetTab.filePath, content);
        
        if (savedPath) {
            const displayName = savedPath.split('/').pop() || 'File';
            setTabs(prev => prev.map(t => {
                if (t.id === currentActiveTabId) {
                    return { ...t, filePath: savedPath, isDirty: false, displayName };
                }
                return t;
            }));
            setFilePath(savedPath);
            setIsDirty(false);
        }
    }

    async function handleSaveAs() {
        const currentActiveTabId = activeTabIdRef.current;
        
        let targetTab: TabState | undefined;
        setTabs(prev => {
            targetTab = prev.find(t => t.id === currentActiveTabId);
            return prev;
        });
        
        if (!targetTab) return;
        
        const content = editorRef.current?.getValue() ?? '';
        const enc = targetTab.fileEncoding === 'UTF-8' ? '' : targetTab.fileEncoding;
        const savedPath = enc
            ? await SaveFileWithEncoding('', content, enc)
            : await SaveFile('', content);
        
        if (savedPath) {
            const displayName = savedPath.split('/').pop() || 'File';
            setTabs(prev => prev.map(t => {
                if (t.id === currentActiveTabId) {
                    return { ...t, filePath: savedPath, isDirty: false, displayName };
                }
                return t;
            }));
            setFilePath(savedPath);
            setIsDirty(false);
        }
    }

    function insertPathAtCursor(path: string) {
        const editor = editorRef.current;
        const M = monacoRef.current;
        if (editor && M) {
            const sel = editor.getSelection();
            const pos = sel?.getStartPosition() ?? { lineNumber: 1, column: 1 };
            const range = sel ?? new M.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
            editor.executeEdits('insertPath', [{ range, text: path }]);
        }
    }

     async function handleOpenPath(path: string) {
         try {
             let result;
             try {
                 result = await OpenFileByPath(path);
             } catch (err: any) {
                 return;
             }
            
             if (!result) {
                 return;
             }
             if (result.isBinary === 'true') {
                 setFileWarning({ type: 'binary' });
                 return;
             }
             if (result.isTooLarge === 'true') {
                 setFileWarning({ type: 'tooLarge' });
                 return;
             }
            
             // Always open in new tab
             const tabId = makeTabId();
             const displayName = result.path.split('/').pop() || 'File';
            
             // Validate content is a string
             if (typeof result.content !== 'string') {
                 return;
             }
            
             const newTab: TabState = {
                 id: tabId,
                 filePath: result.path,
                 displayName,
                 content: result.content,
                 fileEncoding: result.encoding ?? 'UTF-8',
                 isDirty: false,
                 cursorLine: 1,
                 charCount: result.content.length,
                 sectionCount: result.content.split('\n').filter(l => /^#{1,6}\s/.test(l)).length,
             };
            
             // Create model
             const M = monacoRef.current;
             if (M) {
                 try {
                     const model = M.editor.createModel(result.content, 'markdown');
                     tabModelsRef.current.set(tabId, model);
                 } catch (modelErr: any) {
                     throw modelErr;
                 }
             }
            
             // Add tab and switch, removing empty Untitled if present
             newTabIdRef.current = tabId;
             setTabs(prev => {
                 // Remove empty Untitled tab if it exists and no files are open
                 let updatedTabs = prev;
                 if (prev.length === 1) {
                     const lastTab = prev[0];
                     if (!lastTab.filePath && (lastTab.displayName === 'Untitled' || lastTab.displayName.match(/^Untitled \d+$/))) {
                         // Remove the empty Untitled tab
                         const model = tabModelsRef.current.get(lastTab.id);
                         if (model) {
                             model.dispose();
                             tabModelsRef.current.delete(lastTab.id);
                         }
                         updatedTabs = [];
                     }
                 }
                 return [...updatedTabs, newTab];
             });
         } catch (err: any) {
             // Silent fail - handled by state
         }
     }

    async function handleReopenWithEncoding(encoding: string) {
        setShowEncodingMenu(false);
        const activeTab = getActiveTab();
        
        if (!activeTab || !activeTab.filePath) {
            // Unsaved file — only change encoding
            setFileEncoding(encoding);
            return;
        }
        
        try {
            const result = await ReopenWithEncoding(activeTab.filePath, encoding);
            if (result) {
                editorRef.current?.setValue(result.content);
                
                const updatedTabs = tabs.map(t => {
                    if (t.id === activeTab.id) {
                        return {
                            ...t,
                            content: result.content,
                            fileEncoding: result.encoding ?? encoding,
                            charCount: result.content.length,
                            sectionCount: result.content.split('\n').filter(l => /^#{1,6}\s/.test(l)).length,
                        };
                    }
                    return t;
                });
                setTabs(updatedTabs);
                
                setMarkdown(result.content.length > PREVIEW_CHAR_LIMIT
                    ? result.content.substring(0, PREVIEW_CHAR_LIMIT)
                    : result.content);
                setCharCount(result.content.length);
                setSectionCount(result.content.split('\n').filter(l => /^#{1,6}\s/.test(l)).length);
                setFileEncoding(result.encoding ?? encoding);
            }
        } catch (err: any) {
            alert(`再読み込みエラー: ${err?.message ?? err}`);
        }
    }

    // Returns the focused input/textarea that is NOT the Monaco editor, or null
    function activeInput(): HTMLInputElement | HTMLTextAreaElement | null {
        const el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.closest('.monaco-editor')) {
            return el as HTMLInputElement | HTMLTextAreaElement;
        }
        return null;
    }

    async function doCopy() {
        copyingRef.current = true;  // Signal that we're copying
        
        // Active non-editor input - handle custom copy
        const inp = activeInput();
        if (inp) {
            const text = inp.value.substring(inp.selectionStart ?? 0, inp.selectionEnd ?? 0);
            if (text) {
                try {
                    await navigator.clipboard.writeText(text);
                } catch {
                    await ClipboardSetText(text);
                }
            }
            return;
        }
        
        // For Monaco editor, manually handle copy
        const editor = editorRef.current;
        if (editor) {
            const selection = editor.getSelection();
            if (selection && !selection.isEmpty()) {
                const text = editor.getModel()?.getValueInRange(selection) ?? '';
                if (text) {
                    try {
                        await navigator.clipboard.writeText(text);
                    } catch (err) {
                        // Fallback to Wails clipboard
                        try {
                            await ClipboardSetText(text);
                        } catch (err2) {
                            console.error('Copy failed:', err, err2);
                        }
                    }
                }
            }
            return;
        }
        
        // Selection in any other element (e.g. AI pane)
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) {
            try {
                await navigator.clipboard.writeText(sel.toString());
            } catch {
                await ClipboardSetText(sel.toString());
            }
        }
    }

    async function doCut() {
        const inp = activeInput();
        if (inp) {
            const start = inp.selectionStart ?? 0;
            const end = inp.selectionEnd ?? 0;
            const selected = inp.value.substring(start, end);
            if (!selected) return;
            try {
                await navigator.clipboard.writeText(selected);
            } catch {
                await ClipboardSetText(selected);
            }
            document.execCommand('delete');
            return;
        }
        
        // For Monaco editor, manually handle cut
        const editor = editorRef.current;
        if (editor) {
            const selection = editor.getSelection();
            if (selection && !selection.isEmpty()) {
                const text = editor.getModel()?.getValueInRange(selection) ?? '';
                if (text) {
                    try {
                        await navigator.clipboard.writeText(text);
                    } catch {
                        await ClipboardSetText(text);
                    }
                    editor.executeEdits('cut', [{ range: selection, text: '' }]);
                }
            }
        }
    }

    async function doPaste() {
        console.log('[doPaste] Called');
        
        const inp = activeInput();
        if (inp) {
            console.log('[doPaste] Active input detected');
            // Use Wails API only to avoid permission dialogs
            const text = await ClipboardGetText();
            console.log('[doPaste] Input got text from Wails:', text.substring(0, 50));
            if (!text) return;
            inp.focus();
            // Use value manipulation instead of execCommand to avoid browser prompts
            const start = inp.selectionStart ?? 0;
            const end = inp.selectionEnd ?? 0;
            inp.value = inp.value.substring(0, start) + text + inp.value.substring(end);
            inp.selectionStart = inp.selectionEnd = start + text.length;
            // Trigger React's onChange
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[doPaste] Input paste completed');
            return;
        }
        
        // For Monaco editor, manually handle paste
        const editor = editorRef.current;
        if (editor) {
            console.log('[doPaste] Monaco editor detected');
            // Use Wails API only to avoid permission dialogs
            const text = await ClipboardGetText();
            console.log('[doPaste] Monaco got text from Wails:', text.substring(0, 50));
            if (text) {
                const selection = editor.getSelection();
                if (selection) {
                    editor.executeEdits('paste', [{ range: selection, text }]);
                    console.log('[doPaste] Monaco paste completed');
                }
            }
        }
    }

    function doSelectAll() {
        const inp = activeInput();
        if (inp) { inp.select(); return; }
        editorRef.current?.trigger('keyboard', 'editor.action.selectAll', null);
    }

    // Right-pane resize drag
    useEffect(() => {
        function onMouseMove(e: MouseEvent) {
            if (!isDraggingRef2.current) return;
            const delta = dragStartXRef.current - e.clientX;
            const containerW = containerRef.current?.clientWidth ?? 800;
            const newW = Math.max(200, Math.min(dragStartWidthRef.current + delta, containerW - 200));
            setRightPaneWidth(newW);
        }
        function onMouseUp() {
            isDraggingRef2.current = false;
            document.body.style.cursor = '';
            (document.body.style as any).userSelect = '';
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    function startResize(e: React.MouseEvent) {
        e.preventDefault();
        isDraggingRef2.current = true;
        dragStartXRef.current = e.clientX;
        const containerW = containerRef.current?.clientWidth ?? 800;
        dragStartWidthRef.current = rightPaneWidth ?? Math.round(containerW / 2);
        document.body.style.cursor = 'col-resize';
        (document.body.style as any).userSelect = 'none';
    }

    // Search / Replace - use Monaco's built-in find/replace via trigger()
    function openFind() {
        editorRef.current?.trigger('keyboard', 'editor.action.find', null);
    }
    function openReplace() {
        editorRef.current?.trigger('keyboard', 'editor.action.replace', null);
    }
    function closeSearch() { 
        editorRef.current?.trigger('keyboard', 'closeFindWidget', null);
        editorRef.current?.focus(); 
    }

    // Close popup / encoding menu on click outside
    useEffect(() => {
        function onMouseDown(e: MouseEvent) {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                setPopup(null);
                setAiHighlight(null);
            }
            const encMenu = document.getElementById('encoding-menu');
            const encBtn = document.getElementById('encoding-btn');
            if (encMenu && !encMenu.contains(e.target as Node) && e.target !== encBtn) {
                setShowEncodingMenu(false);
            }
        }
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, []);

    // Text selection → AI popup (Monaco API)
    // Skip popup if user is copying (Cmd+C pressed within 200ms of mouseup)
    const copyingRef = useRef(false);
    useEffect(() => {
        function onDocMouseUp(e: MouseEvent) {
            if (!isSelectingRef.current) return;
            isSelectingRef.current = false;
            
            // Wait a bit to see if user is copying
            setTimeout(() => {
                if (copyingRef.current) {
                    copyingRef.current = false;
                    return;
                }
                
                const editor = editorRef.current;
                if (!editor) return;
                const sel = editor.getSelection();
                if (!sel || sel.isEmpty()) { setPopup(null); setAiHighlight(null); return; }
                const model = editor.getModel();
                if (!model) return;
                const selectedText = model.getValueInRange(sel).trim();
                if (!selectedText) { setPopup(null); setAiHighlight(null); return; }
                const start = model.getOffsetAt(sel.getStartPosition());
                const end = model.getOffsetAt(sel.getEndPosition());
                setAiHighlight({ start, end });
                const POPUP_W = 290;
                const x = Math.min(Math.max(e.clientX, 8), window.innerWidth - POPUP_W - 8);
                const y = Math.max(Math.min(e.clientY - 48, window.innerHeight - 58), 8);
                setPopup({ x, y, text: selectedText });
                setPopupQuestion('');
            }, 100);
        }
        document.addEventListener('mouseup', onDocMouseUp);
        return () => document.removeEventListener('mouseup', onDocMouseUp);
    }, []);

    function pushToHistory(providerName: string, response: string, error: string) {
        if (response || error) {
            setAiHistory(prev => [{ providerName, response, error, selectedText: aiSelectedText, question: aiQuestion }, ...prev]);
        }
    }

    // AI query (new selection — clears history)
    async function handleAIQuery(providerID: string) {
        if (!popup) return;
        const { text } = popup;
        const question = popupQuestion;
        const provider = settingsProviders.find(p => p.id === providerID);
        setPopup(null);
        setAiHistory([]);
        setAiLoading(true);
        setViewMode('ai');
        setAiResponse('');
        setAiError('');
        setAiProviderName(provider?.name ?? providerID);
        setAiSelectedText(text);
        setAiQuestion(question);
        setAiProviderId(providerID);
        try {
            const result = await QueryAI(text, question, providerID);
            setAiResponse(result);
        } catch (err: any) {
            setAiError(`エラー: ${err?.message ?? err}`);
        } finally {
            setAiLoading(false);
        }
    }

    // Re-submit (same selection — keeps history)
    async function handleResubmitAI(providerID: string) {
        const provider = settingsProviders.find(p => p.id === providerID);
        pushToHistory(aiProviderName, aiResponse, aiError);
        setAiLoading(true);
        setAiResponse('');
        setAiError('');
        setAiProviderName(provider?.name ?? providerID);
        setAiProviderId(providerID);
        try {
            const result = await QueryAI(aiSelectedText, aiQuestion, providerID);
            setAiResponse(result);
        } catch (err: any) {
            setAiError(`エラー: ${err?.message ?? err}`);
        } finally {
            setAiLoading(false);
        }
    }

    // Settings save
    async function handleSaveSettings() {
        await SaveSettings({ providers: settingsProviders } as any);
        setShowSettings(false);
    }

    function updateProvider(index: number, field: keyof AIProviderConfig, value: string | boolean) {
        setSettingsProviders(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
    }

    function handlePrintText() {
        void PrintText(editorRef.current?.getValue() ?? '');
    }

    function handlePrint() {
        const html = marked(editorRef.current?.getValue() ?? '') as string;
        const title = filePathRef.current ? filePathRef.current.split('/').pop() || 'SIRANAI' : 'SIRANAI';
        const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
            body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6;color:#111;}
            table{border-collapse:collapse;width:100%;margin:1em 0;}
            th,td{border:1px solid #d1d5db;padding:6px 12px;text-align:left;}
            th{background:#f9fafb;font-weight:600;}
            pre{background:#f9fafb;padding:12px;border-radius:4px;overflow:auto;}
            code{font-family:monospace;font-size:0.9em;}
            blockquote{border-left:4px solid #e5e7eb;margin:0;padding-left:16px;color:#6b7280;}
            h1,h2,h3{line-height:1.3;}img{max-width:100%;}
        </style></head><body>${html}</body></html>`;
        void PrintHTML(fullHtml);
    }

    // Menu events
    useEffect(() => {
        const offs = [
            EventsOn('menu:about',             () => setShowAbout(true)),
            EventsOn('menu:new',               () => handleNew()),
            EventsOn('menu:open',              () => handleOpen()),
            EventsOn('menu:settings',          () => setShowSettings(true)),
            EventsOn('menu:save',              () => handleSave()),
            EventsOn('menu:saveAs',            () => handleSaveAs()),
            EventsOn('menu:undo',              () => doUndo()),
            EventsOn('menu:redo',              () => doRedo()),
            EventsOn('menu:cut',               () => doCut()),
            EventsOn('menu:copy',              () => doCopy()),
            EventsOn('menu:paste',             () => doPaste()),
            EventsOn('menu:selectAll',         () => doSelectAll()),
            EventsOn('menu:find',              () => openFind()),
            EventsOn('menu:findNext',          () => editorRef.current?.trigger('keyboard', 'editor.action.nextMatchFindAction', null)),
            EventsOn('menu:replace',           () => openReplace()),
            EventsOn('menu:print',             () => handlePrint()),
            EventsOn('menu:printText',         () => handlePrintText()),
            EventsOn('menu:toggleLineNumbers', () => setShowLineNumbers(v => !v)),
            EventsOn('menu:togglePreview',     () => setShowPreview(v => !v)),
            EventsOn('file:open',              (path: string) => handleOpenPath(path)),
            EventsOn('file:drop',              (paths: string[]) => {
                setIsDragOver(false);
                if (!paths || paths.length === 0) {
                    return;
                }
                try {
                    if (shiftPressedRef.current) {
                        insertPathAtCursor(paths[0]);
                    } else {
                        void handleOpenPath(paths[0]);
                    }
                } catch (error) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    void LogMessage(`[file:drop] Exception: ${errMsg}`);
                }
            }),
        ];

        // Track Shift key for drag-and-drop mode (insert path vs open file)
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Shift') { shiftPressedRef.current = true; setShiftDuringDrag(true); }
        }
        function onKeyUp(e: KeyboardEvent) {
            if (e.key === 'Shift') { shiftPressedRef.current = false; setShiftDuringDrag(false); }
        }

        // Show overlay while OS file is dragged over the window
        function onDragEnter(e: DragEvent) {
            if (e.dataTransfer?.types.includes('Files') || e.dataTransfer?.types.includes('public.file-url')) {
                setIsDragOver(true);
            }
        }
        function onDragLeave(e: DragEvent) {
            if (!e.relatedTarget) setIsDragOver(false);
        }
        function onDragOver(e: DragEvent) {
            e.preventDefault();
            if (e.shiftKey !== shiftPressedRef.current) {
                shiftPressedRef.current = e.shiftKey;
                setShiftDuringDrag(e.shiftKey);
            }
        }
        function onDrop(e: DragEvent) { e.preventDefault(); setIsDragOver(false); }

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        document.addEventListener('dragenter', onDragEnter);
        document.addEventListener('dragleave', onDragLeave);
        document.addEventListener('dragover', onDragOver);
        document.addEventListener('drop', onDrop);

        return () => {
            offs.forEach(off => off());
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
            document.removeEventListener('dragenter', onDragEnter);
            document.removeEventListener('dragleave', onDragLeave);
            document.removeEventListener('dragover', onDragOver);
            document.removeEventListener('drop', onDrop);
        };
    }, []);

    function insertTable(rows: number, cols: number) {
        const editor = editorRef.current;
        const M = monacoRef.current;
        const headers = Array.from({ length: cols }, (_, i) => `見出し${i + 1}`);
        const header = '| ' + headers.join(' | ') + ' |';
        const sep = '|' + Array(cols).fill(' --- ').join('|') + '|';
        const emptyRow = '|' + Array(cols).fill('     ').join('|') + '|';
        const table = [header, sep, ...Array(rows - 1).fill(emptyRow)].join('\n');
        if (editor && M) {
            const sel = editor.getSelection();
            const pos = sel?.getStartPosition() ?? { lineNumber: 1, column: 1 };
            const lineContent = editor.getModel()?.getLineContent(pos.lineNumber) ?? '';
            const prefix = lineContent.trim() ? '\n' : '';
            const range = sel ?? new M.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
            editor.executeEdits('insertTable', [{ range, text: prefix + table + '\n' }]);
        }
        setShowTableDialog(false);
    }

    const handleEditorMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Step 2: Create initial tab model
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab && !tabModelsRef.current.has(activeTab.id)) {
            const model = monaco.editor.createModel(activeTab.content, 'markdown');
            tabModelsRef.current.set(activeTab.id, model);
            editor.setModel(model);
        }

        // Gruvbox custom theme definition
        monaco.editor.defineTheme('gruvbox-dark', {
            base: 'vs-dark', inherit: true,
            rules: [
                { token: '', foreground: 'ebdbb2', background: '282828' },
            ],
            colors: {
                'editor.background': '#282828', 'editor.foreground': '#ebdbb2',
                'editorLineNumber.foreground': '#928374',
                'editor.selectionBackground': '#504945',
                'editor.lineHighlightBackground': '#3c3836',
            },
        });
        monaco.editor.setTheme(toMonacoTheme(colorTheme));

        // Disable Monaco's built-in drag-and-drop to allow Wails file:drop event
        const editorDom = editor.getDomNode();
        if (editorDom) {
            editorDom.addEventListener('dragover', (e: DragEvent) => {
                e.preventDefault();
                e.stopPropagation();
            });
            editorDom.addEventListener('drop', (e: DragEvent) => {
                e.preventDefault();
                e.stopPropagation();
            });
        }

        // Scroll sync: editor → preview pane
        editor.onDidScrollChange(e => {
            const layoutInfo = editor.getLayoutInfo();
            const maxScroll = e.scrollHeight - layoutInfo.height;
            const ratio = maxScroll > 0 ? e.scrollTop / maxScroll : 0;
            const pane = previewRef.current;
            if (pane) pane.scrollTop = ratio * (pane.scrollHeight - pane.clientHeight);
        });

        // Cursor line tracking
        editor.onDidChangeCursorPosition(e => setCursorLine(e.position.lineNumber));

        // Step 2: Content change - update active tab state (debounced)
        editor.onDidChangeModelContent(() => {
            setIsDirty(true);
            setAiHighlight(null);
            const len = editor.getModel()?.getValueLength() ?? 0;
            setCharCount(len);
            
            // Update active tab's content from editor model
            const tabId = activeTabIdRef.current;
            const model = editor.getModel();
            const content = model?.getValue() ?? '';
            
            setTabs(prev => prev.map(t => {
                if (t.id === tabId) {
                    return { 
                        ...t, 
                        isDirty: true,
                        content: content,  // Keep tab content in sync with model
                        charCount: content.length,
                    };
                }
                return t;
            }));
            
            schedulePreviewUpdate();
        });

        // AI popup: detect selection start
        editor.onMouseDown(() => { isSelectingRef.current = true; });

        // Cmd+C/V/X → Custom clipboard handlers
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => doCopy());
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => doPaste());
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => doCut());

        // Cmd+F → custom search panel (suppress Monaco built-in Find)
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => openFind());
        // Cmd+H → custom replace panel (suppress Monaco built-in Replace)
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => openReplace());
        
        // Disable Monaco's built-in find/replace commands to avoid conflicts
        // These bind to the same keybindings by default
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {});

        // Tab → 4 spaces
        editor.addCommand(monaco.KeyCode.Tab, () => {
            editor.trigger('keyboard', 'type', { text: '    ' });
        });

        // Enter → Markdown list continuation
        editor.addCommand(monaco.KeyCode.Enter, () => {
            const model = editor.getModel();
            const position = editor.getPosition();
            if (!model || !position) { editor.trigger('keyboard', 'type', { text: '\n' }); return; }
            const lineNum = position.lineNumber;
            const currentLine = model.getLineContent(lineNum);
            let m: RegExpMatchArray | null;

            m = currentLine.match(/^(\s*[-*+] )(.*)/);
            if (m) {
                if (!m[2].trim()) {
                    editor.executeEdits('enter', [{ range: new monaco.Range(lineNum, 1, lineNum, m[1].length + 1), text: '' }]);
                } else {
                    editor.trigger('keyboard', 'type', { text: '\n' + m[1] });
                }
                return;
            }
            m = currentLine.match(/^(\s*)(\d+)([.)]) (.*)/);
            if (m) {
                if (!m[4].trim()) {
                    editor.executeEdits('enter', [{ range: new monaco.Range(lineNum, 1, lineNum, m[1].length + m[2].length + m[3].length + 2), text: '' }]);
                } else {
                    editor.trigger('keyboard', 'type', { text: '\n' + m[1] + (parseInt(m[2]) + 1) + m[3] + ' ' });
                }
                return;
            }
            m = currentLine.match(/^(> ?)(.*)/);
            if (m) {
                if (!m[2].trim()) {
                    editor.executeEdits('enter', [{ range: new monaco.Range(lineNum, 1, lineNum, m[1].length + 1), text: '' }]);
                } else {
                    editor.trigger('keyboard', 'type', { text: '\n' + m[1] });
                }
                return;
            }
            m = currentLine.match(/^(#{1,6} )(.*)/);
            if (m && m[2]) { editor.trigger('keyboard', 'type', { text: '\n' + m[1] }); return; }

            editor.trigger('keyboard', 'type', { text: '\n' });
        });

        // Cmd+D → duplicate line down
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
            editor.trigger('keyboard', 'editor.action.copyLinesDownAction', null);
        });
        // Shift+Cmd+D → delete line
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD, () => {
            editor.trigger('keyboard', 'editor.action.deleteLines', null);
        });
    };

    const tabStyle = (mode: ViewMode) => ({
        flex: 1, padding: '4px', border: 'none',
        borderBottom: viewMode === mode ? '2px solid #2563eb' : '2px solid transparent',
        background: 'none', cursor: 'pointer', color: 'var(--editor-text)',
        fontWeight: viewMode === mode ? 'bold' : 'normal',
    } as React.CSSProperties);

    return (
        <div id="App" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--editor-bg)', color: 'var(--editor-text)' }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); }}
        >

            {/* File drag-over overlay */}
            {isDragOver && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(37,99,235,0.15)', border: '3px dashed #2563eb', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <div style={{ background: '#fff', borderRadius: '12px', padding: '24px 40px', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
                        <div style={{ fontSize: '32px', marginBottom: '8px' }}>📂</div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1d4ed8' }}>
                            {shiftDuringDrag ? 'パスを挿入' : 'ファイルを開く'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                            {shiftDuringDrag ? 'カーソル位置にパスが挿入されます' : 'Shift+ドロップでパスを挿入'}
                        </div>
                    </div>
                </div>
            )}

            {/* Table insert dialog */}
            {showTableDialog && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseDown={() => setShowTableDialog(false)}>
                    <div style={{ background: 'var(--modal-bg)', color: 'var(--modal-text)', borderRadius: '8px', padding: '24px', width: '280px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid var(--modal-border)' }}
                        onMouseDown={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 16px', fontSize: '15px', color: 'var(--modal-text)' }}>テーブルを挿入</h3>
                        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--modal-secondary-text)', marginBottom: '4px' }}>行数（ヘッダ含む）</label>
                                <input type="number" min={2} max={20} value={tableRows}
                                    onChange={e => setTableRows(Math.max(2, Math.min(20, parseInt(e.target.value) || 2)))}
                                    style={{ width: '100%', padding: '5px 8px', fontSize: '14px', border: '1px solid var(--input-border)', borderRadius: '4px', boxSizing: 'border-box', background: 'var(--input-bg)', color: 'var(--input-text)' }} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--modal-secondary-text)', marginBottom: '4px' }}>列数</label>
                                <input type="number" min={1} max={10} value={tableCols}
                                    onChange={e => setTableCols(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                                    style={{ width: '100%', padding: '5px 8px', fontSize: '14px', border: '1px solid var(--input-border)', borderRadius: '4px', boxSizing: 'border-box', background: 'var(--input-bg)', color: 'var(--input-text)' }} />
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button onClick={() => setShowTableDialog(false)} style={{ background: 'var(--input-bg)', color: 'var(--modal-text)', border: '1px solid var(--input-border)', padding: '5px 14px', borderRadius: '4px', cursor: 'pointer' }}>キャンセル</button>
                            <button onClick={() => insertTable(tableRows, tableCols)} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer' }}>挿入</button>
                        </div>
                    </div>
                </div>
            )}

            {/* File warning modal (binary / too large file) */}
            {fileWarning && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseDown={() => setFileWarning(null)}>
                    <div style={{ background: 'var(--modal-bg)', color: 'var(--modal-text)', borderRadius: '8px', padding: '24px 32px', width: '340px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid var(--modal-border)' }}
                        onMouseDown={e => e.stopPropagation()}>
                        {fileWarning.type === 'binary' ? (
                            <>
                                <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>バイナリファイル</h3>
                                <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--modal-secondary-text)', lineHeight: 1.5 }}>
                                    このファイルはバイナリ形式のため、テキストエディタで開くことができません。
                                </p>
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <button onClick={() => setFileWarning(null)} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 20px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>OK</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>ファイルが大きすぎます</h3>
                                <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--modal-secondary-text)', lineHeight: 1.5 }}>
                                    このファイルは100MBを超えているため開けません。<br />このアプリで開けるのは100MBまでです。
                                </p>
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <button onClick={() => setFileWarning(null)} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 20px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>OK</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* About modal */}
            {showAbout && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseDown={() => setShowAbout(false)}>
                    <div style={{ background: 'var(--modal-bg)', color: 'var(--modal-text)', borderRadius: '12px', padding: '32px 40px', width: '320px', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid var(--modal-border)' }}
                        onMouseDown={e => e.stopPropagation()}>
                        <div style={{ width: '80px', height: '80px', borderRadius: '18px', backgroundImage: `url(${appIcon})`, backgroundSize: 'cover', backgroundPosition: 'center', margin: '0 auto 16px' }} />
                        <h2 style={{ margin: '0 0 4px', fontSize: '22px' }}>SIRANAI</h2>
                        <p style={{ margin: '0 0 4px', color: 'var(--modal-secondary-text)', fontSize: '13px' }}>Think · Ask · Organize</p>
                        <p style={{ margin: '0 0 20px', color: 'var(--modal-secondary-text)', fontSize: '12px' }}>Version {APP_VERSION}</p>
                        <p style={{ margin: '0 0 4px', color: 'var(--modal-secondary-text)', fontSize: '11px' }}>© 2025 Yeees.in</p>
                        <p style={{ margin: '0 0 20px', color: 'var(--modal-secondary-text)', fontSize: '11px' }}>https://www.yeees.in</p>
                        <button onClick={() => setShowAbout(false)} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 24px', borderRadius: '4px', cursor: 'pointer' }}>OK</button>
                    </div>
                </div>
            )}

            {/* Settings modal */}
            {showSettings && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseDown={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
                    <div style={{ background: 'var(--modal-bg)', color: 'var(--modal-text)', borderRadius: '8px', padding: '24px', width: '480px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid var(--modal-border)' }}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={async e => {
                            if (!e.metaKey && !e.ctrlKey) return;
                            const inp = e.target as HTMLInputElement;
                            if (inp.tagName !== 'INPUT') return;
                            if (e.key === 'a') { e.preventDefault(); inp.select(); }
                            else if (e.key === 'c') {
                                e.preventDefault();
                                const txt = inp.value.substring(inp.selectionStart ?? 0, inp.selectionEnd ?? inp.value.length);
                                if (txt) await ClipboardSetText(txt);
                            } else if (e.key === 'v') {
                                e.preventDefault();
                                const txt = await ClipboardGetText();
                                if (!txt) return;
                                const s = inp.selectionStart ?? inp.value.length;
                                const en = inp.selectionEnd ?? inp.value.length;
                                const next = inp.value.substring(0, s) + txt + inp.value.substring(en);
                                const idx = parseInt(inp.dataset.providerIndex ?? '-1');
                                if (idx >= 0) updateProvider(idx, inp.name as keyof AIProviderConfig, next);
                            }
                        }}>
                        <h3 style={{ margin: '0 0 12px', color: 'var(--modal-text)' }}>設定</h3>
                        {/* Tab bar */}
                        <div style={{ display: 'flex', borderBottom: '1px solid var(--modal-border)', marginBottom: '16px' }}>
                            {(['ai', 'editor'] as const).map(tab => (
                                <button key={tab} onClick={() => setSettingsTab(tab)} style={{ padding: '6px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: settingsTab === tab ? 700 : 400, borderBottom: settingsTab === tab ? '2px solid #2563eb' : '2px solid transparent', color: settingsTab === tab ? '#2563eb' : 'var(--modal-text)' }}>
                                    {tab === 'ai' ? 'AI' : 'エディタ'}
                                </button>
                            ))}
                        </div>
                        {settingsTab === 'editor' ? (
                            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
                                {/* Color theme */}
                                <div style={{ marginBottom: '20px' }}>
                                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--modal-text)' }}>カラーテーマ</div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        {([['default', 'デフォルト'], ['dark', 'ダーク'], ['gruvbox', 'Gruvbox']] as [ColorTheme, string][]).map(([id, label]) => (
                                            <button key={id} onClick={() => setColorTheme(id)}
                                                style={{ flex: 1, padding: '8px 4px', border: colorTheme === id ? '2px solid #2563eb' : '1px solid var(--modal-border)', borderRadius: '6px', cursor: 'pointer', background: id === 'default' ? '#f9fafb' : id === 'dark' ? '#1e1e1e' : '#282828', color: id === 'default' ? '#111827' : id === 'dark' ? '#d4d4d4' : '#ebdbb2', fontSize: '12px', fontWeight: colorTheme === id ? 700 : 400 }}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {/* Font size + Font family */}
                                <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', alignItems: 'flex-end' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--modal-text)' }}>フォントサイズ</label>
                                        <input type="number" min={10} max={32} value={fontSize}
                                            onChange={e => { const v = parseInt(e.target.value); if (v >= 10 && v <= 32) setFontSize(v); }}
                                            style={{ width: '72px', background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)', borderRadius: '4px', padding: '4px 6px' }} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--modal-text)' }}>フォント</label>
                                        <select value={fontFamily} onChange={e => setFontFamily(e.target.value)}
                                            style={{ width: '100%', background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)', borderRadius: '4px', padding: '4px 6px' }}>
                                            {FONT_FAMILIES.map(f => (
                                                <option key={f.value} value={f.value}>{f.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                {/* Preview */}
                                <div style={{ padding: '8px 10px', border: '1px solid var(--modal-border)', borderRadius: '4px', fontFamily: fontFamily, fontSize: `${fontSize}px`, color: 'var(--editor-text)', marginBottom: '16px', background: 'var(--modal-secondary)' }}>
                                    The quick brown fox — 素早い茶色のキツネ
                                </div>
                            </div>
                        ) : (
                            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
                                {settingsProviders.map((p, i) => (
                                    <div key={p.id} style={{ border: '1px solid var(--modal-border)', borderRadius: '8px', padding: '12px 16px', marginBottom: '12px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: p.enabled ? '12px' : 0 }}>
                                            <input type="checkbox" checked={p.enabled} onChange={e => updateProvider(i, 'enabled', e.target.checked)} />
                                            <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--modal-text)' }}>{p.name}</span>
                                            {p.enabled && p.apiKey && <span style={{ fontSize: '11px', color: '#16a34a', marginLeft: 'auto' }}>✓ 設定済み</span>}
                                        </label>
                                        {p.enabled && (
                                            <>
                                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--modal-secondary-text)', marginBottom: '4px' }}>API キー</label>
                                                <input
                                                    name="apiKey"
                                                    data-provider-index={i}
                                                    type="text"
                                                    value={p.apiKey}
                                                    onChange={e => updateProvider(i, 'apiKey', e.target.value)}
                                                    placeholder="APIキーを入力..."
                                                    autoComplete="off"
                                                    style={{ width: '100%', padding: '5px 8px', fontSize: '13px', border: '1px solid var(--input-border)', borderRadius: '4px', boxSizing: 'border-box', fontFamily: 'monospace', marginBottom: '8px', background: 'var(--input-bg)', color: 'var(--input-text)' }}
                                                />
                                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--modal-secondary-text)', marginBottom: '4px' }}>モデル</label>
                                                <input
                                                    name="model"
                                                    data-provider-index={i}
                                                    list={`models-${p.id}`}
                                                    value={p.model}
                                                    onChange={e => updateProvider(i, 'model', e.target.value)}
                                                    style={{ width: '100%', padding: '5px 8px', fontSize: '13px', border: '1px solid var(--input-border)', borderRadius: '4px', boxSizing: 'border-box', background: 'var(--input-bg)', color: 'var(--input-text)' }}
                                                />
                                                <datalist id={`models-${p.id}`}>
                                                    {(PROVIDER_MODELS[p.id] ?? []).map(m => <option key={m} value={m} />)}
                                                </datalist>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--modal-border)' }}>
                            <button onClick={() => setShowSettings(false)} style={{ background: 'var(--input-bg)', color: 'var(--modal-text)', border: '1px solid var(--input-border)', padding: '5px 14px', borderRadius: '4px', cursor: 'pointer' }}>閉じる</button>
                            {settingsTab === 'ai' && <button onClick={handleSaveSettings} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer' }}>保存</button>}
                        </div>
                    </div>
                </div>
            )}

            {/* AI popup menu */}
            {popup && (() => {
                const enabledProviders = settingsProviders.filter(p => p.enabled && p.apiKey);
                return (
                    <div ref={popupRef} style={{ position: 'fixed', left: popup.x, top: popup.y, zIndex: 1000, background: '#1e293b', color: '#fff', borderRadius: '6px', padding: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '200px' }}>
                        <input
                            ref={popupQuestionRef}
                            value={popupQuestion}
                            onChange={e => setPopupQuestion(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && enabledProviders.length === 1) handleAIQuery(enabledProviders[0].id);
                                if (e.key === 'Escape') { setPopup(null); setAiHighlight(null); }
                            }}
                            placeholder="質問（省略可）"
                            style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', fontSize: '13px', background: '#334155', color: '#fff', outline: 'none' }}
                        />
                        {enabledProviders.length === 0 ? (
                            <span style={{ fontSize: '12px', color: '#94a3b8' }}>⚙ 設定からAIを有効にしてください</span>
                        ) : (
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {enabledProviders.map(p => (
                                    <button key={p.id} onClick={() => handleAIQuery(p.id)}
                                        style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}>
                                        {p.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Top bar */}
            <div style={{ height: '22px', display: 'flex', alignItems: 'center', padding: '0 10px', background: 'var(--top-bar-bg)', borderBottom: '1px solid var(--top-bar-border)', fontSize: '11px', color: 'var(--top-bar-color)', flexShrink: 0, userSelect: 'none' }}>
                <span style={{ marginLeft: 'auto' }}>v{APP_VERSION}</span>
            </div>

            {/* Step 6: Tab bar - always visible */}
            <div style={{ display: 'flex', height: '32px', background: 'var(--tab-bar-bg)', borderBottom: '1px solid var(--tab-bar-border)', overflow: 'x' }}>
                {tabs.map(tab => (
                        <div
                            key={tab.id}
                            className="tab-item"
                            draggable
                            onDragStart={(e) => {
                                tabDragDataRef.current = { tabId: tab.id };
                                e.dataTransfer!.effectAllowed = 'move';
                            }}
                            onDragEnd={(e) => {
                                // Step 7: Drag out to create new window
                                if (e.dataTransfer!.dropEffect === 'none') {
                                    OpenNewWindow(tab.filePath);
                                    closeTab(tab.id);
                                }
                                tabDragDataRef.current = null;
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer!.dropEffect = 'move';
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                const data = tabDragDataRef.current;
                                if (data && data.tabId !== tab.id) {
                                    // Reorder tabs if needed later
                                }
                            }}
                            onClick={() => switchToTab(tab.id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '4px 12px',
                                minWidth: '100px',
                                maxWidth: '200px',
                                cursor: 'pointer',
                                borderRight: '1px solid var(--tab-bar-border)',
                                background: activeTabId === tab.id ? 'var(--editor-bg)' : 'var(--tab-bar-bg)',
                                borderBottom: activeTabId === tab.id ? '2px solid #2563eb' : 'none',
                                color: activeTabId === tab.id ? 'var(--editor-text)' : 'var(--top-bar-color)',
                                fontWeight: activeTabId === tab.id ? 'bold' : 'normal',
                                fontSize: '12px',
                                transition: 'all 0.2s ease',
                            }}
                        >
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {tab.isDirty && <span style={{ color: '#f59e0b', marginRight: '4px' }}>●</span>}
                                {tab.displayName || 'Untitled'}
                            </span>
                            <button
                                className="tab-close"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(tab.id);
                                }}
                                style={{
                                    marginLeft: '8px',
                                    background: 'none',
                                    border: 'none',
                                    color: activeTabId === tab.id ? 'var(--editor-text)' : 'var(--top-bar-color)',
                                    cursor: 'pointer',
                                    padding: '2px 4px',
                                    fontSize: '14px',
                                }}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>

            {/* Search / Replace panel is now handled by Monaco built-in */}

            {/* Editor + Right pane */}
            <div ref={containerRef} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    {/* Editor area */}
                    <div style={{ flex: 1, position: 'relative' }}>
                        <Editor
                            height="100%"
                            language="markdown"
                            defaultValue={markdown}
                            onMount={handleEditorMount}
                            options={{
                                lineNumbers: showLineNumbers ? 'on' : 'off',
                                fontSize: fontSize,
                                fontFamily: fontFamily,
                                wordWrap: 'on',
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                insertSpaces: true,
                                tabSize: 4,
                                renderWhitespace: 'none',
                                overviewRulerLanes: 0,
                            }}
                        />
                    </div>
                    {/* Encoding status bar */}
                    <div style={{ position: 'relative', height: '24px', display: 'flex', alignItems: 'center', padding: '0 8px', background: 'var(--encoding-bg)', borderTop: '1px solid var(--encoding-border)', fontSize: '11px', color: 'var(--top-bar-color)' }}>
                        <span style={{ marginRight: '4px' }}>文字コード:</span>
                        <button
                            id="encoding-btn"
                            onClick={() => setShowEncodingMenu(v => !v)}
                            style={{ fontSize: '11px', padding: '1px 6px', border: '1px solid var(--input-border)', borderRadius: '3px', background: 'var(--input-bg)', cursor: 'pointer', color: 'var(--input-text)' }}
                        >{fileEncoding} ▾</button>
                        <button
                            onClick={() => setShowTableDialog(true)}
                            title="テーブルを挿入"
                            style={{ fontSize: '11px', padding: '1px 6px', border: '1px solid var(--input-border)', borderRadius: '3px', background: 'var(--input-bg)', cursor: 'pointer', color: 'var(--input-text)', marginLeft: '8px' }}
                        >⊞ テーブル</button>
                        {showEncodingMenu && (
                            <div
                                id="encoding-menu"
                                style={{ position: 'absolute', bottom: '26px', left: '8px', background: 'var(--modal-bg)', border: '1px solid var(--modal-border)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 500, minWidth: '180px', overflow: 'hidden' }}
                            >
                                {[
                                    { label: 'UTF-8', desc: 'Mac / Linux（標準）' },
                                    { label: 'UTF-8 BOM', desc: 'Windows UTF-8' },
                                    { label: 'Shift-JIS', desc: 'Windows 日本語' },
                                    { label: 'EUC-JP', desc: 'Unix 日本語' },
                                    { label: 'UTF-16 LE', desc: 'Windows Unicode' },
                                ].map(({ label, desc }) => (
                                    <button
                                        key={label}
                                        onClick={() => handleReopenWithEncoding(label)}
                                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', border: 'none', background: fileEncoding === label ? 'rgba(37,99,235,0.15)' : 'var(--modal-bg)', cursor: 'pointer', fontSize: '12px', color: fileEncoding === label ? '#2563eb' : 'var(--modal-text)' }}
                                    >
                                        <span style={{ fontWeight: 600 }}>{label}</span>
                                        <span style={{ marginLeft: '8px', color: '#9ca3af', fontSize: '11px' }}>{desc}</span>
                                    </button>
                                ))}
                                {filePath && (
                                    <div style={{ borderTop: '1px solid var(--modal-border)', padding: '5px 12px', fontSize: '10px', color: 'var(--modal-secondary-text)' }}>
                                        クリックでファイルを再読み込み
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {showPreview && <>
                    {/* Resize handle */}
                    <div
                        onMouseDown={startResize}
                        style={{ width: '5px', flexShrink: 0, cursor: 'col-resize', background: 'var(--resize-bg)', borderLeft: '1px solid var(--resize-border)' }}
                    />
                    <div style={rightPaneWidth ? { width: rightPaneWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Tab bar */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--tab-bar-border)', background: 'var(--tab-bar-bg)', userSelect: 'none' }}>
                        <button style={tabStyle('preview')} onClick={() => setViewMode('preview')}>Preview</button>
                        <button style={tabStyle('ai')} onClick={() => setViewMode('ai')}>
                            {aiLoading && <span className="ai-spinner" />}
                            AI {!aiLoading && (aiResponse ? '●' : '')}
                        </button>
                    </div>

                    {/* Preview */}
                    {viewMode === 'preview' && (
                        <div
                            ref={previewRef}
                            style={{ flex: 1, padding: '10px', overflowY: 'auto', textAlign: 'left', background: 'var(--editor-bg)', color: 'var(--editor-text)' }}
                        >
                            <div className="md-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                        </div>
                    )}

                    {/* AI response */}
                    {viewMode === 'ai' && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', userSelect: 'none' }}>
                            {/* Response area — text selection enabled (overrides parent userSelect:none) */}
                            <div
                                ref={aiResponseAreaRef}
                                tabIndex={0}
                                onKeyDown={async e => {
                                    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
                                        e.preventDefault();
                                        const sel = window.getSelection()?.toString();
                                        console.log('[AI Response] Copy triggered, selected text:', sel?.substring(0, 50));
                                        if (sel) {
                                            // Write to BOTH clipboards
                                            try {
                                                await navigator.clipboard.writeText(sel);
                                                console.log('[AI Response] Copied with navigator.clipboard');
                                            } catch (err) {
                                                console.log('[AI Response] navigator.clipboard failed:', err);
                                            }
                                            try {
                                                await ClipboardSetText(sel);
                                                console.log('[AI Response] Copied with Wails API');
                                            } catch (err) {
                                                console.log('[AI Response] Wails API failed:', err);
                                            }
                                        }
                                    }
                                }}
                                style={{ flex: 1, padding: '10px', overflowY: 'auto', textAlign: 'left', outline: 'none', userSelect: 'text', cursor: 'text' }}
                            >
                                {!aiLoading && !aiResponse && !aiError && !aiHistory.length && (
                                    <p style={{ color: '#aaa', fontSize: '13px', userSelect: 'none' }}>テキストを選択して「AIに聞く」を押すと結果がここに表示されます。</p>
                                )}
                                {/* History — oldest first (aiHistory[0] is most recent, so render reversed) */}
                                {[...aiHistory].reverse().map((entry, i) => (
                                    <div key={i} style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px dashed #d1d5db' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '2px', userSelect: 'none' }}>質問文言</div>
                                        <p style={{ fontSize: '13px', color: '#4b5563', margin: '0 0 4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                            {(entry.selectedText || '').length > 120 ? (entry.selectedText || '').substring(0, 120) + '…' : (entry.selectedText || '')}
                                            {entry.question && <span style={{ color: '#6b7280' }}>　— {entry.question}</span>}
                                        </p>
                                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '2px', userSelect: 'none' }}>
                                            結果 <span style={{ fontWeight: 400, color: '#9ca3af' }}>{entry.providerName}</span>
                                        </div>
                                        {entry.error && <p style={{ color: '#dc2626', whiteSpace: 'pre-wrap' }}>{entry.error}</p>}
                                        {entry.response && <div className="md-preview" dangerouslySetInnerHTML={{ __html: marked(entry.response) as string }} />}
                                    </div>
                                ))}
                                {/* Current query — always at bottom (newest) */}
                                {(aiLoading || aiResponse || aiError) && (
                                    <div>
                                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '2px', userSelect: 'none' }}>質問文言</div>
                                        <p style={{ fontSize: '13px', color: '#4b5563', margin: '0 0 4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                            {aiSelectedText.length > 120 ? aiSelectedText.substring(0, 120) + '…' : aiSelectedText}
                                            {aiQuestion && <span style={{ color: '#6b7280' }}>　— {aiQuestion}</span>}
                                        </p>
                                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '2px', userSelect: 'none' }}>
                                            結果 <span style={{ fontWeight: 400, color: '#9ca3af' }}>{aiProviderName}</span>
                                        </div>
                                        {aiLoading && (
                                            <p style={{ display: 'flex', alignItems: 'center', color: '#6b7280', userSelect: 'none', margin: '4px 0' }}>
                                                <span className="ai-spinner" />
                                                <span className="ai-loading-dots">問い合わせ中</span>
                                            </p>
                                        )}
                                        {!aiLoading && aiError && <p style={{ color: '#dc2626', whiteSpace: 'pre-wrap' }}>{aiError}</p>}
                                        {!aiLoading && aiResponse && <div className="md-preview" dangerouslySetInnerHTML={{ __html: marked(aiResponse) as string }} />}
                                    </div>
                                )}
                            </div>
                            {/* Prompt editor — shown after first query */}
                            {aiSelectedText && (
                                <div style={{ borderTop: '1px solid var(--tab-bar-border)', padding: '8px', background: 'var(--encoding-bg)', flexShrink: 0, userSelect: 'none' }}>
                                    <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-start' }}>
                                        <textarea
                                            value={aiQuestion}
                                            onChange={e => setAiQuestion(e.target.value)}
                                            onKeyDown={async e => {
                                                const meta = e.metaKey || e.ctrlKey;
                                                // Cmd+V: paste
                                                if (meta && e.key === 'v') {
                                                    e.preventDefault();
                                                    console.log('[AI textarea] Cmd+V triggered');
                                                    const ta = e.currentTarget as HTMLTextAreaElement;
                                                    const start = ta.selectionStart ?? 0;
                                                    const end = ta.selectionEnd ?? 0;
                                                    
                                                    // Use Wails API only to avoid permission dialogs
                                                    const text = await ClipboardGetText();
                                                    console.log('[AI textarea] Wails clipboard text:', text.substring(0, 50));
                                                    if (!text) {
                                                        console.log('[AI textarea] No text to paste');
                                                        return;
                                                    }
                                                    
                                                    console.log('[AI textarea] Setting question with pasted text');
                                                    setAiQuestion(q => q.substring(0, start) + text + q.substring(end));
                                                    requestAnimationFrame(() => {
                                                        ta.selectionStart = ta.selectionEnd = start + text.length;
                                                    });
                                                    return;
                                                }
                                                // Cmd+A: select all
                                                if (meta && e.key === 'a') { e.preventDefault(); e.currentTarget.select(); return; }
                                                // Cmd+Enter: resubmit
                                                if (meta && e.key === 'Enter' && !aiLoading) {
                                                    e.preventDefault();
                                                    handleResubmitAI(aiProviderId || (settingsProviders.find(p => p.enabled && p.apiKey)?.id ?? ''));
                                                }
                                            }}
                                            placeholder="質問を編集して再送信... (⌘Enter)"
                                            rows={2}
                                            style={{ flex: 1, fontSize: '12px', padding: '4px 6px', border: '1px solid var(--input-border)', borderRadius: '4px', resize: 'vertical', fontFamily: 'system-ui', minHeight: '40px', background: 'var(--input-bg)', color: 'var(--input-text)' }}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            {settingsProviders.filter(p => p.enabled && p.apiKey).map(p => (
                                                <button
                                                    key={p.id}
                                                    disabled={aiLoading}
                                                    onClick={() => handleResubmitAI(p.id)}
                                                    style={{ fontSize: '11px', padding: '3px 8px', background: aiProviderId === p.id ? '#1d4ed8' : '#2563eb', color: '#fff', border: 'none', borderRadius: '3px', cursor: aiLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: aiLoading ? 0.6 : 1 }}
                                                >{p.name}</button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div></>}
            </div>

            {/* Status bar */}
            <div style={{ height: '22px', display: 'flex', alignItems: 'center', padding: '0 12px', background: 'var(--status-bg)', borderTop: '1px solid var(--status-border)', fontSize: '11px', color: 'var(--status-color)', gap: '16px', flexShrink: 0 }}>
                <span>行: {cursorLine}</span>
                <span>文字: {charCount.toLocaleString()}</span>
                <span>セクション: {sectionCount}</span>
            </div>
        </div>
    );
}

export default App;
