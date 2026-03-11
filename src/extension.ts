import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('out', 'server.js')
	);

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.stdio },
		debug: {
			module: serverModule,
			transport: TransportKind.stdio,
		}
	};

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for Vult documents
		documentSelector: [{ scheme: 'file', language: 'vult' }],
		synchronize: {
			// Notify the server about file changes to '.vult' files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/*.vult')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'vultLsp',
		'Vult Language Server',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
