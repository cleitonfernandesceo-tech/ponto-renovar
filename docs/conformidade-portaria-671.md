# Conformidade com a Portaria MTP 671/2021 e CLT — o que o app já faz e o que depende do dono

Atualizado em 12/11/2026. Fonte das regras: art. 78, 79, 81, 83, 91 e Anexos VII e IX da Portaria MTP 671/2021 (texto do DOU).

| Exigência | Situação no app |
|---|---|
| Comprovante de cada batida (art. 79) | Tela mostra após cada batida: título "Comprovante de Registro de Ponto do Trabalhador", NSR, empresa + CNPJ, local, nome + CPF, data/hora, programa e nº INPI. **Falta:** código hash SHA-256 da marcação (inc. VIII) e o nº do INPI real (hoje "registro em andamento"). O hash em cadeia já existe no AFD (tipo 7). |
| Espelho mensal assinado pelo colaborador | Aceite/contestação eletrônica com data e hora (tela Meu espelho) + PDF com linha de assinatura. |
| AFD e AEJ (art. 81 e 83) | Gerados pelo app. A assinatura `.p7s` é feita por `tools/assinar-afd-aej.mjs` quando o `.pfx` do e-CNPJ A1 estiver em `C:\renovar\cofre\ecnpj.pfx`. |
| Atestado Técnico e Termo de Responsabilidade (art. 78, Anexo VII) | Painel do gestor › Folha e contador › "Termo do REP-P (PDF para assinar)". **Dono precisa:** preencher nº do INPI, nomes e CPF do responsável legal e do técnico e assinar. |
| Registro do programa no INPI (art. 91) | Pasta pronta com hash e passo a passo (fora do repositório, com o dono). |
| Relatórios para o contador | Painel do gestor › Folha e contador › "Pacote do contador" (PDF e planilha): folha, FGTS, INSS, IRRF, provisões de 13º e férias e prazos. |

Nada neste app marca ponto sozinho: cada batida é ato do colaborador (Portaria 671).
