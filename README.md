# DTF UV — Gang Sheets

Aplicativo web **local-first** (português) para montar gang sheets de DTF UV / Mercado Livre a partir de PNGs.

Tudo roda no navegador: **nenhum arquivo é enviado a um servidor**.

## Como rodar

```bash
cd dtf-gang-sheet
npm install
npm run dev
```

Abra o endereço indicado no terminal (em geral `http://localhost:5173`).

Build de produção:

```bash
npm run build
npm run preview
```

## O que faz

1. **Importar** vários PNGs (arquivos ou pasta inteira).
2. **Recortar** (opcional, ligado por padrão) cada arte ao bounding box do canal alpha — dá para ligar/desligar e ajustar a sensibilidade sem reimportar.
3. **Dimensionar** no modo *lado maior*: o maior lado da arte vira o valor em cm (padrão **5 cm**); o outro lado proporcional.
4. Definir **quantidade** por arte.
5. Escolher **folha** (29×21, 29×42, 29×50, 29×100 cm ou personalizada), **margem**, **espaçamento** e **DPI**. Rotação **90°** é por arte (botão na tabela); todas as cópias da mesma arte ficam na mesma orientação.
6. **Empacotar** com MaxRects (várias folhas se necessário).
7. **Pré-visualizar** e **exportar** cada folha em PNG (RGBA, fundo transparente) ou **ZIP** com todas. DPI embutido via chunk `pHYs`.

## Valores padrão

| Parâmetro        | Padrão      |
|------------------|-------------|
| Folha            | 29 × 42 cm  |
| Lado maior       | 5 cm        |
| Margem           | 5 mm        |
| Espaçamento/gap  | 3 mm        |
| Rotação 90°      | por arte (desligada) |
| DPI              | 300         |
| Cortar bordas transparentes | ligado |
| Sensibilidade do corte (alpha) | 1    |
| Quantidade/arte  | 1           |

## Limitações

- Apenas PNG (com transparência).
- Packing é heurístico (MaxRects); não garante o mínimo absoluto de folhas.
- Pastas (`webkitdirectory`) dependem do suporte do navegador.
- Arquivos muito grandes / muitas peças podem consumir bastante memória no browser.

## Stack

Vite + React + TypeScript, `maxrects-packer`, JSZip, FileSaver.
