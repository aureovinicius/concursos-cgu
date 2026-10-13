# Concursos — CGU 2026

Fork independente do [Enem](https://github.com/aureovinicius/enem), com trilhas por edital, questões de Certo ou Errado, prática contínua, justificativas, favoritos, revisão de erros e estatísticas. Veja a origem em `FORK.md`.

## Conteúdo inicial

O edital oficial da CGU publicado em 9/10/2026 está preservado em `dist/data/edital-cgu-2026.pdf`. O programa integral do item 15.2 está em `data/syllabus.json`, com URL, SHA-256 e data da conferência. São quatro especialidades: Auditoria, Ciência de Dados, Infraestrutura de TI e Desenvolvimento de Sistemas.

O banco inicial possui 130 exercícios **autorais**, cinco por disciplina. Não são questões oficiais da CGU/Cebraspe. Cada item contém gabarito, explicação, referência e vínculo editorial ao programa. A prova de 2026 ainda não foi aplicada. Este banco não esgota os tópicos do edital. A discursiva consta do resumo, sem correção automática.

P1/P2: +1 por acerto, −1 por erro; P3: +2/−2. O saldo é do treino, incluindo repetições; não é previsão de nota/classificação. Pular não registra resposta. XP é separado dessa pontuação. Lições admitem até três erros por tentativa; prática livre não tem limite.

## Executar

Requer Node.js 22+ para scripts/testes e qualquer servidor HTTP estático. O app não tem dependências npm.

```sh
node scripts/build-catalog.mjs
node --test scripts/test-*.mjs
python3 -m http.server 51946 --directory dist
```

No navegador, abra `http://localhost:51946`. O manifesto e o service worker oferecem instalação pelo menu do navegador e cache do conteúdo principal. PDF e demais recursos opcionais dependem do primeiro acesso online.

## Dados e isolamento

O progresso fica no navegador sob `concursos-cgu-progress-v1`. Não há login ou sincronização. Questões comuns mantêm IDs únicos e compartilham o progresso entre especialidades; itens específicos não se misturam. Os dados e caches do ENEM não são alterados.

## Publicação

O Sites usa `dist/` e a identidade própria em `.openai/hosting.json`. Para GitHub Pages, o workflow valida e gera um pacote com caminhos relativos ao repositório. A implantação só é ativada com a variável `PAGES_ENABLED=true` e o Pages configurado para GitHub Actions; o repositório começa privado.

```sh
node scripts/build-github-pages.mjs --base-path /concursos-cgu --out-dir _site
```

Atualizações de conteúdo devem alterar os arquivos em `data/`, executar o gerador e revisar enunciados/comentários. Ao mudar arquivos principais, atualizar a versão do cache de forma consistente em `app.js`, `index.html` e `sw.js`.

Fonte oficial: https://www.cebraspe.org.br/concursos/cgu_26_affc . Conferência: 13/10/2026. Consulte a banca para retificações. Projeto independente, sem vínculo institucional com CGU ou Cebraspe.
