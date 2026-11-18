#!/usr/bin/env bash
# Agente do Drive (dentro do hse-cycle, depois da leitura do Drive): diff -> leitura -> plano -> renome e catálogo.
# Só arquivos fora do padrão do Book. Leitura no Prometheus (texto, depois imagem) só do diff, para poupar a cota.
cd /opt/hse-automation || exit 1
A="npx tsx src/cli/runDriveAgent.ts"
Q="npx tsx src/cli/runLlmQueue.ts"

# Conferência: data no nome um ano ou mais nova que a lida no conteúdo -> releitura em alta (degrau 3,
# forçada mesmo com acordo) e, se divergir, o árbitro. Teto de arquivos por rodada no próprio passo.
if $A conferir; then
  npx tsx src/cli/runBookRenamePlan.ts | grep "\[book-plan\]"
  flock /run/lock/hse-llm.lock $Q --ids=scratch/agent_conferir.json --tier=3 --force 2>&1 | grep "\[llm-queue\]"
  flock /run/lock/hse-llm.lock $Q --ids=scratch/agent_conferir.json --arbiter 2>&1 | grep "\[llm-queue\]"
fi

$A diff || exit 0
# O plano diz de quem é cada arquivo (a fila de leitura precisa disso).
npx tsx src/cli/runBookRenamePlan.ts | grep "\[book-plan\]"
for args in "" "--vision"; do
  flock /run/lock/hse-llm.lock $Q --ids=scratch/agent_ids.json $args 2>&1 | grep "\[llm-queue\]"
done
# Plano de novo, agora com a leitura; aplica só o que não tem pendência.
npx tsx src/cli/runBookRenamePlan.ts | grep "\[book-plan\]"
$A decide
npx tsx src/cli/runBookRenameApply.ts scratch/agent_decisions.json 2>&1 | tail -n 40
