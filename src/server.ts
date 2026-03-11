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
    Position
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

const vultlib = require('vultlib');

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {
    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true
            },
            definitionProvider: true,
            hoverProvider: true,
            documentSymbolProvider: true
        }
    };
    return result;
});

documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});

// A simple cache for symbols in the document
const documentSymbolsCache: Map<string, DocumentSymbol[]> = new Map();

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();
    const uri = textDocument.uri;
    const filename = uri.replace("file://", "");
    
    // 1. Run Vult Diagnostics
    const diagnostics: Diagnostic[] = [];
    try {
        const args = {
            check: true,
            files: [
                { file: filename, code: text }
            ]
        };
        
        const results = vultlib.main(args);
        
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
                        diagnostics.push(diagnostic);
                    }
                }
            }
        }
    } catch (e: any) {
        connection.console.error(`Error validating Vult: ${e.message}`);
    }
    
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

    // 2. Extract Document Symbols using Regex (since AST isn't fully exposed by vultlib JS yet)
    const symbols = extractSymbols(text);
    documentSymbolsCache.set(uri, symbols);
}

function extractSymbols(text: string): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];
    const lines = text.split(/\r?\n/);

    // Basic regexes for Vult declarations
    const funRegex = /^\\s*fun\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(([^)]*)\\)/;
    const valRegex = /^\\s*val\\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
    const memRegex = /^\\s*mem\\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
    const typeRegex = /^\\s*type\\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        let match = funRegex.exec(line);
        if (match) {
            symbols.push(createSymbol(match[1], SymbolKind.Function, i, match.index, line, match[2] ? `(${match[2]})` : '()'));
            continue;
        }

        match = valRegex.exec(line);
        if (match) {
            symbols.push(createSymbol(match[1], SymbolKind.Variable, i, match.index, line, 'val'));
            continue;
        }

        match = memRegex.exec(line);
        if (match) {
            symbols.push(createSymbol(match[1], SymbolKind.Variable, i, match.index, line, 'mem'));
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
    const range: Range = {
        start: { line, character: 0 },
        end: { line, character: text.length }
    };
    const selectionRange: Range = {
        start: { line, character: text.indexOf(name) },
        end: { line, character: text.indexOf(name) + name.length }
    };
    return {
        name,
        detail,
        kind,
        range,
        selectionRange
    };
}

// Hover Provider
connection.onHover(
    (params: TextDocumentPositionParams): Hover | null => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;

        const text = doc.getText();
        const lines = text.split(/\r?\n/);
        const line = lines[params.position.line];
        
        // Extract word at position
        const wordMatch = getWordAt(line, params.position.character);
        if (!wordMatch) return null;

        const symbols = documentSymbolsCache.get(params.textDocument.uri) || [];
        const symbol = symbols.find(s => s.name === wordMatch);

        if (symbol) {
            let signature = symbol.name;
            if (symbol.kind === SymbolKind.Function) signature = `fun ${symbol.name}${symbol.detail}`;
            else if (symbol.detail === 'val') signature = `val ${symbol.name}`;
            else if (symbol.detail === 'mem') signature = `mem ${symbol.name}`;
            else if (symbol.detail === 'type') signature = `type ${symbol.name}`;

            return {
                contents: {
                    language: 'vult',
                    value: signature
                }
            };
        }

        return null;
    }
);

// Definition Provider
connection.onDefinition(
    (params: TextDocumentPositionParams): Location | null => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;

        const text = doc.getText();
        const lines = text.split(/\r?\n/);
        const line = lines[params.position.line];
        
        const wordMatch = getWordAt(line, params.position.character);
        if (!wordMatch) return null;

        const symbols = documentSymbolsCache.get(params.textDocument.uri) || [];
        const symbol = symbols.find(s => s.name === wordMatch);

        if (symbol) {
            return {
                uri: params.textDocument.uri,
                range: symbol.selectionRange
            };
        }

        return null;
    }
);

// Document Symbol Provider
connection.onDocumentSymbol(
    (params: DocumentSymbolParams): DocumentSymbol[] => {
        return documentSymbolsCache.get(params.textDocument.uri) || [];
    }
);

// Completion Provider
connection.onCompletion(
    (textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
        const items: CompletionItem[] = [];

        // Vult Keywords
        const keywords = ['fun', 'mem', 'val', 'return', 'if', 'else', 'while', 'type', 'and', 'external'];
        keywords.forEach(kw => {
            items.push({
                label: kw,
                kind: CompletionItemKind.Keyword,
                data: 1
            });
        });

        // Vult Built-in Types
        const types = ['real', 'int', 'bool'];
        types.forEach(t => {
            items.push({
                label: t,
                kind: CompletionItemKind.Class,
                data: 2
            });
        });

        // Add Symbols from Document
        const symbols = documentSymbolsCache.get(textDocumentPosition.textDocument.uri) || [];
        symbols.forEach(sym => {
            items.push({
                label: sym.name,
                kind: sym.kind === SymbolKind.Function ? CompletionItemKind.Function :
                      sym.kind === SymbolKind.Variable ? CompletionItemKind.Variable :
                      sym.kind === SymbolKind.Class ? CompletionItemKind.Class : CompletionItemKind.Text,
                detail: sym.detail,
                data: 3
            });
        });

        return items;
    }
);

connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        if (item.data === 1) {
            item.detail = 'Vult Keyword';
        } else if (item.data === 2) {
            item.detail = 'Vult Type';
        }
        return item;
    }
);

function getWordAt(line: string, pos: number): string | null {
    // Basic identifier matching backwards and forwards
    let start = pos;
    while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) start--;
    
    let end = pos;
    while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) end++;
    
    if (start === end) return null;
    return line.substring(start, end);
}

documents.listen(connection);
connection.listen();
