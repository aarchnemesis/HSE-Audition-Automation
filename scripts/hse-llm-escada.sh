#!/usr/bin/env bash
# Escada de leitura do Prometheus sobre o que mudou no Drive (roda dentro do hse-cycle, depois da leitura do Drive).
# Cada degrau só pega o que o anterior não resolveu: 1 texto, 2 imagem, 3 imagem em alta com modelos fortes, 4 árbitro.
# O resultado entra no Drive na rodada seguinte (leitura nova invalida o cache do arquivo).
cd /opt/hse-automation || exit 1
export HSE_PROMETHEUS_PARALLEL="${HSE_PROMETHEUS_PARALLEL:-6}"
for args in "" "--vision" "--tier=3" "--arbiter"; do
  # Trava única: a fila grava data/llm_reading_cache.json inteiro; duas filas juntas se sobrescrevem.
  flock /run/lock/hse-llm.lock npx tsx src/cli/runLlmQueue.ts $args 2>&1 | grep "\[llm-queue\]"
done
