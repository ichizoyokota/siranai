import {useEffect, useRef, useState} from 'react';
import {marked} from 'marked';
import {LoadSettings, OpenFile, QueryAI, ReopenWithEncoding, SaveFile, SaveFileWithEncoding, SaveSettings} from '../wailsjs/go/main/App';
import {ClipboardGetText, ClipboardSetText, EventsOn, WindowSetTitle} from '../wailsjs/runtime/runtime';
import './App.css';

type ViewMode = 'preview' | 'ai';

interface AIProviderConfig {
    id: string;
    name: string;
    apiKey: string;
    model: string;
    enabled: boolean;
}

const PROVIDER_MODELS: Record<string, string[]> = {
    gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini'],
    claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
};

const DEFAULT_PROVIDERS: AIProviderConfig[] = [
    { id: 'gemini', name: 'Gemini', apiKey: '', model: 'gemini-2.0-flash', enabled: false },
    { id: 'openai', name: 'ChatGPT (OpenAI)', apiKey: '', model: 'gpt-4o', enabled: false },
    { id: 'claude', name: 'Claude (Anthropic)', apiKey: '', model: 'claude-sonnet-4-6', enabled: false },
];

const INITIAL_CONTENT = "# Hello SIRANAI\n\nStart typing your markdown here...";
const MAX_UNDO = 100;

function App() {
    const [markdown, setMarkdown] = useState(INITIAL_CONTENT);
    const [filePath, setFilePath] = useState("");
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

    // Encoding
    const [fileEncoding, setFileEncoding] = useState('UTF-8');
    const [showEncodingMenu, setShowEncodingMenu] = useState(false);

    // Settings modal
    const [showSettings, setShowSettings] = useState(false);
    const [settingsProviders, setSettingsProviders] = useState<AIProviderConfig[]>(DEFAULT_PROVIDERS);

    const filePathRef = useRef(filePath);
    const markdownRef = useRef(markdown);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const popupQuestionRef = useRef<HTMLInputElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const isSelectingRef = useRef(false);
    const overlayRef = useRef<HTMLDivElement>(null);

    const undoStack = useRef<string[]>([INITIAL_CONTENT]);
    const redoStack = useRef<string[]>([]);
    const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { filePathRef.current = filePath; }, [filePath]);
    useEffect(() => { markdownRef.current = markdown; }, [markdown]);

    // Load settings on mount
    useEffect(() => {
        LoadSettings().then(s => {
            if (s?.providers && s.providers.length > 0) {
                setSettingsProviders(s.providers as AIProviderConfig[]);
            }
        });
    }, []);

    const previewHtml = marked(markdown) as string;
    const fileName = filePath ? filePath.split('/').pop()! : null;

    useEffect(() => {
        WindowSetTitle(fileName ? `SIRANAI — ${fileName}` : 'SIRANAI');
    }, [fileName]);

    function handleContentChange(value: string) {
        setMarkdown(value);
        setAiHighlight(null);
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

    async function handleOpen() {
        const result = await OpenFile();
        if (result) {
            undoStack.current = [result.content];
            redoStack.current = [];
            setMarkdown(result.content);
            setFilePath(result.path);
            setFileEncoding(result.encoding ?? 'UTF-8');
        }
    }

    async function handleSave() {
        const enc = fileEncoding === 'UTF-8' ? '' : fileEncoding;
        const savedPath = enc
            ? await SaveFileWithEncoding(filePathRef.current, markdownRef.current, enc)
            : await SaveFile(filePathRef.current, markdownRef.current);
        if (savedPath) setFilePath(savedPath);
    }

    async function handleSaveAs() {
        const enc = fileEncoding === 'UTF-8' ? '' : fileEncoding;
        const savedPath = enc
            ? await SaveFileWithEncoding('', markdownRef.current, enc)
            : await SaveFile('', markdownRef.current);
        if (savedPath) setFilePath(savedPath);
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
        handleContentChange(next);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start; });
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
        handleContentChange(next);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + text.length; });
    }

    function doSelectAll() {
        const inp = activeInput();
        if (inp) { inp.select(); return; }
        textareaRef.current?.select();
    }

    function handleTextareaScroll() {
        if (overlayRef.current && textareaRef.current) {
            overlayRef.current.scrollTop = textareaRef.current.scrollTop;
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

    // AI query
    async function handleAIQuery(providerID: string) {
        if (!popup) return;
        const { text } = popup;
        const question = popupQuestion;
        const provider = settingsProviders.find(p => p.id === providerID);
        setPopup(null);
        setAiLoading(true);
        setViewMode('ai');
        setAiResponse('');
        setAiError('');
        setAiProviderName(provider?.name ?? providerID);
        try {
            const result = await QueryAI(text, question, providerID);
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

    // Menu events
    useEffect(() => {
        const offs = [
            EventsOn('menu:open',      () => handleOpen()),
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
        ];
        return () => offs.forEach(off => off());
    }, []);

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        const meta = e.metaKey || e.ctrlKey;
        if (e.key === 'Tab') {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const spaces = '    ';
            handleContentChange(markdown.substring(0, start) + spaces + markdown.substring(end));
            requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + spaces.length; });
            return;
        }
        if (!meta) return;
        if (e.key === 'c') { e.preventDefault(); void doCopy(); return; }
        if (e.key === 'x') { e.preventDefault(); void doCut();  return; }
        if (e.key === 'v') { e.preventDefault(); void doPaste(); return; }
        if (e.key === 'a') { e.preventDefault(); doSelectAll(); return; }
    }

    const tabStyle = (mode: ViewMode) => ({
        flex: 1, padding: '4px', border: 'none',
        borderBottom: viewMode === mode ? '2px solid #2563eb' : '2px solid transparent',
        background: 'none', cursor: 'pointer',
        fontWeight: viewMode === mode ? 'bold' : 'normal',
    } as React.CSSProperties);

    return (
        <div id="App" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>

            {/* Settings modal */}
            {showSettings && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseDown={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
                    <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', width: '480px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
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
                        <h3 style={{ margin: '0 0 16px' }}>AI設定</h3>
                        <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
                            {settingsProviders.map((p, i) => (
                                <div key={p.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px', marginBottom: '12px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: p.enabled ? '12px' : 0 }}>
                                        <input type="checkbox" checked={p.enabled} onChange={e => updateProvider(i, 'enabled', e.target.checked)} />
                                        <span style={{ fontWeight: 600, fontSize: '14px' }}>{p.name}</span>
                                        {p.enabled && p.apiKey && <span style={{ fontSize: '11px', color: '#16a34a', marginLeft: 'auto' }}>✓ 設定済み</span>}
                                    </label>
                                    {p.enabled && (
                                        <>
                                            <label style={{ display: 'block', fontSize: '12px', color: '#555', marginBottom: '4px' }}>API キー</label>
                                            <input
                                                name="apiKey"
                                                data-provider-index={i}
                                                type="text"
                                                value={p.apiKey}
                                                onChange={e => updateProvider(i, 'apiKey', e.target.value)}
                                                placeholder="APIキーを入力..."
                                                autoComplete="off"
                                                style={{ width: '100%', padding: '5px 8px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', fontFamily: 'monospace', marginBottom: '8px' }}
                                            />
                                            <label style={{ display: 'block', fontSize: '12px', color: '#555', marginBottom: '4px' }}>モデル</label>
                                            <input
                                                name="model"
                                                data-provider-index={i}
                                                list={`models-${p.id}`}
                                                value={p.model}
                                                onChange={e => updateProvider(i, 'model', e.target.value)}
                                                style={{ width: '100%', padding: '5px 8px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                                            />
                                            <datalist id={`models-${p.id}`}>
                                                {(PROVIDER_MODELS[p.id] ?? []).map(m => <option key={m} value={m} />)}
                                            </datalist>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
                            <button onClick={() => setShowSettings(false)}>キャンセル</button>
                            <button onClick={handleSaveSettings} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer' }}>保存</button>
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

            {/* Search / Replace panel */}
            {showSearch && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 10px', borderBottom: '1px solid #ccc', background: '#fffbe6' }}>
                    <input ref={searchInputRef} value={searchText} onChange={e => setSearchText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') findNext(); if (e.key === 'Escape') closeSearch(); }}
                        placeholder="検索..." style={{ padding: '2px 6px', width: '180px' }} />
                    {showReplace && (
                        <input value={replaceText} onChange={e => setReplaceText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') closeSearch(); }}
                            placeholder="置換..." style={{ padding: '2px 6px', width: '180px' }} />
                    )}
                    <button onClick={findNext}>次へ</button>
                    {showReplace && (<><button onClick={doReplace}>置換</button><button onClick={doReplaceAll}>すべて置換</button></>)}
                    <button onClick={closeSearch} style={{ marginLeft: 'auto' }}>✕</button>
                </div>
            )}

            {/* Editor + Right pane */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #ccc' }}>
                    {/* Editor area */}
                    <div style={{ flex: 1, position: 'relative' }}>
                        <textarea
                            ref={textareaRef}
                            value={markdown}
                            onChange={e => handleContentChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onMouseDown={() => { isSelectingRef.current = true; }}
                            onScroll={handleTextareaScroll}
                            style={{ position: 'absolute', inset: 0, padding: '10px', fontSize: '16px', lineHeight: '1.5', resize: 'none', fontFamily: 'monospace', border: 'none', outline: 'none', background: 'transparent', boxSizing: 'border-box', width: '100%', height: '100%' }}
                            placeholder="Enter your markdown here..."
                        />
                        {aiHighlight && (
                            <div
                                ref={overlayRef}
                                style={{ position: 'absolute', inset: 0, padding: '10px', fontSize: '16px', lineHeight: '1.5', fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', color: 'transparent', pointerEvents: 'none', overflow: 'hidden', boxSizing: 'border-box' }}
                            >
                                {markdown.substring(0, aiHighlight.start)}
                                <span style={{ borderBottom: '2px solid #f97316', display: 'inline' }}>
                                    {markdown.substring(aiHighlight.start, aiHighlight.end)}
                                </span>
                                {markdown.substring(aiHighlight.end)}
                            </div>
                        )}
                    </div>
                    {/* Encoding status bar */}
                    <div style={{ position: 'relative', height: '24px', display: 'flex', alignItems: 'center', padding: '0 8px', background: '#f3f4f6', borderTop: '1px solid #e5e7eb', fontSize: '11px', color: '#6b7280' }}>
                        <span style={{ marginRight: '4px' }}>文字コード:</span>
                        <button
                            id="encoding-btn"
                            onClick={() => setShowEncodingMenu(v => !v)}
                            style={{ fontSize: '11px', padding: '1px 6px', border: '1px solid #d1d5db', borderRadius: '3px', background: '#fff', cursor: 'pointer', color: '#374151' }}
                        >{fileEncoding} ▾</button>
                        {showEncodingMenu && (
                            <div
                                id="encoding-menu"
                                style={{ position: 'absolute', bottom: '26px', left: '8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 500, minWidth: '180px', overflow: 'hidden' }}
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
                                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', border: 'none', background: fileEncoding === label ? '#eff6ff' : 'none', cursor: 'pointer', fontSize: '12px', color: fileEncoding === label ? '#2563eb' : '#374151' }}
                                    >
                                        <span style={{ fontWeight: 600 }}>{label}</span>
                                        <span style={{ marginLeft: '8px', color: '#9ca3af', fontSize: '11px' }}>{desc}</span>
                                    </button>
                                ))}
                                {filePath && (
                                    <div style={{ borderTop: '1px solid #e5e7eb', padding: '5px 12px', fontSize: '10px', color: '#9ca3af' }}>
                                        クリックでファイルを再読み込み
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Tab bar */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #eee', background: '#fafafa' }}>
                        <button style={tabStyle('preview')} onClick={() => setViewMode('preview')}>Preview</button>
                        <button style={tabStyle('ai')} onClick={() => setViewMode('ai')}>
                            AI {aiLoading ? '⏳' : aiResponse ? '●' : ''}
                        </button>
                        <button onClick={() => setShowSettings(true)}
                            style={{ padding: '4px 8px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px' }} title="設定">⚙</button>
                    </div>

                    {/* Preview */}
                    {viewMode === 'preview' && (
                        <div style={{ flex: 1, padding: '10px', overflowY: 'auto', textAlign: 'left' }}>
                            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                        </div>
                    )}

                    {/* AI response */}
                    {viewMode === 'ai' && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {(aiResponse || aiError || aiLoading) && (
                                <div style={{ padding: '4px 8px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {aiProviderName && <span style={{ fontSize: '11px', color: '#6b7280', flex: 1 }}>{aiProviderName}</span>}
                                    {(aiResponse || aiError) && !aiLoading && (
                                        <button
                                            onClick={() => ClipboardSetText(aiResponse || aiError)}
                                            style={{ fontSize: '12px', padding: '2px 8px', cursor: 'pointer', marginLeft: 'auto' }}
                                        >コピー</button>
                                    )}
                                </div>
                            )}
                            <div
                                tabIndex={0}
                                onKeyDown={async e => {
                                    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
                                        e.preventDefault();
                                        const sel = window.getSelection()?.toString();
                                        if (sel) await ClipboardSetText(sel);
                                    }
                                }}
                                style={{ flex: 1, padding: '10px', overflowY: 'auto', textAlign: 'left', outline: 'none', userSelect: 'text' }}
                            >
                                {aiLoading && <p style={{ color: '#888' }}>AIに問い合わせ中...</p>}
                                {!aiLoading && !aiResponse && !aiError && (
                                    <p style={{ color: '#aaa', fontSize: '13px' }}>テキストを選択して「AIに聞く」を押すと結果がここに表示されます。</p>
                                )}
                                {!aiLoading && aiError && (
                                    <p style={{ color: '#dc2626', whiteSpace: 'pre-wrap' }}>{aiError}</p>
                                )}
                                {!aiLoading && aiResponse && (
                                    <div dangerouslySetInnerHTML={{ __html: marked(aiResponse) as string }} />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;
