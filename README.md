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

## Moving to a separate repo

This folder is self-contained. You can move the entire `vult-lsp` directory to a new Git repository at any time.

## Development

- `npm run watch`: Automatically rebuild on changes.
- Press `F5` in VSCode while this project is open to launch a "Extension Development Host" for debugging.
