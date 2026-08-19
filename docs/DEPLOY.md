# 배포

공개 주소는 [https://meshcap.junnnny.kr](https://meshcap.junnnny.kr)입니다. GitHub Pages는 쓰지 않습니다.

`junnnnyserver`에서 Docker 컨테이너 세 개로 돌아갑니다.

| 컨테이너 | 역할 |
| --- | --- |
| `meshcap-web` | nginx. 정적 파일을 내려주고 `/api/`를 `meshcap-api`로 넘김 |
| `meshcap-api` | Node가 `src/core`를 그대로 실행하는 연산 서버 |
| `meshcap-tunnel` | Cloudflare Tunnel. 공개 도메인을 연결 |

호스트 포트는 루프백에만 열립니다. 공개 주소는 Cloudflare Tunnel이 나가는 연결만으로 연결하므로 방화벽에 구멍을 내지 않고 서버 IP도 드러나지 않습니다. 같은 컨테이너를 Tailscale Serve로 테일넷에도 열어 두었습니다.

| 경로 | 주소 | 전송 상한 |
| --- | --- | --- |
| 공개 | `https://meshcap.junnnny.kr` | 95MB (Cloudflare 무료 플랜 100MB 제한) |
| 테일넷 | `https://junnnnyserver.tail9d6315.ts.net:8443` | 512MB |

연산 요청이 상한을 넘으면 보내기 전에 접고 브라우저에서 처리한 뒤 그 사실을 화면에 알립니다. 삼백만 삼각형짜리 모델은 좌표만 142MB라 공개 경로에서는 항상 브라우저로 처리됩니다.

`/api/repair`에는 분당 6회, 동시 연결 2개 제한을 걸었습니다. 한 번 호출에 수 초의 CPU와 수백 메가바이트를 쓰는 요청이라 공개된 이상 필요한 방어입니다. 값이 싼 `/api/health`에는 걸지 않았습니다.

```bash
bash scripts/deploy.sh
```

소스를 서버로 보내 그 자리에서 이미지를 만듭니다. 맥은 arm64, 서버는 x86_64라 로컬 이미지를 그대로 옮길 수 없기 때문입니다. 이미지 빌드 과정에 단위 테스트와 타입 검사가 들어 있어 통과하지 못하면 배포되지 않습니다.

터널 자격증명(`~/.cloudflared/cert.pem`)이 서버에 있으면 공개 도메인까지 함께 올리고, 없으면 테일넷 전용으로만 올립니다. 자격증명은 저장소에 넣지 않습니다. 처음 설정할 때만 아래를 한 번 실행합니다.

```bash
CF="docker run --rm --user $(id -u):$(id -g) -e HOME=/tmp \
  -v $HOME/.cloudflared:/tmp/.cloudflared cloudflare/cloudflared:latest"
$CF tunnel login                                   # 브라우저에서 영역 승인
$CF tunnel create meshcap
$CF tunnel route dns meshcap meshcap.junnnny.kr
```

포트나 호스트를 바꾸려면 환경 변수를 넘깁니다.

| 변수 | 기본값 | 뜻 |
| --- | --- | --- |
| `MESHCAP_HOST` | `junnnnyserver` | 배포 대상 SSH 호스트 |
| `MESHCAP_PORT` | `8788` | 서버 루프백에 여는 컨테이너 포트 |
| `MESHCAP_SERVE_PORT` | `8443` | Tailscale Serve가 여는 HTTPS 포트 |

최종 리포트도 스크립트로 만듭니다. 본문에 인용하는 수치를 `src/bench/results.json`에서 직접 읽어오므로, 알고리즘을 고치고 측정을 다시 돌리면 문서의 숫자도 함께 갱신됩니다.

```bash
npm run dev                 # 다른 터미널에서 개발 서버를 띄운 뒤
node docs/capture.mjs       # 화면 캡처 → docs/figures/
# README용 이미지는 docs/screenshots/에 선별해 둔다.
bash docs/build-report.sh   # → docs/MeshCap_최종리포트.docx
```
