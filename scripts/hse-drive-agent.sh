#!/usr/bin/env bash
# Agente do Drive (dentro do hse-cycle, depois da leitura do Drive): diff -> leitura -> plano -> renome e catálogo.
# Só arquivos fora do padrão do Book. Leitura no Prometheus (texto, depois imagem) só do diff, para poupar a cota.
cd /opt/hse-automation || exit 1
A="npx tsx src/cli/runDriveAgent.ts"
$A diff || exit 0
# O plano diz de quem é cada arquivo (a fila de leitura precisa disso).
npx tsx src/cli/runBookRenamePlan.ts | grep "\[book-plan\]"
for args in "" "--vision"; do
  flock /run/lock/hse-llm.lock npx tsx src/cli/runLlmQueue.ts --ids=scratch/agent_ids.json $args 2>&1 | grep "\[llm-queue\]"
done
# Plano de novo, agora com a leitura; aplica só o que não tem pendência.
npx tsx src/cli/runBookRenamePlan.ts | grep "\[book-plan\]"
$A decide
npx tsx src/cli/runBookRenameApply.ts scratch/agent_decisions.json 2>&1 | tail -n 40
