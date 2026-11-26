/* Analisador de Partidas — lógica da interface */
(function () {
  'use strict';

  if (typeof Chess === 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      var el = document.getElementById('engine-status');
      if (el) {
        el.textContent = 'Sem conexão';
        el.className = 'status error';
      }
    });
    return;
  }

  var $ = function (id) { return document.getElementById(id); };

  var PIECE_CODE = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
  var PIECE_PATH = 'assets/pieces/cburnett/';
  var ARROW_COLORS = ['#22c55e', '#3b82f6', '#eab308'];
  var FILES = 'abcdefgh';

  var engine = new Engine();

  var game = new Chess();
  var positions = [];
  var ply = 0;
  var flipped = false;

  var evalsWhite = [];
  var classifications = {};
  var analyzing = false;
  var cancelRequested = false;
  var selectedSquare = null;
  var dragState = null;
  var suppressClick = false;
  var autoRunning = false;
  var autoWanted = null;
  var lastResult = null;

  /* ---------------- Utilidades ---------------- */

  var toastTimer = null;
  function toast(message, isError) {
    var el = $('toast');
    el.textContent = message;
    el.classList.toggle('error', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
  }

  function setStatus(text, kind) {
    var el = $('engine-status');
    el.textContent = text;
    el.className = 'status ' + kind;
  }

  function formatNodes(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' Mn';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + ' kn';
    return String(n || 0);
  }

  function settings() {
    return {
      depth: parseInt($('setting-depth').value, 10),
      multiPV: parseInt($('setting-multipv').value, 10),
      movetime: parseInt($('setting-movetime').value, 10),
      showMainline: $('show-mainline').checked,
      showAllLines: $('show-all-lines').checked
    };
  }

  function chessAt(fen) {
    var c = new Chess();
    if (!c.load(fen)) return null;
    return c;
  }

  function cpWhite(score, fen) {
    var c = chessAt(fen);
    var turn = c ? c.turn() : 'w';
    if (score.type === 'mate') {
      var m = turn === 'w' ? score.value : -score.value;
      return m > 0 ? 9999 : -9999;
    }
    return turn === 'w' ? score.value : -score.value;
  }

  function formatScore(score, fen) {
    var c = chessAt(fen);
    var turn = c ? c.turn() : 'w';
    if (score.type === 'mate') {
      var m = turn === 'w' ? score.value : -score.value;
      return m > 0 ? '#' + m : '-#' + Math.abs(m);
    }
    var v = turn === 'w' ? score.value : -score.value;
    return (v >= 0 ? '+' : '') + (v / 100).toFixed(2);
  }

  function evalLabel(whiteCp, fen) {
    var c = chessAt(fen);
    var turn = c ? c.turn() : 'w';
    if (Math.abs(whiteCp) >= 9999) {
      return whiteCp > 0 ? 'Xeque-mate (Brancas vencem)' : 'Xeque-mate (Pretas vencem)';
    }
    var abs = Math.abs(whiteCp);
    var side = whiteCp >= 0 ? 'Brancas' : 'Pretas';
    if (abs < 10) return 'Equilíbrio absoluto';
    if (abs < 120) return 'Equilíbrio (Leve vantagem ' + side + ')';
    if (abs < 300) return 'Leve vantagem ' + side;
    if (abs < 700) return 'Vantagem ' + side;
    return 'Vantagem decisiva ' + side;
  }

  function winPercent(whiteCp) {
    if (whiteCp >= 9999) return 100;
    if (whiteCp <= -9999) return 0;
    return 100 / (1 + Math.exp(-whiteCp / 400));
  }

  function pvToSan(fen, pvMoves) {
    var c = chessAt(fen);
    if (!c) return { sans: [], invalid: true };
    var sans = [];
    for (var i = 0; i < pvMoves.length; i++) {
      var uci = pvMoves[i];
      var move = null;
      try {
        move = c.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci[4] : undefined
        });
      } catch (err) { move = null; }
      if (!move) break;
      sans.push(move.san);
    }
    return { sans: sans, invalid: sans.length === 0 };
  }

  function numberedLine(fen, sans) {
    var c = chessAt(fen);
    if (!c) return '';
    var parts = fen.split(' ');
    var number = parseInt(parts[5], 10) || 1;
    var turn = parts[1];
    var out = [];
    for (var i = 0; i < sans.length; i++) {
      if (turn === 'w') {
        out.push(number + '. ' + sans[i]);
      } else {
        out.push(number + '... ' + sans[i]);
        number++;
      }
      turn = turn === 'w' ? 'b' : 'w';
    }
    return out.join(' ');
  }

  /* ---------------- Tabuleiro ---------------- */

  function renderBoard() {
    var boardEl = $('board');
    boardEl.innerHTML = '';
    hidePromotionPicker();
    var pos = positions[ply];
    if (!pos) return;

    var rows = ['8', '7', '6', '5', '4', '3', '2', '1'];
    var cols = FILES.split('');
    if (flipped) {
      rows.reverse();
      cols.reverse();
    }

    var placement = pos.fen.split(' ')[0];
    var map = {};
    var fileIndex = 0;
    var rankIndex = 7;
    for (var i = 0; i < placement.length; i++) {
      var ch = placement[i];
      if (ch === '/') { rankIndex--; fileIndex = 0; continue; }
      if (/\d/.test(ch)) { fileIndex += parseInt(ch, 10); continue; }
      map[FILES[fileIndex] + (rankIndex + 1)] = ch;
      fileIndex++;
    }

    var lastFrom = ply > 0 ? positions[ply].from : null;
    var lastTo = ply > 0 ? positions[ply].to : null;

    var checkSquare = null;
    var c = chessAt(pos.fen);
    if (c && c.in_check()) {
      var turn = c.turn();
      var board = c.board();
      for (var r = 0; r < 8; r++) {
        for (var f = 0; f < 8; f++) {
          var piece = board[r][f];
          if (piece && piece.type === 'k' && piece.color === turn) {
            checkSquare = FILES[f] + (8 - r);
          }
        }
      }
    }

    for (var ri = 0; ri < 8; ri++) {
      for (var ci = 0; ci < 8; ci++) {
        var rank = rows[ri];
        var file = cols[ci];
        var square = file + rank;
        var el = document.createElement('div');
        el.className = 'square ' + (((FILES.indexOf(file) + parseInt(rank, 10)) % 2) === 0 ? 'light' : 'dark');
        el.dataset.square = square;

        if (lastFrom === square || lastTo === square) el.classList.add('lastmove');
        if (selectedSquare === square) el.classList.add('selected');
        if (checkSquare === square) el.classList.add('check');

        var pieceChar = map[square];
        if (pieceChar) {
          var img = document.createElement('img');
          img.className = 'piece';
          img.alt = '';
          img.dataset.square = square;
          img.src = PIECE_PATH + (pieceChar === pieceChar.toUpperCase() ? 'w' : 'b') +
            PIECE_CODE[pieceChar.toLowerCase()] + '.svg';
          img.addEventListener('pointerdown', onPiecePointerDown);
          el.appendChild(img);
        }

        if (ri === 7) {
          var fLabel = document.createElement('span');
          fLabel.className = 'coord file';
          fLabel.textContent = file;
          el.appendChild(fLabel);
        }
        if (ci === 0) {
          var rLabel = document.createElement('span');
          rLabel.className = 'coord rank';
          rLabel.textContent = rank;
          el.appendChild(rLabel);
        }

        el.addEventListener('click', onSquareClick);
        boardEl.appendChild(el);
      }
    }
  }

  function showLegalDots(square) {
    var c = chessAt(positions[ply].fen);
    if (!c) return;
    var moves = c.moves({ square: square, verbose: true });
    var boardEl = $('board');
    for (var i = 0; i < moves.length; i++) {
      var target = boardEl.querySelector('[data-square="' + moves[i].to + '"]');
      if (!target) continue;
      var dot = document.createElement('span');
      dot.className = 'dot' + (moves[i].captured ? ' capture' : '');
      target.appendChild(dot);
    }
  }

  function onSquareClick(event) {
    if (suppressClick) { suppressClick = false; return; }
    var square = event.currentTarget.dataset.square;
    var pos = positions[ply];
    if (!pos || analyzing) return;

    if (ply !== positions.length - 1) {
      toast('Navegue até o último lance para jogar no tabuleiro.');
      return;
    }

    var c = chessAt(pos.fen);
    if (!c) return;

    if (selectedSquare) {
      var moves = c.moves({ square: selectedSquare, verbose: true });
      for (var i = 0; i < moves.length; i++) {
        if (moves[i].to === square) {
          performMove(selectedSquare, square);
          return;
        }
      }
    }

    var piece = c.get(square);
    if (piece && piece.color === c.turn()) {
      selectedSquare = square;
      renderBoard();
      showLegalDots(square);
    } else {
      selectedSquare = null;
      renderBoard();
    }
  }

  function legalTargets(from) {
    var pos = positions[ply];
    if (!pos) return null;
    var c = chessAt(pos.fen);
    if (!c) return null;
    var moves = c.moves({ square: from, verbose: true });
    var set = {};
    for (var i = 0; i < moves.length; i++) set[moves[i].to] = true;
    return set;
  }

  function squareFromPoint(x, y) {
    var r = $('board').getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return null;
    var col = Math.min(7, Math.max(0, Math.floor((x - r.left) / (r.width / 8))));
    var row = Math.min(7, Math.max(0, Math.floor((y - r.top) / (r.height / 8))));
    if (flipped) return FILES[7 - col] + String(row + 1);
    return FILES[col] + String(8 - row);
  }

  function clearHover() {
    var prev = document.querySelector('.square.hover');
    if (prev) prev.classList.remove('hover');
  }

  function onPiecePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (analyzing || ply !== positions.length - 1) return;
    var pos = positions[ply];
    if (!pos) return;
    var square = event.currentTarget.dataset.square;
    var c = chessAt(pos.fen);
    var piece = c && c.get(square);
    if (!piece || piece.color !== c.turn()) return;

    event.preventDefault();
    suppressClick = false;
    selectedSquare = square;
    renderBoard();
    showLegalDots(square);

    var img = document.querySelector('.piece[data-square="' + square + '"]');
    if (!img) return;
    dragState = {
      from: square,
      img: img,
      targets: legalTargets(square),
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    try { img.setPointerCapture(event.pointerId); } catch (err) { }
    img.addEventListener('pointermove', onPiecePointerMove);
    img.addEventListener('pointerup', onPiecePointerUp);
    img.addEventListener('pointercancel', onPiecePointerUp);
  }

  function onPiecePointerMove(event) {
    if (!dragState || dragState.img !== event.currentTarget) return;
    var dx = event.clientX - dragState.startX;
    var dy = event.clientY - dragState.startY;
    if (!dragState.moved) {
      if (dx * dx + dy * dy < 16) return;
      dragState.moved = true;
      dragState.img.classList.add('dragging');
    }
    dragState.img.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.14)';
    var target = squareFromPoint(event.clientX, event.clientY);
    clearHover();
    if (target && target !== dragState.from && dragState.targets && dragState.targets[target]) {
      var el = document.querySelector('.square[data-square="' + target + '"]');
      if (el) el.classList.add('hover');
    }
  }

  function onPiecePointerUp(event) {
    var img = event.currentTarget;
    img.removeEventListener('pointermove', onPiecePointerMove);
    img.removeEventListener('pointerup', onPiecePointerUp);
    img.removeEventListener('pointercancel', onPiecePointerUp);
    if (!dragState || dragState.img !== img) { dragState = null; return; }
    var st = dragState;
    dragState = null;
    clearHover();

    if (!st.moved) return;

    suppressClick = true;
    var target = squareFromPoint(event.clientX, event.clientY);
    if (target && st.targets && st.targets[target] && target !== st.from) {
      st.img.style.transform = '';
      st.img.classList.remove('dragging');
      performMove(st.from, target);
      return;
    }

    st.img.style.transition = 'transform .12s ease';
    st.img.style.transform = '';
    st.img.classList.remove('dragging');
    setTimeout(function () { st.img.style.transition = ''; }, 140);
  }

  function showPromotionPicker(from, to, color) {
    hidePromotionPicker();
    var stack = document.querySelector('.board-stack');
    if (!stack) return;
    var overlay = document.createElement('div');
    overlay.className = 'promotion';
    var box = document.createElement('div');
    box.className = 'promotion-box';
    var types = ['q', 'r', 'b', 'n'];
    for (var i = 0; i < types.length; i++) {
      (function (type) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Promover para ' + type.toUpperCase());
        var img = document.createElement('img');
        img.src = PIECE_PATH + color + PIECE_CODE[type] + '.svg';
        img.alt = '';
        btn.appendChild(img);
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          hidePromotionPicker();
          performMove(from, to, type);
        });
        box.appendChild(btn);
      })(types[i]);
    }
    overlay.appendChild(box);
    overlay.addEventListener('pointerdown', function (e) {
      if (e.target === overlay) { hidePromotionPicker(); renderBoard(); }
    });
    stack.appendChild(overlay);
  }

  function hidePromotionPicker() {
    var old = document.querySelector('.promotion');
    if (old) old.remove();
  }

  function performMove(from, to, promotion) {
    var pos = positions[ply];
    if (!pos || analyzing || ply !== positions.length - 1) return;
    var c = chessAt(pos.fen);
    if (!c) return;

    if (!promotion) {
      var legal = c.moves({ square: from, verbose: true });
      for (var pi = 0; pi < legal.length; pi++) {
        if (legal[pi].to === to && legal[pi].promotion) {
          showPromotionPicker(from, to, c.turn());
          return;
        }
      }
    }

    var move = null;
    try {
      move = c.move({ from: from, to: to, promotion: promotion || 'q' });
    } catch (err) { move = null; }

    if (move) {
      positions.push({
        fen: c.fen(),
        san: move.san,
        from: move.from,
        to: move.to,
        color: move.color,
        number: moveNumberAt(positions[positions.length - 1].fen)
      });
      ply = positions.length - 1;
      selectedSquare = null;
      renderAll();
      autoAnalyze();
    } else {
      selectedSquare = null;
      renderBoard();
    }
  }

  function moveNumberAt(fen) {
    var parts = fen.split(' ');
    return parseInt(parts[5], 10) || 1;
  }

  /* ---------------- Setas dos melhores lances ---------------- */

  function squareCenter(sq) {
    var f = FILES.indexOf(sq[0]);
    var r = parseInt(sq[1], 10);
    return flipped ? [7.5 - f, r - 0.5] : [f + 0.5, 8.5 - r];
  }

  function drawArrow(svg, from, to, color, opacity) {
    var NS = 'http://www.w3.org/2000/svg';
    var a = squareCenter(from);
    var b = squareCenter(to);
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!len) return;

    var ux = dx / len;
    var uy = dy / len;
    var headLen = 0.34;
    var headWidth = 0.38;
    var start = [a[0] + ux * 0.3, a[1] + uy * 0.3];
    var base = [b[0] - ux * headLen, b[1] - uy * headLen];
    var px = -uy;
    var py = ux;

    var line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', start[0]);
    line.setAttribute('y1', start[1]);
    line.setAttribute('x2', base[0]);
    line.setAttribute('y2', base[1]);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '0.17');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', opacity);
    svg.appendChild(line);

    var tip = b[0] + ',' + b[1];
    var p1 = (base[0] + px * headWidth / 2) + ',' + (base[1] + py * headWidth / 2);
    var p2 = (base[0] - px * headWidth / 2) + ',' + (base[1] - py * headWidth / 2);
    var head = document.createElementNS(NS, 'polygon');
    head.setAttribute('points', tip + ' ' + p1 + ' ' + p2);
    head.setAttribute('fill', color);
    head.setAttribute('opacity', opacity);
    svg.appendChild(head);
  }

  function renderArrows(result) {
    var svg = $('arrows');
    if (!svg) return;
    svg.innerHTML = '';
    var pos = positions[ply];
    if (!pos || !result || !result.lines || !result.lines.length) return;
    if (result.fen && result.fen !== pos.fen) return;

    var max = Math.min(3, settings().multiPV, result.lines.length);
    for (var i = 0; i < max; i++) {
      var pv = result.lines[i].pv;
      if (!pv || !pv.length || pv[0] === '0000') continue;
      var from = pv[0].slice(0, 2);
      var to = pv[0].slice(2, 4);
      drawArrow(svg, from, to, ARROW_COLORS[i], i === 0 ? 0.92 : 0.72);
    }
  }

  /* ---------------- Lista de lances ---------------- */

  function renderMoves() {
    var container = $('moves');
    container.innerHTML = '';

    if (positions.length <= 1) {
      container.innerHTML = '<p class="moves-empty">Nenhum lance ainda. Importe um PGN ou jogue no tabuleiro.</p>';
      return;
    }

    for (var p = 1; p < positions.length; p++) {
      var move = positions[p];
      var prevColor = positions[p - 1].color;
      if (move.color === 'w' || prevColor === null || prevColor === 'b') {
        var num = document.createElement('span');
        num.className = 'move-num';
        num.textContent = move.color === 'w' ? move.number + '.' : move.number + '...';
        container.appendChild(num);
      }
      var span = document.createElement('span');
      span.className = 'move' + (p === ply ? ' current' : '');
      span.dataset.ply = p;
      span.textContent = move.san;
      if (classifications[p]) {
        var badge = document.createElement('span');
        badge.className = 'badge ' + classifications[p].cls;
        badge.textContent = classifications[p].symbol;
        badge.title = classifications[p].name + ' (perda: ' + (classifications[p].loss / 100).toFixed(2) + ')';
        span.appendChild(badge);
      }
      span.addEventListener('click', function (e) {
        goToPly(parseInt(e.currentTarget.dataset.ply, 10));
      });
      container.appendChild(span);
    }

    var current = container.querySelector('.move.current');
    if (current) current.scrollIntoView({ block: 'nearest' });
  }

  /* ---------------- Painel do motor ---------------- */

  function renderAnalysis(result, isPartial) {
    var cfg = settings();
    var fen = result.fen || positions[ply].fen;
    var best = result.best;
    lastResult = result;

    if (!best) {
      if (!isPartial) {
        setStatus('Análise Concluída', 'done');
      }
      return;
    }

    var wcp = cpWhite(best.score, fen);
    var scoreEl = $('eval-score');
    scoreEl.textContent = formatScore(best.score, fen);
    scoreEl.className = 'eval-score ' + (wcp >= 0 ? 'good' : 'bad');
    $('eval-label').textContent = evalLabel(wcp, fen);
    $('eval-fill').style.width = winPercent(wcp) + '%';

    var sanInfo = pvToSan(fen, best.pv);
    var bestMoveEl = $('best-move');
    bestMoveEl.hidden = false;
    if (sanInfo.sans.length) {
      var parts = fen.split(' ');
      var number = parseInt(parts[5], 10) || 1;
      var turn = parts[1];
      $('best-move-value').textContent = turn === 'w'
        ? number + '. ' + sanInfo.sans[0]
        : number + '... ' + sanInfo.sans[0];
    } else {
      $('best-move-value').textContent = result.bestmove || '—';
    }

    var lines = result.lines.slice(0, cfg.showAllLines ? result.lines.length : 1);
    var linesEl = $('lines');
    linesEl.innerHTML = '';
    for (var i = 0; i < lines.length; i++) {
      var li = document.createElement('li');
      var info = pvToSan(fen, lines[i].pv);
      var idx = document.createElement('span');
      idx.className = 'line-idx';
      idx.textContent = (i + 1) + '.';
      var moveSpan = document.createElement('span');
      moveSpan.className = 'line-move';
      moveSpan.textContent = info.sans[0] || (lines[i].pv[0] || '—');
      var score = document.createElement('span');
      var lcp = cpWhite(lines[i].score, fen);
      score.className = 'line-score ' + (lcp >= 0 ? 'pos' : 'neg');
      score.textContent = formatScore(lines[i].score, fen);
      var pv = document.createElement('span');
      pv.className = 'line-pv';
      pv.textContent = info.sans.join(' ');
      pv.title = info.sans.join(' ');
      li.appendChild(idx);
      li.appendChild(moveSpan);
      li.appendChild(score);
      li.appendChild(pv);
      linesEl.appendChild(li);
    }

    var mainlineEl = $('mainline');
    var full = result.lines[0];
    if (full) {
      var sansInfo = pvToSan(fen, full.pv);
      mainlineEl.textContent = numberedLine(fen, sansInfo.sans) || '—';
    }
    $('depth-meta').textContent = 'Profundidade: ' + (result.depth || 0) + '/' + cfg.depth;
    $('nodes-meta').textContent = 'Nós: ' + formatNodes(result.nodes);

    renderArrows(result);

    $('lines-block').hidden = !cfg.showAllLines && !result.lines.length;
    $('mainline-block').hidden = !cfg.showMainline;

    if (!isPartial) setStatus('Análise Concluída', 'done');
  }

  function resetPanel() {
    $('eval-score').textContent = '—';
    $('eval-score').className = 'eval-score';
    $('eval-label').textContent = 'Aguardando análise';
    $('eval-fill').style.width = '50%';
    $('best-move').hidden = true;
    $('lines').innerHTML = '';
    $('mainline').textContent = '—';
    $('depth-meta').textContent = 'Profundidade: —';
    $('nodes-meta').textContent = 'Nós: —';
    var arrows = $('arrows');
    if (arrows) arrows.innerHTML = '';
    setStatus('Pronto', 'ready');
  }

  /* ---------------- Análise ---------------- */

  function setButtonsAnalyzing(state) {
    $('start-analysis').disabled = state;
    $('analyze-game').disabled = state;
    $('start-analysis').hidden = state;
    $('analyze-game').hidden = state;
    $('stop-analysis').hidden = !state;
  }

  function runPositionAnalysis() {
    if (analyzing) return;
    var cfg = settings();
    var fen = positions[ply].fen;
    var c = chessAt(fen);

    if (c && (c.in_checkmate() || c.in_draw())) {
      var wcp = c.in_checkmate() ? (c.turn() === 'w' ? -9999 : 9999) : 0;
      renderAnalysis({
        fen: fen,
        best: {
          score: { type: 'cp', value: wcp },
          pv: ['0000']
        },
        lines: [],
        depth: cfg.depth,
        nodes: 0
      }, false);
      return;
    }

    analyzing = true;
    setButtonsAnalyzing(true);
    setStatus('Analisando…', 'running');
    resetPanelSoft();

    engine.init().then(function () {
      return engine.analyze(fen, {
        depth: cfg.depth,
        movetime: cfg.movetime,
        multiPV: cfg.multiPV,
        onUpdate: function (snapshot) { renderAnalysis(snapshot, true); }
      });
    }).then(function (result) {
      renderAnalysis(result, false);
    }).catch(function (err) {
      setStatus('Erro', 'error');
      toast(err.message, true);
    }).then(function () {
      analyzing = false;
      setButtonsAnalyzing(false);
    });
  }

  function autoAnalyze() {
    if (analyzing) return;
    var fen = positions[ply].fen;
    if (autoRunning) { autoWanted = fen; engine.stop(); return; }
    var cfg = settings();
    var c = chessAt(fen);

    if (c && (c.in_checkmate() || c.in_draw())) {
      renderAnalysis({
        fen: fen,
        best: {
          score: { type: 'cp', value: c.in_checkmate() ? (c.turn() === 'w' ? -9999 : 9999) : 0 },
          pv: []
        },
        lines: [],
        depth: cfg.depth,
        nodes: 0
      }, false);
      return;
    }

    autoRunning = true;
    setStatus('Analisando…', 'running');
    engine.init().then(function () {
      return engine.analyze(fen, {
        depth: cfg.depth,
        movetime: cfg.movetime,
        multiPV: cfg.multiPV,
        onUpdate: function (snapshot) {
          if (snapshot && positions[ply] && snapshot.fen === positions[ply].fen) {
            renderAnalysis(snapshot, true);
          }
        }
      });
    }).then(function (result) {
      if (positions[ply] && result && result.fen === positions[ply].fen) {
        renderAnalysis(result, false);
      }
    }).catch(function () {
      setStatus('Pronto', 'ready');
    }).then(function () {
      autoRunning = false;
      if (autoWanted) {
        var next = autoWanted;
        autoWanted = null;
        if (positions[ply] && positions[ply].fen === next) autoAnalyze();
      } else if (!analyzing) {
        setStatus('Pronto', 'ready');
      }
    });
  }

  function resetPanelSoft() {
    $('eval-score').textContent = '…';
    $('eval-score').className = 'eval-score';
    $('lines').innerHTML = '';
    $('mainline').textContent = '…';
    var arrows = $('arrows');
    if (arrows) arrows.innerHTML = '';
  }

  function classify(loss) {
    if (loss <= 10) return { name: 'Ótimo', cls: 'b0', symbol: '★', loss: loss };
    if (loss <= 50) return { name: 'Bom', cls: 'b1', symbol: '', loss: loss };
    if (loss <= 100) return { name: 'Imprecisão', cls: 'b2', symbol: '?!', loss: loss };
    if (loss <= 250) return { name: 'Erro', cls: 'b3', symbol: '?', loss: loss };
    return { name: 'Blunder', cls: 'b4', symbol: '??', loss: loss };
  }

  function runFullAnalysis() {
    if (analyzing) return;
    if (positions.length <= 1) {
      toast('Importe ou jogue uma partida antes de analisar.', true);
      return;
    }

    var cfg = settings();
    analyzing = true;
    cancelRequested = false;
    setButtonsAnalyzing(true);
    evalsWhite = [];
    classifications = {};
    $('graph-wrap').hidden = true;

    engine.init().then(function () {
      var chain = Promise.resolve();
      var p = 0;

      function step() {
        if (cancelRequested || p >= positions.length) return Promise.resolve();
        var fen = positions[p].fen;
        var c = chessAt(fen);
        setStatus('Analisando ' + (p + 1) + '/' + positions.length, 'running');
        $('ply-label').textContent = 'Analisando posição ' + (p + 1) + '/' + positions.length;

        var promise;
        if (c && c.in_checkmate()) {
          promise = Promise.resolve({
            fen: fen,
            best: { score: { type: 'cp', value: c.turn() === 'w' ? -9999 : 9999 }, pv: [] },
            lines: [], depth: cfg.depth, nodes: 0
          });
        } else if (c && c.in_draw()) {
          promise = Promise.resolve({
            fen: fen,
            best: { score: { type: 'cp', value: 0 }, pv: [] },
            lines: [], depth: cfg.depth, nodes: 0
          });
        } else {
          promise = engine.analyze(fen, {
            depth: cfg.depth,
            movetime: cfg.movetime,
            multiPV: 1,
            onUpdate: function (snapshot) {
              if (snapshot.best) {
                renderAnalysis(snapshot, true);
              }
            }
          });
        }

        return promise.then(function (result) {
          if (result.best) {
            evalsWhite[p] = cpWhite(result.best.score, fen);
          } else {
            evalsWhite[p] = evalsWhite[p - 1] || 0;
          }
          p++;
          return step();
        });
      }

      return step();
    }).then(function () {
      for (var m = 1; m < positions.length; m++) {
        if (evalsWhite[m] === undefined || evalsWhite[m - 1] === undefined) continue;
        var mover = positions[m].color;
        var before = mover === 'w' ? evalsWhite[m - 1] : -evalsWhite[m - 1];
        var after = mover === 'w' ? evalsWhite[m] : -evalsWhite[m];
        var loss = Math.max(0, Math.min(before, 1500) - Math.min(after, 1500));
        classifications[m] = classify(loss);
      }
      renderMoves();
      drawGraph();
      setStatus('Análise Concluída', 'done');
      $('ply-label').textContent = 'Análise completa';
      if (!cancelRequested) toast('Análise da partida concluída!');
    }).catch(function (err) {
      setStatus('Erro', 'error');
      toast(err.message, true);
    }).then(function () {
      analyzing = false;
      cancelRequested = false;
      setButtonsAnalyzing(false);
      renderBoard();
    });
  }

  function stopAnalysis() {
    cancelRequested = true;
    engine.stop();
    setStatus('Parando…', 'running');
  }

  /* ---------------- Gráfico ---------------- */

  function drawGraph() {
    var values = evalsWhite.filter(function (v) { return v !== undefined; });
    if (values.length < 2) return;

    var svg = $('graph');
    svg.innerHTML = '';
    var W = 600, H = 120, PAD = 10;
    var n = evalsWhite.length;

    function x(i) { return n > 1 ? (i * W) / (n - 1) : W / 2; }
    function y(cp) {
      var clamped = Math.max(-500, Math.min(500, cp));
      return PAD + (1 - (clamped + 500) / 1000) * (H - 2 * PAD);
    }

    var NS = 'http://www.w3.org/2000/svg';

    var mid = document.createElementNS(NS, 'line');
    mid.setAttribute('x1', 0); mid.setAttribute('x2', W);
    mid.setAttribute('y1', H / 2); mid.setAttribute('y2', H / 2);
    mid.setAttribute('stroke', '#262e3f');
    mid.setAttribute('stroke-dasharray', '4 4');
    svg.appendChild(mid);

    var linePath = 'M' + x(0) + ',' + y(evalsWhite[0]);
    var areaPath = linePath;
    for (var i = 1; i < n; i++) {
      if (evalsWhite[i] === undefined) continue;
      linePath += ' L' + x(i) + ',' + y(evalsWhite[i]);
      areaPath += ' L' + x(i) + ',' + y(evalsWhite[i]);
    }
    areaPath += ' L' + x(n - 1) + ',' + H / 2 + ' L0,' + H / 2 + ' Z';

    var area = document.createElementNS(NS, 'path');
    area.setAttribute('d', areaPath);
    area.setAttribute('fill', 'rgba(139, 92, 246, .18)');
    svg.appendChild(area);

    var line = document.createElementNS(NS, 'path');
    line.setAttribute('d', linePath);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#a78bfa');
    line.setAttribute('stroke-width', '2');
    svg.appendChild(line);

    svg.onclick = function (event) {
      var rect = svg.getBoundingClientRect();
      var ratio = (event.clientX - rect.left) / rect.width;
      goToPly(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))));
    };

    $('graph-wrap').hidden = false;
  }

  /* ---------------- Estado / importação ---------------- */

  function goToPly(target) {
    ply = Math.max(0, Math.min(positions.length - 1, target));
    selectedSquare = null;
    renderAll();
  }

  function newGame(fen) {
    game = new Chess();
    if (fen && !game.load(fen)) {
      toast('FEN inválido.', true);
      return false;
    }
    positions = [{ fen: game.fen(), san: null, from: null, to: null, color: null, number: 1 }];
    ply = 0;
    evalsWhite = [];
    classifications = {};
    selectedSquare = null;
    $('graph-wrap').hidden = true;
    $('game-info').textContent = fen
      ? 'Posição personalizada — ' + fen.split(' ')[0]
      : 'Posição inicial — importe um PGN, carregue um FEN ou jogue no tabuleiro.';
    resetPanel();
    renderAll();
    return true;
  }

  function importPGN(text) {
    var candidate = new Chess();
    var ok = false;
    try {
      ok = candidate.load_pgn(text, { sloppy: true });
    } catch (err) {
      ok = false;
    }
    if (!ok) {
      toast('Não foi possível ler o PGN. Verifique o conteúdo do arquivo.', true);
      return;
    }

    game = candidate;
    var verbose = game.history({ verbose: true });
    var startFen = game.header().FEN || undefined;

    positions = [{ fen: startFen || (new Chess()).fen(), san: null, from: null, to: null, color: null, number: 1 }];
    var replay = new Chess(startFen);
    for (var i = 0; i < verbose.length; i++) {
      var move = verbose[i];
      replay.move({ from: move.from, to: move.to, promotion: move.promotion });
      positions.push({
        fen: replay.fen(),
        san: move.san,
        from: move.from,
        to: move.to,
        color: move.color,
        number: moveNumberAt(positions[i].fen)
      });
    }

    ply = positions.length - 1;
    evalsWhite = [];
    classifications = {};
    selectedSquare = null;
    $('graph-wrap').hidden = true;

    var header = game.header();
    var info = '';
    if (header.White || header.Black) {
      info = (header.White || '?') + ' vs ' + (header.Black || '?');
      if (header.Result) info += '  ·  ' + header.Result;
      if (header.Event && header.Event !== '?') info += '  ·  ' + header.Event;
    } else {
      info = 'Partida importada — ' + verbose.length + ' lances';
    }
    $('game-info').textContent = info;

    resetPanel();
    renderAll();
    toast('Partida importada: ' + verbose.length + ' lances.');
  }

  /* ---------------- Eventos ---------------- */

  function setupEvents() {
    var dropzone = $('dropzone');
    var fileInput = $('file-input');

    dropzone.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') fileInput.click();
    });
    $('select-file').addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function () {
      handleFile(fileInput.files[0]);
      fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (name) {
      dropzone.addEventListener(name, function (e) {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      dropzone.addEventListener(name, function (e) {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    $('load-fen').addEventListener('click', function () {
      var fen = $('fen-input').value.trim();
      if (!fen) { toast('Cole um FEN antes de carregar.', true); return; }
      if (newGame(fen)) {
        $('fen-input').value = '';
        toast('Posição carregada.');
      }
    });

    $('start-analysis').addEventListener('click', runPositionAnalysis);
    $('analyze-game').addEventListener('click', runFullAnalysis);
    $('stop-analysis').addEventListener('click', stopAnalysis);

    $('nav-start').addEventListener('click', function () { goToPly(0); });
    $('nav-prev').addEventListener('click', function () { goToPly(ply - 1); });
    $('nav-next').addEventListener('click', function () { goToPly(ply + 1); });
    $('nav-end').addEventListener('click', function () { goToPly(positions.length - 1); });
    $('flip-board').addEventListener('click', function () {
      flipped = !flipped;
      renderBoard();
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft') goToPly(ply - 1);
      if (e.key === 'ArrowRight') goToPly(ply + 1);
      if (e.key === 'Home') goToPly(0);
      if (e.key === 'End') goToPly(positions.length - 1);
    });

    $('show-mainline').addEventListener('change', renderToggles);
    $('show-all-lines').addEventListener('change', renderToggles);
  }

  function renderToggles() {
    $('mainline-block').hidden = !$('show-mainline').checked;
    if (lastResult && lastResult.best) {
      renderAnalysis(lastResult, true);
    }
  }

  function handleFile(file) {
    if (!file) return;
    if (file.type && file.type.indexOf('image/') === 0 || /\.png$/i.test(file.name)) {
      toast('Imagens PNG de diagrama ainda não são reconhecidas. Exporte a partida em PGN ou cole o FEN.', true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '').trim();
      if (!text) { toast('Arquivo vazio.', true); return; }
      if (/^([rnbqkpRNBQKP1-8\/]+\s+[wb]\s+){4}/.test(text)) {
        if (newGame(text)) toast('Posição FEN carregada.');
      } else {
        importPGN(text);
      }
    };
    reader.readAsText(file);
  }

  function renderAll() {
    renderBoard();
    renderMoves();
    $('ply-label').textContent = ply === 0
      ? 'Posição inicial'
      : 'Após ' + positions[ply].number + (positions[ply].color === 'w' ? '. ' : '... ') + positions[ply].san;
  }

  /* ---------------- Início ---------------- */

  setupEvents();
  newGame();
  if (typeof Worker === 'undefined') {
    setStatus('Indisponível', 'error');
    toast('Este navegador não suporta Web Workers. Use um navegador atualizado via HTTP.', true);
  }
}());
