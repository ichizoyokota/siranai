import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import appIcon from './assets/images/appicon.png';
import {marked} from 'marked';
marked.setOptions({ gfm: true, breaks: false });
import {GetDisplayName, GetPendingFilePath, LoadSettings, OpenFile, OpenFileByPath, PrintHTML, PrintText, QueryAI, ReopenWithEncoding, SaveFile, SaveFileWithEncoding, SaveSettings, SetDirty} from '../wailsjs/go/main/App';
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

const APP_VERSION = '0.1.3';

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
const MAX_UNDO = 100;

// Apply theme vars immediately (before first render) to avoid flash
{
    const saved = (localStorage.getItem('siranai-theme') as ColorTheme) ?? 'default';
    const vars = THEMES[saved] ?? THEMES.default;
    Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
}

function App() {
    const [markdown, setMarkdown] = useState(INITIAL_CONTENT);
    const [filePath, setFilePath] = useState("");
    const [displayPath, setDisplayPath] = useState<string | null>(null);
    const [showSearch, setShowSearch] = useState(false);
    const [showReplace, setShowReplace] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [replaceText, setReplaceText] = useState("");

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

    // Settings modal
    const [showSettings, setShowSettings] = useState(false);
    const [settingsProviders, setSettingsProviders] = useState<AIProviderConfig[]>(DEFAULT_PROVIDERS);

    // View options
    const [showLineNumbers, setShowLineNumbers] = useState(true);
    const [showPreview, setShowPreview] = useState(true);

    // Status bar
    const [cursorLine, setCursorLine] = useState(1);
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
    const markdownRef = useRef(markdown);
    // IME composition tracking
    const isComposingRef = useRef(false);
    const justFinishedCompositionRef = useRef(false);
    // Desired cursor position after content change (applied by useLayoutEffect)
    const nextCursorRef = useRef<number | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const popupQuestionRef = useRef<HTMLInputElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const isSelectingRef = useRef(false);
    const overlayRef = useRef<HTMLDivElement>(null);

    const undoStack = useRef<string[]>([INITIAL_CONTENT]);
    const redoStack = useRef<string[]>([]);
    const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lineNumbersRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isDraggingRef2 = useRef(false);
    const aiResponseAreaRef = useRef<HTMLDivElement>(null);
    const dragStartXRef = useRef(0);
    const dragStartWidthRef = useRef(0);

    useEffect(() => { filePathRef.current = filePath; }, [filePath]);
    useEffect(() => { markdownRef.current = markdown; }, [markdown]);
    useEffect(() => { void SetDirty(isDirty); }, [isDirty]);
    // Apply color theme CSS variables to document root
    useEffect(() => {
        localStorage.setItem('siranai-theme', colorTheme);
        const vars = THEMES[colorTheme];
        Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    }, [colorTheme]);
    useEffect(() => { localStorage.setItem('siranai-fontsize', String(fontSize)); }, [fontSize]);
    useEffect(() => { localStorage.setItem('siranai-fontfamily', fontFamily); }, [fontFamily]);
    // Restore cursor position after React re-render (must fire after DOM commit)
    useLayoutEffect(() => {
        if (nextCursorRef.current !== null && textareaRef.current) {
            const pos = nextCursorRef.current;
            nextCursorRef.current = null;
            textareaRef.current.selectionStart = pos;
            textareaRef.current.selectionEnd = pos;
        }
    }, [markdown]);
    // Auto-scroll AI response area to bottom when response updates
    useEffect(() => {
        const el = aiResponseAreaRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [aiResponse, aiHistory.length]);

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

    const previewHtml = marked(markdown) as string;
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

    function handleContentChange(value: string) {
        setMarkdown(value);
        setAiHighlight(null);
        setIsDirty(true);
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => {
            const top = undoStack.current[undoStack.current.length - 1];
            if (top !== value) {
                undoStack.current.push(value);
                if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
                redoStack.current = [];
            }
        }, 500);
    }

    function doUndo() {
        if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null; }
        if (undoStack.current.length <= 1) return;
        const current = undoStack.current.pop()!;
        redoStack.current.push(current);
        setMarkdown(undoStack.current[undoStack.current.length - 1]);
    }

    function doRedo() {
        if (redoStack.current.length === 0) return;
        const next = redoStack.current.pop()!;
        undoStack.current.push(next);
        setMarkdown(next);
    }

    function handleNew() {
        undoStack.current = [''];
        redoStack.current = [];
        setMarkdown('');
        setFilePath('');
        setIsDirty(false);
    }

    async function handleOpen() {
        const result = await OpenFile();
        if (result) {
            undoStack.current = [result.content];
            redoStack.current = [];
            setMarkdown(result.content);
            setFilePath(result.path);
            setFileEncoding(result.encoding ?? 'UTF-8');
            setIsDirty(false);
        }
    }

    async function handleSave() {
        const enc = fileEncoding === 'UTF-8' ? '' : fileEncoding;
        const savedPath = enc
            ? await SaveFileWithEncoding(filePathRef.current, markdownRef.current, enc)
            : await SaveFile(filePathRef.current, markdownRef.current);
        if (savedPath) { setFilePath(savedPath); setIsDirty(false); }
    }

    async function handleSaveAs() {
        const enc = fileEncoding === 'UTF-8' ? '' : fileEncoding;
        const savedPath = enc
            ? await SaveFileWithEncoding('', markdownRef.current, enc)
            : await SaveFile('', markdownRef.current);
        if (savedPath) { setFilePath(savedPath); setIsDirty(false); }
    }

    function insertPathAtCursor(path: string) {
        const ta = textareaRef.current;
        const val = markdownRef.current;
        const start = ta ? ta.selectionStart : val.length;
        const end = ta ? ta.selectionEnd : val.length;
        const next = val.substring(0, start) + path + val.substring(end);
        nextCursorRef.current = start + path.length;
        handleContentChange(next);
    }

    async function handleOpenPath(path: string) {
        try {
            const result = await OpenFileByPath(path);
            if (result) {
                undoStack.current = [result.content];
                redoStack.current = [];
                setMarkdown(result.content);
                setFilePath(result.path);
                setFileEncoding(result.encoding ?? 'UTF-8');
                setIsDirty(false);
            }
        } catch (err: any) {
            console.error('Failed to open file:', err);
        }
    }

    async function handleReopenWithEncoding(encoding: string) {
        setShowEncodingMenu(false);
        if (!filePath) {
            // ファイル未保存の場合はエンコーディングのみ変更
            setFileEncoding(encoding);
            return;
        }
        try {
            const result = await ReopenWithEncoding(filePath, encoding);
            if (result) {
                undoStack.current = [result.content];
                redoStack.current = [];
                setMarkdown(result.content);
                setFileEncoding(result.encoding ?? encoding);
            }
        } catch (err: any) {
            alert(`再読み込みエラー: ${err?.message ?? err}`);
        }
    }

    // Returns the focused input/textarea that is NOT the main editor, or null
    function activeInput(): HTMLInputElement | HTMLTextAreaElement | null {
        const el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el !== textareaRef.current) {
            return el as HTMLInputElement | HTMLTextAreaElement;
        }
        return null;
    }

    async function doCopy() {
        // Active non-editor input
        const inp = activeInput();
        if (inp) {
            const text = inp.value.substring(inp.selectionStart ?? 0, inp.selectionEnd ?? 0);
            if (text) await ClipboardSetText(text);
            return;
        }
        // Selection in any other element (e.g. AI pane)
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) {
            await ClipboardSetText(sel.toString());
            return;
        }
        // Main textarea
        const ta = textareaRef.current;
        if (!ta) return;
        const text = ta.value.substring(ta.selectionStart, ta.selectionEnd);
        if (text) await ClipboardSetText(text);
    }

    async function doCut() {
        const inp = activeInput();
        if (inp) {
            const start = inp.selectionStart ?? 0;
            const end = inp.selectionEnd ?? 0;
            const selected = inp.value.substring(start, end);
            if (!selected) return;
            await ClipboardSetText(selected);
            // insertText is the reliable way to mutate React-controlled inputs
            document.execCommand('delete');
            return;
        }
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const selected = ta.value.substring(start, end);
        if (!selected) return;
        await ClipboardSetText(selected);
        const next = markdownRef.current.substring(0, start) + markdownRef.current.substring(end);
        nextCursorRef.current = start;
        handleContentChange(next);
    }

    async function doPaste() {
        const text = await ClipboardGetText();
        if (!text) return;
        const inp = activeInput();
        if (inp) {
            // execCommand works with React-controlled inputs in WebKit
            inp.focus();
            document.execCommand('insertText', false, text);
            return;
        }
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const next = markdownRef.current.substring(0, start) + text + markdownRef.current.substring(end);
        nextCursorRef.current = start + text.length;
        handleContentChange(next);
    }

    function doSelectAll() {
        const inp = activeInput();
        if (inp) { inp.select(); return; }
        textareaRef.current?.select();
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

    function handleTextareaScroll() {
        if (overlayRef.current && textareaRef.current) {
            overlayRef.current.scrollTop = textareaRef.current.scrollTop;
        }
        if (lineNumbersRef.current && textareaRef.current) {
            lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
        }
    }

    function updateCursorLine() {
        if (textareaRef.current) {
            const pos = textareaRef.current.selectionStart;
            setCursorLine(markdown.substring(0, pos).split('\n').length);
        }
    }

    // Search / Replace
    function openFind() {
        setShowSearch(true); setShowReplace(false);
        requestAnimationFrame(() => searchInputRef.current?.focus());
    }
    function openReplace() {
        setShowSearch(true); setShowReplace(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
    }
    function closeSearch() { setShowSearch(false); textareaRef.current?.focus(); }

    function findNext() {
        const ta = textareaRef.current;
        if (!ta || !searchText) return;
        const content = ta.value;
        const from = ta.selectionEnd ?? 0;
        let idx = content.indexOf(searchText, from);
        if (idx === -1) idx = content.indexOf(searchText, 0);
        if (idx === -1) return;
        ta.focus();
        ta.selectionStart = idx;
        ta.selectionEnd = idx + searchText.length;
    }

    function doReplace() {
        const ta = textareaRef.current;
        if (!ta || !searchText) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        if (ta.value.substring(start, end) === searchText) {
            const next = markdownRef.current.substring(0, start) + replaceText + markdownRef.current.substring(end);
            handleContentChange(next);
            requestAnimationFrame(() => { ta.selectionStart = start; ta.selectionEnd = start + replaceText.length; findNext(); });
        } else {
            findNext();
        }
    }

    function doReplaceAll() {
        if (!searchText) return;
        handleContentChange(markdownRef.current.split(searchText).join(replaceText));
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

    // Text selection → popup (document-level to handle releases outside textarea)
    useEffect(() => {
        function onDocMouseUp(e: MouseEvent) {
            if (!isSelectingRef.current) return;
            isSelectingRef.current = false;
            const ta = textareaRef.current;
            if (!ta) return;
            const selStart = ta.selectionStart;
            const selEnd = ta.selectionEnd;
            const selected = ta.value.substring(selStart, selEnd).trim();
            if (!selected) { setPopup(null); setAiHighlight(null); return; }
            const POPUP_W = 290, POPUP_H = 50;
            const x = Math.min(Math.max(e.clientX, 8), window.innerWidth - POPUP_W - 8);
            const y = Math.max(Math.min(e.clientY - 48, window.innerHeight - POPUP_H - 8), 8);
            setAiHighlight({ start: selStart, end: selEnd });
            setPopup({ x, y, text: selected });
            setPopupQuestion('');
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
        void PrintText(markdownRef.current);
    }

    function handlePrint() {
        const html = marked(markdownRef.current) as string;
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
            EventsOn('menu:findNext',          () => findNext()),
            EventsOn('menu:replace',           () => openReplace()),
            EventsOn('menu:print',             () => handlePrint()),
            EventsOn('menu:printText',         () => handlePrintText()),
            EventsOn('menu:toggleLineNumbers', () => setShowLineNumbers(v => !v)),
            EventsOn('menu:togglePreview',     () => setShowPreview(v => !v)),
            EventsOn('file:open',              (path: string) => handleOpenPath(path)),
            EventsOn('file:drop',              (paths: string[]) => {
                setIsDragOver(false);
                if (!paths || paths.length === 0) return;
                if (shiftPressedRef.current) {
                    insertPathAtCursor(paths[0]);
                } else {
                    void handleOpenPath(paths[0]);
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

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        const meta = e.metaKey || e.ctrlKey;

        if (e.key === 'Tab') {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const spaces = '    ';
            nextCursorRef.current = start + spaces.length;
            handleContentChange(markdownRef.current.substring(0, start) + spaces + markdownRef.current.substring(end));
            return;
        }

        // Enter: continue Markdown prefix (list, blockquote, heading)
        // Skip during IME composition to avoid interfering with character conversion
        if (e.key === 'Enter' && !meta) {
            if (isComposingRef.current || justFinishedCompositionRef.current) return;

            const ta = e.currentTarget;
            const pos = ta.selectionStart;
            const val = markdownRef.current;
            const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
            const lineEndIdx = val.indexOf('\n', lineStart);
            const lineEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
            const currentLine = val.substring(lineStart, lineEnd);

            let m: RegExpMatchArray | null;

            // Unordered list: - / * / +
            m = currentLine.match(/^(\s*[-*+] )(.*)/);
            if (m) {
                const [, prefix, content] = m;
                e.preventDefault();
                if (!content) {
                    const next = val.substring(0, lineStart) + val.substring(lineStart + prefix.length);
                    nextCursorRef.current = lineStart;
                    handleContentChange(next);
                } else {
                    const next = val.substring(0, pos) + '\n' + prefix + val.substring(pos);
                    nextCursorRef.current = pos + 1 + prefix.length;
                    handleContentChange(next);
                }
                return;
            }

            // Ordered list: 1. / 1)
            m = currentLine.match(/^(\s*)(\d+)([.)]) (.*)/);
            if (m) {
                const [, indent, num, sep, content] = m;
                e.preventDefault();
                if (!content) {
                    const prefix = indent + num + sep + ' ';
                    const next = val.substring(0, lineStart) + val.substring(lineStart + prefix.length);
                    nextCursorRef.current = lineStart;
                    handleContentChange(next);
                } else {
                    const prefix = indent + (parseInt(num) + 1) + sep + ' ';
                    const next = val.substring(0, pos) + '\n' + prefix + val.substring(pos);
                    nextCursorRef.current = pos + 1 + prefix.length;
                    handleContentChange(next);
                }
                return;
            }

            // Blockquote: >
            m = currentLine.match(/^(> ?)(.*)/);
            if (m) {
                const [, prefix, content] = m;
                e.preventDefault();
                if (!content) {
                    const next = val.substring(0, lineStart) + val.substring(lineStart + prefix.length);
                    nextCursorRef.current = lineStart;
                    handleContentChange(next);
                } else {
                    const next = val.substring(0, pos) + '\n' + prefix + val.substring(pos);
                    nextCursorRef.current = pos + 1 + prefix.length;
                    handleContentChange(next);
                }
                return;
            }

            // Heading: # / ## / ...
            m = currentLine.match(/^(#{1,6} )(.*)/);
            if (m) {
                const [, prefix, content] = m;
                if (content) {
                    e.preventDefault();
                    const next = val.substring(0, pos) + '\n' + prefix + val.substring(pos);
                    nextCursorRef.current = pos + 1 + prefix.length;
                    handleContentChange(next);
                    return;
                }
            }
        }

        if (!meta) return;

        // Shift+Cmd+D: delete current line
        if (e.shiftKey && e.key === 'D') {
            e.preventDefault();
            const ta = e.currentTarget;
            const pos = ta.selectionStart;
            const val = markdownRef.current;
            const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
            const lineEndIdx = val.indexOf('\n', lineStart);
            if (lineEndIdx === -1) {
                // Last line — remove preceding newline too
                const next = lineStart > 0 ? val.substring(0, lineStart - 1) : '';
                nextCursorRef.current = Math.max(0, lineStart - 1);
                handleContentChange(next);
            } else {
                const next = val.substring(0, lineStart) + val.substring(lineEndIdx + 1);
                nextCursorRef.current = lineStart;
                handleContentChange(next);
            }
            return;
        }

        // Cmd+D: duplicate current line
        if (!e.shiftKey && e.key === 'd') {
            e.preventDefault();
            const ta = e.currentTarget;
            const pos = ta.selectionStart;
            const val = markdownRef.current;
            const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
            const lineEndIdx = val.indexOf('\n', lineStart);
            const lineEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
            const currentLine = val.substring(lineStart, lineEnd);
            const insert = '\n' + currentLine;
            const next = val.substring(0, lineEnd) + insert + val.substring(lineEnd);
            nextCursorRef.current = pos + insert.length;
            handleContentChange(next);
            return;
        }

        if (e.key === 'c') { e.preventDefault(); void doCopy(); return; }
        if (e.key === 'x') { e.preventDefault(); void doCut();  return; }
        if (e.key === 'v') { e.preventDefault(); void doPaste(); return; }
        if (e.key === 'a') { e.preventDefault(); doSelectAll(); return; }
    }

    function insertTable(rows: number, cols: number) {
        const headers = Array.from({ length: cols }, (_, i) => `見出し${i + 1}`);
        const header = '| ' + headers.join(' | ') + ' |';
        const sep = '|' + Array(cols).fill(' --- ').join('|') + '|';
        const emptyRow = '|' + Array(cols).fill('     ').join('|') + '|';
        const rowLines = Array(rows - 1).fill(emptyRow);
        const table = [header, sep, ...rowLines].join('\n');
        const ta = textareaRef.current;
        const val = markdownRef.current;
        const start = ta ? ta.selectionStart : val.length;
        const before = val.substring(0, start);
        const after = val.substring(ta ? ta.selectionEnd : val.length);
        const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
        const suffix = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
        const insert = prefix + table + suffix;
        nextCursorRef.current = start + insert.length;
        handleContentChange(before + insert + after);
        setShowTableDialog(false);
    }

    const charCount = markdown.length;
    const sectionCount = markdown.split('\n').filter(l => /^#{1,6}\s/.test(l)).length;
    const lines = markdown.split('\n');

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
                {displayPath && (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                        {isDirty && <span style={{ color: '#f59e0b', marginRight: '4px' }}>●</span>}
                        {displayPath}
                    </span>
                )}
                {isDirty && !displayPath && (
                    <span style={{ color: '#f59e0b' }}>● 未保存</span>
                )}
                <span style={{ marginLeft: 'auto' }}>v{APP_VERSION}</span>
            </div>

            {/* Search / Replace panel */}
            {showSearch && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 10px', borderBottom: '1px solid var(--search-border)', background: 'var(--search-bg)', color: 'var(--editor-text)' }}>
                    <input ref={searchInputRef} value={searchText} onChange={e => setSearchText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') findNext(); if (e.key === 'Escape') closeSearch(); }}
                        placeholder="検索..." style={{ padding: '2px 6px', width: '180px', background: 'var(--input-bg)', color: 'var(--editor-text)', border: '1px solid var(--input-border)', borderRadius: '3px' }} />
                    {showReplace && (
                        <input value={replaceText} onChange={e => setReplaceText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') closeSearch(); }}
                            placeholder="置換..." style={{ padding: '2px 6px', width: '180px', background: 'var(--input-bg)', color: 'var(--editor-text)', border: '1px solid var(--input-border)', borderRadius: '3px' }} />
                    )}
                    <button onClick={findNext} style={{ padding: '2px 8px', background: 'var(--input-bg)', color: 'var(--editor-text)', border: '1px solid var(--input-border)', borderRadius: '3px', cursor: 'pointer', fontSize: '12px' }}>次へ</button>
                    {showReplace && (<><button onClick={doReplace} style={{ padding: '2px 8px', background: 'var(--input-bg)', color: 'var(--editor-text)', border: '1px solid var(--input-border)', borderRadius: '3px', cursor: 'pointer', fontSize: '12px' }}>置換</button><button onClick={doReplaceAll} style={{ padding: '2px 8px', background: 'var(--input-bg)', color: 'var(--editor-text)', border: '1px solid var(--input-border)', borderRadius: '3px', cursor: 'pointer', fontSize: '12px' }}>すべて置換</button></>)}
                    <button onClick={closeSearch} style={{ marginLeft: 'auto', padding: '2px 8px', background: 'var(--input-bg)', color: 'var(--editor-text)', border: '1px solid var(--input-border)', borderRadius: '3px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                </div>
            )}

            {/* Editor + Right pane */}
            <div ref={containerRef} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    {/* Editor area */}
                    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                        {showLineNumbers && (
                            <div
                                ref={lineNumbersRef}
                                style={{ width: '44px', overflowY: 'hidden', textAlign: 'right', padding: '10px 6px 10px 0', fontSize: `${fontSize}px`, lineHeight: '1.5', fontFamily: fontFamily, color: 'var(--line-num-color)', background: 'var(--line-num-bg)', borderRight: '1px solid var(--line-num-border)', userSelect: 'none', flexShrink: 0 }}
                            >
                                {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
                            </div>
                        )}
                        <div style={{ flex: 1, position: 'relative', background: 'var(--editor-bg)' }}>
                        <textarea
                            ref={textareaRef}
                            value={markdown}
                            onChange={e => handleContentChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onCompositionStart={() => { isComposingRef.current = true; }}
                            onCompositionEnd={() => {
                                isComposingRef.current = false;
                                justFinishedCompositionRef.current = true;
                                setTimeout(() => { justFinishedCompositionRef.current = false; }, 0);
                            }}
                            onDrop={e => e.preventDefault()}
                            onMouseDown={() => { isSelectingRef.current = true; }}
                            onScroll={handleTextareaScroll}
                            onClick={updateCursorLine}
                            onKeyUp={updateCursorLine}
                            onSelect={updateCursorLine}
                            style={{ position: 'absolute', inset: 0, padding: '10px', fontSize: `${fontSize}px`, lineHeight: '1.5', resize: 'none', fontFamily: fontFamily, border: 'none', outline: 'none', background: 'transparent', color: 'var(--editor-text)', caretColor: 'var(--editor-text)', boxSizing: 'border-box', width: '100%', height: '100%' }}
                            placeholder="Enter your markdown here..."
                        />
                        {aiHighlight && (
                            <div
                                ref={overlayRef}
                                style={{ position: 'absolute', inset: 0, padding: '10px', fontSize: `${fontSize}px`, lineHeight: '1.5', fontFamily: fontFamily, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', color: 'transparent', pointerEvents: 'none', overflow: 'hidden', boxSizing: 'border-box' }}
                            >
                                {markdown.substring(0, aiHighlight.start)}
                                <span style={{ borderBottom: '2px solid #f97316', display: 'inline' }}>
                                    {markdown.substring(aiHighlight.start, aiHighlight.end)}
                                </span>
                                {markdown.substring(aiHighlight.end)}
                            </div>
                        )}
                        </div>
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
                        <div style={{ flex: 1, padding: '10px', overflowY: 'auto', textAlign: 'left', background: 'var(--editor-bg)', color: 'var(--editor-text)' }}>
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
                                        if (sel) await ClipboardSetText(sel);
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
                                                if (meta && e.key === 'v') {
                                                    e.preventDefault();
                                                    // capture DOM ref and positions BEFORE await (e.currentTarget becomes null after await)
                                                    const ta = e.currentTarget as HTMLTextAreaElement;
                                                    const start = ta.selectionStart ?? 0;
                                                    const end = ta.selectionEnd ?? 0;
                                                    const text = await ClipboardGetText();
                                                    if (!text) return;
                                                    setAiQuestion(q => q.substring(0, start) + text + q.substring(end));
                                                    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + text.length; });
                                                    return;
                                                }
                                                if (meta && e.key === 'a') { e.preventDefault(); e.currentTarget.select(); return; }
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
