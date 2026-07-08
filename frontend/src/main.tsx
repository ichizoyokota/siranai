import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'

// Bundle Monaco locally instead of loading from CDN
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

(self as any).MonacoEnvironment = {
    getWorker(_: unknown, _label: string) {
        return new editorWorker();
    }
};

loader.config({ monaco });

const container = document.getElementById('root')

const root = createRoot(container!)

root.render(
    <React.StrictMode>
        <App/>
    </React.StrictMode>
)
