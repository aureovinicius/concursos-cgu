# Importação das provas Cebraspe TI

O acervo original está em `research/cebraspe-ti/`, fora do Git. Nenhuma API de questões ou modelo de IA é chamado por esta importação.

Instale `requirements.txt` em um ambiente Python e execute, na raiz do projeto:

```sh
python -m pip install -r scripts/import-cebraspe/requirements.txt
python scripts/import-cebraspe/key_extract.py
python scripts/import-cebraspe/pair_keys.py
python scripts/import-cebraspe/exam_extract.py
python scripts/import-cebraspe/build_official.py --work research/cebraspe-ti/import --extracted research/cebraspe-ti/import/extracted-papers
node scripts/build-catalog.mjs
python -m unittest discover -s scripts/import-cebraspe -p 'test_*.py'
node --test scripts/test-*.mjs
```

`CEBRASPE_ARCHIVE` pode apontar para outro acervo com o mesmo catálogo. `CEBRASPE_IMPORT_OUTPUT` configura os intermediários dos extratores. O montador aceita `--archive`, `--work`, `--extracted`, `--workers` e `--width`.

## Critérios

- O número da questão só é usado com o evento e o código completo de caderno que também constam do gabarito definitivo. Matrizes têm identidade própria.
- Conflitos de identificação/gabarito, questões anuladas, alternativas não identificadas e documentos que mostram respostas junto do enunciado ficam fora da prática.
- Edições ampliadas/adaptadas equivalentes são deduplicadas. A edição selecionada sempre usa seu próprio gabarito.
- As páginas originais são a representação principal. A transcrição é auxiliar, sujeita a problemas de extração, e não substitui fórmulas, figuras, tabelas ou textos compartilhados. As páginas anteriores necessárias à leitura permanecem como material de apoio.
- Não se infere uma justificativa pedagógica nem alinhamento automático ao edital da CGU. A correção informa o gabarito definitivo e sua fonte.
- O ano vem da aplicação indicada no gabarito, quando disponível. O ano inferido do identificador do concurso fica sinalizado como referência do concurso.

## Saídas

`data/official-content.json` contém o banco reproduzível e `data/cebraspe-import-report.json` registra inclusões e exclusões. O catálogo principal preserva as questões autorais e lista os IDs do banco oficial. As questões oficiais ficam em partes de até aproximadamente 4 MiB, carregadas quando o banco é selecionado. As imagens WebP são compartilhadas entre os itens da mesma página e entram no cache somente após acesso.

Os intermediários, relatórios de extração e a conferência independente de uma amostra de gabaritos permanecem em `research/cebraspe-ti/import/`. Os PDFs originais continuam no acervo local. O processo verifica referências e consistência, mas não equivale a uma revisão humana de cada enunciado.
