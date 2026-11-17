// Mescla um remendo de leituras (ex.: do leitor Antigravity) no data/llm_reading_cache.json.
// Leitura com acordo entra; leitura sem acordo só entra onde o cache também não tem acordo.
// Rodar sob a trava do leitor: flock /run/lock/hse-llm.lock node scripts/mergeLlmPatch.cjs <remendo.json>
const fs = require('fs')
const CACHE = 'data/llm_reading_cache.json'
const patch = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
let novos = 0, trocados = 0, mantidos = 0
for (const [k, v] of Object.entries(patch)) {
  const cur = cache[k]
  if (!cur) { cache[k] = v; novos++; continue }
  if (v.agreed || !cur.agreed) { cache[k] = { ...cur, ...v, previous: { tier: cur.tier, agreed: cur.agreed, confirmedBy: cur.confirmedBy } }; trocados++ }
  else mantidos++
}
fs.copyFileSync(CACHE, CACHE + '.antes-remendo')
fs.writeFileSync(CACHE, JSON.stringify(cache))
console.log(`[merge] ${novos} novos, ${trocados} atualizados, ${mantidos} mantidos (já tinham acordo)`)
