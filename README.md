# junyeol.net

Portfolio site of Junyeol — graphic designer and art director.

## 콘텐츠 수정하기 (코드 없이)

1. https://app.pagescms.org 접속 → GitHub로 로그인 → `junyeol-web/junyeol.net` 선택
2. **Projects**에서 프로젝트 추가·수정, **Information & settings**에서 소개·연락처 수정
3. 이미지는 JPG/PNG 그대로 올리면 됨 — 배포할 때 자동으로 WebP로 변환되고 화면 크기별(640 / 1280 / 2000px)로 리사이즈됨
4. 저장하면 GitHub에 커밋 → 1~2분 뒤 사이트에 반영 (진행 상황: 저장소의 **Actions** 탭)

### 프로젝트 필드 요약
| 필드 | 용도 |
|---|---|
| One-line idea | 제목 아래 문장 + 링크 미리보기 설명 |
| Context | 인덱스 필터 (Commissioned / Self-initiated / Yale School of Art / Collaboration) |
| Cover image | 인덱스 hover 미리보기 + 링크 공유 썸네일 |
| Images and videos | 위에서 아래 순서. Layout: `full` 전체폭 · `half` 절반(두 개 연속이면 나란히) · `inset` 가운데 좁게 |
| Selected work | 인덱스에 ● 표시 |
| Order | 작은 숫자가 위 (10, 20, 30… 으로 두면 중간 삽입이 쉬움) |
| Hide (draft) | 사이트에서 숨김 |

## 구조

```
content/
  site.json            소개·연락처·설정
  projects/*.json      프로젝트 1개 = 파일 1개 (파일명이 URL: /work/<파일명>/)
  media/               업로드한 원본 이미지·영상
src/styles.css         디자인 (색·폰트는 맨 위 변수에서)
src/main.js            인덱스 hover 미리보기, 필터, List/Images 전환
build.mjs              content → dist/ 정적 사이트 생성, 이미지 WebP 변환
.pages.yml             Pages CMS 입력 화면 설정
.github/workflows/     main에 push되면 빌드 후 GitHub Pages로 배포
```

## 로컬에서 보기

```
npm install
npm run dev
```

## 도메인 연결 (junyeol.net)

1. 저장소 **Settings → Pages → Custom domain**에 `junyeol.net` 입력
2. 도메인 업체 DNS에서
   - `A` 레코드 4개: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `www` → `CNAME` `junyeol-web.github.io`
3. 인증서 발급 후 **Enforce HTTPS** 체크
