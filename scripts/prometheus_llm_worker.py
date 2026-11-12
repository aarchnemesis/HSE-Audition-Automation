"""
Leitor de documentos EHS em lote usando o modelo do Prometheus (Hermes), sem subir um agente por
pergunta: um só processo Python dentro do contêiner, com N threads chamando agent.auxiliary_client.call_llm
(mesmo provedor, modelo e credenciais do Prometheus, que nunca saem do contêiner).

Entrada : JSONL (arquivo ou "-" para stdin) com {"id": ..., "prompt": ...} por linha.
Saída   : JSONL (arquivo ou "-" para stdout) com {"id": ..., "content": ...} ou {"id": ..., "error": ...}, gravado a cada resposta.
Retoma  : ids que já estão na saída são pulados.

Uso (dentro do contêiner do Prometheus):
  /opt/hermes/.venv/bin/python /opt/data/hse/prometheus_llm_worker.py IN.jsonl OUT.jsonl [THREADS]
"""
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, "/opt/hermes")
from agent.auxiliary_client import call_llm  # noqa: E402

PROVIDER = "openai-codex"
MODEL = "gpt-5.6-luna"


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    threads = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    done = set()
    if dst != "-":
      try:
        with open(dst, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                    if "content" in r:
                        done.add(r["id"])
                except ValueError:
                    pass
      except FileNotFoundError:
        pass
    jobs = []
    lines = sys.stdin if src == "-" else open(src, encoding="utf-8")
    for line in lines:
        if line.strip():
            j = json.loads(line)
            if j["id"] not in done:
                jobs.append(j)
    lock = threading.Lock()
    out = sys.stdout if dst == "-" else open(dst, "a", encoding="utf-8")
    log = sys.stderr if dst == "-" else sys.stdout
    started = time.time()
    count = {"n": 0}

    def run(job):
        t0 = time.time()
        rec = {"id": job["id"]}
        for attempt in range(3):
            try:
                resp = call_llm(
                    provider=PROVIDER,
                    model=MODEL,
                    messages=[{"role": "user", "content": job["prompt"]}],
                    timeout=240,
                )
                rec = {"id": job["id"], "content": resp.choices[0].message.content, "secs": round(time.time() - t0, 1)}
                break
            except Exception as e:  # noqa: BLE001
                rec = {"id": job["id"], "error": f"{type(e).__name__}: {str(e)[:300]}"}
                time.sleep(5 * (attempt + 1))
        with lock:
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()
            count["n"] += 1
            if count["n"] % 10 == 0 or count["n"] == len(jobs):
                el = time.time() - started
                print(f"[worker] {count['n']}/{len(jobs)} em {el/60:.1f} min ({el/count['n']:.1f} s/item)", file=log, flush=True)

    with ThreadPoolExecutor(max_workers=threads) as ex:
        list(ex.map(run, jobs))
    if out is not sys.stdout:
        out.close()


if __name__ == "__main__":
    main()
