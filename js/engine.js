/* Wrapper do Stockfish (UCI) rodando em Web Worker.
 * O motor (WASM) fica no próprio repositório (stockfish/); toda a análise
 * roda localmente no navegador. Devolve resultados estruturados. */
(function (global) {
  'use strict';

  var DEFAULT_PATH = 'stockfish/stockfish.js';

  function Engine(path) {
    this.path = path || DEFAULT_PATH;
    this.worker = null;
    this.ready = false;
    this.current = null;
    this.queue = [];
    this.initPromise = null;
  }

  Engine.prototype.init = function () {
    var self = this;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise(function (resolve, reject) {
      var worker;
      try {
        worker = new Worker(self.path);
      } catch (err) {
        reject(new Error('Não foi possível iniciar o Stockfish. Sirva o app via HTTP (ex.: python -m http.server) ou GitHub Pages.'));
        return;
      }

      self.worker = worker;
      var settled = false;

      var failTimer = setTimeout(function () {
        if (!settled) {
          settled = true;
          reject(new Error('Tempo esgotado ao carregar o Stockfish.'));
        }
      }, 30000);

      worker.onerror = function () {
        if (!settled) {
          settled = true;
          clearTimeout(failTimer);
          reject(new Error('Erro ao carregar o Stockfish. Verifique se o app está sendo servido via HTTP ou GitHub Pages.'));
        }
      };

      worker.onmessage = function (event) {
        var line = String(event.data);

        if (!settled) {
          if (line.indexOf('uciok') !== -1) {
            worker.postMessage('setoption name MultiPV value 3');
            worker.postMessage('isready');
            return;
          }
          if (line.indexOf('readyok') !== -1) {
            settled = true;
            clearTimeout(failTimer);
            self.ready = true;
            resolve(self);
            self._drain();
            return;
          }
          return;
        }

        if (line.indexOf('readyok') !== -1) {
          self._drain();
          return;
        }

        self._onLine(line);
      };

      worker.postMessage('uci');
    });

    return this.initPromise;
  };

  Engine.prototype._onLine = function (line) {
    var task = this.current;
    if (!task) return;

    if (line.indexOf('info') === 0) {
      var info = parseInfo(line);
      if (info.nodes) task.nodes = info.nodes;
      if (info.depth && info.depth > task.depth) task.depth = info.depth;
      if (info.pv && info.pv.length && info.score) {
        task.lines[info.multipv || 1] = info;
        if (typeof task.opts.onUpdate === 'function') {
          task.opts.onUpdate(snapshot(task));
        }
      }
      return;
    }

    if (line.indexOf('bestmove') === 0) {
      var parts = line.split(/\s+/);
      task.bestmove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
      var current = this.current;
      this.current = null;
      if (current) {
        current.resolve(snapshot(current));
      }
      this._drain();
    }
  };

  Engine.prototype._drain = function () {
    if (this.current || !this.queue.length) return;
    var task = this.queue.shift();
    this.current = task;

    var multiPV = Math.max(1, task.opts.multiPV || 1);
    this.worker.postMessage('setoption name MultiPV value ' + multiPV);
    this.worker.postMessage('position fen ' + task.fen);

    var go = 'go depth ' + (task.opts.depth || 20);
    if (task.opts.movetime) {
      go += ' movetime ' + Math.round(task.opts.movetime * 1000);
    }
    this.worker.postMessage(go);
  };

  Engine.prototype.analyze = function (fen, opts) {
    opts = opts || {};
    var self = this;
    var task = {
      fen: fen,
      opts: opts,
      lines: {},
      depth: 0,
      nodes: 0,
      bestmove: null
    };

    var promise = new Promise(function (resolve, reject) {
      task.resolve = resolve;
      task.reject = reject;
    });

    if (!this.ready) {
      var self2 = this;
      this.init().then(function () {
        if (self2.current || self2.queue.length) {
          self2.queue.push(task);
        } else {
          self2.queue.push(task);
          self2._drain();
        }
      }, reject);
    } else {
      this.queue.push(task);
      this._drain();
    }

    return promise;
  };

  Engine.prototype.stop = function () {
    if (this.current) {
      this.current.opts.onUpdate = null;
      this.worker.postMessage('stop');
    }
    this.queue = [];
  };

  function snapshot(task) {
    var keys = Object.keys(task.lines).sort(function (a, b) { return a - b; });
    var lines = keys.map(function (k) { return task.lines[k]; });
    var best = lines[0] || null;
    return {
      bestmove: task.bestmove,
      lines: lines,
      best: best,
      depth: task.depth,
      nodes: task.nodes,
      fen: task.fen
    };
  }

  function parseInfo(line) {
    var tokens = line.split(/\s+/);
    var info = {};
    for (var i = 1; i < tokens.length; i++) {
      switch (tokens[i]) {
        case 'depth':
          info.depth = parseInt(tokens[++i], 10);
          break;
        case 'multipv':
          info.multipv = parseInt(tokens[++i], 10);
          break;
        case 'nodes':
          info.nodes = parseInt(tokens[++i], 10);
          break;
        case 'score':
          if (tokens[i + 1] === 'cp') {
            info.score = { type: 'cp', value: parseInt(tokens[i + 2], 10) };
            i += 2;
          } else if (tokens[i + 1] === 'mate') {
            info.score = { type: 'mate', value: parseInt(tokens[i + 2], 10) };
            i += 2;
          }
          break;
        case 'pv':
          info.pv = tokens.slice(i + 1);
          i = tokens.length;
          break;
        default:
          break;
      }
    }
    return info;
  }

  global.Engine = Engine;
}(window));
