# Concursos — CGU e Câmara dos Deputados

Fork independente do [Enem](https://github.com/aureovinicius/enem), com trilhas por edital, questões de Certo ou Errado, prática contínua, justificativas, favoritos, revisão de erros e estatísticas. Veja a origem em `FORK.md`.

O seletor **Edital, cargo ou banco** reúne os editais e o banco histórico. As quatro especialidades da CGU mantêm suas lições e questões; os 11 cargos da Câmara dos Deputados possuem roteiro de estudo e checklist de revisão.

## Diagnóstico por cargo

A aba **Diagnóstico** (`#diagnostico`, com redirecionamento de `#sobre`) substitui Sobre por um simulado de conhecimentos específicos de todos os cargos do edital escolhido. Para a CGU, são 40 itens autorais: dez por especialidade, cobrindo todas as disciplinas específicas, com distribuição semelhante por módulo. As questões são intercaladas e o cargo de cada item só aparece na revisão. O motor procura equilibrar gabaritos C/E sem sacrificar a cobertura.

O candidato pode marcar Certo, Errado ou Não sei, voltar, pausar e retomar a mesma amostra. A conclusão exige resposta explícita a todos os itens e só então revela correção, justificativas, desempenho por disciplina e comparação por cargo. O saldo é `(acertos − erros) / total × 100`, com Não sei valendo zero. Empates são preservados. Uma recomendação exige saldo positivo e pelo menos metade dos itens do cargo líder respondida com C/E; resultados insuficientes ficam inconclusivos. O resultado é uma sugestão de estudo sobre conhecimento atual: a dificuldade das amostras não foi calibrada e não se mede vocação ou probabilidade de aprovação.

As sessões ficam em `concursos-diagnostic-v1`, separadas de XP, lições, favoritos e estatísticas de prática. A última tentativa por edital pode ser retomada ou consultada; iniciar uma nova substitui esse diagnóstico. Questões podem se repetir e o efeito da revisão deve ser considerado. Sessões incompatíveis com um catálogo atualizado deixam de ser pontuadas. A Câmara permanece indisponível até haver cobertura suficiente em todos os cargos. Instalação PWA e informações de origem do conteúdo continuam acessíveis no painel expansível do diagnóstico.

## Câmara dos Deputados

O edital nº 1, de 02/10/2026, foi importado do PDF fornecido pelo usuário, preservado em `dist/data/edital-camara.pdf`. `data/camara-syllabus.json` contém o SHA-256, requisitos, cronograma, regras por cargo e o programa integral dos itens 14.2.3 e 14.2.4: 37 disciplinas e 287 tópicos principais. A prova está prevista no arquivo para 17/01/2027. Retificações externas não estão incorporadas.

Os cargos compartilham a revisão das disciplinas comuns; disciplinas específicas e progresso da CGU mantêm IDs separados. O checklist registra revisão manual, sem conceder XP ou aprovação. Ainda não há questões nem introduções conceituais vinculadas a esse edital. O banco de 27.557 questões de cargos de TI permanece independente, sem alegação de alinhamento à Câmara.

O link `?especialidade=camara-divulgacao-institucional#edital` abre o novo edital. Os demais cargos podem ser escolhidos no seletor. `catalog.exams` e `course.examId` associam cada trilha ao edital, enquanto `catalog.exam` mantém compatibilidade com o catálogo anterior da CGU.

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

## Instalar como aplicativo (PWA)

Abra https://aureovinicius.com.br/concursos-cgu/ com Chrome ou Edge e use a opção de instalação do menu do navegador. Em **Diagnóstico → Instalar aplicativo e informações do projeto**, o site também oferece um botão quando o navegador disponibiliza a instalação nativa. No iPhone/iPad, use Safari → Compartilhar → Adicionar à Tela de Início; no Safari do Mac, Arquivo → Adicionar ao Dock.

O manifesto define nome, ícones 192/512/maskable, janela independente e atalhos para Aprender, Praticar e Editais nos sistemas compatíveis. O build preserva a identidade e o escopo em `/concursos-cgu/`. Não é necessário publicar em uma loja de aplicativos.

Após o primeiro acesso online, o conteúdo principal pode ser aberto offline, inclusive por links de especialidade. Questões oficiais, imagens e PDFs são armazenados conforme o uso; o banco completo não é baixado automaticamente. O armazenamento está sujeito aos limites e à limpeza do navegador. Atualizações entram após fechar as janelas abertas do app e reabri-lo com internet, podendo exigir novo carregamento dos recursos opcionais. O progresso permanece no armazenamento local do navegador; não há sincronização entre dispositivos.

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
