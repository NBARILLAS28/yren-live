// Control remoto por la red local (iPhone, iPad o cualquier navegador). Se enciende solo si el usuario lo pide y exige un PIN.
// Sin dependencias: HTTP + Server-Sent Events para el estado y POST para los comandos.
const http = require('http');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// Comandos que se aceptan desde el celular. Nada que borre, importe o cambie ajustes.
const COMMANDS = new Set(['toggle', 'stop', 'next', 'prev', 'nextSec', 'prevSec', 'section', 'keyUp', 'keyDown', 'keyReset', 'tempoUp', 'tempoDown', 'tempoReset', 'fade', 'pad', 'loop', 'song']);

class RemoteServer {
  constructor({ pagePath, onCommand, maxFails = 5, lockMs = 30000 }) {
    this.pagePath = pagePath; this.onCommand = onCommand;
    this.maxFails = maxFails; this.lockMs = lockMs;
    this.srv = null; this.pin = ''; this.state = {}; this.clients = new Set(); this.fails = new Map(); this.beat = null;
  }

  static lanUrls(port) {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${port}/`);
    return out;
  }

  get running() { return !!this.srv; }

  start({ port = 8787, pin }) {
    if (!/^\d{4,8}$/.test(String(pin))) return Promise.reject(new Error('El PIN debe tener entre 4 y 8 dígitos'));
    this.stop();
    this.pin = String(pin);
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this._handle(req, res));
      srv.on('error', (e) => { this.srv = null; reject(e.code === 'EADDRINUSE' ? new Error(`El puerto ${port} ya está en uso`) : e); });
      srv.listen(port, '0.0.0.0', () => {
        this.srv = srv;
        this.port = srv.address().port;
        this.beat = setInterval(() => { for (const c of this.clients) { try { c.write(': ♥\n\n'); } catch { /* cliente caído */ } } }, 15000);
        resolve({ port: this.port, urls: RemoteServer.lanUrls(this.port) });
      });
    });
  }

  stop() {
    clearInterval(this.beat);
    for (const c of this.clients) { try { c.end(); } catch { /* noop */ } }
    this.clients.clear();
    if (this.srv) { try { this.srv.close(); } catch { /* noop */ } this.srv = null; }
  }

  setPin(pin) { this.pin = String(pin); for (const c of this.clients) { try { c.end(); } catch { /* noop */ } } this.clients.clear(); }

  push(state) {
    this.state = state;
    const msg = `data: ${JSON.stringify(state)}\n\n`;
    for (const c of this.clients) { try { c.write(msg); } catch { this.clients.delete(c); } }
  }

  _auth(req, url, res) {
    const ip = req.socket.remoteAddress || '?';
    const f = this.fails.get(ip);
    if (f && f.until > Date.now()) { res.writeHead(429, { 'Retry-After': Math.ceil((f.until - Date.now()) / 1000) }); res.end('Demasiados intentos'); return false; }
    const given = String(req.headers['x-pin'] || url.searchParams.get('pin') || '');
    const a = Buffer.from(given), b = Buffer.from(this.pin);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (ok) { this.fails.delete(ip); return true; }
    const now = Date.now();
    const stale = f && ((f.until && f.until <= now) || now - f.last > 60000); // bloqueo vencido o intentos viejos
    const n = (stale || !f ? 0 : f.n) + 1;
    this.fails.set(ip, { n, last: now, until: n >= this.maxFails ? now + this.lockMs : 0 });
    res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"PIN incorrecto"}');
    return false;
  }

  _handle(req, res) {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/' && req.method === 'GET') {
      fs.readFile(this.pagePath, (e, d) => {
        if (e) { res.writeHead(500); res.end('Falta la página del control remoto'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
        res.end(d);
      });
      return;
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      if (!this._auth(req, url, res)) return;
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(this.state)); return;
    }
    if (url.pathname === '/api/events' && req.method === 'GET') {
      if (!this._auth(req, url, res)) return;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(this.state)}\n\n`);
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (url.pathname === '/api/cmd') {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
      if (!this._auth(req, url, res)) return;
      let body = '', big = false;
      req.on('data', (c) => {
        if (big) return;
        body += c;
        if (body.length > 2048) { big = true; res.writeHead(413, { Connection: 'close' }); res.end(); req.destroy(); }
      });
      req.on('end', () => {
        if (big) return;
        let m;
        try { m = JSON.parse(body || '{}'); } catch { res.writeHead(400); res.end('{"error":"JSON inválido"}'); return; }
        if (!COMMANDS.has(m.cmd)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"Comando desconocido"}'); return; }
        const arg = Number.isInteger(m.arg) ? m.arg : undefined;
        try { this.onCommand(m.cmd, arg); } catch { /* la app decide qué hacer con un comando que no aplica */ }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      });
      return;
    }
    res.writeHead(404); res.end();
  }
}

module.exports = { RemoteServer, COMMANDS };
