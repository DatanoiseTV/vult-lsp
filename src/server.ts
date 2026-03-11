import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    InitializeResult,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    Location,
    Hover,
    DocumentSymbolParams,
    DocumentSymbol,
    SymbolKind,
    Range,
    Position,
    RenameParams,
    WorkspaceEdit,
    TextEdit,
    ReferenceParams,
    SignatureHelpParams,
    SignatureHelp,
    SignatureInformation,
    ParameterInformation,
    DocumentFormattingParams,
    DidChangeWatchedFilesParams
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';

const fg = require('fast-glob');
const vultlib = require('vultlib');

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceFolders: string[] = [];
// Store raw code for all workspace files
const workspaceFiles: Map<string, string> = new Map();
// Store parsed symbols for all workspace files
const workspaceSymbols: Map<string, DocumentSymbol[]> = new Map();

connection.onInitialize((params: InitializeParams) => {
    if (params.workspaceFolders) {
        workspaceFolders = params.workspaceFolders.map(f => URI.parse(f.uri).fsPath);
    }

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true
            },
            definitionProvider: true,
            hoverProvider: true,
            documentSymbolProvider: true,
            renameProvider: true,
            referencesProvider: true,
            signatureHelpProvider: {
                triggerCharacters: ['(', ',']
            },
            documentFormattingProvider: true,
        }
    };
    return result;
});

connection.onInitialized(async () => {
    // Scan the workspace for all `.vult` files
    for (const folder of workspaceFolders) {
        const files = await fg('**/*.vult', { cwd: folder, absolute: true });
        for (const file of files) {
            const uri = URI.file(file).toString();
            try {
                const code = fs.readFileSync(file, 'utf8');
                workspaceFiles.set(uri, code);
                workspaceSymbols.set(uri, extractSymbols(code));
            } catch (e) {
                connection.console.warn(`Failed to read file ${file}`);
            }
        }
    }
});

documents.onDidChangeContent(change => {
    const uri = change.document.uri;
    const text = change.document.getText();
    workspaceFiles.set(uri, text);
    workspaceSymbols.set(uri, extractSymbols(text));
    
    validateWorkspace();
});

// A debouncer could be added here, but for simplicity we run immediately
async function validateWorkspace(): Promise<void> {
    const filesToCompile: any[] = [];
    
    // Pass all known workspace files to the compiler to resolve cross-file references
    for (const [uri, code] of workspaceFiles.entries()) {
        const filename = URI.parse(uri).fsPath;
        filesToCompile.push({ file: filename, code });
    }

    if (filesToCompile.length === 0) return;

    try {
        const args = {
            check: true,
            files: filesToCompile
        };
        
        const results = vultlib.main(args);
        const diagnosticsMap = new Map<string, Diagnostic[]>();
        
        for (const uri of workspaceFiles.keys()) {
            diagnosticsMap.set(uri, []);
        }
        
        if (results && Array.isArray(results)) {
            for (const result of results) {
                if (result.errors) {
                    for (const err of result.errors) {
                        const line = Math.max(0, err.line - 1);
                        const col = Math.max(0, err.col - 1);
                        const length = err.indicator ? err.indicator.length : 1;
                        
                        const diagnostic: Diagnostic = {
                            severity: DiagnosticSeverity.Error,
                            range: {
                                start: { line, character: col },
                                end: { line, character: col + length }
                            },
                            message: err.msg,
                            source: 'vult'
                        };
                        
                        // Map the error back to the correct file URI
                        const errFilename = err.file;
                        let targetUri = "";
                        for (const uri of workspaceFiles.keys()) {
                            if (URI.parse(uri).fsPath === errFilename) {
                                targetUri = uri;
                                break;
                            }
                        }
                        
                        if (targetUri && diagnosticsMap.has(targetUri)) {
                            diagnosticsMap.get(targetUri)!.push(diagnostic);
                        }
                    }
                }
            }
        }
        
        // Send diagnostics for all files
        for (const [uri, diagnostics] of diagnosticsMap.entries()) {
            connection.sendDiagnostics({ uri, diagnostics });
        }
        
    } catch (e: any) {
        connection.console.error(`Error validating Vult workspace: ${e.message}`);
    }
}

// Pseudo AST Extractor via Regex
function extractSymbols(text: string): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];
    const lines = text.split(/\r?\n/);

    const funRegex = /^\s*(fun|and|external)\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*\(([^)]*)\)/;
    const valRegex = /^\s*(val|table)\s+([^;=]+)/;
    const memRegex = /^\s*mem\s+([^;=]+)/;
    const typeRegex = /^\s*type\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        let match = funRegex.exec(line);
        if (match) {
            const fullName = match[2];
            const shortName = fullName.split('.').pop() || fullName;
            symbols.push(createSymbol(shortName, SymbolKind.Function, i, match.index, line, match[3] ? `(${match[3]})` : '()'));
            continue;
        }

        match = valRegex.exec(line);
        if (match) {
            const vars = match[2].split(',').map(s => s.trim().split(/\s/)[0].replace(/:.*$/, ''));
            vars.forEach(v => {
                if (v && /[a-zA-Z_]/.test(v)) {
                    symbols.push(createSymbol(v, SymbolKind.Variable, i, match!.index, line, match![1]));
                }
            });
            continue;
        }

        match = memRegex.exec(line);
        if (match) {
            const vars = match[1].split(',').map(s => s.trim().split(/\s/)[0].replace(/:.*$/, ''));
            vars.forEach(v => {
                if (v && /[a-zA-Z_]/.test(v)) {
                    symbols.push(createSymbol(v, SymbolKind.Variable, i, match!.index, line, 'mem'));
                }
            });
            continue;
        }

        match = typeRegex.exec(line);
        if (match) {
            symbols.push(createSymbol(match[1], SymbolKind.Class, i, match.index, line, 'type'));
            continue;
        }
    }

    return symbols;
}

function createSymbol(name: string, kind: SymbolKind, line: number, character: number, text: string, detail: string): DocumentSymbol {
    const selectionStart = text.indexOf(name);
    return {
        name,
        detail,
        kind,
        range: {
            start: { line, character: 0 },
            end: { line, character: text.length }
        },
        selectionRange: {
            start: { line, character: selectionStart > -1 ? selectionStart : 0 },
            end: { line, character: selectionStart > -1 ? selectionStart + name.length : name.length }
        }
    };
}

// Hover Provider (Searches all workspace symbols)
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
    const uri = params.textDocument.uri;
    const doc = documents.get(uri);
    const docText = doc ? doc.getText() : workspaceFiles.get(uri);
    if (!docText) return null;

    const lines = docText.split(/\r?\n/);
    const line = lines[params.position.line];
    const wordMatch = getWordAt(line, params.position.character);
    if (!wordMatch) return null;

    // Search local first
    const localSymbols = workspaceSymbols.get(uri) || (doc ? extractSymbols(docText) : []);
    let symbol = localSymbols.find(s => s.name === wordMatch);

    if (!symbol) {
        for (const [otherUri, symbols] of workspaceSymbols.entries()) {
            if (otherUri === uri) continue;
            symbol = symbols.find(s => s.name === wordMatch);
            if (symbol) break;
        }
    }

    if (symbol) {
        let signature = symbol.name;
        if (symbol.kind === SymbolKind.Function) signature = `fun ${symbol.name}${symbol.detail}`;
        else if (symbol.detail === 'val') signature = `val ${symbol.name}`;
        else if (symbol.detail === 'mem') signature = `mem ${symbol.name}`;
        else if (symbol.detail === 'type') signature = `type ${symbol.name}`;

        return {
            contents: { language: 'vult', value: signature }
        };
    }
    return null;
});

// Definition Provider (Searches all workspace symbols)
connection.onDefinition((params: TextDocumentPositionParams): Location | null => {
    const uri = params.textDocument.uri;
    const doc = documents.get(uri);
    const docText = doc ? doc.getText() : workspaceFiles.get(uri);
    if (!docText) return null;

    const lines = docText.split(/\r?\n/);
    const wordMatch = getWordAt(lines[params.position.line], params.position.character);
    if (!wordMatch) return null;

    // 1. Search the current document first!
    const localSymbols = workspaceSymbols.get(uri) || (doc ? extractSymbols(docText) : []);
    const localSymbol = localSymbols.find(s => s.name === wordMatch);
    if (localSymbol) {
        return { uri, range: localSymbol.selectionRange };
    }

    // 2. Search other documents
    for (const [otherUri, symbols] of workspaceSymbols.entries()) {
        if (otherUri === uri) continue;
        const symbol = symbols.find(s => s.name === wordMatch);
        if (symbol) {
            return { uri: otherUri, range: symbol.selectionRange };
        }
    }
    return null;
});

// Document Symbol Provider
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
    return workspaceSymbols.get(params.textDocument.uri) || [];
});

// Completion Provider (Includes workspace-wide functions and types)
connection.onCompletion((pos: TextDocumentPositionParams): CompletionItem[] => {
    const items: CompletionItem[] = [];
    const keywords = ['fun', 'mem', 'val', 'return', 'if', 'else', 'while', 'type', 'and', 'external'];
    
    keywords.forEach(kw => items.push({ label: kw, kind: CompletionItemKind.Keyword, data: 1 }));
    ['real', 'int', 'bool'].forEach(t => items.push({ label: t, kind: CompletionItemKind.Class, data: 2 }));

    const addedSymbols = new Set<string>();
    for (const symbols of workspaceSymbols.values()) {
        symbols.forEach(sym => {
            if (!addedSymbols.has(sym.name)) {
                addedSymbols.add(sym.name);
                items.push({
                    label: sym.name,
                    kind: sym.kind === SymbolKind.Function ? CompletionItemKind.Function :
                          sym.kind === SymbolKind.Variable ? CompletionItemKind.Variable :
                          sym.kind === SymbolKind.Class ? CompletionItemKind.Class : CompletionItemKind.Text,
                    detail: sym.detail,
                    data: 3
                });
            }
        });
    }
    return items;
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    if (item.data === 1) item.detail = 'Vult Keyword';
    else if (item.data === 2) item.detail = 'Vult Type';
    return item;
});

// Rename Provider
connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
    const docText = workspaceFiles.get(params.textDocument.uri);
    if (!docText) return null;

    const lines = docText.split(/\r?\n/);
    const oldName = getWordAt(lines[params.position.line], params.position.character);
    if (!oldName) return null;

    const newName = params.newName;
    const workspaceEdit: WorkspaceEdit = { changes: {} };

    // Search and replace across all workspace files
    for (const [uri, text] of workspaceFiles.entries()) {
        const textEdits: TextEdit[] = [];
        const fileLines = text.split(/\r?\n/);
        
        for (let i = 0; i < fileLines.length; i++) {
            const line = fileLines[i];
            let startIndex = 0;
            let index;
            // Simple word boundary replacement
            const regex = new RegExp(`\\b${oldName}\\b`, 'g');
            while ((index = regex.exec(line)) !== null) {
                textEdits.push({
                    range: {
                        start: { line: i, character: index.index },
                        end: { line: i, character: index.index + oldName.length }
                    },
                    newText: newName
                });
            }
        }
        
        if (textEdits.length > 0) {
            workspaceEdit.changes![uri] = textEdits;
        }
    }

    return workspaceEdit;
});

// References Provider
connection.onReferences((params: ReferenceParams): Location[] => {
    const docText = workspaceFiles.get(params.textDocument.uri);
    if (!docText) return [];

    const lines = docText.split(/\r?\n/);
    const targetWord = getWordAt(lines[params.position.line], params.position.character);
    if (!targetWord) return [];

    const references: Location[] = [];

    for (const [uri, text] of workspaceFiles.entries()) {
        const fileLines = text.split(/\r?\n/);
        for (let i = 0; i < fileLines.length; i++) {
            const line = fileLines[i];
            const regex = new RegExp(`\\b${targetWord}\\b`, 'g');
            let match;
            while ((match = regex.exec(line)) !== null) {
                references.push({
                    uri,
                    range: {
                        start: { line: i, character: match.index },
                        end: { line: i, character: match.index + targetWord.length }
                    }
                });
            }
        }
    }

    return references;
});

// Signature Help Provider
connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp | null => {
    const uri = params.textDocument.uri;
    const doc = documents.get(uri);
    const docText = doc ? doc.getText() : workspaceFiles.get(uri);
    if (!docText) return null;

    const lines = docText.split(/\r?\n/);
    const line = lines[params.position.line].substring(0, params.position.character);
    
    // Reverse find the function name being called
    const match = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*$/.exec(line);
    if (!match) return null;

    const funcName = match[1];
    
    // 1. Search the current document first!
    const localSymbols = workspaceSymbols.get(uri) || (doc ? extractSymbols(docText) : []);
    let targetSymbol = localSymbols.find(s => s.name === funcName && s.kind === SymbolKind.Function) || null;

    // 2. Search other documents if not found locally
    if (!targetSymbol) {
        for (const [otherUri, symbols] of workspaceSymbols.entries()) {
            if (otherUri === uri) continue;
            targetSymbol = symbols.find(s => s.name === funcName && s.kind === SymbolKind.Function) || null;
            if (targetSymbol) break;
        }
    }

    if (targetSymbol && targetSymbol.detail) {
        // Extract args from detail, e.g. "(x, y, z)"
        const argsStr = targetSymbol.detail.replace(/[()]/g, '');
        const args = argsStr.split(',').map(a => a.trim()).filter(a => a.length > 0);
        
        const paramsInfo: ParameterInformation[] = args.map(arg => ({ label: arg }));
        
        // Count commas to determine active parameter
        const commas = (line.match(/,/g) || []).length;

        return {
            signatures: [{
                label: `${funcName}(${argsStr})`,
                parameters: paramsInfo
            }],
            activeSignature: 0,
            activeParameter: Math.min(commas, Math.max(0, args.length - 1))
        };
    }

    return null;
});

// Basic Code Formatter (Auto-indentation based on braces)
connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
    const uri = params.textDocument.uri;
    const doc = documents.get(uri);
    const docText = doc ? doc.getText() : workspaceFiles.get(uri);
    if (!docText) return [];

    const lines = docText.split(/\r?\n/);
    const edits: TextEdit[] = [];
    let indentLevel = 0;
    let inBlockComment = false;
    const tabSize = params.options.tabSize;
    const insertSpaces = params.options.insertSpaces;
    const indentChar = insertSpaces ? ' '.repeat(tabSize) : '\t';

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        if (line === '') {
            if (lines[i].length > 0) {
                edits.push({
                    range: {
                        start: { line: i, character: 0 },
                        end: { line: i, character: lines[i].length }
                    },
                    newText: ''
                });
            }
            continue;
        }

        let cleanLine = line;

        if (inBlockComment) {
            let endIdx = cleanLine.indexOf('*/');
            if (endIdx !== -1) {
                inBlockComment = false;
                cleanLine = cleanLine.substring(endIdx + 2);
            } else {
                cleanLine = '';
            }
        }

        if (!inBlockComment) {
            cleanLine = cleanLine.replace(/\/\/.*$/, '');
            cleanLine = cleanLine.replace(/"(?:[^"\\]|\\.)*"/g, '');

            while (cleanLine.indexOf('/*') !== -1) {
                let startIdx = cleanLine.indexOf('/*');
                let endIdx = cleanLine.indexOf('*/', startIdx + 2);
                if (endIdx !== -1) {
                    cleanLine = cleanLine.substring(0, startIdx) + cleanLine.substring(endIdx + 2);
                } else {
                    inBlockComment = true;
                    cleanLine = cleanLine.substring(0, startIdx);
                    break;
                }
            }
        }

        cleanLine = cleanLine.trim();
        
        let opens = (cleanLine.match(/\{/g) || []).length;
        let closes = (cleanLine.match(/\}/g) || []).length;

        const startsWithClose = /^[}\]]/.test(cleanLine);
        
        let currentIndent = indentLevel;
        if (startsWithClose) {
            currentIndent = Math.max(0, currentIndent - 1);
            closes--; 
        }

        let newText = (currentIndent > 0 ? indentChar.repeat(currentIndent) : '') + line;
        
        if (inBlockComment && line.startsWith('*')) {
            newText = ' ' + newText;
        }

        if (lines[i] !== newText) {
            edits.push({
                range: {
                    start: { line: i, character: 0 },
                    end: { line: i, character: lines[i].length }
                },
                newText: newText
            });
        }

        indentLevel = currentIndent + opens - closes;
        indentLevel = Math.max(0, indentLevel);
    }

    return edits;
});

function getWordAt(line: string, pos: number): string | null {
    let start = pos;
    while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) start--;
    let end = pos;
    while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) end++;
    if (start === end) return null;
    return line.substring(start, end);
}

documents.listen(connection);
connection.listen();
