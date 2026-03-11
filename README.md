# Vult Language Server & VSCode Extension

This project provides a full Language Server (LSP) and a VSCode extension for the Vult DSP language.

## Features

- **Syntax Highlighting**: Full syntax coloring for `.vult` files.
- **Diagnostics**: Real-time compile errors and warnings.
- **Code Completion**: Smart suggestions for keywords, types, and your own functions/variables.
- **Go to Definition**: Jump to the source of any function or variable.
- **Hover**: View signatures and details by hovering over code.
- **Document Symbols**: Outline view of your code structure.

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

## Moving to a separate repo

This folder is self-contained. You can move the entire `vult-lsp` directory to a new Git repository at any time.

## Development

- `npm run watch`: Automatically rebuild on changes.
- Press `F5` in VSCode while this project is open to launch a "Extension Development Host" for debugging.
