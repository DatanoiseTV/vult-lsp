# Vult Language Server & VSCode Extension

This project provides a full Language Server (LSP) and a VSCode extension for the Vult DSP language. It offers a professional IDE experience similar to `clangd` but specifically tailored for Vult developers.

## Features

- **Syntax Highlighting**: Full syntax coloring for `.vult` files.
- **Real-time Diagnostics**: Instant cross-file compile errors and warnings powered by the Vult compiler engine.
- **Smart Code Completion**: Context-aware suggestions for Vult keywords, built-in types, and all user-defined functions/variables across your workspace.
- **Go to Definition**: Jump to the source of any function, memory block, or variable—even if defined in another file.
- **Hover Support**: View function signatures and variable types by simply hovering your mouse over them.
- **Signature Help**: Interactive parameter hints that appear as you type function arguments, highlighting the current parameter.
- **Workspace-wide Rename**: Rename a function or variable project-wide (`F2`), updating all references automatically.
- **Find All References**: Quickly see every usage of a specific symbol across all your `.vult` files.
- **Document Symbols**: A clean "Outline" view of your file's structure, including functions, types, and state variables.
- **Intelligent Formatter**: A robust code formatter (`Shift+Alt+F`) that handles complex indentation, ignores braces inside strings/comments, and collapses consecutive empty lines for a cleaner codebase.

## Installation for VSCode

1. **Build the project**:
   ```bash
   cd vult-lsp
   npm install
   npm run build
   ```

2. **Link to VSCode**:
   Run the following command to link this extension to your VSCode extensions folder:
   
   **macOS / Linux**:
   ```bash
   ln -s "$(pwd)" ~/.vscode/extensions/vult-lsp
   ```
   
   **Windows (PowerShell)**:
   ```powershell
   New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.vscode\extensions\vult-lsp" -Target (Get-Location).Path
   ```

3. **Restart VSCode**:
   Reopen VSCode, and it will automatically detect the new extension for any `.vult` files.

## Integrating with Monaco Editor or Custom IDEs

The Vult LSP is built on standard `vscode-languageserver` technologies and communicates over Standard IO (stdio) by default. This makes it highly portable to web-based and custom IDEs.

### Running the Server

To start the language server as a standalone process (which most editors expect):
```bash
node out/server.js --stdio
```

### Monaco Editor Integration (Web)

To integrate this LSP into the **Monaco Editor** (the engine behind VSCode) running in a browser, you typically use `monaco-languageclient` and a WebSocket wrapper to tunnel the STDIO connection to the web.

1. **Set up a WebSocket proxy on your backend:**
   Use a library like `ws` or `rpc-websockets` in a Node.js server. When a browser connects, spawn the `node out/server.js --stdio` process and pipe the WebSocket messages into the child process's stdin, and pipe stdout back to the WebSocket.

2. **Connect Monaco from the frontend:**
   Using the `monaco-languageclient` package:
   ```typescript
   import { listen } from 'vscode-ws-jsonrpc';
   import { MonacoLanguageClient, CloseAction, ErrorAction } from 'monaco-languageclient';

   // Create a standard WebSocket to your backend
   const webSocket = new WebSocket('ws://localhost:3000/vult-lsp');
   
   listen({
       webSocket,
       onConnection: connection => {
           // Create the Monaco Language Client
           const languageClient = new MonacoLanguageClient({
               name: 'Vult Language Client',
               clientOptions: {
                   // Bind the client to the Monaco document
                   documentSelector: ['vult'],
                   errorHandler: {
                       error: () => ({ action: ErrorAction.Continue }),
                       closed: () => ({ action: CloseAction.DoNotRestart })
                   }
               },
               connectionProvider: {
                   get: () => Promise.resolve(connection)
               }
           });
           // Start the client, linking Monaco to the remote LSP
           const disposable = languageClient.start();
       }
   });
   ```

### Neovim / Custom Editors

For editors like **Neovim** or **Emacs**, you can configure their built-in LSP clients to point to the `vult-lsp` startup script.

**Example for Neovim (`nvim-lspconfig`):**
```lua
require'lspconfig'.configs.vult = {
  default_config = {
    -- Adjust path to wherever you built the vult-lsp folder
    cmd = {'node', '/path/to/vult-lsp/out/server.js', '--stdio'},
    filetypes = {'vult'},
    root_dir = require'lspconfig.util'.root_pattern('.git', 'package.json'),
  },
}
require'lspconfig'.vult.setup{}
```

## Development

- `npm run watch`: Automatically rebuild on changes.
- Press `F5` in VSCode while this project is open to launch a "Extension Development Host" for debugging.
