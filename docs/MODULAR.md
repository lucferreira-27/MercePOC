# Regras construtivas e arquitetura

## Representação

`lib/composition.ts` é o motor: schema, operações, subdivisões, posicionamento, peças e colisões. `lib/studio.ts` integra o motor ao projeto existente. `lib/design.ts` permanece como implementação legada para migração e regressões.

Schema v3: `profile`, `modules`, `connections`. Cada módulo tem dimensões externas, posição, rotação, material, fundo e árvore `root`. Cada compartimento, divisão, frente e peça tem ID estável. Nomes e índices visuais não são identidade. Posição é o centro da base do módulo, com Y para cima, X para direita e frente local em +Z. Rotação Y em graus.

Campos superiores `width`, `height`, `depth`, `materialId` e `shelves` retornados ao editor são projeções calculadas para compatibilidade. Não controlam geometria. Armazenamento e JSON exportado usam somente o schema canônico.

## Perfil demonstrativo v1

| Elemento | Convenção |
|---|---|
| Corpo/divisões | 18 mm |
| Fundo do módulo | 6 mm sobreposto e opcional |
| Portas/frentes | 18 mm embutidos |
| Folga perimetral e entre frentes de um conjunto | 2 mm |
| Caixa da gaveta | 15 mm |
| Fundo da gaveta | 6 mm sobreposto |
| Espaço lateral da caixa | 13 mm por lado |
| Recuo traseiro da caixa | 20 mm |

Constantes centralizadas em `PROFILE`, com versão fixa. Não garantem compatibilidade com dobradiças ou corrediças comerciais.

Corpo: laterais inteiras, base/tampo entre laterais, fundo sobreposto. Divisões novas recuam 20 mm da frente para liberar frentes embutidas. Prateleiras migradas mantêm as folgas antigas, 2 mm totais na largura e recuo traseiro de 10 mm. A migração não as converte às regras novas.

Porta simples: largura/altura livre menos 4 mm. Porta dupla: largura livre menos 4 mm perimetrais e 2 mm centrais, dividida igualmente. Pivôs na borda frontal externa, dobradiças nas extremidades externas. Abertura máxima de 95°.

Gavetas: altura disponível para frentes é altura livre menos 4 mm e menos 2 mm por encontro. Pesos começam iguais. Alterar uma frente redistribui proporcionalmente o restante. Mínimo de 80 mm por frente. Caixa: largura livre menos 26 mm; profundidade livre menos frente de 18 mm e recuo de 20 mm; altura da frente menos 24 mm. Laterais inteiras; frente/traseira da caixa entre laterais; fundo sobreposto por baixo. Seis peças por gaveta: frente externa, duas laterais, frente interna, traseira e fundo. Curso visual de até 70% da profundidade da caixa.

## Compartimentos

Divisão insere painel de 18 mm e cria dois filhos. Eixo X cria divisória vertical; Y cria prateleira horizontal. `gapMm` é espaço livre à esquerda ou abaixo, medido das faces internas. Distribuição e redimensionamento descontam espessuras e preservam proporções do espaço livre, inclusive em cadeias de divisões.

Limite de 32 compartimentos finais por módulo. Todos os nós precisam de largura e altura livres de pelo menos 100 mm. Uma frente ocupa um compartimento final. Não há portas externas envolvendo gavetas internas. Mesclar exige filhos sem frentes e sem subdivisões; remova-os primeiro.

## Conexões

Conexão declara pai/filho, lado esquerdo/direito/acima, alinhamento frontal/traseiro, afastamento e compartilhamento. Cada filho tem um pai; ciclos são rejeitados. Posição dos descendentes deriva das conexões.

Compartilhamento exige face completa, mesma orientação, material, espessura e profundidade. Laterais exigem mesma altura; tampo/base exigem mesma largura. Afastamento zero. Fundo/frentes não são compartilháveis. A peça única conserva o ID da face do pai e dois proprietários.

Filho sobrepõe exatamente 18 mm à posição adjacente. Fundos são ajustados em 9 mm nas bordas compartilhadas. Em tampo/base compartilhado, o painel horizontal ocupa largura externa e laterais adjacentes são encurtadas em 18 mm. O motor verifica coincidência das faces finais antes de deduplicar.

Separar recompõe dois painéis e reposiciona o filho com seus descendentes para eliminar a sobreposição comum. Alteração incompatível não remove conexão silenciosamente. Para mudar alturas de dois módulos com lateral compartilhada, envie os dois redimensionamentos no mesmo pedido, ou separe primeiro.

O L usa módulos ortogonais sem compartilhamento. O posicionamento considera a extensão do módulo girado e o alinhamento pedido. Não é criado canto especial. Módulos elevados recebem aviso de revisão de apoio/fixação.

## Colisões e animação

Volumes dos módulos e painéis orientados são verificados fechados; contato sem interpenetração é permitido. Sobreposição declarada de módulos compartilhados é permitida; as peças finais continuam verificadas.

Movimentos usam SAT de caixas orientadas contra os outros painéis, considerando outras frentes abertas. Pelo menos 190 amostras, aumentando a resolução para percurso de cerca de 2 mm em peças maiores. É verificação geométrica demonstrativa, não simulação física/ferragens. Abrir e fechar pelo painel param antes da interferência e informam o bloqueio.

Abertura e destaque não alteram revisões/exportações. Perguntas sem alteração preservam aberturas; nova revisão fecha as frentes. Portas animam pelo pivô real. Transições terminam na geometria exata e respeitam `prefers-reduced-motion`.

## Contrato e atomicidade

Operações: `module.add`, `module.edit`, `module.duplicate`, `module.remove`, `connect`, `disconnect`, `cell.split`, `cell.move`, `cell.merge`, `cell.distribute`, `front.set`, `drawer.height`. Operações antigas de prateleira continuam disponíveis para compatibilidade.

O modelo recebe composição/hierarquia, pedido atual, seleção, referências e revisão vigente. Nunca gera meshes, CSV ou lista de corte. Novos módulos podem receber ID explícito; a raiz será `id:root`. Dividir cria `id:low`, `id:high`, `id:divider`, permitindo operações dependentes no mesmo pedido.

`executeRequest` trabalha numa cópia, valida o resultado completo e salva uma revisão única. Alterações relacionadas podem ter um estado intermediário incompatível. Qualquer falha preserva o design. IDs gerados na pré-validação são os mesmos gravados, sem executar novamente ao salvar. Quando a validação recusa o lote, o erro volta ao modelo com a composição inalterada e ele pode reenviar o lote corrigido no mesmo pedido, até duas correções, antes de o turno ser recusado.

`POST /api/projects`, ações `op` e `ops`, usa o contrato do chat. `ops` aceita até 32 operações. Versão otimista previne sobrescrita. Chat deduplica requestId por projeto com mensagens persistidas; reenvio confirmado não incrementa versão. Esclarecimentos usam cards de IDs reais e retomam a intenção original. Seleção explícita tem precedência sobre destaques automáticos. IDs removidos não são substituídos silenciosamente. Abertura pelo chat usa `view`, sem operação de design.

Histórico/alternativas guardam snapshots completos. Restaurar cursor preserva futuro até uma nova edição. Alternativa preserva original e copia mensagens vinculadas às revisões incluídas.

## Migração e saídas

SQLite usa `VACUUM INTO` antes de operar um banco antigo, produzindo backup consistente inclusive com WAL. O backup não é sobrescrito. Conversão v1/v2 é determinística por revisão, na leitura; próximo salvamento persiste v3. Medidas antigas não são adaptadas a presets. IDs antigos de prateleira continuam resolvíveis. Mensagens e vínculos inequívocos de revisão são preservados.

CSV/Cortecloud usam peças fechadas. Painel compartilhado sai uma vez com dois proprietários. Peças internas identificam compartimento e função. C/L seguem o plano local do painel, não sua orientação no ambiente. JSON completo contém composição, conexões, perfil, versão e histórico. Impressão mostra vista superior e tabela.

Não são exportados ferragens, furações ou usinagens inventadas. Não há otimização de chapas. Importação numa conta Cortecloud real, reimportação de projeto JSON pela interface, análise estrutural e documentação completa de montagem não fazem parte da entrega.
