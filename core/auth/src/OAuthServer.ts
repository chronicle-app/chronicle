import http from 'node:http';
import type { AuthorizationResult } from './types.js';

/** A loopback-only callback server. Its pending callback always settles on shutdown. */
export class OAuthServer {
  private server?: http.Server;
  private port?: number;
  private timeout?: NodeJS.Timeout;
  private result?: AuthorizationResult;
  private failure?: Error;
  private resolve?: (result: AuthorizationResult) => void;
  private reject?: (error: Error) => void;

  async start(preferredPort = 0, timeoutMs = 5 * 60 * 1000): Promise<number> {
    if (this.server) throw new Error('OAuth server already started');
    this.result = undefined;
    this.failure = undefined;
    const server = http.createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        response.writeHead(url.pathname === '/' ? 200 : 404, { 'Content-Type': 'text/plain' });
        response.end(url.pathname === '/' ? 'Waiting for authorization.' : 'Not found');
        return;
      }
      const result: AuthorizationResult = {};
      for (const key of ['code', 'token', 'state', 'error', 'error_description'] as const) {
        const value = url.searchParams.get(key);
        if (value !== null) result[key] = value;
      }
      this.result = result;
      response.writeHead(result.error ? 400 : 200, { 'Content-Type': 'text/plain' });
      response.end(
        result.error
          ? 'Authorization failed. Return to your terminal.'
          : 'Authorization received. Return to your terminal.'
      );
      this.resolve?.(result);
    });
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(preferredPort, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to start OAuth server');
      this.port = address.port;
      this.timeout = setTimeout(
        () => this.stop(new Error('OAuth authorization timed out')),
        timeoutMs
      );
      return this.port;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async waitForCallback(): Promise<AuthorizationResult> {
    if (this.result) return this.result;
    if (this.failure) throw this.failure;
    if (!this.server) throw new Error('Server not started');
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  stop(error = new Error('OAuth authorization cancelled')): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    if (!this.result) {
      this.failure = error;
      this.reject?.(error);
    }
    this.resolve = undefined;
    this.reject = undefined;
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = undefined;
    this.port = undefined;
  }

  getCallbackUrl(): string {
    if (!this.port) throw new Error('Server not started');
    return `http://127.0.0.1:${this.port}/callback`;
  }
}
