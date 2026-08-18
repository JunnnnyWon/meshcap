#!/usr/bin/env bash
#
# junnnnyserver에 MeshCap을 배포한다.
#
#   bash scripts/deploy.sh
#
# 소스를 서버로 옮기고 그 자리에서 이미지를 만든다. 맥은 arm64, 서버는 x86_64라
# 로컬에서 만든 이미지를 그대로 보낼 수 없고, 교차 빌드는 느리기 때문이다.
# 외부 노출은 Tailscale Serve가 맡으며 컨테이너 포트는 루프백에만 열린다.

set -euo pipefail

HOST="${MESHCAP_HOST:-junnnnyserver}"
REMOTE_DIR="${MESHCAP_REMOTE_DIR:-apps/meshcap}"
PORT="${MESHCAP_PORT:-8788}"
SERVE_PORT="${MESHCAP_SERVE_PORT:-8443}"

cd "$(dirname "$0")/.."

echo "▸ ${HOST} 연결 확인"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'docker info >/dev/null' \
  || { echo "docker에 접근할 수 없습니다. ssh 설정과 docker 그룹 권한을 확인하세요."; exit 1; }

# 서버에 rsync가 없어 tar 파이프로 보낸다. 지난 배포의 잔재가 남지 않도록
# 디렉터리를 비우고 새로 푼다. COPYFILE_DISABLE은 macOS tar가 확장 속성용
# ._ 파일을 끼워 넣는 것을 막는다.
echo "▸ 소스 동기화 → ${HOST}:~/${REMOTE_DIR}"
ssh "$HOST" "rm -rf ~/${REMOTE_DIR} && mkdir -p ~/${REMOTE_DIR}"
COPYFILE_DISABLE=1 tar czf - \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'docs/figures' \
  --exclude 'bench/exports' \
  --exclude 'bench/models' \
  --exclude '.DS_Store' \
  . | ssh "$HOST" "tar xzf - -C ~/${REMOTE_DIR}"

echo "▸ 이미지 빌드 및 기동"
ssh "$HOST" "cd ~/${REMOTE_DIR} && MESHCAP_PORT=${PORT} docker compose up -d --build"

echo "▸ 응답 확인"
for attempt in $(seq 1 30); do
  if ssh "$HOST" "curl -fsS -o /dev/null http://127.0.0.1:${PORT}/" 2>/dev/null; then
    echo "  컨테이너가 ${PORT} 포트에서 응답합니다."
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "컨테이너가 응답하지 않습니다. 로그를 확인하세요."
    ssh "$HOST" "cd ~/${REMOTE_DIR} && docker compose logs --tail 40"
    exit 1
  fi
  sleep 2
done

# Serve는 테일넷 안에서만 열린다. Funnel을 켜지 않는 한 인터넷에 노출되지 않으며,
# 기존 443 설정은 포트가 다르므로 건드리지 않는다.
echo "▸ Tailscale Serve 설정 (HTTPS ${SERVE_PORT})"
ssh "$HOST" "tailscale serve --bg --https=${SERVE_PORT} http://127.0.0.1:${PORT}" >/dev/null

DOMAIN=$(ssh "$HOST" "tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"Self\"][\"DNSName\"].rstrip(\".\"))'")
URL="https://${DOMAIN}:${SERVE_PORT}"

echo "▸ 테일넷 경유 확인"
if curl -fsS -o /dev/null --max-time 20 "$URL"; then
  echo
  echo "배포 완료: ${URL}"
else
  echo
  echo "컨테이너는 떴지만 테일넷 주소로는 아직 응답하지 않습니다: ${URL}"
  ssh "$HOST" "tailscale serve status"
  exit 1
fi
