# Concursos — CGU 2026

Fork independente do [Enem](https://github.com/aureovinicius/enem), com trilhas por edital, questões de Certo ou Errado, prática contínua, justificativas, favoritos, revisão de erros e estatísticas. Veja a origem em `FORK.md`.

A especialidade prioritária é **TI — Desenvolvimento de Sistemas**. Novos acessos começam nessa trilha, com o bloco P3 e Engenharia de Software em destaque. Seleções anteriores e progresso são preservados. O link `?especialidade=desenvolvimento#aprender` seleciona explicitamente a trilha e consome o parâmetro para respeitar escolhas posteriores.

## Conteúdo inicial

O edital oficial da CGU publicado em 9/10/2026 está preservado em `dist/data/edital-cgu-2026.pdf`. O programa integral do item 15.2 está em `data/syllabus.json`, com URL, SHA-256 e data da conferência. São quatro especialidades: Auditoria, Ciência de Dados, Infraestrutura de TI e Desenvolvimento de Sistemas.

As quatro trilhas do edital possuem 130 exercícios **autorais**, cinco por disciplina. Cada item contém gabarito, explicação, referência e vínculo editorial ao programa. A prova de 2026 ainda não foi aplicada. Este banco não esgota os tópicos do edital. A discursiva consta do resumo, sem correção automática.

O banco **Provas anteriores · Cebraspe TI**, acessível por `?especialidade=cebraspe-ti#praticar`, acrescenta **27.557 questões oficiais de 510 cadernos e 142 concursos**, com páginas originais, gabaritos definitivos e filtros por concurso, ano, bloco, palavra-chave e histórico. Figuras, tabelas e código permanecem nas páginas da prova; a transcrição é auxiliar. Questões anuladas, cadernos ambíguos e documentos com respostas impressas junto do enunciado não entram na prática. Os totais e as exclusões estão em `data/cebraspe-import-report.json`.

Este banco histórico não presume alinhamento ao edital da CGU nem inclui justificativas pedagógicas geradas. Registra acertos, erros e tempo sem aplicar penalidades ou pesos de outro concurso. Os recursos são carregados quando usados. A reprodução da importação está documentada em `scripts/import-cebraspe/README.md`.

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

A publicação principal usa [GitHub Pages](https://aureovinicius.com.br/concursos-cgu/), com HTTPS obrigatório. A cada push em `main`, o workflow `.github/workflows/pages.yml` executa os testes, gera o pacote com caminhos relativos ao repositório e o publica pelo GitHub Actions. O repositório é público, a variável `PAGES_ENABLED=true` está habilitada e o Pages está configurado para GitHub Actions. Pull requests executam as verificações sem publicar.

A cópia no ChatGPT Sites usa `dist/` e a identidade própria em `.openai/hosting.json`; esse endereço é atualizado pelo fluxo do Sites, separadamente do GitHub Actions.

```sh
node scripts/build-github-pages.mjs --base-path /concursos-cgu --out-dir _site
```

Atualizações de conteúdo devem alterar os arquivos em `data/`, executar o gerador e revisar enunciados/comentários. Ao mudar arquivos principais, atualizar a versão do cache de forma consistente em `app.js`, `index.html` e `sw.js`.

Fonte oficial: https://www.cebraspe.org.br/concursos/cgu_26_affc . Conferência: 13/10/2026. Consulte a banca para retificações. Projeto independente, sem vínculo institucional com CGU ou Cebraspe.
