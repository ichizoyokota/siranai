import {useEffect, useMemo, useRef, useState} from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import appIcon from './assets/images/appicon.png';
import {marked} from 'marked';
marked.setOptions({ gfm: true, breaks: false });
import {ConfirmCloseTab, GetDisplayName, GetPendingFilePath, LoadSettings, LogMessage, OpenFile, OpenFileByPath, OpenNewWindow, PrintHTML, PrintText, QueryAI, ReopenWithEncoding, SaveFile, SaveFileWithEncoding, SaveSettings, SelectFileForLink, SetDirty} from '../wailsjs/go/main/App';
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
    baseUrl?: string;
    enabled: boolean;
}

const APP_VERSION = '0.1.9';

const PROVIDER_MODELS: Record<string, string[]> = {
    gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini'],
    claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
};

const DEFAULT_PROVIDERS: AIProviderConfig[] = [
    { id: 'gemini', name: 'Gemini', apiKey: '', model: 'gemini-2.5-flash', enabled: false },
    { id: 'openai', name: 'ChatGPT (OpenAI)', apiKey: '', baseUrl: '', model: 'gpt-4o', enabled: false },
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
    
    // Compute icon URL: in built app, use file path; in dev, use imported PNG
    const appIconUrl = useMemo(() => {
        // Try production app path first (file:// protocol)
        if (window.location.protocol === 'file:') {
            return './appicon.png';
        }
        // Fallback to imported PNG for dev
        return appIcon;
    }, []);

    // File warning dialog (binary / too large file)
    type FileWarningState = { type: 'binary' } | { type: 'tooLarge' } | { type: 'error'; message: string };
    const [fileWarning, setFileWarning] = useState<FileWarningState | null>(null);

    // Settings modal
    const [showSettings, setShowSettings] = useState(false);
    const [settingsProviders, setSettingsProviders] = useState<AIProviderConfig[]>(DEFAULT_PROVIDERS);

    // View options
    const [showLineNumbers, setShowLineNumbers] = useState(true);
    const [showPreview, setShowPreview] = useState(true);
    const [editorMounted, setEditorMounted] = useState(false);

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

    // Link insert dialog
    const [showLinkDialog, setShowLinkDialog] = useState(false);
    const [linkText, setLinkText] = useState('');
    const [linkUrl, setLinkUrl] = useState('');

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
    const monacoWidgetVisibleRef = useRef(false);
    const editorDomRef = useRef<HTMLElement | null>(null);
    const dragoverHandlerRef = useRef<((e: DragEvent) => void) | null>(null);
    const dropHandlerRef = useRef<((e: DragEvent) => void) | null>(null);
    const editorMouseUpHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
    const contentChangeDisposerRef = useRef<(() => void) | null>(null);
    const isDisposingRef = useRef<boolean>(false);
    const duplicateExistingTabIdRef = useRef<string | null>(null);
    const fileOpenQueueRef = useRef<Promise<void>>(Promise.resolve());

    // Step 1: Tab refs
    const tabModelsRef = useRef<Map<string, Monaco.editor.ITextModel>>(new Map());
    const activeTabIdRef = useRef<string>(activeTabId);
    const tabDragDataRef = useRef<{ tabId: string } | null>(null);

    useEffect(() => { filePathRef.current = filePath; }, [filePath]);
    useEffect(() => { void SetDirty(isDirty); }, [isDirty]);
    useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);
    
    // Step 2-3: When active tab changes, switch Monaco model and update state
    useEffect(() => {
        try {
            const editor = editorRef.current;
            const M = monacoRef.current;
            const activeTab = tabs.find(t => t.id === activeTabId);
            
            if (!activeTab || !editor || !M) return;
            
            void LogMessage(`[useEffect:activeTab] Switching to tab ${activeTab.id}, charCount=${activeTab.charCount}`);
            
            // Get the current model being displayed before switching
            const oldModel = editor.getModel();
            
            // Ensure model exists
            if (!tabModelsRef.current.has(activeTab.id)) {
                try {
                    const model = M.editor.createModel(activeTab.content, 'markdown');
                    tabModelsRef.current.set(activeTab.id, model);
                    void LogMessage(`[useEffect:activeTab] Created new model for ${activeTab.id}`);
                } catch (createErr: any) {
                    console.error('[useEffect:activeTab] Error creating model:', createErr);
                    void LogMessage(`[useEffect:activeTab] Error creating model: ${createErr instanceof Error ? createErr.message : String(createErr)}`);
                    return;
                }
            }
            
            // Switch to this tab's model
            const newModel = tabModelsRef.current.get(activeTab.id);
            if (newModel && newModel !== oldModel) {
                try {
                    editor.setModel(newModel);
                    // Use setTimeout to ensure setModel completes before focus
                    setTimeout(() => {
                        try {
                            editor.focus();
                        } catch (focusErr: any) {
                            console.error('[useEffect:activeTab] focus error:', focusErr);
                        }
                    }, 0);
                } catch (setModelErr: any) {
                    console.error('[useEffect:activeTab] setModel error:', setModelErr);
                    return;
                }
            }
            
            // Update state variables for display - do this with error handling for each state update
            try {
                setFilePath(activeTab.filePath);
            } catch (e: any) {
                console.error('[useEffect:activeTab] setFilePath error:', e);
            }
            try {
                setFileEncoding(activeTab.fileEncoding);
            } catch (e: any) {
                console.error('[useEffect:activeTab] setFileEncoding error:', e);
            }
            try {
                const mdContent = activeTab.content.length > PREVIEW_CHAR_LIMIT
                    ? activeTab.content.substring(0, PREVIEW_CHAR_LIMIT)
                    : activeTab.content;
                setMarkdown(mdContent);
            } catch (e: any) {
                console.error('[useEffect:activeTab] setMarkdown error:', e);
            }
            try {
                setCharCount(activeTab.charCount);
            } catch (e: any) {
                console.error('[useEffect:activeTab] setCharCount error:', e);
            }
            try {
                setSectionCount(activeTab.sectionCount);
            } catch (e: any) {
                console.error('[useEffect:activeTab] setSectionCount error:', e);
            }
            try {
                setCursorLine(activeTab.cursorLine);
            } catch (e: any) {
                console.error('[useEffect:activeTab] setCursorLine error:', e);
            }
            try {
                setIsDirty(activeTab.isDirty);
            } catch (e: any) {
                console.error('[useEffect:activeTab] setIsDirty error:', e);
            }
        } catch (err: any) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[useEffect:activeTab] Outer catch error:`, errMsg, err);
        }
    }, [activeTabId, tabs]);
    
    // Set up content change listener when editor or active tab changes
    useEffect(() => {
        try {
            const editor = editorRef.current;
            if (!editor) {
                return;
            }
            
            // Clean up old listener first (synchronously)
            if (contentChangeDisposerRef.current && !isDisposingRef.current) {
                try {
                    isDisposingRef.current = true;
                    contentChangeDisposerRef.current();
                    contentChangeDisposerRef.current = null;
                } catch (disposeErr: any) {
                    console.error('[useEffect:contentChange] Error disposing old listener:', disposeErr);
                    contentChangeDisposerRef.current = null;
                } finally {
                    isDisposingRef.current = false;
                }
            }
            
            // Register new listener - defer to microtask to ensure old listener is fully cleaned up
            // This prevents race conditions when multiple tabs switch rapidly
            const microtaskHandle = Promise.resolve().then(() => {
                try {
                    const editor = editorRef.current;
                    if (!editor) {
                        return;
                    }
                    
                    // Verify editor state before registering
                    const currentModel = editor.getModel();
                    
                    const disposer = editor.onDidChangeModelContent(() => {
                
                    try {
                        // Safeguard: verify we're still on the same tab
                        const tabId = activeTabIdRef.current;
                        const currentModel = editor.getModel();
                        const expectedModel = tabModelsRef.current.get(tabId);
                        
                        if (!currentModel || currentModel !== expectedModel) {
                            return;
                        }
                        
                        const content = currentModel.getValue();
                        const len = content.length;
                        
                        setIsDirty(true);
                        setAiHighlight(null);
                        setCharCount(len);
                        
                        // Update active tab's content from editor model
                        setTabs(prev => {
                            try {
                                return prev.map(t => {
                                    if (t.id === tabId) {
                                        return { 
                                            ...t, 
                                            isDirty: true,
                                            content: content,
                                            charCount: len,
                                        };
                                    }
                                    return t;
                                });
                            } catch (mapErr: any) {
                                console.error('[onDidChangeModelContent.setTabs] Error:', mapErr);
                                return prev;
                            }
                        });
                        
                        schedulePreviewUpdate();
                    } catch (changeErr: any) {
                        console.error('[onDidChangeModelContent] Error:', changeErr);
                    }
                });
                
                // Store the disposer with double-dispose protection
                let disposed = false;
                contentChangeDisposerRef.current = () => {
                    if (disposed) {
                        return;
                    }
                    disposed = true;
                    try {
                        disposer.dispose();
                    } catch (disposeInnerErr: any) {
                        console.error('[useEffect:contentChange] Error in disposer function:', disposeInnerErr);
                    }
                };
                
                } catch (registerErr: any) {
                    console.error('[useEffect:contentChange] Error registering listener:', registerErr);
                }
            }).catch((promiseErr: any) => {
                console.error('[useEffect:contentChange] Microtask error:', promiseErr);
            });
            
            // Return cleanup function - runs when effect re-runs or component unmounts
            return () => {
                try {
                    // Cancel the pending microtask if effect is re-run before it completes
                    // (This is handled by React's dependency tracking, but ensure cleanup is called)
                    if (contentChangeDisposerRef.current && !isDisposingRef.current) {
                        isDisposingRef.current = true;
                        contentChangeDisposerRef.current();
                        contentChangeDisposerRef.current = null;
                    }
                } catch (cleanupErr: any) {
                    console.error('[useEffect:contentChange] Cleanup error:', cleanupErr);
                    contentChangeDisposerRef.current = null;
                } finally {
                    isDisposingRef.current = false;
                }
            };
        } catch (err: any) {
            console.error('[useEffect:contentChange] Outer error:', err);
        }
    }, [activeTabId, editorMounted]);
    
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
            if (path) {
                // Queue file operations to prevent parallel execution
                fileOpenQueueRef.current = fileOpenQueueRef.current.then(() => handleOpenPath(path));
            }
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
        // Model switching will happen in useEffect (lines 278-308)
    }

    function closeTab(tabId: string) {
        const tabToClose = tabs.find(t => t.id === tabId);
        if (!tabToClose) return;
        
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
        
        let nextTabId: string | null = null;
        
        // Remove from tabs list and switch if needed
        setTabs(prev => {
            const newTabs = prev.filter(t => t.id !== tabId);
            console.log(`setTabs: removed ${tabId}, remaining tabs: ${newTabs.length}`);
            void LogMessage(`[closeTab] Removed ${tabId}, remaining tabs: ${newTabs.length}`);
            
            // If no tabs left, create a new empty tab automatically
            // (This prevents UI crash - Monaco editor and other components expect at least 1 tab)
            if (newTabs.length === 0) {
                console.log('Last tab closed, auto-creating new tab');
                void LogMessage('[closeTab] Last tab closed, auto-creating new tab');
                const newTab = makeInitialTab([]);
                
                // Create model for the new tab
                const M = monacoRef.current;
                if (M) {
                    try {
                        const model = M.editor.createModel(newTab.content, 'markdown');
                        tabModelsRef.current.set(newTab.id, model);
                    } catch (err) {
                        console.error('Failed to create model:', err);
                    }
                }
                
                // Switch to new tab
                setTimeout(() => setActiveTabId(newTab.id), 0);
                return [newTab];
            }
            
            // If the closed tab was active, switch to another tab
            if (activeTabId === tabId) {
                const nextTab = newTabs[0];
                console.log(`activeTab was closed, switching to: ${nextTab?.id}`);
                if (nextTab) {
                    nextTabId = nextTab.id;
                }
            }
            
            return newTabs;
        });
        
        // Switch to next tab after state update
        if (nextTabId) {
            setTimeout(() => setActiveTabId(nextTabId!), 0);
        }
    }

    function schedulePreviewUpdate() {
        try {
            if (previewUpdateTimer.current) clearTimeout(previewUpdateTimer.current);
            previewUpdateTimer.current = setTimeout(() => {
                try {
                    const editor = editorRef.current;
                    if (!editor) return;
                    const val = editor.getValue();
                    const mdContent = val.length > PREVIEW_CHAR_LIMIT ? val.substring(0, PREVIEW_CHAR_LIMIT) : val;
                    try {
                        setMarkdown(mdContent);
                    } catch (mdErr: any) {
                        console.error('[schedulePreviewUpdate] setMarkdown error:', mdErr);
                        void LogMessage(`[schedulePreviewUpdate] setMarkdown error: ${mdErr instanceof Error ? mdErr.message : String(mdErr)}`);
                    }
                    try {
                        const lines = editor.getModel()?.getLinesContent() ?? [];
                        const sectionCount = lines.filter(l => /^#{1,6}\s/.test(l)).length;
                        setSectionCount(sectionCount);
                    } catch (secErr: any) {
                        console.error('[schedulePreviewUpdate] setSectionCount error:', secErr);
                        void LogMessage(`[schedulePreviewUpdate] setSectionCount error: ${secErr instanceof Error ? secErr.message : String(secErr)}`);
                    }
                } catch (timerErr: any) {
                    console.error('[schedulePreviewUpdate] Timer callback error:', timerErr);
                    void LogMessage(`[schedulePreviewUpdate] Timer callback error: ${timerErr instanceof Error ? timerErr.message : String(timerErr)}`);
                }
            }, 300);
        } catch (err: any) {
            console.error('[schedulePreviewUpdate] Error:', err);
            void LogMessage(`[schedulePreviewUpdate] Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    function doUndo() { editorRef.current?.trigger('keyboard', 'undo', null); }
    function doRedo() { editorRef.current?.trigger('keyboard', 'redo', null); }

    function handleNew() {
        void LogMessage(`[handleNew] Called, tabs.length: ${tabs.length}`);
        console.log('[handleNew] Called, tabs.length:', tabs.length);
        
        void LogMessage('[handleNew] Called');
        
        // Use functional update to get the latest tabs
        let newTabId = '';
        
        setTabs(prev => {
                void LogMessage(`[handleNew] setTabs callback, prev.length: ${prev.length}`);
                console.log('[handleNew] setTabs callback, prev.length:', prev.length);
                const newTab = makeInitialTab(prev);
                newTabId = newTab.id;
                
                // Create model first (only if Monaco is available)
                const M = monacoRef.current;
                if (M) {
                    try {
                        const model = M.editor.createModel(newTab.content, 'markdown');
                        tabModelsRef.current.set(newTab.id, model);
                        void LogMessage(`[handleNew] Model created for tab: ${newTab.id}`);
                        console.log('[handleNew] Model created for tab:', newTab.id);
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        void LogMessage(`[handleNew] Failed to create model: ${errMsg}`);
                        console.error('[handleNew] Failed to create model:', err);
                    }
                } else {
                    void LogMessage('[handleNew] Monaco not available yet');
                    console.log('[handleNew] Monaco not available yet');
                }
                
                return [...prev, newTab];
            });
            
            // Switch to the new tab after state is updated
            // Use setTimeout to ensure state update completes first
            setTimeout(() => {
                void LogMessage(`[handleNew] Switching to tab: ${newTabId}`);
                console.log('[handleNew] Switching to tab:', newTabId);
                setActiveTabId(newTabId);
            }, 0);
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
        // Queue file operations to prevent parallel execution
        fileOpenQueueRef.current = fileOpenQueueRef.current.then(async () => {
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
            setTabs(prev => {
                // Remove empty Untitled tab if it exists and no files are open
                let updatedTabs = prev;
                if (prev.length === 1) {
                    const lastTab = prev[0];
                    if (!lastTab.filePath && !lastTab.isDirty && (lastTab.displayName === 'Untitled' || lastTab.displayName.match(/^Untitled \d+$/))) {
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
            
            // Switch to new tab after state update
            setTimeout(() => setActiveTabId(tabId), 0);
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
         void LogMessage(`[handleOpenPath] START: path=${path}`);
        
         try{
             let result: Record<string, string> | undefined;
             try {
                 void LogMessage(`[handleOpenPath] Calling OpenFileByPath...`);
                 result = await OpenFileByPath(path);
                 void LogMessage(`[handleOpenPath] OpenFileByPath returned: ${JSON.stringify(result).substring(0, 100)}...`);
             } catch (err: any) {
                 const errMsg = err instanceof Error ? err.message : String(err);
                 console.error('[handleOpenPath] Error reading file:', errMsg);
                 void LogMessage(`[handleOpenPath] FAILED: Error reading file: ${errMsg}`);
                 setFileWarning({ type: 'error', message: `ファイルを開くことができません: ${errMsg}` });
                 return;
             }
           
             if (!result || typeof result.path !== 'string' || typeof result.content !== 'string') {
                 console.error('[handleOpenPath] Invalid result:', result);
                 void LogMessage(`[handleOpenPath] FAILED: Invalid result returned for ${path}`);
                 setFileWarning({ type: 'error', message: 'ファイルの読み込みに失敗しました' });
                 return;
             }
             // At this point, result is guaranteed to have path and content as strings
             const typedResult = result as Record<string, string> & { path: string; content: string };
             if (typedResult.isBinary === 'true') {
                 void LogMessage(`[handleOpenPath] File is binary`);
                 setFileWarning({ type: 'binary' });
                 return;
             }
             if (typedResult.isTooLarge === 'true') {
                 void LogMessage(`[handleOpenPath] File is too large`);
                 setFileWarning({ type: 'tooLarge' });
                 return;
             }
             
             // Open in new tab (duplicate check will happen in setTabs callback)
             const tabId = makeTabId();
             const displayName = typedResult.path.split('/').pop() || 'File';
           
             // Validate content is a string
             if (typeof typedResult.content !== 'string') {
                 console.error('[handleOpenPath] Content is not a string:', typeof typedResult.content);
                 void LogMessage(`[handleOpenPath] Content type error: ${typeof typedResult.content}`);
                 setFileWarning({ type: 'error', message: 'ファイルの形式が不正です' });
                 return;
             }
           
             const newTab: TabState = {
                 id: tabId,
                 filePath: typedResult.path,
                 displayName,
                 content: typedResult.content,
                 fileEncoding: typedResult.encoding ?? 'UTF-8',
                 isDirty: false,
                 cursorLine: 1,
                 charCount: typedResult.content.length,
                 sectionCount: typedResult.content.split('\n').filter(l => /^#{1,6}\s/.test(l)).length,
             };
            
             // Add tab and switch, removing empty Untitled if present
             setTabs(prev => {
                 try {
                     void LogMessage(`[handleOpenPath.setTabs] Starting with ${prev.length} previous tabs`);
                    
                     // Double-check for duplicate file paths (race condition protection)
                     const isDuplicate = prev.some(t => t.filePath === typedResult.path);
                     if (isDuplicate) {
                         void LogMessage(`[handleOpenPath.setTabs] Duplicate detected during setTabs callback, not adding tab`);
                         // Find the existing tab and store its ID
                         const existingTab = prev.find(t => t.filePath === typedResult.path);
                         if (existingTab) {
                             duplicateExistingTabIdRef.current = existingTab.id;
                             void LogMessage(`[handleOpenPath.setTabs] Stored existing tab ID: ${existingTab.id}`);
                         }
                         // No model to clean up since we haven't created it yet
                         return prev;
                     }
                      
                     // Create model AFTER duplicate check
                     const M = monacoRef.current;
                     if (M) {
                         try {
                             const model = M.editor.createModel(typedResult.content, 'markdown');
                             tabModelsRef.current.set(tabId, model);
                             void LogMessage(`[handleOpenPath.setTabs] Model created for ${tabId}`);
                         } catch (modelErr: any) {
                             const errMsg = modelErr instanceof Error ? modelErr.message : String(modelErr);
                             console.error('[handleOpenPath] Model creation error:', errMsg);
                             void LogMessage(`[handleOpenPath] Failed to create editor model: ${errMsg}`);
                             return prev; // Don't add tab if model creation fails
                         }
                     }
                      
                     // Remove empty Untitled tab if it exists and no files are open
                     let updatedTabs = prev;
                     if (prev.length === 1) {
                         const lastTab = prev[0];
                         if (!lastTab.filePath && !lastTab.isDirty && (lastTab.displayName === 'Untitled' || lastTab.displayName.match(/^Untitled \d+$/))) {
                             // Remove the empty Untitled tab
                             void LogMessage('[handleOpenPath.setTabs] Removing empty Untitled tab');
                             const model = tabModelsRef.current.get(lastTab.id);
                             if (model) {
                                 model.dispose();
                                 tabModelsRef.current.delete(lastTab.id);
                             }
                             updatedTabs = [];
                         }
                     }
                     
                     const result = [...updatedTabs, newTab];
                     void LogMessage(`[handleOpenPath.setTabs] Returning ${result.length} tabs`);
                     return result;
                 } catch (setTabsErr: any) {
                     const errMsg = setTabsErr instanceof Error ? setTabsErr.message : String(setTabsErr);
                     console.error('[handleOpenPath.setTabs] Error:', errMsg, setTabsErr);
                     void LogMessage(`[handleOpenPath.setTabs] Error: ${errMsg}`);
                     return prev;
                 }
             });
            
             void LogMessage('[handleOpenPath] Called setTabs, about to setActiveTabId');
            
            // If a duplicate was detected, activate the existing tab instead
             // Use setTimeout to ensure setTabs state update completes before setActiveTabId
             setTimeout(() => {
                 if (duplicateExistingTabIdRef.current) {
                     const existingTabId = duplicateExistingTabIdRef.current;
                     duplicateExistingTabIdRef.current = null;
                     void LogMessage(`[handleOpenPath] Duplicate detected, activating existing tab: ${existingTabId}`);
                     setActiveTabId(existingTabId);
                 } else {
                     // New tab was added, activate it
                     setActiveTabId(tabId);
                     void LogMessage(`[handleOpenPath] Set active tab to ${tabId}`);
                 }
             }, 0);
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
        void LogMessage('[doPaste] Called');
         
        const inp = activeInput();
        if (inp) {
            void LogMessage('[doPaste] Active input detected');
            // Use Wails API only to avoid permission dialogs
            const text = await ClipboardGetText();
            void LogMessage(`[doPaste] Input got text: "${text?.substring(0, 50) || 'EMPTY'}"`);
            if (!text) {
                void LogMessage('[doPaste] Clipboard is empty');
                return;
            }
            inp.focus();
            // Use value manipulation instead of execCommand to avoid browser prompts
            const start = inp.selectionStart ?? 0;
            const end = inp.selectionEnd ?? 0;
            inp.value = inp.value.substring(0, start) + text + inp.value.substring(end);
            inp.selectionStart = inp.selectionEnd = start + text.length;
            // Trigger React's onChange
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            void LogMessage('[doPaste] Input paste completed');
            return;
        }
         
        // For Monaco editor, manually handle paste
        const editor = editorRef.current;
        if (editor) {
            void LogMessage('[doPaste] Monaco editor detected');
            // Use Wails API only to avoid permission dialogs
            const text = await ClipboardGetText();
            void LogMessage(`[doPaste] Monaco got text: "${text?.substring(0, 50) || 'EMPTY'}"`);
            if (text) {
                const selection = editor.getSelection();
                if (selection) {
                    // Convert Selection to IRange for executeEdits
                    const range = {
                        startLineNumber: selection.startLineNumber,
                        startColumn: selection.startColumn,
                        endLineNumber: selection.endLineNumber,
                        endColumn: selection.endColumn,
                    };
                    editor.executeEdits('paste', [{ range, text }]);
                    void LogMessage('[doPaste] Monaco paste completed');
                } else {
                    void LogMessage('[doPaste] No selection in editor');
                }
            } else {
                void LogMessage('[doPaste] Clipboard is empty');
            }
        } else {
            void LogMessage('[doPaste] No editor or active input');
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

    // Close popup / encoding menu on click outside
    useEffect(() => {
        function onMouseDown(e: MouseEvent) {
            void LogMessage(`[MOUSEDOWN-DEBUG] mousedown event, popup exists=${!!popupRef.current}`);
            // Only close popup if clicking outside of it AND not inside editor
            const editor = editorRef.current;
            const editorDom = editor?.getDomNode();
            const isClickInEditor = editorDom && editorDom.contains(e.target as Node);
            
            if (popupRef.current && !popupRef.current.contains(e.target as Node) && !isClickInEditor) {
                void LogMessage('[MOUSEDOWN-DEBUG] Closing popup due to outside click');
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
    
    // Check if Monaco widgets (find, replace, command palette) are visible
    function isMonacoWidgetVisible(): boolean {
        const editor = editorRef.current;
        if (!editor) return false;
        
        // Check if any of the known widget containers have interactive elements
        const findInput = document.querySelector('.find-widget input') as HTMLElement | null;
        const replaceInput = document.querySelector('.replace-widget input') as HTMLElement | null;
        const quickInput = document.querySelector('.quick-open-widget input') as HTMLElement | null;
        
        // If any of these input elements has focus, the widget is definitely visible/active
        if (findInput === document.activeElement || 
            replaceInput === document.activeElement || 
            quickInput === document.activeElement) {
            return true;
        }
        
        // Check using detailed DOM inspection
        const findContainer = document.querySelector('.find-widget') as HTMLElement | null;
        if (findContainer) {
            // Check parent hierarchy for hidden state
            let element: HTMLElement | null = findContainer;
            while (element) {
                const style = window.getComputedStyle(element);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return false;
                }
                // Check for hidden class or aria-hidden
                if (element.classList.contains('hidden') || 
                    element.getAttribute('aria-hidden') === 'true' ||
                    element.getAttribute('hidden') !== null) {
                    return false;
                }
                element = element.parentElement;
            }
            
            // Check if it's in viewport
            const rect = findContainer.getBoundingClientRect();
            const isInViewport = rect.height > 0 && 
                                rect.width > 0 && 
                                rect.top < window.innerHeight && 
                                rect.left < window.innerWidth &&
                                rect.bottom > 0 &&
                                rect.right > 0;
            
            if (isInViewport) {
                return true;
            }
        }
        
        const replaceContainer = document.querySelector('.replace-widget') as HTMLElement | null;
        if (replaceContainer) {
            let element: HTMLElement | null = replaceContainer;
            while (element) {
                const style = window.getComputedStyle(element);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return false;
                }
                if (element.classList.contains('hidden') || 
                    element.getAttribute('aria-hidden') === 'true' ||
                    element.getAttribute('hidden') !== null) {
                    return false;
                }
                element = element.parentElement;
            }
            
            const rect = replaceContainer.getBoundingClientRect();
            const isInViewport = rect.height > 0 && 
                                rect.width > 0 && 
                                rect.top < window.innerHeight && 
                                rect.left < window.innerWidth &&
                                rect.bottom > 0 &&
                                rect.right > 0;
            
            if (isInViewport) {
                return true;
            }
        }
        
        const quickContainer = document.querySelector('.quick-open-widget') as HTMLElement | null;
        if (quickContainer) {
            let element: HTMLElement | null = quickContainer;
            while (element) {
                const style = window.getComputedStyle(element);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return false;
                }
                if (element.classList.contains('hidden') || 
                    element.getAttribute('aria-hidden') === 'true' ||
                    element.getAttribute('hidden') !== null) {
                    return false;
                }
                element = element.parentElement;
            }
            
            const rect = quickContainer.getBoundingClientRect();
            const isInViewport = rect.height > 0 && 
                                rect.width > 0 && 
                                rect.top < window.innerHeight && 
                                rect.left < window.innerWidth &&
                                rect.bottom > 0 &&
                                rect.right > 0;
            
            if (isInViewport) {
                return true;
            }
        }
        
        return false;
    }
    
    useEffect(() => {
        function onDocMouseUp(e: MouseEvent) {
            void LogMessage(`[POPUP-DEBUG] mouseup event triggered`);
             
            // Check if mouseup was in AI response area - if so, skip popup
            const aiResponseArea = aiResponseAreaRef.current;
            if (aiResponseArea && aiResponseArea.contains(e.target as Node)) {
                void LogMessage('[POPUP-DEBUG] mouseup in AI response area, skipping popup');
                setPopup(null);
                setAiHighlight(null);
                return;
            }
              
            // Wait a bit to see if user is copying
            setTimeout(() => {
                if (copyingRef.current) {
                    void LogMessage('[POPUP-DEBUG] copying detected, returning');
                    copyingRef.current = false;
                    return;
                }
                    
                // Don't show AI popup if Monaco widgets are currently visible (check current state)
                const widgetVisible = isMonacoWidgetVisible();
                const findWidget = document.querySelector('.find-widget') as HTMLElement | null;
                const findRect = findWidget?.getBoundingClientRect();
                const findClasses = findWidget?.className || '';
                const findAriaHidden = findWidget?.getAttribute('aria-hidden');
                void LogMessage(`[POPUP-DEBUG] widgetVisible=${widgetVisible}, monacoWidgetVisibleRef=${monacoWidgetVisibleRef.current}`);
                console.warn('[POPUP] MouseUp: widgetVisible=', widgetVisible, 'classes=', findClasses, 'aria-hidden=', findAriaHidden, 'rect.top=', findRect?.top);
                if (widgetVisible || monacoWidgetVisibleRef.current) {
                    void LogMessage('[POPUP-DEBUG] Widget visible, skipping popup');
                    console.warn('[POPUP] Skipping popup due to widget visibility');
                    setPopup(null);
                    setAiHighlight(null);
                    return;
                }
                    
                const editor = editorRef.current;
                void LogMessage(`[POPUP-DEBUG] editor=${editor ? 'exists' : 'null'}`);
                if (!editor) {
                    void LogMessage('[POPUP-DEBUG] editor is null, returning');
                    return;
                }
                const sel = editor.getSelection();
                void LogMessage(`[POPUP-DEBUG] selection exists=${!!sel}, isEmpty=${sel?.isEmpty()}`);
                if (!sel || sel.isEmpty()) { 
                    void LogMessage('[POPUP-DEBUG] no selection, clearing popup');
                    setPopup(null); 
                    setAiHighlight(null); 
                    return;
                }
                const model = editor.getModel();
                void LogMessage(`[POPUP-DEBUG] model=${model ? 'exists' : 'null'}`);
                if (!model) {
                    void LogMessage('[POPUP-DEBUG] model is null, returning');
                    return;
                }
                const selectedText = model.getValueInRange(sel).trim();
                void LogMessage(`[POPUP-DEBUG] selectedText="${selectedText.substring(0, 50)}..." (length=${selectedText.length})`);
                if (!selectedText) { 
                    void LogMessage('[POPUP-DEBUG] no selected text, clearing popup');
                    setPopup(null); 
                    setAiHighlight(null); 
                    return; 
                }
                const start = model.getOffsetAt(sel.getStartPosition());
                const end = model.getOffsetAt(sel.getEndPosition());
                setAiHighlight({ start, end });
                const POPUP_W = 290;
                const x = Math.min(Math.max(e.clientX, 8), window.innerWidth - POPUP_W - 8);
                const y = Math.max(Math.min(e.clientY - 48, window.innerHeight - 58), 8);
                void LogMessage(`[POPUP-DEBUG] setting popup at x=${x}, y=${y}`);
                setPopup({ x, y, text: selectedText });
                setPopupQuestion('');
            }, 100);
        }
        document.addEventListener('mouseup', onDocMouseUp);
        return () => document.removeEventListener('mouseup', onDocMouseUp);
    }, []);

    // Close AI popup when Monaco widgets (find, replace, command palette) are shown
    // Restore popup when they are hidden (if text is still selected)
    useEffect(() => {
        const checkWidgetVisibility = () => {
            const isWidgetVisible = isMonacoWidgetVisible();
            const wasWidgetVisible = monacoWidgetVisibleRef.current;
            
            if (isWidgetVisible && !wasWidgetVisible) {
                // Widget just became visible: close popup
                monacoWidgetVisibleRef.current = true;
                if (popup) {
                    setPopup(null);
                    setAiHighlight(null);
                }
            } else if (!isWidgetVisible && wasWidgetVisible) {
                // Widget just became hidden: restore popup if there's still a selection
                monacoWidgetVisibleRef.current = false;
                if (aiHighlight && !popup) {
                    const editor = editorRef.current;
                    if (editor) {
                        const model = editor.getModel();
                        if (model) {
                            const selection = editor.getSelection();
                            if (selection && !selection.isEmpty()) {
                                const selectedText = model.getValueInRange(selection).trim();
                                if (selectedText) {
                                    // Restore popup at center position
                                    const POPUP_W = 290;
                                    const x = Math.min(Math.max(window.innerWidth / 2 - POPUP_W / 2, 8), window.innerWidth - POPUP_W - 8);
                                    const y = 100;
                                    setPopup({ x, y, text: selectedText });
                                    setPopupQuestion('');
                                }
                            }
                        }
                    }
                }
            }
        };
        
        // Listen for keyboard events to detect widget open/close
        function onKeyDown(e: KeyboardEvent) {
            // Cmd+C: Copy (always works, even with popup)
            if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
                const editor = editorRef.current;
                if (editor) {
                    const sel = editor.getSelection();
                    if (sel && !sel.isEmpty()) {
                        const model = editor.getModel();
                        if (model) {
                            const selectedText = model.getValueInRange(sel);
                            void LogMessage(`[Global Cmd+C] Copy from editor, length: ${selectedText.length}`);
                            doCopy().catch(err => void LogMessage(`[Global Cmd+C] Error: ${err}`));
                            return;
                        }
                    }
                }
            }
            // Cmd+V: Paste
            if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
                void LogMessage('[Global Cmd+V] Detected from onKeyDown');
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                doPaste().catch(err => void LogMessage(`[Global Cmd+V] Error: ${err}`));
                return;
            }
            // Cmd+F (Mac) or Ctrl+F (Windows/Linux) opens find
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                setTimeout(() => {
                    if (isMonacoWidgetVisible()) {
                        monacoWidgetVisibleRef.current = true;
                        if (popup) {
                            setPopup(null);
                            setAiHighlight(null);
                        }
                    }
                }, 50);
            }
            // Ctrl+P: toggle preview and AI search panel visibility (same as Shift+Cmd+P)
            if ((e.metaKey || e.ctrlKey) && e.key === 'p' && !e.shiftKey) {
                e.preventDefault();
                setShowPreview(v => !v);
            }
            // Escape closes widgets - force reset ref and check after delay
            if (e.key === 'Escape') {
                // First, immediately mark as potentially closed
                monacoWidgetVisibleRef.current = false;
                
                // Then check more thoroughly after a delay to give Monaco time to update
                setTimeout(() => {
                    checkWidgetVisibility();
                    
                    // If widget is now confirmed closed and we have a selection, restore popup
                    if (!monacoWidgetVisibleRef.current && aiHighlight && !popup) {
                        const editor = editorRef.current;
                        if (editor) {
                            const model = editor.getModel();
                            if (model) {
                                const selection = editor.getSelection();
                                if (selection && !selection.isEmpty()) {
                                    const selectedText = model.getValueInRange(selection).trim();
                                    if (selectedText) {
                                        const POPUP_W = 290;
                                        const x = Math.min(Math.max(window.innerWidth / 2 - POPUP_W / 2, 8), window.innerWidth - POPUP_W - 8);
                                        const y = 100;
                                        setPopup({ x, y, text: selectedText });
                                        setPopupQuestion('');
                                    }
                                }
                            }
                        }
                    }
                }, 150);
            }
        }
        
        // Periodic check for widget visibility changes (fallback)
        const intervalId = setInterval(checkWidgetVisibility, 300);
        
        // MutationObserver for DOM changes
        const observer = new MutationObserver(() => {
            checkWidgetVisibility();
        });
        
        document.addEventListener('keydown', onKeyDown);
        observer.observe(document.body, {
            attributes: true,
            subtree: true,
            attributeFilter: ['style', 'class'],
        });
        
        return () => {
            clearInterval(intervalId);
            document.removeEventListener('keydown', onKeyDown);
            observer.disconnect();
        };
    }, [aiHighlight, popup]);

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
            EventsOn('menu:find',              () => editorRef.current?.trigger('keyboard', 'actions.find', null)),
            EventsOn('menu:findNext',          () => editorRef.current?.trigger('keyboard', 'editor.action.nextMatchFindAction', null)),
            EventsOn('menu:replace',           () => editorRef.current?.trigger('keyboard', 'editor.action.startFindReplaceAction', null)),
            EventsOn('menu:print',             () => handlePrint()),
            EventsOn('menu:printText',         () => handlePrintText()),
            EventsOn('menu:toggleLineNumbers', () => setShowLineNumbers(v => !v)),
            EventsOn('menu:togglePreview',     () => setShowPreview(v => !v)),
            EventsOn('menu:insertLink',        () => setShowLinkDialog(true)),
            EventsOn('file:open',              (path: string) => {
                // Queue file operations to prevent parallel execution
                fileOpenQueueRef.current = fileOpenQueueRef.current.then(() => handleOpenPath(path));
            }),
            EventsOn('file:drop',              async (paths: string[]) => {
                void LogMessage(`[file:drop] Event received, paths=${JSON.stringify(paths)}, shift=${shiftPressedRef.current}`);
                console.log('[file:drop] Event received', { paths, shift: shiftPressedRef.current });
                setIsDragOver(false);
                if (!paths || paths.length === 0) {
                    void LogMessage('[file:drop] Empty paths, returning');
                    return;
                }
                
                // Queue file operations to prevent parallel execution and race conditions
                fileOpenQueueRef.current = fileOpenQueueRef.current.then(async () => {
                    try {
                        // Guard: ensure we have a valid path
                        const path = paths[0];
                        if (!path || typeof path !== 'string') {
                            void LogMessage(`[file:drop] Invalid path type: ${typeof path}`);
                            return;
                        }
                        void LogMessage(`[file:drop] Processing path: ${path}`);
                          
                        if (shiftPressedRef.current) {
                            void LogMessage('[file:drop] Mode: insert path');
                            insertPathAtCursor(path);
                        } else {
                            void LogMessage('[file:drop] Mode: open file');
                            await handleOpenPath(path);
                        }
                        void LogMessage('[file:drop] Completed successfully');
                    } catch (error) {
                        const errMsg = error instanceof Error ? error.message : String(error);
                        const stack = error instanceof Error ? error.stack : '';
                        console.error('[file:drop] Exception:', errMsg, error);
                        void LogMessage(`[file:drop] Exception: ${errMsg}\n${stack}`);
                        // Reset drag state on error
                        setIsDragOver(false);
                    }
                });
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
            e.stopPropagation();
            if (e.shiftKey !== shiftPressedRef.current) {
                shiftPressedRef.current = e.shiftKey;
                setShiftDuringDrag(e.shiftKey);
            }
        }
        function onDrop(e: DragEvent) { 
            e.preventDefault(); 
            e.stopPropagation();
            setIsDragOver(false); 
        }

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        document.addEventListener('dragenter', onDragEnter, { capture: false });
        document.addEventListener('dragleave', onDragLeave, { capture: false });
        document.addEventListener('dragover', onDragOver, { capture: false });
        document.addEventListener('drop', onDrop, { capture: false });

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

    function insertLink(text: string, url: string) {
        const editor = editorRef.current;
        const M = monacoRef.current;
        const linkMarkdown = `[${text}](${url})`;
        if (editor && M) {
            const sel = editor.getSelection();
            const pos = sel?.getStartPosition() ?? { lineNumber: 1, column: 1 };
            const range = sel ?? new M.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
            editor.executeEdits('insertLink', [{ range, text: linkMarkdown }]);
        }
        setShowLinkDialog(false);
        setLinkText('');
        setLinkUrl('');
    }

    async function handleSelectFileForLink() {
        try {
            const selectedPath = await SelectFileForLink();
            if (selectedPath) {
                const currentFile = tabs.find(t => t.id === activeTabId);
                let relativePath = selectedPath;
                
                if (currentFile && currentFile.filePath) {
                    const currentDir = currentFile.filePath.substring(0, currentFile.filePath.lastIndexOf('/'));
                    if (selectedPath.startsWith(currentDir)) {
                        relativePath = selectedPath.substring(currentDir.length + 1);
                    }
                }
                
                setLinkUrl(relativePath);
            }
        } catch (error) {
            console.error('Failed to select file:', error);
        }
    }

    const handleEditorMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        setEditorMounted(true);

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

        // Register Markdown-only completion provider
        const mdKeywords = [
            // Headers
            '# ', '## ', '### ', '#### ', '##### ', '###### ',
            // Formatting
            '**bold**', '*italic*', '***bold italic***', '~~strikethrough~~', '`code`', '```\ncode block\n```',
            // Lists
            '- item', '* item', '+ item', '1. item',
            // Links and images
            '[link text](url)', '![alt text](image.url)',
            // Block quotes
            '> quote', '>> nested quote',
            // Horizontal rule
            '---', '***', '___',
            // Tables
            '| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |',
            // Line breaks
            '  \n', '\\n',
            // Escapes
            '\\\\', '\\*', '\\[', '\\]', '\\(', '\\)',
        ];

        monaco.languages.registerCompletionItemProvider('markdown', {
            provideCompletionItems: (model, position) => {
                const word = model.getWordUntilPosition(position);
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: position.column,
                };

                return {
                    suggestions: mdKeywords
                        .filter(kw => kw.toLowerCase().includes(word.word.toLowerCase()))
                        .map(kw => ({
                            label: kw,
                            kind: monaco.languages.CompletionItemKind.Snippet,
                            insertText: kw,
                            range: range,
                            sortText: '0-' + kw,
                        })),
                };
            },
            triggerCharacters: ['#', '*', '!', '[', '-', '>', '`', '|'],
        });

        // Disable Monaco's built-in drag-and-drop to allow Wails file:drop event
        const editorDom = editor.getDomNode();
        void LogMessage(`[EDITOR-MOUNT] editorDom exists: ${!!editorDom}, changed: ${editorDom !== editorDomRef.current}`);
        if (editorDom && editorDom !== editorDomRef.current) {
            void LogMessage('[EDITOR-MOUNT] Setting up editor DOM listeners');
            // Remove old listeners if editor DOM changed
            if (editorDomRef.current && dragoverHandlerRef.current && dropHandlerRef.current && editorMouseUpHandlerRef.current) {
                editorDomRef.current.removeEventListener('dragover', dragoverHandlerRef.current, { capture: true });
                editorDomRef.current.removeEventListener('drop', dropHandlerRef.current, { capture: true });
                editorDomRef.current.removeEventListener('mouseup', editorMouseUpHandlerRef.current, { capture: true });
            }

            // Create new handlers (captured in refs to prevent duplicates)
            const handleDragOver = (e: DragEvent) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            };
            const handleDrop = (e: DragEvent) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            };
              
            // Handle mouseup in capture phase to get selection before Monaco processes it
            const handleEditorMouseUp = (e: MouseEvent) => {
                void LogMessage('[EDITOR-MOUSEUP-CAPTURE] mouseup in capture phase, checking selection');
                const editor = editorRef.current;
                if (!editor) {
                    void LogMessage('[EDITOR-MOUSEUP-CAPTURE] editor is null');
                    return;
                }
                  
                const sel = editor.getSelection();
                void LogMessage(`[EDITOR-MOUSEUP-CAPTURE] selection isEmpty: ${sel?.isEmpty()}`);
                if (sel && !sel.isEmpty()) {
                    const model = editor.getModel();
                    if (model) {
                        const selectedText = model.getValueInRange(sel).trim();
                        if (selectedText) {
                            void LogMessage(`[EDITOR-MOUSEUP-CAPTURE] Selection found: "${selectedText.substring(0, 30)}..."`);
                            const POPUP_W = 290;
                            const x = Math.min(Math.max(e.clientX, 8), window.innerWidth - POPUP_W - 8);
                            const y = Math.max(Math.min(e.clientY - 48, window.innerHeight - 58), 8);
                            setAiHighlight({ start: model.getOffsetAt(sel.getStartPosition()), end: model.getOffsetAt(sel.getEndPosition()) });
                            setPopup({ x, y, text: selectedText });
                            setPopupQuestion('');
                        }
                    }
                }
            };

            dragoverHandlerRef.current = handleDragOver;
            dropHandlerRef.current = handleDrop;
            editorMouseUpHandlerRef.current = handleEditorMouseUp;
            editorDomRef.current = editorDom;

            // Add new listeners with capture phase
            editorDom.addEventListener('dragover', handleDragOver, { capture: true, passive: false });
            editorDom.addEventListener('drop', handleDrop, { capture: true, passive: false });
            editorDom.addEventListener('mouseup', handleEditorMouseUp, { capture: true, passive: false });
            void LogMessage('[EDITOR-MOUNT] Editor DOM listeners registered');

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

        // Cmd+C/X → Custom clipboard handlers
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => doCopy());
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => doCut());
        // Note: Cmd+V is handled by global onKeyDown listener in useEffect

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

            {/* Link insert dialog */}
            {showLinkDialog && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseDown={() => setShowLinkDialog(false)}>
                    <div style={{ background: 'var(--modal-bg)', color: 'var(--modal-text)', borderRadius: '8px', padding: '24px', width: '340px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid var(--modal-border)' }}
                        onMouseDown={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 16px', fontSize: '15px', color: 'var(--modal-text)' }}>リンクを挿入</h3>
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ display: 'block', fontSize: '12px', color: 'var(--modal-secondary-text)', marginBottom: '4px' }}>テキスト</label>
                            <input type="text" placeholder="リンクテキスト" value={linkText}
                                onChange={e => setLinkText(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && insertLink(linkText, linkUrl)}
                                style={{ width: '100%', padding: '8px', fontSize: '14px', border: '1px solid var(--input-border)', borderRadius: '4px', boxSizing: 'border-box', background: 'var(--input-bg)', color: 'var(--input-text)' }}
                                autoFocus />
                        </div>
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '12px', color: 'var(--modal-secondary-text)', marginBottom: '4px' }}>URL / ファイルパス</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input type="text" placeholder="https://example.com または相対パス" value={linkUrl}
                                    onChange={e => setLinkUrl(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && insertLink(linkText, linkUrl)}
                                    style={{ flex: 1, padding: '8px', fontSize: '14px', border: '1px solid var(--input-border)', borderRadius: '4px', boxSizing: 'border-box', background: 'var(--input-bg)', color: 'var(--input-text)' }} />
                                <button onClick={handleSelectFileForLink} style={{ padding: '8px 12px', fontSize: '13px', background: 'var(--input-bg)', color: 'var(--modal-text)', border: '1px solid var(--input-border)', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>📁</button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button onClick={() => setShowLinkDialog(false)} style={{ background: 'var(--input-bg)', color: 'var(--modal-text)', border: '1px solid var(--input-border)', padding: '5px 14px', borderRadius: '4px', cursor: 'pointer' }}>キャンセル</button>
                            <button onClick={() => insertLink(linkText, linkUrl)} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer' }}>挿入</button>
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
                        ) : fileWarning.type === 'tooLarge' ? (
                            <>
                                <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>ファイルが大きすぎます</h3>
                                <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--modal-secondary-text)', lineHeight: 1.5 }}>
                                    このファイルは100MBを超えているため開けません。<br />このアプリで開けるのは100MBまでです。
                                </p>
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <button onClick={() => setFileWarning(null)} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 20px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>OK</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>エラーが発生しました</h3>
                                <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--modal-secondary-text)', lineHeight: 1.5 }}>
                                    {fileWarning.type === 'error' ? fileWarning.message : 'ファイルを開くことができません。'}
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
                        <div style={{ width: '80px', height: '80px', borderRadius: '18px', backgroundImage: `url(${appIconUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', margin: '0 auto 16px', filter: colorTheme !== 'default' ? 'brightness(1.2)' : 'none' }} />
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
                                                    onPaste={async e => {
                                                        e.preventDefault();
                                                        const txt = await ClipboardGetText();
                                                        if (!txt) return;
                                                        const inp = e.currentTarget as HTMLInputElement;
                                                        const s = inp.selectionStart ?? inp.value.length;
                                                        const en = inp.selectionEnd ?? inp.value.length;
                                                        const next = inp.value.substring(0, s) + txt + inp.value.substring(en);
                                                        updateProvider(i, 'apiKey', next);
                                                    }}
                                                    placeholder="APIキーを入力..."
                                                    autoComplete="off"
                                                    style={{ width: '100%', padding: '5px 8px', fontSize: '13px', border: '1px solid var(--input-border)', borderRadius: '4px', boxSizing: 'border-box', fontFamily: 'monospace', marginBottom: '8px', background: 'var(--input-bg)', color: 'var(--input-text)' }}
                                                />
                                                {p.id === 'openai' && (
                                                    <>
                                                        <label style={{ display: 'block', fontSize: '12px', color: 'var(--modal-secondary-text)', marginBottom: '4px' }}>ベース URL (オプション)</label>
                                                        <input
                                                            name="baseUrl"
                                                            data-provider-index={i}
                                                            type="text"
                                                            value={p.baseUrl || ''}
                                                            onChange={e => updateProvider(i, 'baseUrl', e.target.value)}
                                                            placeholder="例: https://api.openai.com/v1"
                                                            autoComplete="off"
                                                            style={{ width: '100%', padding: '5px 8px', fontSize: '13px', border: '1px solid var(--input-border)', borderRadius: '4px', boxSizing: 'border-box', fontFamily: 'monospace', marginBottom: '8px', background: 'var(--input-bg)', color: 'var(--input-text)' }}
                                                        />
                                                    </>
                                                )}
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
                                dropIntoEditor: { enabled: false },
                                quickSuggestions: false,
                                suggestOnTriggerCharacters: false,
                                acceptSuggestionOnCommitCharacter: false,
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
                            {/* Toolbar */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--tab-bar-border)', background: 'var(--tab-bar-bg)', gap: '6px' }}>
                                <button
                                    onClick={async () => {
                                        const mdSource = aiResponse || (aiHistory.length > 0 ? aiHistory[0].response : '');
                                        if (mdSource) {
                                            void LogMessage(`[AI Toolbar] Copy as Markdown clicked, length: ${mdSource.length}`);
                                            try {
                                                await ClipboardSetText(mdSource);
                                                void LogMessage('[AI Toolbar] Copied full response Markdown with Wails API');
                                            } catch (err) {
                                                void LogMessage(`[AI Toolbar] Copy failed: ${err}`);
                                            }
                                        }
                                    }}
                                    style={{ fontSize: '11px', padding: '4px 8px', border: '1px solid var(--input-border)', borderRadius: '3px', background: 'var(--input-bg)', cursor: 'pointer', color: 'var(--input-text)', whiteSpace: 'nowrap' }}
                                    title="AI検索結果全体をMarkdownでコピー"
                                >
                                    📋 Copy as MD
                                </button>
                            </div>

                            {/* Response area — text selection enabled (overrides parent userSelect:none) */}
                            <div
                                ref={aiResponseAreaRef}
                                tabIndex={0}
                                onKeyDown={async e => {
                                    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        
                                        // Get selected text - copy it as-is (without HTML rendering)
                                        const sel = window.getSelection()?.toString();
                                        if (sel && sel.length > 0) {
                                            void LogMessage(`[AI Response] Cmd+C: Copy selected text, length: ${sel.length}`);
                                            try {
                                                await navigator.clipboard.writeText(sel);
                                                void LogMessage('[AI Response] Cmd+C: Copied with navigator.clipboard');
                                            } catch (err) {
                                                void LogMessage(`[AI Response] navigator.clipboard failed: ${err}`);
                                            }
                                            try {
                                                await ClipboardSetText(sel);
                                                void LogMessage('[AI Response] Cmd+C: Copied with Wails API');
                                            } catch (err) {
                                                void LogMessage(`[AI Response] Wails API failed: ${err}`);
                                            }
                                        }
                                    }
                                }}
                                onCopy={async e => {
                                    e.preventDefault();
                                    
                                    // Get selected text and copy as-is
                                    const sel = window.getSelection()?.toString();
                                    if (sel && sel.length > 0) {
                                        void LogMessage(`[AI Response] onCopy: Copying selected text, length: ${sel.length}`);
                                        try {
                                            await ClipboardSetText(sel);
                                            void LogMessage('[AI Response] onCopy: Copied with Wails API');
                                        } catch (err) {
                                            void LogMessage(`[AI Response] onCopy failed: ${err}`);
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
