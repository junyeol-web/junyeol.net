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
| Keywords | Work 페이지 필터 (Artwork · Identity · Publication · Poster · Space · Motion, 여러 개 선택 가능) |
| Format / specs | 상세 페이지에 표기 (예: Poster series, 594 × 841 mm, risograph) |
| Cover image | 랜딩 그리드에 받침판 위에 통째로(자르지 않고) 놓이는 대표 이미지 + 링크 공유 썸네일 |
| Images and videos | 상세 페이지 이미지. Layout: `full` · `half`(두 개 연속이면 나란히) · `inset` |
| Order | 작은 숫자가 위 (10, 20, 30…) |
| Hide (draft) | 사이트에서 숨김 |

**Information & settings**에서 테마(`white` · `grey` · `black` · `richblack`)를 바꿀 수 있음.

## 구조

```
content/
  site.json            소개·연락처·설정
  projects/*.json      프로젝트 1개 = 파일 1개 (파일명이 URL: /work/<파일명>/)
  media/               업로드한 원본 이미지·영상
src/styles.css         디자인 (색·폰트는 맨 위 변수에서)
src/main.js            이미지 페이드인, 영상은 화면에 보일 때만 재생, 현재 섹션 표시
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
