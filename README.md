# ♞ Analisador de Partidas — Xadrez com Stockfish

Analisador de partidas de xadrez que roda **100% no navegador**, movido pelo
motor [Stockfish](https://stockfishchess.org) compilado para WebAssembly.

Importe sua partida, receba uma análise completa com avaliações, variações,
linha principal e classificação lance a lance.

![Interface](docs/screenshot.png)

## ✨ Funcionalidades

- **Importar partida** — arraste e solte um arquivo PGN/TXT, selecione um
  arquivo ou cole um FEN.
- **Análise com Stockfish (WASM)** — executada localmente em um Web Worker,
  sem enviar nada para servidores.
- **Configurações da análise**
  - Profundidade (níveis) — padrão `20`
  - MultiPV (variações) — padrão `3`
  - Tempo por lance (s) — padrão `2`
  - Alternar linha principal e todas as variações
- **Painel do motor**
  - Avaliação (`+0.32`) com descrição ("Equilíbrio (Leve vantagem Brancas)")
  - Barra de avaliação visual
  - Melhor lance recomendado
  - Principais variações (MultiPV) com avaliações
  - Linha principal com profundidade e contagem de nós
- **Análise da partida completa** — avalia todas as posições e classifica cada
  lance (★ Ótimo · Bom · Imprecisão `?!` · Erro `?` · Blunder `??`).
- **Gráfico de avaliação** — evolução da vantagem ao longo da partida,
  clicável para navegar.
- **Tabuleiro interativo** — navegação por lances (botões, setas do teclado e
  clique na lista), destaque do último lance e do xeque, jogar lances
  manualmente a partir da última posição, virar o tabuleiro.
- **Interface Material You** em tema escuro, responsiva para celular e desktop.

## 🚀 Como executar

O app é 100% estático — não há build nem dependências para instalar.
Por causa das restrições de Web Worker, sirva os arquivos via HTTP:

```bash
python -m http.server 8080
# ou
npx serve .
```

Depois abra <http://localhost:8080>.

> Publicando no **GitHub Pages** (Settings → Pages) o app funciona
> diretamente, também offline após o primeiro carregamento (PWA-ready,
> todos os assets são locais).

## 📂 Estrutura

```
analisischess/
├── index.html          # Interface principal
├── css/style.css       # Tema escuro Material You
├── js/app.js           # Lógica da interface, tabuleiro e análise
├── js/engine.js        # Wrapper UCI do Stockfish em Web Worker
└── examples/           # Partidas de exemplo para importar
```

No primeiro acesso as bibliotecas são baixadas de um CDN (Stockfish 10 WASM,
~370 KB, e chess.js); a análise em si roda **100% localmente no seu
navegador** — nada é enviado para servidores.

## 🖼️ Importação por imagem (PNG)

A zona de importação aceita PNG de diagrama, porém o reconhecimento
automático de posição por imagem ainda não está implementado — nesse caso o
app orienta a colar o **FEN** da posição ou importar o **PGN** da partida.

## 📄 Licenças

- Código do projeto: MIT
- [Stockfish](https://github.com/official-stockfish/Stockfish): GPL-3.0
  (motor carregado de https://github.com/nmrugg/stockfish.js, v10.0.2)
- [chess.js](https://github.com/jhlywa/chess.js): BSD-2-Clause (v0.10.3 via CDN)
